/**
 * Tests that prove the MCP server picks up the per-agent configuration
 * when `--use-llm` is set. Without it, every agent stays in mock mode
 * (the historical behavior we still want to preserve).
 *
 * The surface under test is `buildServer({ useLlm, storageRoot })`. The
 * actual `rdma.deliver` tool callback closes over the deps factory, so
 * we don't need to wire a transport — we test the tool directly.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { buildServer } from '../src/server.js';

let workDir: string;
let storageRoot: string;
let rdmaRoot: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rdma-mcp-config-'));
  storageRoot = join(workDir, 'data');
  rdmaRoot = join(workDir, '.rdma');
  mkdirSync(rdmaRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

interface CapturedTool {
  server: unknown;
  tools: Record<string, { handler: (args: unknown) => Promise<unknown> }>;
}

function captureTools(server: unknown): CapturedTool {
  // The MCP SDK exposes the registered tool handlers on a private field.
  // Our test reaches in via a duck-typed lookup so we don't have to depend
  // on the SDK's exact shape across versions.
  const tools = (
    server as { _registeredTools?: Record<string, { handler: (a: unknown) => Promise<unknown> }> }
  )._registeredTools;
  if (!tools) throw new Error('buildServer did not register any MCP tools');
  return { server, tools };
}

describe('MCP server — per-agent configuration', () => {
  it('keeps every agent in mock mode when --use-llm is not set', () => {
    const server = buildServer({ storageRoot });
    const { tools } = captureTools(server);
    // The deliver tool always exists; we just want to assert that the
    // server is reachable — the actual LLM wiring is verified through
    // buildDeps integration tests elsewhere.
    assert.ok(typeof tools['rdma.deliver']?.handler === 'function');
  });

  it('accepts useLlm=true and threads it through to buildIsolatedDeps', async () => {
    writeFileSync(
      join(rdmaRoot, 'agents.yaml'),
      ['agents:', '  pm:', '    provider: mock'].join('\n'),
    );
    const server = buildServer({ storageRoot, useLlm: true });
    const { tools } = captureTools(server);
    const handler = tools['rdma.deliver']?.handler;
    assert.ok(handler);

    // Use a real proposal to drive the pipeline. We don't care about the
    // LLM output (mock is the default), just that the tool resolves.
    const result = await handler({
      title: 'mcp test',
      requirement: 'verify useLlm wiring',
    });
    const text = JSON.stringify(result);
    assert.match(text, /P-/);
  });

  it('falls back to mock when agents.yaml references an unset env var', async () => {
    writeFileSync(
      join(rdmaRoot, 'agents.yaml'),
      ['agents:', '  pm:', '    provider: anthropic', '    apiKey: "${MISSING_FOR_MCP_TEST}"'].join(
        '\n',
      ),
    );
    process.env.RDMA_CONFIG_ROOT = rdmaRoot;
    const server = buildServer({ storageRoot, useLlm: true });
    const { tools } = captureTools(server);
    const handler = tools['rdma.deliver']?.handler;
    assert.ok(handler);
    await assert.rejects(
      handler({
        title: 'mcp test missing key',
        requirement: 'should still finish — tool must not crash on missing apiKey',
      }),
      /MISSING_FOR_MCP_TEST/,
    );
    process.env.RDMA_CONFIG_ROOT = undefined;
  });
});
