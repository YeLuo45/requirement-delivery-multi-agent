/**
 * Coordinator agent — the entry point of the pipeline.
 *
 * Owns the `intake` stage. When a proposal enters intake, the coordinator:
 *   1. Captures the user intent (title, rawRequirement, sourceUrl).
 *   2. Tags the proposal with priority, scope, risk_level.
 *   3. Hands off to designer (if UI work) or pm (skip design).
 *
 * The coordinator also runs the dispatcher — when other agents return a
 * `handoff` result, the coordinator walks the state machine until the
 * proposal reaches a terminal stage.
 */

import {
  appendArtifact,
  createProposal,
  emitHandoff,
  formatDate,
  makeIdGenerator,
  ownerOf,
  persist,
  scopeOf,
  transition,
  type Agent,
  type AgentContext,
  type AgentId,
  type AgentResult,
  type ArtifactKind,
  type AuditLog,
  type EventBus,
  type EventKind,
  type Proposal,
  type Stage,
} from '@rdma/core';

// Re-export scopeOf so consumers can find it via the package
export { scopeOf as SCOPE_OF } from '@rdma/core';

export const COORDINATOR_ID: AgentId = 'coordinator';

export const COORDINATOR_SCOPE: ReadonlyArray<Stage> = ['intake'];

/**
 * Default project / proposal sequence counters — kept in memory.
 * For real persistence, replace with a counters.json file.
 */
export class SequenceCounter {
  private readonly projectSeqByDate = new Map<string, number>();
  private readonly proposalSeqByDate = new Map<string, number>();

  nextProject(now: Date = new Date()): number {
    const key = formatDate(now);
    const cur = this.projectSeqByDate.get(key) ?? 0;
    const next = cur + 1;
    this.projectSeqByDate.set(key, next);
    return next;
  }

  nextProposal(now: Date = new Date()): number {
    const key = formatDate(now);
    const cur = this.proposalSeqByDate.get(key) ?? 0;
    const next = cur + 1;
    this.proposalSeqByDate.set(key, next);
    return next;
  }
}

export function createCoordinatorAgent(): Agent {
  return {
    id: COORDINATOR_ID,
    name: 'coordinator',
    scope: COORDINATOR_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      // The coordinator's handle() runs when a proposal enters `intake`.
      // At this point the proposal should already have a title and raw
      // requirement (set at creation time). We tag it and hand off.
      const tags: Record<string, string> = {
        ...p.tags,
        priority: p.tags['priority'] ?? 'P2',
        scope: p.tags['scope'] ?? 'medium',
        risk_level: p.tags['risk_level'] ?? 'medium',
        captured_at: new Date().toISOString(),
      };

      const tagged: Proposal = { ...p, tags, owner: COORDINATOR_ID };

      // Decide: UI work goes through designer, otherwise straight to PM.
      // Use word-boundary regex so "build" doesn't accidentally match "ui".
      const isUiWork = /\b(ui|ux|interface|frontend|page|web\s*app|webapp)\b|design\s+(spec|system|doc)/i.test(
        `${tagged.title} ${tagged.rawRequirement}`,
      );

      const summary = isUiWork
        ? 'Captured intent; routing through designer before PRD.'
        : 'Captured intent; routing directly to PM.';

      const intakeArtifact = {
        kind: 'requirement_brief' as ArtifactKind,
        agentId: COORDINATOR_ID,
        summary,
        content: `Title: ${tagged.title}\nRaw requirement: ${tagged.rawRequirement}\n${tagged.sourceUrl ? `Source: ${tagged.sourceUrl}\n` : ''}Priority: ${tags['priority']}\nScope: ${tags['scope']}\nRisk: ${tags['risk_level']}\nUI work: ${isUiWork}`,
      };

      const nextAgent: AgentId = isUiWork ? 'designer' : 'pm';

      return { kind: 'handoff', to: nextAgent, reason: summary, artifact: intakeArtifact };
    },
  };
}

// --- Pipeline driver --------------------------------------------------------

/**
 * Drive a proposal through the state machine, one agent at a time.
 *
 * This is the only piece of code that calls `proposal.handle()` directly.
 * Each call to `step()` performs at most one agent invocation.
 */
export class Pipeline {
  private readonly registry: import('@rdma/core').AgentRegistry;
  readonly storage: import('@rdma/core').StorageDriver;
  readonly audit: AuditLog;
  private readonly counter: SequenceCounter;
  private readonly bus: EventBus | null;

  constructor(deps: {
    registry: import('@rdma/core').AgentRegistry;
    storage: import('@rdma/core').StorageDriver;
    audit: AuditLog;
    counter?: SequenceCounter;
    bus?: EventBus;
  }) {
    this.registry = deps.registry;
    this.storage = deps.storage;
    this.audit = deps.audit;
    this.counter = deps.counter ?? new SequenceCounter();
    this.bus = deps.bus ?? null;
  }

  /** Emit a realtime event (no-op if no bus was supplied). */
  private emit(kind: EventKind, proposal: Proposal, payload?: Record<string, unknown>): void {
    if (!this.bus) return;
    this.bus.publish({
      kind,
      proposalId: proposal.id,
      projectId: proposal.projectId,
      at: new Date().toISOString(),
      ...(payload ? { payload } : {}),
    });
  }

  /** Create a new proposal and return it. Does NOT auto-step the pipeline. */
  async createProposal(input: { title: string; rawRequirement: string; sourceUrl?: string; tags?: Record<string, string> }): Promise<Proposal> {
    const now = new Date();
    const ids = makeIdGenerator();
    const proposal = createProposal({
      title: input.title,
      rawRequirement: input.rawRequirement,
      ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ids,
      projectSeq: this.counter.nextProject(now),
      proposalSeq: this.counter.nextProposal(now),
      now,
    });
    await persist(proposal, null, this.audit, (p) => this.storage.saveProposal(p));
    this.emit('proposal.created', proposal, { title: proposal.title });
    return proposal;
  }

  /**
   * Drive a proposal forward by at most one step. Returns the updated proposal.
   * If the proposal is in a terminal stage, returns it unchanged.
   */
  async step(proposal: Proposal): Promise<Proposal> {
    if (proposal.status === 'delivered') return proposal;

    const ownerId = ownerOf(proposal.status);
    const agent = this.registry.get(ownerId);
    if (!agent.scope.includes(proposal.status)) {
      throw new Error(
        `Agent ${agent.id} is registered but does not own stage ${proposal.status}`,
      );
    }

    const ctx: AgentContext = {
      proposal,
      storage: this.storage,
      audit: this.audit,
      now: () => new Date(),
    };

    await this.audit.record({
      proposalId: proposal.id,
      projectId: proposal.projectId,
      actor: agent.id,
      action: 'agent.handle.start',
      detail: { stage: proposal.status },
    });
    this.emit('audit.appended', proposal, { stage: proposal.status, kind: 'agent.handle.start' });

    const result = await agent.handle(ctx);

    await this.audit.record({
      proposalId: proposal.id,
      projectId: proposal.projectId,
      actor: agent.id,
      action: 'agent.handle.end',
      detail: { stage: proposal.status, resultKind: result.kind, next: result.kind === 'handoff' ? result.to : result.kind === 'transition' ? result.nextStage : null },
    });
    this.emit('audit.appended', proposal, { stage: proposal.status, kind: 'agent.handle.end', resultKind: result.kind });

    if (result.kind === 'handoff') {
      // Apply artifact (if any) before transition.
      let updated = proposal;
      if (result.artifact) {
        updated = appendArtifact(updated, result.artifact);
      }
      const after = await emitHandoff({
        proposal: { ...updated, owner: agent.id },
        to: result.to,
        reason: result.reason,
        audit: this.audit,
        save: (p) => this.storage.saveProposal(p),
      });
      this.emit('stage.transitioned', after, { to: result.to, reason: result.reason });
      this.emit('proposal.updated', after, { status: after.status });
      return after;
    }

    if (result.kind === 'transition') {
      let updated = proposal;
      if (result.artifact) {
        updated = appendArtifact(updated, result.artifact);
      }
      const transitioned = transition(updated, result.nextStage, result.reason);
      // Keep the owner as the agent that produced this artifact (unless the
      // new stage is owned by a different agent — that case is handled by
      // emitHandoff, not here).
      const next: Proposal = { ...transitioned, owner: agent.id };
      await persist(next, proposal.status, this.audit, (p) => this.storage.saveProposal(p));
      this.emit('stage.transitioned', next, { from: proposal.status, to: next.status, reason: result.reason });
      this.emit('proposal.updated', next, { status: next.status });
      return next;
    }

    // kind === 'block' — record an artifact but do not transition.
    if (result.artifact) {
      const withArtifact = appendArtifact(proposal, result.artifact);
      await persist(withArtifact, proposal.status, this.audit, (p) => this.storage.saveProposal(p));
      this.emit('proposal.updated', withArtifact, { status: withArtifact.status, kind: 'block' });
      return withArtifact;
    }

    return proposal;
  }

  /**
   * Drive a proposal all the way to a terminal stage.
   * Used by the CLI's `deliver` command and by the e2e smoke test.
   * `maxSteps` is a safety brake (default 100).
   */
  async runToCompletion(proposal: Proposal, maxSteps = 100): Promise<Proposal> {
    let current = proposal;
    for (let i = 0; i < maxSteps; i++) {
      if (current.status === 'delivered') return current;
      const prevStatus = current.status;
      current = await this.step(current);
      if (current.status === prevStatus) {
        // No progress — agent returned 'block' or the loop is stuck.
        // Surface this so the caller can decide what to do.
        throw new Error(
          `Pipeline stuck at ${current.status} for proposal ${current.id}: agent returned no transition`,
        );
      }
    }
    throw new Error(`Pipeline exceeded ${maxSteps} steps for proposal ${proposal.id}`);
  }
}