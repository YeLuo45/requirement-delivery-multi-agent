import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  approveCollaborator,
  buildDeliveryPlan,
  createBudgetLedger,
  evaluateToolRequest,
  routeModelForAgent,
  summarizeControlPlane,
} from '../src/index.js';

const baseRequirement = {
  proposalId: 'P-20260621-009',
  projectId: 'PRJ-20260621-001',
  title: 'JSON to CSV CLI',
  rawRequirement: 'Build and verify a JSON to CSV CLI with tests.',
  scope: 'medium' as const,
  priority: 'P1' as const,
};

describe('delivery control plane', () => {
  it('builds an isolated delivery sandbox plan with TDD checkpoints', () => {
    const plan = buildDeliveryPlan(baseRequirement, {
      workspaceRoot: '/tmp/rdma-workspaces',
      defaultTestCommand: 'npm test',
    });

    assert.equal(plan.proposalId, 'P-20260621-009');
    assert.equal(plan.sandbox.path, '/tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-009');
    assert.deepEqual(plan.sandbox.allowedWrites, [
      '/tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-009',
    ]);
    assert.deepEqual(
      plan.checkpoints.map((checkpoint) => checkpoint.name),
      ['RED tests', 'GREEN implementation', 'QA acceptance', 'Patch bundle'],
    );
    assert.equal(plan.checkpoints[0]?.requiredCommand, 'npm test');
    assert.equal(plan.artifacts[0]?.kind, 'test_plan');
    assert.equal(plan.artifacts[1]?.kind, 'implementation');
  });

  it('approves collaborators only within proposal scope and records a lease', () => {
    const decision = approveCollaborator(
      {
        userId: 'reviewer-1',
        proposalId: 'P-20260621-009',
        requestedRole: 'commenter',
        requestedAccess: 'write_comment',
      },
      {
        proposalOwnerId: 'owner-1',
        shareMode: 'review',
        nowIso: '2026-06-21T15:00:00.000Z',
        leaseMinutes: 15,
      },
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.role, 'commenter');
    assert.equal(decision.permissions.canRead, true);
    assert.equal(decision.permissions.canComment, true);
    assert.equal(decision.permissions.canModifyArtifacts, false);
    assert.equal(decision.lease?.expiresAt, '2026-06-21T15:15:00.000Z');

    const denied = approveCollaborator(
      {
        userId: 'reviewer-1',
        proposalId: 'P-20260621-009',
        requestedRole: 'editor',
        requestedAccess: 'modify_artifact',
      },
      {
        proposalOwnerId: 'owner-1',
        shareMode: 'readonly',
        nowIso: '2026-06-21T15:00:00.000Z',
        leaseMinutes: 15,
      },
    );

    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /readonly/);
    assert.equal(denied.permissions.canModifyArtifacts, false);
  });

  it('enforces tool policy before sandbox execution', () => {
    const policy = {
      maxRisk: 'medium' as const,
      allowedTools: ['read_file', 'write_file', 'terminal'],
      allowedWriteRoots: ['/tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-009'],
      deniedCommandPatterns: ['rm -rf', 'curl http://metadata'],
      networkAllowed: false,
    };

    const writeDecision = evaluateToolRequest(
      {
        tool: 'write_file',
        risk: 'medium',
        path: '/tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-009/src/index.ts',
      },
      policy,
    );
    assert.equal(writeDecision.allowed, true);

    const outsideWrite = evaluateToolRequest(
      {
        tool: 'write_file',
        risk: 'medium',
        path: '/home/hermes/projects/requirement-delivery-multi-agent/package.json',
      },
      policy,
    );
    assert.equal(outsideWrite.allowed, false);
    assert.match(outsideWrite.reason, /outside allowed roots/);

    const dangerousShell = evaluateToolRequest(
      {
        tool: 'terminal',
        risk: 'high',
        command: 'rm -rf /tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-009',
      },
      policy,
    );
    assert.equal(dangerousShell.allowed, false);
    assert.match(dangerousShell.reason, /risk high exceeds/);

    const network = evaluateToolRequest({ tool: 'web_search', risk: 'low', network: true }, policy);
    assert.equal(network.allowed, false);
    assert.match(network.reason, /not in allowed tool list/);
  });

  it('routes agent models by budget and records spend', () => {
    const ledger = createBudgetLedger({ proposalId: 'P-20260621-009', maxUsd: 0.5 });

    const firstRoute = routeModelForAgent(
      { agentId: 'pm', quality: 'premium', estimatedUsd: 0.12 },
      {
        ledger,
        modelTiers: {
          cheap: 'gpt-5.4-mini',
          standard: 'gpt-5.4',
          premium: 'gpt-5.5',
        },
      },
    );
    assert.equal(firstRoute.model, 'gpt-5.5');
    assert.equal(firstRoute.allowed, true);

    ledger.record({ agentId: 'pm', model: firstRoute.model, usd: 0.42 });

    const secondRoute = routeModelForAgent(
      { agentId: 'dev', quality: 'premium', estimatedUsd: 0.12 },
      {
        ledger,
        modelTiers: {
          cheap: 'gpt-5.4-mini',
          standard: 'gpt-5.4',
          premium: 'gpt-5.5',
        },
      },
    );
    assert.equal(secondRoute.allowed, true);
    assert.equal(secondRoute.model, 'gpt-5.4-mini');
    assert.match(secondRoute.reason, /downgraded/);

    ledger.record({ agentId: 'dev', model: secondRoute.model, usd: 0.09 });
    assert.equal(ledger.snapshot().remainingUsd, 0);

    const blocked = routeModelForAgent(
      { agentId: 'qa', quality: 'standard', estimatedUsd: 0.01 },
      {
        ledger,
        modelTiers: {
          cheap: 'gpt-5.4-mini',
          standard: 'gpt-5.4',
          premium: 'gpt-5.5',
        },
      },
    );
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /budget exhausted/);
  });

  it('summarizes all four control-plane directions for reporting', () => {
    const summary = summarizeControlPlane({
      deliveryPlan: buildDeliveryPlan(baseRequirement, {
        workspaceRoot: '/tmp/rdma-workspaces',
        defaultTestCommand: 'npm test',
      }),
      collaboration: approveCollaborator(
        {
          userId: 'reader-1',
          proposalId: 'P-20260621-009',
          requestedRole: 'viewer',
          requestedAccess: 'read',
        },
        {
          proposalOwnerId: 'owner-1',
          shareMode: 'readonly',
          nowIso: '2026-06-21T15:00:00.000Z',
          leaseMinutes: 5,
        },
      ),
      toolDecision: evaluateToolRequest(
        {
          tool: 'read_file',
          risk: 'low',
          path: '/tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-009/README.md',
        },
        {
          maxRisk: 'medium',
          allowedTools: ['read_file'],
          allowedWriteRoots: [],
          deniedCommandPatterns: [],
          networkAllowed: false,
        },
      ),
      budget: createBudgetLedger({ proposalId: 'P-20260621-009', maxUsd: 1 }).snapshot(),
    });

    assert.deepEqual(summary.directions, [
      'A:delivery-sandbox',
      'B:collaboration',
      'C:tool-governance',
      'D:cost-router',
    ]);
    assert.equal(summary.readyForDevExecution, true);
    assert.match(summary.report, /sandbox/);
    assert.match(summary.report, /collaboration/);
    assert.match(summary.report, /tool policy/);
    assert.match(summary.report, /budget/);
  });
});
