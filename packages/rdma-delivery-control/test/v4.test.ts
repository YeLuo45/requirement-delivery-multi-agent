import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  applyGitPatchCheck,
  buildAgentProviderWithBudget,
  createBudgetLedger,
  parseLedgerFromDisk,
  renderControlPlanePanel,
} from '../src/index.js';

describe('control-plane v4 integrations', () => {
  it('builds an LLM provider whose default model is selected by the live ledger', async () => {
    const ledger = createBudgetLedger({ proposalId: 'P-20260622-007', maxUsd: 1 });
    ledger.record({ agentId: 'pm', model: 'gpt-5.5', usd: 0.97 });
    const provider = await buildAgentProviderWithBudget({
      agentId: 'dev',
      baseConfig: { provider: 'mock', model: 'gpt-5.5' },
      ledger,
      modelTiers: { cheap: 'gpt-5.4-mini', standard: 'gpt-5.4', premium: 'gpt-5.5' },
    });
    assert.equal(provider.defaultModel, 'gpt-5.4-mini');
  });

  it('parses a ledger JSON file from the storage root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-v4-'));
    try {
      const ledgerPath = path.join(root, 'P-20260622-007.ledger.json');
      writeFileSync(
        ledgerPath,
        JSON.stringify({
          proposalId: 'P-20260622-007',
          maxUsd: 1,
          spentUsd: 0.5,
          remainingUsd: 0.5,
          records: [{ agentId: 'pm', model: 'gpt-5.5', usd: 0.5 }],
        }),
      );
      const snapshot = parseLedgerFromDisk(ledgerPath);
      assert.equal(snapshot.proposalId, 'P-20260622-007');
      assert.equal(snapshot.records.length, 1);
      assert.ok(existsSync(ledgerPath));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns ok=false when git apply --check fails on a non-patchable input', () => {
    const result = applyGitPatchCheck({ patchText: 'not a patch', cwd: '/tmp' });
    assert.equal(result.ok, false);
  });

  it('renders a control plane panel in the requested mode', () => {
    const text = renderControlPlanePanel({
      metrics: { counters: { rdma_cost_records: 3 } },
      snapshot: { proposalId: 'P-20260622-007', maxUsd: 2, spentUsd: 0.6, remainingUsd: 1.4 },
      mode: 'tui',
    });
    assert.match(text, /P-20260622-007/);
    assert.match(text, /cost records: 3/);
  });
});
