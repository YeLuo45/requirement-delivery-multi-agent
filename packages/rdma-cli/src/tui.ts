/**
 * Minimal zero-dependency TUI for local proposal operations.
 *
 * It intentionally uses Node's built-in readline rather than Ink/Blessed
 * so the workspace stays dependency-free. The `--once` flag renders a
 * snapshot and exits, which is useful for smoke tests and terminals that
 * do not support interactive input.
 *
 * Interactive commands:
 *   l / list        — render the current proposal list
 *   s <id> / show   — print one proposal (id, status, handoff, audit)
 *   c / config      — print the resolved per-agent configuration
 *   n / new         — create a new proposal (asks for title + requirement)
 *   q / quit        — exit the TUI
 */

import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import { type AgentRuntimeConfig, loadAgentConfig } from '@rdma/config';
import type { Proposal, StorageDriver } from '@rdma/core';
import { AuditLog, ProposalNotFoundError, Storage } from '@rdma/core';
import { createProposal, makeIdGenerator } from '@rdma/core/proposal';
import { STORAGE_ROOT, parseArgs } from './run.js';

function datePrefix(date: Date): string {
  return `${date.getUTCFullYear()}${(date.getUTCMonth() + 1).toString().padStart(2, '0')}${date
    .getUTCDate()
    .toString()
    .padStart(2, '0')}`;
}

function nextSequence(ids: ReadonlyArray<string>, prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

async function makeProposal(
  storage: StorageDriver,
  title: string,
  requirement: string,
): Promise<Proposal> {
  const existing = await storage.listProposals();
  const now = new Date();
  const prefix = datePrefix(now);
  const proposal = createProposal({
    title: title.trim(),
    rawRequirement: requirement.trim(),
    ids: makeIdGenerator(),
    projectSeq: nextSequence(
      existing.map((p) => p.projectId),
      `PRJ-${prefix}-`,
    ),
    proposalSeq: nextSequence(
      existing.map((p) => p.id),
      `P-${prefix}-`,
    ),
    now,
  });
  await storage.saveProposal(proposal);
  const audit = new AuditLog(storage);
  await audit.record({
    proposalId: proposal.id,
    projectId: proposal.projectId,
    actor: 'system',
    action: 'proposal.create',
    detail: { title: proposal.title, status: proposal.status, projectId: proposal.projectId },
  });
  return proposal;
}

/**
 * Render the proposal list to a plain-text block. Used by both the
 * interactive TUI and the `--once` snapshot path.
 */
export async function renderTuiSnapshot(storageRoot = STORAGE_ROOT): Promise<string> {
  const storage = new Storage({ root: storageRoot });
  await storage.init();
  const proposals = await storage.listProposals();
  const lines = ['RDMA TUI', `storage: ${storage.root}`, `proposals: ${proposals.length}`, ''];
  if (proposals.length === 0) {
    lines.push('(no proposals)');
  } else {
    for (const p of proposals) {
      lines.push(`${p.id}  ${p.status.padEnd(28)}  ${p.title}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Render a single proposal's full detail (id, status, handoff, artifacts).
 * Throws `ProposalNotFoundError` when the id is unknown — callers (the
 * interactive TUI, the CLI `show` command, MCP `rdma.show`) translate
 * that into a user-visible message.
 */
export async function renderTuiProposal(storageRoot: string, proposalId: string): Promise<string> {
  const storage = new Storage({ root: storageRoot });
  await storage.init();
  const proposal = await storage.getProposal(proposalId).catch((err) => {
    if (err instanceof ProposalNotFoundError) {
      throw new Error(`proposal not found: ${proposalId}`);
    }
    throw err;
  });
  const audit = new AuditLog(storage);
  const chain = await audit.handoffChain(proposal.id, proposal.projectId);
  const entries = await audit.list(proposal.id, proposal.projectId);
  const lines = [
    `# ${proposal.id}  —  ${proposal.title}`,
    '',
    `status:    ${proposal.status}`,
    `project:   ${proposal.projectId}`,
    `created:   ${proposal.createdAt}`,
    `updated:   ${proposal.updatedAt}`,
    `artifacts: ${proposal.artifacts.length}`,
    '',
    `handoff chain: ${chain.length > 0 ? chain.join(' → ') : '(none)'}`,
    '',
    `audit timeline: ${entries.length} entries`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Render a human-readable audit / handoff view for one proposal.
 * Mirrors the format produced by `rdma inspect <id>` so the TUI shows
 * the same content the CLI does.
 */
export async function inspectProposalText(
  storageRoot: string,
  proposalId: string,
): Promise<string> {
  const storage = new Storage({ root: storageRoot });
  await storage.init();
  const proposal = await storage.getProposal(proposalId).catch((err) => {
    if (err instanceof ProposalNotFoundError) {
      throw new Error(`proposal not found: ${proposalId}`);
    }
    throw err;
  });
  const audit = new AuditLog(storage);
  const chain = await audit.handoffChain(proposal.id, proposal.projectId);
  const entries = await audit.list(proposal.id, proposal.projectId);
  const lines = [
    `inspect ${proposal.id}`,
    `  status:   ${proposal.status}`,
    `  project:  ${proposal.projectId}`,
    `  title:    ${proposal.title}`,
    `  chain:    ${chain.join(' → ')}`,
    '',
    'audit timeline:',
  ];
  for (const e of entries) {
    lines.push(`  ${e.at}  ${e.actor.padEnd(16)}  ${e.action}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Render the resolved per-agent configuration. Falls back to a friendly
 * "(no per-agent configuration found)" line when `.rdma/agents.yaml`
 * doesn't exist on disk — the TUI is for operators, not for tests.
 */
export async function renderTuiConfig(configRoot = path.dirname(STORAGE_ROOT)): Promise<string> {
  const configs = await loadAgentConfig({ root: configRoot });
  const known = ['market_research', 'coordinator', 'designer', 'pm', 'dev', 'qa', 'boss'];
  const agentIds = Array.from(new Set([...known, ...Object.keys(configs)])).sort();
  if (Object.keys(configs).length === 0) {
    return [
      'RDMA TUI — per-agent configuration',
      `root: ${configRoot}`,
      '',
      '(no agents.yaml found — every agent is running in mock mode)',
    ].join('\n');
  }
  const lines = ['RDMA TUI — per-agent configuration', `root: ${configRoot}`, ''];
  for (const id of agentIds) {
    const cfg = configs[id];
    if (!cfg) {
      lines.push(`${id.padEnd(16)}  (no config — mock)`);
      continue;
    }
    const llm = cfg.llm
      ? `${cfg.llm.provider}${cfg.llm.model ? ` / ${cfg.llm.model}` : ''}`
      : '(no LLM — mock)';
    const source = cfg.source;
    const prompts =
      cfg.prompts.soul || cfg.prompts.user || cfg.prompts.memory ? 'prompts=on' : 'prompts=off';
    lines.push(`${id.padEnd(16)}  ${llm.padEnd(28)}  source=${source}  ${prompts}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Format a list of agents + their merged config for the TUI. Pulled out
 * so the test can assert the shape without going through readline.
 */
export function formatConfigTable(configs: Record<string, AgentRuntimeConfig>): string {
  const ids = Object.keys(configs).sort();
  if (ids.length === 0) return '(no agents configured)';
  const lines: string[] = [];
  for (const id of ids) {
    const cfg = configs[id];
    if (!cfg) continue;
    const llm = cfg.llm
      ? `${cfg.llm.provider}${cfg.llm.model ? ` / ${cfg.llm.model}` : ''}`
      : 'mock';
    lines.push(`${id.padEnd(16)}  ${llm.padEnd(28)}  source=${cfg.source}`);
  }
  return lines.join('\n');
}

export async function cmdTui(argv: string[]): Promise<void> {
  const { flags, positional } = parseArgs(argv);
  if (flags.once === true) {
    process.stdout.write(await renderTuiSnapshot());
    return;
  }
  if (flags.config === true) {
    process.stdout.write(await renderTuiConfig());
    return;
  }

  const showId = typeof flags.show === 'string' ? flags.show : positional[0];
  if (typeof showId === 'string' && showId.length > 0) {
    process.stdout.write(await renderTuiProposal(STORAGE_ROOT, showId));
    return;
  }

  const storage = new Storage({ root: STORAGE_ROOT });
  await storage.init();
  const rl = readline.createInterface({ input, output });
  try {
    process.stdout.write(await renderTuiSnapshot());
    process.stdout.write('\n[l]ist  [s]how <id>  [c]onfig  [n]ew  [q]uit\n');
    while (true) {
      const raw = (await rl.question('> ')).trim();
      if (raw.length === 0) continue;
      const [head, ...rest] = raw.split(/\s+/);
      const cmd = (head ?? '').toLowerCase();
      if (cmd === 'q' || cmd === 'quit') return;
      if (cmd === 'l' || cmd === 'list') {
        process.stdout.write(`\n${await renderTuiSnapshot()}`);
        continue;
      }
      if (cmd === 's' || cmd === 'show') {
        const id = rest[0];
        if (!id) {
          process.stdout.write('usage: show <proposal-id>\n');
          continue;
        }
        try {
          process.stdout.write(`\n${await renderTuiProposal(STORAGE_ROOT, id)}`);
        } catch (err) {
          process.stdout.write(`${err instanceof Error ? err.message : String(err)}\n`);
        }
        continue;
      }
      if (cmd === 'i' || cmd === 'inspect') {
        const id = rest[0];
        if (!id) {
          process.stdout.write('usage: inspect <proposal-id>\n');
          continue;
        }
        try {
          process.stdout.write(`\n${await inspectProposalText(STORAGE_ROOT, id)}`);
        } catch (err) {
          process.stdout.write(`${err instanceof Error ? err.message : String(err)}\n`);
        }
        continue;
      }
      if (cmd === 'c' || cmd === 'config') {
        process.stdout.write(`\n${await renderTuiConfig()}`);
        continue;
      }
      if (cmd === 'n' || cmd === 'new') {
        const title = await rl.question('title > ');
        const requirement = await rl.question('requirement > ');
        if (!title.trim() || !requirement.trim()) {
          process.stdout.write('title and requirement are required\n');
          continue;
        }
        const proposal = await makeProposal(storage, title, requirement);
        process.stdout.write(`created ${proposal.id} (${proposal.projectId})\n`);
        continue;
      }
      process.stdout.write('unknown command\n');
    }
  } finally {
    rl.close();
  }
}
