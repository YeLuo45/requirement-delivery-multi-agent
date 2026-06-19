/**
 * Migration system — versioned schema with up + down.
 *
 * Migrations are stored in code, not files. Add a new entry to `MIGRATIONS`
 * when you change the schema. Each entry has:
 *   - version: monotonically increasing integer
 *   - up(db): SQL statements to apply (use `db.exec()` for multi-statement)
 *   - down(db): SQL statements to revert
 *
 * Migrations run inside a transaction — partial application is impossible.
 */

import type { Database } from './sqlite.js';

export interface Migration {
  version: number;
  name: string;
  up(db: Database): void;
  down(db: Database): void;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS proposals (
          project_id TEXT NOT NULL,
          id TEXT NOT NULL,
          title TEXT NOT NULL,
          raw_requirement TEXT NOT NULL,
          source_url TEXT,
          status TEXT NOT NULL,
          owner TEXT,
          clarification_round INTEGER NOT NULL DEFAULT 0,
          tags_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (project_id, id)
        );

        CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
        CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON proposals(created_at DESC);

        CREATE TABLE IF NOT EXISTS proposal_artifacts (
          proposal_project_id TEXT NOT NULL,
          proposal_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          ord INTEGER NOT NULL,
          PRIMARY KEY (proposal_project_id, proposal_id, artifact_id),
          FOREIGN KEY (proposal_project_id, proposal_id) REFERENCES proposals(project_id, id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_artifacts_proposal ON proposal_artifacts(proposal_project_id, proposal_id, ord);

        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          proposal_project_id TEXT NOT NULL,
          proposal_id TEXT NOT NULL,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          at TEXT NOT NULL,
          detail_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_audit_proposal ON audit_log(proposal_project_id, proposal_id, id);
        CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);

        CREATE TABLE IF NOT EXISTS deployments (
          proposal_project_id TEXT NOT NULL,
          proposal_id TEXT NOT NULL,
          title TEXT NOT NULL,
          deployed_from_status TEXT NOT NULL,
          deployed_at TEXT NOT NULL,
          artifacts_count INTEGER NOT NULL,
          PRIMARY KEY (proposal_project_id, proposal_id)
        );

        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
    down(db) {
      db.exec(`
        DROP TABLE IF EXISTS deployments;
        DROP TABLE IF EXISTS audit_log;
        DROP TABLE IF EXISTS proposal_artifacts;
        DROP TABLE IF EXISTS proposals;
        DROP TABLE IF EXISTS meta;
      `);
    },
  },
];

export function runMigrations(db: Database, targetVersion?: number): {
  applied: number[];
  current: number;
} {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  let current = row ? Number(row.value) : 0;

  const target = targetVersion ?? Math.max(...MIGRATIONS.map((m) => m.version));

  const applied: number[] = [];
  while (current < target) {
    const next = MIGRATIONS.find((m) => m.version === current + 1);
    if (!next) throw new Error(`Missing migration to reach version ${current + 1}`);
    const runOnce = db.transaction(() => {
      next.up(db);
      // Insert schema_version with key+value as separate placeholders so a
      // mock DB that doesn't parse SQL can still match the column count.
      if (current === 0) {
        db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run(
          'schema_version',
          String(next.version),
        );
      } else {
        db.prepare(`UPDATE meta SET value = ? WHERE key = ?`).run(
          String(next.version),
          'schema_version',
        );
      }
    });
    runOnce();
    applied.push(next.version);
    current = next.version;
  }

  return { applied, current };
}