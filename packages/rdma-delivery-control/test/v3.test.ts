import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildAgentProviderWithBudget,
  formatPrDraft,
  loadLedgerFromStorage,
  parseLedgerFromDisk,
  parseLedgerFromSnapshot,
  selectModelWithinBudget,
  subscribeFullPanelUpdates,
  validateGitApplyPatch,
} from '../src/index.js';

describe('control-plane v3 integrations', () => {
  it('builds an LLM provider that downgrades to cheap tier when the budget runs low', async () => {
    const ledgerCalls: string[] = [];
    const ledger = {
      record(record: { agentId: string; model: string; usd: number }): void {
        ledgerCalls.push(`${record.agentId}:${record.model}:${record.usd}`);
      },
      snapshot(): { proposalId: string; maxUsd: number; spentUsd: number; remainingUsd: number } {
        return { proposalId: 'P-20260622-006', maxUsd: 1, spentUsd: 0.95, remainingUsd: 0.05 };
      },
    };

    const provider = await buildAgentProviderWithBudget({
      agentId: 'pm',
      baseConfig: { provider: 'mock', model: 'gpt-5.5' },
      ledger,
      modelTiers: { cheap: 'gpt-5.4-mini', standard: 'gpt-5.4', premium: 'gpt-5.5' },
    });

    assert.match(provider.defaultModel, /gpt-5\.4-mini|gpt-5\.4/);
    assert.deepEqual(ledgerCalls, []);
  });

  it('selects a model within budget from a cost snapshot', () => {
    const choice = selectModelWithinBudget({
      snapshot: {
        proposalId: 'P-20260622-006',
        maxUsd: 1,
        spentUsd: 0,
        remainingUsd: 0.5,
        records: [],
      },
      modelTiers: { cheap: 'gpt-5.4-mini', standard: 'gpt-5.4', premium: 'gpt-5.5' },
      estimatedUsd: 0.2,
      requestedQuality: 'premium',
    });

    assert.equal(choice.allowed, true);
    assert.equal(choice.model, 'gpt-5.5');
  });

  it('parses a real ledger file from disk and reloads it through loadLedgerFromStorage', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-ledger-'));
    try {
      const ledgerPath = path.join(root, 'P-20260622-006.ledger.json');
      writeFileSync(
        ledgerPath,
        JSON.stringify({
          proposalId: 'P-20260622-006',
          maxUsd: 2,
          spentUsd: 0.5,
          remainingUsd: 1.5,
          records: [
            { agentId: 'pm', model: 'gpt-5.5', usd: 0.3 },
            { agentId: 'dev', model: 'gpt-5.4-mini', usd: 0.2 },
          ],
        }),
      );

      const snapshot = parseLedgerFromDisk(ledgerPath);
      assert.equal(snapshot.proposalId, 'P-20260622-006');

      const text = readFileSync(ledgerPath, 'utf8');
      const parsed = parseLedgerFromSnapshot(text);
      const loaded = loadLedgerFromStorage(parsed);
      assert.equal(loaded.records.length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('subscribes to the full control-plane event stream and re-renders the panel', () => {
    const captured: Array<{ kind: string; text: string }> = [];
    const session = subscribeFullPanelUpdates({
      proposalId: 'P-20260622-006',
      onUpdate: (kind, text) => captured.push({ kind, text }),
    });

    session.handlePolicy({
      proposalId: 'P-20260622-006',
      tool: 'write_file',
      allowed: true,
      reason: 'ok',
      at: '2026-06-22T03:00:00.000Z',
    });
    session.handleStageTransition({
      proposalId: 'P-20260622-006',
      fromStage: 'in_dev',
      toStage: 'in_test_acceptance',
      at: '2026-06-22T03:01:00.000Z',
    });
    session.handleProposalUpdate({
      proposalId: 'P-20260622-006',
      status: 'in_test_acceptance',
      at: '2026-06-22T03:02:00.000Z',
    });

    assert.equal(captured.length, 3);
    assert.match(captured[0]?.kind ?? '', /policy/);
    assert.match(captured[1]?.kind ?? '', /stage/);
    assert.match(captured[2]?.kind ?? '', /proposal/);
    session.close();
  });

  it('formats a PR draft from a sandbox patch and validates git apply syntax', () => {
    const draft = formatPrDraft({
      proposalId: 'P-20260622-006',
      title: 'Add sandbox patch',
      body: 'Auto-generated from RDMA sandbox preview.',
      patch: {
        allowed: true,
        writtenFiles: ['src/index.ts'],
        patchBundle: '--- /dev/null\n+++ src/index.ts\n+export const x = 1;\n',
        reason: 'preview',
      },
    });

    assert.match(draft.body, /Auto-generated/);
    assert.match(draft.patchText, /\+\+\+ src\/index\.ts/);

    const validated = validateGitApplyPatch(draft.patchText);
    assert.equal(validated.recognizedFiles.length, 1);
    assert.equal(validated.recognizedFiles[0], 'src/index.ts');
  });
});
