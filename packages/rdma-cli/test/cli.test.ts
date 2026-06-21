/**
 * Tests for the RDMA CLI entry point (cli.ts).
 *
 * The CLI bootstrap runs `main()` at the bottom of the module, so the test
 * checks `process.argv[1]` resolves to the cli.ts file. We re-import the
 * module via `import('../src/cli.js')` and call `main()` directly, which
 * keeps the real process.exit untouchable.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

class MemoryStream extends Writable {
  chunks: string[] = [];
  override _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

interface CliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  exit: (code: number) => void;
}

interface CliModule {
  main: (
    args: string[],
    io?: CliIo,
    runFn?: (cmd: string, argv: string[]) => Promise<void>,
  ) => Promise<number>;
  printHelp: (out?: NodeJS.WritableStream) => void;
}

let cli: CliModule;
let storageRoot: string;
let shippedRoot: string;
const originalArgv1 = process.argv[1];

async function loadCli(): Promise<CliModule> {
  const mod = (await import(pathToCliFile())) as CliModule;
  return mod;
}

function pathToCliFile(): string {
  return new URL('../src/cli.ts', import.meta.url).pathname;
}

before(async () => {
  // Move process.argv[1] off the cli.ts file so the top-level
  // auto-runner stays inert during the test run.
  process.argv[1] = path.resolve(fileURLToPath(import.meta.url));
  storageRoot = mkdtempSync(path.join(tmpdir(), 'rdma-cli-test-storage-'));
  shippedRoot = mkdtempSync(path.join(tmpdir(), 'rdma-cli-test-shipped-'));
  process.env.RDMA_STORAGE_ROOT = storageRoot;
  process.env.RDMA_SHIPPED_ROOT = shippedRoot;
  cli = await loadCli();
});

after(() => {
  process.argv[1] = originalArgv1;
  rmSync(storageRoot, { recursive: true, force: true });
  rmSync(shippedRoot, { recursive: true, force: true });
});

function makeIo(): {
  io: CliIo;
  stdout: MemoryStream;
  stderr: MemoryStream;
  exitCode: { value: number | null };
} {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const exitCode = { value: null as number | null };
  const io: CliIo = {
    stdout,
    stderr,
    exit: (code) => {
      exitCode.value = code;
      throw new Error(`__exit__:${code}`);
    },
  };
  return { io, stdout, stderr, exitCode };
}

describe('rdma cli entry point', () => {
  it('prints help when invoked with no command', async () => {
    const { io, stdout, exitCode } = makeIo();
    const code = await cli.main([], io, async () => undefined);
    assert.equal(code, 0);
    assert.match(stdout.text(), /rdma — requirement-delivery-multi-agent CLI/);
    assert.match(stdout.text(), /rdma deliver/);
    assert.equal(exitCode.value, null);
  });

  it('prints help when invoked with help / --help / -h', async () => {
    for (const flag of ['help', '--help', '-h']) {
      const { io, stdout } = makeIo();
      const code = await cli.main([flag], io, async () => undefined);
      assert.equal(code, 0, `flag=${flag}`);
      assert.match(stdout.text(), /Usage:/, `flag=${flag}`);
    }
  });

  it('dispatches every known command to the supplied runner', async () => {
    const seen: Array<{ cmd: string; argv: string[] }> = [];
    const runFn = async (cmd: string, argv: string[]): Promise<void> => {
      seen.push({ cmd, argv });
    };
    const expected = [
      'deliver',
      'list',
      'ls',
      'show',
      'status',
      'reset',
      'demo',
      'serve',
      'inspect',
      'events',
    ];
    for (const cmd of expected) {
      const { io } = makeIo();
      const code = await cli.main([cmd, '--', 'extra'], io, runFn);
      assert.equal(code, 0, `cmd=${cmd}`);
    }
    assert.equal(seen.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
      assert.deepEqual(seen[i], { cmd: expected[i], argv: ['--', 'extra'] });
    }
  });

  it('rejects unknown commands with exit code 1 and a usage hint', async () => {
    const { io, stderr, exitCode } = makeIo();
    await assert.rejects(
      cli.main(['bogus'], io, async () => undefined),
      (err: Error) => err.message === '__exit__:1',
    );
    assert.match(stderr.text(), /Unknown command: bogus/);
    assert.match(stderr.text(), /Run `rdma help`/);
    assert.equal(exitCode.value, 1);
  });

  it('forwards runtime errors thrown by the runner to the caller', async () => {
    const { io } = makeIo();
    await assert.rejects(
      cli.main(['deliver', 'title'], io, async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
  });

  it('exposes the help text via printHelp() for direct calls', () => {
    const stdout = new MemoryStream();
    cli.printHelp(stdout);
    const out = stdout.text();
    assert.match(out, /rdma deliver/);
    assert.match(out, /rdma serve/);
    assert.match(out, /Examples:/);
  });
});
