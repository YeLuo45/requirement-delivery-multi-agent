/**
 * Inspector CLIs (direction E4).
 *
 *   rdma inspect <id>            Show a full breakdown of one proposal:
 *                                status, artifact timeline, handoff chain,
 *                                audit log with timestamps + actor + kind.
 *
 *   rdma events [--proposal <id>] [--limit N] [--since-seq M]
 *                                Print every recorded event, optionally
 *                                filtered to a single proposal. Reads the
 *                                audit log from storage (source of truth)
 *                                so it works even after a daemon restart.
 *
 *   GET /inspect/:id             JSON form of the same data, used by
 *                                the `rdma serve` daemon and dashboards.
 *   GET /events?proposal=...     JSON event stream; the daemon exposes
 *                                the same data over HTTP.
 *
 * Both commands take an optional `storageRoot` in their second argument
 * so tests can pass a temporary directory (DI pattern from the serve
 * command). The CLI dispatcher in `cli.ts` simply omits the option and
 * falls back to the module-level STORAGE_ROOT (production behavior).
 */

import type { Artifact, AuditEntry, Proposal } from '@rdma/core';
import { ProposalNotFoundError } from '@rdma/core';
import { STORAGE_ROOT, buildDeps } from './run.js';

export interface InspectOptions {
  storageRoot?: string;
}

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
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

interface ParsedAuditEntry {
  id?: string;
  proposalId?: string;
  actor?: string;
  action?: string;
  at?: string;
  detail?: Record<string, unknown>;
}

function parseAuditLine(line: string): ParsedAuditEntry | null {
  try {
    return JSON.parse(line) as ParsedAuditEntry;
  } catch {
    return null;
  }
}

function timestamp(iso: string | undefined): string {
  if (!iso) return '?';
  // ISO 8601 → compact "YYYY-MM-DD HH:MM:SS"
  return iso.slice(0, 19).replace('T', ' ');
}

export interface InspectData {
  proposal: Proposal;
  handoffChain: ReadonlyArray<string>;
  artifacts: ReadonlyArray<Artifact>;
  auditTimeline: ReadonlyArray<AuditTimelineEntry>;
}

export interface AuditTimelineEntry {
  at: string | undefined;
  actor: string | undefined;
  kind: string;
  stage: string;
  action: string | undefined;
  parseable: boolean;
  raw: string;
}

/**
 * Build a structured inspect view for the given proposal. Used by both
 * the `rdma inspect` CLI (printed as text) and the `GET /inspect/:id`
 * HTTP endpoint (returned as JSON). Tolerates an unparseable audit line
 * by recording it as a `parseable: false` row in the timeline.
 */
export async function buildInspectData(
  id: string,
  opts: InspectOptions = {},
): Promise<InspectData> {
  if (!id) {
    throw new Error('Usage: rdma inspect <proposal-id>');
  }
  const root = opts.storageRoot ?? STORAGE_ROOT;
  const { storage, audit } = await buildDeps(root);
  let proposal: Proposal;
  try {
    proposal = await storage.getProposal(id);
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      throw new Error(`Proposal ${id} not found in storage`, { cause: err });
    }
    throw err;
  }
  const lines = await storage.readAudit(proposal.id, proposal.projectId);
  const chain = await audit.handoffChain(proposal.id, proposal.projectId);
  const timeline: AuditTimelineEntry[] = lines.map((line) => {
    const entry = parseAuditLine(line);
    if (!entry) {
      return {
        at: undefined,
        actor: undefined,
        kind: '[unparseable]',
        stage: '',
        action: undefined,
        parseable: false,
        raw: line.slice(0, 80),
      };
    }
    const kind =
      entry.detail && typeof entry.detail.kind === 'string'
        ? String(entry.detail.kind)
        : (entry.action ?? '?');
    const stage =
      entry.detail && typeof entry.detail.stage === 'string' ? String(entry.detail.stage) : '';
    return {
      at: entry.at,
      actor: entry.actor,
      kind,
      stage,
      action: entry.action,
      parseable: true,
      raw: '',
    };
  });
  return {
    proposal,
    handoffChain: chain,
    artifacts: proposal.artifacts,
    auditTimeline: timeline,
  };
}

export async function cmdInspect(argv: string[], opts: InspectOptions = {}): Promise<void> {
  const { positional } = parseArgs(argv);
  const id = positional[0];
  const data = await buildInspectData(id ?? '', opts);
  const { proposal, handoffChain, artifacts, auditTimeline } = data;
  console.log(`Proposal ${proposal.id}`);
  console.log(`  title:        ${proposal.title}`);
  console.log(`  project:      ${proposal.projectId}`);
  console.log(`  status:       ${proposal.status}`);
  console.log(`  created:      ${timestamp(proposal.createdAt)}`);
  console.log(`  updated:      ${timestamp(proposal.updatedAt)}`);
  console.log(`  artifacts:    ${artifacts.length}`);
  console.log(`  handoff chain: ${handoffChain.join(' → ') || '(empty)'}`);
  console.log();
  console.log(`Artifacts (${artifacts.length}):`);
  if (artifacts.length === 0) {
    console.log('  (none)');
  } else {
    for (const a of artifacts) {
      console.log(
        `  [${timestamp(a.createdAt)}] ${a.kind.padEnd(22)} by ${a.agentId.padEnd(16)} — ${a.summary}`,
      );
    }
  }
  console.log();
  console.log(`Audit timeline (${auditTimeline.length} entries):`);
  if (auditTimeline.length === 0) {
    console.log('  (empty)');
    return;
  }
  for (const entry of auditTimeline) {
    if (!entry.parseable) {
      console.log(`  [unparseable] ${entry.raw}`);
      continue;
    }
    console.log(
      `  [${timestamp(entry.at)}] ${(entry.actor ?? '?').padEnd(16)} ${entry.kind.padEnd(28)} ${entry.stage.padEnd(26)} ${entry.action ?? ''}`,
    );
  }
}

export interface EventRow {
  proposalId: string;
  kind: string;
  at: string | undefined;
  payload: Record<string, unknown>;
  parseable: boolean;
}

export interface EventsData {
  count: number;
  events: ReadonlyArray<EventRow>;
  proposalFilter: string | null;
  proposalNotFound: boolean;
}

/**
 * Build a structured event stream across all proposals (or one if
 * `proposalId` is given). Reads the audit log from storage, so the
 * stream survives a daemon restart. The `sinceSeq` argument lets
 * callers resume from a known offset; the `limit` argument caps
 * the response size.
 */
export async function buildEventsData(
  proposalId: string | undefined,
  limit: number,
  sinceSeq: number,
  opts: InspectOptions = {},
): Promise<EventsData> {
  if (Number.isNaN(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer');
  }
  if (Number.isNaN(sinceSeq) || sinceSeq < 0) {
    throw new Error('--since-seq must be a non-negative integer');
  }
  const root = opts.storageRoot ?? STORAGE_ROOT;
  const { storage } = await buildDeps(root);
  let proposals: ReadonlyArray<Proposal>;
  let proposalNotFound = false;
  if (proposalId) {
    try {
      proposals = [await storage.getProposal(proposalId)];
    } catch (err) {
      if (err instanceof ProposalNotFoundError) {
        proposals = [];
        proposalNotFound = true;
      } else {
        throw err;
      }
    }
  } else {
    proposals = await storage.listProposals();
  }

  const rows: EventRow[] = [];
  for (const p of proposals) {
    const lines = await storage.readAudit(p.id, p.projectId);
    for (const line of lines) {
      const entry = parseAuditLine(line);
      if (!entry) {
        rows.push({
          proposalId: p.id,
          kind: 'unparseable',
          at: undefined,
          payload: { raw: line.slice(0, 80) },
          parseable: false,
        });
        continue;
      }
      const kind =
        entry.detail && typeof entry.detail.kind === 'string'
          ? String(entry.detail.kind)
          : (entry.action ?? 'unknown');
      rows.push({
        proposalId: p.id,
        kind,
        at: entry.at,
        payload: entry.detail ?? {},
        parseable: true,
      });
    }
  }

  rows.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  const filtered = sinceSeq > 0 ? rows.slice(sinceSeq) : rows;
  const limited = filtered.slice(0, limit);

  return {
    count: limited.length,
    events: limited,
    proposalFilter: proposalId ?? null,
    proposalNotFound,
  };
}

export async function cmdEvents(argv: string[], opts: InspectOptions = {}): Promise<void> {
  const { flags } = parseArgs(argv);
  const proposalFilter =
    typeof flags.proposal === 'string' ? (flags.proposal as string) : undefined;
  const limit = typeof flags.limit === 'string' ? Number(flags.limit) : 50;
  const sinceSeq = typeof flags['since-seq'] === 'string' ? Number(flags['since-seq']) : 0;

  const {
    count,
    events,
    proposalFilter: filter,
    proposalNotFound,
  } = await buildEventsData(proposalFilter, limit, sinceSeq, opts);

  if (proposalNotFound) {
    console.log(`Proposal ${filter} not found`);
    return;
  }
  console.log(`${count} event(s)${filter ? ` for ${filter}` : ''}:`);
  if (count === 0) {
    console.log('  (none)');
    return;
  }
  let n = sinceSeq;
  for (const row of events) {
    n++;
    console.log(
      `  #${String(n).padStart(4)}  [${timestamp(row.at)}]  ${row.proposalId.padEnd(18)}  ${row.kind.padEnd(28)}  ${JSON.stringify(row.payload)}`,
    );
  }
}
