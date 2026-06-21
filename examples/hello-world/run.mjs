/**
 * Hello-world example — run a single requirement through every agent.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBossAgent } from '@rdma/boss';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { AgentRegistry, AuditLog, Storage } from '@rdma/core';
import { createDesignerAgent } from '@rdma/designer';
import { createDevAgent } from '@rdma/dev';
import { createPmAgent } from '@rdma/pm';
import { createQaAgent } from '@rdma/qa';
import { createResearchAgent } from '@rdma/research';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Walk up to the monorepo root (3 levels: hello-world → examples → repo root)
const repoRoot = path.resolve(__dirname, '..', '..');
const storageRoot = path.join(repoRoot, '.rdma', 'data');

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
registry.register(
  createBossAgent({
    shippedRoot: path.join(repoRoot, '.rdma', 'shipped'),
  }),
);

const pipeline = new Pipeline({ registry, storage, audit });

const title = 'JSON to CSV CLI';
const requirement = 'Build me a CLI that converts a JSON array of objects to CSV.';

console.log(`→ ${title}`);
const proposal = await pipeline.createProposal({ title, rawRequirement: requirement });
const final = await pipeline.runToCompletion(proposal);
const chain = await audit.handoffChain(final.id, final.projectId);

console.log(
  `   ${final.id}  status=${final.status}  chain=${chain.join(' → ')}  artifacts=${final.artifacts.length}`,
);

console.log('\nArtifacts:');
for (const a of final.artifacts) {
  console.log(`  - ${a.kind.padEnd(22)} ${a.agentId.padEnd(16)} ${a.summary}`);
}

console.log('\nDeployment record:');
console.log(`  .rdma/shipped/${final.projectId}/${final.id}.json`);

console.log('\nNext: inspect with');
console.log(`  npm run cli -- show ${final.id}`);
