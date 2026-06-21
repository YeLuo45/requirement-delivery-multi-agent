/**
 * @rdma/config — per-agent LLM + prompt configuration loader.
 *
 * Config layout (all files are optional — missing files degrade to defaults):
 *   .rdma/agents.yaml                  global defaults + per-agent overrides
 *   .rdma/agents/<id>/soul.md          system prompt (personality / voice)
 *   .rdma/agents/<id>/user.md          user prompt template (assistant brief)
 *   .rdma/agents/<id>/memory.md       context (prior knowledge, project notes)
 *
 * The CLI / TUI / Web / serve all go through `loadAgentConfig(root?)` so they
 * see the same configuration regardless of which surface the user picked.
 *
 * YAML parsing is intentionally hand-rolled — we support only the subset
 * needed for the project (no third-party dep).
 */

import { EnvExpansionError, type EnvLookup, expandEnvVars, expandEnvVarsDeep } from './env.js';
import type { AgentLlmConfig, AgentPromptBundle, AgentRuntimeConfig } from './types.js';
import { type AgentsYaml, parseAgentsYaml } from './yaml.js';

export type { AgentLlmConfig, AgentPromptBundle, AgentRuntimeConfig };
export type { AgentsYaml, EnvLookup };
export { EnvExpansionError, expandEnvVars, expandEnvVarsDeep, parseAgentsYaml };
export {
  composeSystemPrompt,
  isEmptyPromptBundle,
  resolveUserPrompt,
} from './prompts.js';

/**
 * The set of agent ids the RDMA pipeline actually wires up. Config files
 * may declare additional agents — those are kept around but flagged as
 * "unknown" so the caller can decide what to do with them.
 */
export const KNOWN_AGENT_IDS = [
  'market_research',
  'coordinator',
  'designer',
  'pm',
  'dev',
  'qa',
  'boss',
] as const;

export type KnownAgentId = (typeof KNOWN_AGENT_IDS)[number];

export interface LoadAgentConfigOptions {
  /** Override env var lookup (defaults to `process.env`). */
  env?: EnvLookup;
  /** Override the config root (defaults to `<monorepo>/.rdma` via cwd walk). */
  root?: string;
}

/**
 * Load agent configuration from disk. Returns a record keyed by agent id
 * with the merged LLM config + prompt bundle for every agent that has
 * any configuration (YAML block OR at least one markdown file).
 *
 * If neither `.rdma/agents.yaml` nor any `.rdma/agents/<id>/*.md` file
 * exists, the function returns an empty record and never throws — the
 * pipeline can still run in pure mock mode.
 */
export async function loadAgentConfig(
  opts: LoadAgentConfigOptions = {},
): Promise<Record<string, AgentRuntimeConfig>> {
  const root = opts.root ?? (await resolveDefaultRoot());
  const env = opts.env ?? process.env;
  const yamlRaw = await readFileIfExists(joinPath(root, 'agents.yaml'));
  const yaml = yamlRaw ? parseAgentsYaml(yamlRaw, env) : undefined;

  const result: Record<string, AgentRuntimeConfig> = {};

  if (yaml) {
    for (const [agentId, agentYaml] of Object.entries(yaml.agents ?? {})) {
      result[agentId] = await resolveAgent(agentId, agentYaml, yaml.defaults, root);
    }
  }

  // Even agents without a YAML block can have a markdown bundle on disk.
  const agentsDir = joinPath(root, 'agents');
  const agentDirs = await listDirectories(agentsDir);
  for (const agentId of agentDirs) {
    if (result[agentId]) continue;
    const bundle = await readPromptBundle(joinPath(agentsDir, agentId));
    if (bundle.soul || bundle.user || bundle.memory) {
      result[agentId] = {
        agentId,
        llm: yaml?.defaults ? resolveLlmFromYaml(yaml.defaults) : null,
        prompts: bundle,
        source: 'markdown',
      };
    }
  }

  return result;
}

/**
 * Resolve a single agent — merges defaults, agent-specific YAML, and the
 * markdown prompt bundle into a fully-typed `AgentRuntimeConfig`.
 */
async function resolveAgent(
  agentId: string,
  agentYaml: NonNullable<AgentsYaml['agents']>[string] | undefined,
  defaultsYaml: AgentsYaml['defaults'] | undefined,
  root: string,
): Promise<AgentRuntimeConfig> {
  // LLM: start with defaults, then overlay agent-specific fields. We never
  // emit a config with zero fields, so a bare `agents:` block still produces
  // an entry — useful for agents that only configure prompts.
  const baseLlm = defaultsYaml ? resolveLlmFromYaml(defaultsYaml) : undefined;
  const llm = applyAgentLlmOverrides(baseLlm, agentYaml);

  // Prompts: YAML inline wins for soul/user (the markdown bundle covers any
  // unspecified field). Memory is markdown-only by design — it's a long-lived
  // document, not a parameter.
  const bundle = await readPromptBundle(joinPath(root, 'agents', agentId));
  const inlinePrompts = readInlinePrompts(agentYaml);
  const prompts: AgentPromptBundle = {
    soul: inlinePrompts.soul ?? bundle.soul,
    user: inlinePrompts.user ?? bundle.user,
    memory: bundle.memory,
  };

  return {
    agentId,
    llm: llm ?? null,
    prompts,
    source: 'yaml',
  };
}

function readInlinePrompts(agent: NonNullable<AgentsYaml['agents']>[string] | undefined): {
  soul: string | null;
  user: string | null;
} {
  if (!agent) return { soul: null, user: null };
  return {
    soul: typeof agent.systemPrompt === 'string' ? agent.systemPrompt : null,
    user: typeof agent.userPrompt === 'string' ? agent.userPrompt : null,
  };
}

function applyAgentLlmOverrides(
  base: AgentLlmConfig | undefined,
  agent: NonNullable<AgentsYaml['agents']>[string] | undefined,
): AgentLlmConfig | undefined {
  if (!agent) return base;
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown> | undefined) };
  for (const key of [
    'provider',
    'model',
    'apiKey',
    'baseUrl',
    'temperature',
    'maxTokens',
    'maxRetries',
  ] as const) {
    const v = (agent as Record<string, unknown>)[key];
    if (v !== undefined) merged[key] = v;
  }
  return resolveLlmFromYaml(merged);
}

function resolveLlmFromYaml(raw: Record<string, unknown> | undefined): AgentLlmConfig | undefined {
  if (!raw) return undefined;
  const provider =
    typeof raw.provider === 'string' ? (raw.provider as AgentLlmConfig['provider']) : 'mock';
  const model = typeof raw.model === 'string' ? raw.model : undefined;
  const apiKeyRaw = typeof raw.apiKey === 'string' ? raw.apiKey : null;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined;
  const temperature = typeof raw.temperature === 'number' ? (raw.temperature as number) : undefined;
  const maxTokens = typeof raw.maxTokens === 'number' ? (raw.maxTokens as number) : undefined;
  const maxRetries = typeof raw.maxRetries === 'number' ? (raw.maxRetries as number) : undefined;

  // Treat empty string apiKey as "not configured" — the caller will then
  // fall back to env vars or mock mode.
  const apiKey = apiKeyRaw && apiKeyRaw.length > 0 ? apiKeyRaw : null;

  // Always emit at least the provider when defaults declared one; this lets
  // a top-level `defaults: { provider: anthropic, model: claude-sonnet-4 }`
  // survive without a per-agent apiKey (which can be supplied by the env
  // at provider creation time).
  const hasContent =
    provider !== 'mock' ||
    model !== undefined ||
    apiKey !== null ||
    baseUrl !== undefined ||
    temperature !== undefined ||
    maxTokens !== undefined ||
    maxRetries !== undefined;
  if (!hasContent) return undefined;
  return { provider, model, apiKey, baseUrl, temperature, maxTokens, maxRetries };
}

/**
 * Walk up the cwd looking for a directory containing `.rdma/`. Falls back
 * to `<cwd>/.rdma` when no marker is found. The result is the `.rdma`
 * directory itself (NOT its parent) so callers can compose
 * `<root>/agents.yaml` and `<root>/agents/<id>/*.md` directly.
 */
export async function resolveDefaultRoot(): Promise<string> {
  const { dirname } = await import('node:path');
  const { existsSync } = await import('node:fs');
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const candidate = `${dir}/.rdma`;
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Last-resort fallback: monorepo-relative `.rdma` from cwd. We don't
  // create it — loadAgentConfig() must succeed even when nothing is on
  // disk, so this fallback only matters for diagnostics in tests.
  return `${process.cwd()}/.rdma`;
}

// ---------- File-system helpers -----------------------------------------

async function readFileIfExists(path: string): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function listDirectories(path: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

async function readPromptBundle(agentDir: string): Promise<AgentPromptBundle> {
  const [soul, user, memory] = await Promise.all([
    readFileIfExists(`${agentDir}/soul.md`),
    readFileIfExists(`${agentDir}/user.md`),
    readFileIfExists(`${agentDir}/memory.md`),
  ]);
  return { soul, user, memory };
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

function joinPath(...parts: string[]): string {
  return parts.join('/');
}
