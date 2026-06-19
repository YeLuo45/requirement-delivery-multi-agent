/**
 * QA agent — produces an acceptance test report against the implementation.
 *
 * Owns: in_test_acceptance, test_failed.
 *
 * Two modes:
 *   - **Mock mode** (no model): deterministic PASS / FAIL based on the
 *     `forceFailure` flag (used by tests to exercise the rework loop).
 *   - **LLM mode** (model provided): the LLM evaluates the implementation
 *     against the test plan and emits a structured report (verdict + checks).
 *
 * Flow:
 *   in_test_acceptance → accepted           (PASS)
 *   in_test_acceptance → test_failed        (FAIL)
 *   test_failed        → in_dev             (back to dev for fixes)
 *   test_failed        → in_test_acceptance (re-test after fix)
 */

import { latestArtifact, type Agent, type AgentContext, type AgentId, type AgentResult, type Stage } from '@rdma/core';
import type { LlmProvider } from '@rdma/llm';

export const QA_ID: AgentId = 'qa';

export const QA_SCOPE: ReadonlyArray<Stage> = [
  'in_test_acceptance',
  'test_failed',
];

export interface QaConfig {
  /** Force a failure on the next call. Useful for exercising the rework loop in tests. */
  forceFailure?: boolean;
  /** Optional LLM provider. When provided, the LLM produces the verdict. */
  model?: LlmProvider;
}

function deterministicReport(
  p: import('@rdma/core').Proposal,
  shouldFail: boolean,
): { content: string; result: 'PASS' | 'FAIL' } {
  const result = shouldFail ? 'FAIL' : 'PASS';
  const headerLine = shouldFail ? '## Action required' : '## Summary';
  const summaryLine = shouldFail
    ? 'One or more acceptance checks failed. Routing to test_failed stage.'
    : 'All acceptance checks passed. Routing to boss for final approval.';

  const content = [
    `# QA acceptance report: ${p.title}`,
    '',
    `## Result: ${result}`,
    '',
    `## Checks`,
    `- [${shouldFail ? ' ' : 'x'}] Happy path test passes`,
    `- [${shouldFail ? ' ' : 'x'}] Empty input handled with clear error`,
    `- [${shouldFail ? ' ' : 'x'}] Edge cases from risk register covered`,
    `- [${shouldFail ? ' ' : 'x'}] CLI smoke test runs end-to-end`,
    `- [${shouldFail ? ' ' : 'x'}] README documents install + usage + 1 example`,
    '',
    headerLine,
    summaryLine,
  ].join('\n');

  return { content, result };
}

function extractVerdict(text: string): 'PASS' | 'FAIL' {
  const upper = text.toUpperCase();
  if (/\bFAIL\b/.test(upper) && !/\bPASS\b/.test(upper)) return 'FAIL';
  if (/\bPASS\b/.test(upper)) return 'PASS';
  // Default to FAIL on ambiguous LLM output to avoid shipping unverified work.
  return 'FAIL';
}

async function renderReportViaLlm(
  p: import('@rdma/core').Proposal,
  model: LlmProvider,
): Promise<{ content: string; result: 'PASS' | 'FAIL' }> {
  const implementation = latestArtifact(p, 'implementation');
  const testPlan = latestArtifact(p, 'test_plan');

  const result = await model.complete({
    messages: [
      {
        role: 'system',
        content:
          'You are a QA engineer reviewing an implementation against its ' +
          'test plan. Be strict. If anything is missing, FAIL. Produce a ' +
          'Markdown report starting with "## Result: PASS" or "## Result: FAIL".',
      },
      {
        role: 'user',
        content: [
          `Title: ${p.title}`,
          `Requirement: ${p.rawRequirement}`,
          '',
          '## Test plan',
          testPlan?.content ?? '(no test plan attached)',
          '',
          '## Implementation',
          implementation?.content ?? '(no implementation attached)',
          '',
          'Evaluate whether the implementation satisfies the test plan. ' +
            'Output a Markdown report with sections:',
          '## Result: <PASS|FAIL>',
          '## Checks',
          '(bullet list of checks with [x] or [ ])',
          '## Summary',
        ].join('\n'),
      },
    ],
    maxTokens: 1200,
    temperature: 0.2,
  });

  const verdict = extractVerdict(result.text);
  return { content: result.text, result: verdict };
}

export function createQaAgent(config: QaConfig = {}): Agent {
  let forceFailure = config.forceFailure ?? false;
  const model = config.model;

  return {
    id: QA_ID,
    name: 'qa',
    scope: QA_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      if (p.status === 'test_failed') {
        // Re-entering QA after a dev fix. Clear the failure flag and hand
        // off to dev (dev owns the next stage after test_failed).
        forceFailure = false;
        return {
          kind: 'handoff',
          to: 'dev',
          reason: 'Re-running acceptance suite after dev fix (routing back to dev for re-implementation).',
        };
      }

      // p.status === 'in_test_acceptance'
      let content: string;
      let verdict: 'PASS' | 'FAIL';

      if (model) {
        const r = await renderReportViaLlm(p, model);
        content = r.content;
        verdict = r.result;
        // LLM verdict wins unless explicitly forced.
        if (forceFailure) verdict = 'FAIL';
      } else {
        const r = deterministicReport(p, forceFailure);
        content = r.content;
        verdict = r.result;
      }

      const summaryPrefix = verdict === 'FAIL' ? 'QA FAIL' : 'QA PASS';

      if (verdict === 'FAIL') {
        await ctx.audit.record({
          proposalId: p.id,
          projectId: p.projectId,
          actor: QA_ID,
          action: 'qa.failure',
          detail: { reason: model ? 'LLM verdict: FAIL' : 'forced failure' },
        });
        return {
          kind: 'transition',
          nextStage: 'test_failed',
          reason: 'Acceptance checks failed; routing to test_failed stage.',
          artifact: {
            kind: 'test_report',
            agentId: QA_ID,
            summary: `${summaryPrefix}: ${p.title}${model ? ' (LLM)' : ''}`,
            content,
          },
        };
      }

      return {
        kind: 'handoff',
        to: 'boss',
        reason: 'Acceptance checks passed; routing to boss for final approval.',
        artifact: {
          kind: 'test_report',
          agentId: QA_ID,
          summary: `${summaryPrefix}: ${p.title}${model ? ' (LLM)' : ''}`,
          content,
        },
      };
    },
  };
}