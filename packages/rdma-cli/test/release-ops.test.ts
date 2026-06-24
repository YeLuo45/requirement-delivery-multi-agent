import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildReleaseOpsPayload,
  renderReleaseOpsApplyStatusDryRun,
  renderReleaseOpsApplyStatusExecutionPlan,
  renderReleaseOpsAutomationJson,
  renderReleaseOpsCiSummary,
  renderReleaseOpsFixPrompt,
  renderReleaseOpsPrDraft,
  renderReleaseOpsRecoveryPlan,
  renderReleaseOpsStageCommands,
  renderReleaseOpsText,
  writeReleaseOpsDeliveryReportFiles,
} from '../src/release-ops.js';

function seedReleaseOpsFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'rdma-release-ops-'));
  const proposalRoot = path.join(root, 'proposals', 'PRJ-ops');
  const historyRoot = path.join(root, 'release-local');
  mkdirSync(proposalRoot, { recursive: true });
  mkdirSync(historyRoot, { recursive: true });
  writeFileSync(
    path.join(proposalRoot, 'P-ops.json'),
    JSON.stringify({
      id: 'P-ops',
      projectId: 'PRJ-ops',
      title: 'Release ops',
      status: 'in_test_acceptance',
      createdAt: '2026-06-24T00:00:00.000Z',
      updatedAt: '2026-06-24T00:00:00.000Z',
      artifacts: [],
      tags: {},
    }),
  );
  writeFileSync(
    path.join(proposalRoot, 'P-clean.json'),
    JSON.stringify({
      id: 'P-clean',
      projectId: 'PRJ-ops',
      title: 'Clean release',
      status: 'accepted',
      createdAt: '2026-06-24T01:00:00.000Z',
      updatedAt: '2026-06-24T01:00:00.000Z',
      artifacts: [],
      tags: {},
    }),
  );
  writeFileSync(
    path.join(historyRoot, 'ops.json'),
    JSON.stringify({
      proposalId: 'P-ops',
      generatedAt: '2026-06-24T03:00:00.000Z',
      historyPath: 'artifacts/release-local/ops.json',
      gateResults: [
        { label: 'check', status: 'pass', exitCode: 0, durationMs: 10, checklist: [] },
        {
          label: 'build',
          status: 'fail',
          exitCode: 1,
          durationMs: 20,
          checklist: ['Fix production bundle.', 'Rerun npm run build.'],
        },
      ],
      dirty: { readmeDemoJson: ['PRJ-ops/P-ops.json'], ordinaryDirty: ['packages/x/src/a.ts'] },
      ownership: {
        proposalId: 'P-ops',
        sourceFiles: ['packages/x/src/a.ts'],
        testFiles: ['packages/x/test/a.test.ts'],
        docs: ['docs/proposals/P-ops-prd.md'],
        generated: ['PRJ-ops/P-ops.json'],
        other: [],
      },
    }),
  );
  writeFileSync(
    path.join(historyRoot, 'clean.json'),
    JSON.stringify({
      proposalId: 'P-clean',
      generatedAt: '2026-06-24T04:00:00.000Z',
      historyPath: 'artifacts/release-local/clean.json',
      gateResults: [
        { label: 'check', status: 'pass', exitCode: 0, durationMs: 10, checklist: [] },
        { label: 'build', status: 'pass', exitCode: 0, durationMs: 20, checklist: [] },
      ],
      dirty: { readmeDemoJson: [], ordinaryDirty: [] },
      ownership: {
        proposalId: 'P-clean',
        sourceFiles: [],
        testFiles: [],
        docs: [],
        generated: [],
        other: [],
      },
    }),
  );
  return root;
}

describe('release-ops CLI helpers', () => {
  it('builds a machine-readable release ops payload from local storage', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, {});
      const opsManifest = payload.commitManifests.find(
        (manifest) => manifest.proposalId === 'P-ops',
      );
      assert.equal(payload.failedGateQueue.length, 1);
      assert.equal(payload.failedGateQueue[0]?.proposalId, 'P-ops');
      assert.equal(payload.failedGateQueue[0]?.gateLabel, 'build');
      assert.equal(opsManifest?.proposalId, 'P-ops');
      assert.equal(opsManifest?.counts.sourceFiles, 1);
      assert.match(payload.remediationMarkdown, /Fix production bundle/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('filters release ops payloads by proposal id', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, { proposalId: 'P-missing' });
      assert.deepEqual(payload.failedGateQueue, []);
      assert.deepEqual(payload.commitManifests, []);
      assert.match(payload.remediationMarkdown, /No failed release gates/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders text and fix prompt output for human handoff', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, {});
      const text = renderReleaseOpsText(payload);
      const prompt = renderReleaseOpsFixPrompt(payload);
      assert.match(text, /Release Operations/);
      assert.match(text, /P-ops\s+build/);
      assert.match(text, /source=1 test=1 docs=1 generated=1 other=0/);
      assert.match(prompt, /Fix proposal P-ops/);
      assert.match(prompt, /Verification commands/);
      assert.match(prompt, /npm run build/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds release index, stage commands, and PR draft markdown', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, {});
      assert.equal(payload.releaseIndex[0]?.proposalId, 'P-clean');
      assert.equal(payload.releaseIndex[1]?.proposalId, 'P-ops');
      assert.equal(payload.releaseIndex[1]?.failedGateCount, 1);
      assert.equal(payload.releaseIndex[1]?.dirtyFileCount, 2);

      const commands = renderReleaseOpsStageCommands(payload);
      assert.deepEqual(commands, [
        'git add -- packages/x/src/a.ts packages/x/test/a.test.ts docs/proposals/P-ops-prd.md PRJ-ops/P-ops.json',
      ]);

      const draft = renderReleaseOpsPrDraft(payload);
      assert.match(draft, /^# Release Operations PR Draft/);
      assert.match(draft, /Failed gates: 1/);
      assert.match(draft, /P-ops build/);
      assert.match(draft, /npm run verify:readme/);
      assert.match(draft, /source=1 test=1 docs=1 generated=1 other=0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders stable automation JSON, CI summary, and safe status suggestions', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, {});
      const automation = renderReleaseOpsAutomationJson(payload);
      assert.equal(automation.schemaVersion, 'release-ops.v2');
      assert.equal(automation.prDraftMarkdown.startsWith('# Release Operations PR Draft'), true);
      assert.deepEqual(automation.stageCommands, [
        'git add -- packages/x/src/a.ts packages/x/test/a.test.ts docs/proposals/P-ops-prd.md PRJ-ops/P-ops.json',
      ]);
      assert.deepEqual(automation.statusSuggestions, [
        {
          proposalId: 'P-clean',
          currentStatus: 'accepted',
          suggestedStatus: 'deployed',
          reason: 'release gates passed; accepted proposal can be marked deployed',
        },
        {
          proposalId: 'P-ops',
          currentStatus: 'in_test_acceptance',
          suggestedStatus: 'test_failed',
          reason: 'latest release history has failed gates',
        },
      ]);

      const summary = renderReleaseOpsCiSummary(payload);
      assert.match(summary, /^# RDMA Release Operations Summary/);
      assert.match(summary, /Schema: release-ops.v2/);
      assert.match(summary, /P-ops → test_failed/);
      assert.match(summary, /P-clean → deployed/);
      assert.match(summary, /git add -- packages\/x\/src\/a.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders safe apply-status dry-run output without mutating proposal state', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, {});
      const dryRun = renderReleaseOpsApplyStatusDryRun(payload, 'P-clean', 'deployed');
      assert.match(dryRun, /DRY RUN/);
      assert.match(dryRun, /P-clean: accepted → deployed/);
      assert.match(dryRun, /release gates passed/);
      assert.match(dryRun, /No proposal state was changed/);

      const blocked = renderReleaseOpsApplyStatusDryRun(payload, 'P-clean', 'delivered');
      assert.match(blocked, /BLOCKED/);
      assert.match(blocked, /not a safe next status/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders explicit execute-mode MCP status apply commands for safe transitions only', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, {});
      const plan = renderReleaseOpsApplyStatusExecutionPlan(payload, 'P-clean', 'deployed', {
        execute: true,
        mcpHelperPath: '/tools/mcp_aisp.py',
      });

      assert.equal(plan.mode, 'execute');
      assert.deepEqual(plan.commands, [
        'python3 /tools/mcp_aisp.py update-proposal-status --proposal-id P-clean --status deployed',
      ]);
      assert.match(plan.text, /EXECUTE PLAN/);
      assert.match(plan.text, /P-clean: accepted → deployed/);

      const blocked = renderReleaseOpsApplyStatusExecutionPlan(payload, 'P-clean', 'delivered', {
        execute: true,
        mcpHelperPath: '/tools/mcp_aisp.py',
      });
      assert.equal(blocked.mode, 'blocked');
      assert.deepEqual(blocked.commands, []);
      assert.match(blocked.text, /BLOCKED/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes file-based delivery reports under release-local artifacts', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, {});
      const result = await writeReleaseOpsDeliveryReportFiles(root, payload, {
        generatedAt: '2026-06-24T05:00:00.000Z',
      });

      assert.deepEqual(
        result.files.map((file) => path.relative(root, file.path)),
        [
          'release-local/delivery-report.md',
          'release-local/ci-evidence.md',
          'release-local/automation.json',
          'release-local/index.json',
          'release-local/proposal-health.json',
          'release-local/diff.json',
          'release-local/replay.md',
        ],
      );
      assert.match(result.files[0]?.content ?? '', /# Release Operations PR Draft/);
      assert.match(result.files[1]?.content ?? '', /# CI Evidence Notes/);
      assert.match(result.files[2]?.content ?? '', /"schemaVersion": "release-ops.v2"/);
      assert.match(result.files[3]?.content ?? '', /"schemaVersion": "release-artifact-hub.v1"/);
      assert.match(result.files[4]?.content ?? '', /"summary"/);
      assert.match(result.files[5]?.content ?? '', /"proposals"/);
      assert.match(result.files[6]?.content ?? '', /# Release Replay Timeline/);
      assert.equal(existsSync(path.join(root, 'release-local', 'delivery-report.md')), true);
      assert.match(
        readFileSync(path.join(root, 'release-local', 'automation.json'), 'utf8'),
        /"schemaVersion": "release-ops.v2"/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders a proposal MCP recovery plan with current status and safe next hops', async () => {
    const root = seedReleaseOpsFixture();
    try {
      const payload = await buildReleaseOpsPayload(root, {});
      const recovery = renderReleaseOpsRecoveryPlan(payload, {
        mcpHelperPath: '/tools/mcp_aisp.py',
      });

      assert.match(recovery, /^# Proposal MCP Recovery Plan/);
      assert.match(recovery, /P-clean: accepted → deployed/);
      assert.match(
        recovery,
        /python3 \/tools\/mcp_aisp\.py update-proposal-status --proposal-id P-clean --status deployed/,
      );
      assert.match(recovery, /P-ops: in_test_acceptance → test_failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
