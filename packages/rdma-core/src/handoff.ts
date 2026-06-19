/**
 * Handoff — coordination between agents.
 *
 * Agents never call other agents directly. They emit a HandoffEvent and let
 * the coordinator dispatch the next agent. This keeps the system composable:
 * adding a new agent never requires rewriting existing ones.
 */

import { randomUUID } from 'node:crypto';
import type { AgentId, HandoffRecord, Proposal, Stage } from './types.js';
import { assertValidTransition, ownerOf, STATUS_TRANSITIONS } from './state-machine.js';
import type { AuditLog } from './audit-log.js';

export interface HandoffEvent {
  readonly proposal: Proposal;
  readonly to: AgentId;
  readonly reason: string;
}

export class HandoffLog {
  readonly records: HandoffRecord[] = [];

  push(record: HandoffRecord): void {
    this.records.push(record);
  }
}

/**
 * Emit a handoff — mutate the proposal to the target stage (validated by the
 * state machine) and write the audit entry.
 */
export async function emitHandoff(input: {
  proposal: Proposal;
  to: AgentId;
  reason: string;
  audit: AuditLog;
  save: (p: Proposal) => Promise<void>;
  now?: Date;
}): Promise<Proposal> {
  const targetStage = nextStageOwnedBy(input.proposal.status, input.to);
  if (targetStage === null) {
    throw new Error(
      `No valid stage transition from ${input.proposal.status} to a stage owned by ${input.to}`,
    );
  }
  assertValidTransition(input.proposal.status, targetStage);

  const now = (input.now ?? new Date()).toISOString();
  const next: Proposal = {
    ...input.proposal,
    status: targetStage,
    owner: input.to,
    updatedAt: now,
    tags: { ...input.proposal.tags, last_transition_reason: input.reason },
  };

  await input.save(next);
  await input.audit.record({
    proposalId: next.id,
    projectId: next.projectId,
    actor: input.proposal.owner ?? 'system',
    action: 'handoff.emit',
    detail: { to: input.to, reason: input.reason, fromStage: input.proposal.status, toStage: targetStage },
  });

  return next;
}

/**
 * Find the next stage (one edge away from current) that is owned by the given agent.
 * Returns null if no such edge exists.
 */
export function nextStageOwnedBy(currentStage: Stage, agentId: AgentId): Stage | null {
  for (const next of STATUS_TRANSITIONS[currentStage]) {
    if (ownerOf(next) === agentId) return next;
  }
  return null;
}

/**
 * Pure helper — does the agent owning the current stage have any valid
 * downstream transitions? (Used by the coordinator to detect "stuck" proposals.)
 */
export function hasDownstreamStage(currentStage: Stage): boolean {
  return STATUS_TRANSITIONS[currentStage].length > 0;
}

/**
 * Generate an ID for a handoff record. Used by callers that need to track
 * handoffs outside the audit log.
 */
export function makeHandoffRecord(input: {
  proposal: Proposal;
  fromAgent: AgentId | null;
  toAgent: AgentId;
  reason: string;
}): HandoffRecord {
  return {
    id: randomUUID(),
    proposalId: input.proposal.id,
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    fromStage: input.proposal.status,
    toStage: input.proposal.status,
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };
}