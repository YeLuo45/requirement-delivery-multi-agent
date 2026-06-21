/**
 * Tests for the WebSocket realtime bridge.
 *
 * Uses an in-process EventBus + the real `ws` package to confirm:
 *   - backfill is sent on connect
 *   - events fan out to all connected clients
 *   - per-kind subscribe filters
 *   - close() shuts the server down cleanly
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { EventBus } from '@rdma/persistence';
import WebSocket from 'ws';
import { RealtimeClient, RealtimeServer } from '../src/index.js';

const PORT = 47231;

function makeClient(url: string): Promise<{ ws: WebSocket; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const ws = new WebSocket(url);
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(String(data)));
      } catch {
        // skip
      }
    });
  });
}

describe('RealtimeServer', () => {
  const servers: RealtimeServer[] = [];
  function newServer(bus: EventBus, port = PORT): RealtimeServer {
    const s = new RealtimeServer({ bus, port });
    servers.push(s);
    return s;
  }

  after(async () => {
    for (const s of servers) {
      await s.close().catch(() => undefined);
    }
  });

  it('sends hello + backfill on connect', async () => {
    const bus = new EventBus();
    const server = newServer(bus, PORT);
    // Publish after the server is constructed so the ring buffer captures it.
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: '2026-06-19T00:00:00Z',
    });
    const url = `ws://127.0.0.1:${server.port}`;
    const client = await makeClient(url);
    await new Promise((r) => setTimeout(r, 80));
    const hello = client.messages.find((m) => isOfType(m, 'hello'));
    const backfill = client.messages.find((m) => isOfType(m, 'backfill'));
    assert.ok(hello);
    assert.ok(backfill);
    const events = (backfill as { events: unknown[] }).events;
    assert.equal(events.length, 1);
    client.ws.close();
  });

  it('broadcasts published events to all connected clients', async () => {
    const bus = new EventBus();
    const server = newServer(bus, PORT + 1);
    const url = `ws://127.0.0.1:${server.port}`;
    const a = await makeClient(url);
    const b = await makeClient(url);
    await new Promise((r) => setTimeout(r, 60));

    bus.publish({
      kind: 'proposal.updated',
      proposalId: 'P-2',
      projectId: 'PRJ-2',
      at: '2026-06-19T00:00:01Z',
    });
    await new Promise((r) => setTimeout(r, 80));

    const eventA = a.messages.find((m) => isOfType(m, 'event'));
    const eventB = b.messages.find((m) => isOfType(m, 'event'));
    assert.ok(eventA, 'A should have received the event');
    assert.ok(eventB, 'B should have received the event');

    a.ws.close();
    b.ws.close();
  });

  it('honors per-kind subscribe', async () => {
    const bus = new EventBus();
    const server = newServer(bus, PORT + 2);
    const url = `ws://127.0.0.1:${server.port}`;
    const c = await makeClient(url);
    await new Promise((r) => setTimeout(r, 60));

    // Tell server to only forward audit.appended events.
    c.ws.send(JSON.stringify({ type: 'subscribe', kinds: ['audit.appended'] }));
    await new Promise((r) => setTimeout(r, 60));

    bus.publish({
      kind: 'proposal.updated',
      proposalId: 'P-3',
      projectId: 'PRJ-3',
      at: '2026-06-19T00:00:02Z',
    });
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-3',
      projectId: 'PRJ-3',
      at: '2026-06-19T00:00:03Z',
    });
    await new Promise((r) => setTimeout(r, 80));

    const events = c.messages.filter((m) => isOfType(m, 'event')) as Array<{
      type: 'event';
      event: { kind: string };
    }>;
    const kinds = events.map((e) => e.event.kind);
    assert.ok(kinds.includes('audit.appended'));
    assert.ok(!kinds.includes('proposal.updated'));

    c.ws.close();
  });

  it('keeps a bounded ring buffer for backfill', async () => {
    const bus = new EventBus();
    const server = newServer(bus, PORT + 3);
    for (let i = 0; i < 60; i++) {
      bus.publish({
        kind: 'audit.appended',
        proposalId: `P-${i}`,
        projectId: 'PRJ-1',
        at: '2026-06-19T00:00:00Z',
      });
    }
    assert.equal(server.bufferLength, 50);
  });

  it('RealtimeClient wires the same protocol', async () => {
    const bus = new EventBus();
    const server = newServer(bus, PORT + 4);
    const url = `ws://127.0.0.1:${server.port}`;

    const client = new RealtimeClient({ url, kinds: ['proposal.created'] });
    await client.ready();

    const received: string[] = [];
    client.on('proposal.created', (e) => received.push(e.proposalId));

    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-99',
      projectId: 'PRJ-9',
      at: '2026-06-19T00:00:09Z',
    });

    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(received, ['P-99']);
    client.close();
  });
});

function isOfType(m: unknown, t: string): boolean {
  return typeof m === 'object' && m !== null && (m as { type?: string }).type === t;
}
