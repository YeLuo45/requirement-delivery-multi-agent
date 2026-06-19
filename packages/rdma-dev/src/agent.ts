/**
 * Dev agent — implements the requirement with a TDD-shaped artifact.
 *
 * Owns: in_tdd_test, in_dev.
 *
 * Two modes:
 *   - **Mock mode** (default, no model): produces canned test_plan /
 *     implementation content matching the requirement.
 *   - **LLM mode** (model provided): uses an LlmProvider to generate
 *     content tailored to the requirement.
 *
 * Flow:
 *   in_tdd_test  → in_dev         (tests designed, hand to implementation)
 *   in_dev       → in_test_acceptance (impl done, hand to QA)
 */

import type { Agent, AgentContext, AgentId, AgentResult, Stage } from '@rdma/core';
import type { LlmProvider } from '@rdma/llm';

export const DEV_ID: AgentId = 'dev';

export const DEV_SCOPE: ReadonlyArray<Stage> = ['in_tdd_test', 'in_dev'];

function isJsonCsvRequest(p: import('@rdma/core').Proposal): boolean {
  return /json|csv|convert/i.test(`${p.title} ${p.rawRequirement}`);
}

function renderTestPlan(p: import('@rdma/core').Proposal): string {
  return [
    `# Test plan: ${p.title}`,
    '',
    `## Cases (must fail before implementation)`,
    ``,
    `\`\`\``,
    `describe('${p.title}', () => {`,
    `  it('handles the happy path', async () => { /* arrange, act, assert */ });`,
    `  it('rejects empty input with a clear error', async () => { /* ... */ });`,
    `  it('handles the edge cases listed in the risk register', async () => { /* ... */ });`,
    `});`,
    `\`\`\``,
    ``,
    `## Acceptance gate`,
    `All cases above must pass before handing off to QA.`,
  ].join('\n');
}

function renderImplementation(p: import('@rdma/core').Proposal): string {
  if (isJsonCsvRequest(p)) {
    return [
      `# Implementation: ${p.title}`,
      '',
      `## Plan`,
      `Single-file CLI that reads JSON from stdin / file and writes CSV to stdout.`,
      '',
      `## Code (sketch)`,
      ``,
      `\`\`\`ts`,
      `// src/convert.ts`,
      `export function jsonToCsv(input: unknown): string {`,
      `  if (!Array.isArray(input)) throw new Error('expected an array of objects');`,
      `  if (input.length === 0) return '';`,
      `  const headers = Object.keys(input[0]);`,
      `  const escape = (v: unknown) => {`,
      `    const s = v == null ? '' : String(v);`,
      `    return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;`,
      `  };`,
      `  const rows = input.map((row) => headers.map((h) => escape((row as Record<string, unknown>)[h])).join(','));`,
      `  return [headers.join(','), ...rows].join('\\n');`,
      `}`,
      `\`\`\``,
    ].join('\n');
  }

  return [
    `# Implementation: ${p.title}`,
    '',
    `## Plan`,
    `Break the problem into a library + a thin CLI wrapper. Library handles core logic; CLI parses args, calls library, prints result.`,
    '',
    `## Code (sketch)`,
    `See the test plan for the contract this implementation must satisfy.`,
  ].join('\n');
}

async function renderTestPlanViaLlm(
  p: import('@rdma/core').Proposal,
  model: LlmProvider,
): Promise<string> {
  const result = await model.complete({
    messages: [
      {
        role: 'system',
        content:
          'You write Node.js test suites using the node:test runner. ' +
          'Prefer clear, isolated test cases. Each `it()` should test one ' +
          'behavior. Use describe/it blocks with TypeScript types where helpful.',
      },
      {
        role: 'user',
        content: [
          `Title: ${p.title}`,
          `Requirement: ${p.rawRequirement}`,
          '',
          'Produce a Markdown test plan with these sections:',
          '# Test plan: <title>',
          '## Cases (must fail before implementation)',
          '```ts',
          'describe(...); it(...);',
          '```',
          '## Acceptance gate',
        ].join('\n'),
      },
    ],
    maxTokens: 1200,
    temperature: 0.3,
  });

  return [
    `# Test plan: ${p.title} (LLM-generated)`,
    '',
    result.text,
  ].join('\n');
}

async function renderImplementationViaLlm(
  p: import('@rdma/core').Proposal,
  model: LlmProvider,
): Promise<string> {
  const result = await model.complete({
    messages: [
      {
        role: 'system',
        content:
          'You are a senior TypeScript engineer. Produce a minimal, runnable ' +
          'implementation sketch that satisfies the test plan. Prefer small, ' +
          'pure functions. Wrap code in ```ts fences. Keep it under 60 lines.',
      },
      {
        role: 'user',
        content: [
          `Title: ${p.title}`,
          `Requirement: ${p.rawRequirement}`,
          '',
          'Produce a Markdown implementation note with these sections:',
          '# Implementation: <title>',
          '## Plan',
          '## Code (sketch)',
        ].join('\n'),
      },
    ],
    maxTokens: 1500,
    temperature: 0.3,
  });

  return [
    `# Implementation: ${p.title} (LLM-generated)`,
    '',
    result.text,
  ].join('\n');
}

export interface DevAgentConfig {
  /** Optional LLM provider. When omitted, falls back to deterministic rendering. */
  model?: LlmProvider;
}

export function createDevAgent(config: DevAgentConfig = {}): Agent {
  const model = config.model;

  return {
    id: DEV_ID,
    name: 'dev',
    scope: DEV_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      if (p.status === 'in_tdd_test') {
        const content = model
          ? await renderTestPlanViaLlm(p, model)
          : renderTestPlan(p);
        return {
          kind: 'transition',
          nextStage: 'in_dev',
          reason: 'Failing tests designed; proceeding to implementation.',
          artifact: {
            kind: 'test_plan',
            agentId: DEV_ID,
            summary: `Test plan for ${p.title}${model ? ' (LLM)' : ''}`,
            content,
          },
        };
      }

      if (p.status === 'in_dev') {
        const content = model
          ? await renderImplementationViaLlm(p, model)
          : renderImplementation(p);
        return {
          kind: 'handoff',
          to: 'qa',
          reason: 'Implementation complete; handing off to QA for acceptance.',
          artifact: {
            kind: 'implementation',
            agentId: DEV_ID,
            summary: `Implementation for ${p.title}${model ? ' (LLM)' : ''}`,
            content,
          },
        };
      }

      throw new Error(`Dev agent invoked in unexpected stage: ${p.status}`);
    },
  };
}