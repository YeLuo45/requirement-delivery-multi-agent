import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createBudgetLedger,
  formatSandboxPatchAsGitApply,
  loadLedgerFromStorage,
  parseLedgerFromSnapshot,
  publishPolicyEventToBus,
  subscribeTuiPanelUpdates,
  trackLlmSpend,
} from '../src/index.js';

describe('control-plane v2 integrations', () => {
  it('publishes policy events with a typed policyEvent payload', () => {
    const captured: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const bus = {
      publish(event: { kind: string; payload: Record<string, unknown> }) {
        captured.push({ kind: event.kind, payload: event.payload });
      },
    };
    publishPolicyEventToBus(bus, {
      proposalId: 'P-20260622-006',
      projectId: 'PRJ-20260621-001',
      actor: 'dev',
      tool: 'write_file',
      risk: 'medium',
      allowed: false,
      reason: 'risk medium exceeds max risk low',
      at: '2026-06-22T02:00:00.000Z',
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.kind, 'proposal.updated');
    const policyKind = captured[0]?.payload.policyEvent;
    assert.equal(policyKind, 'tool.policy.denied');
  });

  it('tracks llm spend and downgrades the model tier when the budget runs low', () => {
    const ledger = createBudgetLedger({ proposalId: 'P-20260622-006', maxUsd: 1 });
    const tracker = trackLlmSpend(ledger, { downgradeThresholdUsd: 0.01 });
    const downgrade = tracker.route({ agentId: 'pm', quality: 'premium', estimatedUsd: 1.0 });
    assert.equal(downgrade.allowed, true);
    assert.equal(downgrade.model, 'gpt-5.4-mini');
    assert.match(downgrade.reason, /downgrade/);
    tracker.commit({ agentId: 'pm', model: downgrade.model, usd: 1.0 });
    const blocked = tracker.route({ agentId: 'dev', quality: 'standard', estimatedUsd: 0.2 });
    assert.equal(blocked.allowed, false);
  });

  it('subscribes the TUI panel to live policy events and re-renders', () => {
    const updates: Array<{ kind: string; snapshot: string }> = [];
    [];
    const session = subscribeTuiPanelUpdates({
      proposalId: 'P-20260622-006',
      maxUsd: 1,
      onUpdate: (kind, snapshot) => updates.push({ kind, snapshot }),
    });
    session.handlePolicy({
      proposalId: 'P-20260622-006',
      tool: 'write_file',
      allowed: true,
      reason: 'ok',
      at: '2026-06-22T02:05:00.000Z',
    });
    assert.equal(updates.length, 1);
    assert.match(updates[0]?.kind, /policy/);
    assert.match(updates[0]?.snapshot, /A:delivery-sandbox/);
    session.close();
  });

  it('loads real cost snapshots from a JSON ledger file', () => {
    const text = JSON.stringify({
      proposalId: 'P-20260622-006',
      maxUsd: 2,
      spentUsd: 0.42,
      remainingUsd: 1.58,
      records: [
        { agentId: 'pm', model: 'gpt-5.5', usd: 0.22 },
        { agentId: 'dev', model: 'gpt-5.4-mini', usd: 0.2 },
      ],
    });
    const snapshot = parseLedgerFromSnapshot(text);
    assert.equal(snapshot.proposalId, 'P-20260622-006');
    assert.equal(snapshot.records.length, 2);

    const loaded = loadLedgerFromStorage(snapshot);
    assert.equal(loaded.remainingUsd, 1.58);
    assert.equal(loaded.records.length, 2);
  });

  it('renders a sandbox patch as a git-apply-style text block', () => {
    const preview = {
      allowed: true,
      writtenFiles: ['src/index.ts'],
      patchBundle: '--- /dev/null\n+++ src/index.ts\n+export const x = 1;\n',
      reason: 'preview only',
    };
    const text = formatSandboxPatchAsGitApply(preview);
    assert.match(text, /diff --git a\/src\/index\.ts b\/src\/index\.ts/);
    assert.match(text, /\+\+\+ src\/index\.ts/);
    assert.match(text, /\+export const x = 1;/);
  });
});
