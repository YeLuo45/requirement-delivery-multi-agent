/**
 * Proposal + storage tests — covers ID generation, transitions, artifacts,
 * storage round-trips, and audit log handoff chain.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  appendArtifact,
  AuditLog,
  createProposal,
  formatDate,
  InvalidTransitionError,
  latestArtifact,
  makeIdGenerator,
  persist,
  Storage,
  transition,
} from '../src/index.js';

function makeTmpRoot(): string {
  return path.join(tmpdir(), `rdma-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('proposal: id generation', () => {
  it('formatDate returns YYYYMMDD', () => {
    const d = new Date('2026-06-19T00:00:00Z');
    assert.equal(formatDate(d), '20260619');
  });

  it('makeIdGenerator produces P-YYYYMMDD-NNN and PRJ-YYYYMMDD-NNN', () => {
    const ids = makeIdGenerator();
    const d = new Date('2026-06-19T00:00:00Z');
    assert.equal(ids.proposalId(d, 7), 'P-20260619-007');
    assert.equal(ids.projectId(d, 12), 'PRJ-20260619-012');
  });
});

describe('proposal: createProposal', () => {
  it('starts at research_direction_pending with no artifacts', () => {
    const ids = makeIdGenerator();
    const p = createProposal({
      title: 'JSON-to-CSV CLI',
      rawRequirement: 'Build me a CLI that converts JSON to CSV',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    assert.equal(p.id, 'P-20260619-001');
    assert.equal(p.projectId, 'PRJ-20260619-001');
    assert.equal(p.status, 'research_direction_pending');
    assert.equal(p.owner, null);
    assert.equal(p.clarificationRound, 0);
    assert.equal(p.artifacts.length, 0);
    assert.equal(p.title, 'JSON-to-CSV CLI');
  });
});

describe('proposal: transition', () => {
  it('valid edge: research_direction_pending -> research', () => {
    const ids = makeIdGenerator();
    const p = createProposal({
      title: 't',
      rawRequirement: 'r',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    const next = transition(p, 'research', 'research scope agreed');
    assert.equal(next.status, 'research');
    assert.equal(next.tags['last_transition_reason'], 'research scope agreed');
  });

  it('invalid edge throws InvalidTransitionError', () => {
    const ids = makeIdGenerator();
    const p = createProposal({
      title: 't',
      rawRequirement: 'r',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    assert.throws(() => transition(p, 'delivered', 'teleport'), InvalidTransitionError);
  });
});

describe('proposal: artifacts', () => {
  it('appendArtifact adds an artifact with id and timestamp', () => {
    const ids = makeIdGenerator();
    const p = createProposal({
      title: 't',
      rawRequirement: 'r',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    const next = appendArtifact(p, {
      kind: 'requirement_brief',
      agentId: 'market_research',
      summary: 'brief',
      content: 'long content',
    });
    assert.equal(next.artifacts.length, 1);
    assert.equal(next.artifacts[0]!.kind, 'requirement_brief');
    assert.ok(next.artifacts[0]!.id.length > 0);
    assert.ok(next.artifacts[0]!.createdAt.length > 0);
  });

  it('latestArtifact returns the most recent artifact of the kind', () => {
    const ids = makeIdGenerator();
    let p = createProposal({
      title: 't',
      rawRequirement: 'r',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    p = appendArtifact(p, { kind: 'prd', agentId: 'pm', summary: 'v1', content: 'a' });
    p = appendArtifact(p, { kind: 'prd', agentId: 'pm', summary: 'v2', content: 'b' });
    p = appendArtifact(p, { kind: 'plan', agentId: 'pm', summary: 'plan', content: 'c' });
    assert.equal(latestArtifact(p, 'prd')?.summary, 'v2');
    assert.equal(latestArtifact(p, 'plan')?.summary, 'plan');
    assert.equal(latestArtifact(p, 'implementation'), null);
  });
});

describe('storage + audit', () => {
  let root: string;
  before(async () => {
    root = makeTmpRoot();
  });
  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round-trips a proposal through disk', async () => {
    const storage = new Storage({ root });
    await storage.init();
    const ids = makeIdGenerator();
    const p = createProposal({
      title: 'disk test',
      rawRequirement: 'r',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    await storage.saveProposal(p);
    const projects = await storage.listProjects();
    assert.ok(projects.includes('PRJ-20260619-001'));
    const proposals = await storage.listProposals();
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]!.id, 'P-20260619-001');
    const loaded = await storage.getProposal('P-20260619-001');
    assert.equal(loaded.title, 'disk test');
  });

  it('persist() writes a create audit entry on first save', async () => {
    const storage = new Storage({ root: makeTmpRoot() });
    await storage.init();
    const audit = new AuditLog(storage);
    const ids = makeIdGenerator();
    const p = createProposal({
      title: 'audit test',
      rawRequirement: 'r',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    await persist(p, null, audit, (x) => storage.saveProposal(x));
    const entries = await audit.list(p.id, p.projectId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.action, 'proposal.create');
  });

  it('persist() writes a stage.transition entry when status changes', async () => {
    const storage = new Storage({ root: makeTmpRoot() });
    await storage.init();
    const audit = new AuditLog(storage);
    const ids = makeIdGenerator();
    const p = createProposal({
      title: 'audit transition',
      rawRequirement: 'r',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    await persist(p, null, audit, (x) => storage.saveProposal(x));
    const next = transition(p, 'research', 'go');
    await persist(next, p.status, audit, (x) => storage.saveProposal(x));
    const entries = await audit.list(p.id, p.projectId);
    assert.equal(entries.length, 2);
    assert.equal(entries[1]!.action, 'stage.transition');
    const detail = entries[1]!.detail as { from: string; to: string };
    assert.equal(detail.from, 'research_direction_pending');
    assert.equal(detail.to, 'research');
  });

  it('handoffChain() reconstructs the actor timeline', async () => {
    const storage = new Storage({ root: makeTmpRoot() });
    await storage.init();
    const audit = new AuditLog(storage);
    const ids = makeIdGenerator();
    let p = createProposal({
      title: 'handoff test',
      rawRequirement: 'r',
      ids,
      projectSeq: 1,
      proposalSeq: 1,
      now: new Date('2026-06-19T00:00:00Z'),
    });
    await persist(p, null, audit, (x) => storage.saveProposal(x));
    p = { ...p, owner: 'market_research' };
    p = transition(p, 'research', 'go');
    await persist(p, 'research_direction_pending', audit, (x) => storage.saveProposal(x));
    p = { ...p, owner: 'coordinator' };
    p = transition(p, 'intake', 'go');
    await persist(p, 'research', audit, (x) => storage.saveProposal(x));
    p = { ...p, owner: 'pm' };
    p = transition(p, 'clarifying', 'go');
    await persist(p, 'intake', audit, (x) => storage.saveProposal(x));

    const chain = await audit.handoffChain(p.id, p.projectId);
    // handoffChain intentionally skips 'system' — it shows the human-visible
    // handoff sequence. The first agent in the chain is the one that drove
    // the first real stage transition.
    assert.deepEqual(chain, ['market_research', 'coordinator', 'pm']);
  });
});