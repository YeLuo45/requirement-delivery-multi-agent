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

export interface ReleaseArtifactBrowserItem {
  readonly proposalId: string;
  readonly generatedAt: string;
  readonly artifacts: {
    readonly releaseJson: string;
    readonly summaryMarkdown: string;
    readonly commitManifestJson: string;
    readonly diffJson: string;
  };
  readonly gateSummary: string;
  readonly dirtySummary: string;
}

export interface SafeStatusSuggestionInput {
  readonly proposalId: string;
  readonly currentStatus: string;
  readonly suggestedStatus: string;
  readonly reason: string;
}

export interface SafeStatusApplyAction extends SafeStatusSuggestionInput {
  readonly dryRunCommand: string;
}

export interface SafeStatusApplyBlocked extends SafeStatusSuggestionInput {
  readonly reason: string;
}

export interface DirtyFileOwnershipGuard {
  readonly safeStageCommands: ReadonlyArray<string>;
  readonly generatedReviewFiles: ReadonlyArray<string>;
  readonly manualReviewFiles: ReadonlyArray<string>;
}

export interface ProposalDeliveryReportInput {
  readonly proposalId: string;
  readonly title: string;
  readonly gates: ReadonlyArray<{
    readonly label: string;
    readonly status: 'pass' | 'fail';
    readonly detail: string;
  }>;
  readonly changedFiles: ReadonlyArray<string>;
  readonly nextDirections: ReadonlyArray<string>;
}

export interface ReleaseOpsActionPanelInput {
  readonly safeStatusActions: ReadonlyArray<SafeStatusApplyAction>;
  readonly stageCommands: ReadonlyArray<string>;
  readonly artifactPaths: ReadonlyArray<string>;
}

export interface ReleaseOpsPanelAction {
  readonly label: string;
  readonly copyText: string;
}

export interface CiEvidenceNotesInput {
  readonly generatedAt: string;
  readonly failedGateCount: number;
  readonly artifactPaths: ReadonlyArray<string>;
  readonly statusSuggestions: ReadonlyArray<SafeStatusSuggestionInput>;
}

export interface ReadmeVerifierSandboxInput {
  readonly repoRoot: string;
  readonly sandboxRoot: string;
  readonly commands: ReadonlyArray<string>;
}

export interface WorkflowRunStatusInput {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly url: string;
  readonly updatedAt: string;
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

export function buildReleaseArtifactBrowser(histories: ReadonlyArray<DeliveryHistoryRecord>): {
  readonly items: ReadonlyArray<ReleaseArtifactBrowserItem>;
} {
  return {
    items: [...histories]
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
      .map((history) => {
        const gateResults = history.gateResults ?? [];
        const passed = gateResults.filter((gate) => gate.status === 'pass').length;
        const failed = gateResults.filter((gate) => gate.status === 'fail').length;
        const dir = history.historyPath.replace(/\/[^/]*$/, '');
        return {
          proposalId: history.proposalId,
          generatedAt: history.generatedAt,
          artifacts: {
            releaseJson: history.historyPath,
            summaryMarkdown: `${dir}/summary.md`,
            commitManifestJson: `${dir}/commit-manifest.json`,
            diffJson: `${dir}/diff.json`,
          },
          gateSummary: `${passed} passed / ${failed} failed`,
          dirtySummary: `${history.dirty.ordinaryDirty.length} ordinary / ${history.dirty.readmeDemoJson.length} generated`,
        };
      }),
  };
}

export function buildSafeStatusApplyPlan(suggestions: ReadonlyArray<SafeStatusSuggestionInput>): {
  readonly safe: ReadonlyArray<SafeStatusApplyAction>;
  readonly blocked: ReadonlyArray<SafeStatusApplyBlocked>;
} {
  const safe: SafeStatusApplyAction[] = [];
  const blocked: SafeStatusApplyBlocked[] = [];
  for (const suggestion of suggestions) {
    const allowed = SAFE_NEXT[suggestion.currentStatus] ?? [];
    if (allowed.includes(suggestion.suggestedStatus)) {
      safe.push({
        ...suggestion,
        dryRunCommand: `rdma release-ops apply-status --proposal ${suggestion.proposalId} --to ${suggestion.suggestedStatus} --dry-run`,
      });
    } else {
      blocked.push({
        ...suggestion,
        reason: `${suggestion.suggestedStatus} is not a safe next status from ${suggestion.currentStatus}`,
      });
    }
  }
  return { safe, blocked };
}

export function buildDirtyFileOwnershipGuard(
  manifests: ReadonlyArray<CommitManifestSummary>,
): DirtyFileOwnershipGuard {
  const safeStageCommands: string[] = [];
  const generatedReviewFiles: string[] = [];
  const manualReviewFiles: string[] = [];
  for (const manifest of manifests) {
    const safeFiles = manifest.recommendedStagePaths.filter(
      (file) =>
        file.startsWith('packages/') || file.startsWith('README') || file.startsWith('docs/'),
    );
    const generated = manifest.recommendedStagePaths.filter(
      (file) => /^PRJ-[^/]+\//.test(file) || file.startsWith('PRJ/'),
    );
    const manual = manifest.recommendedStagePaths.filter(
      (file) => !safeFiles.includes(file) && !generated.includes(file),
    );
    if (safeFiles.length > 0) safeStageCommands.push(`git add -- ${safeFiles.join(' ')}`);
    generatedReviewFiles.push(...generated);
    manualReviewFiles.push(...manual);
  }
  return { safeStageCommands, generatedReviewFiles, manualReviewFiles };
}

export function buildProposalDeliveryReport(input: ProposalDeliveryReportInput): string {
  const lines = [
    `# Delivery Report — ${input.proposalId}`,
    '',
    `Title: ${input.title}`,
    '',
    '## Gates',
  ];
  for (const gate of input.gates) {
    lines.push(`- ${gate.label}: ${gate.status.toUpperCase()} — ${gate.detail}`);
  }
  lines.push('', '## Changed Files');
  for (const file of input.changedFiles) lines.push(`- ${file}`);
  lines.push('', '## Next Directions');
  input.nextDirections.forEach((direction, index) => lines.push(`${index + 1}. ${direction}`));
  return `${lines.join('\n')}\n`;
}

export function buildReleaseOpsActionPanel(input: ReleaseOpsActionPanelInput): {
  readonly primaryActions: ReadonlyArray<ReleaseOpsPanelAction>;
  readonly artifactLinks: ReadonlyArray<{ readonly label: string; readonly href: string }>;
} {
  const statusActions = input.safeStatusActions.map((action) => ({
    label: `Apply ${action.proposalId} → ${action.suggestedStatus}`,
    copyText: action.dryRunCommand.replace(/ --dry-run$/, ' --execute'),
  }));
  const stageActions = input.stageCommands.map((command) => ({
    label: 'Stage owned files',
    copyText: command,
  }));
  return {
    primaryActions: [...statusActions, ...stageActions],
    artifactLinks: input.artifactPaths.map((artifactPath) => ({
      label: artifactPath.split('/').at(-1) ?? artifactPath,
      href: artifactPath,
    })),
  };
}

export function buildCiEvidenceNotesArtifact(input: CiEvidenceNotesInput): string {
  const lines = [
    '# CI Evidence Notes',
    '',
    `Generated: ${input.generatedAt}`,
    `Failed gates: ${input.failedGateCount}`,
    '',
    '## Safe Status Suggestions',
  ];
  if (input.statusSuggestions.length === 0) {
    lines.push('- None');
  } else {
    for (const suggestion of input.statusSuggestions) {
      lines.push(
        `- ${suggestion.proposalId}: ${suggestion.currentStatus} → ${suggestion.suggestedStatus} — ${suggestion.reason}`,
      );
    }
  }
  lines.push('', '## Artifacts');
  if (input.artifactPaths.length === 0) {
    lines.push('- None');
  } else {
    for (const artifactPath of input.artifactPaths) lines.push(`- ${artifactPath}`);
  }
  return `${lines.join('\n')}\n`;
}

export function buildReleaseArtifactDiffViewer(histories: ReadonlyArray<DeliveryHistoryRecord>): {
  readonly rows: ReadonlyArray<{
    readonly proposalId: string;
    readonly generatedAt: string;
    readonly sourceCount: number;
    readonly testCount: number;
    readonly docsCount: number;
    readonly generatedCount: number;
    readonly otherCount: number;
    readonly previewPaths: ReadonlyArray<string>;
  }>;
} {
  return {
    rows: [...histories]
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
      .map((history) => {
        const ownership = history.ownership ?? inferOwnership(history.proposalId, history);
        return {
          proposalId: history.proposalId,
          generatedAt: history.generatedAt,
          sourceCount: ownership.sourceFiles.length,
          testCount: ownership.testFiles.length,
          docsCount: ownership.docs.length,
          generatedCount: ownership.generated.length,
          otherCount: ownership.other.length,
          previewPaths: [
            ...ownership.sourceFiles,
            ...ownership.testFiles,
            ...ownership.docs,
            ...ownership.generated,
            ...ownership.other,
          ].slice(0, 8),
        };
      }),
  };
}

export function buildReadmeVerifierSandboxPlan(input: ReadmeVerifierSandboxInput): {
  readonly mutatesOriginalWorkspace: false;
  readonly setupCommands: ReadonlyArray<string>;
  readonly verificationCommands: ReadonlyArray<string>;
} {
  return {
    mutatesOriginalWorkspace: false,
    setupCommands: [
      `mkdir -p ${input.sandboxRoot}`,
      `rsync -a --delete --exclude .git ${input.repoRoot}/ ${input.sandboxRoot}/`,
    ],
    verificationCommands: input.commands.map((command) => `cd ${input.sandboxRoot} && ${command}`),
  };
}

export function buildWorkflowRunStatusDashboard(runs: ReadonlyArray<WorkflowRunStatusInput>): {
  readonly summary: {
    readonly total: number;
    readonly passing: number;
    readonly failing: number;
    readonly running: number;
  };
  readonly rows: ReadonlyArray<
    WorkflowRunStatusInput & { readonly badge: 'passing' | 'failing' | 'running' }
  >;
} {
  const rows = [...runs]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((run) => ({ ...run, badge: workflowRunBadge(run) }));
  return {
    summary: {
      total: rows.length,
      passing: rows.filter((row) => row.badge === 'passing').length,
      failing: rows.filter((row) => row.badge === 'failing').length,
      running: rows.filter((row) => row.badge === 'running').length,
    },
    rows,
  };
}

function workflowRunBadge(run: WorkflowRunStatusInput): 'passing' | 'failing' | 'running' {
  if (run.status !== 'completed') return 'running';
  return run.conclusion === 'success' ? 'passing' : 'failing';
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
