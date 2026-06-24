import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { createBossAgent } from '@rdma/boss';
import { type AgentRuntimeConfig, loadAgentConfig } from '@rdma/config';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import {
  AgentRegistry,
  AuditLog,
  type Proposal,
  type Stage,
  Storage,
  type StorageDriver,
} from '@rdma/core';
import {
  createBudgetLedger,
  loadLedgerFromStorage,
  parseLedgerFromStorage,
} from '@rdma/delivery-control';
import { createDesignerAgent } from '@rdma/designer';
import { createDevAgent } from '@rdma/dev';
import { EventBus } from '@rdma/persistence';
import { createPmAgent } from '@rdma/pm';
import { createQaAgent } from '@rdma/qa';
import { createResearchAgent } from '@rdma/research';
/**
 * Command implementations — each takes parsed argv.
 *
 * Kept in a separate file so the CLI dispatcher stays small and the
 * command logic can be reused by the MCP server (which exposes the
 * same operations as tools).
 */
import { buildAgentProvider, buildAgentProviderWithLedger } from './agent-provider.js';
import { cmdConfigInit, cmdConfigPath, cmdConfigShow, cmdConfigValidate } from './config-cmd.js';
import { buildArtifactPatch, cmdDiff, diffInspectData, lineDiff, unifiedDiff } from './diff.js';
import { buildEventsData, buildInspectData, cmdEvents, cmdInspect } from './inspect.js';
import { cmdMetrics, parseMetricsArgs, renderMetricsText } from './metrics.js';
import { cmdReleaseOps } from './release-ops.js';
import { cmdReplay, replayProposal } from './replay.js';
import { cmdSandboxApply } from './sandbox-cmd.js';
import { cmdServe, startServe } from './serve.js';
import { cmdTui, renderTuiSnapshot } from './tui.js';
export { cmdReplay, replayProposal } from './replay.js';
export { cmdTui, renderTuiSnapshot } from './tui.js';
export {
  cmdDiff,
  diffInspectData,
  lineDiff,
  unifiedDiff,
  buildArtifactPatch,
} from './diff.js';
export { cmdInspect, cmdEvents, buildInspectData, buildEventsData } from './inspect.js';
export { parseMetricsArgs, renderMetricsText } from './metrics.js';
export {
  buildReleaseOpsPayload,
  renderReleaseOpsText,
  renderReleaseOpsFixPrompt,
  renderReleaseOpsPrDraft,
  renderReleaseOpsApplyStatusDryRun,
  renderReleaseOpsStageCommands,
  renderReleaseOpsAutomationJson,
  renderReleaseOpsCiSummary,
} from './release-ops.js';

// `cmdServe` and `startServe` are imported for the dispatch switch
// and for tests that exercise them through `runFn`. The other names
// are re-exported so existing consumers of `@rdma/cli/run` keep
// working.

function findMonorepoRoot(startDir: string): string | null {
  // Walk up looking for a package.json that declares "workspaces".
  let dir = startDir;
  // Don't walk past filesystem root.
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const content = readFileSync(pkgPath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed) {
        return dir;
      }
    } catch {
      // continue
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const MONOREPO_ROOT = findMonorepoRoot(process.cwd());

export const STORAGE_ROOT = (() => {
  const envOverride = process.env.RDMA_STORAGE_ROOT;
  if (envOverride) return path.resolve(envOverride);
  if (MONOREPO_ROOT) return path.join(MONOREPO_ROOT, '.rdma', 'data');
  return path.join(process.cwd(), '.rdma', 'data');
})();

export const SHIPPED_ROOT = (() => {
  const envOverride = process.env.RDMA_SHIPPED_ROOT;
  if (envOverride) return path.resolve(envOverride);
  if (MONOREPO_ROOT) return path.join(MONOREPO_ROOT, '.rdma', 'shipped');
  return path.join(process.cwd(), '.rdma', 'shipped');
})();

export interface BuildDeps {
  registry: AgentRegistry;
  storage: StorageDriver;
  audit: AuditLog;
  pipeline: Pipeline;
  bus: EventBus;
}

/**
 * Build a StorageDriver from a backend tag.
 *
 *   - "json"  → JSON files at <root> (default; zero deps)
 *   - "sqlite" → single .sqlite file at <root>.sqlite (needs better-sqlite3)
 *
 * Falls back to JSON if the requested backend can't be loaded.
 */
export async function createStorage(
  root: string,
  backend: 'json' | 'sqlite' = 'json',
): Promise<StorageDriver> {
  if (backend === 'sqlite') {
    try {
      const { SqliteStorage } = await import('@rdma/persistence/sqlite');
      const sqlitePath = root.endsWith('.sqlite') ? root : `${root}.sqlite`;
      const store = await SqliteStorage.open({ path: sqlitePath });
      console.error(`[rdma] storage backend: ${store.backendName}`);
      return store;
    } catch (err) {
      console.error(
        `[rdma] --storage sqlite requested but unavailable (${(err as Error).message}); falling back to JSON`,
      );
    }
  }
  const jsonStore = new Storage({ root });
  await jsonStore.init();
  console.error(`[rdma] storage backend: ${jsonStore.backendName}`);
  return jsonStore;
}

export async function buildDeps(
  storageRoot: string = STORAGE_ROOT,
  opts: { useLlm?: boolean; storage?: 'json' | 'sqlite'; proposalId?: string } = {},
): Promise<BuildDeps> {
  const storage = await createStorage(storageRoot, opts.storage ?? 'json');
  const audit = new AuditLog(storage);
  const bus = new EventBus();
  const registry = new AgentRegistry();
  registry.register(createResearchAgent());
  registry.register(createCoordinatorAgent());
  registry.register(createDesignerAgent());
  registry.register(createPmAgent());
  registry.register(createDevAgent());

  if (opts.useLlm) {
    // Per-agent LLM wiring. We try (in order):
    //   1. `.rdma/agents.yaml` + `.rdma/agents/<id>/{soul,user,memory}.md`
    //      — produced by `@rdma/config`.
    //   2. The legacy env-var fallback that picks Anthropic/OpenAI based
    //      on which API key is set.
    // Both branches fall back to mock when nothing usable is configured.
    const configRoot = path.dirname(storageRoot);
    const agentConfigs = await loadAgentConfig({ root: configRoot });
    const providerBuilder = createRuntimeProviderBuilder(storageRoot, opts.proposalId);
    const pmModel = await providerBuilder('pm', agentConfigs.pm?.llm ?? null);
    const devModel = await providerBuilder('dev', agentConfigs.dev?.llm ?? null);
    const qaModel = await providerBuilder('qa', agentConfigs.qa?.llm ?? null);

    // If per-agent config was silent, still try the legacy env-var trick
    // so a `--use-llm` with no YAML on disk keeps working.
    const legacyModel =
      pmModel.name === 'mock' &&
      devModel.name === 'mock' &&
      qaModel.name === 'mock' &&
      process.env.ANTHROPIC_API_KEY
        ? await buildAgentProvider({ env: process.env }, 'pm', {
            provider: 'anthropic',
            apiKey: process.env.ANTHROPIC_API_KEY,
          })
        : null;

    const effectivePm = pmModel.name === 'mock' && legacyModel ? legacyModel : pmModel;
    registry.replace(createPmAgent({ model: effectivePm }));
    registry.replace(createDevAgent({ model: devModel }));
    registry.replace(createQaAgent({ model: qaModel }));
    logLlmSummary(agentConfigs, { pm: effectivePm, dev: devModel, qa: qaModel });
  } else {
    registry.register(createQaAgent());
  }

  registry.register(createBossAgent({ shippedRoot: SHIPPED_ROOT }));
  const pipeline = new Pipeline({ registry, storage, audit, bus });
  return { registry, storage, audit, pipeline, bus };
}

interface AgentProviderSnapshot {
  pm: import('@rdma/llm').LlmProvider;
  dev: import('@rdma/llm').LlmProvider;
  qa: import('@rdma/llm').LlmProvider;
}

function createRuntimeProviderBuilder(storageRoot: string, proposalId?: string) {
  const ledger = proposalId ? loadRuntimeLedger(storageRoot, proposalId) : null;
  return async (agentId: string, config: AgentRuntimeConfig['llm'] | null) => {
    if (!ledger) {
      return buildAgentProvider({ env: process.env }, agentId, config ?? null);
    }
    return buildAgentProviderWithLedger({ env: process.env }, agentId, config ?? null, ledger);
  };
}

function loadRuntimeLedger(storageRoot: string, proposalId: string) {
  try {
    const snapshot = loadLedgerFromStorage(parseLedgerFromStorage(storageRoot, proposalId));
    const ledger = createBudgetLedger({ proposalId: snapshot.proposalId, maxUsd: snapshot.maxUsd });
    for (const record of snapshot.records) {
      ledger.record(record);
    }
    return ledger;
  } catch {
    return createBudgetLedger({ proposalId, maxUsd: 1 });
  }
}

function logLlmSummary(
  agentConfigs: Record<string, AgentRuntimeConfig>,
  providers: AgentProviderSnapshot,
): void {
  const labels: Array<keyof AgentProviderSnapshot> = ['pm', 'dev', 'qa'];
  for (const id of labels) {
    const cfg = agentConfigs[id];
    const source = cfg?.source ?? 'default';
    console.error(
      `[rdma] ${id}: provider=${providers[id].name} (${providers[id].defaultModel}) source=${source}`,
    );
  }
}

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedFlags {
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

/**
 * Resolve which storage backend a subcommand should use. Honors (in order):
 *   1. The subcommand's --storage flag.
 *   2. The RDMA_STORAGE env var.
 *   3. The default ("json").
 */
function resolveStorageBackend(flags: Record<string, string | boolean>): 'json' | 'sqlite' {
  const raw =
    (typeof flags.storage === 'string' ? flags.storage : process.env.RDMA_STORAGE) ?? 'json';
  if (raw === 'json' || raw === 'sqlite') return raw;
  console.error(`[rdma] unknown --storage "${raw}"; expected json|sqlite (using json)`);
  return 'json';
}

export async function cmdDeliver(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const title = positional[0];
  const requirement = typeof flags.requirement === 'string' ? flags.requirement : undefined;
  const url = typeof flags.url === 'string' ? flags.url : undefined;
  const priority = typeof flags.priority === 'string' ? flags.priority : undefined;
  const scope = typeof flags.scope === 'string' ? flags.scope : undefined;
  const useLlm = flags['use-llm'] === true;
  const storage = resolveStorageBackend(flags);
  const proposalId = typeof flags.proposal === 'string' ? flags.proposal : undefined;

  if (!title || !requirement) {
    console.error(
      'Usage: rdma deliver <title> --requirement "<text>" [--url <src>] [--use-llm] [--proposal <id>] [--storage json|sqlite]',
    );
    process.exit(1);
  }

  const { pipeline } = await buildDeps(STORAGE_ROOT, { useLlm, storage, proposalId });
  const tags: Record<string, string> = {};
  if (priority) tags.priority = priority;
  if (scope) tags.scope = scope;

  const created = await pipeline.createProposal({
    title,
    rawRequirement: requirement,
    ...(url !== undefined ? { sourceUrl: url } : {}),
    ...(Object.keys(tags).length > 0 ? { tags } : {}),
  });
  console.log(`Created ${created.id} (${created.projectId})`);
  console.log(`  status: ${created.status}`);
  console.log(`  title:  ${created.title}`);

  console.log('Driving through the pipeline...');
  const final = await pipeline.runToCompletion(created);

  console.log(`\nDelivered: ${final.id}`);
  console.log(`  status:      ${final.status}`);
  console.log(`  artifacts:   ${final.artifacts.length}`);
  for (const a of final.artifacts) {
    console.log(`    - ${a.kind.padEnd(22)} by ${a.agentId.padEnd(16)} — ${a.summary}`);
  }
}

export async function cmdList(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const status = typeof flags.status === 'string' ? (flags.status as Stage) : undefined;
  const { storage, audit } = await buildDeps(STORAGE_ROOT);
  const proposals = await storage.listProposals();
  const filtered = status ? proposals.filter((p) => p.status === status) : proposals;
  if (filtered.length === 0) {
    console.log('(no proposals)');
    return;
  }
  console.log(`${filtered.length} proposal(s)${status ? ` with status=${status}` : ''}:`);
  console.log();
  for (const p of filtered) {
    const chain = (await audit.handoffChain(p.id, p.projectId)).join(' → ');
    console.log(`${p.id}  ${p.status.padEnd(28)}  ${p.title.slice(0, 50).padEnd(50)}  ${chain}`);
  }
}

export async function cmdShow(argv: string[]): Promise<void> {
  const { positional } = parseArgs(argv);
  const id = positional[0];
  if (!id) {
    console.error('Usage: rdma show <proposal-id>');
    process.exit(1);
  }
  const { storage, audit } = await buildDeps(STORAGE_ROOT);
  const proposal = await storage.getProposal(id);
  console.log(`Proposal ${proposal.id}`);
  console.log(`  project:     ${proposal.projectId}`);
  console.log(`  title:       ${proposal.title}`);
  console.log(`  status:      ${proposal.status}`);
  console.log(`  owner:       ${proposal.owner ?? '(none)'}`);
  console.log(`  created:     ${proposal.createdAt}`);
  console.log(`  updated:     ${proposal.updatedAt}`);
  console.log(`  source URL:  ${proposal.sourceUrl ?? '(none)'}`);
  console.log(`  raw:         ${proposal.rawRequirement}`);
  console.log('  tags:');
  for (const [k, v] of Object.entries(proposal.tags)) {
    console.log(`    - ${k}: ${v}`);
  }

  const chain = await audit.handoffChain(proposal.id, proposal.projectId);
  console.log(`\nHandoff chain: ${chain.join(' → ')}`);

  const entries = await audit.list(proposal.id, proposal.projectId);
  console.log(`\nAudit log (${entries.length} entries):`);
  for (const e of entries) {
    console.log(`  ${e.at}  ${e.actor.padEnd(16)}  ${e.action}`);
  }

  console.log(`\nArtifacts (${proposal.artifacts.length}):`);
  for (const a of proposal.artifacts) {
    console.log(`\n  --- ${a.kind} (${a.id.slice(0, 8)}) by ${a.agentId} at ${a.createdAt} ---`);
    console.log(`  ${a.summary}`);
    if (a.content.length < 1500) {
      console.log(a.content);
    } else {
      console.log(a.content.slice(0, 1500));
      console.log(`  ...(${a.content.length - 1500} more chars)`);
    }
  }
}

export async function cmdStatus(_argv: string[]): Promise<void> {
  const { storage, registry } = await buildDeps(STORAGE_ROOT);
  const proposals = await storage.listProposals();
  const counts = new Map<Stage, number>();
  for (const p of proposals) {
    counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
  }
  const meta = await storage.readMeta();

  console.log('RDMA system status');
  console.log(`  storage:    ${STORAGE_ROOT}`);
  console.log(`  meta:       v${meta.version} (created ${meta.createdAt})`);
  console.log(`  proposals:  ${proposals.length}`);
  console.log(`  agents:     ${registry.all().length}`);
  for (const a of registry.all()) {
    console.log(`    - ${a.id.padEnd(16)} scope=${a.scope.join(', ')}`);
  }
  console.log('  by stage:');
  const stageOrder: Stage[] = [
    'research_direction_pending',
    'research',
    'intake',
    'ideation',
    'clarifying',
    'prd_pending_confirmation',
    'approved_for_dev',
    'in_tdd_test',
    'in_dev',
    'in_test_acceptance',
    'test_failed',
    'accepted',
    'deployed',
    'delivered',
  ];
  for (const stage of stageOrder) {
    const n = counts.get(stage) ?? 0;
    if (n > 0) console.log(`    - ${stage.padEnd(30)} ${n}`);
  }
}

export async function cmdReset(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const confirmed = flags.yes === true;
  if (!confirmed) {
    console.error('This will wipe all proposals and audit logs. Pass --yes to confirm.');
    process.exit(1);
  }
  await fs.rm(STORAGE_ROOT, { recursive: true, force: true });
  console.log(`Wiped ${STORAGE_ROOT}`);
}

export async function cmdDemo(_argv: string[]): Promise<void> {
  const { pipeline, audit } = await buildDeps(STORAGE_ROOT);
  const samples: Array<{ title: string; rawRequirement: string; tags?: Record<string, string> }> = [
    {
      title: 'JSON to CSV CLI',
      rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
      tags: { priority: 'P2', scope: 'small' },
    },
    {
      title: 'Markdown linter',
      rawRequirement:
        'Build a markdown linter that catches broken links and inconsistent heading levels.',
      tags: { priority: 'P3', scope: 'small' },
    },
    {
      title: 'Web app for tracking daily reading',
      rawRequirement: 'Build me a clean web UI for tracking daily reading progress with streaks.',
      tags: { priority: 'P1', scope: 'medium' },
    },
  ];
  for (const sample of samples) {
    console.log(`→ ${sample.title}`);
    const proposal = await pipeline.createProposal(sample);
    const final = await pipeline.runToCompletion(proposal);
    const chain = await audit.handoffChain(final.id, final.projectId);
    console.log(
      `   ${final.id}  status=${final.status}  chain=${chain.join(' → ')}  artifacts=${final.artifacts.length}`,
    );
  }
}

export async function run(command: string, argv: string[]): Promise<void> {
  switch (command) {
    case 'deliver':
      return cmdDeliver(argv);
    case 'list':
    case 'ls':
      return cmdList(argv);
    case 'show':
      return cmdShow(argv);
    case 'status':
      return cmdStatus(argv);
    case 'reset':
      return cmdReset(argv);
    case 'demo':
      return cmdDemo(argv);
    case 'serve':
      return cmdServe(argv);
    case 'inspect':
      return cmdInspect(argv);
    case 'events':
      return cmdEvents(argv);
    case 'diff':
      return cmdDiff(argv);
    case 'replay':
      return cmdReplay(argv);
    case 'metrics':
      return cmdMetrics(argv);
    case 'release-ops':
      return cmdReleaseOps(argv, STORAGE_ROOT);
    case 'tui':
      return cmdTui(argv);
    case 'sandbox': {
      const sub = argv[0];
      if (sub !== 'apply') {
        console.error(`Unknown sandbox subcommand: ${sub ?? '(none)'} (expected apply)`);
        process.exit(1);
      }
      return cmdSandboxApply(argv.slice(1), {
        stdout: process.stdout,
        stderr: process.stderr,
      });
    }
    case 'config': {
      // Dispatch the nested subcommand. argv[0] is one of
      // `show | validate | init | path`. We re-slice and pass the tail.
      const sub = argv[0];
      const tail = argv.slice(1);
      switch (sub) {
        case 'show':
          return cmdConfigShow(tail);
        case 'validate':
          return cmdConfigValidate(tail);
        case 'init':
          return cmdConfigInit(tail);
        case 'path':
          return cmdConfigPath(tail);
        default:
          console.error(
            `Unknown config subcommand: ${sub ?? '(none)'} (expected show | validate | init | path)`,
          );
          process.exit(1);
          return;
      }
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

export type { Proposal };
