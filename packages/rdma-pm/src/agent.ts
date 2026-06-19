/**
 * Product manager agent.
 *
 * Owns three stages:
 *   clarifying              — drafts PRD, runs clarification rounds
 *   prd_pending_confirmation — PRD is written; awaiting boss approval
 *   approved_for_dev        — PM hands off to dev with the implementation plan
 *
 * Default implementation is deterministic — it auto-resolves clarification
 * after one round with a structured PRD, then auto-approves on the next
 * stage transition. A real implementation would block on user input.
 */

import {
  latestArtifact,
  type Agent,
  type AgentContext,
  type AgentId,
  type AgentResult,
  type Proposal,
  type Stage,
} from '@rdma/core';

export const PM_ID: AgentId = 'pm';

export const PM_SCOPE: ReadonlyArray<Stage> = [
  'clarifying',
  'prd_pending_confirmation',
  'approved_for_dev',
];

function renderPRD(p: Proposal): string {
  const brief = latestArtifact(p, 'requirement_brief');
  const design = latestArtifact(p, 'design_spec');

  return [
    `# PRD: ${p.title}`,
    '',
    `## Problem`,
    `${p.rawRequirement}`,
    '',
    `## Goals`,
    `- Deliver a working artifact that solves the stated problem end-to-end.`,
    `- Keep the implementation small enough to maintain without dedicated staff.`,
    `- Ensure the artifact is testable and meets the acceptance criteria below.`,
    '',
    `## Non-goals`,
    `- Multi-tenant / multi-user support (out of scope for v1).`,
    `- Production-grade observability (we ship a local-dev tool, not a SaaS).`,
    '',
    `## User stories`,
    `- As a user, I can run the artifact with one command and get a useful result.`,
    `- As a user, I see clear errors when my input is invalid.`,
    `- As a maintainer, I can extend the artifact without rewriting the core.`,
    '',
    `## Acceptance criteria`,
    `1. The artifact compiles cleanly from a fresh clone.`,
    `2. A smoke test (provided in the implementation) passes.`,
    `3. Edge cases listed in the risk register are handled (or explicitly rejected with a clear message).`,
    `4. Documentation in README covers installation, usage, and one example.`,
    '',
    `## Risks (from research brief)`,
    brief ? 'See attached `requirement_brief` artifact.' : '_No research brief attached._',
    '',
    `## Design`,
    design ? 'See attached `design_spec` artifact.' : '_No design spec attached (non-UI work)._',
  ].join('\n');
}

function renderPlan(p: Proposal): string {
  return [
    `# Implementation Plan: ${p.title}`,
    '',
    `## Phases`,
    `1. **Setup** — repository scaffold, package manifest, test runner`,
    `2. **TDD core** — write failing tests for the primary use case; make them pass`,
    `3. **Edge cases** — extend tests to cover the risk register; fix as needed`,
    `4. **CLI surface** — expose the core as a runnable command`,
    `5. **Docs** — README, usage examples`,
    `6. **Smoke test** — end-to-end run from clean clone`,
    '',
    `## Exit criteria`,
    `- All tests pass`,
    `- CLI runs with the --help flag and one example invocation`,
    `- README is complete`,
  ].join('\n');
}

export function createPmAgent(): Agent {
  return {
    id: PM_ID,
    name: 'pm',
    scope: PM_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      switch (p.status) {
        case 'clarifying': {
          // First clarifying round: draft the PRD. Subsequent rounds:
          // (in a real implementation) incorporate feedback. For v0.1 we
          // always advance after one round.
          if (p.clarificationRound === 0) {
            const next: Proposal = {
              ...p,
              clarificationRound: 1,
              owner: PM_ID,
            };
            // We can't transition to prd_pending_confirmation inside the
            // agent — the Pipeline handles transitions. So we emit the
            // PRD as an artifact and request a transition.
            return {
              kind: 'transition',
              nextStage: 'prd_pending_confirmation',
              reason: 'PRD drafted; awaiting boss confirmation.',
              artifact: {
                kind: 'prd',
                agentId: PM_ID,
                summary: `PRD: ${p.title}`,
                content: renderPRD(next),
              },
            };
          }
          // Late round: same behavior — advance.
          return {
            kind: 'transition',
            nextStage: 'prd_pending_confirmation',
            reason: 'Clarification round complete; PRD ready for confirmation.',
          };
        }

        case 'prd_pending_confirmation': {
          // In a real implementation we'd block here until the boss
          // confirms. v0.1 auto-approves.
          return {
            kind: 'transition',
            nextStage: 'approved_for_dev',
            reason: 'PRD auto-approved (v0.1 demo mode — replace with boss approval gate).',
          };
        }

        case 'approved_for_dev': {
          // Hand off to dev with the implementation plan.
          return {
            kind: 'handoff',
            to: 'dev',
            reason: 'PRD approved; handing off to dev with implementation plan.',
            artifact: {
              kind: 'plan',
              agentId: PM_ID,
              summary: `Implementation plan: ${p.title}`,
              content: renderPlan(p),
            },
          };
        }

        default:
          throw new Error(`PM agent invoked in unexpected stage: ${p.status}`);
      }
    },
  };
}