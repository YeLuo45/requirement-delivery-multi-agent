#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threshold = Number(
  process.argv.find((arg) => arg.startsWith('--threshold='))?.split('=')[1] ?? '95',
);
const coverageDir = mkdtempSync(path.join(tmpdir(), 'rdma-v8-coverage-'));

function walk(dir, predicate) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const testFiles = [
  ...walk(path.join(repoRoot, 'packages'), (file) => file.endsWith('.test.ts')),
  ...walk(path.join(repoRoot, 'scripts'), (file) => file.endsWith('.test.ts')),
].sort();

const sourceFiles = walk(path.join(repoRoot, 'packages'), (file) => {
  if (!file.endsWith('.ts')) return false;
  if (!file.includes(`${path.sep}src${path.sep}`)) return false;
  return true;
}).sort();

const run = spawnSync(process.execPath, ['--test', '--import', 'tsx', ...testFiles], {
  cwd: repoRoot,
  env: { ...process.env, NODE_V8_COVERAGE: coverageDir },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

process.stdout.write(run.stdout);
process.stderr.write(run.stderr);
if (run.status !== 0) {
  rmSync(coverageDir, { recursive: true, force: true });
  process.exit(run.status ?? 1);
}

const resultsByFile = new Map();
for (const file of readdirSync(coverageDir).filter((name) => name.endsWith('.json'))) {
  const report = JSON.parse(readFileSync(path.join(coverageDir, file), 'utf8'));
  for (const item of report.result ?? []) {
    if (!item.url?.startsWith('file://')) continue;
    const filename = fileURLToPath(item.url);
    if (!filename.startsWith(repoRoot) || !sourceFiles.includes(filename)) continue;
    const ranges = [];
    for (const fn of item.functions ?? []) {
      for (const range of fn.ranges ?? []) {
        if (range.count > 0) ranges.push([range.startOffset, range.endOffset]);
      }
    }
    const existing = resultsByFile.get(filename) ?? [];
    existing.push(...ranges);
    resultsByFile.set(filename, existing);
  }
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function isCountable(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('*')) return false;
  if (trimmed.startsWith('/*')) return false;
  if (trimmed.startsWith('*/')) return false;
  if (trimmed === '{' || trimmed === '}' || trimmed === '};' || trimmed === ');') return false;
  if (trimmed.startsWith('import type ')) return false;
  if (trimmed.startsWith('import ') && trimmed.endsWith(';')) return false;
  if (trimmed.startsWith('export type ')) return false;
  if (trimmed.startsWith('export interface ')) return false;
  return true;
}

const rows = [];
let total = 0;
let covered = 0;
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  const starts = lineStarts(text);
  const lines = text.split('\n');
  const ranges = resultsByFile.get(file) ?? [];
  let fileTotal = 0;
  let fileCovered = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isCountable(lines[i])) continue;
    fileTotal++;
    const start = starts[i];
    const end = start + lines[i].length;
    if (ranges.some(([a, b]) => a <= end && b >= start)) fileCovered++;
  }
  total += fileTotal;
  covered += fileCovered;
  const percent = fileTotal === 0 ? 100 : (fileCovered / fileTotal) * 100;
  if (percent < threshold)
    rows.push({
      file: path.relative(repoRoot, file),
      covered: fileCovered,
      total: fileTotal,
      percent,
    });
}

rows.sort((a, b) => a.percent - b.percent || b.total - a.total);
const allPercent = total === 0 ? 100 : (covered / total) * 100;
console.log('\n== source coverage ==');
console.log(
  'Scope: packages/*/src/**/*.ts (all 13 source packages, including rdma-web and rdma-mcp-server)',
);
console.log(`Lines: ${covered}/${total} (${allPercent.toFixed(2)}%)`);
if (rows.length > 0) {
  console.log('\nFiles below threshold:');
  for (const row of rows.slice(0, 20)) {
    console.log(
      `  ${row.percent.toFixed(2).padStart(6)}%  ${String(row.covered).padStart(4)}/${String(row.total).padEnd(4)}  ${row.file}`,
    );
  }
}
rmSync(coverageDir, { recursive: true, force: true });
if (allPercent < threshold) {
  console.error(`\nCoverage ${allPercent.toFixed(2)}% is below required ${threshold.toFixed(2)}%`);
  process.exit(1);
}
console.log(`\nCoverage gate passed: ${allPercent.toFixed(2)}% >= ${threshold.toFixed(2)}%`);
