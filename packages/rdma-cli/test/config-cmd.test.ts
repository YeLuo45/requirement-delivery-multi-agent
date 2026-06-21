/**
 * Tests for the `rdma config` subcommand family.
 *
 * Surface under test:
 *   rdma config show [--all]  [<agent>]
 *   rdma config validate       <file-or-root>
 *   rdma config init           [--agent <id>] [--root <path>]
 *   rdma config path           [--root <path>]
 *
 * The CLI dispatch lives in `run.ts`; these tests cover the pure
 * functions so the wiring test stays small.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  cmdConfigInit,
  cmdConfigPath,
  cmdConfigShow,
  cmdConfigValidate,
  parseConfigArgs,
} from '../src/config-cmd.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rdma-config-cmd-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeAgentsYaml(contents: string): void {
  const rdmaRoot = join(workDir, '.rdma');
  mkdirSync(rdmaRoot, { recursive: true });
  writeFileSync(join(rdmaRoot, 'agents.yaml'), contents, 'utf8');
}

describe('parseConfigArgs', () => {
  it('parses flags only (no subcommand token — that lives in cmdXxx)', () => {
    const args = parseConfigArgs(['pm', '--all']);
    assert.deepEqual(args, {
      positional: ['pm'],
      flags: { all: true },
    });
  });

  it('parses --agent pm --root /tmp/x', () => {
    const args = parseConfigArgs(['--agent', 'pm', '--root', '/tmp/x']);
    assert.equal(args.flags.agent, 'pm');
    assert.equal(args.flags.root, '/tmp/x');
    assert.deepEqual(args.positional, []);
  });

  it('does not throw on empty argv (cmdXxx sets the subcommand)', () => {
    const args = parseConfigArgs([]);
    assert.deepEqual(args, { positional: [], flags: {} });
  });
});

describe('cmdConfigPath', () => {
  it('prints the resolved config root to stdout', async () => {
    writeAgentsYaml('agents: {}');
    const stdout: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      await cmdConfigPath([], { root: join(workDir, '.rdma') });
    } finally {
      process.stdout.write = original;
    }
    assert.match(stdout.join(''), new RegExp(join(workDir, '.rdma').replace(/\//g, '\\/')));
  });
});

describe('cmdConfigShow', () => {
  it('lists every configured agent when --all is set', async () => {
    writeAgentsYaml(
      [
        'agents:',
        '  pm:',
        '    provider: anthropic',
        '    apiKey: "stub"',
        '  dev:',
        '    provider: openai',
        '    apiKey: "stub"',
      ].join('\n'),
    );
    const stdout: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      await cmdConfigShow(['--all'], { root: join(workDir, '.rdma') });
    } finally {
      process.stdout.write = original;
    }
    assert.match(stdout.join(''), /pm/);
    assert.match(stdout.join(''), /dev/);
    assert.match(stdout.join(''), /anthropic/);
    assert.match(stdout.join(''), /openai/);
  });

  it('renders the resolved LLM config for a single agent', async () => {
    writeAgentsYaml(
      [
        'defaults:',
        '  provider: anthropic',
        '  model: claude-sonnet-4',
        '',
        'agents:',
        '  pm:',
        '    temperature: 0.2',
      ].join('\n'),
    );
    const stdout: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      await cmdConfigShow(['pm'], { root: join(workDir, '.rdma') });
    } finally {
      process.stdout.write = original;
    }
    const out = stdout.join('');
    assert.match(out, /pm/);
    assert.match(out, /provider:\s+anthropic/);
    assert.match(out, /model:\s+claude-sonnet-4/);
    assert.match(out, /temperature:\s+0\.2/);
  });

  it('throws when the requested agent has no configuration', async () => {
    writeAgentsYaml('agents: {}');
    await assert.rejects(
      cmdConfigShow(['unknown-agent'], { root: join(workDir, '.rdma') }),
      /no configuration/i,
    );
  });
});

describe('cmdConfigValidate', () => {
  it('returns 0 + a "valid" line when the YAML parses', async () => {
    writeAgentsYaml(['agents:', '  pm:', '    provider: mock'].join('\n'));
    const stdout: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await cmdConfigValidate([], { root: join(workDir, '.rdma') });
      assert.equal(code, 0);
    } finally {
      process.stdout.write = original;
    }
    assert.match(stdout.join(''), /valid/);
  });

  it('returns 1 + an error message when the YAML is malformed', async () => {
    writeAgentsYaml('this is not valid yaml: [\n');
    const stderr: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown): boolean => {
      stderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    let code = -1;
    try {
      code = await cmdConfigValidate([], { root: join(workDir, '.rdma') });
    } finally {
      process.stderr.write = original;
    }
    assert.equal(code, 1);
    assert.match(stderr.join(''), /invalid/i);
  });

  it('returns 0 with a warning when no config files exist', async () => {
    let code = -1;
    const stderr: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown): boolean => {
      stderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      code = await cmdConfigValidate([], { root: join(workDir, '.rdma') });
    } finally {
      process.stderr.write = original;
    }
    assert.equal(code, 0);
    assert.match(stderr.join(''), /no agents.yaml/i);
  });
});

describe('cmdConfigInit', () => {
  it('creates agents.yaml at the resolved root when missing', async () => {
    const target = join(workDir, '.rdma');
    mkdirSync(target, { recursive: true });
    const code = await cmdConfigInit(['--root', target]);
    assert.equal(code, 0);
    const onDisk = join(target, 'agents.yaml');
    const content = await readFile(onDisk, 'utf8');
    assert.match(content, /^defaults:/m);
    assert.match(content, /^agents:/m);
    assert.match(content, /^ {2}pm:/m);
  });

  it('does not overwrite an existing agents.yaml unless --force is set', async () => {
    writeAgentsYaml('agents:\n  pm:\n    provider: anthropic\n');
    const stderr: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown): boolean => {
      stderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    let code = -1;
    try {
      code = await cmdConfigInit([], { root: join(workDir, '.rdma') });
    } finally {
      process.stderr.write = original;
    }
    assert.equal(code, 1);
    assert.match(stderr.join(''), /already exists/i);
  });

  it('overwrites when --force is set', async () => {
    writeAgentsYaml('agents:\n  pm:\n    provider: anthropic\n');
    const code = await cmdConfigInit(['--force'], { root: join(workDir, '.rdma') });
    assert.equal(code, 0);
    const onDisk = await readFile(join(workDir, '.rdma', 'agents.yaml'), 'utf8');
    assert.match(onDisk, /defaults:/);
  });
});
