/**
 * RDMA MCP server — exposes the multi-agent pipeline as MCP tools.
 *
 * Tools exposed:
 *   - rdma.deliver      Create + drive a proposal to delivery
 *   - rdma.list         List proposals
 *   - rdma.show         Show a proposal's details
 *   - rdma.status       Show system status
 *   - rdma.step         Advance one proposal by one step
 *   - rdma.reset        Wipe local storage (with confirmation)
 *
 * Transport: stdio (so it works with any MCP client — Claude Code,
 * Cursor, Continue, etc.).
 *
 * The bottom of this file only runs the `main()` entry point when the
 * module is the program entry point, so test harnesses can import the
 * `buildServer()` factory and exercise the tool surface without
 * immediately connecting to stdio.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBossAgent } from '@rdma/boss';
import { buildDeps } from '@rdma/cli/run';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { AgentRegistry, AuditLog, Storage } from '@rdma/core';
import { createDesignerAgent } from '@rdma/designer';
import { createDevAgent } from '@rdma/dev';
import { EventBus } from '@rdma/persistence';
import { createPmAgent } from '@rdma/pm';
import { createQaAgent } from '@rdma/qa';
import { createResearchAgent } from '@rdma/research';
import { z } from 'zod';

export interface BuildServerOptions {
  /**
   * Storage root for the wrapped tools. Defaults to the value of
   * `RDMA_STORAGE_ROOT` at call time. Tests pass a fresh tmpdir to keep
   * the JSON state isolated.
   */
  storageRoot?: string;
  /**
   * Shipped root (where boss writes deployment records). Defaults to
   * `RDMA_SHIPPED_ROOT` at call time.
   */
  shippedRoot?: string;
}

export function buildServer(opts: BuildServerOptions = {}): McpServer {
  const server = new McpServer({
    name: 'rdma',
    version: '0.1.0',
  });

  // The tool callbacks always resolve storageRoot + shippedRoot lazily so
  // tests can change process.env between calls without re-importing.
  const resolveStorage = (): string => opts.storageRoot ?? process.env.RDMA_STORAGE_ROOT ?? '';
  const resolveShipped = (): string => opts.shippedRoot ?? process.env.RDMA_SHIPPED_ROOT ?? '';

  async function buildIsolatedDeps(): Promise<{
    storage: import('@rdma/core').StorageDriver;
    audit: AuditLog;
    pipeline: Pipeline;
    bus: EventBus;
    shippedRoot: string;
  }> {
    const root = resolveStorage();
    if (!root) throw new Error('rdma-mcp: RDMA_STORAGE_ROOT is not set');
    const ship = resolveShipped();
    const jsonStore = new Storage({ root });
    await jsonStore.init();
    const audit = new AuditLog(jsonStore);
    const bus = new EventBus();
    const registry = new AgentRegistry();
    registry.register(createResearchAgent());
    registry.register(createCoordinatorAgent());
    registry.register(createDesignerAgent());
    registry.register(createPmAgent());
    registry.register(createDevAgent());
    registry.register(createQaAgent());
    registry.register(createBossAgent({ shippedRoot: ship }));
    const pipeline = new Pipeline({ registry, storage: jsonStore, audit, bus });
    return { storage: jsonStore, audit, pipeline, bus, shippedRoot: ship };
  }

  function buildRenderDeps() {
    // list/show/status reset only need storage (and audit for handoff chain).
    return buildIsolatedDeps();
  }

  server.tool(
    'rdma.deliver',
    'Create a new proposal and drive it through every agent until it reaches a terminal stage.',
    {
      title: z.string().describe('Short title for the proposal'),
      requirement: z.string().describe('The raw requirement text'),
      url: z.string().optional().describe('Optional source URL (e.g. a GitHub issue)'),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional().describe('Priority tag'),
      scope: z.enum(['small', 'medium', 'large']).optional().describe('Scope tag'),
    },
    async (args) => {
      const lines = await captureConsole(async () => {
        const { pipeline } = await buildIsolatedDeps();
        const tags: Record<string, string> = {};
        if (args.priority) tags.priority = args.priority;
        if (args.scope) tags.scope = args.scope;
        const proposal = await pipeline.createProposal({
          title: args.title,
          rawRequirement: args.requirement,
          ...(args.url !== undefined ? { sourceUrl: args.url } : {}),
          ...(Object.keys(tags).length > 0 ? { tags } : {}),
        });
        const final = await pipeline.runToCompletion(proposal);
        const audit = new AuditLog(
          pipeline.storage as unknown as import('@rdma/core').StorageDriver,
        );
        const chain = await audit.handoffChain(final.id, final.projectId);
        console.log(`Created ${final.id} (${final.projectId})`);
        console.log(`  status: ${final.status}`);
        console.log(`  title:  ${final.title}`);
        console.log('');
        console.log('Driving through the pipeline...');
        console.log('');
        console.log(`Delivered: ${final.id}`);
        console.log(`  status:      ${final.status}`);
        console.log(`  artifacts:   ${final.artifacts.length}`);
        for (const a of final.artifacts) {
          console.log(`    - ${a.kind.padEnd(22)} by ${a.agentId.padEnd(16)} — ${a.summary}`);
        }
        console.log(`  chain:       ${chain.join(' → ')}`);
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'rdma.list',
    'List proposals, optionally filtered by stage.',
    {
      status: z
        .enum([
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
        ])
        .optional()
        .describe('Filter by stage'),
    },
    async (args) => {
      const lines = await captureConsole(async () => {
        const { storage, audit } = await buildRenderDeps();
        const all = await storage.listProposals();
        const filtered = args.status ? all.filter((p) => p.status === args.status) : all;
        if (filtered.length === 0) {
          console.log('(no proposals)');
          return;
        }
        console.log(
          `${filtered.length} proposal(s)${args.status ? ` with status=${args.status}` : ''}:`,
        );
        console.log();
        for (const p of filtered) {
          const chain = (await audit.handoffChain(p.id, p.projectId)).join(' → ');
          console.log(
            `${p.id}  ${p.status.padEnd(28)}  ${p.title.slice(0, 50).padEnd(50)}  ${chain}`,
          );
        }
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'rdma.show',
    'Show the full details of a proposal by id.',
    {
      proposalId: z.string().describe('The proposal id, e.g. P-20260619-001'),
    },
    async (args) => {
      const lines = await captureConsole(async () => {
        const { storage, audit } = await buildRenderDeps();
        const proposal = await storage.getProposal(args.proposalId);
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
          console.log(
            `\n  --- ${a.kind} (${a.id.slice(0, 8)}) by ${a.agentId} at ${a.createdAt} ---`,
          );
          console.log(`  ${a.summary}`);
          if (a.content.length < 1500) {
            console.log(a.content);
          } else {
            console.log(a.content.slice(0, 1500));
            console.log(`  ...(${a.content.length - 1500} more chars)`);
          }
        }
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'rdma.status',
    'Show system status: storage root, proposal counts by stage, registered agents.',
    {},
    async () => {
      const lines = await captureConsole(async () => {
        const { storage } = await buildRenderDeps();
        const proposals = await proposalsByStage(storage);
        const meta = await storage.readMeta();
        console.log('RDMA system status');
        console.log(`  storage:    ${resolveStorage()}`);
        console.log(`  meta:       v${meta.version} (created ${meta.createdAt})`);
        console.log(`  proposals:  ${proposals.length}`);
        console.log('  by stage:');
        for (const stage of [
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
        ]) {
          const n = proposals.get(stage) ?? 0;
          if (n > 0) console.log(`    - ${stage.padEnd(30)} ${n}`);
        }
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'rdma.step',
    'Advance a proposal by one step in the pipeline.',
    {
      proposalId: z.string().describe('The proposal id to advance'),
    },
    async (args) => {
      const { storage, pipeline, audit } = await buildIsolatedDeps();
      const proposal = await storage.getProposal(args.proposalId);
      const before = proposal.status;
      const next = await pipeline.step(proposal);
      const chain = await audit.handoffChain(next.id, next.projectId);
      return {
        content: [
          {
            type: 'text',
            text: `${next.id}  ${before} -> ${next.status}\nchain: ${chain.join(' → ')}`,
          },
        ],
      };
    },
  );

  server.tool(
    'rdma.reset',
    'Wipe local storage (proposals + audit log). Requires --yes.',
    {
      yes: z.boolean().describe('Confirm'),
    },
    async (args) => {
      if (!args.yes) {
        return { content: [{ type: 'text', text: 'Refused: pass yes=true to confirm.' }] };
      }
      const lines = await captureConsole(async () => {
        const root = resolveStorage();
        const { promises: fs } = await import('node:fs');
        await fs.rm(root, { recursive: true, force: true });
        console.log(`Wiped ${root}`);
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  return server;
}

async function proposalsByStage(
  storage: import('@rdma/core').StorageDriver,
): Promise<Map<string, number>> {
  const proposals = await storage.listProposals();
  const counts = new Map<string, number>();
  for (const p of proposals) {
    counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
  }
  return counts;
}

async function captureConsole<T>(fn: () => Promise<T> | T): Promise<string[]> {
  const lines: string[] = [];
  const origLog = process.stdout.write.bind(process.stdout);
  const captured = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : Buffer.from(chunk).toString('utf8');
    lines.push(text);
    return true;
  };
  (process.stdout as { write: typeof process.stdout.write }).write = captured;
  try {
    await fn();
  } finally {
    process.stdout.write = origLog;
  }
  return lines;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[rdma-mcp] connected via stdio');
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(process.argv[1]).href === new URL(import.meta.url).href;
  } catch {
    return false;
  }
})();

function pathToFileURL(p: string): URL {
  return new URL(`file://${p}`);
}

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[rdma-mcp] fatal:', err);
    process.exit(1);
  });
}
