#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STATUS_RE = /^..\s+/;

export function buildReleaseLocalPlan() {
  return [
    { label: 'check', command: 'npm run check' },
    { label: 'test', command: 'npm test' },
    { label: 'coverage', command: 'npm run coverage' },
    { label: 'readme', command: 'npm run verify:readme' },
    { label: 'build', command: 'npm run build' },
  ];
}

export function summarizeDirtyFiles(lines) {
  const readmeDemoJson = [];
  const ordinaryDirty = [];
  for (const line of lines) {
    const file = line.replace(STATUS_RE, '').trim();
    if (!file) continue;
    if (/(^|\/)PRJ-\d{8}-\d{3}\/P-\d{8}-\d{3}\.json$/.test(file)) {
      readmeDemoJson.push(file);
    } else {
      ordinaryDirty.push(file);
    }
  }
  return { readmeDemoJson, ordinaryDirty };
}

export function buildReleaseLocalJson(input = {}) {
  const proposalId = input.proposalId ?? 'unknown';
  const dirty = summarizeDirtyFiles(input.dirtyLines ?? []);
  const changedFiles = [...dirty.ordinaryDirty, ...dirty.readmeDemoJson];
  const now = input.now ?? new Date().toISOString();
  const fileName = `${now.replace(/[:.]/g, '-')}.json`;
  return {
    proposalId,
    title: input.title ?? '',
    generatedAt: now,
    historyPath: input.historyRoot
      ? path.join(input.historyRoot, fileName)
      : `artifacts/release-local/${fileName}`,
    gates: buildReleaseLocalPlan(),
    dirty,
    ownership: buildProposalFileAssociations(proposalId, changedFiles),
  };
}

export function buildReleaseRunPayload(input = {}) {
  const payload = buildReleaseLocalJson(input);
  const gateResults = (input.results ?? []).map((result) =>
    buildGateResult(result.label, result.exitCode, result.durationMs, result.stderrSummary ?? ''),
  );
  const failedGate = gateResults.find((gate) => gate.status === 'fail') ?? null;
  return {
    ...payload,
    gateResults,
    completed: gateResults.length === buildReleaseLocalPlan().length && failedGate === null,
    failedGate,
  };
}

export function parseReleaseLocalArgs(args) {
  const parsed = { json: false, writeHistory: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--write-history') parsed.writeHistory = true;
    else if (arg === '--ci') parsed.ci = true;
    else if (arg === '--commit-manifest') parsed.commitManifest = true;
    else if (arg === '--diff') {
      parsed.diffBefore = args[index + 1] ?? '';
      parsed.diffAfter = args[index + 2] ?? '';
      index += 2;
    } else if (arg === '--proposal') {
      parsed.proposalId = args[index + 1] ?? 'unknown';
      index += 1;
    } else if (arg === '--title') {
      parsed.title = args[index + 1] ?? '';
      index += 1;
    } else if (arg === '--history-root') {
      parsed.historyRoot = args[index + 1] ?? 'artifacts/release-local';
      index += 1;
    }
  }
  return parsed;
}

export function writeReleaseHistory(payload, historyRoot = 'artifacts/release-local') {
  const target = payload.historyPath.startsWith(historyRoot)
    ? payload.historyPath
    : path.join(historyRoot, path.basename(payload.historyPath));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

export function readReleaseHistory(historyRoot = 'artifacts/release-local') {
  if (!existsSync(historyRoot)) return [];
  return readdirSync(historyRoot)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(historyRoot, file), 'utf8')))
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

export function buildGateResult(label, exitCode, durationMs, stderrSummary) {
  const status = exitCode === 0 ? 'pass' : 'fail';
  return {
    label,
    status,
    exitCode,
    durationMs,
    checklist: status === 'pass' ? [] : gateChecklist(label, stderrSummary),
  };
}

export function buildReleaseDiff(before, after) {
  const beforeDirty = new Set([...before.dirty.ordinaryDirty, ...before.dirty.readmeDemoJson]);
  const afterDirty = new Set([...after.dirty.ordinaryDirty, ...after.dirty.readmeDemoJson]);
  const beforeGates = new Set(before.gates.map((gate) => gate.label));
  const afterGates = new Set(after.gates.map((gate) => gate.label));
  const ownershipDelta = {};
  for (const key of ['sourceFiles', 'testFiles', 'docs', 'generated', 'other']) {
    const beforeValues = new Set(before.ownership[key] ?? []);
    ownershipDelta[key] = (after.ownership[key] ?? []).filter((file) => !beforeValues.has(file));
  }
  return {
    proposalChanged: before.proposalId !== after.proposalId,
    titleChanged: before.title !== after.title,
    addedDirtyFiles: [...afterDirty].filter((file) => !beforeDirty.has(file)),
    removedDirtyFiles: [...beforeDirty].filter((file) => !afterDirty.has(file)),
    changedGateLabels: [
      ...[...afterGates].filter((label) => !beforeGates.has(label)),
      ...[...beforeGates].filter((label) => !afterGates.has(label)),
    ],
    ownershipDelta,
  };
}

export function buildCommitPreparationManifest(payload) {
  return {
    proposalId: payload.proposalId,
    recommendedStage: [
      ...payload.ownership.sourceFiles,
      ...payload.ownership.testFiles,
      ...payload.ownership.docs,
      ...payload.ownership.generated,
      ...payload.ownership.other,
    ],
    groups: payload.ownership,
  };
}

export function buildCiSummaryMarkdown(payload, gateResults = []) {
  return [
    '# RDMA Release Evidence',
    '',
    `Proposal: ${payload.proposalId}`,
    `Title: ${payload.title}`,
    `History: ${payload.historyPath}`,
    '',
    '## Gates',
    ...gateResults.map((gate) => `- ${gate.label}: ${gate.status} (${gate.durationMs}ms)`),
    '',
  ].join('\n');
}

export function writeCiArtifacts(payload, artifactRoot = 'artifacts/release-local') {
  mkdirSync(artifactRoot, { recursive: true });
  const artifacts = {
    releaseJson: path.join(artifactRoot, 'release.json'),
    summaryMarkdown: path.join(artifactRoot, 'summary.md'),
    commitManifestJson: path.join(artifactRoot, 'commit-manifest.json'),
    diffJson: path.join(artifactRoot, 'diff.json'),
  };
  writeFileSync(artifacts.releaseJson, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(artifacts.summaryMarkdown, buildCiSummaryMarkdown(payload, payload.gateResults));
  writeFileSync(
    artifacts.commitManifestJson,
    `${JSON.stringify(buildCommitPreparationManifest(payload), null, 2)}\n`,
  );
  writeFileSync(
    artifacts.diffJson,
    `${JSON.stringify({ addedDirtyFiles: [], removedDirtyFiles: [], changedGateLabels: [] }, null, 2)}\n`,
  );
  return artifacts;
}

function gateChecklist(label, stderrSummary) {
  void stderrSummary;
  if (label === 'coverage') {
    return [
      'Run npm run coverage and inspect the threshold output.',
      'Add focused tests for uncovered new code paths.',
      'Rerun npm run coverage before release:local.',
    ];
  }
  if (label === 'test') {
    return [
      'Run npm test and isolate the first failing workspace.',
      'Fix the failing behavior with a regression test.',
      'Rerun npm test before release:local.',
    ];
  }
  return [
    `Run npm run ${label} directly with full output.`,
    'Fix the first deterministic error before rerunning release:local.',
  ];
}

function buildProposalFileAssociations(proposalId, files) {
  const sourceFiles = [];
  const testFiles = [];
  const docs = [];
  const generated = [];
  const other = [];
  for (const file of files) {
    if (/(^|\/)PRJ-\d{8}-\d{3}\/P-\d{8}-\d{3}\.json$/.test(file)) generated.push(file);
    else if (file.includes('/test/') || file.endsWith('.test.ts') || file.endsWith('.test.mjs')) {
      testFiles.push(file);
    } else if (file.startsWith('docs/') || file.startsWith('README')) docs.push(file);
    else if (file.includes('/src/') || file.startsWith('scripts/')) sourceFiles.push(file);
    else other.push(file);
  }
  return { proposalId, sourceFiles, testFiles, docs, generated, other };
}

function runCommand(command) {
  const started = Date.now();
  const result = spawnSync(command, { shell: true, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    stderrSummary: (result.stderr ?? '').split('\n').filter(Boolean).slice(-3).join('\n'),
  };
}

function main() {
  const args = parseReleaseLocalArgs(process.argv.slice(2));
  if (args.diffBefore || args.diffAfter) {
    const before = JSON.parse(readFileSync(args.diffBefore, 'utf8'));
    const after = JSON.parse(readFileSync(args.diffAfter, 'utf8'));
    console.log(JSON.stringify(buildReleaseDiff(before, after), null, 2));
    return;
  }
  if (args.json) {
    const git = spawnSync('git status --short', { shell: true, encoding: 'utf8' });
    const payload = buildReleaseLocalJson({
      proposalId: args.proposalId,
      title: args.title,
      historyRoot: args.historyRoot,
      dirtyLines: (git.stdout ?? '').split('\n'),
    });
    if (args.writeHistory) writeReleaseHistory(payload, args.historyRoot);
    if (args.commitManifest) {
      console.log(JSON.stringify(buildCommitPreparationManifest(payload), null, 2));
      return;
    }
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const results = [];
  for (const step of buildReleaseLocalPlan()) {
    console.log(`[release:local] ${step.label}: ${step.command}`);
    const result = runCommand(step.command);
    results.push({ label: step.label, ...result });
    if (result.exitCode !== 0) break;
  }
  const git = spawnSync('git status --short', { shell: true, encoding: 'utf8' });
  const payload = buildReleaseRunPayload({
    proposalId: args.proposalId,
    title: args.title,
    historyRoot: args.historyRoot,
    dirtyLines: (git.stdout ?? '').split('\n'),
    results,
  });
  if (args.writeHistory) writeReleaseHistory(payload, args.historyRoot);
  if (args.ci) {
    const artifacts = writeCiArtifacts(payload, args.historyRoot);
    console.log(`[release:local] CI summary: ${artifacts.summaryMarkdown}`);
    console.log(`[release:local] release JSON: ${artifacts.releaseJson}`);
  }
  const summary = summarizeDirtyFiles((git.stdout ?? '').split('\n'));
  console.log('[release:local] README demo JSON side effects:');
  for (const file of summary.readmeDemoJson) console.log(`- ${file}`);
  console.log('[release:local] Ordinary dirty files:');
  for (const file of summary.ordinaryDirty) console.log(`- ${file}`);
  if (payload.failedGate) process.exit(payload.failedGate.exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
