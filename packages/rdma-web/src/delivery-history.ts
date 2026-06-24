export interface DeliveryHistoryProposal {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

export interface DeliveryGateResult {
  readonly label: string;
  readonly status: 'pass' | 'fail' | string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly checklist: ReadonlyArray<string>;
}

export interface DeliveryOwnership {
  readonly proposalId: string;
  readonly sourceFiles: ReadonlyArray<string>;
  readonly testFiles: ReadonlyArray<string>;
  readonly docs: ReadonlyArray<string>;
  readonly generated: ReadonlyArray<string>;
  readonly other: ReadonlyArray<string>;
}

export interface DeliveryHistoryRecord {
  readonly proposalId: string;
  readonly title?: string;
  readonly generatedAt: string;
  readonly historyPath: string;
  readonly gates?: ReadonlyArray<unknown>;
  readonly gateResults?: ReadonlyArray<DeliveryGateResult>;
  readonly dirty: {
    readonly readmeDemoJson: ReadonlyArray<string>;
    readonly ordinaryDirty: ReadonlyArray<string>;
  };
  readonly ownership?: DeliveryOwnership;
}

export interface FailedReleaseGate {
  readonly proposalId: string;
  readonly title: string;
  readonly gateLabel: string;
  readonly generatedAt: string;
  readonly historyPath: string;
  readonly checklist: ReadonlyArray<string>;
}

export interface CommitManifestSummary {
  readonly proposalId: string;
  readonly counts: {
    readonly sourceFiles: number;
    readonly testFiles: number;
    readonly docs: number;
    readonly generated: number;
    readonly other: number;
  };
  readonly recommendedStagePaths: ReadonlyArray<string>;
}

export interface ReleaseOperationsCenter {
  readonly failedGateQueue: ReadonlyArray<FailedReleaseGate>;
  readonly commitManifests: ReadonlyMap<string, CommitManifestSummary>;
  readonly remediationMarkdown: string;
}

const SAFE_NEXT: Record<string, ReadonlyArray<string>> = {
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

export function buildDeliveryReportHistoryModel(
  proposal: DeliveryHistoryProposal,
  histories: ReadonlyArray<DeliveryHistoryRecord>,
) {
  const matching = histories
    .filter((history) => history.proposalId === proposal.id)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  const latestHistory = matching[0] ?? null;
  const gateResults = latestHistory?.gateResults ?? [];
  const passed = gateResults.filter((gate) => gate.status === 'pass').length;
  const failed = gateResults.filter((gate) => gate.status === 'fail').length;
  return {
    proposalId: proposal.id,
    title: proposal.title,
    status: proposal.status,
    latestHistory,
    dirtyFileCount: latestHistory
      ? latestHistory.dirty.ordinaryDirty.length + latestHistory.dirty.readmeDemoJson.length
      : 0,
    gateSummary: { total: gateResults.length, passed, failed },
    failedGateHints: gateResults.flatMap((gate) => (gate.status === 'fail' ? gate.checklist : [])),
    safeNextActions: SAFE_NEXT[proposal.status] ?? [],
  };
}

export function buildReleaseHistoryRows(
  proposals: ReadonlyArray<DeliveryHistoryProposal>,
  histories: ReadonlyArray<DeliveryHistoryRecord>,
) {
  return proposals
    .map((proposal) => buildDeliveryReportHistoryModel(proposal, histories))
    .filter((row) => row.latestHistory !== null);
}

export function buildReleaseOperationsCenter(
  proposals: ReadonlyArray<DeliveryHistoryProposal>,
  histories: ReadonlyArray<DeliveryHistoryRecord>,
): ReleaseOperationsCenter {
  const proposalTitles = new Map(proposals.map((proposal) => [proposal.id, proposal.title]));
  const failedGateQueue = histories
    .flatMap((history) =>
      (history.gateResults ?? [])
        .filter((gate) => gate.status === 'fail')
        .map((gate) => ({
          proposalId: history.proposalId,
          title: proposalTitles.get(history.proposalId) ?? history.title ?? history.proposalId,
          gateLabel: gate.label,
          generatedAt: history.generatedAt,
          historyPath: history.historyPath,
          checklist: gate.checklist,
        })),
    )
    .sort((left, right) => {
      const time = right.generatedAt.localeCompare(left.generatedAt);
      if (time !== 0) return time;
      return left.proposalId.localeCompare(right.proposalId);
    });
  const latestByProposal = latestHistoriesByProposal(histories);
  const commitManifests = new Map<string, CommitManifestSummary>();
  for (const [proposalId, history] of latestByProposal) {
    commitManifests.set(proposalId, buildCommitManifestSummary(proposalId, history));
  }
  return {
    failedGateQueue,
    commitManifests,
    remediationMarkdown: renderReleaseRemediationMarkdown(failedGateQueue),
  };
}

export function renderReleaseRemediationMarkdown(
  failedGates: ReadonlyArray<FailedReleaseGate>,
): string {
  if (failedGates.length === 0) {
    return '# Release Remediation Queue\n\nNo failed release gates.\n';
  }
  return `${[
    '# Release Remediation Queue',
    '',
    ...failedGates.flatMap((gate) => [
      `## ${gate.proposalId} — ${gate.title}`,
      '',
      `Gate: ${gate.gateLabel}`,
      `Generated: ${gate.generatedAt}`,
      `History: ${gate.historyPath}`,
      '',
      'Checklist:',
      ...gate.checklist.map((item) => `- ${item}`),
      '',
    ]),
  ].join('\n')}\n`;
}

function latestHistoriesByProposal(
  histories: ReadonlyArray<DeliveryHistoryRecord>,
): ReadonlyMap<string, DeliveryHistoryRecord> {
  const latest = new Map<string, DeliveryHistoryRecord>();
  for (const history of histories) {
    const current = latest.get(history.proposalId);
    if (!current || history.generatedAt.localeCompare(current.generatedAt) > 0) {
      latest.set(history.proposalId, history);
    }
  }
  return latest;
}

function buildCommitManifestSummary(
  proposalId: string,
  history: DeliveryHistoryRecord,
): CommitManifestSummary {
  const ownership = history.ownership ?? inferOwnership(proposalId, history);
  return {
    proposalId,
    counts: {
      sourceFiles: ownership.sourceFiles.length,
      testFiles: ownership.testFiles.length,
      docs: ownership.docs.length,
      generated: ownership.generated.length,
      other: ownership.other.length,
    },
    recommendedStagePaths: [
      ...ownership.sourceFiles,
      ...ownership.testFiles,
      ...ownership.docs,
      ...ownership.generated,
      ...ownership.other,
    ],
  };
}

function inferOwnership(proposalId: string, history: DeliveryHistoryRecord): DeliveryOwnership {
  const sourceFiles: string[] = [];
  const testFiles: string[] = [];
  const docs: string[] = [];
  const generated = [...history.dirty.readmeDemoJson];
  const other: string[] = [];
  for (const file of history.dirty.ordinaryDirty) {
    if (file.includes('/test/') || file.endsWith('.test.ts') || file.endsWith('.test.mjs')) {
      testFiles.push(file);
    } else if (file.startsWith('docs/') || file.startsWith('README')) {
      docs.push(file);
    } else if (file.includes('/src/') || file.startsWith('scripts/')) {
      sourceFiles.push(file);
    } else {
      other.push(file);
    }
  }
  return { proposalId, sourceFiles, testFiles, docs, generated, other };
}
