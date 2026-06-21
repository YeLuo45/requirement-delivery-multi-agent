/**
 * Tests for `check-node.mjs`. We can't actually swap Node binaries
 * in-process, so we exercise the parser/argv logic directly and
 * verify the shell-out path produces a probe that runs against
 * the current Node.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { major } from '../scripts/parse-version.js';

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'check-node.mjs',
);

describe('major()', () => {
  it('parses "20.20.2" -> 20', () => {
    assert.equal(major('20.20.2'), 20);
  });
  it('parses "18.0.0" -> 18', () => {
    assert.equal(major('18.0.0'), 18);
  });
  it('parses "22" -> 22', () => {
    assert.equal(major('22'), 22);
  });
  it('parses "" as 0 (Number("") semantics)', () => {
    assert.equal(major(''), 0);
  });
});

describe('check-node.mjs', () => {
  it('exits 0 when run with the current Node major', () => {
    const out = execFileSync(
      process.execPath,
      [scriptPath, String(process.versions.node.split('.')[0])],
      {
        encoding: 'utf8',
      },
    );
    assert.match(out, /\[check-node\] running on Node /);
    assert.match(out, /diff ok P-1 -> P-2/);
  });

  it('exits non-zero when asked for a different Node major', () => {
    const actual = String(process.versions.node.split('.')[0]);
    // Pick a major that is not the current one. If we're on 20,
    // ask for 18; if we're on 18, ask for 22; otherwise default
    // to 20 because it has a representative 0/2 mismatch.
    const wants = actual === '20' ? '18' : '20';
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [scriptPath, wants], { encoding: 'utf8' });
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = String(err.stderr ?? '');
    }
    assert.notEqual(exitCode, 0, `expected non-zero exit when asking for Node ${wants}, got 0`);
    assert.match(stderr, /want Node/);
  });
});
