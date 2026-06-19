/**
 * Audit log — append-only structured log of every action that touches a proposal.
 *
 * Lines are JSON-encoded. We use a separate JSONL file per proposal under
 * `.rdma/audit/<project-id>/<proposal-id>.jsonl`. The web dashboard reads these
 * to render the handoff timeline.
 */

import { randomUUID } from 'node:crypto';
import type { AgentId, AuditAction, AuditEntry } from './types.js';
import type { Storage } from './storage.js';

export class AuditLog {
  readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async record(input: {
    proposalId: string;
    projectId: string;
    actor: AgentId | 'system' | 'user';
    action: AuditAction;
    detail?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: randomUUID(),
      proposalId: input.proposalId,
      actor: input.actor,
      action: input.action,
      at: new Date().toISOString(),
      detail: input.detail ?? {},
    };
    await this.storage.appendAudit(input.proposalId, input.projectId, JSON.stringify(entry));
    return entry;
  }

  async list(proposalId: string, projectId: string): Promise<ReadonlyArray<AuditEntry>> {
    const lines = await this.storage.readAudit(proposalId, projectId);
    return lines.map((line) => JSON.parse(line) as AuditEntry);
  }

  /**
   * Reconstruct the handoff chain — every actor that touched the proposal,
   * in order. Used by the web dashboard for the "Handoff Timeline" view.
   */
  async handoffChain(proposalId: string, projectId: string): Promise<ReadonlyArray<AgentId | 'user'>> {
    const entries = await this.list(proposalId, projectId);
    const chain: Array<AgentId | 'user'> = [];
    for (const e of entries) {
      if (e.actor === 'system') continue; // skip system entries
      const last = chain[chain.length - 1];
      if (last !== e.actor) chain.push(e.actor);
    }
    return chain;
  }
}