#!/usr/bin/env node
/**
 * `scripts/check-node.mjs`
 *
 * Smoke check that the project's code runs on a specific Node major
 * version. Used by the matrix CI job (`test.yml`) and by developers
 * who want to spot-check compatibility locally without setting up
 * a multi-Node harness.
 *
 * The check is deliberately cheap (parse + import + run a single
 * noop span) so the matrix stays under a few minutes. The full
 * test suite still runs separately in the same matrix job.
 */

import { spawnSync } from 'node:child_process';
import { major } from './parse-version.js';

const want = process.argv[2] ?? '20';
const current = process.versions.node;
const currentMajor = major(current);

if (currentMajor !== Number(want)) {
  console.error(`[check-node] want Node ${want}, got Node ${current} (major ${currentMajor})`);
  process.exit(1);
}
console.log(`[check-node] running on Node ${current}`);

// Run a one-liner that imports a TS source file to confirm the
// strip-only + tsx pipeline works on this Node version.
const probe = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '-e',
    `import { diffInspectData } from './packages/rdma-cli/src/diff.ts'; ` +
      `import { DurableJournal } from './packages/rdma-persistence/src/durable-journal.ts'; ` +
      `import { createTracer, InMemoryExporter } from './packages/rdma-observability/src/index.ts'; ` +
      `const d = diffInspectData({proposal:{id:'P-1',projectId:'PRJ',title:'t',rawRequirement:'r',status:'delivered',owner:null,clarificationRound:0,tags:{},createdAt:'2026-06-20T00:00:00Z',updatedAt:'2026-06-20T00:00:00Z',artifacts:[]},handoffChain:[],artifacts:[],auditTimeline:[]},{proposal:{id:'P-2',projectId:'PRJ',title:'t',rawRequirement:'r',status:'delivered',owner:null,clarificationRound:0,tags:{},createdAt:'2026-06-20T00:00:00Z',updatedAt:'2026-06-20T00:00:00Z',artifacts:[]},handoffChain:[],artifacts:[],auditTimeline:[]}); ` +
      `console.log('diff ok', d.proposalA.id, '->', d.proposalB.id);`,
  ],
  { encoding: 'utf8' },
);

if (probe.status !== 0) {
  console.error(`[check-node] probe failed on Node ${current}:\n${probe.stderr}`);
  process.exit(probe.status ?? 1);
}
process.stdout.write(probe.stdout);
