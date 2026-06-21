#!/usr/bin/env node
/**
 * scripts/format-release-notes.mjs
 *
 * Format a Markdown release note body between two git refs. The
 * GitHub Action `softprops/action-gh-release` consumes the resulting
 * string verbatim as the release description.
 *
 * Strategy:
 *   1. List every commit reachable from `to` but not from `from`,
 *      with author + date + subject.
 *   2. Group commits by their conventional-commit prefix (feat,
 *      fix, chore, …). Unknown prefixes go into "Other".
 *   3. Print a short summary header + each group in a bullet list.
 *
 * This intentionally avoids depending on a third-party changelog
 * tool — we have a single source of truth (the git log) and the
 * release workflow only needs a human-readable summary.
 */

import { execFileSync } from 'node:child_process';

const fromRef = process.argv[2] ?? 'HEAD~';
const toRef = process.argv[3] ?? 'HEAD';

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function listCommits(from, to) {
  const range = `${from}..${to}`;
  const raw = run('git', [
    'log',
    '--no-merges',
    '--pretty=format:%H%x1f%an%x1f%ad%x1f%s',
    '--date=short',
    range,
  ]);
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, subject] = line.split('\x1f');
      return { hash: (hash ?? '').slice(0, 7), author, date, subject };
    });
}

function classifyPrefix(subject) {
  const match = /^([a-zA-Z]+)(?:\([^)]+\))?:\s*/.exec(subject);
  return match ? match[1].toLowerCase() : null;
}

const commits = listCommits(fromRef, toRef);
if (commits.length === 0) {
  console.log(`No new commits between ${fromRef} and ${toRef}.`);
  process.exit(0);
}

const groups = new Map();
for (const c of commits) {
  const prefix = classifyPrefix(c.subject) ?? 'other';
  if (!groups.has(prefix)) groups.set(prefix, []);
  groups.get(prefix).push(c);
}

const order = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore', 'build', 'ci', 'other'];
const lines = [];
lines.push(`## What's changed`);
lines.push('');
lines.push(
  `Range: \`${fromRef}..${toRef}\` (${commits.length} commit${commits.length === 1 ? '' : 's'})`,
);
lines.push('');
for (const key of order) {
  const list = groups.get(key);
  if (!list || list.length === 0) continue;
  lines.push(`### ${key}`);
  for (const c of list) {
    lines.push(`- ${c.subject} (\`${c.hash}\`, @${c.author}, ${c.date})`);
  }
  lines.push('');
}
console.log(lines.join('\n'));
