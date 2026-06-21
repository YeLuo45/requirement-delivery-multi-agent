/**
 * `rdma replay <proposal-id>` — re-emit the audit log for a single
 * proposal onto the EventBus, in time order. Used by the web
 * dashboard to back-fill late subscribers, and by CLI users
 * debugging "what happened to proposal P-X?".
 *
 * Pure: takes an `EventBus` and a `StorageDriver`; reads the JSONL
 * audit log; publishes one event per line. Tests cover the
 * translation logic without a real bus.
 */

import type { AuditEntry, StorageDriver } from '@rdma/core';
import type { EventBus } from '@rdma/persistence';

export interface ReplayResult {
  proposalId: string;
  total: number;
  byKind: Record<string, number>;
}

/**
 * Walk every JSONL line in the proposal's audit log and re-publish
 * each entry as a bus event. Returns a summary so the CLI can print
 * "replayed 24 events (3 proposal.created, 21 stage.transitioned)".
 */
export async function replayProposal(
  bus: EventBus,
  storage: StorageDriver,
  proposalId: string,
): Promise<ReplayResult> {
  // We have to find the proposal first to learn its projectId.
  // (The audit log is stored per project, not keyed by id alone.)
  const projectIds = await storage.listProjects();
  for (const projectId of projectIds) {
    try {
      const proposal = await storage.getProposal(proposalId);
      if (proposal.projectId !== projectId) continue;
      const lines = await storage.readAudit(proposalId, projectId);
      return await publishLines(bus, proposalId, projectId, lines);
    } catch {
      // try the next project
    }
  }
  // Proposal not found; the caller can handle the zero-event
  // response on its own.
  return { proposalId, total: 0, byKind: {} };
}

interface ParsedLine {
  raw: AuditEntry;
  kind: string;
  stage?: string;
  actor: string;
}

function parseLine(line: string): ParsedLine | null {
  try {
    const parsed = JSON.parse(line) as AuditEntry;
    const detail = (parsed.detail ?? {}) as { kind?: unknown; stage?: unknown };
    const kind = typeof detail.kind === 'string' ? detail.kind : (parsed.action ?? 'unknown');
    const stage = typeof detail.stage === 'string' ? detail.stage : undefined;
    return { raw: parsed, kind, stage, actor: parsed.actor };
  } catch {
    return null;
  }
}

async function publishLines(
  bus: EventBus,
  proposalId: string,
  projectId: string,
  lines: ReadonlyArray<string>,
): Promise<ReplayResult> {
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    total++;
    byKind[parsed.kind] = (byKind[parsed.kind] ?? 0) + 1;
    // We publish as `audit.appended` so consumers that subscribed
    // before the replay also receive the historical events with
    // the same shape they expect from the live bus.
    bus.publish({
      kind: 'audit.appended',
      proposalId,
      projectId,
      at: parsed.raw.at,
      payload: {
        action: parsed.raw.action,
        actor: parsed.actor,
        kind: parsed.kind,
        stage: parsed.stage,
        detail: parsed.raw.detail,
      },
    });
  }
  return { proposalId, total, byKind };
}

/**
 * CLI entry point. Usage:
 *   rdma replay <proposal-id>
 *   rdma replay <proposal-id> --json
 *
 * Reads the proposal's audit log, re-publishes each entry to the
 * bus, and prints a summary.
 */
export async function cmdReplay(argv: string[]): Promise<void> {
  const { positional, flags } = parseReplayArgs(argv);
  const proposalId = positional[0];
  if (!proposalId) {
    console.error('Usage: rdma replay <proposal-id> [--json]');
    process.exit(1);
  }
  const { buildDeps } = await import('@rdma/cli/run');
  const { bus, storage } = await buildDeps();
  const result = await replayProposal(bus, storage, proposalId);
  if (flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.total === 0) {
    console.log(`No events found for ${proposalId}`);
    return;
  }
  console.log(`Replayed ${result.total} event(s) for ${proposalId}:`);
  for (const [kind, n] of Object.entries(result.byKind)) {
    console.log(`  ${kind.padEnd(28)} ${n}`);
  }
}

function parseReplayArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}
