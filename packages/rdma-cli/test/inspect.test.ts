/**
 * Tests for the inspector CLIs (direction E4).
 *
 *   - rdma inspect <id>: shows status, artifacts, handoff chain, audit timeline
 *   - rdma events [--proposal <id>] [--limit N]: reads from storage audit log
 *
 * Both commands read from storage (the audit log is the source of truth,
 * not the in-process EventBus) so they work in a separate process after
 * the pipeline has finished.
 *
 * Storage isolation: every test passes its own `storageRoot` to the
 * commands, so the tests never touch the global STORAGE_ROOT.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createBossAgent } from '@rdma/boss';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { AuditLog, type Proposal, Storage } from '@rdma/core';
import { AgentRegistry } from '@rdma/core';
import { createDevAgent } from '@rdma/dev';
import { EventBus } from '@rdma/persistence';
import { createPmAgent } from '@rdma/pm';
import { createQaAgent } from '@rdma/qa';
import { createResearchAgent } from '@rdma/research';
import { cmdEvents, cmdInspect } from '../src/inspect.js';

function withCapturedStdout<T>(fn: () => Promise<T>): Promise<{ out: string; result: T }> {
  return new Promise((resolve, reject) => {
    const origLog = console.log;
    let buf = '';
    (console as unknown as { log: (s: string) => void }).log = (s: string) => {
      buf += `${s}\n`;
    };
    fn()
      .then((result) => {
        (console as unknown as { log: typeof origLog }).log = origLog;
        resolve({ out: buf, result });
      })
      .catch((err: unknown) => {
        (console as unknown as { log: typeof origLog }).log = origLog;
        reject(err);
      });
  });
}

function bootstrap(storage: Storage, bus: EventBus, shippedRoot: string): Pipeline {
  const audit = new AuditLog(storage);
  const reg = new AgentRegistry();
  reg.register(createResearchAgent());
  reg.register(createCoordinatorAgent());
  reg.register(createPmAgent());
  reg.register(createDevAgent());
  reg.register(createQaAgent());
  reg.register(createBossAgent({ shippedRoot }));
  return new Pipeline({ registry: reg, storage, audit, bus });
}

describe('rdma inspect', () => {
  const dirs: string[] = [];
  let storage: Storage;
  let pipeline: Pipeline;
  let proposal: Proposal;
  let root: string;

  before(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'rdma-inspect-'));
    const shipped = mkdtempSync(path.join(tmpdir(), 'rdma-inspect-shipped-'));
    dirs.push(root, shipped);
    storage = new Storage({ root });
    await storage.init();
    pipeline = bootstrap(storage, new EventBus(), shipped);
    const p = await pipeline.createProposal({
      title: 'inspect me',
      rawRequirement: 'small requirement',
    });
    proposal = await pipeline.runToCompletion(p);
  });

  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('shows proposal id, status, project id', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdInspect([proposal.id], { storageRoot: root }),
    );
    assert.match(out, new RegExp(`Proposal ${proposal.id}`));
    assert.match(out, new RegExp(`status:\\s+${proposal.status}`));
    assert.match(out, new RegExp(`project:\\s+${proposal.projectId}`));
  });

  it('shows the handoff chain', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdInspect([proposal.id], { storageRoot: root }),
    );
    assert.match(out, /handoff chain:/);
    assert.match(out, /→/);
  });

  it('lists every artifact with kind/agent/summary', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdInspect([proposal.id], { storageRoot: root }),
    );
    assert.match(out, /Artifacts \(\d+\):/);
    assert.ok(proposal.artifacts.length > 0, 'precondition: at least one artifact');
    assert.match(out, /market_research|pm|dev|qa|boss/);
  });

  it('shows the audit timeline with timestamps', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdInspect([proposal.id], { storageRoot: root }),
    );
    assert.match(out, /Audit timeline \(\d+ entries\):/);
    assert.match(out, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
  });

  it('throws when called without an id', async () => {
    await assert.rejects(
      () => withCapturedStdout(() => cmdInspect([], { storageRoot: root })),
      /Usage: rdma inspect <proposal-id>/,
    );
  });

  it('throws when the proposal does not exist', async () => {
    await assert.rejects(
      () => withCapturedStdout(() => cmdInspect(['P-does-not-exist'], { storageRoot: root })),
      /not found/,
    );
  });

  it('handles a single proposal with zero artifacts', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'rdma-inspect-2-'));
    dirs.push(root2);
    const s2 = new Storage({ root: root2 });
    await s2.init();
    await s2.saveProposal({
      id: 'P-empty',
      projectId: 'PRJ-empty',
      title: 'empty',
      rawRequirement: 'r',
      status: 'research',
      owner: null,
      clarificationRound: 0,
      artifacts: [],
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z',
      tags: {},
    });
    const { out } = await withCapturedStdout(() => cmdInspect(['P-empty'], { storageRoot: root2 }));
    assert.match(out, /Artifacts \(0\):/);
    assert.match(out, /\(none\)/);
  });

  it('tolerates an unparseable audit line by printing a sentinel', async () => {
    const fs = await import('node:fs/promises');
    const auditPath = path.join(root, 'audit', proposal.projectId, `${proposal.id}.jsonl`);
    await fs.appendFile(auditPath, 'this is not json\n');
    const { out } = await withCapturedStdout(() =>
      cmdInspect([proposal.id], { storageRoot: root }),
    );
    assert.match(out, /\[unparseable\]/);
  });

  it('falls back to entry.action when audit entry has no detail.kind', async () => {
    // Append a hand-crafted audit entry without `detail.kind` so the
    // `entry.action ?? '?'` fallback branch in cmdInspect is exercised.
    const fs = await import('node:fs/promises');
    const auditPath = path.join(root, 'audit', proposal.projectId, `${proposal.id}.jsonl`);
    await fs.appendFile(
      auditPath,
      `${JSON.stringify({
        id: 'plain',
        proposalId: proposal.id,
        actor: 'system',
        action: 'manual.note',
        at: '2026-06-20T00:00:00.000Z',
        detail: {},
      })}\n`,
    );
    const { out } = await withCapturedStdout(() =>
      cmdInspect([proposal.id], { storageRoot: root }),
    );
    assert.match(out, /manual\.note/);
  });

  it('uses detail.kind and detail.stage when audit entry provides them', async () => {
    const fs = await import('node:fs/promises');
    const auditPath = path.join(root, 'audit', proposal.projectId, `${proposal.id}.jsonl`);
    await fs.appendFile(
      auditPath,
      `${JSON.stringify({
        id: 'rich',
        proposalId: proposal.id,
        actor: 'pm',
        action: 'agent.handle.end',
        at: '2026-06-20T00:00:01.000Z',
        detail: { kind: 'pm.prd', stage: 'prd_pending_confirmation' },
      })}\n`,
    );
    const { out } = await withCapturedStdout(() =>
      cmdInspect([proposal.id], { storageRoot: root }),
    );
    assert.match(out, /pm\.prd/);
    assert.match(out, /prd_pending_confirmation/);
  });
});

describe('rdma events', () => {
  const dirs: string[] = [];
  let storage: Storage;
  let pipeline: Pipeline;
  let proposal: Proposal;
  let root: string;

  before(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'rdma-events-'));
    const shipped = mkdtempSync(path.join(tmpdir(), 'rdma-events-shipped-'));
    dirs.push(root, shipped);
    storage = new Storage({ root });
    await storage.init();
    pipeline = bootstrap(storage, new EventBus(), shipped);
    const p = await pipeline.createProposal({ title: 'events me', rawRequirement: 'r' });
    proposal = await pipeline.runToCompletion(p);
  });

  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('lists every audit-derived event for the proposal', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id], { storageRoot: root }),
    );
    assert.match(out, new RegExp(`event\\(s\\) for ${proposal.id}`));
    assert.match(out, /agent\.handle\.start/);
    assert.match(out, /agent\.handle\.end/);
  });

  it('respects --limit', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--limit', '2'], { storageRoot: root }),
    );
    const dataLines = out
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('  #'));
    assert.ok(dataLines.length <= 2, `expected <=2 events, got ${dataLines.length}`);
  });

  it('throws on a non-positive --limit', async () => {
    await assert.rejects(
      () => withCapturedStdout(() => cmdEvents(['--limit', '0'], { storageRoot: root })),
      /--limit must be a positive integer/,
    );
  });

  it('throws on a negative --since-seq', async () => {
    await assert.rejects(
      () => withCapturedStdout(() => cmdEvents(['--since-seq', '-3'], { storageRoot: root })),
      /--since-seq must be a non-negative integer/,
    );
  });

  it('reports not-found when --proposal id is unknown', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', 'P-nope'], { storageRoot: root }),
    );
    assert.match(out, /P-nope not found/);
  });

  it('includes the kind, timestamp and payload in each row', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--limit', '5'], { storageRoot: root }),
    );
    assert.match(out, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
    assert.match(out, /\{.*\}/);
  });

  it('when --proposal is omitted, lists events across all proposals', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--limit', '100'], { storageRoot: root }),
    );
    assert.match(out, /\d+ event\(s\):/);
  });

  it('--since-seq skips the first N events', async () => {
    const all = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--limit', '1000'], { storageRoot: root }),
    );
    const allRows = all.out
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('  #')).length;
    const skip = Math.max(1, Math.floor(allRows / 3));
    const skipped = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--limit', '1000', '--since-seq', String(skip)], {
        storageRoot: root,
      }),
    );
    const skippedRows = skipped.out
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('  #')).length;
    assert.equal(skippedRows, allRows - skip);
  });

  it('parses --key=value flags via the = form', async () => {
    // The parseArgs branch that splits `--limit=5` on `=` is otherwise
    // never reached by the dedicated --limit / --since-seq tests.
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--limit=2'], { storageRoot: root }),
    );
    const dataLines = out
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('  #'));
    assert.ok(dataLines.length <= 2, `expected <=2 events via = form, got ${dataLines.length}`);
  });

  it('parses --flag as a boolean when followed by another --flag', async () => {
    // The parseArgs branch where a flag is followed by another --flag
    // (no value to consume) is exercised here via --verbose.
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--verbose', '--limit', '3'], { storageRoot: root }),
    );
    assert.match(out, /\d+ event\(s\) for/);
  });

  it('falls back to entry.action when audit entry has no detail.kind', async () => {
    const fs = await import('node:fs/promises');
    const auditPath = path.join(root, 'audit', proposal.projectId, `${proposal.id}.jsonl`);
    await fs.appendFile(
      auditPath,
      `${JSON.stringify({
        id: 'plain',
        proposalId: proposal.id,
        actor: 'system',
        action: 'manual.note',
        at: '2026-06-20T00:00:00.000Z',
        detail: {},
      })}\n`,
    );
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--limit', '1000'], { storageRoot: root }),
    );
    assert.match(out, /manual\.note/);
  });

  it('uses detail.kind when audit entry provides it (cmdEvents branch)', async () => {
    const fs = await import('node:fs/promises');
    const auditPath = path.join(root, 'audit', proposal.projectId, `${proposal.id}.jsonl`);
    await fs.appendFile(
      auditPath,
      `${JSON.stringify({
        id: 'rich',
        proposalId: proposal.id,
        actor: 'pm',
        action: 'agent.handle.end',
        at: '2026-06-20T00:00:01.000Z',
        detail: { kind: 'pm.prd' },
      })}\n`,
    );
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--limit', '1000'], { storageRoot: root }),
    );
    assert.match(out, /pm\.prd/);
  });

  it('prints "(none)" when --since-seq skips every row', async () => {
    const { out } = await withCapturedStdout(() =>
      cmdEvents(['--proposal', proposal.id, '--limit', '1000', '--since-seq', '99999'], {
        storageRoot: root,
      }),
    );
    assert.match(out, /\(none\)/);
  });
});
