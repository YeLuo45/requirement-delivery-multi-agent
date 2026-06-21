/**
 * Tests for the agent configuration loader.
 *
 * The loader reads `.rdma/agents.yaml` plus per-agent markdown files
 * under `.rdma/agents/<id>/{soul,user,memory}.md`. Tests run against a
 * temporary directory so they don't depend on whatever is on disk.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  type AgentRuntimeConfig,
  EnvExpansionError,
  expandEnvVars,
  expandEnvVarsDeep,
  loadAgentConfig,
  parseAgentsYaml,
  resolveDefaultRoot,
} from '../src/index.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rdma-config-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeAgentYaml(contents: string): void {
  writeFileSync(join(workDir, 'agents.yaml'), contents, 'utf8');
}

function writeAgentFile(
  agentId: string,
  name: 'soul.md' | 'user.md' | 'memory.md',
  body: string,
): void {
  const dir = join(workDir, 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body, 'utf8');
}

describe('expandEnvVars', () => {
  it('substitutes ${VAR} placeholders', () => {
    const result = expandEnvVars('hello ${WHO}!', { WHO: 'world' });
    assert.equal(result, 'hello world!');
  });

  it('returns the input unchanged when no placeholders are present', () => {
    assert.equal(expandEnvVars('plain text', {}), 'plain text');
  });

  it('substitutes multiple placeholders in the same string', () => {
    const result = expandEnvVars('${A}/${B}/${C}', { A: '1', B: '2', C: '3' });
    assert.equal(result, '1/2/3');
  });

  it('throws EnvExpansionError when a referenced variable is missing', () => {
    assert.throws(() => expandEnvVars('${MISSING_VAR}', {}), EnvExpansionError);
  });

  it('ignores ${} placeholders that look like shell variables', () => {
    // We only substitute uppercase identifiers to avoid clobbering shell-style
    // strings the user may legitimately want to keep verbatim.
    assert.equal(expandEnvVars('${lower} stays', {}), '${lower} stays');
  });
});

describe('expandEnvVarsDeep', () => {
  it('walks an object tree and expands every string value', () => {
    const input = {
      provider: 'anthropic',
      apiKey: '${ANTHROPIC_API_KEY}',
      nested: {
        token: '${TOKEN}',
        count: 7,
        list: ['${A}', 'literal', { key: '${B}' }],
      },
    };
    const result = expandEnvVarsDeep(input, {
      ANTHROPIC_API_KEY: 'sk-123',
      TOKEN: 't-9',
      A: 'one',
      B: 'two',
    });
    assert.deepEqual(result, {
      provider: 'anthropic',
      apiKey: 'sk-123',
      nested: {
        token: 't-9',
        count: 7,
        list: ['one', 'literal', { key: 'two' }],
      },
    });
  });
});

describe('parseAgentsYaml', () => {
  it('parses scalars, nested mappings, lists, and numbers', () => {
    const yaml = `
defaults:
  provider: anthropic
  model: claude-sonnet-4
  temperature: 0.2
  maxTokens: 4096

agents:
  pm:
    provider: openai
    model: gpt-5.4
    apiKey: "\${OPENAI_API_KEY}"
    systemPrompt: |
      You are the PM agent.
      Always respond in JSON.
  dev:
    provider: anthropic
    model: claude-sonnet-4
    temperature: 0.1
`;
    const parsed = parseAgentsYaml(yaml);
    assert.equal(parsed.defaults?.provider, 'anthropic');
    assert.equal(parsed.defaults?.temperature, 0.2);
    assert.equal(parsed.defaults?.maxTokens, 4096);
    assert.equal(parsed.agents?.pm?.provider, 'openai');
    assert.equal(parsed.agents?.pm?.model, 'gpt-5.4');
    assert.match(parsed.agents?.pm?.apiKey ?? '', /\$\{OPENAI_API_KEY\}/);
    assert.match(parsed.agents?.pm?.systemPrompt ?? '', /PM agent/);
    assert.equal(parsed.agents?.dev?.temperature, 0.1);
  });

  it('treats missing file as empty (caller handles absence)', () => {
    // We don't throw — `parseAgentsYaml` is just a parser. The caller
    // (`loadAgentConfig`) wraps it with file reading.
    const parsed = parseAgentsYaml('');
    assert.deepEqual(parsed, {});
  });

  it('parses inline lists and inline maps', () => {
    const yaml = `
agents:
  dev:
    tags: [reviewer, owner]
    metadata: { team: core, level: 3 }
`;
    const parsed = parseAgentsYaml(yaml);
    assert.deepEqual(parsed.agents?.dev?.tags, ['reviewer', 'owner']);
    assert.deepEqual(parsed.agents?.dev?.metadata, { team: 'core', level: 3 });
  });

  it('throws YamlError with a line number on malformed input', () => {
    assert.throws(
      () => parseAgentsYaml('defaults:\n  invalid line with no key\n  provider: mock\n'),
      (err: Error) => /line 2/.test(err.message),
    );
  });
});

describe('loadAgentConfig', () => {
  it('returns an empty record when no config files exist', async () => {
    const result = await loadAgentConfig({ root: workDir });
    assert.deepEqual(result, {});
  });

  it('loads an agent declared in YAML with no markdown bundle', async () => {
    writeAgentYaml(`
agents:
  pm:
    provider: anthropic
    model: claude-sonnet-4
    apiKey: "test-key"
    temperature: 0.3
`);
    const result = await loadAgentConfig({ root: workDir, env: {} });
    const pm = result.pm;
    assert.ok(pm);
    assert.equal(pm.source, 'yaml');
    assert.equal(pm.llm?.provider, 'anthropic');
    assert.equal(pm.llm?.model, 'claude-sonnet-4');
    assert.equal(pm.llm?.apiKey, 'test-key');
    assert.equal(pm.llm?.temperature, 0.3);
    assert.equal(pm.prompts.soul, null);
    assert.equal(pm.prompts.user, null);
    assert.equal(pm.prompts.memory, null);
  });

  it('merges defaults from YAML with per-agent overrides', async () => {
    writeAgentYaml(`
defaults:
  provider: anthropic
  model: claude-sonnet-4
  temperature: 0.2

agents:
  dev:
    temperature: 0.1
  pm:
    provider: openai
`);
    const result = await loadAgentConfig({ root: workDir, env: {} });
    // dev inherits defaults except for temperature override
    const dev = result.dev;
    assert.ok(dev);
    assert.equal(dev.llm?.provider, 'anthropic');
    assert.equal(dev.llm?.model, 'claude-sonnet-4');
    assert.equal(dev.llm?.temperature, 0.1);
    // pm overrides provider and inherits everything else
    const pm = result.pm;
    assert.ok(pm);
    assert.equal(pm.llm?.provider, 'openai');
    assert.equal(pm.llm?.model, 'claude-sonnet-4');
    assert.equal(pm.llm?.temperature, 0.2);
  });

  it('expands ${ENV} placeholders inside YAML strings', async () => {
    writeAgentYaml(`
agents:
  pm:
    provider: anthropic
    model: claude-sonnet-4
    apiKey: "\${PM_KEY}"
`);
    const result = await loadAgentConfig({
      root: workDir,
      env: { PM_KEY: 'expanded-secret' },
    });
    assert.equal(result.pm?.llm?.apiKey, 'expanded-secret');
  });

  it('throws EnvExpansionError when an apiKey references an unset env var', async () => {
    writeAgentYaml(`
agents:
  pm:
    provider: anthropic
    apiKey: "\${MISSING_KEY}"
`);
    await assert.rejects(loadAgentConfig({ root: workDir, env: {} }), EnvExpansionError);
  });

  it('loads prompt bundle from markdown files when no YAML block exists', async () => {
    writeAgentFile('dev', 'soul.md', 'You write clean code.');
    writeAgentFile('dev', 'memory.md', '# Project notes\nUse TS strict mode.');
    const result = await loadAgentConfig({ root: workDir });
    const dev = result.dev;
    assert.ok(dev);
    assert.equal(dev.source, 'markdown');
    assert.match(dev.prompts.soul ?? '', /clean code/);
    assert.equal(dev.prompts.user, null);
    assert.match(dev.prompts.memory ?? '', /TS strict mode/);
    assert.equal(dev.llm, null);
  });

  it('merges inline YAML prompts with the markdown bundle (yaml wins for matching keys)', async () => {
    writeAgentFile('pm', 'soul.md', 'from markdown');
    writeAgentFile('pm', 'user.md', 'user from markdown');
    writeAgentFile('pm', 'memory.md', 'memory from markdown');
    writeAgentYaml(`
agents:
  pm:
    provider: anthropic
    apiKey: "k"
    systemPrompt: "from yaml"
    userPrompt: "user from yaml"
`);
    const result = await loadAgentConfig({ root: workDir, env: {} });
    const pm = result.pm;
    assert.ok(pm);
    assert.equal(pm.prompts.soul, 'from yaml');
    assert.equal(pm.prompts.user, 'user from yaml');
    assert.match(pm.prompts.memory ?? '', /memory from markdown/);
  });

  it('discovers agents that only have a markdown bundle alongside YAML-defined agents', async () => {
    writeAgentYaml(`
agents:
  pm:
    provider: anthropic
    apiKey: "k"
`);
    writeAgentFile('designer', 'soul.md', 'Design first.');
    const result = await loadAgentConfig({ root: workDir, env: {} });
    assert.ok(result.pm);
    assert.ok(result.designer);
    assert.equal(result.pm?.source, 'yaml');
    assert.equal(result.designer?.source, 'markdown');
  });

  it('uses defaults LLM for an agent with only a markdown bundle', async () => {
    writeAgentYaml(`
defaults:
  provider: anthropic
  model: claude-sonnet-4
`);
    writeAgentFile('dev', 'soul.md', 'You are dev.');
    const result = await loadAgentConfig({ root: workDir, env: {} });
    const dev = result.dev;
    assert.ok(dev);
    assert.equal(dev.llm?.provider, 'anthropic');
    assert.equal(dev.llm?.model, 'claude-sonnet-4');
  });

  it('leaves llm null when nothing is configured (mock mode is the safe default)', async () => {
    writeAgentFile('pm', 'soul.md', 'No LLM.');
    const result = await loadAgentConfig({ root: workDir });
    assert.equal(result.pm?.llm, null);
  });
});

describe('resolveDefaultRoot', () => {
  it('walks up the cwd to find .rdma', async () => {
    // Create a fake `.rdma/agents.yaml` two directories up.
    const root = mkdtempSync(join(tmpdir(), 'rdma-config-root-'));
    const child = join(root, 'pkg', 'sub');
    mkdirSync(join(root, '.rdma'), { recursive: true });
    mkdirSync(child, { recursive: true });
    const originalCwd = process.cwd();
    process.chdir(child);
    try {
      assert.equal(await resolveDefaultRoot(), join(root, '.rdma'));
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to <cwd>/.rdma when no marker exists', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'rdma-config-iso-'));
    const originalCwd = process.cwd();
    process.chdir(isolated);
    try {
      const root = await resolveDefaultRoot();
      assert.equal(root, join(isolated, '.rdma'));
    } finally {
      process.chdir(originalCwd);
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});

// Final guard — runtime shape is what buildDeps / serve consume. Keep a
// stable type alias referenced in tests so we don't accidentally rename
// fields that the CLI integration depends on.
describe('AgentRuntimeConfig shape (stable contract)', () => {
  it('exposes agentId / llm / prompts / source', async () => {
    writeAgentYaml(`
agents:
  pm:
    provider: mock
`);
    const result: Record<string, AgentRuntimeConfig | undefined> = await loadAgentConfig({
      root: workDir,
      env: {},
    });
    const pm = result.pm;
    assert.ok(pm);
    assert.equal(typeof pm.agentId, 'string');
    assert.ok('llm' in pm);
    assert.ok('prompts' in pm);
    assert.equal(pm.source, 'yaml');
  });
});
