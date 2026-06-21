/**
 * Tests for the `replay` module. We use an in-memory EventBus
 * substitute (we only need `publish` and `subscribe`) plus a fake
 * storage that returns a hand-crafted audit log.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { replayProposal } from '../src/replay.js';

interface FakeEvent {
  kind: string;
  proposalId: string;
  projectId: string;
  at: string;
  payload?: Record<string, unknown>;
}

class FakeBus {
  events: FakeEvent[] = [];
  publish(ev: FakeEvent): void {
    this.events.push(ev);
  }
  subscribe(_kind: string, _handler: (ev: FakeEvent) => void): { unsubscribe: () => void } {
    return { unsubscribe: () => undefined };
  }
  clear(): void {
    this.events = [];
  }
}

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  at: string;
  detail: Record<string, unknown>;
}

class FakeStorage {
  proposalsById = new Map<string, { id: string; projectId: string }>();
  auditByKey = new Map<string, string[]>();
  projects = new Set<string>();

  addProposal(p: { id: string; projectId: string }): void {
    this.proposalsById.set(p.id, p);
    this.projects.add(p.projectId);
  }
  addAudit(proposalId: string, projectId: string, lines: string[]): void {
    this.auditByKey.set(`${projectId}/${proposalId}`, lines);
  }

  async listProjects(): Promise<string[]> {
    return Array.from(this.projects);
  }
  async getProposal(id: string): Promise<{ id: string; projectId: string }> {
    const p = this.proposalsById.get(id);
    if (!p) throw new Error(`proposal not found: ${id}`);
    return p;
  }
  async readAudit(proposalId: string, projectId: string): Promise<string[]> {
    return this.auditByKey.get(`${projectId}/${proposalId}`) ?? [];
  }
}

describe('replayProposal()', () => {
  it('returns 0 events for an unknown proposal', async () => {
    const bus = new FakeBus();
    const storage = new FakeStorage();
    const result = await replayProposal(bus as never, storage as never, 'P-missing');
    assert.equal(result.total, 0);
    assert.deepEqual(result.byKind, {});
  });

  it('publishes one audit.appended event per JSONL line', async () => {
    const bus = new FakeBus();
    const storage = new FakeStorage();
    storage.addProposal({ id: 'P-1', projectId: 'PRJ-1' });
    storage.addAudit('P-1', 'PRJ-1', [
      JSON.stringify({
        id: 'a1',
        actor: 'coordinator',
        action: 'create',
        at: '2026-06-20T00:00:00.000Z',
        detail: { kind: 'proposal.created', stage: 'intake' },
      }),
      JSON.stringify({
        id: 'a2',
        actor: 'pm',
        action: 'transition',
        at: '2026-06-20T00:00:01.000Z',
        detail: { kind: 'stage.transition', stage: 'clarifying' },
      }),
    ]);
    const result = await replayProposal(bus as never, storage as never, 'P-1');
    assert.equal(result.total, 2);
    assert.equal(bus.events.length, 2);
    assert.equal(bus.events[0]?.kind, 'audit.appended');
    assert.equal(bus.events[0]?.proposalId, 'P-1');
    assert.equal(bus.events[0]?.projectId, 'PRJ-1');
  });

  it('summarizes by kind', async () => {
    const bus = new FakeBus();
    const storage = new FakeStorage();
    storage.addProposal({ id: 'P-2', projectId: 'PRJ-1' });
    storage.addAudit('P-2', 'PRJ-1', [
      JSON.stringify({
        id: 'a1',
        actor: 'c',
        action: 'a',
        at: 't1',
        detail: { kind: 'proposal.created' },
      }),
      JSON.stringify({
        id: 'a2',
        actor: 'c',
        action: 'b',
        at: 't2',
        detail: { kind: 'stage.transition' },
      }),
      JSON.stringify({
        id: 'a3',
        actor: 'c',
        action: 'c',
        at: 't3',
        detail: { kind: 'stage.transition' },
      }),
    ]);
    const result = await replayProposal(bus as never, storage as never, 'P-2');
    assert.equal(result.total, 3);
    assert.equal(result.byKind['proposal.created'], 1);
    assert.equal(result.byKind['stage.transition'], 2);
  });

  it('skips malformed JSONL lines without throwing', async () => {
    const bus = new FakeBus();
    const storage = new FakeStorage();
    storage.addProposal({ id: 'P-3', projectId: 'PRJ-1' });
    storage.addAudit('P-3', 'PRJ-1', [
      'not valid json',
      JSON.stringify({
        id: 'a1',
        actor: 'c',
        action: 'a',
        at: 't1',
        detail: { kind: 'proposal.created' },
      }),
      '{also broken',
    ]);
    const result = await replayProposal(bus as never, storage as never, 'P-3');
    assert.equal(result.total, 1);
    assert.equal(bus.events.length, 1);
  });

  it('falls back to entry.action when detail.kind is missing', async () => {
    const bus = new FakeBus();
    const storage = new FakeStorage();
    storage.addProposal({ id: 'P-4', projectId: 'PRJ-1' });
    storage.addAudit('P-4', 'PRJ-1', [
      JSON.stringify({ id: 'a1', actor: 'c', action: 'custom-action', at: 't1', detail: {} }),
    ]);
    const result = await replayProposal(bus as never, storage as never, 'P-4');
    assert.equal(result.total, 1);
    assert.equal(result.byKind['custom-action'], 1);
  });

  it('discovers the proposal across multiple projects', async () => {
    const bus = new FakeBus();
    const storage = new FakeStorage();
    storage.addProposal({ id: 'P-multi', projectId: 'PRJ-2' });
    storage.addAudit('P-multi', 'PRJ-2', [
      JSON.stringify({ id: 'a1', actor: 'c', action: 'a', at: 't1', detail: { kind: 'k' } }),
    ]);
    const result = await replayProposal(bus as never, storage as never, 'P-multi');
    assert.equal(result.total, 1);
    assert.equal(bus.events[0]?.projectId, 'PRJ-2');
  });
});

describe('replayProposal() — disk-backed storage', () => {
  let root: string;
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'rdma-replay-'));
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads JSONL from a real audit directory', async () => {
    const projectDir = path.join(root, 'audit', 'PRJ-x');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, 'P-disk.jsonl'),
      [
        JSON.stringify({
          id: 'a1',
          actor: 'c',
          action: 'a',
          at: 't1',
          detail: { kind: 'proposal.created' },
        }),
        JSON.stringify({
          id: 'a2',
          actor: 'c',
          action: 'b',
          at: 't2',
          detail: { kind: 'stage.transition', stage: 'clarifying' },
        }),
      ].join('\n'),
    );
    // We use a small wrapper that mirrors the Storage surface —
    // the test reads the file directly and the `replayProposal`
    // function takes any object that has `listProjects`, `getProposal`,
    // and `readAudit`. Construct the minimal stub here.
    const realStorage = {
      listProjects: async () => ['PRJ-x'],
      getProposal: async (id: string) => {
        if (id !== 'P-disk') throw new Error('not found');
        return { id: 'P-disk', projectId: 'PRJ-x' };
      },
      readAudit: async (proposalId: string, projectId: string) => {
        const file = path.join(root, 'audit', projectId, `${proposalId}.jsonl`);
        const buf = await import('node:fs/promises').then((m) => m.readFile(file, 'utf8'));
        return buf.split('\n').filter((l) => l.length > 0);
      },
    };
    const bus = new FakeBus();
    const result = await replayProposal(bus as never, realStorage as never, 'P-disk');
    assert.equal(result.total, 2);
    assert.equal(result.byKind['proposal.created'], 1);
    assert.equal(result.byKind['stage.transition'], 1);
  });
});
