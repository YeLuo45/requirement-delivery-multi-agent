import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAcceptanceEvidenceDashboard,
  summarizeAcceptanceEvidence,
} from '../src/acceptance-evidence.js';

describe('acceptance evidence dashboard', () => {
  it('summarizes hard gates from accepted delivery notes', () => {
    const summary = summarizeAcceptanceEvidence([
      {
        id: 'P-1',
        title: 'Accepted iteration',
        status: 'accepted',
        updatedAt: '2026-06-23T01:00:00.000Z',
        notes:
          'Gates: check PASS; npm test ALL TESTS PASSED; coverage 7351/7351 100.00% >=95; verify:readme Total 33 OK 12 Skipped 21 Failed 0; build PASS.',
      },
      {
        id: 'P-2',
        title: 'In dev iteration',
        status: 'in_dev',
        updatedAt: '2026-06-23T02:00:00.000Z',
        notes: 'Implementation in progress.',
      },
    ]);

    assert.equal(summary.totalProposals, 2);
    assert.equal(summary.evidenceProposals, 1);
    assert.equal(summary.totalGates, 5);
    assert.equal(summary.passedGates, 5);
    assert.equal(summary.failedGates, 0);
    assert.equal(summary.passRate, 100);
    assert.equal(summary.latestEvidenceAt, '2026-06-23T01:00:00.000Z');
  });

  it('builds recent evidence rows sorted by latest evidence timestamp', () => {
    const dashboard = buildAcceptanceEvidenceDashboard([
      {
        id: 'P-old',
        title: 'Old accepted',
        status: 'delivered',
        updatedAt: '2026-06-22T00:00:00.000Z',
        notes: 'Gates: check PASS; npm test PASS; coverage 99%; verify:readme PASS; build PASS.',
      },
      {
        id: 'P-new',
        title: 'New accepted',
        status: 'accepted',
        updatedAt: '2026-06-23T00:00:00.000Z',
        notes: 'Gates: check PASS; npm test PASS; coverage 100%; verify:readme PASS; build PASS.',
      },
    ]);

    assert.deepEqual(
      dashboard.rows.map((row) => row.proposalId),
      ['P-new', 'P-old'],
    );
    assert.equal(dashboard.rows[0]?.state, 'green');
    assert.equal(dashboard.rows[0]?.summary, '5/5 gates passed');
  });

  it('marks failed gates when delivery notes contain failures', () => {
    const dashboard = buildAcceptanceEvidenceDashboard([
      {
        id: 'P-fail',
        title: 'Failed acceptance',
        status: 'test_failed',
        updatedAt: '2026-06-23T03:00:00.000Z',
        notes:
          'Gates: check PASS; npm test FAILED; coverage 88%; verify:readme Failed 1; build PASS.',
      },
    ]);

    assert.equal(dashboard.summary.totalGates, 5);
    assert.equal(dashboard.summary.passedGates, 2);
    assert.equal(dashboard.summary.failedGates, 3);
    assert.equal(dashboard.summary.passRate, 40);
    assert.equal(dashboard.rows[0]?.state, 'red');
    assert.equal(dashboard.rows[0]?.summary, '2/5 gates passed');
    assert.deepEqual(
      dashboard.rows[0]?.gates
        .filter((gate) => gate.state === 'fail')
        .map((gate) => `${gate.id}:${gate.hint}`),
      [
        'test:Re-run npm test and inspect the first failing workspace.',
        'coverage:Add tests for uncovered new code until coverage is >=95%.',
        'readme:Run npm run verify:readme and fix the documented command that failed.',
      ],
    );
  });
});
