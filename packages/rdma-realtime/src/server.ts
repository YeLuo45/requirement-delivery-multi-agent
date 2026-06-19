/**
 * Realtime bridge — exposes pipeline events over WebSocket.
 *
 * Architecture:
 *
 *   StorageDriver  ─┐
 *                   │   EventBus
 *   AuditLog       ─┤  ────────────►  RealtimeServer  ─────►  WS clients
 *                   │   (in-process)        │                     (web UI)
 *   Pipeline       ─┘                       │
 *                                           └─► ring buffer (recent events)
 *
 * The server is intentionally simple:
 *   - one WebSocketServer on a configurable port
 *   - subscribes to the in-process EventBus
 *   - fans out every event to every connected client
 *   - keeps a small ring buffer so new clients can backfill the last N events
 *
 * Why a ring buffer: when a dashboard first connects, it should see the
 * most recent activity (last few handoffs) so it doesn't start blank.
 *
 * Protocol (JSON over the WebSocket text frame):
 *   server → client  { type: "hello",   bufferSize: N }
 *   server → client  { type: "event",   event: Event }
 *   server → client  { type: "backfill", events: Event[] }   (right after hello)
 *   client → server  { type: "ping" }    →  server replies with { type: "pong" }
 *   client → server  { type: "subscribe", kinds: string[] }
 *                                  → restricts server-sent events to those kinds
 *
 * No auth in v0.1 — bind to localhost (default) and add a token check before
 * exposing publicly.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { Event, EventBus, EventKind, ALL_EVENTS } from '@rdma/persistence';

const ALL = '*' as typeof ALL_EVENTS;

export interface RealtimeServerOptions {
  /** Port to listen on. */
  port: number;
  /** Optional existing HTTP server to attach to (skip listening if provided). */
  httpServer?: HttpServer;
  /** EventBus to subscribe to. */
  bus: EventBus;
  /** Ring buffer size for backfill (default 50). */
  bufferSize?: number;
  /** If true, listen on 0.0.0.0 instead of 127.0.0.1. */
  expose?: boolean;
  /** Optional path filter — only accept WS upgrades at this path. Default "/". */
  path?: string;
}

interface ClientState {
  socket: WebSocket;
  subscribed: Set<EventKind | typeof ALL>;
}

export class RealtimeServer {
  private readonly wss: WebSocketServer;
  private readonly bus: EventBus;
  private readonly buffer: Event[] = [];
  private readonly bufferSize: number;
  private readonly clients = new Set<ClientState>();
  private readonly unsubscribers: Array<() => void> = [];
  private listening = false;
  private actualPort: number | null = null;

  constructor(opts: RealtimeServerOptions) {
    this.bus = opts.bus;
    this.bufferSize = opts.bufferSize ?? 50;

    this.wss = new WebSocketServer({
      port: opts.httpServer ? undefined : opts.port,
      server: opts.httpServer,
      path: opts.path,
    });

    if (opts.httpServer) {
      // When attached to an HTTP server we still report the httpServer's port
      // so callers can find it after construction.
      const addr = opts.httpServer.address();
      this.actualPort = typeof addr === 'object' && addr ? addr.port : null;
    } else {
      this.listening = true;
      // Capture the bound port synchronously — `ws` accepts the port option
      // eagerly, so by the time the constructor returns, address() resolves
      // to the real bound port (even if port=0 was requested).
      const addr = this.wss.address();
      this.actualPort = typeof addr === 'object' && addr ? addr.port : null;
      this.wss.on('listening', () => {
        const a = this.wss.address();
        this.actualPort = typeof a === 'object' && a ? a.port : null;
      });
    }

    this.wss.on('connection', (socket) => this.onConnection(socket));

    // Subscribe to every event kind we know about + the wildcard.
    this.bus.subscribe(ALL, (e) => this.broadcast(e));
  }

  /** Port the WS server is bound to (null until listening). */
  get port(): number | null {
    return this.actualPort;
  }

  /** Number of currently connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Number of events currently in the ring buffer. */
  get bufferLength(): number {
    return this.buffer.length;
  }

  /** Stop accepting new connections and close all existing clients. */
  close(): Promise<void> {
    for (const u of this.unsubscribers) u();
    for (const c of this.clients) {
      try {
        c.socket.close(1001, 'server shutting down');
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    return new Promise((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private onConnection(socket: WebSocket): void {
    const state: ClientState = { socket, subscribed: new Set([ALL]) };
    this.clients.add(state);

    // Send hello + backfill.
    this.send(state, { type: 'hello', bufferSize: this.bufferSize });
    this.send(state, { type: 'backfill', events: this.buffer.slice() });

    socket.on('message', (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return; // ignore malformed
      }
      if (!isClientMessage(msg)) return;
      switch (msg.type) {
        case 'ping':
          this.send(state, { type: 'pong', at: new Date().toISOString() });
          return;
        case 'subscribe': {
          state.subscribed = new Set(msg.kinds.length > 0 ? msg.kinds : [ALL]);
          return;
        }
      }
    });

    socket.on('close', () => {
      this.clients.delete(state);
    });
    socket.on('error', () => {
      try {
        socket.close();
      } catch {
        // ignore
      }
    });
  }

  private broadcast(event: Event): void {
    this.pushBuffer(event);
    for (const c of this.clients) {
      if (c.subscribed.has(ALL) || c.subscribed.has(event.kind)) {
        this.send(c, { type: 'event', event });
      }
    }
  }

  private pushBuffer(event: Event): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.splice(0, this.buffer.length - this.bufferSize);
    }
  }

  private send(client: ClientState, payload: unknown): void {
    if (client.socket.readyState !== 1 /* OPEN */) return;
    try {
      client.socket.send(JSON.stringify(payload));
    } catch {
      // swallow — clients can disappear mid-send
    }
  }
}

// --- Client-side message type (for ws.on('message', ...) handlers) ---

interface ClientPing {
  type: 'ping';
}
interface ClientSubscribe {
  type: 'subscribe';
  kinds: Array<EventKind | typeof ALL>;
}
type ClientMessage = ClientPing | ClientSubscribe;

function isClientMessage(x: unknown): x is ClientMessage {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as { type?: unknown }).type;
  if (t === 'ping') return true;
  if (t === 'subscribe') {
    const k = (x as { kinds?: unknown }).kinds;
    return Array.isArray(k) && k.every((s) => typeof s === 'string');
  }
  return false;
}

export type { Event, EventKind };
