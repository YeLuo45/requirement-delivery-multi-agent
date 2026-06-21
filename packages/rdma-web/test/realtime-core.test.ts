/**
 * Tests for the realtime WebSocket helpers. We exercise the pure
 * functions (`parseRealtimeFrame`, `defaultRealtimeUrl`) and the
 * connection factory (`createRealtimeConnection`) by stubbing
 * `globalThis.WebSocket` with a small in-memory fake. No React or
 * jsdom needed — that keeps the test fast and deterministic.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const webRoot = new URL('..', import.meta.url).pathname;
function pathJoin(...parts) {
  return parts.join('/');
}

const { parseRealtimeFrame, createRealtimeConnection } = require(
  pathJoin(webRoot, 'src/realtime-core.ts'),
);
const { defaultRealtimeUrl } = require(pathJoin(webRoot, 'src/use-realtime.ts'));

// ---------- Fake WebSocket ----------
class FakeWebSocket {
  static instances = [];
  static reset() {
    FakeWebSocket.instances = [];
  }
  url;
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  sent = [];
  closed = false;
  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(String(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    if (this.onclose) this.onclose(new Event('close'));
  }
  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen(new Event('open'));
  }
  deliverMessage(payload) {
    if (this.onmessage) {
      this.onmessage({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
    }
  }
}

const origWebSocket = globalThis.WebSocket;
globalThis.WebSocket = FakeWebSocket;
beforeEach(() => FakeWebSocket.reset());
after(() => {
  globalThis.WebSocket = origWebSocket;
});

describe('parseRealtimeFrame()', () => {
  it('returns an event frame for a valid payload', () => {
    const frame = parseRealtimeFrame(
      JSON.stringify({
        type: 'event',
        event: {
          kind: 'proposal.created',
          proposalId: 'P-1',
          projectId: 'PRJ-1',
          at: '2026-06-20T00:00:00Z',
        },
      }),
    );
    assert.equal(frame?.type, 'event');
    if (frame?.type === 'event') {
      assert.equal(frame.event.kind, 'proposal.created');
    }
  });

  it('returns null for malformed JSON', () => {
    assert.equal(parseRealtimeFrame('not json'), null);
  });

  it('returns null for a non-object payload', () => {
    assert.equal(parseRealtimeFrame(JSON.stringify('string')), null);
    assert.equal(parseRealtimeFrame(JSON.stringify(42)), null);
    assert.equal(parseRealtimeFrame(JSON.stringify(null)), null);
  });

  it('returns null for an event with missing fields', () => {
    const bad = parseRealtimeFrame(JSON.stringify({ type: 'event', event: { kind: 'x' } }));
    assert.equal(bad, null);
  });

  it('returns null for a non-event frame (e.g. arraybuffer)', () => {
    assert.equal(parseRealtimeFrame(new TextEncoder().encode('hi').buffer), null);
  });

  it('returns a hello frame for the protocol hello message', () => {
    const frame = parseRealtimeFrame(
      JSON.stringify({ type: 'hello', serverTime: '2026-06-20T00:00:00Z' }),
    );
    assert.equal(frame?.type, 'hello');
  });

  it('returns a ping frame for keepalive messages', () => {
    assert.equal(parseRealtimeFrame(JSON.stringify({ type: 'ping' }))?.type, 'ping');
  });

  it('returns null for unknown frame types', () => {
    assert.equal(parseRealtimeFrame(JSON.stringify({ type: 'unknown' })), null);
  });
});

describe('createRealtimeConnection()', () => {
  it('opens the socket, subscribes on open, and routes messages', () => {
    const events = [];
    let opened = false;
    const onMessage = (raw) => {
      const frame = parseRealtimeFrame(raw);
      if (frame?.type === 'event') events.push(frame.event);
    };
    let closed = false;
    const onClose = () => {
      closed = true;
    };

    const conn = createRealtimeConnection({
      url: 'ws://localhost:47555',
      kinds: ['proposal.created'],
      onOpen: () => {
        opened = true;
      },
      onMessage,
      onClose,
    });
    const sock = FakeWebSocket.instances[0];
    assert.ok(sock, 'expected a socket to be opened');
    // Drive the socket through the lifecycle. The factory wires
    // `onopen` itself, so we just trigger it.
    sock.open();
    assert.equal(opened, true);
    assert.equal(sock.sent.length, 1);
    assert.match(sock.sent[0], /"subscribe".*"kinds".*\[.*"proposal.created".*\]/);
    sock.deliverMessage({
      type: 'event',
      event: {
        kind: 'proposal.created',
        proposalId: 'P-1',
        projectId: 'PRJ-1',
        at: '2026-06-20T00:00:00Z',
      },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'proposal.created');
    // A non-string frame is ignored.
    sock.deliverMessage({ data: new Uint8Array([1, 2, 3]) });
    assert.equal(events.length, 1);
    // Server-side close fires onClose.
    sock.close();
    assert.equal(closed, true);
    conn.close();
  });

  it('fires onClose when the server closes the socket', () => {
    let closed = false;
    const conn = createRealtimeConnection({
      url: 'ws://localhost:47555',
      kinds: [],
      onOpen: () => undefined,
      onMessage: () => undefined,
      onClose: () => {
        closed = true;
      },
    });
    FakeWebSocket.instances[0].close();
    assert.equal(closed, true);
  });

  it('falls back to onClose when WebSocket is missing (SSR-like env)', async () => {
    const saved = globalThis.WebSocket;
    // Strip both the global and the per-connection ctor lookup.
    // The factory consults `globalThis.WebSocket` at call time, so
    // deleting it triggers the no-WebSocket branch.
    globalThis.WebSocket = undefined;
    let closed = false;
    const conn = createRealtimeConnection({
      url: 'ws://localhost:47555',
      kinds: [],
      onOpen: () => undefined,
      onMessage: () => undefined,
      onClose: () => {
        closed = true;
      },
    });
    // close() is a no-op because no socket was created.
    assert.doesNotThrow(() => conn.close());
    // onClose fires via setTimeout(0). Wait a couple of macrotasks
    // because Node 20+ delays setTimeout(0) callbacks until after
    // the current event loop iteration completes.
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(closed, true);
    globalThis.WebSocket = saved;
  });
});

describe('defaultRealtimeUrl()', () => {
  it('returns ws:// when window.location.protocol is http:', () => {
    globalThis.window = { location: { protocol: 'http:', hostname: 'rdma.local' } };
    assert.equal(defaultRealtimeUrl(), 'ws://rdma.local:47555');
  });

  it('returns wss:// when window.location.protocol is https:', () => {
    globalThis.window = { location: { protocol: 'https:', hostname: 'rdma.example' } };
    assert.equal(defaultRealtimeUrl(), 'wss://rdma.example:47555');
  });

  it('returns "" when window is undefined (SSR)', () => {
    const prev = globalThis.window;
    globalThis.window = undefined;
    assert.equal(defaultRealtimeUrl(), '');
    globalThis.window = prev;
  });
});
