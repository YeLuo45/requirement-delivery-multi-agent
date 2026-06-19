/**
 * Product manager agent.
 *
 * Owns three stages:
 *   clarifying              — drafts PRD, runs clarification rounds
 *   prd_pending_confirmation — PRD is written; awaiting boss approval
 *   approved_for_dev        — PM hands off to dev with the implementation plan
 *
 * Two modes:
 *   - **Mock mode** (default, no model): deterministic PRD/plan rendering.
 *     Used in tests and the v0.1 demo path.
 *   - **LLM mode** (model provided): uses an `LlmProvider` from `@rdma/llm`
 *     to generate PRD / plan text. Adds structure: produces the same
 *     Markdown shape the deterministic version does, so downstream agents
 *     can parse it identically.
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
import type { LlmProvider } from '@rdma/llm';

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
    `- CLI runs with --help flag and one example invocation`,
    `- README is complete`,
  ].join('\n');
}

/** Shape we extract from the LLM's PRD response. */
function extractSection(text: string, header: string): string {
  const lines = text.split('\n');
  let capturing = false;
  const out: string[] = [];
  for (const line of lines) {
    if (line.match(/^#{1,3}\s/)) {
      if (line.toLowerCase().includes(header.toLowerCase())) {
        capturing = true;
        continue;
      } else if (capturing) {
        break;
      }
    }
    if (capturing) out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * Render PRD via LLM. We ask the model to produce Markdown with the standard
 * sections (Problem / Goals / Non-goals / User stories / Acceptance criteria);
 * we then re-format to match the deterministic shape so downstream parsers
 * don't care which mode produced the PRD.
 */
async function renderPRDViaLlm(
  p: Proposal,
  model: LlmProvider,
): Promise<string> {
  const systemPrompt =
    'You are a product manager writing a PRD for a small, single-developer ' +
    'open-source tool. Be concise. Use Markdown sections exactly as specified. ' +
    'Do not invent features beyond what the requirement asks for. ' +
    'Keep the non-goals list short and honest.';

  const userPrompt = [
    `Title: ${p.title}`,
    `Requirement: ${p.rawRequirement}`,
    p.sourceUrl ? `Source: ${p.sourceUrl}` : '',
    '',
    'Produce a PRD with these sections (use exactly these Markdown headers):',
    '',
    '# PRD: <title>',
    '## Problem',
    '## Goals',
    '## Non-goals',
    '## User stories',
    '## Acceptance criteria',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await model.complete({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 1500,
    temperature: 0.4,
  });

  // Compose the final PRD. We use the LLM output for the free-form sections
  // and append the auto-derived Risks / Design sections from attached artifacts
  // (so downstream agents don't need to know whether the PRD was LLM-generated).
  const problem = extractSection(result.text, '## Problem') || p.rawRequirement;
  const goals = extractSection(result.text, '## Goals');
  const nonGoals = extractSection(result.text, '## Non-goals');
  const userStories = extractSection(result.text, '## User stories');
  const acceptance = extractSection(result.text, '## Acceptance criteria');

  const brief = latestArtifact(p, 'requirement_brief');
  const design = latestArtifact(p, 'design_spec');

  return [
    `# PRD: ${p.title}`,
    '',
    `## Problem`,
    problem,
    '',
    `## Goals`,
    goals || '- Deliver a working artifact that solves the stated problem end-to-end.',
    '',
    `## Non-goals`,
    nonGoals || '- Production-grade observability.\n- Multi-tenant support.',
    '',
    `## User stories`,
    userStories || '- As a user, I can run the artifact with one command.',
    '',
    `## Acceptance criteria`,
    acceptance ||
      '1. The artifact compiles cleanly from a fresh clone.\n2. A smoke test passes.\n3. Edge cases are handled.',
    '',
    `## Risks (from research brief)`,
    brief ? 'See attached `requirement_brief` artifact.' : '_No research brief attached._',
    '',
    `## Design`,
    design ? 'See attached `design_spec` artifact.' : '_No design spec attached (non-UI work)._',
  ].join('\n');
}

/**
 * Render implementation plan via LLM.
 */
async function renderPlanViaLlm(p: Proposal, model: LlmProvider): Promise<string> {
  const systemPrompt =
    'You are a senior engineer writing an implementation plan for a small ' +
    'open-source tool. Be concrete. Use Markdown sections. Phases should be ' +
    'ordered and each should have a clear exit criterion.';

  const userPrompt = [
    `Title: ${p.title}`,
    `Requirement: ${p.rawRequirement}`,
    '',
    'Produce a plan with these Markdown sections:',
    '# Implementation Plan: <title>',
    '## Phases',
    '## Exit criteria',
  ].join('\n');

  const result = await model.complete({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 1000,
    temperature: 0.3,
  });

  const phases = extractSection(result.text, '## Phases');
  const exitCriteria = extractSection(result.text, '## Exit criteria');

  return [
    `# Implementation Plan: ${p.title}`,
    '',
    `## Phases`,
    phases ||
      '1. Setup\n2. TDD core\n3. Edge cases\n4. CLI surface\n5. Docs\n6. Smoke test',
    '',
    `## Exit criteria`,
    exitCriteria || '- All tests pass\n- CLI runs with --help and one example\n- README is complete',
  ].join('\n');
}

export interface PmAgentConfig {
  /** Optional LLM provider. When omitted, falls back to deterministic rendering. */
  model?: LlmProvider;
}

export function createPmAgent(config: PmAgentConfig = {}): Agent {
  const model = config.model;

  return {
    id: PM_ID,
    name: 'pm',
    scope: PM_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      switch (p.status) {
        case 'clarifying': {
          if (p.clarificationRound === 0) {
            const next: Proposal = {
              ...p,
              clarificationRound: 1,
              owner: PM_ID,
            };
            const content = model
              ? await renderPRDViaLlm(next, model)
              : renderPRD(next);
            return {
              kind: 'transition',
              nextStage: 'prd_pending_confirmation',
              reason: 'PRD drafted; awaiting boss confirmation.',
              artifact: {
                kind: 'prd',
                agentId: PM_ID,
                summary: `PRD: ${p.title}${model ? ' (LLM)' : ''}`,
                content,
              },
            };
          }
          return {
            kind: 'transition',
            nextStage: 'prd_pending_confirmation',
            reason: 'Clarification round complete; PRD ready for confirmation.',
          };
        }

        case 'prd_pending_confirmation': {
          return {
            kind: 'transition',
            nextStage: 'approved_for_dev',
            reason: 'PRD auto-approved (v0.1 demo mode — replace with boss approval gate).',
          };
        }

        case 'approved_for_dev': {
          const content = model
            ? await renderPlanViaLlm(p, model)
            : renderPlan(p);
          return {
            kind: 'handoff',
            to: 'dev',
            reason: 'PRD approved; handing off to dev with implementation plan.',
            artifact: {
              kind: 'plan',
              agentId: PM_ID,
              summary: `Implementation plan: ${p.title}${model ? ' (LLM)' : ''}`,
              content,
            },
          };
        }

        default:
          throw new Error(`PM agent invoked in unexpected stage: ${p.status}`);
      }
    },
  };
}