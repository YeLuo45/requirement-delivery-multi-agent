/**
 * SQLite Storage — drop-in replacement for the JSON storage in @rdma/core.
 *
 * Implements the same `Storage` interface so callers don't need to change.
 * Persists to a single .sqlite file (path passed at construction).
 *
 * Uses better-sqlite3 (synchronous API, very fast, perfect for CLI use).
 * For web/edge use, swap with a different driver behind the same Database
 * abstraction.
 *
 * Features:
 *   - Synchronous I/O inside async wrappers (matches the Storage API)
 *   - WAL journal mode for concurrent reads + safe writes
 *   - Foreign keys enabled
 *   - Schema migrations via runMigrations()
 *   - Append-only audit log
 *   - Cascade-delete artifacts + audit when a proposal is removed
 */

import type { Artifact, AuditEntry, Proposal, Stage, StorageDriver } from '@rdma/core';
import { ProposalNotFoundError } from '@rdma/core';
import { runMigrations } from './migrations.js';

/**
 * Minimal Database interface — abstract over better-sqlite3 / :memory: / other.
 */
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export interface Statement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface SqliteStorageOptions {
  /** Path to the .sqlite file. Use ':memory:' for an in-memory database. */
  path: string;
}

/**
 * Open a better-sqlite3 database with the RDMA-friendly defaults.
 * Lazy-loads better-sqlite3 so packages without the native binding can
 * still resolve the module (they just can't open a real database).
 */
export async function openSqliteDatabase(path: string): Promise<Database> {
  if (path !== ':memory:') {
    // better-sqlite3 refuses to open a DB whose parent dir doesn't exist.
    // Create the directory up front so callers can hand us a fresh path.
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir.length > 0) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
    }
  }
  try {
    // Dynamic import so missing native bindings don't break module loading.
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const db = new BetterSqlite3(path);

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');

    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => ({
        all: (...params) => db.prepare(sql).all(...params),
        get: (...params) => db.prepare(sql).get(...params),
        run: (...params) => db.prepare(sql).run(...params),
      }),
      transaction: <T>(fn: () => T) => db.transaction(fn),
      close: () => db.close(),
    };
  } catch (err) {
    throw new Error(
      `Failed to open SQLite database at ${path}. Install better-sqlite3 (npm install better-sqlite3). Original error: ${(err as Error).message}`,
    );
  }
}

export class SqliteStorage implements StorageDriver {
  readonly db: Database;
  readonly dbPath: string;
  readonly root: string;
  readonly backendName: string;
  private closed = false;

  constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
    this.root = dbPath;
    this.backendName = `sqlite:${dbPath}`;
  }

  static async open(opts: SqliteStorageOptions): Promise<SqliteStorage> {
    const db = await openSqliteDatabase(opts.path);
    const storage = new SqliteStorage(db, opts.path);
    storage.migrate();
    return storage;
  }

  async init(): Promise<void> {
    // Migrations run on open(); init() is a no-op kept for the StorageDriver
    // contract so callers can use a single boot sequence across backends.
  }

  migrate(): void {
    runMigrations(this.db);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  // --- Proposals ---

  async saveProposal(proposal: Proposal): Promise<void> {
    const tx = this.db.transaction(() => {
      // Upsert proposal
      this.db
        .prepare(
          `INSERT INTO proposals
            (project_id, id, title, raw_requirement, source_url, status, owner,
             clarification_round, tags_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, id) DO UPDATE SET
              title=excluded.title,
              raw_requirement=excluded.raw_requirement,
              source_url=excluded.source_url,
              status=excluded.status,
              owner=excluded.owner,
              clarification_round=excluded.clarification_round,
              tags_json=excluded.tags_json,
              updated_at=excluded.updated_at`,
        )
        .run(
          proposal.projectId,
          proposal.id,
          proposal.title,
          proposal.rawRequirement,
          proposal.sourceUrl ?? null,
          proposal.status,
          proposal.owner,
          proposal.clarificationRound,
          JSON.stringify(proposal.tags),
          proposal.createdAt,
          proposal.updatedAt,
        );

      // Replace artifacts (full rewrite — simpler than diffing)
      this.db
        .prepare('DELETE FROM proposal_artifacts WHERE proposal_project_id = ? AND proposal_id = ?')
        .run(proposal.projectId, proposal.id);
      const insertArtifact = this.db.prepare(
        `INSERT INTO proposal_artifacts
          (proposal_project_id, proposal_id, artifact_id, kind, agent_id,
           summary, content, created_at, ord)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      proposal.artifacts.forEach((a, i) => {
        insertArtifact.run(
          proposal.projectId,
          proposal.id,
          a.id,
          a.kind,
          a.agentId,
          a.summary,
          a.content,
          a.createdAt,
          i,
        );
      });
    });
    tx();
  }

  async getProposal(proposalId: string): Promise<Proposal> {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ? LIMIT 1').get(proposalId) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new ProposalNotFoundError(proposalId);

    const artifactRows = this.db
      .prepare(
        `SELECT artifact_id, kind, agent_id, summary, content, created_at
         FROM proposal_artifacts
         WHERE proposal_id = ?
         ORDER BY ord ASC`,
      )
      .all(proposalId) as Array<Record<string, unknown>>;

    const artifacts: Artifact[] = artifactRows.map((r) => ({
      id: String(r.artifact_id),
      kind: r.kind as Artifact['kind'],
      agentId: String(r.agent_id),
      summary: String(r.summary),
      content: String(r.content),
      createdAt: String(r.created_at),
    }));

    return rowToProposal(row, artifacts);
  }

  async listProposals(projectId?: string): Promise<ReadonlyArray<Proposal>> {
    let rows: unknown[];
    if (projectId) {
      rows = this.db
        .prepare('SELECT * FROM proposals WHERE project_id = ? ORDER BY created_at DESC')
        .all(projectId);
    } else {
      rows = this.db.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all();
    }

    return Promise.all(
      (rows as Array<Record<string, unknown>>).map(async (row) => {
        const proposalId = String(row.id);
        const artifactRows = this.db
          .prepare(
            `SELECT artifact_id, kind, agent_id, summary, content, created_at
             FROM proposal_artifacts
             WHERE proposal_id = ?
             ORDER BY ord ASC`,
          )
          .all(proposalId) as Array<Record<string, unknown>>;
        const artifacts: Artifact[] = artifactRows.map((r) => ({
          id: String(r.artifact_id),
          kind: r.kind as Artifact['kind'],
          agentId: String(r.agent_id),
          summary: String(r.summary),
          content: String(r.content),
          createdAt: String(r.created_at),
        }));
        return rowToProposal(row, artifacts);
      }),
    );
  }

  async listProjects(): Promise<ReadonlyArray<string>> {
    const rows = this.db
      .prepare('SELECT DISTINCT project_id FROM proposals ORDER BY project_id DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => String(r.project_id));
  }

  // --- Audit log ---

  async appendAudit(proposalId: string, projectId: string, line: string): Promise<void> {
    const entry = JSON.parse(line) as AuditEntry;
    this.db
      .prepare(
        `INSERT INTO audit_log
          (proposal_project_id, proposal_id, actor, action, at, detail_json)
          VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        proposalId,
        entry.actor,
        entry.action,
        entry.at,
        JSON.stringify(entry.detail),
      );
  }

  async readAudit(proposalId: string, projectId: string): Promise<ReadonlyArray<string>> {
    const rows = this.db
      .prepare(
        `SELECT actor, action, at, detail_json
         FROM audit_log
         WHERE proposal_id = ? AND proposal_project_id = ?
         ORDER BY id ASC`,
      )
      .all(proposalId, projectId) as Array<Record<string, unknown>>;
    return rows.map((r) =>
      JSON.stringify({
        actor: r.actor,
        action: r.action,
        at: r.at,
        detail: JSON.parse(String(r.detail_json)),
      }),
    );
  }

  // --- Misc ---

  async readMeta(): Promise<{ version: number; createdAt: string }> {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    const version = row ? Number(row.value) : 1;
    const createdRow = this.db.prepare(`SELECT value FROM meta WHERE key = 'created_at'`).get() as
      | { value: string }
      | undefined;
    return {
      version,
      createdAt: createdRow?.value ?? new Date().toISOString(),
    };
  }
}

function rowToProposal(row: Record<string, unknown>, artifacts: Artifact[]): Proposal {
  const tagsJson = String(row.tags_json ?? '{}');
  const sourceUrl = row.source_url as string | null;
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    rawRequirement: String(row.raw_requirement),
    ...(sourceUrl ? { sourceUrl } : {}),
    status: String(row.status) as Stage,
    owner: (row.owner as string | null) ?? null,
    clarificationRound: Number(row.clarification_round ?? 0),
    tags: JSON.parse(tagsJson) as Record<string, string>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    artifacts,
  };
}
