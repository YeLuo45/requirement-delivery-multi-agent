/**
 * Tests for EventEmittingStorage (direction E2).
 *
 * Verifies the wrapper:
 *   - forwards every read method unchanged
 *   - emits proposal.updated on saveProposal with status + artifactCount
 *   - emits audit.appended on appendAudit with the raw line
 *   - forwards init() to the inner driver
 *   - reports the underlying backend name + root
 *   - does not break storage writes when a subscriber throws
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Storage } from '@rdma/core';
import type { Proposal } from '@rdma/core';
import { EventBus, EventEmittingStorage } from '../src/index.js';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: overrides.id ?? 'P-1',
    projectId: overrides.projectId ?? 'PRJ-1',
    title: overrides.title ?? 'sample',
    rawRequirement: overrides.rawRequirement ?? 'sample req',
    status: overrides.status ?? 'research',
    artifacts: overrides.artifacts ?? [],
    createdAt: overrides.createdAt ?? '2026-06-19T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('EventEmittingStorage', () => {
  const dirs: string[] = [];
  let storage: Storage;
  let bus: EventBus;
  let wrapper: EventEmittingStorage;

  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rdma-evt-store-'));
    dirs.push(dir);
    storage = new Storage({ root: dir });
    await storage.init();
    bus = new EventBus();
    wrapper = new EventEmittingStorage(storage, bus);
  });

  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('reports the underlying backend name with a "+bus" suffix', () => {
    assert.match(wrapper.backendName, /^json:.*\+bus$/);
  });

  it('reports the underlying root', () => {
    assert.equal(wrapper.root, storage.root);
  });

  it('init() delegates to the inner driver', async () => {
    await wrapper.init(); // should not throw
  });

  it('saveProposal emits proposal.updated with status payload', async () => {
    const seen: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    bus.subscribe('proposal.updated', (e) => seen.push({ kind: e.kind, payload: e.payload ?? {} }));
    await wrapper.saveProposal(makeProposal({ id: 'P-A', status: 'research', artifacts: ['art1', 'art2'] }));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.kind, 'proposal.updated');
    assert.equal(seen[0]?.payload['status'], 'research');
    assert.equal(seen[0]?.payload['artifactCount'], 2);
  });

  it('appendAudit emits audit.appended with the raw line payload', async () => {
    const seen: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    bus.subscribe('audit.appended', (e) => seen.push({ kind: e.kind, payload: e.payload ?? {} }));
    await wrapper.appendAudit('P-A', 'PRJ-1', '{"stage":"research","kind":"agent.handle.start"}');
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.kind, 'audit.appended');
    assert.match(String(seen[0]?.payload['line'] ?? ''), /agent\.handle\.start/);
  });

  it('saveProposal keeps the proposal on disk (delegate works)', async () => {
    const p = makeProposal({ id: 'P-disk', status: 'pm' });
    await wrapper.saveProposal(p);
    const back = await wrapper.getProposal('P-disk');
    assert.equal(back.id, 'P-disk');
    assert.equal(back.status, 'pm');
  });

  it('appendAudit persists the line (delegate works)', async () => {
    await wrapper.appendAudit('P-disk', 'PRJ-1', '{"stage":"pm"}');
    const lines = await wrapper.readAudit('P-disk', 'PRJ-1');
    assert.ok(lines.length >= 1);
    assert.match(lines.join('\n'), /"stage":"pm"/);
  });

  it('listProposals is a pass-through and emits no events', async () => {
    const before = bus.getDroppedCount();
    const all = await wrapper.listProposals();
    assert.ok(all.length >= 1);
    // No new audit/proposal events fired.
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(bus.getDroppedCount(), before);
  });

  it('listProjects is a pass-through', async () => {
    const projects = await wrapper.listProjects();
    assert.ok(projects.includes('PRJ-1'));
  });

  it('readMeta is a pass-through', async () => {
    const meta = await wrapper.readMeta();
    assert.equal(typeof meta.version, 'number');
    assert.equal(typeof meta.createdAt, 'string');
  });

  it('a subscriber that throws does not break saveProposal', async () => {
    bus.subscribe('proposal.updated', () => {
      throw new Error('subscriber boom');
    });
    // Should still write to disk.
    await wrapper.saveProposal(makeProposal({ id: 'P-throws', status: 'dev' }));
    const back = await wrapper.getProposal('P-throws');
    assert.equal(back.id, 'P-throws');
    assert.equal(back.status, 'dev');
  });

  it('emits every save (no dedup) — useful for replay', async () => {
    const freshDir = mkdtempSync(path.join(tmpdir(), 'rdma-evt-store-fresh-'));
    dirs.push(freshDir);
    const freshStorage = new Storage({ root: freshDir });
    await freshStorage.init();
    const freshBus = new EventBus();
    const freshWrapper = new EventEmittingStorage(freshStorage, freshBus);
    const count = { value: 0 };
    freshBus.subscribe('proposal.updated', () => count.value++);
    await freshWrapper.saveProposal(makeProposal({ id: 'P-1', status: 'intake' }));
    await freshWrapper.saveProposal(makeProposal({ id: 'P-1', status: 'pm' }));
    await freshWrapper.saveProposal(makeProposal({ id: 'P-1', status: 'delivered' }));
    assert.equal(count.value, 3);
  });
});