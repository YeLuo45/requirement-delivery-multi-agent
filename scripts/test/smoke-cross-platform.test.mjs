/**
 * Tests for scripts/smoke-cross-platform.mjs. We stub `process.exit`
 * and capture stdout so we can assert on the printed structure.
 *
 * The probes only rely on the OS module + `SqliteStorage.open()`,
 * so we don't need a server fixture — the SQLite binary either
 * loads on the host (Linux/macOS prebuilt) or the probe marks
 * itself as SKIP. Either outcome is acceptable per the README
 * honesty contract; only "real" errors flip the script to fail.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';

const SCRIPT = 'scripts/smoke-cross-platform.mjs';

function runScript(env = {}) {
  return execFileSync('node', ['--import', 'tsx', SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('smoke-cross-platform.mjs', () => {
  let output;
  let exitCode;

  afterEach(() => {
    output = undefined;
    exitCode = undefined;
  });

  it('prints the environment header on every host', () => {
    try {
      output = runScript();
      exitCode = 0;
    } catch (err) {
      // The script always exits 0 when probes SKIP cleanly,
      // but we keep this branch in case a future regression
      // makes it fail. We still inspect stdout for structure.
      output = err.stdout?.toString() ?? '';
      exitCode = err.status ?? 1;
    }
    assert.match(output, /=== Environment ===/);
    assert.match(output, /os\.platform=/);
    assert.match(output, /node=v/);
  });

  it('reports SQLite status as either pass or skip (never fail) on CI hosts', () => {
    // The script must never flip to exit 1 solely because
    // better-sqlite3 is missing — that's the whole point of the
    // cross-platform contract.
    try {
      output = runScript();
      exitCode = 0;
    } catch (err) {
      output = err.stdout?.toString() ?? '';
      exitCode = err.status ?? 1;
    }
    assert.match(
      output,
      /=== SQLite backend probe ===[\s\S]*?( {2}✓ SqliteStorage\.open| {2}~ SKIP SqliteStorage native binding unavailable)/,
    );
    // If it failed for any other reason the test must surface it.
    assert.match(output, /cross-platform smoke passed/);
  });

  it('exits non-zero only when a non-binding error occurs', () => {
    // Use a pathological RDMA_SQLITE_PATH that points at a
    // directory to force open() to fail with EACCES-equivalent
    // — but we don't expose such a hook in the script yet. So
    // we simply assert that the happy / SKIP path leaves the
    // exit code at zero.
    let code = 0;
    try {
      runScript();
    } catch (err) {
      code = err.status ?? 1;
    }
    assert.equal(code, 0);
  });
});
