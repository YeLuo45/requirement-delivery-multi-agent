/**
 * Local storage — proposals + audit log persisted as JSON files under .rdma/.
 *
 * Why files and not SQLite:
 *  - Zero external dependencies.
 *  - Easy to inspect / debug from the web dashboard.
 *  - Easy to ship in a tarball as a snapshot.
 *
 * Layout:
 *   .rdma/
 *     proposals/<project-id>/<proposal-id>.json
 *     audit/<project-id>/<proposal-id>.jsonl     # append-only
 *     meta.json                                  # directory version + counts
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Proposal } from './types.js';
import { ProposalNotFoundError } from './types.js';

const STORAGE_VERSION = 1 as const;

export interface StorageOptions {
  readonly root: string;
}

/**
 * Storage backend abstraction — every concrete backend (JSON files, SQLite,
 * in-memory) implements the same surface. The Pipeline doesn't know which
 * backend it's talking to; CLI / MCP / Web pick one at boot.
 *
 * Lifecycle:
 *   1. caller constructs a driver
 *   2. caller calls `init()` to create any directories / run migrations
 *   3. driver is now ready for read/write traffic
 */
export interface StorageDriver {
  /** Initialize backend state (create dirs, run migrations). Idempotent. */
  init(): Promise<void>;
  /** Stable, human-readable backend tag for diagnostics ("json", "sqlite:..."). */
  readonly backendName: string;
  /** Underlying root path (or ":memory:" for in-memory). */
  readonly root: string;
  saveProposal(proposal: Proposal): Promise<void>;
  getProposal(proposalId: string): Promise<Proposal>;
  listProposals(projectId?: string): Promise<ReadonlyArray<Proposal>>;
  listProjects(): Promise<ReadonlyArray<string>>;
  appendAudit(proposalId: string, projectId: string, line: string): Promise<void>;
  readAudit(proposalId: string, projectId: string): Promise<ReadonlyArray<string>>;
  readMeta(): Promise<{ version: number; createdAt: string }>;
}

export class Storage implements StorageDriver {
  readonly root: string;
  readonly backendName: string;

  constructor(opts: StorageOptions) {
    this.root = path.resolve(opts.root);
    this.backendName = `json:${this.root}`;
  }

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.root, 'proposals'), { recursive: true });
    await fs.mkdir(path.join(this.root, 'audit'), { recursive: true });
    const metaPath = path.join(this.root, 'meta.json');
    try {
      await fs.access(metaPath);
    } catch {
      await fs.writeFile(
        metaPath,
        JSON.stringify({ version: STORAGE_VERSION, createdAt: new Date().toISOString() }, null, 2),
      );
    }
  }

  proposalPath(proposal: Pick<Proposal, 'projectId' | 'id'>): string {
    return path.join(this.root, 'proposals', proposal.projectId, `${proposal.id}.json`);
  }

  auditPath(proposal: Pick<Proposal, 'projectId' | 'id'>): string {
    return path.join(this.root, 'audit', proposal.projectId, `${proposal.id}.jsonl`);
  }

  async listProjects(): Promise<ReadonlyArray<string>> {
    const dir = path.join(this.root, 'proposals');
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async listProposals(projectId?: string): Promise<ReadonlyArray<Proposal>> {
    const projects = projectId ? [projectId] : await this.listProjects();
    const results: Proposal[] = [];
    for (const pid of projects) {
      const dir = path.join(this.root, 'proposals', pid);
      try {
        const entries = await fs.readdir(dir);
        for (const entry of entries) {
          if (!entry.endsWith('.json')) continue;
          const content = await fs.readFile(path.join(dir, entry), 'utf8');
          results.push(JSON.parse(content) as Proposal);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
    }
    // newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  }

  async getProposal(proposalId: string): Promise<Proposal> {
    const projects = await this.listProjects();
    for (const pid of projects) {
      const candidate = path.join(this.root, 'proposals', pid, `${proposalId}.json`);
      try {
        const content = await fs.readFile(candidate, 'utf8');
        return JSON.parse(content) as Proposal;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    throw new ProposalNotFoundError(proposalId);
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    const target = this.proposalPath(proposal);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(proposal, null, 2));
  }

  async appendAudit(proposalId: string, projectId: string, line: string): Promise<void> {
    const target = this.auditPath({ projectId, id: proposalId });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, `${line}\n`, 'utf8');
  }

  async readAudit(proposalId: string, projectId: string): Promise<ReadonlyArray<string>> {
    const target = this.auditPath({ projectId, id: proposalId });
    try {
      const content = await fs.readFile(target, 'utf8');
      return content.split('\n').filter((line) => line.length > 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async readMeta(): Promise<{ version: number; createdAt: string }> {
    const metaPath = path.join(this.root, 'meta.json');
    try {
      const content = await fs.readFile(metaPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return { version: STORAGE_VERSION, createdAt: new Date().toISOString() };
    }
  }
}
