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
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { cmdDeliver, cmdList, cmdShow, cmdStatus, cmdReset, buildDeps } from '@rdma/cli/run';

const server = new McpServer({
  name: 'rdma',
  version: '0.1.0',
});

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
    const argv = [
      args.title,
      '--requirement',
      args.requirement,
      ...(args.url ? ['--url', args.url] : []),
      ...(args.priority ? ['--priority', args.priority] : []),
      ...(args.scope ? ['--scope', args.scope] : []),
    ];
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '));
    };
    try {
      await cmdDeliver(argv);
    } finally {
      console.log = origLog;
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

server.tool('rdma.list', 'List proposals, optionally filtered by stage.', {
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
}, async (args) => {
  const argv = args.status ? ['--status', args.status] : [];
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => {
    lines.push(a.map((x) => String(x)).join(' '));
  };
  try {
    await cmdList(argv);
  } finally {
    console.log = origLog;
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

server.tool('rdma.show', 'Show the full details of a proposal by id.', {
  proposalId: z.string().describe('The proposal id, e.g. P-20260619-001'),
}, async (args) => {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => {
    lines.push(a.map((x) => String(x)).join(' '));
  };
  try {
    await cmdShow([args.proposalId]);
  } finally {
    console.log = origLog;
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

server.tool('rdma.status', 'Show system status: storage root, proposal counts by stage, registered agents.', {}, async () => {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => {
    lines.push(a.map((x) => String(x)).join(' '));
  };
  try {
    await cmdStatus([]);
  } finally {
    console.log = origLog;
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

server.tool('rdma.step', 'Advance a proposal by one step in the pipeline.', {
  proposalId: z.string().describe('The proposal id to advance'),
}, async (args) => {
  const { storage, pipeline, audit } = buildDeps();
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
});

server.tool('rdma.reset', 'Wipe local storage (proposals + audit log). Requires --yes.', {
  yes: z.boolean().describe('Confirm'),
}, async (args) => {
  if (!args.yes) {
    return { content: [{ type: 'text', text: 'Refused: pass yes=true to confirm.' }] };
  }
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => {
    lines.push(a.map((x) => String(x)).join(' '));
  };
  try {
    await cmdReset(['--yes']);
  } finally {
    console.log = origLog;
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[rdma-mcp] connected via stdio');
}

main().catch((err) => {
  console.error('[rdma-mcp] fatal:', err);
  process.exit(1);
});