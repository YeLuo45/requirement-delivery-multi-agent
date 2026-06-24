import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDeliveryReportMarkdown,
  buildGateFixChecklist,
  buildProposalFileAssociations,
  classifyReadmeSideEffect,
  planSafeStatusActions,
} from '../src/delivery-report.js';

describe('delivery automation report helpers', () => {
  it('renders a delivery report with evidence and changed-file groups', () => {
    const report = buildDeliveryReportMarkdown({
      proposalId: 'P-20260623-012',
      title: 'V8-V14 batch',
      status: 'accepted',
      evidence: {
        summary: {
          totalProposals: 1,
          evidenceProposals: 1,
          totalGates: 5,
          passedGates: 5,
          failedGates: 0,
          passRate: 100,
          latestEvidenceAt: '2026-06-23T00:00:00.000Z',
        },
        rows: [
          {
            proposalId: 'P-20260623-012',
            title: 'V8-V14 batch',
            status: 'accepted',
            updatedAt: '2026-06-23T00:00:00.000Z',
            passedGates: 5,
            totalGates: 5,
            state: 'green',
            summary: '5/5 gates passed',
            gates: [],
          },
        ],
      },
      changedFiles: ['packages/rdma-web/src/acceptance-evidence.ts', 'README.md'],
    });

    assert.match(report, /# Delivery Report — P-20260623-012/);
    assert.match(report, /Gate pass rate: 100%/);
    assert.match(report, /Source files/);
    assert.match(report, /Documentation/);
    assert.match(report, /Safe next actions/);
    assert.match(report, /deployed/);
  });

  it('groups changed files by source, tests, docs, and generated side effects', () => {
    const associations = buildProposalFileAssociations('P-20260623-012', [
      'packages/rdma-web/src/acceptance-evidence.ts',
      'packages/rdma-web/test/acceptance-evidence.test.ts',
      'docs/proposals/P-20260623-012-prd.md',
      'PRJ-20260623-001/P-20260623-001.json',
    ]);

    assert.equal(associations.proposalId, 'P-20260623-012');
    assert.deepEqual(associations.sourceFiles, ['packages/rdma-web/src/acceptance-evidence.ts']);
    assert.deepEqual(associations.testFiles, [
      'packages/rdma-web/test/acceptance-evidence.test.ts',
    ]);
    assert.deepEqual(associations.docs, ['docs/proposals/P-20260623-012-prd.md']);
    assert.deepEqual(associations.generated, ['PRJ-20260623-001/P-20260623-001.json']);
  });

  it('classifies README verification generated demo JSON side effects', () => {
    assert.equal(
      classifyReadmeSideEffect('PRJ-20260623-001/P-20260623-001.json'),
      'readme-demo-json',
    );
    assert.equal(
      classifyReadmeSideEffect('packages/rdma-mcp-server/PRJ-20260623-001/P-20260623-001.json'),
      'readme-demo-json',
    );
    assert.equal(classifyReadmeSideEffect('packages/rdma-web/src/App.tsx'), 'ordinary-change');
  });

  it('plans only safe forward status actions', () => {
    assert.deepEqual(planSafeStatusActions('in_dev'), ['in_test_acceptance']);
    assert.deepEqual(planSafeStatusActions('accepted'), ['deployed']);
    assert.deepEqual(planSafeStatusActions('delivered'), []);
  });

  it('builds deterministic fix checklists for failed gates', () => {
    assert.deepEqual(buildGateFixChecklist('check', 'biome found 2 errors'), [
      'Run npm run check locally and inspect the first reported file.',
      'Fix formatting, lint, and TypeScript diagnostics before rerunning release:local.',
      'If README verification touched generated files, run format after verify:readme.',
    ]);
    assert.deepEqual(buildGateFixChecklist('coverage', 'statements 92.1 below threshold'), [
      'Run npm run coverage and identify the uncovered file in the threshold output.',
      'Add focused tests for new branches instead of lowering thresholds.',
      'Remove unreachable defensive fallbacks when the contract guarantees a value.',
    ]);
    assert.deepEqual(buildGateFixChecklist('unknown', 'exit 1'), [
      'Rerun the failed gate directly with full output.',
      'Fix the first deterministic error before rerunning the full release gate.',
    ]);
  });
});
