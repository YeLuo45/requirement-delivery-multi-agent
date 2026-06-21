/**
 * Proposal helpers — ID generation, status transitions, artifact appending.
 *
 * All mutations go through these helpers so the audit log and the stage
 * machine stay in lockstep.
 */

import { randomUUID } from 'node:crypto';
import type { AuditLog } from './audit-log.js';
import { assertValidTransition } from './state-machine.js';
import type { AgentId, Artifact, ArtifactKind, Proposal, Stage } from './types.js';
import { InvalidTransitionError } from './types.js';

export interface IdGenerator {
  proposalId(date: Date, seq: number): string;
  projectId(date: Date, seq: number): string;
}

export function makeIdGenerator(): IdGenerator {
  return {
    proposalId: (date: Date, seq: number) =>
      `P-${formatDate(date)}-${seq.toString().padStart(3, '0')}`,
    projectId: (date: Date, seq: number) =>
      `PRJ-${formatDate(date)}-${seq.toString().padStart(3, '0')}`,
  };
}

export function formatDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Create a fresh proposal. Always starts at `research_direction_pending`.
 */
export function createProposal(input: {
  title: string;
  rawRequirement: string;
  sourceUrl?: string;
  owner?: AgentId;
  tags?: Record<string, string>;
  ids: IdGenerator;
  projectSeq: number;
  proposalSeq: number;
  now?: Date;
}): Proposal {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: input.ids.proposalId(new Date(input.now ?? new Date()), input.proposalSeq),
    projectId: input.ids.projectId(new Date(input.now ?? new Date()), input.projectSeq),
    title: input.title,
    rawRequirement: input.rawRequirement,
    ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
    status: 'research_direction_pending',
    owner: input.owner ?? null,
    clarificationRound: 0,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
    tags: input.tags ?? {},
  };
}

/**
 * Apply a stage transition. Returns a new proposal (immutable).
 * Throws InvalidTransitionError on illegal edges.
 */
export function transition(proposal: Proposal, to: Stage, reason: string): Proposal {
  assertValidTransition(proposal.status, to);
  return {
    ...proposal,
    status: to,
    updatedAt: new Date().toISOString(),
    tags: { ...proposal.tags, last_transition_reason: reason },
  };
}

/**
 * Append an artifact. Returns a new proposal (immutable).
 */
export function appendArtifact(
  proposal: Proposal,
  artifact: Omit<Artifact, 'id' | 'createdAt'>,
): Proposal {
  const full: Artifact = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    kind: artifact.kind,
    agentId: artifact.agentId,
    summary: artifact.summary,
    content: artifact.content,
  };
  return {
    ...proposal,
    artifacts: [...proposal.artifacts, full],
    updatedAt: full.createdAt,
  };
}

export function latestArtifact(proposal: Proposal, kind: ArtifactKind): Artifact | null {
  for (let i = proposal.artifacts.length - 1; i >= 0; i--) {
    const a = proposal.artifacts[i];
    if (a && a.kind === kind) return a;
  }
  return null;
}

/**
 * Persist a proposal + write the matching audit entries.
 * The single chokepoint for "save a proposal that just changed."
 */
export async function persist(
  proposal: Proposal,
  prevStatus: Stage | null,
  audit: AuditLog,
  save: (p: Proposal) => Promise<void>,
): Promise<Proposal> {
  await save(proposal);

  // First-time create?
  if (prevStatus === null) {
    await audit.record({
      proposalId: proposal.id,
      projectId: proposal.projectId,
      actor: 'system',
      action: 'proposal.create',
      detail: { title: proposal.title, status: proposal.status, projectId: proposal.projectId },
    });
    return proposal;
  }

  // Stage transition?
  if (prevStatus !== proposal.status) {
    await audit.record({
      proposalId: proposal.id,
      projectId: proposal.projectId,
      actor: proposal.owner ?? 'system',
      action: 'stage.transition',
      detail: {
        from: prevStatus,
        to: proposal.status,
        reason: proposal.tags.last_transition_reason ?? '',
      },
    });
  } else {
    await audit.record({
      proposalId: proposal.id,
      projectId: proposal.projectId,
      actor: proposal.owner ?? 'system',
      action: 'proposal.update',
      detail: { status: proposal.status },
    });
  }

  return proposal;
}

// Re-export InvalidTransitionError for convenience
export { InvalidTransitionError };
