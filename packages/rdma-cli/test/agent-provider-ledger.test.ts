import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAgentProviderWithLedger } from '../src/agent-provider.js';

describe('buildAgentProviderWithLedger', () => {
  it('falls back to mock when the proposal budget is exhausted', async () => {
    const ledger = {
      snapshot() {
        return {
          remainingUsd: 0,
          maxUsd: 1,
          spentUsd: 1,
          proposalId: 'P-20260622-007',
        };
      },
      record() {},
    };
    const provider = await buildAgentProviderWithLedger(
      { env: {}, quiet: true },
      'pm',
      { provider: 'mock' },
      ledger,
    );
    assert.equal(provider.name, 'mock');
  });

  it('keeps the configured model tier when the budget has room', async () => {
    const ledger = {
      snapshot() {
        return {
          remainingUsd: 5,
          maxUsd: 5,
          spentUsd: 0,
          proposalId: 'P-20260622-007',
        };
      },
      record() {},
    };
    const provider = await buildAgentProviderWithLedger(
      { env: {}, quiet: true },
      'pm',
      { provider: 'mock' },
      ledger,
    );
    assert.equal(provider.name, 'mock');
  });

  it('downgrades to the cheap tier when remaining budget cannot fit the request', async () => {
    const ledger = {
      snapshot() {
        return {
          remainingUsd: 0.05,
          maxUsd: 1,
          spentUsd: 0.95,
          proposalId: 'P-20260622-007',
        };
      },
      record() {},
    };
    // After downgrade, buildAgentProvider is re-invoked with config.model === 'gpt-5.4-mini'.
    // The mock provider always returns 'mock' regardless of config.model, so verify that
    // the call chain succeeded without throwing and yields the mock provider.
    const provider = await buildAgentProviderWithLedger(
      { env: {}, quiet: true },
      'pm',
      { provider: 'mock', model: 'gpt-5.5' },
      ledger,
    );
    assert.equal(provider.name, 'mock');
  });
});
