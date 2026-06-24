import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  type CommitManifestSummary,
  type DeliveryHistoryProposal,
  type DeliveryHistoryRecord,
  buildCiEvidenceNotesArtifact,
  buildProposalHealthDoctor,
  buildReleaseArtifactHub,
  buildReleaseOperationsCenter,
  buildReleaseReplayTimeline,
} from '../../rdma-web/src/delivery-history.js';

const RELEASE_OPS_SCHEMA_VERSION = 'release-ops.v2';

export interface ReleaseOpsIndexEntry {
  readonly proposalId: string;
  readonly generatedAt: string;
  readonly failedGateCount: number;
  readonly dirtyFileCount: number;
  readonly historyPath: string;
}

export interface ReleaseOpsStatusSuggestion {
  readonly proposalId: string;
  readonly currentStatus: string;
  readonly suggestedStatus: string;
  readonly reason: string;
}

export interface ReleaseOpsAutomationJson {
  readonly schemaVersion: string;
  readonly failedGateQueue: ReleaseOpsPayload['failedGateQueue'];
  readonly commitManifests: ReadonlyArray<CommitManifestSummary>;
  readonly releaseIndex: ReadonlyArray<ReleaseOpsIndexEntry>;
  readonly stageCommands: ReadonlyArray<string>;
  readonly statusSuggestions: ReadonlyArray<ReleaseOpsStatusSuggestion>;
  readonly prDraftMarkdown: string;
  readonly remediationMarkdown: string;
}

export interface ReleaseOpsPayload {
  readonly proposals: ReadonlyArray<DeliveryHistoryProposal>;
  readonly failedGateQueue: ReturnType<typeof buildReleaseOperationsCenter>['failedGateQueue'];
  readonly commitManifests: ReadonlyArray<CommitManifestSummary>;
  readonly releaseIndex: ReadonlyArray<ReleaseOpsIndexEntry>;
  readonly remediationMarkdown: string;
}

export interface ReleaseOpsOptions {
  readonly proposalId?: string;
}

export interface ReleaseOpsApplyStatusPlan {
  readonly mode: 'dry-run' | 'execute' | 'blocked';
  readonly commands: ReadonlyArray<string>;
  readonly text: string;
}

export interface ReleaseOpsWrittenFile {
  readonly path: string;
  readonly content: string;
}

export async function buildReleaseOpsPayload(
  dataRoot: string,
  options: ReleaseOpsOptions,
): Promise<ReleaseOpsPayload> {
  const proposals = await readLocalProposals(dataRoot);
  const histories = await readReleaseHistoryRecords(dataRoot);
  const proposalId = options.proposalId;
  const filteredProposals = proposalId
    ? proposals.filter((proposal) => proposal.id === proposalId)
    : proposals;
  const filteredHistories = proposalId
    ? histories.filter((history) => history.proposalId === proposalId)
    : histories;
  const center = buildReleaseOperationsCenter(filteredProposals, filteredHistories);
  return {
    proposals: filteredProposals,
    failedGateQueue: center.failedGateQueue,
    commitManifests: Array.from(center.commitManifests.values()).sort((left, right) =>
      left.proposalId.localeCompare(right.proposalId),
    ),
    releaseIndex: buildReleaseIndex(filteredHistories),
    remediationMarkdown: center.remediationMarkdown,
  };
}

export function renderReleaseOpsText(payload: ReleaseOpsPayload): string {
  const lines = ['Release Operations', ''];
  lines.push(`Failed gates: ${payload.failedGateQueue.length}`);
  if (payload.failedGateQueue.length === 0) {
    lines.push('- (none)');
  } else {
    for (const gate of payload.failedGateQueue) {
      lines.push(`${gate.proposalId} ${gate.gateLabel} ${gate.historyPath}`);
      for (const item of gate.checklist) lines.push(`  - ${item}`);
    }
  }
  lines.push('', 'Commit manifests:');
  if (payload.commitManifests.length === 0) {
    lines.push('- (none)');
  } else {
    for (const manifest of payload.commitManifests) {
      const counts = manifest.counts;
      lines.push(
        `${manifest.proposalId} source=${counts.sourceFiles} test=${counts.testFiles} docs=${counts.docs} generated=${counts.generated} other=${counts.other}`,
      );
    }
  }
  lines.push('', payload.remediationMarkdown.trimEnd());
  return `${lines.join('\n')}\n`;
}

export function renderReleaseOpsFixPrompt(payload: ReleaseOpsPayload): string {
  if (payload.failedGateQueue.length === 0) {
    return 'No failed release gates. No fix prompt needed.\n';
  }
  return `${payload.failedGateQueue
    .map((gate) =>
      [
        `Fix proposal ${gate.proposalId} (${gate.title}).`,
        `Failed gate: ${gate.gateLabel}`,
        `Release history: ${gate.historyPath}`,
        'Checklist:',
        ...gate.checklist.map((item) => `- ${item}`),
        'Verification commands:',
        '- npm run check',
        '- npm test',
        '- npm run coverage',
        '- npm run verify:readme',
        '- npm run build',
      ].join('\n'),
    )
    .join('\n\n')}\n`;
}

export function renderReleaseOpsStageCommands(payload: ReleaseOpsPayload): ReadonlyArray<string> {
  return payload.commitManifests
    .map((manifest) => manifest.recommendedStagePaths)
    .filter((paths) => paths.length > 0)
    .map((paths) => `git add -- ${paths.join(' ')}`);
}

export function renderReleaseOpsPrDraft(payload: ReleaseOpsPayload): string {
  const stageCommands = renderReleaseOpsStageCommands(payload);
  const lines = ['# Release Operations PR Draft', ''];
  lines.push('## Summary');
  lines.push(`- Failed gates: ${payload.failedGateQueue.length}`);
  lines.push(`- Release index entries: ${payload.releaseIndex.length}`);
  lines.push(`- Commit manifests: ${payload.commitManifests.length}`);
  lines.push('', '## Failed Gates');
  if (payload.failedGateQueue.length === 0) {
    lines.push('- None');
  } else {
    for (const gate of payload.failedGateQueue) {
      lines.push(`- ${gate.proposalId} ${gate.gateLabel} (${gate.historyPath})`);
      for (const item of gate.checklist) lines.push(`  - ${item}`);
    }
  }
  lines.push('', '## Release Index');
  if (payload.releaseIndex.length === 0) {
    lines.push('- None');
  } else {
    for (const entry of payload.releaseIndex) {
      lines.push(
        `- ${entry.proposalId}: generated=${entry.generatedAt}, failed=${entry.failedGateCount}, dirty=${entry.dirtyFileCount}`,
      );
    }
  }
  lines.push('', '## Commit Manifests');
  if (payload.commitManifests.length === 0) {
    lines.push('- None');
  } else {
    for (const manifest of payload.commitManifests) {
      const counts = manifest.counts;
      lines.push(
        `- ${manifest.proposalId}: source=${counts.sourceFiles} test=${counts.testFiles} docs=${counts.docs} generated=${counts.generated} other=${counts.other}`,
      );
    }
  }
  lines.push('', '## Suggested Stage Commands');
  if (stageCommands.length === 0) {
    lines.push('- None');
  } else {
    for (const command of stageCommands) lines.push(`- ${command}`);
  }
  lines.push(
    '',
    '## Verification Checklist',
    '- npm run check',
    '- npm test',
    '- npm run coverage',
    '- npm run verify:readme',
    '- npm run build',
  );
  return `${lines.join('\n')}\n`;
}

export function renderReleaseOpsAutomationJson(
  payload: ReleaseOpsPayload,
): ReleaseOpsAutomationJson {
  return {
    schemaVersion: RELEASE_OPS_SCHEMA_VERSION,
    failedGateQueue: payload.failedGateQueue,
    commitManifests: payload.commitManifests,
    releaseIndex: payload.releaseIndex,
    stageCommands: renderReleaseOpsStageCommands(payload),
    statusSuggestions: buildReleaseOpsStatusSuggestions(payload),
    prDraftMarkdown: renderReleaseOpsPrDraft(payload),
    remediationMarkdown: payload.remediationMarkdown,
  };
}

export function renderReleaseOpsCiSummary(payload: ReleaseOpsPayload): string {
  const automation = renderReleaseOpsAutomationJson(payload);
  const lines = ['# RDMA Release Operations Summary', ''];
  lines.push(`Schema: ${automation.schemaVersion}`);
  lines.push(`Failed gates: ${automation.failedGateQueue.length}`);
  lines.push(`Release index entries: ${automation.releaseIndex.length}`);
  lines.push('', '## Failed Gates');
  if (automation.failedGateQueue.length === 0) {
    lines.push('- None');
  } else {
    for (const gate of automation.failedGateQueue) {
      lines.push(`- ${gate.proposalId} ${gate.gateLabel}: ${gate.historyPath}`);
      for (const item of gate.checklist) lines.push(`  - ${item}`);
    }
  }
  lines.push('', '## Safe Status Suggestions');
  if (automation.statusSuggestions.length === 0) {
    lines.push('- None');
  } else {
    for (const suggestion of automation.statusSuggestions) {
      lines.push(
        `- ${suggestion.proposalId} → ${suggestion.suggestedStatus} (${suggestion.reason})`,
      );
    }
  }
  lines.push('', '## Suggested Stage Commands');
  if (automation.stageCommands.length === 0) {
    lines.push('- None');
  } else {
    for (const command of automation.stageCommands) lines.push(`- ${command}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderReleaseOpsApplyStatusDryRun(
  payload: ReleaseOpsPayload,
  proposalId: string,
  targetStatus: string,
): string {
  return renderReleaseOpsApplyStatusExecutionPlan(payload, proposalId, targetStatus, {
    execute: false,
    mcpHelperPath: 'mcp_aisp.py',
  }).text;
}

export function renderReleaseOpsApplyStatusExecutionPlan(
  payload: ReleaseOpsPayload,
  proposalId: string,
  targetStatus: string,
  options: { readonly execute: boolean; readonly mcpHelperPath: string },
): ReleaseOpsApplyStatusPlan {
  const suggestion = buildReleaseOpsStatusSuggestions(payload).find(
    (item) => item.proposalId === proposalId,
  );
  if (!suggestion) {
    return {
      mode: 'blocked',
      commands: [],
      text: `BLOCKED\n${proposalId}: no safe status suggestion is available.\nNo proposal state was changed.\n`,
    };
  }
  if (suggestion.suggestedStatus !== targetStatus) {
    return {
      mode: 'blocked',
      commands: [],
      text: [
        'BLOCKED',
        `${proposalId}: ${targetStatus} is not a safe next status from ${suggestion.currentStatus}.`,
        `Suggested next status: ${suggestion.suggestedStatus}`,
        'No proposal state was changed.',
        '',
      ].join('\n'),
    };
  }
  const command = `python3 ${options.mcpHelperPath} update-proposal-status --proposal-id ${proposalId} --status ${targetStatus}`;
  if (options.execute) {
    return {
      mode: 'execute',
      commands: [command],
      text: [
        'EXECUTE PLAN',
        `${proposalId}: ${suggestion.currentStatus} → ${suggestion.suggestedStatus}`,
        `Reason: ${suggestion.reason}`,
        command,
        '',
      ].join('\n'),
    };
  }
  return {
    mode: 'dry-run',
    commands: [],
    text: [
      'DRY RUN',
      `${proposalId}: ${suggestion.currentStatus} → ${suggestion.suggestedStatus}`,
      `Reason: ${suggestion.reason}`,
      'No proposal state was changed.',
      '',
    ].join('\n'),
  };
}

export async function writeReleaseOpsDeliveryReportFiles(
  dataRoot: string,
  payload: ReleaseOpsPayload,
  options: { readonly generatedAt: string },
): Promise<{ readonly files: ReadonlyArray<ReleaseOpsWrittenFile> }> {
  const automation = renderReleaseOpsAutomationJson(payload);
  const artifactPaths = payload.releaseIndex.map((entry) => entry.historyPath);
  const histories = payload.releaseIndex.map((entry) => ({
    proposalId: entry.proposalId,
    generatedAt: entry.generatedAt,
    historyPath: entry.historyPath,
    gateResults: [],
    dirty: { ordinaryDirty: [], readmeDemoJson: [] },
  }));
  const health = buildProposalHealthDoctor({
    proposals: payload.proposals,
    histories,
    pushedCommitSubjects: [],
  });
  const hub = buildReleaseArtifactHub({
    generatedAt: options.generatedAt,
    histories,
    workflowRunsPath: 'release-local/workflow-runs.json',
    healthPath: 'release-local/proposal-health.json',
  });
  const replay = payload.proposals[0]
    ? buildReleaseReplayTimeline({
        proposal: payload.proposals[0],
        histories,
        commits: [],
      }).markdown
    : '# Release Replay Timeline\n\nNo proposal history available.\n';
  const files: ReleaseOpsWrittenFile[] = [
    {
      path: path.join(dataRoot, 'release-local', 'delivery-report.md'),
      content: renderReleaseOpsPrDraft(payload),
    },
    {
      path: path.join(dataRoot, 'release-local', 'ci-evidence.md'),
      content: buildCiEvidenceNotesArtifact({
        generatedAt: options.generatedAt,
        failedGateCount: payload.failedGateQueue.length,
        artifactPaths,
        statusSuggestions: automation.statusSuggestions,
      }),
    },
    {
      path: path.join(dataRoot, 'release-local', 'automation.json'),
      content: `${JSON.stringify(automation, null, 2)}\n`,
    },
    {
      path: path.join(dataRoot, 'release-local', 'index.json'),
      content: `${JSON.stringify(hub.index, null, 2)}\n`,
    },
    {
      path: path.join(dataRoot, 'release-local', 'proposal-health.json'),
      content: `${JSON.stringify(health, null, 2)}\n`,
    },
    {
      path: path.join(dataRoot, 'release-local', 'diff.json'),
      content: `${JSON.stringify({ proposals: payload.releaseIndex }, null, 2)}\n`,
    },
    {
      path: path.join(dataRoot, 'release-local', 'replay.md'),
      content: replay,
    },
  ];
  for (const file of files) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.content, 'utf8');
  }
  return { files };
}

export function renderReleaseOpsRecoveryPlan(
  payload: ReleaseOpsPayload,
  options: { readonly mcpHelperPath: string },
): string {
  const suggestions = buildReleaseOpsStatusSuggestions(payload);
  const lines = ['# Proposal MCP Recovery Plan', ''];
  if (suggestions.length === 0) {
    lines.push('No safe proposal recovery steps are available.');
  } else {
    for (const suggestion of suggestions) {
      const command = `python3 ${options.mcpHelperPath} update-proposal-status --proposal-id ${suggestion.proposalId} --status ${suggestion.suggestedStatus}`;
      lines.push(
        `- ${suggestion.proposalId}: ${suggestion.currentStatus} → ${suggestion.suggestedStatus}`,
        `  - Reason: ${suggestion.reason}`,
        `  - Command: ${command}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function cmdReleaseOps(argv: string[], dataRoot: string): Promise<void> {
  const flags = parseReleaseOpsArgs(argv);
  const payload = await buildReleaseOpsPayload(
    dataRoot,
    flags.proposalId ? { proposalId: flags.proposalId } : {},
  );
  if (flags.applyStatus) {
    const plan = renderReleaseOpsApplyStatusExecutionPlan(
      payload,
      flags.applyStatus.proposalId,
      flags.applyStatus.to,
      {
        execute: flags.execute,
        mcpHelperPath: flags.mcpHelperPath,
      },
    );
    console.log(plan.text);
    return;
  }
  if (flags.writeReports) {
    const result = await writeReleaseOpsDeliveryReportFiles(dataRoot, payload, {
      generatedAt: new Date().toISOString(),
    });
    console.log(`Wrote ${result.files.length} release report files:`);
    for (const file of result.files) console.log(`- ${file.path}`);
    return;
  }
  if (flags.recoveryPlan) {
    console.log(renderReleaseOpsRecoveryPlan(payload, { mcpHelperPath: flags.mcpHelperPath }));
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(renderReleaseOpsAutomationJson(payload), null, 2));
    return;
  }
  if (flags.ciSummary) {
    console.log(renderReleaseOpsCiSummary(payload));
    return;
  }
  if (flags.prDraft) {
    console.log(renderReleaseOpsPrDraft(payload));
    return;
  }
  if (flags.fixPrompt) {
    console.log(renderReleaseOpsFixPrompt(payload));
    return;
  }
  console.log(renderReleaseOpsText(payload));
}

function parseReleaseOpsArgs(argv: ReadonlyArray<string>): {
  json: boolean;
  fixPrompt: boolean;
  prDraft: boolean;
  ciSummary: boolean;
  execute: boolean;
  writeReports: boolean;
  recoveryPlan: boolean;
  mcpHelperPath: string;
  applyStatus?: { proposalId: string; to: string };
  proposalId?: string;
} {
  let json = false;
  let fixPrompt = false;
  let prDraft = false;
  let ciSummary = false;
  let execute = false;
  let writeReports = false;
  let recoveryPlan = false;
  let mcpHelperPath = 'mcp_aisp.py';
  let applyStatus = false;
  let proposalId: string | undefined;
  let to: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') json = true;
    else if (arg === '--fix-prompt') fixPrompt = true;
    else if (arg === '--pr-draft') prDraft = true;
    else if (arg === '--ci-summary') ciSummary = true;
    else if (arg === '--execute') execute = true;
    else if (arg === '--write-reports') writeReports = true;
    else if (arg === '--recovery-plan') recoveryPlan = true;
    else if (arg === 'apply-status') applyStatus = true;
    else if (arg === '--mcp-helper') {
      const next = argv[index + 1];
      if (next) {
        mcpHelperPath = next;
        index++;
      }
    } else if (arg?.startsWith('--mcp-helper=')) {
      mcpHelperPath = arg.slice('--mcp-helper='.length);
    } else if (arg === '--to') {
      const next = argv[index + 1];
      if (next) {
        to = next;
        index++;
      }
    } else if (arg?.startsWith('--to=')) {
      to = arg.slice('--to='.length);
    } else if (arg === '--proposal') {
      const next = argv[index + 1];
      if (next) {
        proposalId = next;
        index++;
      }
    } else if (arg?.startsWith('--proposal=')) {
      proposalId = arg.slice('--proposal='.length);
    }
  }
  return {
    json,
    fixPrompt,
    prDraft,
    ciSummary,
    execute,
    writeReports,
    recoveryPlan,
    mcpHelperPath,
    ...(applyStatus && proposalId && to ? { applyStatus: { proposalId, to } } : {}),
    ...(proposalId ? { proposalId } : {}),
  };
}

function buildReleaseIndex(
  histories: ReadonlyArray<DeliveryHistoryRecord>,
): ReadonlyArray<ReleaseOpsIndexEntry> {
  const latest = new Map<string, DeliveryHistoryRecord>();
  for (const history of histories) {
    const current = latest.get(history.proposalId);
    if (!current || history.generatedAt.localeCompare(current.generatedAt) > 0) {
      latest.set(history.proposalId, history);
    }
  }
  return Array.from(latest.values())
    .map((history) => ({
      proposalId: history.proposalId,
      generatedAt: history.generatedAt,
      failedGateCount: (history.gateResults ?? []).filter((gate) => gate.status === 'fail').length,
      dirtyFileCount: history.dirty.ordinaryDirty.length + history.dirty.readmeDemoJson.length,
      historyPath: history.historyPath,
    }))
    .sort((left, right) => {
      const time = right.generatedAt.localeCompare(left.generatedAt);
      if (time !== 0) return time;
      return left.proposalId.localeCompare(right.proposalId);
    });
}

function buildReleaseOpsStatusSuggestions(
  payload: ReleaseOpsPayload,
): ReadonlyArray<ReleaseOpsStatusSuggestion> {
  const proposalById = new Map(payload.proposals.map((proposal) => [proposal.id, proposal]));
  return payload.releaseIndex
    .map((entry) => {
      const proposal = proposalById.get(entry.proposalId);
      if (!proposal) return null;
      if (entry.failedGateCount > 0) {
        return {
          proposalId: proposal.id,
          currentStatus: proposal.status,
          suggestedStatus: 'test_failed',
          reason: 'latest release history has failed gates',
        };
      }
      if (proposal.status === 'in_test_acceptance') {
        return {
          proposalId: proposal.id,
          currentStatus: proposal.status,
          suggestedStatus: 'accepted',
          reason: 'release gates passed; proposal is ready for acceptance',
        };
      }
      if (proposal.status === 'accepted') {
        return {
          proposalId: proposal.id,
          currentStatus: proposal.status,
          suggestedStatus: 'deployed',
          reason: 'release gates passed; accepted proposal can be marked deployed',
        };
      }
      if (proposal.status === 'deployed') {
        return {
          proposalId: proposal.id,
          currentStatus: proposal.status,
          suggestedStatus: 'delivered',
          reason: 'release gates passed; deployed proposal can be delivered',
        };
      }
      return null;
    })
    .filter((suggestion): suggestion is ReleaseOpsStatusSuggestion => suggestion !== null);
}

async function readLocalProposals(dataRoot: string): Promise<DeliveryHistoryProposal[]> {
  const proposals: DeliveryHistoryProposal[] = [];
  const projects = await fs.readdir(path.join(dataRoot, 'proposals')).catch(() => []);
  for (const projectId of projects) {
    const dir = path.join(dataRoot, 'proposals', projectId);
    const files = await fs.readdir(dir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(dir, file), 'utf8').catch(() => '');
      if (!content) continue;
      const parsed = JSON.parse(content) as { id?: string; title?: string; status?: string };
      if (parsed.id && parsed.title && parsed.status) {
        proposals.push({ id: parsed.id, title: parsed.title, status: parsed.status });
      }
    }
  }
  proposals.sort((left, right) => left.id.localeCompare(right.id));
  return proposals;
}

async function readReleaseHistoryRecords(dataRoot: string): Promise<DeliveryHistoryRecord[]> {
  const historyRoot = path.join(dataRoot, 'release-local');
  const files = await fs.readdir(historyRoot).catch(() => []);
  const records: DeliveryHistoryRecord[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = await fs.readFile(path.join(historyRoot, file), 'utf8').catch(() => '');
    if (!content) continue;
    const parsed = JSON.parse(content) as DeliveryHistoryRecord;
    if (typeof parsed.proposalId === 'string' && typeof parsed.generatedAt === 'string') {
      records.push(parsed);
    }
  }
  records.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  return records;
}
