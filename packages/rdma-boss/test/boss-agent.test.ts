import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { AgentContext, Proposal } from '@rdma/core';
import { createBossAgent } from '../src/agent.js';

function deployedProposal(): Proposal {
  return {
    id: 'P-test',
    projectId: 'PRJ-test',
    title: 'demo deployment',
    status: 'deployed',
    priority: 'P2',
    scope: 'small',
    requirement: 'Ship a demo record',
    artifacts: [],
    audit: [],
    createdAt: '2026-06-24T00:00:00.000Z',
    updatedAt: '2026-06-24T00:00:00.000Z',
  };
}

describe('boss agent deployment records', () => {
  it('writes newline-terminated JSON deployment records', async () => {
    const shippedRoot = mkdtempSync(path.join(tmpdir(), 'rdma-boss-shipped-'));
    const agent = createBossAgent({ shippedRoot });
    const proposal = deployedProposal();
    const ctx: AgentContext = {
      proposal,
      audit: {
        record: async () => undefined,
      },
    };

    const result = await agent.handle(ctx);
    const record = readFileSync(
      path.join(shippedRoot, proposal.projectId, `${proposal.id}.json`),
      'utf8',
    );

    assert.equal(result.nextStage, 'delivered');
    assert.ok(record.endsWith('\n'));
  });
});
