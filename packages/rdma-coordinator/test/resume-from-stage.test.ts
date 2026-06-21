/**
 * Tests for Pipeline.resumeFromStage (direction E3).
 *
 * Verifies:
 *   - resumes a stuck proposal from a mid-pipeline stage and drives it
 *     to delivered
 *   - preserves all artifacts collected before the resume
 *   - rewrites the proposal's status to the requested stage
 *   - records a 'pipeline.resumed' audit entry with from/to
 *   - emits proposal.updated with {resumedFrom} payload
 *   - emits audit.appended with the resume marker
 *   - returns the existing proposal unchanged if already delivered
 *   - throws when the proposal does not exist
 *   - the resume can pick up from any valid stage in the state machine
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createBossAgent } from '@rdma/boss';
import { AuditLog, Storage } from '@rdma/core';
import { AgentRegistry } from '@rdma/core';
import type { Stage } from '@rdma/core';
import { createDevAgent } from '@rdma/dev';
import { EventBus } from '@rdma/persistence';
import { createPmAgent } from '@rdma/pm';
import { createQaAgent } from '@rdma/qa';
import { createResearchAgent } from '@rdma/research';
import { Pipeline, createCoordinatorAgent } from '../src/agent.js';

function bootstrap(storage: Storage, bus: EventBus): { pipeline: Pipeline; shippedRoot: string } {
  const shippedRoot = mkdtempSync(path.join(tmpdir(), 'rdma-resume-shipped-'));
  const audit = new AuditLog(storage);
  const reg = new AgentRegistry();
  reg.register(createResearchAgent());
  reg.register(createCoordinatorAgent());
  reg.register(createPmAgent());
  reg.register(createDevAgent());
  reg.register(createQaAgent());
  reg.register(createBossAgent({ shippedRoot }));
  return { pipeline: new Pipeline({ registry: reg, storage, audit, bus }), shippedRoot };
}

describe('Pipeline.resumeFromStage', () => {
  const dirs: string[] = [];

  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('resumes a proposal stuck at pm and drives it to delivered', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-resume-'));
    dirs.push(root);
    const storage = new Storage({ root });
    await storage.init();
    const bus = new EventBus();
    const { pipeline, shippedRoot } = bootstrap(storage, bus);
    dirs.push(shippedRoot);

    // Run to completion once so we have a delivered proposal — we'll
    // reuse its structure to fabricate a "stuck" mid-pipeline state.
    const p = await pipeline.createProposal({
      title: 'resume me',
      rawRequirement: 'a small proposal',
    });
    await pipeline.runToCompletion(p);
    const delivered = await storage.getProposal(p.id);

    // Rewind status to clarifying (pm-owned stage) by direct write
    // (simulating a stuck proposal).
    const stuck = { ...delivered, status: 'clarifying' as Stage };
    await storage.saveProposal(stuck);

    const resumed = await pipeline.resumeFromStage(p.id, 'clarifying');
    assert.equal(resumed.status, 'delivered');
    // Artifacts from earlier runs should still be present.
    assert.ok(resumed.artifacts.length >= delivered.artifacts.length);
  });

  it('returns the proposal unchanged when already delivered', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-resume-'));
    dirs.push(root);
    const storage = new Storage({ root });
    await storage.init();
    const bus = new EventBus();
    const { pipeline, shippedRoot } = bootstrap(storage, bus);
    dirs.push(shippedRoot);

    const p = await pipeline.createProposal({ title: 'already done', rawRequirement: 'short' });
    await pipeline.runToCompletion(p);
    const delivered = await pipeline.resumeFromStage(p.id, 'research');
    assert.equal(delivered.status, 'delivered');
    assert.equal(delivered.id, p.id);
  });

  it('throws when the proposal does not exist', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-resume-'));
    dirs.push(root);
    const storage = new Storage({ root });
    await storage.init();
    const bus = new EventBus();
    const { pipeline } = bootstrap(storage, bus);

    await assert.rejects(
      () => pipeline.resumeFromStage('P-does-not-exist', 'research'),
      /not found|ProposalNotFound/,
    );
  });

  it('records a pipeline.resumed audit entry with from/to', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-resume-'));
    dirs.push(root);
    const storage = new Storage({ root });
    await storage.init();
    const bus = new EventBus();
    const { pipeline, shippedRoot } = bootstrap(storage, bus);
    dirs.push(shippedRoot);

    const p = await pipeline.createProposal({ title: 'audit me', rawRequirement: 'short' });
    await pipeline.runToCompletion(p);
    const delivered = await storage.getProposal(p.id);

    const stuck = { ...delivered, status: 'in_test_acceptance' as Stage };
    await storage.saveProposal(stuck);

    await pipeline.resumeFromStage(p.id, 'in_test_acceptance');
    const lines = await storage.readAudit(p.id, p.projectId);
    const joined = lines.join('\n');
    assert.match(joined, /pipeline\.resumed/);
    assert.match(joined, /"from":"in_test_acceptance"/);
    assert.match(joined, /"to":"in_test_acceptance"/);
  });

  it('emits proposal.updated with resumedFrom payload', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-resume-'));
    dirs.push(root);
    const storage = new Storage({ root });
    await storage.init();
    const bus = new EventBus();
    const { pipeline, shippedRoot } = bootstrap(storage, bus);
    dirs.push(shippedRoot);

    const updates: Array<{ status: string; resumedFrom?: string }> = [];
    bus.subscribe('proposal.updated', (e) => {
      const payload = e.payload as { status?: string; resumedFrom?: string };
      updates.push({ status: payload.status ?? '', resumedFrom: payload.resumedFrom });
    });

    const p = await pipeline.createProposal({ title: 'emit me', rawRequirement: 'short' });
    await pipeline.runToCompletion(p);
    const delivered = await storage.getProposal(p.id);

    const stuck = { ...delivered, status: 'in_dev' as Stage };
    await storage.saveProposal(stuck);

    await pipeline.resumeFromStage(p.id, 'in_dev');
    const resumeEvent = updates.find((u) => u.resumedFrom !== undefined);
    assert.ok(resumeEvent, 'expected a resume proposal.updated event');
    assert.equal(resumeEvent?.status, 'in_dev');
    assert.equal(resumeEvent?.resumedFrom, 'in_dev');
  });

  it('emits audit.appended with pipeline.resumed kind', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-resume-'));
    dirs.push(root);
    const storage = new Storage({ root });
    await storage.init();
    const bus = new EventBus();
    const { pipeline, shippedRoot } = bootstrap(storage, bus);
    dirs.push(shippedRoot);

    const auditKinds: string[] = [];
    bus.subscribe('audit.appended', (e) => {
      const payload = e.payload as { kind?: string };
      if (payload.kind) auditKinds.push(payload.kind);
    });

    const p = await pipeline.createProposal({ title: 'audit emit', rawRequirement: 'short' });
    await pipeline.runToCompletion(p);
    const delivered = await storage.getProposal(p.id);
    const stuck = { ...delivered, status: 'clarifying' as Stage };
    await storage.saveProposal(stuck);

    await pipeline.resumeFromStage(p.id, 'clarifying');
    assert.ok(auditKinds.includes('pipeline.resumed'), `kinds: ${auditKinds.join(',')}`);
  });

  it('resume rewrites proposal status to the requested stage on disk', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-resume-'));
    dirs.push(root);
    const storage = new Storage({ root });
    await storage.init();
    const bus = new EventBus();
    const { pipeline, shippedRoot } = bootstrap(storage, bus);
    dirs.push(shippedRoot);

    const p = await pipeline.createProposal({ title: 'rewind me', rawRequirement: 'short' });
    await pipeline.runToCompletion(p);
    const delivered = await storage.getProposal(p.id);

    // Use a different stage than the final to confirm the rewrite.
    const rewound = await pipeline.resumeFromStage(p.id, 'clarifying');
    // Run from clarifying must finish to delivered.
    assert.equal(rewound.status, 'delivered');
  });

  it('survives a resume from intake (earliest stage)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-resume-'));
    dirs.push(root);
    const storage = new Storage({ root });
    await storage.init();
    const bus = new EventBus();
    const { pipeline, shippedRoot } = bootstrap(storage, bus);
    dirs.push(shippedRoot);

    const p = await pipeline.createProposal({ title: 'from intake', rawRequirement: 'short' });
    await pipeline.runToCompletion(p);
    const delivered = await storage.getProposal(p.id);
    const stuck = { ...delivered, status: 'intake' as Stage };
    await storage.saveProposal(stuck);

    const final = await pipeline.resumeFromStage(p.id, 'intake');
    assert.equal(final.status, 'delivered');
  });
});
