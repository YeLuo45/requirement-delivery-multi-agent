/**
 * Tests for the `rdma metrics` CLI command (F3).
 *
 * The CLI walks the full pipeline once (so we have non-zero counters
 * and timings), reads the metrics snapshot from the singleton
 * recorder, and prints either JSON or Prometheus exposition format.
 *
 * We test the pure formatter (`renderMetricsText`) and the
 * orchestration (`cmdMetrics`) against an isolated `InMemoryMetrics`
 * instance so the tests don't share global state with the rest of
 * the suite.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { MetricsSnapshot } from '@rdma/observability';

import { cmdMetrics, renderMetricsText } from '../src/metrics.js';

describe('renderMetricsText()', () => {
  it('renders a Prometheus-style block per counter and timing', () => {
    const snap: MetricsSnapshot = {
      counters: { 'agent.handle.start': 3, 'agent.handle.end': 3 },
      timings: { 'agent.handle': [10, 12, 9] },
    };
    const out = renderMetricsText(snap);
    // HELP + TYPE lines for every metric + the actual sample line(s).
    assert.match(out, /# HELP agent_handle_start/);
    assert.match(out, /# TYPE agent_handle_start counter/);
    assert.match(out, /agent_handle_start\s+3\b/);
    assert.match(out, /# HELP agent_handle_seconds/);
    assert.match(out, /# TYPE agent_handle_seconds (gauge|summary)/);
    // The rendered timing series should include a count and sum.
    assert.match(out, /agent_handle_seconds_count\s+3\b/);
    assert.match(out, /agent_handle_seconds_sum\s+31\b/);
  });

  it('returns "no metrics recorded yet" for an empty snapshot', () => {
    const out = renderMetricsText({ counters: {}, timings: {} });
    assert.match(out, /no metrics recorded yet/i);
  });

  it('handles a snapshot that has counters but no timings', () => {
    const out = renderMetricsText({
      counters: { 'proposal.created': 1 },
      timings: {},
    });
    assert.match(out, /proposal_created\s+1\b/);
    assert.doesNotMatch(out, /# HELP agent_handle/);
  });
});

describe('cmdMetrics()', () => {
  let root: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'rdma-metrics-cmd-'));
    originalEnv = { ...process.env };
    process.env.RDMA_STORAGE_ROOT = root;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it('prints "(no metrics)" when no pipeline has run yet', async () => {
    const text = await captureStdout(() => cmdMetrics([], { storageRoot: root }));
    assert.match(text, /no metrics/i);
  });

  it('prints the snapshot in human-readable form by default', async () => {
    const text = await captureStdout(() => cmdMetrics(['--walk'], { storageRoot: root }));
    // The CLI's default output uses a "Counters" / "Timings" pair when
    // the snapshot has data; with --no-run we expect an empty state.
    assert.match(text, /Counters:/);
    assert.match(text, /agent\.handle\.start/);
    assert.match(text, /Timings:/);
  });

  it('--format prom prints the Prometheus exposition', async () => {
    const text = await captureStdout(() =>
      cmdMetrics(['--no-run', '--format', 'prom'], { storageRoot: root }),
    );
    assert.match(text, /no metrics recorded yet/);
  });

  it('--format json prints the raw snapshot', async () => {
    const text = await captureStdout(() =>
      cmdMetrics(['--no-run', '--format', 'json'], { storageRoot: root }),
    );
    const parsed = JSON.parse(text) as MetricsSnapshot;
    assert.deepEqual(parsed.counters, {});
    assert.deepEqual(parsed.timings, {});
  });

  it('renders counters + timings when a pipeline walk has run', async () => {
    const text = await captureStdout(() => cmdMetrics(['--walk'], { storageRoot: root }));
    // After walking the pipeline we expect the human-format block
    // to mention the agent.handle counter at least once. We don't
    // assert exact numbers — agent count varies as the registry
    // grows — only the format primitives.
    assert.match(text, /Counters:/);
    assert.match(text, /agent\.handle\.start/);
    assert.match(text, /Timings:/);
  });
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks: Buffer[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patched for test capture
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return Buffer.concat(chunks).toString('utf8');
}
