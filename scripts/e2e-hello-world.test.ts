/**
 * End-to-end test: walk a real proposal through every agent.
 *
 * Scenario: a CLI that converts JSON to CSV.
 * Asserts that the pipeline:
 *   1. Creates a proposal at research_direction_pending
 *   2. Drives it through research → intake → clarifying → prd_pending → approved
 *      → in_tdd_test → in_dev → in_test_acceptance → accepted → deployed → delivered
 *   3. Writes one artifact per agent (requirement_brief, prd, plan, test_plan,
 *      implementation, test_report, deployment_record)
 *   4. Records a clean handoff chain in the audit log
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { AgentRegistry, type ArtifactKind, AuditLog, type Proposal, Storage } from '@rdma/core';

import { createBossAgent } from '@rdma/boss';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { createDesignerAgent } from '@rdma/designer';
import { createDevAgent } from '@rdma/dev';
import { createPmAgent } from '@rdma/pm';
import { createQaAgent } from '@rdma/qa';
import { createResearchAgent } from '@rdma/research';

function makeTmpRoot(): string {
  return path.join(tmpdir(), `rdma-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function buildRegistry(): AgentRegistry {
  const reg = new AgentRegistry();
  reg.register(createResearchAgent());
  reg.register(createCoordinatorAgent());
  reg.register(createDesignerAgent());
  reg.register(createPmAgent());
  reg.register(createDevAgent());
  reg.register(createQaAgent());
  reg.register(createBossAgent());
  return reg;
}

describe('e2e: JSON to CSV CLI', () => {
  let root: string;
  let storage: Storage;
  let audit: AuditLog;
  let pipeline: Pipeline;

  before(async () => {
    root = makeTmpRoot();
    storage = new Storage({ root });
    await storage.init();
    audit = new AuditLog(storage);
    pipeline = new Pipeline({ registry: buildRegistry(), storage, audit });
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('walks the proposal through every agent and lands on `delivered`', async () => {
    const initial = await pipeline.createProposal({
      title: 'JSON to CSV CLI',
      rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
      tags: { priority: 'P2', scope: 'small' },
    });

    assert.equal(initial.status, 'research_direction_pending');
    assert.match(initial.id, /^P-\d{8}-\d{3}$/);
    assert.match(initial.projectId, /^PRJ-\d{8}-\d{3}$/);

    const final = await pipeline.runToCompletion(initial);

    assert.equal(final.status, 'delivered', `expected delivered, got ${final.status}`);

    // 7 owned stages (excluding delivered) → expect one artifact per agent that
    // produces one, plus optional extra. Minimum count by design:
    //   research: requirement_brief
    //   coordinator: requirement_brief (intake form)
    //   designer: design_spec (only for UI work — skipped here)
    //   pm: prd + plan
    //   dev: test_plan + implementation
    //   qa: test_report
    //   boss: deployment_record
    const kinds = final.artifacts.map((a) => a.kind);
    assert.ok(kinds.includes('requirement_brief'), 'missing requirement_brief artifact');
    assert.ok(kinds.includes('prd'), 'missing prd artifact');
    assert.ok(kinds.includes('plan'), 'missing plan artifact');
    assert.ok(kinds.includes('test_plan'), 'missing test_plan artifact');
    assert.ok(kinds.includes('implementation'), 'missing implementation artifact');
    assert.ok(kinds.includes('test_report'), 'missing test_report artifact');
    assert.ok(kinds.includes('deployment_record'), 'missing deployment_record artifact');
  });

  it('reconstructs a clean handoff chain in the audit log', async () => {
    const proposals = await storage.listProposals();
    assert.equal(proposals.length, 1);
    const p = proposals[0];
    assert.ok(p, 'expected one proposal');
    const chain = await audit.handoffChain(p.id, p.projectId);
    // We expect: market_research, coordinator, pm, dev, qa, boss
    // (designer is skipped because the keyword scan decided this is non-UI work)
    assert.deepEqual(chain, ['market_research', 'coordinator', 'pm', 'dev', 'qa', 'boss']);
  });

  it('writes a deployment record to the shipped directory', async () => {
    const proposals = await storage.listProposals();
    const p = proposals[0];
    assert.ok(p, 'expected one proposal');
    const shippedDir = path.join(process.cwd(), '.rdma', 'shipped', p.projectId);
    const files = await fs.readdir(shippedDir);
    assert.ok(files.length > 0, 'no shipped files written');
    const record = JSON.parse(await fs.readFile(path.join(shippedDir, `${p.id}.json`), 'utf8'));
    assert.equal(record.proposalId, p.id);
    assert.equal(record.deployedFromStatus, 'accepted');
    await fs.rm(path.join(process.cwd(), '.rdma', 'shipped'), { recursive: true, force: true });
  });
});

describe('e2e: UI-bearing requirement routes through designer', () => {
  let root: string;
  let storage: Storage;
  let audit: AuditLog;
  let pipeline: Pipeline;

  before(async () => {
    root = makeTmpRoot();
    storage = new Storage({ root });
    await storage.init();
    audit = new AuditLog(storage);
    pipeline = new Pipeline({ registry: buildRegistry(), storage, audit });
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('routes through designer when the requirement mentions UI', async () => {
    const initial = await pipeline.createProposal({
      title: 'Web app for tracking habits',
      rawRequirement: 'Build me a web interface with a clean UI for tracking daily habits.',
    });
    const final = await pipeline.runToCompletion(initial);
    assert.equal(final.status, 'delivered');
    const chain = await audit.handoffChain(initial.id, initial.projectId);
    // Designer should appear in the chain for UI work
    assert.ok(chain.includes('designer'), `chain missing designer: ${chain.join(' → ')}`);
    // And a design_spec artifact should exist
    const kinds = final.artifacts.map((a) => a.kind);
    assert.ok(kinds.includes('design_spec'), 'missing design_spec artifact for UI work');
  });
});

describe('e2e: QA rework loop', () => {
  let root: string;
  let storage: Storage;
  let audit: AuditLog;
  let pipeline: Pipeline;
  const forceFailures = 0;

  before(async () => {
    root = makeTmpRoot();
    storage = new Storage({ root });
    await storage.init();
    audit = new AuditLog(storage);

    // Build a registry where QA fails the first test run, then passes.
    const reg = new AgentRegistry();
    reg.register(createResearchAgent());
    reg.register(createCoordinatorAgent());
    reg.register(createDesignerAgent());
    reg.register(createPmAgent());
    reg.register(createDevAgent());
    reg.register(
      createQaAgent({
        forceFailure: true,
      }),
    );
    reg.register(createBossAgent());

    // Patch: after one failure, the QA flag should clear so the next run passes.
    // The simplest way is to construct QA then mutate the closure variable.
    // Since we used `let forceFailure` inside the factory, we need a different
    // approach: re-create the registry with forceFailure: false after one cycle.
    pipeline = new Pipeline({ registry: reg, storage, audit });
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    void forceFailures;
  });

  it('walks the proposal and exercises the failure path once', async () => {
    const initial = await pipeline.createProposal({
      title: 'rework loop test',
      rawRequirement: 'verify that the rework loop works',
    });

    // Drive one step at a time so we can flip the QA flag mid-run.
    let p: Proposal = initial;
    let failedOnce = false;

    for (let i = 0; i < 50; i++) {
      if (p.status === 'delivered') break;

      // Before QA's first call (i.e. when status is in_test_acceptance and
      // we haven't failed yet), swap in a failing QA agent.
      if (p.status === 'in_test_acceptance' && !failedOnce) {
        const reg = pipeline.registry as AgentRegistry;
        reg.replace(createQaAgent({ forceFailure: true }));
        failedOnce = true;
      } else if (p.status === 'test_failed') {
        // Re-test after dev's fix — register a passing QA.
        const reg = pipeline.registry as AgentRegistry;
        reg.replace(createQaAgent({ forceFailure: false }));
      }

      p = await pipeline.step(p);
    }

    assert.equal(p.status, 'delivered', `expected delivered, got ${p.status}`);
    const kinds = p.artifacts.map((a) => a.kind);
    // We should have at least 2 test reports (one failure, one pass)
    const reports = p.artifacts.filter((a) => a.kind === 'test_report');
    assert.ok(reports.length >= 2, `expected >=2 test reports, got ${reports.length}`);
    assert.ok(
      reports.some((r) => r.summary.includes('FAIL')),
      'expected a FAIL report',
    );
    assert.ok(
      reports.some((r) => r.summary.includes('PASS')),
      'expected a PASS report',
    );
  });
});

describe('e2e: artifact sanity', () => {
  it('every artifact has an id, kind, agentId, createdAt, summary, content', async () => {
    const root = makeTmpRoot();
    const storage = new Storage({ root });
    await storage.init();
    const audit = new AuditLog(storage);
    const pipeline = new Pipeline({ registry: buildRegistry(), storage, audit });
    try {
      const initial = await pipeline.createProposal({
        title: 'artifact sanity',
        rawRequirement: 'check artifact shape',
      });
      const final = await pipeline.runToCompletion(initial);
      for (const a of final.artifacts) {
        assert.ok(a.id.length > 0, `artifact missing id: ${JSON.stringify(a)}`);
        const expectedKinds: ArtifactKind[] = [
          'requirement_brief',
          'design_spec',
          'prd',
          'plan',
          'test_plan',
          'implementation',
          'test_report',
          'acceptance_decision',
          'deployment_record',
        ];
        assert.ok(expectedKinds.includes(a.kind), `unexpected artifact kind: ${a.kind}`);
        assert.ok(a.agentId.length > 0, `artifact missing agentId: ${a.id}`);
        assert.ok(a.createdAt.length > 0, `artifact missing createdAt: ${a.id}`);
        assert.ok(a.summary.length > 0, `artifact missing summary: ${a.id}`);
        assert.ok(a.content.length > 0, `artifact missing content: ${a.id}`);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
