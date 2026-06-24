import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { after, before, describe, it } from 'node:test';

import { rdmaApiPlugin } from '../src/vite-plugin.js';

class MemoryResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  body = '';
  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  write(chunk: string | Buffer): boolean {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this.chunks.push(text);
    this.body += text;
    return true;
  }
  end(chunk?: string | Buffer): this {
    if (chunk) this.write(chunk);
    return super.end();
  }
}

function dispatch(
  handler: (req: unknown, res: unknown) => unknown,
  url: string,
): Promise<MemoryResponse> {
  return new Promise((resolve) => {
    const res = new MemoryResponse();
    res.end();
    Promise.resolve()
      .then(() => handler({ url, method: 'GET', on() {} }, res))
      .then(() => resolve(res))
      .catch(() => resolve(res));
  });
}

let dataRoot: string;
let projectId: string;
let proposalId: string;
let plugin: ReturnType<typeof rdmaApiPlugin>;

before(() => {
  dataRoot = mkdtempSync(path.join(tmpdir(), 'rdma-web-control-'));
  projectId = 'PRJ-20260621-001';
  proposalId = 'P-20260621-001';
  const proposalDir = path.join(dataRoot, 'proposals', projectId);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(
    path.join(proposalDir, `${proposalId}.json`),
    JSON.stringify({
      id: proposalId,
      projectId,
      title: 'Control plane panel',
      rawRequirement: 'Seed for control-plane panel endpoint.',
      status: 'deployed',
      owner: 'boss',
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:00:00.000Z',
      tags: {},
      artifacts: [],
    }),
  );
  plugin = rdmaApiPlugin(dataRoot);
});

after(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('rdma-web control plane', () => {
  it('registers a /api/control-plane/panel handler that returns collaboration + cost summaries', async () => {
    const handlers: Array<{ path: string; fn: (req: unknown, res: unknown) => unknown }> = [];
    const fakeServer = {
      middlewares: {
        use(path: string, fn: (req: unknown, res: unknown) => void) {
          handlers.push({ path, fn });
        },
      },
    };
    const pluginApi = plugin as unknown as {
      configureServer: (s: unknown) => void;
    };
    pluginApi.configureServer(fakeServer);

    const target = handlers.find((handler) => handler.path === '/api/control-plane/panel');
    assert.ok(target, 'expected /api/control-plane/panel handler');

    const res = await dispatch(target.fn, '/api/control-plane/panel');
    const payload = JSON.parse(res.body);
    assert.deepEqual(payload.directions, [
      'A:delivery-sandbox',
      'B:collaboration',
      'C:tool-governance',
      'D:cost-router',
    ]);
    assert.match(payload.collaboration, /Collaboration/);
    assert.equal(typeof payload.cost, 'object');
  });

  it('registers a /api/operator handler that returns TUI parity metadata', async () => {
    const handlers: Array<{ path: string; fn: (req: unknown, res: unknown) => unknown }> = [];
    const fakeServer = {
      middlewares: {
        use(path: string, fn: (req: unknown, res: unknown) => void) {
          handlers.push({ path, fn });
        },
      },
    };
    const pluginApi = plugin as unknown as {
      configureServer: (s: unknown) => void;
    };
    pluginApi.configureServer(fakeServer);

    const target = handlers.find((handler) => handler.path === '/api/operator');
    assert.ok(target, 'expected /api/operator handler');

    const res = await dispatch(target.fn, '/api/operator');
    const payload = JSON.parse(res.body);
    assert.equal(payload.totalProposals, 1);
    assert.deepEqual(
      payload.capabilities.map((capability: { tuiCommand: string }) => capability.tuiCommand),
      ['list', 'show <id>', 'config', 'new', 'control-plane'],
    );
  });
});
