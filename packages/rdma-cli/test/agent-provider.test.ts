/**
 * Tests that prove per-agent LLM configuration actually changes what the
 * pipeline wires up — i.e. `buildAgentProvider` reads the config and
 * returns the correct LlmProvider for each agent.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { type AgentLlmConfig, buildAgentProvider } from '../src/agent-provider.js';
import type { LlmProvider } from '../src/index.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rdma-cli-agentprovider-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeAgentYaml(contents: string): void {
  writeFileSync(join(workDir, 'agents.yaml'), contents, 'utf8');
}

describe('buildAgentProvider', () => {
  it('returns the mock provider when no config is available', async () => {
    const provider = await buildAgentProvider({ env: {} }, 'pm', null);
    assert.equal(provider.name, 'mock');
  });

  it('returns the anthropic provider when config declares it with an apiKey', async () => {
    const cfg: AgentLlmConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      apiKey: 'sk-ant-test',
      temperature: 0.3,
    };
    const provider = await buildAgentProvider({ env: {} }, 'dev', cfg);
    assert.equal(provider.name, 'anthropic');
    assert.equal(provider.defaultModel, 'claude-sonnet-4');
  });

  it('returns the openai provider when config declares it', async () => {
    const cfg: AgentLlmConfig = {
      provider: 'openai',
      model: 'gpt-5.4',
      apiKey: 'sk-openai-test',
    };
    const provider = await buildAgentProvider({ env: {} }, 'pm', cfg);
    assert.equal(provider.name, 'openai');
    assert.equal(provider.defaultModel, 'gpt-5.4');
  });

  it('falls back to mock when apiKey is missing for a real provider', async () => {
    const cfg: AgentLlmConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      apiKey: null,
    };
    const provider = await buildAgentProvider({ env: {} }, 'pm', cfg);
    assert.equal(provider.name, 'mock');
  });

  it('inherits the global ANTHROPIC_API_KEY env var when config.apiKey is null but provider is anthropic', async () => {
    const cfg: AgentLlmConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      apiKey: null,
    };
    const provider = await buildAgentProvider(
      { env: { ANTHROPIC_API_KEY: 'from-env' } },
      'dev',
      cfg,
    );
    assert.equal(provider.name, 'anthropic');
  });

  it('lets OPENAI_API_KEY satisfy an openai config', async () => {
    const cfg: AgentLlmConfig = {
      provider: 'openai',
      apiKey: null,
    };
    const provider = await buildAgentProvider({ env: { OPENAI_API_KEY: 'from-env' } }, 'pm', cfg);
    assert.equal(provider.name, 'openai');
  });

  it('forwards the configured defaultModel through to the provider instance', async () => {
    const cfg: AgentLlmConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-test',
      temperature: 0.42,
      maxTokens: 2048,
    };
    const provider = (await buildAgentProvider({ env: {} }, 'pm', cfg)) as LlmProvider;
    assert.equal(provider.defaultModel, 'claude-sonnet-4-5');
  });
});

describe('buildAgentProvider — works with the test fixtures', () => {
  it('builds a mock provider even when the agents.yaml is malformed', async () => {
    writeAgentYaml('this is not valid yaml: [\n');
    // We don't load agents.yaml in buildAgentProvider — it just looks at
    // the merged AgentLlmConfig — but a malformed yaml at the call site
    // should never propagate here. Pass `null` and assert mock.
    const provider = await buildAgentProvider({ env: {} }, 'pm', null);
    assert.equal(provider.name, 'mock');
  });
});
