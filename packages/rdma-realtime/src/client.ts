/**
 * Minimal client-side helper around a WebSocket connection.
 *
 * Used by the web dashboard (and any other consumer that needs to subscribe
 * to realtime events). Keeps a queue of received events and a small set of
 * convenience methods (onAny, onKind, close).
 *
 * For the dashboard we don't want a full RxJS-style helper — we just want
 * to glue on(eventKind, fn) onto a WebSocket. This file stays small on
 * purpose.
 */

import type { Event, EventKind } from '@rdma/persistence';
import WebSocketImpl from 'ws';
import type { WebSocket as WsSocket } from 'ws';

export type RealtimeEventHandler = (event: Event) => void;

export interface RealtimeClientOptions {
  url: string;
  /** Event kinds to subscribe to. Empty = subscribe to all. */
  kinds?: Array<EventKind>;
  /** Connection opened. */
  onOpen?: () => void;
  /** Connection closed. */
  onClose?: (code: number, reason: string) => void;
}

/**
 * Lightweight event-bus wrapper around a WebSocket connection.
 *
 * Lifecycle:
 *   1. ctor() opens the WS and immediately sends a "subscribe" message.
 *   2. Server replies with "hello" + "backfill" → emitted through the bus.
 *   3. Subsequent "event" messages are emitted through the bus.
 *   4. close() sends a close frame and tears down.
 */
export class RealtimeClient {
  private readonly socket: WsSocket;
  private readonly listeners = new Map<EventKind, Set<RealtimeEventHandler>>();
  private readonly anyListeners = new Set<RealtimeEventHandler>();
  private openPromise: Promise<void> | null = null;

  constructor(opts: RealtimeClientOptions) {
    this.socket = new WebSocketImpl(opts.url) as unknown as WsSocket;
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.socket.on('open', () => {
        const kinds = opts.kinds ?? [];
        this.send({ type: 'subscribe', kinds });
        opts.onOpen?.();
        resolve();
      });
      this.socket.on('error', (err) => reject(err));
      this.socket.on('close', (code, reasonBuf) => {
        const reason = reasonBuf?.toString() ?? '';
        opts.onClose?.(code, reason);
      });
    });

    this.socket.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isServerMessage(parsed)) return;
      if (parsed.type === 'event') {
        const e = parsed.event;
        for (const fn of this.listeners.get(e.kind) ?? []) fn(e);
        for (const fn of this.anyListeners) fn(e);
      }
      // hello / backfill / pong are ignored by default; consumers can
      // re-derive backfill state by listening to "audit.appended" /
      // "proposal.updated" events as they arrive.
    });
  }

  /** Wait for the socket to open. */
  ready(): Promise<void> {
    return this.openPromise ?? Promise.resolve();
  }

  /** Subscribe to a specific event kind. Returns an unsubscribe function. */
  on(kind: EventKind, handler: RealtimeEventHandler): () => void {
    let set = this.listeners.get(kind);
    if (!set) {
      set = new Set();
      this.listeners.set(kind, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  /** Subscribe to every event (regardless of kind). */
  onAny(handler: RealtimeEventHandler): () => void {
    this.anyListeners.add(handler);
    return () => this.anyListeners.delete(handler);
  }

  /** Send a raw client message (e.g. ping). */
  send(payload: unknown): void {
    if (this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(payload));
  }

  /** Close the connection. */
  close(code = 1000, reason = 'client closing'): void {
    try {
      this.socket.close(code, reason);
    } catch {
      // ignore
    }
  }
}

interface ServerEvent {
  type: 'event';
  event: Event;
}
interface ServerBackfill {
  type: 'backfill';
  events: Event[];
}
interface ServerHello {
  type: 'hello';
  bufferSize: number;
}
interface ServerPong {
  type: 'pong';
  at: string;
}
type ServerMessage = ServerEvent | ServerBackfill | ServerHello | ServerPong;

function isServerMessage(x: unknown): x is ServerMessage {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as { type?: unknown }).type;
  return t === 'event' || t === 'backfill' || t === 'hello' || t === 'pong';
}
