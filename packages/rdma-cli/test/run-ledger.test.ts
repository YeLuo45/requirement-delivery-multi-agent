import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildDeps } from '../src/run.js';

describe('buildDeps runtime budget wiring', () => {
  it('uses proposal budget ledger when useLlm is enabled with a proposal id', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-run-ledger-'));
    try {
      mkdirSync(path.join(root, 'ledgers'), { recursive: true });
      writeFileSync(
        path.join(root, 'ledgers', 'P-20260623-002.ledger.json'),
        JSON.stringify({
          proposalId: 'P-20260623-002',
          maxUsd: 1,
          spentUsd: 1,
          remainingUsd: 0,
          records: [{ agentId: 'pm', model: 'gpt-5.5', usd: 1 }],
        }),
      );

      const deps = await buildDeps(root, {
        useLlm: true,
        proposalId: 'P-20260623-002',
      });

      const pm = deps.registry.get('pm');
      assert.equal(pm.id, 'pm');
      assert.ok(deps.registry.all().some((agent) => agent.id === 'qa'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
