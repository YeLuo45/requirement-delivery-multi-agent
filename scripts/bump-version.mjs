#!/usr/bin/env node
/**
 * scripts/bump-version.mjs
 *
 * Bump the `version` field in every package.json under the
 * repository root (root + packages/<name>) to the value passed on
 * the command line. Used by the release workflow to keep every
 * workspace package in sync with the tagged release.
 *
 * Usage:
 *   node scripts/bump-version.mjs 0.2.0 [--root <path>]
 *
 * The script never touches any other field and writes back the file
 * in place with stable formatting. It is deliberately tiny so the
 * release pipeline can debug it without an external dependency.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootFlag = process.argv.indexOf('--root');
const explicitRoot = rootFlag !== -1 ? process.argv[rootFlag + 1] : undefined;
const positional = process.argv.filter((arg, i) => i !== rootFlag && i !== rootFlag + 1);
const targetVersion = positional[2];
if (!targetVersion) {
  console.error('Usage: bump-version.mjs <semver> [--root <path>]');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
  console.error(`Refusing to bump to non-semver: ${targetVersion}`);
  process.exit(1);
}

const repoRoot = explicitRoot
  ? path.resolve(explicitRoot)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageJsons = [
  path.join(repoRoot, 'package.json'),
  ...readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(repoRoot, 'packages', d.name, 'package.json'))
    .filter((p) => {
      try {
        return readFileSync(p, 'utf8').includes('"name"');
      } catch {
        return false;
      }
    }),
];

let touched = 0;
for (const file of packageJsons) {
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  const previous = parsed.version ?? '(unset)';
  parsed.version = targetVersion;
  // Preserve trailing newline; JSON.stringify otherwise strips it.
  const next = `${JSON.stringify(parsed, null, 2)}\n`;
  if (previous === targetVersion) {
    console.log(`- ${path.relative(repoRoot, file)}: unchanged (${previous})`);
    continue;
  }
  writeFileSync(file, next);
  touched += 1;
  console.log(`- ${path.relative(repoRoot, file)}: ${previous} -> ${targetVersion}`);
}
console.log(`Bumped ${touched} package.json file(s) to ${targetVersion}`);
