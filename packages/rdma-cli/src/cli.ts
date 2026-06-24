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
 *   rdma serve [--port N] [--host IP] [--storage json|sqlite] start a long-running daemon
 *   rdma tui [--once]                                        terminal proposal browser
 *   rdma config show|validate|init|path                     per-agent configuration
 *   rdma inspect <proposal-id>                               show proposal handoff + audit timeline
 *   rdma events [--proposal <id>] [--limit N] [--since-seq M] stream audit-derived events
 *   rdma release-ops [--json|--fix-prompt|--pr-draft|--ci-summary] summarize release history
 *   rdma help                                                this help
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  exit: (code: number) => void;
}

const defaultIo: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
  exit: (code) => process.exit(code),
};

export function printHelp(out: NodeJS.WritableStream = defaultIo.stdout): void {
  out.write(`rdma — requirement-delivery-multi-agent CLI

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

  rdma serve [--port 47555] [--host 127.0.0.1] [--storage json|sqlite] [--use-llm]
      Start a long-running daemon. Exposes:
        GET  /health              liveness probe
        GET  /proposals           list summaries
        GET  /proposals/:id       one proposal + handoff chain
        GET  /inspect/:id         JSON inspect view
        GET  /events              JSON audit event stream
        POST /deliver {title,requirement[,sourceUrl]}
                                 run a new proposal (async by default;
                                 append ?wait=1 to block until delivered)
        GET  /ws                  WebSocket — events fan out as the
                                 pipeline runs (use with the web
                                 dashboard or any @rdma/realtime client)
      Default storage is json. Use --storage sqlite to switch the
      daemon's backend at boot.

  rdma tui [--once]
      Open a terminal UI for listing and creating local proposals.
      Use --once to print a non-interactive snapshot and exit.

  rdma config <subcommand>
      Manage the per-agent LLM + prompt configuration.
      Subcommands:
        show [--all] [<agent>]   print the resolved LLM config for one
                                 or all agents
        validate                 parse .rdma/agents.yaml and report
                                 (exit 0 on success)
        init [--force]           write a templated .rdma/agents.yaml
                                 with pm / dev / qa stubs
        path                     print the resolved .rdma root

  rdma sandbox apply --workspace-root <path> --proposal <id> --files <path>=<content>
                       [--project <id>] [--test-command <cmd>] [--dry-run]
      Apply a file patch inside the proposal's isolated sandbox and
      print a reviewable patch bundle summary. Refuses writes that
      escape the sandbox root. Use --dry-run to preview without
      writing to disk.

  rdma inspect <proposal-id>
      Show the handoff chain, artifacts, and audit timeline of a proposal.

  rdma events [--proposal <id>] [--limit N] [--since-seq M]
      Stream audit-derived events; omit --proposal to list across all proposals.

  rdma release-ops [--json] [--fix-prompt] [--pr-draft] [--ci-summary] [--proposal <id>]
      Summarize local release history, failed gates, commit manifests,
      stable automation JSON, CI summaries, copy-ready stage/status
      suggestions, write file-based delivery reports, and build explicit
      MCP status apply plans. Status apply defaults to dry-run; pass
      --execute to print the exact MCP command to run.

  rdma help
      This help.

Examples:
  rdma deliver "JSON to CSV CLI" --requirement "Convert a JSON array of objects to CSV."
  rdma list
  rdma show P-20260619-001
  rdma status
  rdma serve --port 47555
`);
}

export async function main(
  args: string[],
  io: CliIo = defaultIo,
  runFn: (cmd: string, argv: string[]) => Promise<void> = run,
): Promise<number> {
  const cmd = args[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp(io.stdout);
    return 0;
  }

  switch (cmd) {
    case 'deliver':
    case 'list':
    case 'ls':
    case 'show':
    case 'status':
    case 'reset':
    case 'demo':
    case 'serve':
    case 'inspect':
    case 'events':
    case 'diff':
    case 'replay':
    case 'metrics':
    case 'release-ops':
    case 'tui':
    case 'config':
    case 'sandbox':
      await runFn(cmd, args.slice(1));
      return 0;
    default: {
      io.stderr.write(`Unknown command: ${cmd}\n`);
      io.stderr.write('Run `rdma help` for usage.\n');
      io.exit(1);
      return 1;
    }
  }
}

void __dirname;

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === __filename;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) {
        process.exit(code);
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`rdma: ${message}\n`);
      if (err instanceof Error && err.stack) {
        process.stderr.write(`${err.stack}\n`);
      }
      process.exit(1);
    });
}
