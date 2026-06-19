/**
 * Tests for `rdma serve` — the long-running daemon that combines:
 *   - REST API (deliver / list / show)
 *   - WebSocket realtime bridge (subscribes to the same EventBus as Pipeline)
 *
 * Verifies the full loop:
 *   1. Start a server on an ephemeral port (port 0).
 *   2. POST /deliver → pipeline runs → events fan out on the WS.
 *   3. GET /proposals/:id returns the final proposal.
 *   4. WS client sees proposal.created + stage.transitioned events.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServe, type ServeHandle } from '../src/serve.js';
import { RealtimeClient } from '@rdma/realtime';

const handles: ServeHandle[] = [];
const dirs: string[] = [];

async function boot(): Promise<ServeHandle> {
  const storageRoot = mkdtempSync(path.join(tmpdir(), 'rdma-serve-test-'));
  const shippedRoot = mkdtempSync(path.join(tmpdir(), 'rdma-serve-shipped-'));
  dirs.push(storageRoot, shippedRoot);
  const h = await startServe({
    port: 0, // ask the OS for an ephemeral port
    host: '127.0.0.1',
    storage: 'json',
    useLlm: false,
    storageRoot,
    shippedRoot,
  });
  handles.push(h);
  return h;
}

async function postDeliver(
  port: number,
  body: { title: string; requirement: string; sourceUrl?: string; wait?: boolean },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = new URL(`http://127.0.0.1:${port}/deliver`);
  if (body.wait) url.searchParams.set('wait', '1');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: body.title,
      requirement: body.requirement,
      ...(body.sourceUrl ? { sourceUrl: body.sourceUrl } : {}),
    }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('rdma serve', () => {
  after(async () => {
    for (const h of handles) await h.shutdown();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('GET /health returns ok', async () => {
    const h = await boot();
    const res = await fetch(`http://127.0.0.1:${h.port}/health`);
    const json = (await res.json()) as { status: string; backend: string };
    assert.equal(res.status, 200);
    assert.equal(json.status, 'ok');
    assert.match(json.backend, /^json:/);
  });

  it('POST /deliver (sync) drives a proposal to delivered', async () => {
    const h = await boot();
    const { status, json } = await postDeliver(h.port, {
      title: 'Serve smoke',
      requirement: 'A small proposal that proves the HTTP deliver endpoint works end to end.',
      wait: true,
    });
    assert.equal(status, 200);
    assert.equal(json['status'], 'delivered');
    assert.ok(typeof json['id'] === 'string');
  });

  it('POST /deliver (async) returns 202 and the proposal eventually shows up', async () => {
    const h = await boot();
    const { status, json } = await postDeliver(h.port, {
      title: 'Async deliver',
      requirement: 'A proposal submitted in fire-and-forget mode.',
    });
    assert.equal(status, 202);
    const id = json['id'] as string;
    assert.ok(id);

    // Wait for the pipeline to finish.
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      const res = await fetch(`http://127.0.0.1:${h.port}/proposals/${id}`);
      if (res.ok) {
        const detail = (await res.json()) as { status: string };
        if (detail.status === 'delivered') {
          assert.equal(detail.status, 'delivered');
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail('proposal did not reach delivered within 10s');
  });

  it('GET /proposals lists everything that has been delivered', async () => {
    const h = await boot();
    await postDeliver(h.port, {
      title: 'Listed A',
      requirement: 'A first proposal.',
      wait: true,
    });
    await postDeliver(h.port, {
      title: 'Listed B',
      requirement: 'A second proposal.',
      wait: true,
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/proposals`);
    const list = (await res.json()) as Array<{ id: string; title: string }>;
    const titles = list.map((p) => p.title);
    assert.ok(titles.includes('Listed A'));
    assert.ok(titles.includes('Listed B'));
  });

  it('WebSocket clients see realtime events from the pipeline', async () => {
    const h = await boot();
    const client = new RealtimeClient({ url: `ws://127.0.0.1:${h.port}/ws` });
    await client.ready();
    const events: string[] = [];
    client.onAny((e) => events.push(e.kind));

    await postDeliver(h.port, {
      title: 'Realtime over WS',
      requirement: 'A proposal whose events we observe on the WebSocket.',
      wait: true,
    });
    await new Promise((r) => setTimeout(r, 200));
    client.close();

    assert.ok(events.includes('proposal.created'), `missing proposal.created: ${events.join(',')}`);
    assert.ok(events.includes('stage.transitioned'), `missing stage.transitioned: ${events.join(',')}`);
    assert.ok(events.includes('audit.appended'), `missing audit.appended: ${events.join(',')}`);
  });

  it('GET /proposals/:id returns 404 for unknown ids', async () => {
    const h = await boot();
    const res = await fetch(`http://127.0.0.1:${h.port}/proposals/P-does-not-exist`);
    assert.equal(res.status, 404);
  });
});
