/**
 * State machine — single source of truth for stage transitions.
 *
 * INVARIANTS:
 *  - Status transitions go through this file only.
 *  - STATUS_TRANSITIONS encodes every valid edge; missing edge = InvalidTransitionError.
 *  - OWNERSHIP maps every stage to exactly one agent id; no stage is unowned.
 *  - When you add a stage: update STAGES, STATUS_TRANSITIONS, OWNERSHIP, then add
 *    a test in state-machine.test.ts that walks every new edge.
 */

import type { AgentId, Stage } from './types.js';
import { AGENT_IDS, STAGES, InvalidTransitionError } from './types.js';

// Re-export the shared building blocks so consumers can `import { AGENT_IDS,
// STAGES } from '@rdma/core/state-machine'` without a separate types import.
export { AGENT_IDS, STAGES, InvalidTransitionError };

// --- Valid transitions ------------------------------------------------------

/**
 * For each "from" stage, the set of legal "to" stages.
 * This is an adjacency list, not a free-for-all map. Order in the list
 * reflects the *expected* next stage but is not enforced — only membership is.
 */
export const STATUS_TRANSITIONS: Readonly<Record<Stage, ReadonlyArray<Stage>>> = {
  // Pre-PMD research flow
  research_direction_pending: ['research'],
  research: ['intake', 'research_direction_pending'], // back-edge if research needs more direction
  intake: ['ideation', 'clarifying'], // skip design if not UI work
  ideation: ['clarifying'],
  clarifying: ['clarifying', 'prd_pending_confirmation'], // clarification can loop
  prd_pending_confirmation: ['approved_for_dev', 'clarifying'], // boss asks for revisions
  approved_for_dev: ['in_tdd_test'],

  // Implementation loop
  in_tdd_test: ['in_dev', 'approved_for_dev'], // TDD failures can re-anchor planning
  in_dev: ['in_test_acceptance', 'in_tdd_test'], // test failures re-enter TDD

  // QA loop
  in_test_acceptance: ['accepted', 'test_failed'],
  test_failed: ['in_test_acceptance', 'in_dev'], // retest after fix, or re-enter dev

  // Boss decisions
  accepted: ['deployed', 'in_dev'], // rollback if needed
  deployed: ['delivered', 'in_test_acceptance'], // hotfix path goes back through QA

  // Terminal
  delivered: [], // no further transitions
};

// --- Ownership --------------------------------------------------------------

/**
 * Every stage is owned by exactly one agent. The owning agent is the one
 * that handles the proposal when it enters that stage.
 */
export const OWNERSHIP: Readonly<Record<Stage, AgentId>> = {
  research_direction_pending: 'market_research',
  research: 'market_research',
  intake: 'coordinator',
  ideation: 'designer',
  clarifying: 'pm',
  prd_pending_confirmation: 'pm',
  approved_for_dev: 'pm',
  in_tdd_test: 'dev',
  in_dev: 'dev',
  in_test_acceptance: 'qa',
  test_failed: 'qa',
  accepted: 'boss',
  deployed: 'boss',
  delivered: 'boss',
};

// --- Public API -------------------------------------------------------------

export function isValidTransition(from: Stage, to: Stage): boolean {
  if (from === to) return false; // no-op transitions are not allowed through the machine
  return STATUS_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: Stage, to: Stage): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function ownerOf(stage: Stage): AgentId {
  return OWNERSHIP[stage];
}

/**
 * Which stages does this agent own?
 */
export function scopeOf(agentId: AgentId): ReadonlyArray<Stage> {
  return STAGES.filter((s) => OWNERSHIP[s] === agentId);
}

/**
 * Agent roster — sanity check. Every AGENT_IDS entry must own at least one
 * stage, and every stage must be owned by an existing agent id.
 */
export function validateRoster(): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];

  for (const id of AGENT_IDS) {
    if (scopeOf(id).length === 0) {
      missing.push(`agent ${id} owns no stages`);
    }
  }

  for (const stage of STAGES) {
    if (!AGENT_IDS.includes(OWNERSHIP[stage])) {
      missing.push(`stage ${stage} owned by unknown agent ${OWNERSHIP[stage]}`);
    }
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Linear walk — used by the e2e test and by the "happy path" mode.
 * Returns the sequence of stages from `from` to `to`, choosing the first valid
 * edge at each step. If `to` is unreachable, returns null.
 */
export function findPath(from: Stage, to: Stage): ReadonlyArray<Stage> | null {
  if (from === to) return [from];
  const queue: Array<{ stage: Stage; path: Stage[] }> = [{ stage: from, path: [from] }];
  const visited = new Set<Stage>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of STATUS_TRANSITIONS[current.stage]) {
      if (visited.has(next)) continue;
      const newPath = [...current.path, next];
      if (next === to) return newPath;
      visited.add(next);
      queue.push({ stage: next, path: newPath });
    }
  }

  return null;
}