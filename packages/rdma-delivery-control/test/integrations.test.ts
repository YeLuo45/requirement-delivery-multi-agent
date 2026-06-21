import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  approveCollaborator,
  buildDeliveryPlan,
  createBudgetLedger,
  createControlPlaneMetrics,
  evaluateToolRequest,
  formatCollaborationPanel,
  publishPolicyAuditEvent,
  recordBudgetMetrics,
  renderCostPrometheus,
  subscribePolicyAuditBus,
} from '../src/index.js';

const requirement = {
  proposalId: 'P-20260622-001',
  projectId: 'PRJ-20260621-001',
  title: 'Sandbox apply CLI',
  rawRequirement: 'Wire policy audit bus, prometheus cost export, and web panel.',
  scope: 'medium' as const,
  priority: 'P1' as const,
};

const basePolicy = {
  maxRisk: 'medium' as const,
  allowedTools: ['read_file', 'write_file'],
  allowedWriteRoots: ['/tmp/rdma-workspaces/PRJ-20260621-001/P-20260622-001'],
  deniedCommandPatterns: [],
  networkAllowed: false,
};

describe('control-plane integrations', () => {
  it('subscribes a policy audit bus and delivers allow/deny events', () => {
    const bus = subscribePolicyAuditBus();
    const received: string[] = [];
    bus.subscribe((event) => received.push(event.kind));

    publishPolicyAuditEvent(
      {
        proposalId: 'P-20260622-001',
        actor: 'dev',
        request: {
          tool: 'write_file',
          risk: 'medium',
          path: '/tmp/rdma-workspaces/PRJ-20260621-001/P-20260622-001/src/index.ts',
        },
        decision: evaluateToolRequest(
          {
            tool: 'write_file',
            risk: 'medium',
            path: '/tmp/rdma-workspaces/PRJ-20260621-001/P-20260622-001/src/index.ts',
          },
          basePolicy,
        ),
      },
      bus.publish,
    );

    publishPolicyAuditEvent(
      {
        proposalId: 'P-20260622-001',
        actor: 'dev',
        request: { tool: 'web_search', risk: 'low', network: true },
        decision: evaluateToolRequest(
          { tool: 'web_search', risk: 'low', network: true },
          basePolicy,
        ),
      },
      bus.publish,
    );

    assert.deepEqual(received, ['tool.policy.allowed', 'tool.policy.denied']);
    assert.equal(typeof bus.publish, 'function');
  });

  it('exports control-plane cost metrics as Prometheus exposition text', () => {
    const metrics = createControlPlaneMetrics();
    const ledger = createBudgetLedger({ proposalId: 'P-20260622-001', maxUsd: 1 });
    ledger.record({ agentId: 'pm', model: 'gpt-5.5', usd: 0.2 });
    ledger.record({ agentId: 'dev', model: 'gpt-5.4-mini', usd: 0.5 });
    recordBudgetMetrics(ledger.snapshot(), metrics);

    const text = renderCostPrometheus(metrics.snapshot(), {
      proposalId: 'P-20260622-001',
      maxUsd: 1,
      spentUsd: 0.7,
      remainingUsd: 0.3,
    });

    assert.match(text, /# HELP rdma_cost_spent_usd/);
    assert.match(text, /# TYPE rdma_cost_spent_usd gauge/);
    assert.match(text, /rdma_cost_spent_usd 0\.70/);
    assert.match(text, /rdma_cost_remaining_usd 0\.30/);
    assert.match(text, /rdma_cost_records 2/);
  });

  it('renders a JSON collaboration panel summary for TUI and web', () => {
    const viewer = approveCollaborator(
      {
        userId: 'reader-1',
        proposalId: 'P-20260622-001',
        requestedRole: 'viewer',
        requestedAccess: 'read',
      },
      {
        proposalOwnerId: 'owner-1',
        shareMode: 'readonly',
        nowIso: '2026-06-22T00:00:00.000Z',
        leaseMinutes: 15,
      },
    );
    const editor = approveCollaborator(
      {
        userId: 'editor-1',
        proposalId: 'P-20260622-001',
        requestedRole: 'editor',
        requestedAccess: 'modify_artifact',
      },
      {
        proposalOwnerId: 'owner-1',
        shareMode: 'edit',
        nowIso: '2026-06-22T00:00:00.000Z',
        leaseMinutes: 15,
      },
    );

    const text = formatCollaborationPanel([viewer, editor]);
    const payload = {
      text,
      decisions: [viewer, editor],
    };

    assert.match(payload.text, /Collaboration/);
    assert.match(payload.text, /viewer/);
    assert.match(payload.text, /editor/);
    assert.equal(payload.decisions.length, 2);
    assert.equal(payload.decisions[1]?.permissions.canModifyArtifacts, true);
  });

  it('prepares a sandbox apply summary for CLI dispatch', () => {
    const plan = buildDeliveryPlan(requirement, {
      workspaceRoot: '/tmp/rdma-workspaces',
      defaultTestCommand: 'npm test',
    });

    const summary = {
      proposalId: plan.proposalId,
      projectId: plan.projectId,
      sandboxPath: plan.sandbox.path,
      allowedWrites: plan.sandbox.allowedWrites,
      checkpointCount: plan.checkpoints.length,
      requiredArtifacts: plan.artifacts.filter((a) => a.required).map((a) => a.kind),
    };

    assert.equal(summary.proposalId, 'P-20260622-001');
    assert.equal(summary.checkpointCount, 4);
    assert.deepEqual(summary.requiredArtifacts, ['test_plan', 'implementation', 'test_report']);
    assert.equal(summary.allowedWrites.length, 1);
  });
});
