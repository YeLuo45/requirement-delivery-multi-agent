/**
 * Command implementations — each takes parsed argv.
 *
 * Kept in a separate file so the CLI dispatcher stays small and the
 * command logic can be reused by the MCP server (which exposes the
 * same operations as tools).
 */

import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { AgentRegistry, AuditLog, Storage, type Stage, type Proposal } from '@rdma/core';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { createResearchAgent } from '@rdma/research';
import { createDesignerAgent } from '@rdma/designer';
import { createPmAgent } from '@rdma/pm';
import { createDevAgent } from '@rdma/dev';
import { createQaAgent } from '@rdma/qa';
import { createBossAgent } from '@rdma/boss';

function findMonorepoRoot(startDir: string): string | null {
  // Walk up looking for a package.json that declares "workspaces".
  let dir = startDir;
  // Don't walk past filesystem root.
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const content = readFileSync(pkgPath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'workspaces' in parsed
      ) {
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
  const envOverride = process.env['RDMA_STORAGE_ROOT'];
  if (envOverride) return path.resolve(envOverride);
  if (MONOREPO_ROOT) return path.join(MONOREPO_ROOT, '.rdma', 'data');
  return path.join(process.cwd(), '.rdma', 'data');
})();

export const SHIPPED_ROOT = (() => {
  const envOverride = process.env['RDMA_SHIPPED_ROOT'];
  if (envOverride) return path.resolve(envOverride);
  if (MONOREPO_ROOT) return path.join(MONOREPO_ROOT, '.rdma', 'shipped');
  return path.join(process.cwd(), '.rdma', 'shipped');
})();

export interface BuildDeps {
  registry: AgentRegistry;
  storage: Storage;
  audit: AuditLog;
  pipeline: Pipeline;
}

export async function buildDeps(
  storageRoot: string = STORAGE_ROOT,
  opts: { useLlm?: boolean } = {},
): BuildDeps {
  const storage = new Storage({ root: storageRoot });
  const audit = new AuditLog(storage);
  const registry = new AgentRegistry();
  registry.register(createResearchAgent());
  registry.register(createCoordinatorAgent());
  registry.register(createDesignerAgent());
  registry.register(createPmAgent());
  registry.register(createDevAgent());

  if (opts.useLlm) {
    // Lazy import to avoid loading the LLM providers when not needed.
    const { createAnthropicProvider } = await import('@rdma/llm/anthropic');
    const { createOpenAiProvider } = await import('@rdma/llm/openai');
    const model =
      process.env['ANTHROPIC_API_KEY']
        ? createAnthropicProvider({ apiKey: process.env['ANTHROPIC_API_KEY'] })
        : process.env['OPENAI_API_KEY']
          ? createOpenAiProvider({ apiKey: process.env['OPENAI_API_KEY'] })
          : null;
    if (model) {
      registry.register(createPmAgent({ model }));
      registry.register(createDevAgent({ model }));
      registry.register(createQaAgent({ model }));
      console.error(`[rdma] using LLM provider: ${model.name} (${model.defaultModel})`);
    } else {
      console.error('[rdma] --use-llm set but no ANTHROPIC_API_KEY / OPENAI_API_KEY; falling back to mock agents');
      registry.register(createQaAgent());
    }
  } else {
    registry.register(createQaAgent());
  }

  registry.register(
    createBossAgent({ shippedRoot: SHIPPED_ROOT }),
  );
  const pipeline = new Pipeline({ registry, storage, audit });
  return { registry, storage, audit, pipeline };
}

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
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

export async function cmdDeliver(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const title = positional[0];
  const requirement = typeof flags['requirement'] === 'string' ? flags['requirement'] : undefined;
  const url = typeof flags['url'] === 'string' ? flags['url'] : undefined;
  const priority = typeof flags['priority'] === 'string' ? flags['priority'] : undefined;
  const scope = typeof flags['scope'] === 'string' ? flags['scope'] : undefined;
  const useLlm = flags['use-llm'] === true;

  if (!title || !requirement) {
    console.error('Usage: rdma deliver <title> --requirement "<text>" [--url <src>] [--use-llm]');
    process.exit(1);
  }

  const { pipeline } = await buildDeps(STORAGE_ROOT, { useLlm });
  const tags: Record<string, string> = {};
  if (priority) tags['priority'] = priority;
  if (scope) tags['scope'] = scope;

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
  const status = typeof flags['status'] === 'string' ? (flags['status'] as Stage) : undefined;
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
    console.log(
      `${p.id}  ${p.status.padEnd(28)}  ${p.title.slice(0, 50).padEnd(50)}  ${chain}`,
    );
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
  console.log(`  tags:`);
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

  console.log(`RDMA system status`);
  console.log(`  storage:    ${STORAGE_ROOT}`);
  console.log(`  meta:       v${meta.version} (created ${meta.createdAt})`);
  console.log(`  proposals:  ${proposals.length}`);
  console.log(`  agents:     ${registry.all().length}`);
  for (const a of registry.all()) {
    console.log(`    - ${a.id.padEnd(16)} scope=${a.scope.join(', ')}`);
  }
  console.log(`  by stage:`);
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
  const confirmed = flags['yes'] === true;
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
      rawRequirement: 'Build a markdown linter that catches broken links and inconsistent heading levels.',
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
    console.log(`   ${final.id}  status=${final.status}  chain=${chain.join(' → ')}  artifacts=${final.artifacts.length}`);
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
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

export type { Proposal };