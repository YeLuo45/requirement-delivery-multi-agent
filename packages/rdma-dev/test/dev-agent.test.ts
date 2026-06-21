/**
 * Dev Agent tests — covers both deterministic and LLM-driven modes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentContext, Proposal } from '@rdma/core';
import { createMockProvider } from '@rdma/llm/mock';
import { createDevAgent } from '../src/agent.js';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'P-20260619-001',
    projectId: 'PRJ-20260619-001',
    title: 'JSON to CSV CLI',
    rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
    status: 'in_tdd_test',
    owner: 'dev',
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

describe('Dev agent: deterministic mode', () => {
  it('emits a test_plan on in_tdd_test', async () => {
    const agent = createDevAgent();
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'transition');
    if (result.kind !== 'transition') return;
    assert.equal(result.nextStage, 'in_dev');
    assert.ok(result.artifact);
    assert.equal(result.artifact.kind, 'test_plan');
    assert.match(result.artifact.content, /describe\(/);
  });

  it('emits an implementation artifact on in_dev', async () => {
    const agent = createDevAgent();
    const p = makeProposal({ status: 'in_dev' });
    const result = await agent.handle(makeCtx(p));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.equal(result.to, 'qa');
    assert.ok(result.artifact);
    assert.equal(result.artifact.kind, 'implementation');
    assert.match(result.artifact.content, /jsonToCsv/);
  });

  it('uses generic implementation for non-JSON-CSV requests', async () => {
    const agent = createDevAgent();
    const p = makeProposal({
      status: 'in_dev',
      title: 'Markdown linter',
      rawRequirement: 'Build a markdown linter',
    });
    const result = await agent.handle(makeCtx(p));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.ok(result.artifact);
    assert.doesNotMatch(result.artifact.content, /jsonToCsv/);
  });
});

describe('Dev agent: LLM mode', () => {
  it('uses LLM for test_plan', async () => {
    const provider = createMockProvider({
      responses: ['```ts\ndescribe("x", () => { it("y", () => {}); });\n```'],
    });
    const agent = createDevAgent({ model: provider });
    const result = await agent.handle(makeCtx(makeProposal()));
    if (result.kind !== 'transition') return assert.fail('expected transition');
    assert.ok(result.artifact);
    assert.match(result.artifact.content, /LLM-generated/);
    assert.match(result.artifact.content, /describe\("x"/);
    assert.match(result.artifact.summary, /LLM/);
  });

  it('uses LLM for implementation', async () => {
    const provider = createMockProvider({
      responses: [
        [
          '## Plan',
          'Two files: convert.ts + cli.ts',
          '',
          '## Code (sketch)',
          '```ts',
          'export const convert = (s: string) => s;',
          '```',
        ].join('\n'),
      ],
    });
    const agent = createDevAgent({ model: provider });
    const p = makeProposal({ status: 'in_dev' });
    const result = await agent.handle(makeCtx(p));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.match(result.artifact.content, /LLM-generated/);
    assert.match(result.artifact.content, /Two files/);
  });

  it('records LLM call usage', async () => {
    const provider = createMockProvider({
      responses: ['## Phases\n1. x', '## Code (sketch)\n```ts\nexport const a = 1;\n```'],
    });
    const agent = createDevAgent({ model: provider });
    await agent.handle(makeCtx(makeProposal()));
    await agent.handle(makeCtx(makeProposal({ status: 'in_dev' })));
    assert.equal(provider.calls.length, 2);
  });
});

describe('Dev agent: stage coverage', () => {
  it('throws on unexpected stage', async () => {
    const agent = createDevAgent();
    const p = makeProposal({ status: 'delivered' });
    await assert.rejects(agent.handle(makeCtx(p)), /unexpected stage/);
  });
});
