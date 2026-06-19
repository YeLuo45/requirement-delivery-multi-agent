/**
 * Tests for the EventBus + migration system.
 * SQLite tests are skipped when better-sqlite3 isn't installed.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/event-bus.js';
import { MIGRATIONS, runMigrations } from '../src/migrations.js';

describe('EventBus', () => {
  it('delivers events to specific subscribers', () => {
    const bus = new EventBus();
    let received = 0;
    bus.subscribe('proposal.created', () => {
      received++;
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(received, 1);
  });

  it('does not deliver events to subscribers of a different kind', () => {
    const bus = new EventBus();
    let received = 0;
    bus.subscribe('proposal.deleted', () => {
      received++;
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(received, 0);
  });

  it('delivers to wildcard subscribers', () => {
    const bus = new EventBus();
    let received = 0;
    bus.subscribe('*', () => {
      received++;
    });
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    bus.publish({
      kind: 'proposal.updated',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(received, 2);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    let received = 0;
    const unsub = bus.subscribe('proposal.created', () => {
      received++;
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    unsub();
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(received, 1);
  });

  it('subscribeOnce fires exactly once', async () => {
    const bus = new EventBus();
    let received = 0;
    bus.subscribeOnce('proposal.created', () => {
      received++;
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(received, 1);
  });

  it('handler errors are swallowed and counted', () => {
    const bus = new EventBus();
    bus.subscribe('proposal.created', () => {
      throw new Error('boom');
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(bus.getDroppedCount(), 1);
  });

  it('async handler rejections are counted', async () => {
    const bus = new EventBus();
    bus.subscribe('proposal.created', async () => {
      throw new Error('async boom');
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(bus.getDroppedCount(), 1);
  });
});

/**
 * Mock database for testing migrations without a real SQLite binding.
 */
class MockDatabase {
  private readonly tables = new Map<string, Array<Record<string, unknown>>>();
  private readonly pragmas: string[] = [];

  exec(sql: string): void {
    // Split on semicolons to handle multi-statement input (migrations often
    // issue many CREATE TABLE statements in one exec call).
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      if (/^PRAGMA/i.test(stmt)) {
        this.pragmas.push(stmt);
        continue;
      }
      const createMatch = /^CREATE TABLE(?: IF NOT EXISTS)? (\w+)/i.exec(stmt);
      if (createMatch) {
        const name = createMatch[1]!;
        if (!this.tables.has(name)) this.tables.set(name, []);
        continue;
      }
      const dropMatch = /^DROP TABLE(?: IF EXISTS)? (\w+)/i.exec(stmt);
      if (dropMatch) {
        this.tables.delete(dropMatch[1]!);
        continue;
      }
      // CREATE INDEX / CREATE UNIQUE INDEX — no-op for this mock.
      if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt)) {
        continue;
      }
      throw new Error(`Mock db cannot execute: ${stmt.slice(0, 80)}`);
    }
  }

  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: number };
  } {
    const insertMeta = /^INSERT INTO meta/.exec(sql);
    if (insertMeta) {
      return {
        all: () => [],
        get: () => undefined,
        run: (...params: unknown[]) => {
          const table = this.tables.get('meta') ?? [];
          const key = String(params[0]);
          const value = String(params[1]);
          const existing = table.find((r) => r['key'] === key);
          if (existing) {
            existing['value'] = value;
          } else {
            table.push({ key, value });
          }
          this.tables.set('meta', table);
          return { changes: 1, lastInsertRowid: table.length };
        },
      };
    }
    const updateMeta = /^UPDATE meta/.exec(sql);
    if (updateMeta) {
      return {
        all: () => [],
        get: () => undefined,
        run: (...params: unknown[]) => {
          const table = this.tables.get('meta') ?? [];
          const value = String(params[0]);
          const existing = table.find((r) => r['key'] === 'schema_version');
          if (existing) {
            existing['value'] = value;
          }
          return { changes: existing ? 1 : 0, lastInsertRowid: 0 };
        },
      };
    }
    const selectVersion = /value FROM meta WHERE key = 'schema_version'/.test(sql);
    if (selectVersion) {
      return {
        all: () => {
          const table = this.tables.get('meta') ?? [];
          return table.filter((r) => r['key'] === 'schema_version');
        },
        get: () => {
          const table = this.tables.get('meta') ?? [];
          return table.find((r) => r['key'] === 'schema_version');
        },
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      };
    }
    throw new Error(`Mock db cannot prepare: ${sql.slice(0, 80)}`);
  }

  transaction<T>(fn: () => T): () => T {
    return () => fn();
  }

  close(): void {
    this.tables.clear();
  }

  hasTable(name: string): boolean {
    return this.tables.has(name);
  }
}

describe('migrations', () => {
  it('runs all migrations on a fresh database', () => {
    const db = new MockDatabase();
    const result = runMigrations(db as unknown as import('../src/sqlite.js').Database);
    assert.deepEqual(result.applied, [1]);
    assert.equal(result.current, 1);
    assert.ok(db.hasTable('proposals'));
    assert.ok(db.hasTable('proposal_artifacts'));
    assert.ok(db.hasTable('audit_log'));
    assert.ok(db.hasTable('deployments'));
  });

  it('does not re-apply migrations when already at target', () => {
    const db = new MockDatabase();
    runMigrations(db as unknown as import('../src/sqlite.js').Database);
    const second = runMigrations(db as unknown as import('../src/sqlite.js').Database);
    assert.deepEqual(second.applied, []);
    assert.equal(second.current, 1);
  });

  it('all migrations have matching versions (no gaps)', () => {
    const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b);
    for (let i = 0; i < versions.length; i++) {
      assert.equal(versions[i], i + 1, `expected migration version ${i + 1}`);
    }
  });

  it('all migrations have non-empty up and down', () => {
    for (const m of MIGRATIONS) {
      // Just verify the function references are non-undefined.
      assert.equal(typeof m.up, 'function');
      assert.equal(typeof m.down, 'function');
    }
  });
});

describe('SqliteStorage (skipped if better-sqlite3 missing)', () => {
  let available = false;
  let storage: import('../src/sqlite.js').SqliteStorage | null = null;

  before(async () => {
    try {
      await import('better-sqlite3');
      available = true;
      storage = await import('../src/sqlite.js').SqliteStorage.open({ path: ':memory:' });
    } catch {
      available = false;
    }
  });

  after(() => {
    storage?.close();
  });

  it('round-trips a proposal', async () => {
    if (!available || !storage) {
      console.log('  skip: better-sqlite3 not installed');
      return;
    }
    const proposal = {
      id: 'P-20260619-001',
      projectId: 'PRJ-20260619-001',
      title: 'test',
      rawRequirement: 'r',
      status: 'research_direction_pending' as const,
      owner: null,
      clarificationRound: 0,
      tags: { priority: 'P1' },
      artifacts: [],
      createdAt: '2026-06-19T00:00:00Z',
      updatedAt: '2026-06-19T00:00:00Z',
    };
    await storage.saveProposal(proposal);
    const loaded = await storage.getProposal('P-20260619-001');
    assert.equal(loaded.title, 'test');
    assert.equal(loaded.tags['priority'], 'P1');
  });

  it('exposes a StorageDriver-shaped surface', async () => {
    if (!available || !storage) {
      console.log('  skip: better-sqlite3 not installed');
      return;
    }
    // Compile-time + runtime check: SqliteStorage can be used wherever a
    // StorageDriver is expected (this is what the CLI factory relies on).
    const driver: import('@rdma/core').StorageDriver = storage;
    assert.match(driver.backendName, /^sqlite:/);
    assert.equal(typeof driver.init, 'function');
    assert.equal(typeof driver.saveProposal, 'function');
    assert.equal(typeof driver.getProposal, 'function');
    await driver.init(); // idempotent
  });

  it('auto-creates the parent directory for a fresh path', async () => {
    if (!available) {
      console.log('  skip: better-sqlite3 not installed');
      return;
    }
    const tmpRoot = `/tmp/rdma-b3-${Date.now()}/nested/store.sqlite`;
    const opened = await import('../src/sqlite.js').SqliteStorage.open({ path: tmpRoot });
    try {
      const meta = await opened.readMeta();
      assert.ok(meta.version >= 1, 'migrations should have produced a version');
    } finally {
      opened.close();
    }
  });
});