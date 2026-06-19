/**
 * PM Agent tests — covers both deterministic and LLM-driven modes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockProvider } from '@rdma/llm/mock';
import { createPmAgent } from '../src/agent.js';
import type { AgentContext, Proposal } from '@rdma/core';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'P-20260619-001',
    projectId: 'PRJ-20260619-001',
    title: 'JSON to CSV CLI',
    rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
    status: 'clarifying',
    owner: 'pm',
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

describe('PM agent: deterministic mode (no model)', () => {
  it('drafts a PRD on the first clarifying round', async () => {
    const agent = createPmAgent();
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'transition');
    if (result.kind !== 'transition') return;
    assert.equal(result.nextStage, 'prd_pending_confirmation');
    assert.ok(result.artifact);
    assert.equal(result.artifact.kind, 'prd');
    assert.match(result.artifact.content, /## Problem/);
    assert.match(result.artifact.content, /## Acceptance criteria/);
    assert.match(result.artifact.content, /JSON to CSV CLI/);
  });

  it('advances to dev with a plan when approved', async () => {
    const agent = createPmAgent();
    const p = makeProposal({ status: 'approved_for_dev', owner: 'pm' });
    const result = await agent.handle(makeCtx(p));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.equal(result.to, 'dev');
    assert.ok(result.artifact);
    assert.equal(result.artifact.kind, 'plan');
    assert.match(result.artifact.content, /## Phases/);
  });
});

describe('PM agent: LLM mode', () => {
  it('uses LLM output for PRD when model is provided', async () => {
    const provider = createMockProvider({
      responses: [
        [
          '# PRD: JSON to CSV CLI',
          '',
          '## Problem',
          'Users need to convert JSON arrays to CSV.',
          '',
          '## Goals',
          '- Single-file CLI',
          '- Handles nested arrays',
          '',
          '## Non-goals',
          '- Streaming support',
          '',
          '## User stories',
          '- As a data analyst, I can convert a JSON file to CSV with one command.',
          '',
          '## Acceptance criteria',
          '1. Converts a 100-row JSON file in < 1 second',
          '2. Escapes commas and quotes correctly',
        ].join('\n'),
      ],
    });
    const agent = createPmAgent({ model: provider });
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'transition');
    if (result.kind !== 'transition') return;
    assert.ok(result.artifact);
    const content = result.artifact.content;
    assert.match(content, /Users need to convert JSON arrays to CSV/);
    assert.match(content, /Streaming support/);
    assert.match(content, /## Acceptance criteria/);
    assert.match(content, /JSON to CSV CLI/);
    assert.match(result.artifact.summary, /LLM/);
    assert.equal(provider.calls.length, 1);
    const systemMsg = provider.calls[0]?.request.messages[0]?.content ?? '';
    assert.match(systemMsg, /product manager/i);
  });

  it('falls back to deterministic sections when LLM response is empty', async () => {
    const provider = createMockProvider({ responses: [''] });
    const agent = createPmAgent({ model: provider });
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'transition');
    if (result.kind !== 'transition') return;
    assert.ok(result.artifact);
    assert.match(result.artifact.content, /## Goals/);
    assert.match(result.artifact.content, /Deliver a working artifact/);
  });

  it('uses LLM for plan in approved_for_dev', async () => {
    const provider = createMockProvider({
      responses: [
        [
          '# Implementation Plan: JSON to CSV CLI',
          '',
          '## Phases',
          '1. Scaffold the CLI',
          '2. Implement converter',
          '',
          '## Exit criteria',
          '- Tests pass',
        ].join('\n'),
      ],
    });
    const agent = createPmAgent({ model: provider });
    const p = makeProposal({ status: 'approved_for_dev', owner: 'pm' });
    const result = await agent.handle(makeCtx(p));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.equal(result.to, 'dev');
    assert.ok(result.artifact);
    assert.equal(result.artifact.kind, 'plan');
    assert.match(result.artifact.content, /Scaffold the CLI/);
    assert.match(result.artifact.summary, /LLM/);
  });

  it('appends Risks + Design sections from attached artifacts', async () => {
    const provider = createMockProvider({
      responses: [
        [
          '# PRD: x',
          '## Problem',
          'p',
          '## Goals',
          'g',
          '## Non-goals',
          'ng',
          '## User stories',
          'us',
          '## Acceptance criteria',
          'ac',
        ].join('\n'),
      ],
    });
    const agent = createPmAgent({ model: provider });
    const p = makeProposal({
      artifacts: [
        {
          id: 'a1',
          kind: 'requirement_brief',
          agentId: 'market_research',
          createdAt: '2026-06-19T00:00:00Z',
          summary: 'brief',
          content: 'risk register here',
        },
        {
          id: 'a2',
          kind: 'design_spec',
          agentId: 'designer',
          createdAt: '2026-06-19T00:00:00Z',
          summary: 'spec',
          content: 'design here',
        },
      ],
    });
    const result = await agent.handle(makeCtx(p));
    if (result.kind !== 'transition') return assert.fail('expected transition');
    assert.ok(result.artifact);
    assert.match(result.artifact.content, /## Risks/);
    assert.match(result.artifact.content, /requirement_brief/);
    assert.match(result.artifact.content, /## Design/);
    assert.match(result.artifact.content, /design_spec/);
  });
});

describe('PM agent: stage coverage', () => {
  it('throws on unexpected stage', async () => {
    const agent = createPmAgent();
    const p = makeProposal({ status: 'in_dev' });
    await assert.rejects(
      agent.handle(makeCtx(p)),
      /unexpected stage/,
    );
  });
});