import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDeliveryReportHistoryModel,
  buildReleaseHistoryRows,
  buildReleaseOperationsCenter,
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
});
