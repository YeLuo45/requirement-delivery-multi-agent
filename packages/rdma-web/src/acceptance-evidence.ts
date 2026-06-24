export interface AcceptanceEvidenceInput {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly notes?: string;
}

export interface AcceptanceEvidenceSummary {
  readonly totalProposals: number;
  readonly evidenceProposals: number;
  readonly totalGates: number;
  readonly passedGates: number;
  readonly failedGates: number;
  readonly passRate: number;
  readonly latestEvidenceAt: string | null;
}

export interface AcceptanceEvidenceGate {
  readonly id: 'check' | 'test' | 'coverage' | 'readme' | 'build';
  readonly label: string;
  readonly state: 'pass' | 'fail';
  readonly hint: string;
}

export interface AcceptanceEvidenceRow {
  readonly proposalId: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly passedGates: number;
  readonly totalGates: number;
  readonly state: 'green' | 'red' | 'empty';
  readonly summary: string;
  readonly gates: ReadonlyArray<AcceptanceEvidenceGate>;
}

export interface AcceptanceEvidenceDashboard {
  readonly summary: AcceptanceEvidenceSummary;
  readonly rows: ReadonlyArray<AcceptanceEvidenceRow>;
}

const ACCEPTANCE_STATUSES = new Set([
  'in_test_acceptance',
  'test_failed',
  'accepted',
  'deployed',
  'delivered',
]);

const GATE_PATTERNS: ReadonlyArray<{
  readonly id: AcceptanceEvidenceGate['id'];
  readonly label: string;
  readonly pass: RegExp;
  readonly fail: RegExp;
  readonly failHint: string;
}> = [
  {
    id: 'check',
    label: 'Check',
    pass: /check\s+PASS/i,
    fail: /check\s+(FAILED|FAIL)/i,
    failHint: 'Run npm run check and fix the reported formatter or lint issue.',
  },
  {
    id: 'test',
    label: 'Tests',
    pass: /(npm test|tests?)\s+(ALL TESTS PASSED|PASS)/i,
    fail: /(npm test|tests?)\s+(FAILED|FAIL)/i,
    failHint: 'Re-run npm test and inspect the first failing workspace.',
  },
  {
    id: 'coverage',
    label: 'Coverage',
    pass: /coverage\s+[^.;]*(100(?:\.00)?%|9[5-9](?:\.\d+)?%|>=\s*95)/i,
    fail: /coverage\s+[^.;]*(?:\b[0-8]\d(?:\.\d+)?%|\b9[0-4](?:\.\d+)?%)/i,
    failHint: 'Add tests for uncovered new code until coverage is >=95%.',
  },
  {
    id: 'readme',
    label: 'README verification',
    pass: /verify:readme\s+[^.;]*(PASS|Failed\s+0)/i,
    fail: /verify:readme\s+[^.;]*Failed\s+[1-9]/i,
    failHint: 'Run npm run verify:readme and fix the documented command that failed.',
  },
  {
    id: 'build',
    label: 'Build',
    pass: /build\s+PASS/i,
    fail: /build\s+(FAILED|FAIL)/i,
    failHint: 'Run npm run build and fix the production build error.',
  },
];

export function summarizeAcceptanceEvidence(
  proposals: ReadonlyArray<AcceptanceEvidenceInput>,
): AcceptanceEvidenceSummary {
  const rows = buildAcceptanceEvidenceRows(proposals);
  const totalGates = rows.reduce((sum, row) => sum + row.totalGates, 0);
  const passedGates = rows.reduce((sum, row) => sum + row.passedGates, 0);
  const failedGates = totalGates - passedGates;
  return {
    totalProposals: proposals.length,
    evidenceProposals: rows.length,
    totalGates,
    passedGates,
    failedGates,
    passRate: totalGates === 0 ? 0 : Math.round((passedGates / totalGates) * 100),
    latestEvidenceAt: rows[0]?.updatedAt ?? null,
  };
}

export function buildAcceptanceEvidenceDashboard(
  proposals: ReadonlyArray<AcceptanceEvidenceInput>,
): AcceptanceEvidenceDashboard {
  const rows = buildAcceptanceEvidenceRows(proposals);
  return {
    summary: summarizeAcceptanceEvidence(proposals),
    rows,
  };
}

function buildAcceptanceEvidenceRows(
  proposals: ReadonlyArray<AcceptanceEvidenceInput>,
): AcceptanceEvidenceRow[] {
  return proposals
    .filter((proposal) => ACCEPTANCE_STATUSES.has(proposal.status))
    .map((proposal) => {
      const gates = extractGateEvidence(proposal.notes ?? '');
      const passedGates = gates.filter((gate) => gate.state === 'pass').length;
      const totalGates = gates.length;
      return {
        proposalId: proposal.id,
        title: proposal.title,
        status: proposal.status,
        updatedAt: proposal.updatedAt,
        passedGates,
        totalGates,
        state: totalGates === 0 ? 'empty' : passedGates === totalGates ? 'green' : 'red',
        summary:
          totalGates === 0 ? 'No gate evidence yet' : `${passedGates}/${totalGates} gates passed`,
        gates,
      };
    })
    .filter((row) => row.totalGates > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function extractGateEvidence(notes: string): AcceptanceEvidenceGate[] {
  return GATE_PATTERNS.flatMap((gate) => {
    if (gate.fail.test(notes)) {
      return [{ id: gate.id, label: gate.label, state: 'fail' as const, hint: gate.failHint }];
    }
    if (gate.pass.test(notes)) {
      return [{ id: gate.id, label: gate.label, state: 'pass' as const, hint: 'Gate passed.' }];
    }
    return [];
  });
}
