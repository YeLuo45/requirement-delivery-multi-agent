/**
 * Agent interface and a small registry helper.
 *
 * Each agent package (rdma-coordinator, rdma-pm, ...) exports a default
 * `create<Name>Agent(): Agent` factory. The coordinator loads all seven
 * factories and stores the resulting agents in a registry keyed by AgentId.
 */

import type { Agent, AgentId } from './types.js';

export class AgentRegistry {
  private readonly agents = new Map<AgentId, Agent>();

  /**
   * Register an agent. If an agent with the same id is already registered,
   * throws — call `replace()` to swap an existing one (useful for tests
   * that exercise the QA rework loop).
   */
  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`);
    }
    this.agents.set(agent.id, agent);
  }

  /**
   * Replace an already-registered agent, or register a new one.
   * Used by tests that need to swap QA between failure and pass modes
   * mid-pipeline. Production code should call `register()`.
   */
  replace(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  get(id: AgentId): Agent {
    const a = this.agents.get(id);
    if (!a) throw new Error(`Agent not registered: ${id}`);
    return a;
  }

  has(id: AgentId): boolean {
    return this.agents.has(id);
  }

  all(): ReadonlyArray<Agent> {
    return Array.from(this.agents.values());
  }

  /**
   * The single agent that owns the given stage, or undefined if the stage is
   * not owned by any registered agent.
   */
  ownerOfStage(stage: import('./types.js').Stage): Agent | undefined {
    for (const a of this.agents.values()) {
      if (a.scope.includes(stage)) return a;
    }
    return undefined;
  }
}
