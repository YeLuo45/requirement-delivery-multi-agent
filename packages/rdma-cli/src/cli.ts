#!/usr/bin/env node
/**
 * RDMA CLI — entry point for the requirement-delivery-multi-agent system.
 *
 * Commands:
 *   rdma deliver <title> --requirement "..." [--url "..."]   create + run a proposal
 *   rdma list [--status delivered|...]                       list proposals
 *   rdma show <proposal-id>                                 show one proposal
 *   rdma status                                              show system status
 *   rdma reset                                               wipe local storage
 *   rdma demo                                                run the bootstrap demo
 *   rdma help                                                this help
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRegistry, AuditLog, Storage } from '@rdma/core';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { createResearchAgent } from '@rdma/research';
import { createDesignerAgent } from '@rdma/designer';
import { createPmAgent } from '@rdma/pm';
import { createDevAgent } from '@rdma/dev';
import { createQaAgent } from '@rdma/qa';
import { createBossAgent } from '@rdma/boss';
import { run } from './run.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  switch (cmd) {
    case 'deliver':
      await run('deliver', args.slice(1));
      return;
    case 'list':
    case 'ls':
      await run('list', args.slice(1));
      return;
    case 'show':
      await run('show', args.slice(1));
      return;
    case 'status':
      await run('status', args.slice(1));
      return;
    case 'reset':
      await run('reset', args.slice(1));
      return;
    case 'demo':
      await run('demo', args.slice(1));
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Run `rdma help` for usage.');
      process.exit(1);
  }
}

void __dirname;

function printHelp(): void {
  console.log(`rdma — requirement-delivery-multi-agent CLI

Usage:
  rdma deliver <title> --requirement "<text>" [--url "<src>"] [--priority P1] [--scope small]
      Create a new proposal and drive it through every agent.

  rdma list [--status <stage>]
      List proposals, newest first. Filter by stage if --status is provided.

  rdma show <proposal-id>
      Show a proposal's full details, including all artifacts and the handoff chain.

  rdma status
      Show system status: storage root, proposal counts by stage, registered agents.

  rdma reset [--yes]
      Wipe local storage. Prompts for confirmation unless --yes is passed.

  rdma demo
      Run the bootstrap demo (creates and delivers 3 sample proposals).

  rdma help
      This help.

Examples:
  rdma deliver "JSON to CSV CLI" --requirement "Convert a JSON array of objects to CSV."
  rdma list
  rdma show P-20260619-001
  rdma status
`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`rdma: ${message}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});