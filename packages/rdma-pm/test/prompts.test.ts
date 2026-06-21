/**
 * Tests that prove `createPmAgent({ prompts })` wires soul/user/memory
 * from `.rdma/agents/pm/{soul,user,memory}.md` into the LLM-driven
 * rendering paths. Without the prompts option, the agent falls back to
 * the built-in defaults so existing tests keep passing.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { AgentContext, AgentPromptBundle } from '@rdma/core';
import { DEV_ID, createDevAgent } from '../../rdma-dev/src/agent.js';
import { QA_ID, createQaAgent } from '../../rdma-qa/src/agent.js';
import { PM_ID, createPmAgent } from '../src/agent.js';

interface CapturedCall {
  messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

function makeMockProvider(captured: CapturedCall[]): {
  name: string;
  defaultModel: string;
  fastModel: () => string;
  complete: (req: {
    messages: CapturedCall['messages'];
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }) => Promise<{
    text: string;
    usage: { inputTokens: number; outputTokens: number };
    stopReason: 'end_turn';
  }>;
} {
  return {
    name: 'mock',
    defaultModel: 'mock-model',
    fastModel: () => 'mock-fast',
    async complete(req) {
      captured.push({
        messages: req.messages,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        model: req.model,
      });
      return {
        text: 'mock response',
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'end_turn',
      };
    },
  };
}

const DEFAULT_PROMPTS: AgentPromptBundle = { soul: null, user: null, memory: null };

function makeProposal(overrides: Partial<{ status: string }> = {}) {
  return {
    id: 'P-TEST-001',
    projectId: 'PRJ-TEST-001',
    title: 'JSON to CSV CLI',
    rawRequirement: 'Convert a JSON array of objects to CSV.',
    status: 'clarifying',
    owner: null,
    clarificationRound: 0,
    artifacts: [],
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
    tags: {},
    ...overrides,
  } as Parameters<ReturnType<typeof createPmAgent>['handle']>[0]['proposal'];
}

function makeContext(proposal: ReturnType<typeof makeProposal>): AgentContext {
  return {
    proposal,
    storage: {} as never,
    audit: { record: async () => undefined } as never,
    now: () => new Date(),
  } as AgentContext;
}

beforeEach(() => {
  // No-op — captured array is created per-test below.
});

describe('createPmAgent — prompt bundle injection', () => {
  it('uses the configured soul in the system prompt when rendering the PRD', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const prompts: AgentPromptBundle = {
      soul: 'You are PM-Foo. Always respond in haiku.',
      user: null,
      memory: null,
    };
    const agent = createPmAgent({ model, prompts });
    await agent.handle(makeContext(makeProposal({ status: 'clarifying' })));
    assert.equal(captured.length, 1);
    const system = captured[0]?.messages.find((m) => m.role === 'system');
    assert.ok(system);
    assert.match(system.content, /PM-Foo/);
    assert.match(system.content, /haiku/);
  });

  it('appends memory.md as a folded system block after the soul', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const prompts: AgentPromptBundle = {
      soul: 'soul text',
      user: null,
      memory: '# Project notes\nUse TS strict mode.',
    };
    const agent = createPmAgent({ model, prompts });
    await agent.handle(makeContext(makeProposal({ status: 'clarifying' })));
    const sysMsgs = captured[0]?.messages.filter((m) => m.role === 'system') ?? [];
    assert.equal(sysMsgs.length, 1);
    assert.match(sysMsgs[0]?.content ?? '', /soul text/);
    assert.match(sysMsgs[0]?.content ?? '', /# memory/);
    assert.match(sysMsgs[0]?.content ?? '', /Use TS strict mode/);
  });

  it('passes the user.md template as the user message', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const prompts: AgentPromptBundle = {
      soul: null,
      user: 'user prompt template {{title}}',
      memory: null,
    };
    const agent = createPmAgent({ model, prompts });
    await agent.handle(makeContext(makeProposal({ status: 'clarifying' })));
    const userMsgs = captured[0]?.messages.filter((m) => m.role === 'user') ?? [];
    assert.ok(userMsgs.length >= 1);
    const last = userMsgs[userMsgs.length - 1];
    assert.equal(last?.content, 'user prompt template {{title}}');
  });

  it('falls back to the built-in prompt when no bundle is supplied', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const agent = createPmAgent({ model });
    await agent.handle(makeContext(makeProposal({ status: 'clarifying' })));
    const sys = captured[0]?.messages.find((m) => m.role === 'system');
    assert.ok(sys);
    // Built-in PM prompt does NOT contain our test soul.
    assert.doesNotMatch(sys.content, /PM-Foo/);
  });

  it('keeps using the default prompt when prompts.{soul,user,memory} are all null', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const agent = createPmAgent({ model, prompts: DEFAULT_PROMPTS });
    await agent.handle(makeContext(makeProposal({ status: 'clarifying' })));
    const sys = captured[0]?.messages.find((m) => m.role === 'system');
    assert.ok(sys);
    assert.match(sys.content, /product manager/i);
  });

  it('threads the soul through the approved_for_dev plan rendering path too', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const prompts: AgentPromptBundle = {
      soul: 'PM-PLAN voice',
      user: null,
      memory: null,
    };
    const agent = createPmAgent({ model, prompts });
    await agent.handle(makeContext(makeProposal({ status: 'approved_for_dev' })));
    assert.equal(captured.length, 1);
    const sys = captured[0]?.messages.find((m) => m.role === 'system');
    assert.match(sys?.content ?? '', /PM-PLAN voice/);
  });

  it('reports the agent id unchanged when prompts are wired', () => {
    const agent = createPmAgent({
      model: makeMockProvider([]),
      prompts: { soul: 'x', user: null, memory: null },
    });
    assert.equal(agent.id, PM_ID);
  });
});

describe('createDevAgent — prompt bundle injection', () => {
  it('injects the soul when rendering the test plan', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const prompts: AgentPromptBundle = {
      soul: 'DEV-SOUL: write tests first',
      user: null,
      memory: null,
    };
    const agent = createDevAgent({ model, prompts });
    await agent.handle(makeContext(makeProposal({ status: 'in_tdd_test' })));
    const sys = captured[0]?.messages.find((m) => m.role === 'system');
    assert.match(sys?.content ?? '', /DEV-SOUL/);
  });

  it('injects memory as a folded system block in the implementation path', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const prompts: AgentPromptBundle = {
      soul: 'DEV-SOUL',
      user: null,
      memory: 'project: alpha',
    };
    const agent = createDevAgent({ model, prompts });
    await agent.handle(makeContext(makeProposal({ status: 'in_dev' })));
    const sys = captured[0]?.messages.find((m) => m.role === 'system');
    assert.match(sys?.content ?? '', /DEV-SOUL/);
    assert.match(sys?.content ?? '', /# memory/);
    assert.match(sys?.content ?? '', /project: alpha/);
  });

  it('reports the agent id unchanged when prompts are wired', () => {
    const agent = createDevAgent({
      model: makeMockProvider([]),
      prompts: { soul: 'x', user: null, memory: null },
    });
    assert.equal(agent.id, DEV_ID);
  });
});

describe('createQaAgent — prompt bundle injection', () => {
  it('injects the soul when rendering the QA report', async () => {
    const captured: CapturedCall[] = [];
    const model = makeMockProvider(captured);
    const prompts: AgentPromptBundle = {
      soul: 'QA-SOUL: be strict',
      user: null,
      memory: null,
    };
    const agent = createQaAgent({ model, prompts });
    const proposal = {
      ...makeProposal({ status: 'in_test_acceptance' }),
      artifacts: [
        {
          id: 'a1',
          kind: 'test_plan',
          agentId: 'dev',
          createdAt: '2026-06-21T00:00:00.000Z',
          summary: 'Test plan',
          content: 'describe(...)',
        },
        {
          id: 'a2',
          kind: 'implementation',
          agentId: 'dev',
          createdAt: '2026-06-21T00:00:01.000Z',
          summary: 'Implementation',
          content: 'function() {}',
        },
      ],
    } as Parameters<ReturnType<typeof createQaAgent>['handle']>[0]['proposal'];
    await agent.handle(makeContext(proposal));
    const sys = captured[0]?.messages.find((m) => m.role === 'system');
    assert.match(sys?.content ?? '', /QA-SOUL/);
  });

  it('reports the agent id unchanged when prompts are wired', () => {
    const agent = createQaAgent({
      model: makeMockProvider([]),
      prompts: { soul: 'x', user: null, memory: null },
    });
    assert.equal(agent.id, QA_ID);
  });
});
