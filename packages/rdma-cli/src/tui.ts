/**
 * Minimal zero-dependency TUI for local proposal operations.
 *
 * It intentionally uses Node's built-in readline rather than Ink/Blessed
 * so the workspace stays dependency-free. The `--once` flag renders a
 * snapshot and exits, which is useful for smoke tests and terminals that
 * do not support interactive input.
 */

import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import type { Proposal, StorageDriver } from '@rdma/core';
import { AuditLog, Storage } from '@rdma/core';
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

export async function cmdTui(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  if (flags.once === true) {
    process.stdout.write(await renderTuiSnapshot());
    return;
  }

  const storage = new Storage({ root: STORAGE_ROOT });
  await storage.init();
  const rl = readline.createInterface({ input, output });
  try {
    process.stdout.write(await renderTuiSnapshot());
    while (true) {
      const cmd = (await rl.question('\n[l]ist, [n]ew, [q]uit > ')).trim().toLowerCase();
      if (cmd === 'q' || cmd === 'quit') return;
      if (cmd === 'l' || cmd === 'list') {
        process.stdout.write(`\n${await renderTuiSnapshot()}`);
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
