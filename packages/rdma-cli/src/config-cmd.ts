/**
 * `rdma config` subcommand family.
 *
 *   rdma config show [--all]  [<agent>]
 *   rdma config validate       [<root>]
 *   rdma config init           [--agent <id>] [--root <path>] [--force]
 *   rdma config path           [--root <path>]
 *
 * Each subcommand is its own `cmdConfigXxx` function. The shared argv
 * parser only handles flags (no subcommand token) so the dispatch
 * switch in `run.ts` can wire `show | validate | init | path` to the
 * matching helper.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type AgentRuntimeConfig, loadAgentConfig, parseAgentsYaml } from '@rdma/config';
import { STORAGE_ROOT } from './run.js';

export class ConfigCmdError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'ConfigCmdError';
    this.exitCode = exitCode;
  }
}

export interface ParsedConfigFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parse argv into positional + flag buckets. Subcommands do NOT go
 * through this parser; the dispatcher routes them at the call site.
 */
export function parseConfigArgs(argv: string[]): ParsedConfigFlags {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function resolveRoot(flags: Record<string, string | boolean>, fallback?: string): string {
  if (typeof flags.root === 'string' && flags.root.length > 0) return flags.root;
  return fallback ?? path.dirname(STORAGE_ROOT);
}

const TEMPLATE_AGENTS_YAML = [
  '# Per-agent LLM + prompt configuration for RDMA.',
  '# See README.zh-CN.md §"Per-agent configuration" for the schema.',
  '',
  'defaults:',
  '  provider: mock         # mock | anthropic | openai',
  '  model: ""              # leave empty to use the provider default',
  '  temperature: 0.2',
  '  maxTokens: 4096',
  '',
  'agents:',
  '  pm:',
  '    provider: mock',
  '    # systemPrompt: |         # inline prompt alternative to .md files',
  '    #   You are the PM agent.',
  '    # temperature: 0.2',
  '  dev:',
  '    provider: mock',
  '  qa:',
  '    provider: mock',
  '',
].join('\n');

export interface ConfigCmdOptions {
  root?: string;
}

/**
 * `rdma config path` — print the resolved `.rdma` root. Operators pipe
 * this into `cat $(rdma config path)/agents.yaml` to inspect the live
 * config without remembering the default location.
 */
export async function cmdConfigPath(argv: string[], opts: ConfigCmdOptions = {}): Promise<void> {
  const { flags } = parseConfigArgs(argv);
  const root = resolveRoot(flags, opts.root);
  process.stdout.write(`${root}\n`);
}

/**
 * `rdma config show [--all] [<agent>]` — print the resolved per-agent
 * configuration. Single-agent mode is more verbose; `--all` produces a
 * table view suitable for `rdma tui` / dashboard widgets.
 */
export async function cmdConfigShow(argv: string[], opts: ConfigCmdOptions = {}): Promise<void> {
  const { flags, positional } = parseConfigArgs(argv);
  const root = resolveRoot(flags, opts.root);
  const configs = await loadAgentConfig({ root });

  if (flags.all === true) {
    process.stdout.write(`${formatConfigTable(configs)}\n`);
    return;
  }

  const agentId = typeof flags.agent === 'string' ? flags.agent : (positional[0] ?? undefined);
  if (!agentId) {
    throw new ConfigCmdError('`rdma config show` requires an agent id or --all');
  }
  const cfg = configs[agentId];
  if (!cfg) {
    throw new ConfigCmdError(
      `no configuration found for "${agentId}" at ${root}. Run \`rdma config init\` to scaffold one.`,
    );
  }
  process.stdout.write(`${formatSingleAgent(cfg)}\n`);
}

/**
 * `rdma config validate` — parse the YAML and report. Returns 0 on
 * success (with a `valid` line) or 1 on failure (with the error written
 * to stderr). Missing config is treated as a warning, not an error, so
 * the command is safe to wire into pre-commit hooks.
 */
export async function cmdConfigValidate(
  argv: string[],
  opts: ConfigCmdOptions = {},
): Promise<number> {
  const { flags } = parseConfigArgs(argv);
  const root = resolveRoot(flags, opts.root);
  let raw: string;
  try {
    raw = await readFile(path.join(root, 'agents.yaml'), 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      process.stderr.write(`no agents.yaml at ${root} — nothing to validate\n`);
      return 0;
    }
    throw err;
  }
  try {
    parseAgentsYaml(raw);
  } catch (err) {
    process.stderr.write(`invalid: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  process.stdout.write(`valid: ${root}/agents.yaml\n`);
  return 0;
}

/**
 * `rdma config init [--agent <id>] [--force]` — write a templated
 * `.rdma/agents.yaml` so operators have a starting point. Refuses to
 * overwrite without `--force`. The `--agent` flag is accepted for
 * future expansion; today the template seeds pm / dev / qa stubs.
 */
export async function cmdConfigInit(argv: string[], opts: ConfigCmdOptions = {}): Promise<number> {
  const { flags } = parseConfigArgs(argv);
  const root = resolveRoot(flags, opts.root);
  const target = path.join(root, 'agents.yaml');
  await mkdir(root, { recursive: true });
  let exists = false;
  try {
    await readFile(target, 'utf8');
    exists = true;
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  if (exists && flags.force !== true) {
    process.stderr.write(
      `${target} already exists — pass --force to overwrite or edit it manually.\n`,
    );
    return 1;
  }
  await writeFile(target, `${TEMPLATE_AGENTS_YAML}\n`, 'utf8');
  process.stdout.write(`wrote ${target}\n`);
  return 0;
}

export function formatConfigTable(configs: Record<string, AgentRuntimeConfig>): string {
  const ids = Object.keys(configs).sort();
  if (ids.length === 0) return '(no agents configured)';
  const lines = [`${'agent'.padEnd(16)}  ${'provider / model'.padEnd(28)}  source`];
  for (const id of ids) {
    const cfg = configs[id];
    if (!cfg) continue;
    const llm = cfg.llm
      ? `${cfg.llm.provider}${cfg.llm.model ? ` / ${cfg.llm.model}` : ''}`
      : 'mock';
    lines.push(`${id.padEnd(16)}  ${llm.padEnd(28)}  ${cfg.source}`);
  }
  return lines.join('\n');
}

export function formatSingleAgent(cfg: AgentRuntimeConfig): string {
  const llm = cfg.llm;
  const lines: string[] = [];
  lines.push(`agent: ${cfg.agentId}`);
  lines.push(`source: ${cfg.source}`);
  lines.push('llm:');
  if (llm) {
    lines.push(`  provider:    ${llm.provider}`);
    if (llm.model !== undefined) lines.push(`  model:       ${llm.model}`);
    if (llm.baseUrl !== undefined) lines.push(`  baseUrl:     ${llm.baseUrl}`);
    if (llm.temperature !== undefined) lines.push(`  temperature: ${llm.temperature}`);
    if (llm.maxTokens !== undefined) lines.push(`  maxTokens:   ${llm.maxTokens}`);
    if (llm.maxRetries !== undefined) lines.push(`  maxRetries:  ${llm.maxRetries}`);
    if (llm.apiKey) lines.push(`  apiKey:      (resolved, length=${llm.apiKey.length})`);
  } else {
    lines.push('  (none configured — agent runs in mock mode)');
  }
  lines.push('prompts:');
  lines.push(`  soul:   ${cfg.prompts.soul ? 'present' : '(missing)'}`);
  lines.push(`  user:   ${cfg.prompts.user ? 'present' : '(missing)'}`);
  lines.push(`  memory: ${cfg.prompts.memory ? 'present' : '(missing)'}`);
  return lines.join('\n');
}
