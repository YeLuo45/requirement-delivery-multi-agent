/**
 * QA Agent tests — covers deterministic + LLM modes + rework loop.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentContext, Artifact, Proposal } from '@rdma/core';
import { createMockProvider } from '@rdma/llm/mock';
import { createQaAgent } from '../src/agent.js';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'P-20260619-001',
    projectId: 'PRJ-20260619-001',
    title: 'JSON to CSV CLI',
    rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
    status: 'in_test_acceptance',
    owner: 'qa',
    clarificationRound: 0,
    tags: {},
    artifacts: [],
    createdAt: '2026-06-19T00:00:00Z',
    updatedAt: '2026-06-19T00:00:00Z',
    ...overrides,
  };
}

function makeCtx(p: Proposal): AgentContext {
  return {
    proposal: p,
    storage: {} as AgentContext['storage'],
    audit: {
      record: async () => ({}) as never,
      list: async () => [],
      handoffChain: async () => [],
    } as AgentContext['audit'],
    now: () => new Date(),
  };
}

describe('QA agent: deterministic mode', () => {
  it('emits PASS report by default', async () => {
    const agent = createQaAgent();
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.equal(result.to, 'boss');
    assert.ok(result.artifact);
    assert.match(result.artifact.content, /## Result: PASS/);
    assert.match(result.artifact.summary, /QA PASS/);
  });

  it('emits FAIL report when forceFailure is true', async () => {
    const agent = createQaAgent({ forceFailure: true });
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'transition');
    if (result.kind !== 'transition') return;
    assert.equal(result.nextStage, 'test_failed');
    assert.match(result.artifact.content, /## Result: FAIL/);
    assert.match(result.artifact.summary, /QA FAIL/);
  });

  it('rework loop: routes to dev after test_failed', async () => {
    const agent = createQaAgent();
    const p = makeProposal({ status: 'test_failed' });
    const result = await agent.handle(makeCtx(p));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.equal(result.to, 'dev');
  });
});

describe('QA agent: LLM mode', () => {
  it('uses LLM PASS verdict', async () => {
    const provider = createMockProvider({
      responses: [
        '## Result: PASS\n\nAll checks look good.\n\n## Checks\n- [x] A\n- [x] B\n\n## Summary\nShip it.',
      ],
    });
    const agent = createQaAgent({ model: provider });
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.equal(result.to, 'boss');
    assert.match(result.artifact.content, /## Result: PASS/);
    assert.match(result.artifact.summary, /LLM/);
  });

  it('uses LLM FAIL verdict', async () => {
    const provider = createMockProvider({
      responses: [
        '## Result: FAIL\n\nEdge case missing.\n\n## Checks\n- [ ] Edge case\n\n## Summary\nNeed to fix.',
      ],
    });
    const agent = createQaAgent({ model: provider });
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'transition');
    if (result.kind !== 'transition') return;
    assert.equal(result.nextStage, 'test_failed');
    assert.match(result.artifact.content, /## Result: FAIL/);
  });

  it('sends test_plan + implementation to LLM', async () => {
    const provider = createMockProvider({
      responses: ['## Result: PASS'],
    });
    const testPlan: Artifact = {
      id: 'tp',
      kind: 'test_plan',
      agentId: 'dev',
      createdAt: '2026-06-19T00:00:00Z',
      summary: 'test plan',
      content: '// test plan content',
    };
    const implementation: Artifact = {
      id: 'impl',
      kind: 'implementation',
      agentId: 'dev',
      createdAt: '2026-06-19T00:00:00Z',
      summary: 'impl',
      content: '// implementation content',
    };
    const agent = createQaAgent({ model: provider });
    const p = makeProposal({ artifacts: [testPlan, implementation] });
    await agent.handle(makeCtx(p));
    const userMsg = provider.calls[0]?.request.messages[1]?.content ?? '';
    assert.match(userMsg, /test plan content/);
    assert.match(userMsg, /implementation content/);
  });

  it('forceFailure overrides LLM PASS verdict', async () => {
    const provider = createMockProvider({
      responses: ['## Result: PASS\n\n## Summary\nAll good.'],
    });
    const agent = createQaAgent({ model: provider, forceFailure: true });
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'transition');
    if (result.kind !== 'transition') return;
    assert.equal(result.nextStage, 'test_failed');
  });

  it('default to FAIL on ambiguous LLM output', async () => {
    const provider = createMockProvider({ responses: ['Not sure what to say.'] });
    const agent = createQaAgent({ model: provider });
    const result = await agent.handle(makeCtx(makeProposal()));
    // Should not pass — ambiguous output is treated as FAIL
    assert.equal(result.kind, 'transition');
  });
});
