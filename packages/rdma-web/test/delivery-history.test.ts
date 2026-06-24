import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDeliveryReportHistoryModel,
  buildDirtyFileOwnershipGuard,
  buildProposalDeliveryReport,
  buildReleaseArtifactBrowser,
  buildReleaseHistoryRows,
  buildReleaseOperationsCenter,
  buildSafeStatusApplyPlan,
  renderReleaseRemediationMarkdown,
} from '../src/delivery-history.js';

describe('delivery report history model', () => {
  it('attaches the newest release history for a proposal', () => {
    const model = buildDeliveryReportHistoryModel(
      { id: 'P-20260623-022', title: 'Release automation', status: 'accepted' },
      [
        {
          proposalId: 'P-20260623-022',
          title: 'old',
          generatedAt: '2026-06-23T10:00:00.000Z',
          historyPath: 'artifacts/release-local/old.json',
          gates: [],
          dirty: { readmeDemoJson: [], ordinaryDirty: ['README.md'] },
          ownership: {
            proposalId: 'P-20260623-022',
            sourceFiles: [],
            testFiles: [],
            docs: ['README.md'],
            generated: [],
            other: [],
          },
        },
        {
          proposalId: 'P-20260623-022',
          title: 'new',
          generatedAt: '2026-06-23T12:00:00.000Z',
          historyPath: 'artifacts/release-local/new.json',
          gates: [{ label: 'check', command: 'npm run check' }],
          dirty: { readmeDemoJson: [], ordinaryDirty: ['packages/rdma-web/src/App.tsx'] },
          ownership: {
            proposalId: 'P-20260623-022',
            sourceFiles: ['packages/rdma-web/src/App.tsx'],
            testFiles: [],
            docs: [],
            generated: [],
            other: [],
          },
        },
      ],
    );

    assert.equal(model.proposalId, 'P-20260623-022');
    assert.equal(model.latestHistory?.historyPath, 'artifacts/release-local/new.json');
    assert.equal(model.dirtyFileCount, 1);
    assert.deepEqual(model.safeNextActions, ['deployed']);
  });

  it('summarizes persisted gate results for delivery report pages', () => {
    const model = buildDeliveryReportHistoryModel(
      { id: 'P-20260623-031', title: 'Real gates', status: 'in_test_acceptance' },
      [
        {
          proposalId: 'P-20260623-031',
          generatedAt: '2026-06-23T13:00:00.000Z',
          historyPath: 'artifacts/release-local/run.json',
          gateResults: [
            { label: 'check', status: 'pass', exitCode: 0, durationMs: 10, checklist: [] },
            {
              label: 'coverage',
              status: 'fail',
              exitCode: 1,
              durationMs: 20,
              checklist: ['Add focused tests for uncovered new code paths.'],
            },
          ],
          dirty: { readmeDemoJson: [], ordinaryDirty: [] },
        },
      ],
    );

    assert.equal(model.gateSummary.total, 2);
    assert.equal(model.gateSummary.passed, 1);
    assert.equal(model.gateSummary.failed, 1);
    assert.deepEqual(model.failedGateHints, ['Add focused tests for uncovered new code paths.']);
  });

  it('builds release history rows only from supplied persisted histories', () => {
    const rows = buildReleaseHistoryRows(
      [
        { id: 'P-real', title: 'Real record', status: 'accepted' },
        { id: 'P-demo', title: 'Demo should not appear', status: 'accepted' },
      ],
      [
        {
          proposalId: 'P-real',
          generatedAt: '2026-06-24T01:00:00.000Z',
          historyPath: 'artifacts/release-local/release.json',
          gateResults: [
            { label: 'check', status: 'pass', exitCode: 0, durationMs: 1, checklist: [] },
          ],
          dirty: { readmeDemoJson: [], ordinaryDirty: ['README.md'] },
        },
      ],
    );

    assert.deepEqual(
      rows.map((row) => row.proposalId),
      ['P-real'],
    );
    assert.equal(rows[0]?.gateSummary.passed, 1);
  });

  it('builds a release operations center with failed gates newest first and staging counts', () => {
    const center = buildReleaseOperationsCenter(
      [
        { id: 'P-old', title: 'Old release', status: 'accepted' },
        { id: 'P-new', title: 'New release', status: 'in_test_acceptance' },
      ],
      [
        {
          proposalId: 'P-old',
          generatedAt: '2026-06-24T01:00:00.000Z',
          historyPath: 'artifacts/release-local/old.json',
          gateResults: [
            {
              label: 'coverage',
              status: 'fail',
              exitCode: 1,
              durationMs: 20,
              checklist: ['Add branch tests.'],
            },
          ],
          dirty: { readmeDemoJson: ['PRJ-1/P-1.json'], ordinaryDirty: ['README.md'] },
          ownership: {
            proposalId: 'P-old',
            sourceFiles: ['packages/rdma-web/src/old.ts'],
            testFiles: ['packages/rdma-web/test/old.test.ts'],
            docs: ['README.md'],
            generated: ['PRJ-1/P-1.json'],
            other: [],
          },
        },
        {
          proposalId: 'P-new',
          generatedAt: '2026-06-24T02:00:00.000Z',
          historyPath: 'artifacts/release-local/new.json',
          gateResults: [
            { label: 'check', status: 'pass', exitCode: 0, durationMs: 10, checklist: [] },
            {
              label: 'build',
              status: 'fail',
              exitCode: 1,
              durationMs: 30,
              checklist: ['Fix bundler error.', 'Rerun npm run build.'],
            },
          ],
          dirty: {
            readmeDemoJson: [],
            ordinaryDirty: ['packages/rdma-web/src/new.ts', 'docs/proposals/P-new-prd.md'],
          },
          ownership: {
            proposalId: 'P-new',
            sourceFiles: ['packages/rdma-web/src/new.ts'],
            testFiles: [],
            docs: ['docs/proposals/P-new-prd.md'],
            generated: [],
            other: ['package-lock.json'],
          },
        },
      ],
    );

    assert.deepEqual(
      center.failedGateQueue.map((gate) => `${gate.proposalId}:${gate.gateLabel}`),
      ['P-new:build', 'P-old:coverage'],
    );
    assert.deepEqual(center.commitManifests.get('P-new')?.counts, {
      sourceFiles: 1,
      testFiles: 0,
      docs: 1,
      generated: 0,
      other: 1,
    });
    assert.deepEqual(center.commitManifests.get('P-old')?.recommendedStagePaths, [
      'packages/rdma-web/src/old.ts',
      'packages/rdma-web/test/old.test.ts',
      'README.md',
      'PRJ-1/P-1.json',
    ]);
  });

  it('renders copy-ready remediation markdown for failed release gates', () => {
    const markdown = renderReleaseRemediationMarkdown([
      {
        proposalId: 'P-new',
        title: 'New release',
        gateLabel: 'build',
        generatedAt: '2026-06-24T02:00:00.000Z',
        historyPath: 'artifacts/release-local/new.json',
        checklist: ['Fix bundler error.', 'Rerun npm run build.'],
      },
    ]);

    assert.match(markdown, /^# Release Remediation Queue/);
    assert.match(markdown, /## P-new — New release/);
    assert.match(markdown, /Gate: build/);
    assert.match(markdown, /- Fix bundler error\./);
  });

  it('builds a release artifact browser grouped by proposal', () => {
    const browser = buildReleaseArtifactBrowser([
      {
        proposalId: 'P-new',
        generatedAt: '2026-06-24T02:00:00.000Z',
        historyPath: 'artifacts/release-local/new.json',
        gateResults: [
          { label: 'check', status: 'pass', exitCode: 0, durationMs: 1, checklist: [] },
        ],
        dirty: { readmeDemoJson: [], ordinaryDirty: [] },
      },
      {
        proposalId: 'P-old',
        generatedAt: '2026-06-24T01:00:00.000Z',
        historyPath: 'artifacts/release-local/old.json',
        gateResults: [
          { label: 'build', status: 'fail', exitCode: 1, durationMs: 2, checklist: [] },
        ],
        dirty: { readmeDemoJson: ['PRJ/P.json'], ordinaryDirty: ['README.md'] },
      },
    ]);

    assert.deepEqual(
      browser.items.map((item) => `${item.proposalId}:${item.artifacts.releaseJson}`),
      ['P-new:artifacts/release-local/new.json', 'P-old:artifacts/release-local/old.json'],
    );
    assert.equal(browser.items[0]?.gateSummary, '1 passed / 0 failed');
    assert.equal(browser.items[1]?.dirtySummary, '1 ordinary / 1 generated');
  });

  it('plans only safe status apply actions and keeps dry-run commands explicit', () => {
    const plan = buildSafeStatusApplyPlan([
      {
        proposalId: 'P-a',
        currentStatus: 'in_test_acceptance',
        suggestedStatus: 'accepted',
        reason: 'ok',
      },
      {
        proposalId: 'P-b',
        currentStatus: 'accepted',
        suggestedStatus: 'delivered',
        reason: 'bad skip',
      },
    ]);

    assert.deepEqual(
      plan.safe.map((item) => item.proposalId),
      ['P-a'],
    );
    assert.deepEqual(
      plan.blocked.map((item) => item.proposalId),
      ['P-b'],
    );
    assert.equal(
      plan.safe[0]?.dryRunCommand,
      'rdma release-ops apply-status --proposal P-a --to accepted --dry-run',
    );
    assert.match(plan.blocked[0]?.reason ?? '', /not a safe next status/);
  });

  it('separates ordinary work from README verifier side effects for commit safety', () => {
    const guard = buildDirtyFileOwnershipGuard([
      {
        proposalId: 'P-new',
        counts: { sourceFiles: 1, testFiles: 1, docs: 1, generated: 1, other: 1 },
        recommendedStagePaths: [
          'packages/rdma-web/src/new.ts',
          'packages/rdma-web/test/new.test.ts',
          'README.md',
          'PRJ/P.json',
          'package-lock.json',
        ],
      },
    ]);

    assert.deepEqual(guard.safeStageCommands, [
      'git add -- packages/rdma-web/src/new.ts packages/rdma-web/test/new.test.ts README.md',
    ]);
    assert.deepEqual(guard.generatedReviewFiles, ['PRJ/P.json']);
    assert.deepEqual(guard.manualReviewFiles, ['package-lock.json']);
  });

  it('builds a proposal delivery report with acceptance evidence and next directions', () => {
    const report = buildProposalDeliveryReport({
      proposalId: 'P-20260624-017',
      title: 'Release ops automation',
      gates: [
        { label: 'check', status: 'pass', detail: 'biome check' },
        { label: 'test', status: 'pass', detail: '439/439' },
      ],
      changedFiles: ['packages/rdma-cli/src/release-ops.ts', 'packages/rdma-web/src/App.tsx'],
      nextDirections: ['Remote CI badge', 'MCP status apply'],
    });

    assert.match(report, /^# Delivery Report — P-20260624-017/);
    assert.match(report, /- check: PASS — biome check/);
    assert.match(report, /packages\/rdma-web\/src\/App.tsx/);
    assert.match(report, /1\. Remote CI badge/);
  });
});
