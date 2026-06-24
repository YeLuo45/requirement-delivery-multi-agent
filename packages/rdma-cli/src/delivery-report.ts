import type { AcceptanceEvidenceDashboard } from '../../rdma-web/src/acceptance-evidence.js';

export interface ProposalFileAssociations {
  readonly proposalId: string;
  readonly sourceFiles: ReadonlyArray<string>;
  readonly testFiles: ReadonlyArray<string>;
  readonly docs: ReadonlyArray<string>;
  readonly generated: ReadonlyArray<string>;
  readonly other: ReadonlyArray<string>;
}

export interface DeliveryReportInput {
  readonly proposalId: string;
  readonly title: string;
  readonly status: string;
  readonly evidence: AcceptanceEvidenceDashboard;
  readonly changedFiles: ReadonlyArray<string>;
}

const STATUS_NEXT: Record<string, ReadonlyArray<string>> = {
  intake: ['clarifying'],
  clarifying: ['prd_pending_confirmation'],
  prd_pending_confirmation: ['approved_for_dev'],
  approved_for_dev: ['in_dev'],
  in_dev: ['in_test_acceptance'],
  test_failed: ['in_test_acceptance'],
  in_test_acceptance: ['accepted', 'test_failed'],
  accepted: ['deployed'],
  deployed: ['delivered'],
  delivered: [],
};

export function buildDeliveryReportMarkdown(input: DeliveryReportInput): string {
  const associations = buildProposalFileAssociations(input.proposalId, input.changedFiles);
  const lines = [
    `# Delivery Report — ${input.proposalId}: ${input.title}`,
    '',
    `Status: ${input.status}`,
    `Gate pass rate: ${input.evidence.summary.passRate}%`,
    `Gates: ${input.evidence.summary.passedGates}/${input.evidence.summary.totalGates} passed`,
    '',
    '## Acceptance Evidence',
    ...input.evidence.rows.map((row) => `- ${row.proposalId}: ${row.summary} (${row.status})`),
    '',
    '## Changed Files',
    renderFileGroup('Source files', associations.sourceFiles),
    renderFileGroup('Test files', associations.testFiles),
    renderFileGroup('Documentation', associations.docs),
    renderFileGroup('Generated side effects', associations.generated),
    renderFileGroup('Other', associations.other),
    '',
    '## Safe next actions',
    ...planSafeStatusActions(input.status).map((status) => `- ${status}`),
  ];
  return `${lines.filter((line) => line !== null).join('\n')}\n`;
}

export function buildProposalFileAssociations(
  proposalId: string,
  files: ReadonlyArray<string>,
): ProposalFileAssociations {
  const sourceFiles: string[] = [];
  const testFiles: string[] = [];
  const docs: string[] = [];
  const generated: string[] = [];
  const other: string[] = [];
  for (const file of files) {
    if (classifyReadmeSideEffect(file) === 'readme-demo-json') generated.push(file);
    else if (file.includes('/test/') || file.endsWith('.test.ts') || file.endsWith('.test.mjs')) {
      testFiles.push(file);
    } else if (file.startsWith('docs/') || file.startsWith('README')) docs.push(file);
    else if (file.includes('/src/') || file.startsWith('scripts/')) sourceFiles.push(file);
    else other.push(file);
  }
  return { proposalId, sourceFiles, testFiles, docs, generated, other };
}

export function classifyReadmeSideEffect(file: string): 'readme-demo-json' | 'ordinary-change' {
  return /(^|\/)PRJ-\d{8}-\d{3}\/P-\d{8}-\d{3}\.json$/.test(file)
    ? 'readme-demo-json'
    : 'ordinary-change';
}

export function planSafeStatusActions(status: string): ReadonlyArray<string> {
  return STATUS_NEXT[status] ?? [];
}

export function buildGateFixChecklist(
  gateId: string,
  stderrSummary: string,
): ReadonlyArray<string> {
  void stderrSummary;
  if (gateId === 'check') {
    return [
      'Run npm run check locally and inspect the first reported file.',
      'Fix formatting, lint, and TypeScript diagnostics before rerunning release:local.',
      'If README verification touched generated files, run format after verify:readme.',
    ];
  }
  if (gateId === 'test') {
    return [
      'Rerun npm test and isolate the first failing workspace.',
      'Fix the failing behavior with a focused regression test.',
      'Rerun npm test from the repository root before release:local.',
    ];
  }
  if (gateId === 'coverage') {
    return [
      'Run npm run coverage and identify the uncovered file in the threshold output.',
      'Add focused tests for new branches instead of lowering thresholds.',
      'Remove unreachable defensive fallbacks when the contract guarantees a value.',
    ];
  }
  if (gateId === 'readme') {
    return [
      'Run npm run verify:readme and find the first failed README command.',
      'Fix the documented command or mark non-runnable template snippets as stub-only.',
      'Use an isolated RDMA_STORAGE_ROOT for demo commands to avoid dirtying repo fixtures.',
    ];
  }
  if (gateId === 'build') {
    return [
      'Run npm run build and inspect the first package that failed.',
      'Fix production-only TypeScript or bundler errors before rerunning release:local.',
      'Do not bypass the build gate with dev-only imports or dynamic fallbacks.',
    ];
  }
  return [
    'Rerun the failed gate directly with full output.',
    'Fix the first deterministic error before rerunning the full release gate.',
  ];
}

function renderFileGroup(label: string, files: ReadonlyArray<string>): string {
  if (files.length === 0) return `### ${label}\n- (none)`;
  return [`### ${label}`, ...files.map((file) => `- ${file}`)].join('\n');
}
