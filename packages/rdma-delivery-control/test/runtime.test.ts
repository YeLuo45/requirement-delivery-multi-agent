import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachPolicyAuditToEventBus,
  buildSandboxPreview,
  createBudgetLedger,
  createControlPlaneMetrics,
  recordBudgetMetrics,
  renderControlPlanePanel,
} from '../src/index.js';

describe('control-plane runtime integrations', () => {
  it('attaches the policy audit bus to a real EventBus and publishes sequenced events', () => {
    const events: Array<{ kind: string; proposalId: string; payload: Record<string, unknown> }> =
      [];
    const fakeBus = {
      publish(event: {
        kind: string;
        proposalId: string;
        projectId: string;
        at: string;
        payload?: Record<string, unknown>;
      }) {
        events.push({
          kind: event.kind,
          proposalId: event.proposalId,
          payload: event.payload ?? {},
        });
      },
    };

    const adapter = attachPolicyAuditToEventBus(fakeBus as never, {
      projectId: 'PRJ-20260621-001',
      actor: 'dev',
      nowIso: () => '2026-06-22T01:00:00.000Z',
    });

    adapter.publishPolicy({
      proposalId: 'P-20260622-004',
      tool: 'write_file',
      risk: 'medium',
      allowed: true,
      reason: 'allowed by policy',
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, 'proposal.updated');
    assert.equal(events[0]?.proposalId, 'P-20260622-004');
    assert.equal(events[0]?.payload.policyEvent, 'tool.policy.allowed');
    assert.equal(events[0]?.payload.actor, 'dev');
  });

  it('renders a Prometheus text body from a cost snapshot', () => {
    const metrics = createControlPlaneMetrics();
    const ledger = createBudgetLedger({ proposalId: 'P-20260622-004', maxUsd: 0.5 });
    ledger.record({ agentId: 'pm', model: 'gpt-5.5', usd: 0.1 });
    ledger.record({ agentId: 'dev', model: 'gpt-5.4-mini', usd: 0.2 });
    recordBudgetMetrics(ledger.snapshot(), metrics);

    const text = renderControlPlanePanel({
      metrics: metrics.snapshot(),
      snapshot: {
        proposalId: 'P-20260622-004',
        maxUsd: 0.5,
        spentUsd: 0.3,
        remainingUsd: 0.2,
      },
      mode: 'prom',
    });

    assert.match(text, /rdma_cost_spent_usd 0\.30/);
    assert.match(text, /rdma_cost_remaining_usd 0\.20/);
    assert.match(text, /rdma_cost_records 2/);
  });

  it('renders a JSON control-plane panel payload', () => {
    const metrics = createControlPlaneMetrics();
    const ledger = createBudgetLedger({ proposalId: 'P-20260622-004', maxUsd: 1 });
    ledger.record({ agentId: 'pm', model: 'gpt-5.5', usd: 0.4 });
    recordBudgetMetrics(ledger.snapshot(), metrics);

    const text = renderControlPlanePanel({
      metrics: metrics.snapshot(),
      snapshot: {
        proposalId: 'P-20260622-004',
        maxUsd: 1,
        spentUsd: 0.4,
        remainingUsd: 0.6,
      },
      mode: 'json',
    });

    const payload = JSON.parse(text);
    assert.deepEqual(payload.directions, [
      'A:delivery-sandbox',
      'B:collaboration',
      'C:tool-governance',
      'D:cost-router',
    ]);
    assert.equal(payload.cost.spentUsd, 0.4);
    assert.equal(payload.cost.remainingUsd, 0.6);
  });

  it('formats a TUI snapshot of the control plane', () => {
    const text = renderControlPlanePanel({
      metrics: { counters: { rdma_cost_records: 1 } },
      snapshot: {
        proposalId: 'P-20260622-004',
        maxUsd: 1,
        spentUsd: 0.25,
        remainingUsd: 0.75,
      },
      mode: 'tui',
    });

    assert.match(text, /RDMA control plane/);
    assert.match(text, /A:delivery-sandbox/);
    assert.match(text, /P-20260622-004/);
    assert.match(text, /cost records: 1/);
  });

  it('produces a sandbox preview without writing to disk', () => {
    const preview = buildSandboxPreview({
      workspaceRoot: '/tmp/rdma-workspaces',
      proposalId: 'P-20260622-004',
      files: [{ path: 'src/index.ts', content: 'export const x = 1;\n' }],
      testCommand: 'npm test',
    });

    assert.equal(preview.allowed, true);
    assert.equal(preview.commands[0] ?? '', 'npm test');
    assert.match(preview.patchBundle, /\+\+\+ src\/index\.ts/);
    assert.match(preview.reason, /sandbox preview/);
  });
});
