/**
 * Bootstrap demo — drop a fresh sample requirement into the pipeline.
 * Use this after cloning the repo to verify the system works end-to-end.
 *
 * Usage:
 *   node scripts/bootstrap-demo.mjs
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentRegistry, AuditLog, Storage } from '@rdma/core';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { createResearchAgent } from '@rdma/research';
import { createDesignerAgent } from '@rdma/designer';
import { createPmAgent } from '@rdma/pm';
import { createDevAgent } from '@rdma/dev';
import { createQaAgent } from '@rdma/qa';
import { createBossAgent } from '@rdma/boss';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const storageRoot = path.join(projectRoot, '.rdma', 'data');
  await fs.mkdir(storageRoot, { recursive: true });
  const storage = new Storage({ root: storageRoot });
  await storage.init();

  const audit = new AuditLog(storage);

  const registry = new AgentRegistry();
  registry.register(createResearchAgent());
  registry.register(createCoordinatorAgent());
  registry.register(createDesignerAgent());
  registry.register(createPmAgent());
  registry.register(createDevAgent());
  registry.register(createQaAgent());
  registry.register(createBossAgent());

  const pipeline = new Pipeline({ registry, storage, audit });

  const samples = [
    {
      title: 'JSON to CSV CLI',
      rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
      tags: { priority: 'P2', scope: 'small' },
    },
    {
      title: 'Markdown linter',
      rawRequirement: 'Build a markdown linter that catches broken links and inconsistent heading levels.',
      tags: { priority: 'P3', scope: 'small' },
    },
    {
      title: 'Web app for tracking daily reading',
      rawRequirement: 'Build me a clean web UI for tracking daily reading progress with streaks.',
      tags: { priority: 'P1', scope: 'medium' },
    },
  ];

  for (const sample of samples) {
    console.log(`→ ${sample.title}`);
    const proposal = await pipeline.createProposal(sample);
    const final = await pipeline.runToCompletion(proposal);
    const chain = await audit.handoffChain(final.id, final.projectId);
    console.log(`   ${final.id}  status=${final.status}  chain=${chain.join(' → ')}  artifacts=${final.artifacts.length}`);
  }

  console.log('\nAll samples delivered. Inspect with:');
  console.log('  - npm run cli -- list');
  console.log('  - npm run cli -- show <proposal-id>');
  console.log('  - npm run dev:web');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});