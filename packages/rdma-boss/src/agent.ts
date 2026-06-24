/**
 * Boss agent — final decision-maker.
 *
 * Owns: accepted, deployed, delivered.
 *
 * Flow:
 *   accepted → deployed     (deploy to a local "shipped" location)
 *   deployed → delivered    (final sign-off)
 *   accepted → in_dev       (rollback to dev if needed)
 *
 * The default implementation auto-progresses through accept → deploy →
 * deliver. A real implementation would prompt the user (or read an
 * environment-supplied decision file).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Agent, AgentContext, AgentId, AgentResult } from '@rdma/core';

export const BOSS_ID: AgentId = 'boss';

export const BOSS_SCOPE: ReadonlyArray<import('@rdma/core').Stage> = [
  'accepted',
  'deployed',
  'delivered',
];

export interface BossConfig {
  /** Where to write the "deployment record" artifact on disk. */
  readonly shippedRoot?: string;
}

export function createBossAgent(config: BossConfig = {}): Agent {
  const shippedRoot =
    config.shippedRoot ??
    process.env.RDMA_SHIPPED_ROOT ??
    path.join(process.cwd(), '.rdma', 'shipped');

  return {
    id: BOSS_ID,
    name: 'boss',
    scope: BOSS_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      if (p.status === 'accepted') {
        await ctx.audit.record({
          proposalId: p.id,
          projectId: p.projectId,
          actor: BOSS_ID,
          action: 'boss.accept',
          detail: { title: p.title },
        });
        return {
          kind: 'transition',
          nextStage: 'deployed',
          reason: 'Boss accepted the work; deploying.',
        };
      }

      if (p.status === 'deployed') {
        // Write the shipped record to disk so the user can inspect.
        // We do this BEFORE the transition so the file reflects what
        // actually shipped (status='deployed'); the final status='delivered'
        // is set on the proposal in the audit log separately.
        const target = path.join(shippedRoot, p.projectId);
        await fs.mkdir(target, { recursive: true });
        const recordPath = path.join(target, `${p.id}.json`);
        await fs.writeFile(
          recordPath,
          `${JSON.stringify(
            {
              proposalId: p.id,
              projectId: p.projectId,
              title: p.title,
              deployedFromStatus: 'accepted',
              deployedAt: new Date().toISOString(),
              artifactsCount: p.artifacts.length,
            },
            null,
            2,
          )}\n`,
        );

        return {
          kind: 'transition',
          nextStage: 'delivered',
          reason: `Deployment record written to ${recordPath}; marking delivered.`,
          artifact: {
            kind: 'deployment_record',
            agentId: BOSS_ID,
            summary: `Deployed: ${p.title}`,
            content: `Deployment record at ${recordPath}`,
          },
        };
      }

      if (p.status === 'delivered') {
        // Terminal — boss agent never gets called here in normal flow
        // (the pipeline halts on terminal stages). But keep this defensive.
        return {
          kind: 'transition',
          nextStage: 'delivered',
          reason: 'Already delivered.',
        };
      }

      throw new Error(`Boss agent invoked in unexpected stage: ${p.status}`);
    },
  };
}
