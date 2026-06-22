/**
 * Build an `LlmProvider` for a single agent from the per-agent config
 * loaded by `@rdma/config`. Lives in `@rdma/cli` so the Web / TUI / serve
 * surfaces all share one provider-factory decision tree.
 *
 * Rules:
 *   1. Missing config OR provider = 'mock' → `createMockProvider`.
 *   2. Real provider without an apiKey → fall back to `mock` (the call
 *      site also gets a stderr hint that the agent is running mocked).
 *   3. Real provider with an apiKey → instantiate the matching
 *      provider, threading defaultTemperature / defaultMaxTokens /
 *      baseUrl / maxRetries / defaultModel.
 *
 * We never throw at this layer. A misconfigured agent should degrade to
 * mock mode so the pipeline can still finish; the operator sees a clear
 * stderr line instead of a 500.
 */

import type { AgentLlmConfig, EnvLookup } from '@rdma/config';
import type { LlmProvider } from '@rdma/llm';
import { createMockProvider } from '@rdma/llm/mock';

export interface BuildAgentProviderOptions {
  env?: EnvLookup;
  /** Quiet = no stderr warnings when falling back to mock. */
  quiet?: boolean;
}

/**
 * Construct the LlmProvider that should drive `agentId` based on the merged
 * per-agent configuration. Async because the Anthropic / OpenAI provider
 * factories live in lazily-loaded modules — we don't want to pay the
 * dynamic-import cost on the mock-only boot path.
 */
export async function buildAgentProvider(
  opts: BuildAgentProviderOptions,
  agentId: string,
  config: AgentLlmConfig | null,
): Promise<LlmProvider> {
  if (!config || config.provider === 'mock') {
    return createMockProvider();
  }

  const apiKey = config.apiKey ?? lookupProviderKey(config.provider, opts.env ?? process.env);
  if (!apiKey) {
    if (!opts.quiet) {
      process.stderr.write(
        `[rdma] ${agentId}: ${config.provider} config without an apiKey and no ${providerEnvVar(
          config.provider,
        )} env var — falling back to mock.\n`,
      );
    }
    return createMockProvider();
  }

  return instantiateProvider(config, apiKey);
}

function lookupProviderKey(provider: 'anthropic' | 'openai', env: EnvLookup): string | null {
  const varName = providerEnvVar(provider);
  const v = env[varName];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function providerEnvVar(provider: 'anthropic' | 'openai'): string {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
}

export interface BudgetLedgerLike {
  snapshot(): { remainingUsd: number; maxUsd: number; spentUsd: number; proposalId: string };
  record(record: { agentId: string; model: string; usd: number }): void;
}

export interface BudgetModelTiers {
  cheap: string;
  standard: string;
  premium: string;
}

const DEFAULT_TIERS: BudgetModelTiers = {
  cheap: 'gpt-5.4-mini',
  standard: 'gpt-5.4',
  premium: 'gpt-5.5',
};

/**
 * Wrap `buildAgentProvider` with a per-proposal budget ledger.
 *
 * Behaviour:
 *   - If the ledger shows no remaining budget the call falls back to mock
 *     without instantiating the real provider.
 *   - When the configured model tier cannot fit the remaining budget the
 *     agent receives the cheap tier so a single over-eager agent cannot
 *     burn the entire proposal quota.
 *
 * The wrapper does not throw; failures degrade to the existing mock path.
 */
export async function buildAgentProviderWithLedger(
  opts: BuildAgentProviderOptions,
  agentId: string,
  config: AgentLlmConfig | null,
  ledger: BudgetLedgerLike,
  tiers: BudgetModelTiers = DEFAULT_TIERS,
): Promise<LlmProvider> {
  const snapshot = ledger.snapshot();
  if (snapshot.remainingUsd <= 0) {
    if (!opts.quiet) {
      process.stderr.write(
        `[rdma] ${agentId}: proposal ${snapshot.proposalId} budget exhausted (remaining=${snapshot.remainingUsd.toFixed(2)} USD) — using mock.\n`,
      );
    }
    return createMockProvider();
  }
  if (config && config.provider !== 'mock' && config.model && config.model !== tiers.cheap) {
    const requestedTier =
      config.model === tiers.premium
        ? 'premium'
        : config.model === tiers.standard
          ? 'standard'
          : 'cheap';
    const estimatedUsd =
      requestedTier === 'premium' ? 0.4 : requestedTier === 'standard' ? 0.15 : 0.05;
    if (snapshot.remainingUsd < estimatedUsd) {
      const downgraded = { ...config, model: tiers.cheap };
      if (!opts.quiet) {
        process.stderr.write(
          `[rdma] ${agentId}: downgrading ${config.model} → ${tiers.cheap} (remaining=${snapshot.remainingUsd.toFixed(2)} USD).\n`,
        );
      }
      return buildAgentProvider(opts, agentId, downgraded);
    }
  }
  const provider = await buildAgentProvider(opts, agentId, config);
  return provider;
}

async function instantiateProvider(config: AgentLlmConfig, apiKey: string): Promise<LlmProvider> {
  if (config.provider === 'anthropic') {
    const { createAnthropicProvider } = await import('@rdma/llm/anthropic');
    return createAnthropicProvider(buildProviderConfig(config, apiKey));
  }
  const { createOpenAiProvider } = await import('@rdma/llm/openai');
  return createOpenAiProvider(buildProviderConfig(config, apiKey));
}

interface ProviderConfigShape {
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
  maxRetries?: number;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

function buildProviderConfig(config: AgentLlmConfig, apiKey: string): ProviderConfigShape {
  return {
    apiKey,
    ...(config.model !== undefined ? { defaultModel: config.model } : {}),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    ...(config.temperature !== undefined ? { defaultTemperature: config.temperature } : {}),
    ...(config.maxTokens !== undefined ? { defaultMaxTokens: config.maxTokens } : {}),
  };
}
