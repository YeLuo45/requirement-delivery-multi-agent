#!/usr/bin/env node
/**
 * Seed demo data into .rdma/data/ for the public web dashboard.
 *
 * When the web dashboard is deployed to GitHub Pages, there's no real
 * `.rdma/` directory on the production server. This script generates a
 * self-contained demo dataset under packages/rdma-web/public/demo-data/
 * that the deployed app can fetch as a fallback.
 *
 * Usage:
 *   node scripts/seed-demo-data.mjs           # regenerate demo data
 *   node scripts/seed-demo-data.mjs --clean   # delete demo data
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const demoDir = path.join(projectRoot, 'packages', 'rdma-web', 'public', 'demo-data');

const PROPOSALS = [
  {
    id: 'P-20260615-001',
    projectId: 'PRJ-20260615-001',
    title: 'JSON to CSV CLI',
    rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
    status: 'delivered',
    owner: 'boss',
    clarificationRound: 1,
    createdAt: '2026-06-15T09:12:00Z',
    updatedAt: '2026-06-15T09:13:42Z',
    tags: { priority: 'P2', scope: 'small' },
    artifacts: [
      {
        id: 'art-rb-001',
        kind: 'requirement_brief',
        agentId: 'market_research',
        createdAt: '2026-06-15T09:12:05Z',
        summary: 'Brief: JSON to CSV CLI (3 similar projects)',
        content: `# Requirement Brief: JSON to CSV CLI

## Restatement
Build me a CLI that converts a JSON array of objects to CSV.

## Similar open-source projects
- [flatjson](https://github.com/flatjson/flatjson) — Flat JSON to CSV converter (Node)
- [d3-dsv](https://github.com/d3/d3-dsv) — CSV / TSV parser and formatter (d3)
- [csv-parser](https://github.com/mafintosh/csv-parser) — Streaming CSV parser for Node

## Candidate decomposition angles
1. Minimum viable slice: a single-file CLI that handles the common case.
2. Library-first path: ship a \`convert()\` function plus a thin CLI wrapper.
3. Streaming path: handle large inputs without loading everything in memory.

## Risk register
- Ambiguity in input format — what schemas count as "valid"?
- Edge cases: empty arrays, nested objects, mixed types in arrays.
- Output CSV escaping for fields containing commas / quotes / newlines.`,
      },
      {
        id: 'art-prd-001',
        kind: 'prd',
        agentId: 'pm',
        createdAt: '2026-06-15T09:12:30Z',
        summary: 'PRD: JSON to CSV CLI',
        content: `# PRD: JSON to CSV CLI

## Problem
Convert a JSON array of objects to CSV.

## Goals
- Single-file CLI that takes JSON from stdin / file and writes CSV to stdout.
- Handles the common edge cases (empty arrays, special characters).
- Composable as a library + a thin CLI wrapper.

## Non-goals
- Multi-tenant / multi-user support.
- Production-grade observability.

## User stories
- As a user, I can run \`json2csv input.json > output.csv\` and get valid CSV.
- As a user, I see clear errors when my input is invalid.
- As a maintainer, I can extend the CLI without rewriting the core.

## Acceptance criteria
1. The artifact compiles cleanly from a fresh clone.
2. A smoke test (provided in the implementation) passes.
3. Edge cases listed in the risk register are handled.
4. README covers installation, usage, and one example.`,
      },
      {
        id: 'art-impl-001',
        kind: 'implementation',
        agentId: 'dev',
        createdAt: '2026-06-15T09:13:20Z',
        summary: 'Implementation for JSON to CSV CLI',
        content: `// src/convert.ts
export function jsonToCsv(input: unknown): string {
  if (!Array.isArray(input)) throw new Error('expected an array of objects');
  if (input.length === 0) return '';
  const headers = Object.keys(input[0] as Record<string, unknown>);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = input.map((row) =>
    headers.map((h) => escape((row as Record<string, unknown>)[h])).join(','),
  );
  return [headers.join(','), ...rows].join('\\n');
}`,
      },
    ],
  },
  {
    id: 'P-20260616-001',
    projectId: 'PRJ-20260616-001',
    title: 'Markdown linter',
    rawRequirement: 'Build a markdown linter that catches broken links and inconsistent heading levels.',
    status: 'in_dev',
    owner: 'dev',
    clarificationRound: 2,
    createdAt: '2026-06-16T14:22:00Z',
    updatedAt: '2026-06-16T14:24:10Z',
    tags: { priority: 'P3', scope: 'small' },
    artifacts: [
      {
        id: 'art-rb-002',
        kind: 'requirement_brief',
        agentId: 'market_research',
        createdAt: '2026-06-16T14:22:08Z',
        summary: 'Brief: Markdown linter',
        content: '# Requirement Brief: Markdown linter\n\n## Similar projects\n- [markdownlint](https://github.com/DavidAnson/markdownlint) — Reference Node linter\n- [remark](https://github.com/remarkjs/remark) — Pluggable markdown processor\n\n## Decomposition\n1. Parse with remark.\n2. Walk AST for heading levels + links.\n3. Report issues as a CLI summary.',
      },
      {
        id: 'art-prd-002',
        kind: 'prd',
        agentId: 'pm',
        createdAt: '2026-06-16T14:23:00Z',
        summary: 'PRD: Markdown linter',
        content: '# PRD: Markdown linter\n\n## Acceptance criteria\n1. Detects heading level skips (h1 → h3).\n2. Detects broken relative links.\n3. Outputs a clear report grouped by file.',
      },
    ],
  },
  {
    id: 'P-20260617-001',
    projectId: 'PRJ-20260617-001',
    title: 'Web app for tracking daily reading',
    rawRequirement: 'Build me a clean web UI for tracking daily reading progress with streaks.',
    status: 'delivered',
    owner: 'boss',
    clarificationRound: 1,
    createdAt: '2026-06-17T11:05:00Z',
    updatedAt: '2026-06-17T11:08:55Z',
    tags: { priority: 'P1', scope: 'medium' },
    artifacts: [
      {
        id: 'art-ds-001',
        kind: 'design_spec',
        agentId: 'designer',
        createdAt: '2026-06-17T11:05:40Z',
        summary: 'UI/UX spec for reading tracker',
        content: '# UI/UX Spec: Reading tracker\n\n## Layout\n- Centered container, max-width 960px\n- Header with current streak badge\n- Body: today + history list\n- Footer: input form for new entry',
      },
      {
        id: 'art-prd-003',
        kind: 'prd',
        agentId: 'pm',
        createdAt: '2026-06-17T11:06:30Z',
        summary: 'PRD: Reading tracker',
        content: '# PRD: Reading tracker\n\n## Goals\n- Daily entry form (book title, minutes, page count)\n- Streak counter\n- LocalStorage persistence',
      },
      {
        id: 'art-impl-002',
        kind: 'implementation',
        agentId: 'dev',
        createdAt: '2026-06-17T11:08:20Z',
        summary: 'Implementation for reading tracker',
        content: '// Single-file React app with useReducer + localStorage.',
      },
    ],
  },
  {
    id: 'P-20260618-001',
    projectId: 'PRJ-20260618-001',
    title: 'WebSocket chat server',
    rawRequirement: 'Build a minimal WebSocket chat server with rooms and message history.',
    status: 'test_failed',
    owner: 'qa',
    clarificationRound: 1,
    createdAt: '2026-06-18T16:30:00Z',
    updatedAt: '2026-06-18T16:35:12Z',
    tags: { priority: 'P2', scope: 'medium' },
    artifacts: [
      {
        id: 'art-prd-004',
        kind: 'prd',
        agentId: 'pm',
        createdAt: '2026-06-18T16:31:00Z',
        summary: 'PRD: WebSocket chat server',
        content: '# PRD: WebSocket chat server\n\n## Acceptance criteria\n1. Multiple rooms supported.\n2. Last 50 messages shown on join.\n3. Rate-limited to 5 msg/sec per connection.',
      },
      {
        id: 'art-impl-003',
        kind: 'implementation',
        agentId: 'dev',
        createdAt: '2026-06-18T16:34:00Z',
        summary: 'Implementation for WebSocket chat',
        content: '// ws + Node — room registry, message history ring buffer.',
      },
      {
        id: 'art-qa-001',
        kind: 'test_report',
        agentId: 'qa',
        createdAt: '2026-06-18T16:35:12Z',
        summary: 'QA FAIL: WebSocket chat server',
        content: '# QA acceptance report: WebSocket chat server\n\n## Result: FAIL\n\n## Checks\n- [ ] Room creation\n- [ ] Message history persists\n- [ ] Rate limiting enforced\n\n## Action required\nOne or more acceptance checks failed. Routing to test_failed stage.',
      },
    ],
  },
];

const AUDIT_LOG = {
  'PRJ-20260615-001': [
    { id: 'au-001', proposalId: 'P-20260615-001', actor: 'system', action: 'proposal.create', at: '2026-06-15T09:12:00Z', detail: { title: 'JSON to CSV CLI', status: 'research_direction_pending' } },
    { id: 'au-002', proposalId: 'P-20260615-001', actor: 'market_research', action: 'stage.transition', at: '2026-06-15T09:12:05Z', detail: { from: 'research_direction_pending', to: 'research', reason: 'Research direction approved' } },
    { id: 'au-003', proposalId: 'P-20260615-001', actor: 'market_research', action: 'handoff.emit', at: '2026-06-15T09:12:08Z', detail: { to: 'coordinator', reason: 'Research complete' } },
    { id: 'au-004', proposalId: 'P-20260615-001', actor: 'coordinator', action: 'handoff.emit', at: '2026-06-15T09:12:20Z', detail: { to: 'pm', reason: 'Captured intent; routing to PM' } },
    { id: 'au-005', proposalId: 'P-20260615-001', actor: 'pm', action: 'stage.transition', at: '2026-06-15T09:12:30Z', detail: { from: 'clarifying', to: 'prd_pending_confirmation', reason: 'PRD drafted' } },
    { id: 'au-006', proposalId: 'P-20260615-001', actor: 'pm', action: 'stage.transition', at: '2026-06-15T09:12:50Z', detail: { from: 'prd_pending_confirmation', to: 'approved_for_dev', reason: 'PRD auto-approved' } },
    { id: 'au-007', proposalId: 'P-20260615-001', actor: 'pm', action: 'handoff.emit', at: '2026-06-15T09:13:00Z', detail: { to: 'dev', reason: 'PRD approved; handing off' } },
    { id: 'au-008', proposalId: 'P-20260615-001', actor: 'dev', action: 'stage.transition', at: '2026-06-15T09:13:10Z', detail: { from: 'in_tdd_test', to: 'in_dev', reason: 'Tests designed' } },
    { id: 'au-009', proposalId: 'P-20260615-001', actor: 'dev', action: 'handoff.emit', at: '2026-06-15T09:13:25Z', detail: { to: 'qa', reason: 'Implementation complete' } },
    { id: 'au-010', proposalId: 'P-20260615-001', actor: 'qa', action: 'handoff.emit', at: '2026-06-15T09:13:30Z', detail: { to: 'boss', reason: 'Acceptance checks passed' } },
    { id: 'au-011', proposalId: 'P-20260615-001', actor: 'boss', action: 'stage.transition', at: '2026-06-15T09:13:35Z', detail: { from: 'accepted', to: 'deployed', reason: 'Boss accepted' } },
    { id: 'au-012', proposalId: 'P-20260615-001', actor: 'boss', action: 'stage.transition', at: '2026-06-15T09:13:42Z', detail: { from: 'deployed', to: 'delivered', reason: 'Deployment record written' } },
  ],
  'PRJ-20260616-001': [
    { id: 'au-101', proposalId: 'P-20260616-001', actor: 'system', action: 'proposal.create', at: '2026-06-16T14:22:00Z', detail: { title: 'Markdown linter', status: 'research_direction_pending' } },
    { id: 'au-102', proposalId: 'P-20260616-001', actor: 'market_research', action: 'stage.transition', at: '2026-06-16T14:22:08Z', detail: { from: 'research_direction_pending', to: 'research', reason: 'approved' } },
    { id: 'au-103', proposalId: 'P-20260616-001', actor: 'coordinator', action: 'handoff.emit', at: '2026-06-16T14:22:30Z', detail: { to: 'pm', reason: 'captured' } },
    { id: 'au-104', proposalId: 'P-20260616-001', actor: 'pm', action: 'stage.transition', at: '2026-06-16T14:23:00Z', detail: { from: 'clarifying', to: 'prd_pending_confirmation', reason: 'PRD drafted (round 1)' } },
    { id: 'au-105', proposalId: 'P-20260616-001', actor: 'pm', action: 'stage.transition', at: '2026-06-16T14:23:30Z', detail: { from: 'prd_pending_confirmation', to: 'clarifying', reason: 'Boss asked for revisions (round 2)' } },
    { id: 'au-106', proposalId: 'P-20260616-001', actor: 'pm', action: 'stage.transition', at: '2026-06-16T14:24:00Z', detail: { from: 'clarifying', to: 'prd_pending_confirmation', reason: 'PRD re-drafted' } },
    { id: 'au-107', proposalId: 'P-20260616-001', actor: 'pm', action: 'handoff.emit', at: '2026-06-16T14:24:10Z', detail: { to: 'dev', reason: 'PRD approved' } },
  ],
  'PRJ-20260617-001': [
    { id: 'au-201', proposalId: 'P-20260617-001', actor: 'system', action: 'proposal.create', at: '2026-06-17T11:05:00Z', detail: { title: 'Web app for tracking daily reading' } },
    { id: 'au-202', proposalId: 'P-20260617-001', actor: 'market_research', action: 'stage.transition', at: '2026-06-17T11:05:30Z', detail: { from: 'research_direction_pending', to: 'research' } },
    { id: 'au-203', proposalId: 'P-20260617-001', actor: 'coordinator', action: 'handoff.emit', at: '2026-06-17T11:05:40Z', detail: { to: 'designer', reason: 'UI work detected' } },
    { id: 'au-204', proposalId: 'P-20260617-001', actor: 'designer', action: 'handoff.emit', at: '2026-06-17T11:06:00Z', detail: { to: 'pm', reason: 'UI spec drafted' } },
    { id: 'au-205', proposalId: 'P-20260617-001', actor: 'pm', action: 'handoff.emit', at: '2026-06-17T11:07:00Z', detail: { to: 'dev', reason: 'PRD approved' } },
    { id: 'au-206', proposalId: 'P-20260617-001', actor: 'dev', action: 'handoff.emit', at: '2026-06-17T11:08:00Z', detail: { to: 'qa', reason: 'Implementation complete' } },
    { id: 'au-207', proposalId: 'P-20260617-001', actor: 'qa', action: 'handoff.emit', at: '2026-06-17T11:08:30Z', detail: { to: 'boss', reason: 'Acceptance passed' } },
    { id: 'au-208', proposalId: 'P-20260617-001', actor: 'boss', action: 'stage.transition', at: '2026-06-17T11:08:55Z', detail: { from: 'deployed', to: 'delivered' } },
  ],
  'PRJ-20260618-001': [
    { id: 'au-301', proposalId: 'P-20260618-001', actor: 'system', action: 'proposal.create', at: '2026-06-18T16:30:00Z', detail: { title: 'WebSocket chat server' } },
    { id: 'au-302', proposalId: 'P-20260618-001', actor: 'market_research', action: 'stage.transition', at: '2026-06-18T16:30:30Z', detail: { from: 'research_direction_pending', to: 'research' } },
    { id: 'au-303', proposalId: 'P-20260618-001', actor: 'coordinator', action: 'handoff.emit', at: '2026-06-18T16:31:00Z', detail: { to: 'pm', reason: 'captured' } },
    { id: 'au-304', proposalId: 'P-20260618-001', actor: 'pm', action: 'handoff.emit', at: '2026-06-18T16:34:00Z', detail: { to: 'dev', reason: 'PRD approved' } },
    { id: 'au-305', proposalId: 'P-20260618-001', actor: 'dev', action: 'handoff.emit', at: '2026-06-18T16:34:30Z', detail: { to: 'qa', reason: 'Implementation complete' } },
    { id: 'au-306', proposalId: 'P-20260618-001', actor: 'qa', action: 'qa.failure', at: '2026-06-18T16:35:00Z', detail: { reason: '2 acceptance checks failed' } },
    { id: 'au-307', proposalId: 'P-20260618-001', actor: 'qa', action: 'stage.transition', at: '2026-06-18T16:35:12Z', detail: { from: 'in_test_acceptance', to: 'test_failed', reason: 'Routing to test_failed stage' } },
  ],
};

const HANDOFF_CHAINS = {
  'P-20260615-001': ['market_research', 'coordinator', 'pm', 'dev', 'qa', 'boss'],
  'P-20260616-001': ['market_research', 'coordinator', 'pm', 'dev'],
  'P-20260617-001': ['market_research', 'coordinator', 'designer', 'pm', 'dev', 'qa', 'boss'],
  'P-20260618-001': ['market_research', 'coordinator', 'pm', 'dev', 'qa'],
};

async function main() {
  const clean = process.argv.includes('--clean');
  if (clean) {
    await fs.rm(demoDir, { recursive: true, force: true });
    console.log(`Wiped ${demoDir}`);
    return;
  }

  await fs.mkdir(demoDir, { recursive: true });
  await fs.writeFile(
    path.join(demoDir, 'proposals.json'),
    JSON.stringify(PROPOSALS, null, 2),
  );

  const detailsDir = path.join(demoDir, 'details');
  await fs.mkdir(detailsDir, { recursive: true });
  for (const proposal of PROPOSALS) {
    const detail = {
      proposal,
      audit: AUDIT_LOG[proposal.projectId] ?? [],
      handoffChain: HANDOFF_CHAINS[proposal.id] ?? [],
    };
    await fs.writeFile(
      path.join(detailsDir, `${proposal.id}.json`),
      JSON.stringify(detail, null, 2),
    );
  }

  console.log(`Wrote demo data to ${demoDir}`);
  console.log(`  - ${PROPOSALS.length} proposals`);
  console.log(`  - ${Object.keys(AUDIT_LOG).length} audit logs`);
  console.log(`  - ${PROPOSALS.length} detail files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});