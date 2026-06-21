/**
 * @rdma/core — shared types
 *
 * Every other RDMA package depends on these. Treat changes here as
 * breaking: bump a major version, update OWNERSHIP and STATUS_TRANSITIONS,
 * and add a test in state-machine.test.ts.
 */

// --- Stage / status ---------------------------------------------------------

export const STAGES = [
  'research_direction_pending',
  'research',
  'intake',
  'ideation',
  'clarifying',
  'prd_pending_confirmation',
  'approved_for_dev',
  'in_tdd_test',
  'in_dev',
  'in_test_acceptance',
  'test_failed',
  'accepted',
  'deployed',
  'delivered',
] as const;

export type Stage = (typeof STAGES)[number];

// --- Agent identity ---------------------------------------------------------

export const AGENT_IDS = [
  'market_research',
  'coordinator',
  'designer',
  'pm',
  'dev',
  'qa',
  'boss',
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

// --- Artifacts --------------------------------------------------------------

/** A durable piece of work produced by an agent. Stored inside the proposal. */
export interface Artifact {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly agentId: AgentId;
  readonly createdAt: string; // ISO 8601
  readonly summary: string;
  readonly content: string;
}

export const ARTIFACT_KINDS = [
  'requirement_brief',
  'design_spec',
  'prd',
  'plan',
  'test_plan',
  'implementation',
  'test_report',
  'acceptance_decision',
  'deployment_record',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

// --- Proposal ---------------------------------------------------------------

export interface Proposal {
  readonly id: string; // P-YYYYMMDD-NNN
  readonly projectId: string; // PRJ-YYYYMMDD-NNN
  readonly title: string;
  readonly rawRequirement: string;
  readonly sourceUrl?: string;
  status: Stage;
  owner: AgentId | null;
  clarificationRound: number;
  artifacts: Artifact[];
  createdAt: string;
  updatedAt: string;
  /** Tags carry structured context: priority, risk level, scope, etc. */
  tags: Record<string, string>;
}

// --- Handoff ----------------------------------------------------------------

export interface HandoffRecord {
  readonly id: string;
  readonly proposalId: string;
  readonly fromAgent: AgentId | null;
  readonly toAgent: AgentId;
  readonly fromStage: Stage;
  readonly toStage: Stage;
  readonly reason: string;
  readonly createdAt: string;
}

// --- Audit log --------------------------------------------------------------

export type AuditAction =
  | 'proposal.create'
  | 'proposal.update'
  | 'stage.transition'
  | 'artifact.append'
  | 'handoff.emit'
  | 'agent.handle.start'
  | 'agent.handle.end'
  | 'qa.failure'
  | 'boss.accept'
  | 'boss.revise';

export interface AuditEntry {
  readonly id: string;
  readonly proposalId: string;
  readonly actor: AgentId | 'system' | 'user';
  readonly action: AuditAction;
  readonly at: string;
  readonly detail: Record<string, unknown>;
}

// --- Agent interface --------------------------------------------------------

export interface AgentContext {
  readonly proposal: Proposal;
  readonly storage: import('./storage.js').StorageDriver;
  readonly audit: import('./audit-log.js').AuditLog;
  readonly now: () => Date;
}

export type AgentResult =
  | { kind: 'transition'; nextStage: Stage; reason: string; artifact?: Artifact }
  | { kind: 'handoff'; to: AgentId; reason: string; artifact?: Artifact }
  | { kind: 'block'; reason: string; artifact?: Artifact };

export interface Agent {
  readonly id: AgentId;
  readonly scope: ReadonlyArray<Stage>;
  readonly name: string;
  handle(ctx: AgentContext): Promise<AgentResult>;
}

// --- Errors -----------------------------------------------------------------

export class InvalidTransitionError extends Error {
  readonly from: Stage;
  readonly to: Stage;
  constructor(from: Stage, to: Stage) {
    super(`Invalid stage transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class ProposalNotFoundError extends Error {
  readonly proposalId: string;
  constructor(proposalId: string) {
    super(`Proposal not found: ${proposalId}`);
    this.name = 'ProposalNotFoundError';
    this.proposalId = proposalId;
  }
}
