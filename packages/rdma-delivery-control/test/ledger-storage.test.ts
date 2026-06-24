import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { parseLedgerFromStorage } from '../src/index.js';

describe('ledger storage abstraction', () => {
  it('loads a proposal ledger from the standard storage root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-ledger-storage-'));
    try {
      mkdirSync(path.join(root, 'ledgers'), { recursive: true });
      writeFileSync(
        path.join(root, 'ledgers', 'P-20260623-002.ledger.json'),
        JSON.stringify({
          proposalId: 'P-20260623-002',
          maxUsd: 2,
          spentUsd: 0.75,
          remainingUsd: 1.25,
          records: [{ agentId: 'qa', model: 'gpt-5.4-mini', usd: 0.75 }],
        }),
      );

      const snapshot = parseLedgerFromStorage(root, 'P-20260623-002');
      assert.equal(snapshot.proposalId, 'P-20260623-002');
      assert.equal(snapshot.spentUsd, 0.75);
      assert.equal(snapshot.records[0]?.agentId, 'qa');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
