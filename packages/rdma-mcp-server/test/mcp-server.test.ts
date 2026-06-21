/**
 * Smoke tests for the rdma-mcp-server tool surface.
 *
 * We import `buildServer()` from the server module and drive the tool
 * callbacks directly (without connecting to stdio). Each tool returns
 * a `{ content: [{ type: 'text', text }] }` shape; we assert on the
 * `text` payload.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let storageRoot: string;
let shippedRoot: string;

before(() => {
  storageRoot = mkdtempSync(path.join(tmpdir(), 'rdma-mcp-storage-'));
  shippedRoot = mkdtempSync(path.join(tmpdir(), 'rdma-mcp-shipped-'));
  process.env.RDMA_STORAGE_ROOT = storageRoot;
  process.env.RDMA_SHIPPED_ROOT = shippedRoot;
});

after(() => {
  rmSync(storageRoot, { recursive: true, force: true });
  rmSync(shippedRoot, { recursive: true, force: true });
});

async function loadServer() {
  const url = new URL('../src/server.ts', import.meta.url);
  return import(url.pathname);
}

function freshStorage(): { storage: string; shipped: string; restore: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'rdma-mcp-storage-'));
  const ship = mkdtempSync(path.join(tmpdir(), 'rdma-mcp-shipped-'));
  const prevStorage = process.env.RDMA_STORAGE_ROOT;
  const prevShipped = process.env.RDMA_SHIPPED_ROOT;
  process.env.RDMA_STORAGE_ROOT = dir;
  process.env.RDMA_SHIPPED_ROOT = ship;
  return {
    storage: dir,
    shipped: ship,
    restore: () => {
      process.env.RDMA_STORAGE_ROOT = prevStorage;
      process.env.RDMA_SHIPPED_ROOT = prevShipped;
      rmSync(dir, { recursive: true, force: true });
      rmSync(ship, { recursive: true, force: true });
    },
  };
}

async function getTool(server, name) {
  // The MCP SDK stores registered tools on the McpServer instance
  // under `_registeredTools[name].handler`. The shape is internal but
  // stable across v1.x; we use it here purely for testing.
  const tools = server._registeredTools;
  if (!tools) {
    throw new Error(
      `server does not expose _registeredTools; available keys: ${Object.keys(server).join(',')}`,
    );
  }
  const entry = tools[name];
  if (!entry) {
    throw new Error(`tool not found: ${name}; available=${Object.keys(tools).join(',')}`);
  }
  if (typeof entry.handler !== 'function') {
    throw new Error(
      `tool ${name} has no callable handler; entry keys: ${Object.keys(entry).join(',')}`,
    );
  }
  return entry.handler;
}

describe('rdma-mcp-server tool surface', () => {
  it('exposes the 6 documented tools (rdma.deliver, list, show, status, step, reset)', async () => {
    const mod = await loadServer();
    const server = mod.buildServer();
    const names = Object.keys(server._registeredTools);
    for (const expected of [
      'rdma.deliver',
      'rdma.list',
      'rdma.show',
      'rdma.status',
      'rdma.step',
      'rdma.reset',
    ]) {
      assert.ok(names.includes(expected), `missing tool ${expected}; got ${names.join(', ')}`);
    }
  });

  it('rdma.deliver drives a proposal to delivered and reports the id', async () => {
    const fs = freshStorage();
    try {
      const mod = await loadServer();
      const server = mod.buildServer();
      const callback = await getTool(server, 'rdma.deliver');
      const result = await callback({
        title: 'MCP deliver smoke',
        requirement: 'A minimal requirement to exercise the tool surface.',
      });
      assert.ok(Array.isArray(result.content));
      const text = result.content.map((c) => c.text).join('\n');
      assert.match(text, /Delivered: P-/, 'expected delivered line');
    } finally {
      fs.restore();
    }
  });

  it('rdma.list returns "(no proposals)" on a fresh storage root', async () => {
    const fs = freshStorage();
    try {
      const mod = await loadServer();
      const server = mod.buildServer();
      const callback = await getTool(server, 'rdma.list');
      const result = await callback({});
      const text = result.content.map((c) => c.text).join('\n');
      assert.match(text, /\(no proposals\)/);
    } finally {
      fs.restore();
    }
  });

  it('rdma.status prints the system banner', async () => {
    const fs = freshStorage();
    try {
      const mod = await loadServer();
      const server = mod.buildServer();
      const callback = await getTool(server, 'rdma.status');
      const result = await callback({});
      const text = result.content.map((c) => c.text).join('\n');
      assert.match(text, /RDMA system status/);
    } finally {
      fs.restore();
    }
  });

  it('rdma.reset refuses without yes=true', async () => {
    const fs = freshStorage();
    try {
      const mod = await loadServer();
      const server = mod.buildServer();
      const callback = await getTool(server, 'rdma.reset');
      const result = await callback({ yes: false });
      const text = result.content.map((c) => c.text).join('\n');
      assert.match(text, /Refused: pass yes=true/);
    } finally {
      fs.restore();
    }
  });

  it('rdma.show + rdma.step round-trip a real proposal id', async () => {
    const fs = freshStorage();
    try {
      const mod = await loadServer();
      const server = mod.buildServer();
      const deliverCb = await getTool(server, 'rdma.deliver');
      const deliverResult = await deliverCb({
        title: 'MCP show+step smoke',
        requirement: 'A proposal whose id we will reuse for show + step.',
      });
      const text = deliverResult.content.map((c) => c.text).join('\n');
      const m = text.match(/Delivered: (P-[A-Z0-9-]+)/);
      assert.ok(m, `no proposal id in deliver output: ${text.slice(0, 200)}`);
      const id = m[1];

      const showCb = await getTool(server, 'rdma.show');
      const showResult = await showCb({ proposalId: id });
      const showText = showResult.content.map((c) => c.text).join('\n');
      assert.match(showText, new RegExp(id));
      assert.match(showText, /Artifacts/);

      // step on a delivered proposal should be a no-op (already terminal).
      const stepCb = await getTool(server, 'rdma.step');
      const stepResult = await stepCb({ proposalId: id });
      const stepText = stepResult.content.map((c) => c.text).join('\n');
      assert.match(stepText, new RegExp(id));
    } finally {
      fs.restore();
    }
  });
});
