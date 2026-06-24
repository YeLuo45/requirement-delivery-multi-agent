import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildCiSummaryMarkdown,
  buildCommitPreparationManifest,
  buildGateResult,
  buildReleaseDiff,
  buildReleaseLocalJson,
  buildReleaseLocalPlan,
  buildReleaseRunPayload,
  parseReleaseLocalArgs,
  readReleaseHistory,
  summarizeDirtyFiles,
  writeCiArtifacts,
  writeReleaseHistory,
} from '../release-local.mjs';

describe('release-local helper', () => {
  it('runs the five local release gates in order', () => {
    assert.deepEqual(
      buildReleaseLocalPlan().map((step) => step.command),
      ['npm run check', 'npm test', 'npm run coverage', 'npm run verify:readme', 'npm run build'],
    );
  });

  it('separates README demo JSON side effects from ordinary dirty files', () => {
    const summary = summarizeDirtyFiles([
      ' M README.md',
      '?? PRJ-20260623-001/P-20260623-001.json',
      '?? packages/rdma-mcp-server/PRJ-20260623-001/P-20260623-001.json',
    ]);

    assert.deepEqual(summary.readmeDemoJson, [
      'PRJ-20260623-001/P-20260623-001.json',
      'packages/rdma-mcp-server/PRJ-20260623-001/P-20260623-001.json',
    ]);
    assert.deepEqual(summary.ordinaryDirty, ['README.md']);
  });

  it('builds machine-readable JSON with ownership and history path', () => {
    const payload = buildReleaseLocalJson({
      proposalId: 'P-20260623-015',
      title: 'V15-V21 batch',
      dirtyLines: [
        ' M packages/rdma-web/src/App.tsx',
        '?? packages/rdma-web/test/app-routes.test.ts',
        '?? docs/proposals/P-20260623-015-prd.md',
        '?? PRJ-20260623-001/P-20260623-001.json',
      ],
      now: '2026-06-23T12:00:00.000Z',
    });

    assert.equal(payload.proposalId, 'P-20260623-015');
    assert.equal(payload.historyPath, 'artifacts/release-local/2026-06-23T12-00-00-000Z.json');
    assert.deepEqual(
      payload.gates.map((gate) => gate.label),
      ['check', 'test', 'coverage', 'readme', 'build'],
    );
    assert.deepEqual(payload.dirty.readmeDemoJson, ['PRJ-20260623-001/P-20260623-001.json']);
    assert.deepEqual(payload.ownership.sourceFiles, ['packages/rdma-web/src/App.tsx']);
    assert.deepEqual(payload.ownership.testFiles, ['packages/rdma-web/test/app-routes.test.ts']);
    assert.deepEqual(payload.ownership.docs, ['docs/proposals/P-20260623-015-prd.md']);
    assert.deepEqual(payload.ownership.generated, ['PRJ-20260623-001/P-20260623-001.json']);
  });

  it('parses JSON metadata and write-history flags', () => {
    assert.deepEqual(
      parseReleaseLocalArgs([
        '--json',
        '--proposal',
        'P-20260623-019',
        '--title',
        'V22-V24 ledger',
        '--write-history',
      ]),
      {
        json: true,
        writeHistory: true,
        proposalId: 'P-20260623-019',
        title: 'V22-V24 ledger',
      },
    );
  });

  it('writes release history to the advertised path under a chosen root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-release-history-'));
    const payload = buildReleaseLocalJson({
      proposalId: 'P-20260623-019',
      title: 'V22-V24 ledger',
      now: '2026-06-23T15:30:00.000Z',
      historyRoot: root,
    });

    const written = writeReleaseHistory(payload, root);
    assert.equal(written, path.join(root, '2026-06-23T15-30-00-000Z.json'));
    assert.deepEqual(JSON.parse(readFileSync(written, 'utf8')), payload);
  });

  it('reads release history records newest first', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-release-history-read-'));
    writeReleaseHistory(
      buildReleaseLocalJson({
        proposalId: 'P-old',
        now: '2026-06-23T10:00:00.000Z',
        historyRoot: root,
      }),
      root,
    );
    writeReleaseHistory(
      buildReleaseLocalJson({
        proposalId: 'P-new',
        now: '2026-06-23T12:00:00.000Z',
        historyRoot: root,
      }),
      root,
    );

    assert.deepEqual(
      readReleaseHistory(root).map((entry) => entry.proposalId),
      ['P-new', 'P-old'],
    );
  });

  it('builds gate results with deterministic failed-gate checklist', () => {
    assert.deepEqual(buildGateResult('coverage', 1, 1250, 'coverage 92%'), {
      label: 'coverage',
      status: 'fail',
      exitCode: 1,
      durationMs: 1250,
      checklist: [
        'Run npm run coverage and inspect the threshold output.',
        'Add focused tests for uncovered new code paths.',
        'Rerun npm run coverage before release:local.',
      ],
    });
  });

  it('compares release history payloads by proposal metadata, gates, dirty files, and ownership', () => {
    const before = buildReleaseLocalJson({
      proposalId: 'P-before',
      title: 'Before',
      dirtyLines: [' M README.md'],
      now: '2026-06-23T10:00:00.000Z',
    });
    const after = buildReleaseLocalJson({
      proposalId: 'P-after',
      title: 'After',
      dirtyLines: [' M README.md', '?? packages/rdma-web/src/pages/DeliveryReport.tsx'],
      now: '2026-06-23T11:00:00.000Z',
    });

    assert.deepEqual(buildReleaseDiff(before, after), {
      proposalChanged: true,
      titleChanged: true,
      addedDirtyFiles: ['packages/rdma-web/src/pages/DeliveryReport.tsx'],
      removedDirtyFiles: [],
      changedGateLabels: [],
      ownershipDelta: {
        sourceFiles: ['packages/rdma-web/src/pages/DeliveryReport.tsx'],
        testFiles: [],
        docs: [],
        generated: [],
        other: [],
      },
    });
  });

  it('builds a commit preparation manifest from ownership groups', () => {
    const payload = buildReleaseLocalJson({
      proposalId: 'P-20260623-022',
      dirtyLines: [
        ' M packages/rdma-web/src/App.tsx',
        '?? packages/rdma-web/test/app-routes.test.ts',
        ' M README.md',
      ],
    });

    assert.deepEqual(buildCommitPreparationManifest(payload), {
      proposalId: 'P-20260623-022',
      recommendedStage: [
        'packages/rdma-web/src/App.tsx',
        'packages/rdma-web/test/app-routes.test.ts',
        'README.md',
      ],
      groups: payload.ownership,
    });
  });

  it('builds CI summary markdown from release payload and gate results', () => {
    const payload = buildReleaseLocalJson({ proposalId: 'P-20260623-022', title: 'CI mode' });
    const markdown = buildCiSummaryMarkdown(payload, [
      buildGateResult('check', 0, 100, ''),
      buildGateResult('test', 1, 200, 'fail'),
    ]);

    assert.match(markdown, /# RDMA Release Evidence/);
    assert.match(markdown, /P-20260623-022/);
    assert.match(markdown, /check: pass/);
    assert.match(markdown, /test: fail/);
  });

  it('builds release run payload with measured gate results and stops at first failure', () => {
    const payload = buildReleaseRunPayload({
      proposalId: 'P-20260623-031',
      title: 'V31 real gates',
      dirtyLines: [' M README.md'],
      now: '2026-06-23T16:00:00.000Z',
      results: [
        { label: 'check', exitCode: 0, durationMs: 10, stderrSummary: '' },
        { label: 'test', exitCode: 1, durationMs: 20, stderrSummary: 'fail' },
      ],
    });

    assert.deepEqual(
      payload.gateResults.map((gate) => [gate.label, gate.status, gate.exitCode]),
      [
        ['check', 'pass', 0],
        ['test', 'fail', 1],
      ],
    );
    assert.equal(payload.completed, false);
    assert.equal(payload.failedGate?.label, 'test');
  });

  it('writes fixed CI artifact names for release JSON, summary, manifest, and diff', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-ci-artifacts-'));
    const payload = buildReleaseRunPayload({
      proposalId: 'P-20260624-005',
      title: 'V37-V39 real history',
      now: '2026-06-24T01:00:00.000Z',
      historyRoot: root,
      dirtyLines: [' M packages/rdma-web/src/vite-plugin.ts'],
      results: [{ label: 'check', exitCode: 0, durationMs: 10, stderrSummary: '' }],
    });

    const artifacts = writeCiArtifacts(payload, root);

    assert.equal(artifacts.releaseJson, path.join(root, 'release.json'));
    assert.equal(artifacts.summaryMarkdown, path.join(root, 'summary.md'));
    assert.equal(artifacts.commitManifestJson, path.join(root, 'commit-manifest.json'));
    assert.equal(artifacts.diffJson, path.join(root, 'diff.json'));
    assert.equal(existsSync(artifacts.releaseJson), true);
    assert.equal(
      JSON.parse(readFileSync(artifacts.commitManifestJson, 'utf8')).proposalId,
      'P-20260624-005',
    );
    assert.match(readFileSync(artifacts.summaryMarkdown, 'utf8'), /V37-V39 real history/);
  });
});
