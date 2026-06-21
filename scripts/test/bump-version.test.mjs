/**
 * Tests for scripts/bump-version.mjs -- the release-time helper
 * that rewrites every package.json under the repo root to a
 * target semver. We run the script on a temp directory that
 * mimics the workspace layout and assert that:
 *
 *   1. The root package.json + every packages/<name>/package.json is
 *      updated to the target version.
 *   2. Files that are not valid package.json (no `name` field) are
 *      left untouched.
 *   3. A non-semver argument exits non-zero without touching
 *      anything.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const SCRIPT = path.resolve('scripts/bump-version.mjs');

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'rdma-bump-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'rdma-root', version: '0.1.0', private: true }, null, 2),
  );
  for (const pkg of ['rdma-core', 'rdma-cli']) {
    const dir = path.join(root, 'packages', pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: `@rdma/${pkg}`, version: '0.1.0' }, null, 2),
    );
  }
  writeFileSync(path.join(root, 'LICENSE'), 'MIT\n');
  return root;
}

describe('bump-version.mjs', () => {
  let root;
  before(() => {
    root = makeWorkspace();
  });
  after(() => {
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it('rewrites every package.json with a `name` field', () => {
    const out = execFileSync('node', [SCRIPT, '0.2.0', '--root', root], { encoding: 'utf8' });
    for (const pkg of [
      'package.json',
      'packages/rdma-core/package.json',
      'packages/rdma-cli/package.json',
    ]) {
      const parsed = JSON.parse(readFileSync(path.join(root, pkg), 'utf8'));
      assert.equal(parsed.version, '0.2.0', pkg);
    }
    assert.equal(readFileSync(path.join(root, 'LICENSE'), 'utf8'), 'MIT\n');
    assert.match(out, /Bumped 3 package\.json file\(s\) to 0\.2\.0/);
  });

  it('refuses non-semver arguments without touching files', () => {
    const beforeContent = readFileSync(path.join(root, 'package.json'), 'utf8');
    let code = 0;
    try {
      execFileSync('node', [SCRIPT, 'banana', '--root', root], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      code = err.status ?? -1;
    }
    assert.notEqual(code, 0, 'expected non-zero exit on non-semver input');
    const afterContent = readFileSync(path.join(root, 'package.json'), 'utf8');
    assert.equal(afterContent, beforeContent, 'package.json should not have changed');
  });
});
