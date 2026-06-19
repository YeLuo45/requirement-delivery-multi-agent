/**
 * EventEmittingStorage — wraps any StorageDriver so that mutations
 * automatically publish EventBus events.
 *
 * Mapping:
 *   saveProposal   -> proposal.updated     (with status payload)
 *   appendAudit    -> audit.appended       (with the raw line)
 *
 * Reads (listProposals, getProposal, readAudit, listProjects, readMeta)
 * are pass-through and do not emit events.
 *
 * The wrapper never throws on publish errors (EventBus itself swallows
 * them), so a broken subscriber cannot corrupt storage writes.
 */

import type { StorageDriver } from '@rdma/core';
import { EventBus, type Event } from './event-bus.js';

export class EventEmittingStorage implements StorageDriver {
  readonly backendName: string;
  readonly root: string;

  constructor(
    private readonly inner: StorageDriver,
    private readonly bus: EventBus,
  ) {
    this.backendName = `${inner.backendName}+bus`;
    this.root = inner.root;
  }

  async init(): Promise<void> {
    return this.inner.init();
  }

  async saveProposal(proposal: import('@rdma/core').Proposal): Promise<void> {
    await this.inner.saveProposal(proposal);
    const event: Event = {
      kind: 'proposal.updated',
      proposalId: proposal.id,
      projectId: proposal.projectId,
      at: new Date().toISOString(),
      payload: { status: proposal.status, artifactCount: proposal.artifacts.length },
    };
    this.bus.publish(event);
  }

  async appendAudit(proposalId: string, projectId: string, line: string): Promise<void> {
    await this.inner.appendAudit(proposalId, projectId, line);
    const event: Event = {
      kind: 'audit.appended',
      proposalId,
      projectId,
      at: new Date().toISOString(),
      payload: { line },
    };
    this.bus.publish(event);
  }

  // Pass-through reads — no events emitted.
  async getProposal(proposalId: string): Promise<import('@rdma/core').Proposal> {
    return this.inner.getProposal(proposalId);
  }

  async listProposals(projectId?: string): Promise<ReadonlyArray<import('@rdma/core').Proposal>> {
    return this.inner.listProposals(projectId);
  }

  async listProjects(): Promise<ReadonlyArray<string>> {
    return this.inner.listProjects();
  }

  async readAudit(proposalId: string, projectId: string): Promise<ReadonlyArray<string>> {
    return this.inner.readAudit(proposalId, projectId);
  }

  async readMeta(): Promise<{ version: number; createdAt: string }> {
    return this.inner.readMeta();
  }
}