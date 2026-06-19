/**
 * Dev agent — implements the requirement with a TDD-shaped artifact.
 *
 * Owns: in_tdd_test, in_dev.
 *
 * Flow:
 *   in_tdd_test  → in_dev         (tests designed, hand to implementation)
 *   in_dev       → in_test_acceptance (impl done, hand to QA)
 *
 * The default implementation produces two structured artifacts:
 *   1. test_plan  — failing tests as pseudocode blocks
 *   2. implementation — code blocks designed to make the tests pass
 *
 * For real implementations, plug a code-generation model + a sandboxed
 * file workspace behind the same interface.
 */

import type { Agent, AgentContext, AgentId, AgentResult, Stage } from '@rdma/core';

export const DEV_ID: AgentId = 'dev';

export const DEV_SCOPE: ReadonlyArray<Stage> = ['in_tdd_test', 'in_dev'];

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
  const isConverter =
    /json|csv|convert/i.test(`${p.title} ${p.rawRequirement}`);
  if (isConverter) {
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

export function createDevAgent(): Agent {
  return {
    id: DEV_ID,
    name: 'dev',
    scope: DEV_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      if (p.status === 'in_tdd_test') {
        return {
          kind: 'transition',
          nextStage: 'in_dev',
          reason: 'Failing tests designed; proceeding to implementation.',
          artifact: {
            kind: 'test_plan',
            agentId: DEV_ID,
            summary: `Test plan for ${p.title}`,
            content: renderTestPlan(p),
          },
        };
      }

      if (p.status === 'in_dev') {
        return {
          kind: 'handoff',
          to: 'qa',
          reason: 'Implementation complete; handing off to QA for acceptance.',
          artifact: {
            kind: 'implementation',
            agentId: DEV_ID,
            summary: `Implementation for ${p.title}`,
            content: renderImplementation(p),
          },
        };
      }

      throw new Error(`Dev agent invoked in unexpected stage: ${p.status}`);
    },
  };
}