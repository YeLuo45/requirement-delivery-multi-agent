/**
 * QA agent — produces an acceptance test report against the implementation.
 *
 * Owns: in_test_acceptance, test_failed.
 *
 * Flow:
 *   in_test_acceptance → accepted           (all tests pass)
 *   in_test_acceptance → test_failed        (one or more tests fail)
 *   test_failed        → in_dev             (back to dev for fixes)
 *   test_failed        → in_test_acceptance (re-test after fix)
 *
 * The default implementation produces a plausible pass/fail report.
 * The fail path is deterministic — calling `markAsFailed(true)` flips
 * a flag that causes the agent to return test_failed on the next call.
 *
 * A real implementation would run the implementation artifact in a
 * sandbox and check actual test output.
 */

import type { Agent, AgentContext, AgentId, AgentResult } from '@rdma/core';

export const QA_ID: AgentId = 'qa';

export const QA_SCOPE: ReadonlyArray<import('@rdma/core').Stage> = [
  'in_test_acceptance',
  'test_failed',
];

export interface QaConfig {
  /**
   * Force a failure on the next call. Useful for exercising the
   * rework loop in tests. Defaults to false.
   */
  forceFailure?: boolean;
}

export function createQaAgent(config: QaConfig = {}): Agent {
  let forceFailure = config.forceFailure ?? false;

  return {
    id: QA_ID,
    name: 'qa',
    scope: QA_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      if (p.status === 'test_failed') {
        // We're re-entering QA after a dev fix. The default behavior is
        // to clear the failure flag and re-test by handing off to dev
        // (dev owns the next stage, in_dev, after test_failed).
        forceFailure = false;
        return {
          kind: 'handoff',
          to: 'dev',
          reason: 'Re-running acceptance suite after dev fix (routing back to dev for re-implementation).',
        };
      }

      // p.status === 'in_test_acceptance'
      const shouldFail = forceFailure;
      const headerLine = shouldFail ? '## Action required' : '## Summary';
      const summaryLine = shouldFail
        ? 'One or more acceptance checks failed. Routing to test_failed stage.'
        : 'All acceptance checks passed. Routing to boss for final approval.';

      const reportContent = [
        `# QA acceptance report: ${p.title}`,
        '',
        `## Result: ${shouldFail ? 'FAIL' : 'PASS'}`,
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

      if (shouldFail) {
        // Emit failure artifact and transition to test_failed (QA owns
        // that stage). The next QA invocation will hand off to dev.
        await ctx.audit.record({
          proposalId: p.id,
          projectId: p.projectId,
          actor: QA_ID,
          action: 'qa.failure',
          detail: { reason: 'forced failure (set forceFailure: true)' },
        });
        return {
          kind: 'transition',
          nextStage: 'test_failed',
          reason: 'Acceptance checks failed; routing to test_failed stage.',
          artifact: {
            kind: 'test_report',
            agentId: QA_ID,
            summary: `QA FAIL: ${p.title}`,
            content: reportContent,
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
          summary: `QA PASS: ${p.title}`,
          content: reportContent,
        },
      };
    },
  };
}