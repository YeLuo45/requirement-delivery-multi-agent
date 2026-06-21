/**
 * `rdma metrics` — surface the in-memory metrics snapshot.
 *
 * The CLI is wired up alongside `cmdStatus` and walks a small demo
 * proposal through the pipeline so the counters and timings have
 * something to report. Use `--format json` for machine-readable output
 * or `--format prom` for Prometheus exposition.
 *
 * The CLI deliberately does NOT start a long-running daemon: the
 * pipeline runs synchronously and the process exits when the
 * snapshot has been printed.
 */

import { createBossAgent } from '@rdma/boss';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { AgentRegistry, AuditLog, Storage } from '@rdma/core';
import { createDesignerAgent } from '@rdma/designer';
import { createDevAgent } from '@rdma/dev';
import {
  InMemoryMetrics,
  type MetricsRecorder,
  type MetricsSnapshot,
  createInMemoryMetrics,
} from '@rdma/observability';
import { EventBus } from '@rdma/persistence';
import { createPmAgent } from '@rdma/pm';
import { createQaAgent } from '@rdma/qa';
import { createResearchAgent } from '@rdma/research';

interface ParsedMetricsFlags {
  format: 'human' | 'json' | 'prom';
  noRun: boolean;
}

/**
 * Parse the (small) flag surface of `rdma metrics`. We intentionally
 * keep this in its own namespace so future flags don't collide with
 * the shared `parseArgs` in `run.ts`.
 */
export function parseMetricsArgs(argv: ReadonlyArray<string>): ParsedMetricsFlags {
  const flags: ParsedMetricsFlags = { format: 'human', noRun: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--format') {
      const next = argv[i + 1];
      if (next === 'human' || next === 'json' || next === 'prom') {
        flags.format = next;
        i++;
      }
      continue;
    }
    if (arg === '--no-run') {
      // Explicit no-op form, kept for explicit-by-default callers
      // and to match the README snippets.
      flags.noRun = true;
      continue;
    }
    if (arg === '--walk') {
      // Explicit opt-in to drive a demo proposal through the full
      // pipeline so counters/timings have non-zero samples. Without
      // this flag the command is read-only and safe to run from any
      // directory.
      flags.noRun = false;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      flags.format = 'human';
    }
  }
  return flags;
}

/**
 * Drive a single proposal through the full pipeline so the metrics
 * recorder has at least one sample for each counter / timing series.
 * Returns the recorder so the caller can render the snapshot.
 */
export async function collectPipelineMetrics(
  storageRoot: string,
  recorder: MetricsRecorder,
): Promise<{ proposalId: string; recorder: MetricsRecorder }> {
  const storage = new Storage({ root: storageRoot });
  await storage.init();
  const audit = new AuditLog(storage);
  const bus = new EventBus();
  const registry = new AgentRegistry();
  registry.register(createResearchAgent());
  registry.register(createCoordinatorAgent());
  registry.register(createDesignerAgent());
  registry.register(createPmAgent());
  registry.register(createDevAgent());
  registry.register(createQaAgent());
  registry.register(createBossAgent({ shippedRoot: storageRoot }));
  const pipeline = new Pipeline({ registry, storage, audit, bus, metrics: recorder });
  const created = await pipeline.createProposal({
    title: 'metrics demo',
    rawRequirement: 'Generate one full-pipeline walk for the metrics snapshot.',
  });
  await pipeline.runToCompletion(created);
  return { proposalId: created.id, recorder };
}

/**
 * Render the metrics snapshot in a way the CLI can print. The
 * Prometheus exposition follows the standard text format used by
 * every `/metrics` endpoint in the wild, so scrapers can pick it up
 * without modification.
 *
 * Counter keys use `_` as the metric name (Prometheus convention) and
 * timings are exposed as a `{name}_seconds` summary with count + sum.
 */
export function renderMetricsText(snap: MetricsSnapshot): string {
  const counterNames = Object.keys(snap.counters).sort();
  const timingNames = Object.keys(snap.timings).sort();
  if (counterNames.length === 0 && timingNames.length === 0) {
    return '# no metrics recorded yet\n';
  }
  const lines: string[] = [];
  for (const name of counterNames) {
    const metric = name.replace(/[._-]/g, '_');
    lines.push(`# HELP ${metric} RDMA counter`);
    lines.push(`# TYPE ${metric} counter`);
    lines.push(`${metric} ${snap.counters[name] ?? 0}`);
  }
  for (const name of timingNames) {
    const metric = `${name.replace(/[._-]/g, '_')}_seconds`;
    const samples = snap.timings[name] ?? [];
    const sum = samples.reduce((acc, v) => acc + v, 0);
    lines.push(`# HELP ${metric} RDMA timing summary in milliseconds`);
    lines.push(`# TYPE ${metric} summary`);
    lines.push(`${metric}_count ${samples.length}`);
    lines.push(`${metric}_sum ${sum}`);
  }
  return `${lines.join('\n')}\n`;
}

export interface CmdMetricsOptions {
  storageRoot?: string;
  recorder?: MetricsRecorder;
}

/**
 * Default for `cmdMetrics` is to print the empty snapshot only —
 * the user has to pass `--walk` to actually drive a demo proposal
 * through the pipeline before printing. The reason: the walk
 * writes a deployment record into `.rdma/shipped/`, and during
 * `verify:readme` we run the CLI in tmpdirs where that write can
 * race with other tests. By requiring an opt-in flag, the README
 * command stays cheap and side-effect-free.
 */
export async function cmdMetrics(
  argv: ReadonlyArray<string>,
  opts: CmdMetricsOptions = {},
): Promise<void> {
  const flags = parseMetricsArgs(argv);
  const recorder = opts.recorder ?? new InMemoryMetrics();
  if (!flags.noRun) {
    const storageRoot = opts.storageRoot ?? process.env.RDMA_STORAGE_ROOT ?? '';
    if (storageRoot) {
      await collectPipelineMetrics(storageRoot, recorder);
    }
  }
  const snap = recorder.snapshot();
  if (flags.format === 'json') {
    console.log(JSON.stringify(snap, null, 2));
    return;
  }
  if (flags.format === 'prom') {
    console.log(renderMetricsText(snap));
    return;
  }
  console.log(formatHuman(snap));
}

function formatHuman(snap: MetricsSnapshot): string {
  const counters = Object.entries(snap.counters).sort(([a], [b]) => a.localeCompare(b));
  const timings = Object.entries(snap.timings).sort(([a], [b]) => a.localeCompare(b));
  if (counters.length === 0 && timings.length === 0) {
    return '(no metrics recorded)';
  }
  const out: string[] = ['Counters:'];
  for (const [name, value] of counters) {
    out.push(`  ${name}: ${value}`);
  }
  out.push('', 'Timings:');
  for (const [name, samples] of timings) {
    if (samples.length === 0) {
      out.push(`  ${name}: (none)`);
      continue;
    }
    const sum = samples.reduce((acc, v) => acc + v, 0);
    const avg = sum / samples.length;
    out.push(`  ${name}: n=${samples.length} avg=${avg.toFixed(1)}ms sum=${sum.toFixed(1)}ms`);
  }
  return out.join('\n');
}

export { createInMemoryMetrics };
