import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';

import { cmdSandboxApply, parseSandboxApplyArgs } from '../src/sandbox-cmd.js';

function makeIo() {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      stdoutChunks.push(Buffer.from(chunk));
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      stderrChunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return {
    io: { stdout, stderr, exit: (() => undefined) as never },
    stdoutText: () => Buffer.concat(stdoutChunks).toString('utf8'),
    stderrText: () => Buffer.concat(stderrChunks).toString('utf8'),
  };
}

describe('rdma sandbox apply', () => {
  it('parses --workspace-root --proposal --files=... flags', () => {
    const parsed = parseSandboxApplyArgs([
      '--workspace-root',
      '/tmp/rdma-workspaces',
      '--proposal',
      'P-20260622-001',
      '--files',
      'src/index.ts=export const x = 1;\n',
      '--files',
      'README.md=# sandbox\n',
      '--test-command',
      'npm test',
    ]);

    assert.equal(parsed.workspaceRoot, '/tmp/rdma-workspaces');
    assert.equal(parsed.proposalId, 'P-20260622-001');
    assert.equal(parsed.testCommand, 'npm test');
    assert.deepEqual(parsed.files, [
      { path: 'src/index.ts', content: 'export const x = 1;\n' },
      { path: 'README.md', content: '# sandbox\n' },
    ]);
  });

  it('writes files inside the sandbox and prints a patch bundle summary', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-cli-sandbox-'));
    try {
      const proposalDir = path.join(root, 'PRJ-20260621-001', 'P-20260622-001');
      mkdirSync(proposalDir, { recursive: true });
      writeFileSync(
        path.join(proposalDir, 'meta.json'),
        JSON.stringify({ proposalId: 'P-20260622-001', projectId: 'PRJ-20260621-001' }),
      );

      const { io, stdoutText } = makeIo();
      await cmdSandboxApply(
        [
          '--workspace-root',
          root,
          '--proposal',
          'P-20260622-001',
          '--project',
          'PRJ-20260621-001',
          '--files',
          'src/index.ts=export const answer = 42;\n',
          '--test-command',
          'npm test',
        ],
        io,
      );

      const written = readFileSync(path.join(proposalDir, 'src/index.ts'), 'utf8');
      assert.equal(written, 'export const answer = 42;\n');
      assert.match(stdoutText(), /sandbox applied/);
      assert.match(stdoutText(), /P-20260622-001/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects paths that escape the sandbox', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-cli-sandbox-'));
    try {
      const { io, stderrText } = makeIo();
      await cmdSandboxApply(
        [
          '--workspace-root',
          root,
          '--proposal',
          'P-20260622-001',
          '--project',
          'PRJ-20260621-001',
          '--files',
          '../escape.txt=oops',
          '--test-command',
          'npm test',
        ],
        io,
      );
      assert.match(stderrText(), /outside sandbox/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
