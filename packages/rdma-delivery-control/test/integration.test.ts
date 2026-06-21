import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  approveCollaborator,
  buildDeliveryPlan,
  createBudgetLedger,
  createControlPlaneMetrics,
  evaluateToolRequest,
  executeSandboxPatch,
  formatCollaborationPanel,
  publishPolicyAuditEvent,
  recordBudgetMetrics,
} from '../src/index.js';

const requirement = {
  proposalId: 'P-20260621-011',
  projectId: 'PRJ-20260621-001',
  title: 'Sandbox Executor',
  rawRequirement: 'Apply a small file patch inside an isolated workspace.',
  scope: 'medium' as const,
  priority: 'P1' as const,
};

function makePlan(workspaceRoot: string) {
  return buildDeliveryPlan(requirement, {
    workspaceRoot,
    defaultTestCommand: 'npm test',
  });
}

describe('delivery control integrations', () => {
  it('executes an in-sandbox patch and returns a reviewable bundle', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-sandbox-'));
    try {
      const plan = makePlan(root);
      const result = executeSandboxPatch(plan, {
        files: [
          { path: 'src/index.ts', content: 'export const answer = 42;\n' },
          { path: 'README.md', content: '# sandbox\n' },
        ],
        testCommand: 'npm test',
      });

      assert.equal(result.allowed, true);
      assert.equal(result.writtenFiles.length, 2);
      assert.equal(
        readFileSync(path.join(plan.sandbox.path, 'src/index.ts'), 'utf8'),
        'export const answer = 42;\n',
      );
      assert.match(result.patchBundle, /src\/index.ts/);
      assert.match(result.patchBundle, /README.md/);
      assert.deepEqual(result.commands, ['npm test']);

      const denied = executeSandboxPatch(plan, {
        files: [{ path: '../escape.txt', content: 'nope' }],
        testCommand: 'npm test',
      });
      assert.equal(denied.allowed, false);
      assert.match(denied.reason, /outside sandbox/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('publishes policy audit events for allowed and denied tool requests', () => {
    const events: Array<{ kind: string; payload: unknown }> = [];
    const policy = {
      maxRisk: 'medium' as const,
      allowedTools: ['read_file', 'write_file'],
      allowedWriteRoots: ['/tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-011'],
      deniedCommandPatterns: [],
      networkAllowed: false,
    };

    const allowed = publishPolicyAuditEvent(
      {
        proposalId: 'P-20260621-011',
        actor: 'dev',
        request: {
          tool: 'write_file',
          risk: 'medium',
          path: '/tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-011/src/index.ts',
        },
        decision: evaluateToolRequest(
          {
            tool: 'write_file',
            risk: 'medium',
            path: '/tmp/rdma-workspaces/PRJ-20260621-001/P-20260621-011/src/index.ts',
          },
          policy,
        ),
      },
      (event) => events.push(event),
    );

    const denied = publishPolicyAuditEvent(
      {
        proposalId: 'P-20260621-011',
        actor: 'dev',
        request: { tool: 'web_search', risk: 'low', network: true },
        decision: evaluateToolRequest({ tool: 'web_search', risk: 'low', network: true }, policy),
      },
      (event) => events.push(event),
    );

    assert.equal(allowed.kind, 'tool.policy.allowed');
    assert.equal(denied.kind, 'tool.policy.denied');
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((event) => event.kind),
      ['tool.policy.allowed', 'tool.policy.denied'],
    );
  });

  it('records cost metrics from a budget ledger snapshot', () => {
    const ledger = createBudgetLedger({ proposalId: 'P-20260621-011', maxUsd: 1 });
    ledger.record({ agentId: 'pm', model: 'gpt-5.4', usd: 0.25 });
    ledger.record({ agentId: 'dev', model: 'gpt-5.4-mini', usd: 0.4 });

    const metrics = createControlPlaneMetrics();
    const snapshot = recordBudgetMetrics(ledger.snapshot(), metrics);

    assert.equal(snapshot.remainingUsd, 0.35);
    assert.equal(metrics.snapshot().counters['rdma.cost.records'], 2);
    assert.equal(metrics.snapshot().counters['rdma.cost.spent_cents'], 65);
    assert.equal(metrics.snapshot().counters['rdma.cost.remaining_cents'], 35);
  });

  it('formats collaboration decisions for TUI and web panels', () => {
    const viewer = approveCollaborator(
      {
        userId: 'reader-1',
        proposalId: 'P-20260621-011',
        requestedRole: 'viewer',
        requestedAccess: 'read',
      },
      {
        proposalOwnerId: 'owner-1',
        shareMode: 'readonly',
        nowIso: '2026-06-21T16:00:00.000Z',
        leaseMinutes: 10,
      },
    );

    const editor = approveCollaborator(
      {
        userId: 'editor-1',
        proposalId: 'P-20260621-011',
        requestedRole: 'editor',
        requestedAccess: 'modify_artifact',
      },
      {
        proposalOwnerId: 'owner-1',
        shareMode: 'edit',
        nowIso: '2026-06-21T16:00:00.000Z',
        leaseMinutes: 10,
      },
    );

    const panel = formatCollaborationPanel([viewer, editor]);

    assert.match(panel, /Collaboration/);
    assert.match(panel, /viewer/);
    assert.match(panel, /editor/);
    assert.match(panel, /read/);
    assert.match(panel, /comment/);
    assert.match(panel, /modify/);
    assert.match(panel, /2026-06-21T16:10:00.000Z/);
  });
});
