/**
 * `rdma diff <id-a> <id-b>` — compare two proposals and print what
 * changed between them.
 *
 * The diff focuses on the parts a human reviewing a PR cares about:
 *   - the artifact timeline (which kinds each proposal produced, in
 *     what order)
 *   - the stage timeline (when did each proposal advance)
 *   - the artifact content (textual diff via `unifiedDiff()`)
 *
 * Pure: takes two `InspectData` payloads and returns a structured
 * diff that the CLI can render as text. Tests cover the diff logic
 * without a real StorageDriver.
 */

import { type InspectData, buildInspectData } from './inspect.js';

export interface ArtifactDiff {
  /** Kinds present in A but missing in B. */
  onlyA: string[];
  /** Kinds present in B but missing in A. */
  onlyB: string[];
  /** Kinds present in both, paired by their index in each proposal. */
  common: Array<{
    kind: string;
    summaryA: string;
    summaryB: string;
    contentDiff: string;
    patch: string;
  }>;
}

export interface StageDiff {
  /** True if the proposals reached different terminal stages. */
  differentTerminal: boolean;
  /** Stage timeline for A (ordered). */
  stagesA: string[];
  /** Stage timeline for B (ordered). */
  stagesB: string[];
}

export interface ProposalDiff {
  proposalA: { id: string; status: string; projectId: string };
  proposalB: { id: string; status: string; projectId: string };
  artifacts: ArtifactDiff;
  stages: StageDiff;
  /** Plain-text summary, ready to print to the terminal. */
  textReport: string;
  /** Unified diff suitable for `git apply`. Empty if no changes. */
  patchReport: string;
}

function pairArtifacts(a: InspectData, b: InspectData): ArtifactDiff {
  const kindsA = a.artifacts.map((x) => x.kind);
  const kindsB = b.artifacts.map((x) => x.kind);
  const setA = new Set(kindsA);
  const setB = new Set(kindsB);
  const onlyA = kindsA.filter((k) => !setB.has(k));
  const onlyB = kindsB.filter((k) => !setA.has(k));
  const common: ArtifactDiff['common'] = [];
  for (let i = 0; i < a.artifacts.length; i++) {
    const left = a.artifacts[i];
    if (!left) continue;
    if (setB.has(left.kind)) {
      const right = b.artifacts.find((x) => x.kind === left.kind);
      const leftText = `${left.summary}\n${left.content}`;
      const rightText = `${right?.summary ?? ''}\n${right?.content ?? ''}`;
      common.push({
        kind: left.kind,
        summaryA: left.summary,
        summaryB: right?.summary ?? '',
        contentDiff: lineDiff(leftText, rightText),
        patch: unifiedDiff(`a/${left.kind}.txt`, `b/${left.kind}.txt`, leftText, rightText),
      });
    }
  }
  return { onlyA, onlyB, common };
}

function pairStages(a: InspectData, b: InspectData): StageDiff {
  return {
    differentTerminal: a.proposal.status !== b.proposal.status,
    stagesA: stagesFromTimeline(a.auditTimeline),
    stagesB: stagesFromTimeline(b.auditTimeline),
  };
}

function stagesFromTimeline(timeline: InspectData['auditTimeline']): string[] {
  const seen: string[] = [];
  for (const entry of timeline) {
    if (!entry.parseable) continue;
    const stage = entry.stage;
    if (!stage) continue;
    if (seen[seen.length - 1] !== stage) seen.push(stage);
  }
  return seen;
}

/**
 * Naive line-by-line diff. Returns a human-readable unified-style
 * output (`- removed` / `+ added` markers). For a real PR diff the
 * CLI uses `unifiedDiff()`; this stays around because it's a tiny
 * helper and its tests pin the behavior.
 */
export function lineDiff(left: string, right: string): string {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const max = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const a = leftLines[i] ?? '';
    const b = rightLines[i] ?? '';
    if (a === b) {
      if (a.length > 0) out.push(`  ${a}`);
    } else {
      if (a.length > 0) out.push(`- ${a}`);
      if (b.length > 0) out.push(`+ ${b}`);
    }
  }
  return out.join('\n');
}

/**
 * Unified-diff formatter. Produces a string suitable for `git
 * apply` when handed a series of patches. The algorithm is a
 * standard LCS (longest common subsequence) based diff — not
 * optimal, but readable and zero-dep. For a few hundred lines per
 * artifact this is more than fast enough.
 */
export function unifiedDiff(
  leftLabel: string,
  rightLabel: string,
  left: string,
  right: string,
  contextLines = 3,
): string {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const lcs = computeLcs(leftLines, rightLines);
  const hunks = buildHunks(leftLines, rightLines, lcs, contextLines);
  if (hunks.length === 0) return '';
  const out: string[] = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  for (const hunk of hunks) {
    out.push(`@@ -${hunk.leftStart},${hunk.leftLen} +${hunk.rightStart},${hunk.rightLen} @@`);
    out.push(...hunk.body);
  }
  return out.join('\n');
}

interface DiffHunk {
  leftStart: number;
  leftLen: number;
  rightStart: number;
  rightLen: number;
  body: string[];
}

function computeLcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = (dp[i + 1][j + 1] ?? 0) + 1;
      } else {
        const down = dp[i + 1]?.[j] ?? 0;
        const right = dp[i]?.[j + 1] ?? 0;
        dp[i][j] = Math.max(down, right);
      }
    }
  }
  return dp;
}

function buildHunks(left: string[], right: string[], lcs: number[][], context: number): DiffHunk[] {
  const ops: Array<{ kind: 'eq' | 'del' | 'add'; line: string; aIdx: number; bIdx: number }> = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({ kind: 'eq', line: left[i] ?? '', aIdx: i, bIdx: j });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      ops.push({ kind: 'del', line: left[i] ?? '', aIdx: i, bIdx: j });
      i++;
    } else {
      ops.push({ kind: 'add', line: right[j] ?? '', aIdx: i, bIdx: j });
      j++;
    }
  }
  while (i < left.length) {
    ops.push({ kind: 'del', line: left[i] ?? '', aIdx: i, bIdx: j });
    i++;
  }
  while (j < right.length) {
    ops.push({ kind: 'add', line: right[j] ?? '', aIdx: i, bIdx: j });
    j++;
  }
  // Identify change ranges: maximal consecutive runs of non-eq
  // ops. Each change range becomes a "core" inside a hunk.
  // Walk ops; for each non-eq range, expand `context` equal lines
  // on each side. Merge two ranges into one hunk if the equal
  // gap between them is `<= 2 * context` lines.
  const changes: Array<{ start: number; end: number }> = [];
  let p = 0;
  while (p < ops.length) {
    if (ops[p]?.kind === 'eq') {
      p++;
      continue;
    }
    const start = p;
    while (p < ops.length && ops[p]?.kind !== 'eq') p++;
    changes.push({ start, end: p });
  }
  if (changes.length === 0) return [];
  // Group adjacent changes whose equal gap is <= 2*context.
  const groups: Array<{ start: number; end: number }>[] = [];
  let groupStart = changes[0]?.start ?? 0;
  let groupEnd = changes[0]?.end ?? 0;
  for (let k = 1; k < changes.length; k++) {
    const prev = changes[k - 1];
    const cur = changes[k];
    if (!prev || !cur) break;
    const gap = cur.start - prev.end; // number of equal ops between
    if (gap <= 2 * context) {
      groupEnd = cur.end;
    } else {
      groups.push({ start: groupStart, end: groupEnd });
      groupStart = cur.start;
      groupEnd = cur.end;
    }
  }
  groups.push({ start: groupStart, end: groupEnd });
  // Build a hunk for each group, expanding by `context` equal
  // lines on each side, but never overlapping with the previous
  // hunk's trailing context.
  const hunks: DiffHunk[] = [];
  let cursor = 0;
  for (const g of groups) {
    // Walk back up to `context` equal lines from g.start.
    let left = Math.max(cursor, g.start - context);
    // Walk forward up to `context` equal lines from g.end.
    const right = Math.min(ops.length, g.end + context);
    if (left < cursor) left = cursor; // never overlap
    const slice = ops.slice(left, right);
    const leftStart = (slice.find((o) => o.kind !== 'add')?.aIdx ?? left) + 1;
    const rightStart = (slice.find((o) => o.kind !== 'del')?.bIdx ?? left) + 1;
    const leftLen = slice.filter((o) => o.kind !== 'add').length;
    const rightLen = slice.filter((o) => o.kind !== 'del').length;
    const body: string[] = [];
    for (const op of slice) {
      if (op.kind === 'eq') body.push(` ${op.line}`);
      else if (op.kind === 'del') body.push(`-${op.line}`);
      else body.push(`+${op.line}`);
    }
    hunks.push({ leftStart, leftLen, rightStart, rightLen, body });
    cursor = right;
  }
  return hunks;
}

/**
 * Generate a multi-file patch from a structured diff. Each common
 * artifact kind becomes one file in the patch. The output is
 * suitable for `git apply` to apply A's → B's changes.
 */
export function buildArtifactPatch(a: InspectData, b: InspectData): string {
  const files: string[] = [];
  for (const c of pairArtifacts(a, b).common) {
    if (c.patch) files.push(c.patch);
  }
  if (files.length === 0) return '';
  return files.join('\n\n');
}

function buildTextReport(diff: Omit<ProposalDiff, 'textReport' | 'patchReport'>): string {
  const lines: string[] = [];
  lines.push(`Diff ${diff.proposalA.id} → ${diff.proposalB.id}`);
  lines.push('');
  lines.push(
    `Status: A=${diff.proposalA.status}  B=${diff.proposalB.status}${diff.stages.differentTerminal ? '  (different)' : '  (same)'}`,
  );
  if (diff.stages.differentTerminal) {
    lines.push(`  A stages: ${diff.stages.stagesA.join(' → ') || '(none)'}`);
    lines.push(`  B stages: ${diff.stages.stagesB.join(' → ') || '(none)'}`);
  }
  lines.push('');
  lines.push('Artifacts:');
  if (diff.artifacts.onlyA.length > 0) {
    lines.push(`  Only in A: ${diff.artifacts.onlyA.join(', ')}`);
  }
  if (diff.artifacts.onlyB.length > 0) {
    lines.push(`  Only in B: ${diff.artifacts.onlyB.join(', ')}`);
  }
  if (diff.artifacts.common.length > 0) {
    lines.push(`  Common kinds: ${diff.artifacts.common.map((c) => c.kind).join(', ')}`);
  }
  if (
    diff.artifacts.onlyA.length === 0 &&
    diff.artifacts.onlyB.length === 0 &&
    diff.artifacts.common.length === 0
  ) {
    lines.push('  (no artifacts)');
  }
  return lines.join('\n');
}

export function diffInspectData(a: InspectData, b: InspectData): ProposalDiff {
  const artifacts = pairArtifacts(a, b);
  const stages = pairStages(a, b);
  const diff: Omit<ProposalDiff, 'textReport' | 'patchReport'> = {
    proposalA: {
      id: a.proposal.id,
      status: a.proposal.status,
      projectId: a.proposal.projectId,
    },
    proposalB: {
      id: b.proposal.id,
      status: b.proposal.status,
      projectId: b.proposal.projectId,
    },
    artifacts,
    stages,
  };
  const textReport = buildTextReport(diff);
  const patchReport = buildArtifactPatch(a, b);
  return { ...diff, textReport, patchReport };
}

interface ParseArgsResult {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParseArgsResult {
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

/**
 * CLI entry point. Usage:
 *   rdma diff <id-a> <id-b>
 *   rdma diff <id-a> <id-b> --json
 *   rdma diff <id-a> <id-b> --format patch
 *
 * Pulls both proposals' inspect data, runs `diffInspectData`, then
 * prints either the human-readable report (default), a JSON dump
 * (for downstream tools), or a unified diff suitable for `git
 * apply`.
 */
export async function cmdDiff(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const a = positional[0];
  const b = positional[1];
  if (!a || !b) {
    console.error(
      'Usage: rdma diff <proposal-id-a> <proposal-id-b> [--format text|patch] [--json]',
    );
    process.exit(1);
  }
  const [aData, bData] = await Promise.all([buildInspectData(a), buildInspectData(b)]);
  const diff = diffInspectData(aData, bData);
  const format = (typeof flags.format === 'string' ? flags.format : 'text') as string;
  if (flags.json === true) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }
  if (format === 'patch') {
    if (diff.patchReport) {
      console.log(diff.patchReport);
    }
    return;
  }
  console.log(diff.textReport);
}
