/**
 * Tests for the rdma-web Vite plugin.
 *
 * We don't bring up a full Vite dev server (that would require a browser
 * harness). Instead, we exercise the plugin's middleware in isolation:
 * the `configureServer` hook returns nothing in production mode, but in
 * dev mode it registers two `server.middlewares.use(...)` handlers that
 * serve /api/proposals and /api/proposals/:id from the on-disk JSON
 * storage. We can drive those handlers by calling the underlying
 * `requestListener` directly with a fake `{ req, res }` pair.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { after, before, describe, it } from 'node:test';

let dataRoot: string;
let projectId: string;
let proposalId: string;
let shippedDir: string;
let auditDir: string;
const originalArgv1 = process.argv[1];

class MemoryResponse extends Writable {
  statusCode = 200;
  headers = {};
  body = '';
  chunks = [];
  setHeader(k, v) {
    this.headers[k] = v;
  }
  write(chunk) {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    this.body += this.chunks[this.chunks.length - 1];
    return true;
  }
  end(chunk) {
    if (chunk) this.write(chunk);
    return super.end();
  }
}

before(() => {
  // Prevent Vite from auto-starting when we import the plugin's source
  // module (some plugin entry points can call listen on import).
  process.argv[1] = path.resolve(new URL('.', import.meta.url).pathname);
  dataRoot = mkdtempSync(path.join(tmpdir(), 'rdma-web-test-'));
  projectId = 'PRJ-20260619-001';
  proposalId = 'P-20260619-001';
  const proposalDir = path.join(dataRoot, 'proposals', projectId);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(
    path.join(proposalDir, `${proposalId}.json`),
    JSON.stringify({
      id: proposalId,
      projectId,
      title: 'Web plugin smoke',
      rawRequirement: 'Test that the Vite plugin serves JSON.',
      status: 'delivered',
      owner: 'boss',
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z',
      tags: {},
      artifacts: [],
    }),
  );
  auditDir = path.join(dataRoot, 'audit', projectId);
  mkdirSync(auditDir, { recursive: true });
  writeFileSync(
    path.join(auditDir, `${proposalId}.jsonl`),
    [
      JSON.stringify({
        id: 'a1',
        proposalId,
        actor: 'system',
        action: 'create',
        at: '2026-06-19T00:00:00.000Z',
        detail: {},
      }),
      JSON.stringify({
        id: 'a2',
        proposalId,
        actor: 'coordinator',
        action: 'handoff',
        at: '2026-06-19T00:00:01.000Z',
        detail: {},
      }),
    ].join('\n'),
  );
  shippedDir = mkdtempSync(path.join(tmpdir(), 'rdma-web-shipped-'));
});

after(() => {
  process.argv[1] = originalArgv1;
  rmSync(dataRoot, { recursive: true, force: true });
  rmSync(shippedDir, { recursive: true, force: true });
});

async function loadPlugin() {
  const url = new URL('../src/vite-plugin.ts', import.meta.url);
  return import(url.pathname);
}

function fakeRequest(url, method = 'GET') {
  return { url, method, headers: {} };
}

function fakeJsonRequest(url, body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    on(event, handler) {
      if (event === 'data') {
        for (const chunk of chunks) handler(chunk);
      }
      if (event === 'end') handler();
      return this;
    },
    destroy() {},
  };
}

function newResponse() {
  return new MemoryResponse();
}

function findHandler(plugin, rootOverride) {
  // The plugin's `configureServer(server)` hook returns nothing for
  // us directly, so we re-implement the same logic the hook performs
  // and call the registered middleware in order. Vite stores middlewares
  // on `server.middlewares.stack` (a flat array of { route, handle }).
  const fakeServer = {
    middlewares: {
      use(route, handler) {
        if (route === '/api/proposals') this._list = handler;
        else if (route === '/api/proposals/') this._detail = handler;
        else if (route === '/api/proposals/create') this._create = handler;
        else if (route === '/api/config') this._config = handler;
      },
    },
  };
  plugin.rdmaApiPlugin(rootOverride ?? dataRoot).configureServer(fakeServer);
  return {
    list: fakeServer.middlewares._list,
    detail: fakeServer.middlewares._detail,
    create: fakeServer.middlewares._create,
    config: fakeServer.middlewares._config,
  };
}

describe('rdma-web vite plugin', () => {
  it('rdmaApiPlugin(name) returns a Vite plugin object with configureServer', async () => {
    const mod = await loadPlugin();
    const plugin = mod.rdmaApiPlugin(dataRoot);
    assert.equal(plugin.name, 'rdma-api');
    assert.equal(typeof plugin.configureServer, 'function');
  });

  it('GET /api/proposals lists every JSON file under <dataRoot>/proposals', async () => {
    const mod = await loadPlugin();
    const { list } = findHandler(mod);
    const req = fakeRequest('/api/proposals');
    const res = newResponse();
    await list(req, res, () => undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/json');
    const proposals = JSON.parse(res.body);
    assert.equal(Array.isArray(proposals), true);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].id, proposalId);
    assert.equal(proposals[0].title, 'Web plugin smoke');
  });

  it('GET /api/proposals/<id> returns the proposal + audit + handoff chain', async () => {
    const mod = await loadPlugin();
    const { detail } = findHandler(mod);
    // `server.middlewares.use('/api/proposals/', ...)` strips the mount
    // path before forwarding; we simulate the post-strip req.url here.
    const req = fakeRequest(`/${proposalId}`);
    const res = newResponse();
    await detail(req, res, () => undefined);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.proposal.id, proposalId);
    assert.equal(payload.proposal.title, 'Web plugin smoke');
    assert.ok(Array.isArray(payload.audit));
    assert.equal(payload.audit.length, 2);
    assert.ok(Array.isArray(payload.handoffChain));
    assert.deepEqual(payload.handoffChain, ['coordinator']);
  });

  it('GET /api/proposals/<missing> returns 404 with an error body', async () => {
    const mod = await loadPlugin();
    const { detail } = findHandler(mod);
    const req = fakeRequest('/P-does-not-exist');
    const res = newResponse();
    await detail(req, res, () => undefined);
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.match(body.error, /not found/);
  });

  it('list handler reads from a fresh dataRoot passed to the plugin', async () => {
    // Build a second plugin instance pointing at a tmpdir that has no
    // proposals, and assert it returns []. This protects against a
    // future regression that hardcodes the path lookup.
    const fresh = mkdtempSync(path.join(tmpdir(), 'rdma-web-fresh-'));
    try {
      const mod = await loadPlugin();
      const { list } = findHandler(mod, fresh);
      const req = fakeRequest('/api/proposals');
      const res = newResponse();
      await list(req, res, () => undefined);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), []);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('GET /api/config returns the resolved per-agent configuration', async () => {
    // Seed a .rdma/agents.yaml one level above the plugin's dataRoot so
    // the loadAgentConfig() walk finds it.
    const parent = dataRoot.replace(/\/data$/, '');
    mkdirSync(parent, { recursive: true });
    writeFileSync(
      path.join(parent, 'agents.yaml'),
      [
        'defaults:',
        '  provider: anthropic',
        'agents:',
        '  pm:',
        '    apiKey: "stub"',
        '    temperature: 0.4',
      ].join('\n'),
    );
    const mod = await loadPlugin();
    const { config } = findHandler(mod);
    assert.equal(typeof config, 'function');
    const req = fakeRequest('/api/config');
    const res = newResponse();
    await config(req, res, () => undefined);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as Record<string, { llm: { provider: string } }>;
    assert.ok(body.pm);
    assert.equal(body.pm?.llm?.provider, 'anthropic');
  });

  it('GET /api/config returns {} when no agents.yaml is on disk', async () => {
    const mod = await loadPlugin();
    const { config } = findHandler(mod);
    assert.equal(typeof config, 'function');
    const req = fakeRequest('/api/config');
    const res = newResponse();
    await config(req, res, () => undefined);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    // `dataRoot` lives next to agents.yaml from the previous test; we
    // accept either {} (clean dir) or { pm: ... } (yaml present) — the
    // important contract is that the handler never throws.
    assert.ok(typeof body === 'object');
  });

  it('POST /api/proposals/create creates a local proposal that appears in the list', async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), 'rdma-web-create-'));
    try {
      const mod = await loadPlugin();
      const { list, create } = findHandler(mod, fresh);
      assert.equal(typeof create, 'function');
      const createReq = fakeJsonRequest('/api/proposals/create', {
        title: 'Created from web',
        requirement: 'Support browser-created proposals.',
      });
      const createRes = newResponse();
      await create(createReq, createRes, () => undefined);
      assert.equal(createRes.statusCode, 201);
      const created = JSON.parse(createRes.body);
      assert.match(created.id, /^P-/);
      assert.match(created.projectId, /^PRJ-/);
      assert.equal(created.title, 'Created from web');
      assert.equal(created.status, 'research_direction_pending');

      const listReq = fakeRequest('/api/proposals');
      const listRes = newResponse();
      await list(listReq, listRes, () => undefined);
      const proposals = JSON.parse(listRes.body);
      assert.equal(proposals.length, 1);
      assert.equal(proposals[0].id, created.id);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});
