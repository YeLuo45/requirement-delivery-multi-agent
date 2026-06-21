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

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { RealtimeClient } from '@rdma/realtime';
import { type ServeHandle, startServe } from '../src/serve.js';

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
    assert.equal(json.status, 'delivered');
    assert.ok(typeof json.id === 'string');
  });

  it('POST /deliver (async) returns 202 and the proposal eventually shows up', async () => {
    const h = await boot();
    const { status, json } = await postDeliver(h.port, {
      title: 'Async deliver',
      requirement: 'A proposal submitted in fire-and-forget mode.',
    });
    assert.equal(status, 202);
    const id = json.id as string;
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
    assert.ok(
      events.includes('stage.transitioned'),
      `missing stage.transitioned: ${events.join(',')}`,
    );
    assert.ok(events.includes('audit.appended'), `missing audit.appended: ${events.join(',')}`);
  });

  it('GET /proposals/:id returns 404 for unknown ids', async () => {
    const h = await boot();
    const res = await fetch(`http://127.0.0.1:${h.port}/proposals/P-does-not-exist`);
    assert.equal(res.status, 404);
  });
});

describe('rdma serve inspect + events (E5)', () => {
  after(async () => {
    for (const h of handles) await h.shutdown();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('GET /inspect/:id returns proposal + handoffChain + auditTimeline', async () => {
    const h = await boot();
    const { json: created } = await postDeliver(h.port, {
      title: 'Inspect me',
      requirement: 'A proposal that the inspect endpoint renders as JSON.',
      wait: true,
    });
    const id = created.id as string;
    const res = await fetch(`http://127.0.0.1:${h.port}/inspect/${id}`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      proposal: { id: string; status: string; artifacts: unknown[] };
      handoffChain: string[];
      auditTimeline: Array<{ kind: string; parseable: boolean }>;
    };
    assert.equal(data.proposal.id, id);
    assert.equal(data.proposal.status, 'delivered');
    assert.ok(data.proposal.artifacts.length > 0);
    assert.ok(data.handoffChain.length > 0);
    assert.ok(data.auditTimeline.length > 0);
    assert.ok(data.auditTimeline.every((e) => e.parseable));
  });

  it('GET /inspect/:id returns 404 for unknown proposal', async () => {
    const h = await boot();
    const res = await fetch(`http://127.0.0.1:${h.port}/inspect/P-unknown`);
    assert.equal(res.status, 404);
  });

  it('GET /events?proposal=<id> returns the audit-derived event stream', async () => {
    const h = await boot();
    const { json: created } = await postDeliver(h.port, {
      title: 'Events me',
      requirement: 'A proposal whose events we observe via the events endpoint.',
      wait: true,
    });
    const id = created.id as string;
    const res = await fetch(`http://127.0.0.1:${h.port}/events?proposal=${id}&limit=200`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      count: number;
      events: Array<{ proposalId: string; kind: string; parseable: boolean }>;
      proposalFilter: string | null;
    };
    assert.ok(data.count > 0);
    assert.equal(data.proposalFilter, id);
    assert.ok(data.events.every((e) => e.proposalId === id));
    assert.ok(data.events.some((e) => e.kind === 'agent.handle.start'));
    assert.ok(data.events.some((e) => e.kind === 'agent.handle.end'));
  });

  it('GET /events without proposal filter returns events across all proposals', async () => {
    const h = await boot();
    await postDeliver(h.port, {
      title: 'All events A',
      requirement: 'first.',
      wait: true,
    });
    await postDeliver(h.port, {
      title: 'All events B',
      requirement: 'second.',
      wait: true,
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/events?limit=200`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      count: number;
      proposalFilter: string | null;
    };
    assert.ok(data.count > 0);
    assert.equal(data.proposalFilter, null);
  });

  it('GET /events?proposal=<unknown> returns 404', async () => {
    const h = await boot();
    const res = await fetch(`http://127.0.0.1:${h.port}/events?proposal=P-nope`);
    assert.equal(res.status, 404);
  });

  it('GET /events?limit=0 returns 400', async () => {
    const h = await boot();
    const res = await fetch(`http://127.0.0.1:${h.port}/events?limit=0`);
    assert.equal(res.status, 400);
  });

  it('GET /events?since-seq=-1 returns 400', async () => {
    const h = await boot();
    const res = await fetch(`http://127.0.0.1:${h.port}/events?since-seq=-1`);
    assert.equal(res.status, 400);
  });
});

describe('rdma serve observability endpoints (F5)', () => {
  const handles: ServeHandle[] = [];
  const dirs: string[] = [];
  async function bootF5(): Promise<ServeHandle> {
    const storageRoot = mkdtempSync(path.join(tmpdir(), 'rdma-serve-obs-'));
    const shippedRoot = mkdtempSync(path.join(tmpdir(), 'rdma-serve-obs-shipped-'));
    dirs.push(storageRoot, shippedRoot);
    const h = await startServe({
      port: 0,
      host: '127.0.0.1',
      storage: 'json',
      useLlm: false,
      storageRoot,
      shippedRoot,
    });
    handles.push(h);
    return h;
  }
  after(async () => {
    for (const h of handles) await h.shutdown();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('GET /metrics returns the Prometheus exposition', async () => {
    const h = await bootF5();
    const res = await fetch(`http://127.0.0.1:${h.port}/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
    const body = await res.text();
    // Walk the pipeline once so the counters + timings have data.
    await postDeliver(h.port, {
      title: 'metrics over HTTP',
      requirement: 'Ensure metrics have at least one sample before we read.',
      wait: true,
    });
    const after = await fetch(`http://127.0.0.1:${h.port}/metrics`);
    const afterBody = await after.text();
    assert.match(afterBody, /# HELP agent_handle_start/);
    assert.match(afterBody, /# TYPE agent_handle_start counter/);
    assert.match(afterBody, /# TYPE agent_handle_seconds summary/);
    // The first call (no pipeline yet) might print the empty-snapshot
    // sentinel — both forms are valid HTTP output, so we just check
    // status + content-type and assert structure on the post-walk body.
    assert.match(body, /(no metrics recorded yet|# HELP)/);
  });

  it('GET /traces returns the last N spans as JSON', async () => {
    const h = await bootF5();
    await postDeliver(h.port, {
      title: 'trace over HTTP',
      requirement: 'Need at least one span on the exporter.',
      wait: true,
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/traces?limit=10`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      count: number;
      spans: Array<{ name: string; status: string; attributes: Record<string, unknown> }>;
    };
    assert.ok(data.count > 0, 'expected at least one span after a pipeline walk');
    assert.ok(data.spans.some((s) => s.name === 'agent.handle'));
  });

  it('GET /traces?limit=0 returns 400', async () => {
    const h = await bootF5();
    const res = await fetch(`http://127.0.0.1:${h.port}/traces?limit=0`);
    assert.equal(res.status, 400);
  });
});
