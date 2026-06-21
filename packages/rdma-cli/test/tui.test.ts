/**
 * Tests for the TUI snapshot renderer + interactive command surface.
 *
 * The interactive `cmdTui` keeps running until the user types `q` — we
 * avoid spawning a real readline by exercising `renderTuiSnapshot` and the
 * individual command helpers. New in this round: show one proposal,
 * inspect one proposal (handoff chain + audit), filter by status, and
 * the per-agent configuration snapshot.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  inspectProposalText,
  renderTuiConfig,
  renderTuiProposal,
  renderTuiSnapshot,
} from '../src/tui.js';

let workDir: string;
let storageRoot: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rdma-tui-snapshot-'));
  storageRoot = join(workDir, 'data');
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function seedProposal(): Promise<string> {
  // Reuse the Storage layer so the file format matches what CLI produces.
  const { Storage } = await import('@rdma/core');
  const storage = new Storage({ root: storageRoot });
  await storage.init();
  const now = new Date().toISOString();
  const proposal = {
    id: 'P-20260621-001',
    projectId: 'PRJ-20260621-001',
    title: 'JSON to CSV CLI',
    rawRequirement: 'Convert a JSON array of objects to CSV.',
    status: 'delivered',
    owner: 'boss',
    clarificationRound: 0,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
    tags: {},
  };
  await storage.saveProposal(proposal);
  const auditDir = join(storageRoot, 'audit', proposal.projectId);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(auditDir, { recursive: true });
  writeFileSync(
    join(auditDir, `${proposal.id}.jsonl`),
    [
      JSON.stringify({
        id: 'a1',
        proposalId: proposal.id,
        actor: 'system',
        action: 'proposal.create',
        at: now,
        detail: {},
      }),
      JSON.stringify({
        id: 'a2',
        proposalId: proposal.id,
        actor: 'coordinator',
        action: 'handoff',
        at: now,
        detail: {},
      }),
      JSON.stringify({
        id: 'a3',
        proposalId: proposal.id,
        actor: 'pm',
        action: 'stage.transition',
        at: now,
        detail: { from: 'research', to: 'clarifying' },
      }),
    ].join('\n'),
  );
  return proposal.id;
}

describe('renderTuiSnapshot', () => {
  it('prints the storage root + proposal count', async () => {
    await seedProposal();
    const out = await renderTuiSnapshot(storageRoot);
    assert.match(out, /RDMA TUI/);
    assert.match(out, new RegExp(`storage: ${storageRoot.replace(/\//g, '\\/')}`));
    assert.match(out, /proposals: 1/);
    assert.match(out, /P-20260621-001/);
  });

  it('reports "(no proposals)" on an empty store', async () => {
    const out = await renderTuiSnapshot(storageRoot);
    assert.match(out, /proposals: 0/);
    assert.match(out, /\(no proposals\)/);
  });
});

describe('renderTuiProposal', () => {
  it('renders the full proposal block including artifacts', async () => {
    await seedProposal();
    const out = await renderTuiProposal(storageRoot, 'P-20260621-001');
    assert.match(out, /P-20260621-001/);
    assert.match(out, /JSON to CSV CLI/);
    assert.match(out, /status:\s+delivered/);
    assert.match(out, /handoff chain/);
    assert.match(out, /pm/);
    assert.match(out, /artifacts: 0/);
  });

  it('throws when the proposal id is unknown', async () => {
    await seedProposal();
    await assert.rejects(renderTuiProposal(storageRoot, 'P-DOES-NOT-EXIST'), /not found/i);
  });
});

describe('inspectProposalText', () => {
  it('renders the handoff chain and audit timeline', async () => {
    await seedProposal();
    const out = await inspectProposalText(storageRoot, 'P-20260621-001');
    assert.match(out, /P-20260621-001/);
    assert.match(out, /handoff chain|chain:/);
    assert.match(out, /pm/);
    assert.match(out, /audit timeline/);
    assert.match(out, /proposal.create/);
  });
});

describe('renderTuiConfig', () => {
  it('reports "(no per-agent configuration found)" when .rdma/agents.yaml is missing', async () => {
    const out = await renderTuiConfig(storageRoot);
    assert.match(out, /per-agent configuration/);
    assert.match(out, /no agents.yaml/);
  });

  it('lists the agents declared in .rdma/agents.yaml with their resolved LLM', async () => {
    const { mkdirSync } = await import('node:fs');
    const rdmaRoot = join(workDir, '.rdma');
    mkdirSync(rdmaRoot, { recursive: true });
    writeFileSync(
      join(rdmaRoot, 'agents.yaml'),
      [
        'defaults:',
        '  provider: anthropic',
        '  model: claude-sonnet-4',
        '',
        'agents:',
        '  pm:',
        '    temperature: 0.3',
        '  dev:',
        '    provider: openai',
        '    apiKey: "stub"',
        '',
      ].join('\n'),
    );
    const out = await renderTuiConfig(rdmaRoot);
    assert.match(out, /pm/);
    assert.match(out, /dev/);
    assert.match(out, /claude-sonnet-4/);
    assert.match(out, /openai/);
  });
});
