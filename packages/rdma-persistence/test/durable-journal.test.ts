/**
 * Tests for `DurableJournal` (crash-recovery queue for in-flight
 * proposals). The journal lives under `${storageRoot}/journal/` and
 * appends a JSONL line per event. Boot-time replay calls
 * `loadEntries()` or `streamAllEntries()` to recover the events.
 *
 * Each test uses a unique proposal id so concurrent file appends
 * don't overlap on the same on-disk file.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DurableJournal, isResumeableStage } from '../src/durable-journal.js';

let root: string;
let counter = 0;
before(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rdma-journal-'));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
});

function nextProposalId() {
  counter++;
  return `P-${counter}`;
}

function makeEntry(proposalId, overrides = {}) {
  return {
    proposalId,
    projectId: 'PRJ-1',
    kind: 'proposal.created',
    at: '2026-06-20T00:00:00.000Z',
    payload: { status: 'clarifying' },
    ...overrides,
  };
}

describe('DurableJournal', () => {
  it('init() creates the journal directory', async () => {
    const j = new DurableJournal(root);
    await j.init();
    assert.ok(existsSync(path.join(root, 'journal')));
  });

  it('append() writes a JSONL line with an auto-incrementing sequence', async () => {
    const j = new DurableJournal(root);
    const id = nextProposalId();
    await j.append(makeEntry(id));
    await j.append({ ...makeEntry(id), kind: 'stage.transitioned' });
    const entries = await j.loadEntries('PRJ-1', id);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].sequence, 1);
    assert.equal(entries[1].sequence, 2);
    assert.equal(entries[0].kind, 'proposal.created');
    assert.equal(entries[1].kind, 'stage.transitioned');
  });

  it('loadEntries(..., sinceSequence) skips the prefix', async () => {
    const j = new DurableJournal(root);
    const id = nextProposalId();
    for (let i = 0; i < 5; i++) {
      await j.append({ ...makeEntry(id, { kind: `k${i}` }) });
    }
    const after = await j.loadEntries('PRJ-1', id, 2);
    assert.equal(after.length, 3);
    assert.equal(after[0].sequence, 3);
  });

  it('loadEntries returns [] for an unknown proposal', async () => {
    const j = new DurableJournal(root);
    const empty = await j.loadEntries('PRJ-1', 'P-does-not-exist');
    assert.deepEqual(empty, []);
  });

  it('tolerates a malformed tail line', async () => {
    const j = new DurableJournal(root);
    const id = nextProposalId();
    await j.append(makeEntry(id));
    // Append a corrupted line at the end of the file.
    const file = path.join(root, 'journal', 'PRJ-1', `${id}.jsonl`);
    const { promises: fsp } = await import('node:fs');
    await fsp.appendFile(file, 'not valid json\n', 'utf8');
    const entries = await j.loadEntries('PRJ-1', id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].sequence, 1);
  });

  it('streamAllEntries walks every journal file across projects', async () => {
    // Use a fresh subdirectory so prior tests' journal files
    // (under root/journal) don't leak into this stream.
    const isolatedRoot = mkdtempSync(path.join(tmpdir(), 'rdma-journal-stream-'));
    try {
      const j = new DurableJournal(isolatedRoot);
      await j.init();
      const idA = 'PA-stream';
      const idB = 'PB-stream';
      await j.append(makeEntry(idA, { projectId: 'PRA' }));
      await j.append(makeEntry(idB, { projectId: 'PRB' }));
      await j.append(makeEntry(idA, { projectId: 'PRB' }));
      const seen = [];
      for await (const entry of j.streamAllEntries()) {
        seen.push(`${entry.projectId}/${entry.proposalId}`);
      }
      seen.sort();
      assert.deepEqual(seen, [`PRA/${idA}`, `PRB/${idA}`, `PRB/${idB}`]);
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('discard() removes the journal file', async () => {
    const j = new DurableJournal(root);
    const id = nextProposalId();
    await j.append(makeEntry(id));
    const file = path.join(root, 'journal', 'PRJ-1', `${id}.jsonl`);
    assert.ok(existsSync(file));
    await j.discard('PRJ-1', id);
    assert.equal(existsSync(file), false);
    // Loading afterwards is a no-op.
    const after = await j.loadEntries('PRJ-1', id);
    assert.deepEqual(after, []);
  });

  it('discard() is idempotent for an unknown proposal', async () => {
    const j = new DurableJournal(root);
    await j.discard('PRJ-1', 'P-never-existed');
    await j.discard('PRJ-1', 'P-never-existed');
    // No throw.
    assert.ok(true);
  });

  it('isTerminal() returns true for delivered/deployed, false otherwise', () => {
    const j = new DurableJournal(root);
    assert.equal(j.isTerminal('delivered'), true);
    assert.equal(j.isTerminal('deployed'), true);
    assert.equal(j.isTerminal('clarifying'), false);
    assert.equal(j.isTerminal('in_dev'), false);
  });
});

describe('isResumeableStage()', () => {
  it('treats non-terminal stages as resumeable', () => {
    assert.equal(isResumeableStage('clarifying'), true);
    assert.equal(isResumeableStage('in_dev'), true);
    assert.equal(isResumeableStage('test_failed'), true);
  });

  it('treats terminal stages as non-resumeable', () => {
    assert.equal(isResumeableStage('delivered'), false);
    assert.equal(isResumeableStage('deployed'), false);
  });
});

describe('DurableJournal archive()', () => {
  it('returns 0 when there is no active file', async () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'rdma-j-archive-'));
    try {
      const j = new DurableJournal(isolated);
      const n = await j.archive('PRJ-1', 'P-x', 24 * 60 * 60 * 1000);
      assert.equal(n, 0);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('returns 0 when every entry is fresh', async () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'rdma-j-archive-'));
    try {
      const j = new DurableJournal(isolated);
      await j.init();
      const id = 'P-fresh';
      await j.append({ ...makeEntry(id, { at: '2026-06-20T00:00:00.000Z' }) });
      const n = await j.archive(
        'PRJ-1',
        id,
        24 * 60 * 60 * 1000,
        Date.parse('2026-06-20T01:00:00.000Z'),
      );
      assert.equal(n, 0);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('moves old entries to a gzipped archive file and trims the active file', async () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'rdma-j-archive-'));
    try {
      const j = new DurableJournal(isolated);
      await j.init();
      const id = 'P-arc';
      // Two old + two fresh entries.
      const old = '2026-06-19T00:00:00.000Z';
      const fresh = '2026-06-20T00:00:00.000Z';
      const now = Date.parse('2026-06-20T12:00:00.000Z');
      await j.append({ ...makeEntry(id, { at: old, kind: 'old1' }) });
      await j.append({ ...makeEntry(id, { at: old, kind: 'old2' }) });
      await j.append({ ...makeEntry(id, { at: fresh, kind: 'new1' }) });
      await j.append({ ...makeEntry(id, { at: fresh, kind: 'new2' }) });
      const n = await j.archive('PRJ-1', id, 24 * 60 * 60 * 1000, now);
      assert.equal(n, 2);
      // Active file now holds just the two fresh entries.
      const active = await j.loadEntries('PRJ-1', id);
      assert.equal(active.length, 2);
      assert.equal(active[0].kind, 'new1');
      assert.equal(active[1].kind, 'new2');
      // Archive file is gzipped JSONL holding the two old entries.
      const archived = await j.loadArchivedEntries('PRJ-1', id);
      assert.equal(archived.length, 2);
      assert.equal(archived[0].kind, 'old1');
      assert.equal(archived[1].kind, 'old2');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('removes the active file when every entry is old', async () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'rdma-j-archive-'));
    try {
      const j = new DurableJournal(isolated);
      await j.init();
      const id = 'P-allold';
      // entry is 25h before `now` so a 24h window correctly archives it.
      const old = '2026-06-18T23:00:00.000Z';
      const now = Date.parse('2026-06-20T00:00:00.000Z');
      await j.append({ ...makeEntry(id, { at: old, kind: 'x' }) });
      const n = await j.archive('PRJ-1', id, 24 * 60 * 60 * 1000, now);
      assert.equal(n, 1);
      const after = await j.loadEntries('PRJ-1', id);
      assert.deepEqual(after, []);
      const archived = await j.loadArchivedEntries('PRJ-1', id);
      assert.equal(archived.length, 1);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('resets the in-memory counter after archive so the next append starts at 1', async () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'rdma-j-archive-'));
    try {
      const j = new DurableJournal(isolated);
      await j.init();
      const id = 'P-seq';
      const old = '2026-06-19T00:00:00.000Z';
      const fresh = '2026-06-20T00:00:00.000Z';
      const now = Date.parse('2026-06-20T12:00:00.000Z');
      await j.append({ ...makeEntry(id, { at: old, kind: 'a' }) });
      await j.append({ ...makeEntry(id, { at: old, kind: 'b' }) });
      await j.append({ ...makeEntry(id, { at: fresh, kind: 'c' }) });
      await j.archive('PRJ-1', id, 24 * 60 * 60 * 1000, now);
      // After archive, only 'c' remains in the active file. The
      // counter should be 1, so the next append is sequence 2
      // (continuing from the trimmed active file).
      const newEntry = await j.append({ ...makeEntry(id, { at: fresh, kind: 'd' }) });
      assert.equal(newEntry.sequence, 2);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('loadArchivedEntries returns [] when no archive exists', async () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'rdma-j-archive-'));
    try {
      const j = new DurableJournal(isolated);
      const out = await j.loadArchivedEntries('PRJ-1', 'P-nope');
      assert.deepEqual(out, []);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
