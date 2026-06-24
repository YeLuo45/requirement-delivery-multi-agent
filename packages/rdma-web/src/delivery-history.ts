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

export interface ProposalHealthDoctorInput {
  readonly proposals: ReadonlyArray<DeliveryHistoryProposal>;
  readonly histories: ReadonlyArray<DeliveryHistoryRecord>;
  readonly pushedCommitSubjects: ReadonlyArray<string>;
}

export interface ProposalHealthIssue {
  readonly proposalId: string;
  readonly kind: 'missing-release-history' | 'not-deployed' | 'commit-not-pushed';
  readonly severity: 'warning';
  readonly detail: string;
}

export interface ReleaseArtifactHubInput {
  readonly generatedAt: string;
  readonly histories: ReadonlyArray<DeliveryHistoryRecord>;
  readonly workflowRunsPath: string;
  readonly healthPath: string;
}

export interface OperatorExecutionConsoleInput {
  readonly proposalId: string;
  readonly currentStatus: string;
  readonly safeStatusActions: ReadonlyArray<SafeStatusApplyAction>;
  readonly blockedStatusActions: ReadonlyArray<SafeStatusApplyBlocked>;
  readonly workflowSummary: ReturnType<typeof buildWorkflowRunStatusDashboard>['summary'];
}

export interface ReleaseReplayTimelineInput {
  readonly proposal: DeliveryHistoryProposal;
  readonly histories: ReadonlyArray<DeliveryHistoryRecord>;
  readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
}

export interface StaleProposalRecoveryInput {
  readonly staleProposals: ReadonlyArray<DeliveryHistoryProposal>;
  readonly supersedingProposalId: string;
  readonly mcpHelperPath: string;
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
  const envPrefix = [
    `RDMA_STORAGE_ROOT=${input.sandboxRoot}/.rdma/data`,
    `RDMA_SHIPPED_ROOT=${input.sandboxRoot}/.rdma/shipped`,
    `RDMA_CONFIG_ROOT=${input.sandboxRoot}/.rdma/config`,
  ].join(' ');
  return {
    mutatesOriginalWorkspace: false,
    setupCommands: [
      `mkdir -p ${input.sandboxRoot}`,
      `rsync -a --delete --exclude .git ${input.repoRoot}/ ${input.sandboxRoot}/`,
    ],
    verificationCommands: input.commands.map(
      (command) => `cd ${input.sandboxRoot} && ${envPrefix} ${command}`,
    ),
  };
}

export function buildProposalHealthDoctor(input: ProposalHealthDoctorInput): {
  readonly summary: { readonly total: number; readonly healthy: number; readonly warnings: number };
  readonly issues: ReadonlyArray<ProposalHealthIssue>;
  readonly fixPlanMarkdown: string;
} {
  const latestByProposal = latestHistoriesByProposal(input.histories);
  const issues: ProposalHealthIssue[] = [];
  for (const proposal of input.proposals) {
    const latest = latestByProposal.get(proposal.id);
    if (!latest && proposal.status !== 'delivered') {
      issues.push({
        proposalId: proposal.id,
        kind: 'missing-release-history',
        severity: 'warning',
        detail: `${proposal.id} has no release-local history evidence`,
      });
      continue;
    }
    if (latest && proposal.status === 'accepted') {
      issues.push({
        proposalId: proposal.id,
        kind: 'not-deployed',
        severity: 'warning',
        detail: `${proposal.id} has gate evidence but is not deployed`,
      });
      continue;
    }
    if (
      latest &&
      proposal.status === 'delivered' &&
      !input.pushedCommitSubjects.some((subject) => subject.includes(proposal.id))
    ) {
      issues.push({
        proposalId: proposal.id,
        kind: 'commit-not-pushed',
        severity: 'warning',
        detail: `${proposal.id} is delivered but no pushed commit subject references it`,
      });
    }
  }
  const lines = ['# Proposal Health Doctor', ''];
  if (issues.length === 0) {
    lines.push('No proposal health issues detected.');
  } else {
    for (const issue of issues) {
      lines.push(`- ${issue.proposalId}: ${issue.kind} — ${issue.detail}`);
    }
  }
  return {
    summary: {
      total: input.proposals.length,
      healthy: input.proposals.length - issues.length,
      warnings: issues.length,
    },
    issues,
    fixPlanMarkdown: `${lines.join('\n')}\n`,
  };
}

export function buildReleaseArtifactHub(input: ReleaseArtifactHubInput): {
  readonly index: {
    readonly schemaVersion: 'release-artifact-hub.v1';
    readonly generatedAt: string;
    readonly files: ReadonlyArray<{ readonly kind: string; readonly path: string }>;
    readonly proposals: ReadonlyArray<{
      readonly proposalId: string;
      readonly historyPath: string;
    }>;
  };
  readonly downloadActions: ReadonlyArray<{ readonly label: string; readonly copyText: string }>;
} {
  const files = [
    { kind: 'delivery-report', path: 'release-local/delivery-report.md' },
    { kind: 'ci-evidence', path: 'release-local/ci-evidence.md' },
    { kind: 'automation-json', path: 'release-local/automation.json' },
    { kind: 'diff-json', path: 'release-local/diff.json' },
    { kind: 'workflow-runs', path: input.workflowRunsPath },
    { kind: 'proposal-health', path: input.healthPath },
  ];
  return {
    index: {
      schemaVersion: 'release-artifact-hub.v1',
      generatedAt: input.generatedAt,
      files,
      proposals: input.histories.map((history) => ({
        proposalId: history.proposalId,
        historyPath: history.historyPath,
      })),
    },
    downloadActions: files.map((file) => ({ label: file.kind, copyText: file.path })),
  };
}

export function buildOperatorExecutionConsole(input: OperatorExecutionConsoleInput): {
  readonly header: string;
  readonly primaryButtons: ReadonlyArray<{
    readonly label: string;
    readonly dryRunText: string;
    readonly executeText: string;
  }>;
  readonly blockedReasons: ReadonlyArray<string>;
  readonly workflowSummary: OperatorExecutionConsoleInput['workflowSummary'];
} {
  return {
    header: `${input.proposalId} ${input.currentStatus}`,
    primaryButtons: input.safeStatusActions.map((action) => ({
      label: `Execute ${action.suggestedStatus}`,
      dryRunText: action.dryRunCommand,
      executeText: action.dryRunCommand.replace(/ --dry-run$/, ' --execute'),
    })),
    blockedReasons: input.blockedStatusActions.map((action) => action.reason),
    workflowSummary: input.workflowSummary,
  };
}

export function buildReleaseReplayTimeline(input: ReleaseReplayTimelineInput): {
  readonly events: ReadonlyArray<{
    readonly kind: 'proposal' | 'gate' | 'commit' | 'status';
    readonly text: string;
  }>;
  readonly markdown: string;
} {
  const events: Array<{ kind: 'proposal' | 'gate' | 'commit' | 'status'; text: string }> = [
    { kind: 'proposal', text: `${input.proposal.id}: ${input.proposal.title}` },
  ];
  const latest = latestHistoriesByProposal(input.histories).get(input.proposal.id);
  const gate = latest?.gateResults?.[0];
  if (gate) events.push({ kind: 'gate', text: `${gate.label}: ${gate.status}` });
  const commit = input.commits.find((item) => item.subject.includes(input.proposal.id));
  if (commit) events.push({ kind: 'commit', text: `${commit.sha} ${commit.subject}` });
  events.push({ kind: 'status', text: `MCP status: ${input.proposal.status}` });
  return {
    events,
    markdown: `${['# Release Replay Timeline', '', ...events.map((event) => `- ${event.kind}: ${event.text}`)].join('\n')}\n`,
  };
}

export function buildStaleProposalRecoveryPlan(input: StaleProposalRecoveryInput): {
  readonly actions: ReadonlyArray<{
    readonly proposalId: string;
    readonly mode: 'safe-next' | 'blocked';
    readonly nextStatus?: string;
    readonly command?: string;
    readonly reason: string;
  }>;
  readonly markdown: string;
} {
  const actions = input.staleProposals.map((proposal) => {
    const nextStatus = SAFE_NEXT[proposal.status]?.[0];
    if (!nextStatus || proposal.status === 'intake') {
      return {
        proposalId: proposal.id,
        mode: 'blocked' as const,
        reason: `${proposal.id} cannot be safely auto-advanced; superseded by ${input.supersedingProposalId}`,
      };
    }
    return {
      proposalId: proposal.id,
      mode: 'safe-next' as const,
      nextStatus,
      command: `python3 ${input.mcpHelperPath} update-proposal-status --proposal-id ${proposal.id} --status ${nextStatus}`,
      reason: `${proposal.id} appears stale and superseded by ${input.supersedingProposalId}`,
    };
  });
  const lines = ['# Stale Proposal Recovery Plan', ''];
  for (const action of actions) {
    lines.push(`- ${action.proposalId}: ${action.reason}`);
    if (action.command) lines.push(`  - Command: ${action.command}`);
  }
  return { actions, markdown: `${lines.join('\n')}\n` };
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
