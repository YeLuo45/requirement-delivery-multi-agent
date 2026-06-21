/**
 * Pure helpers for the realtime WebSocket protocol. These live outside
 * the React hook so they can be unit-tested without a renderer and
 * without jsdom — the test suite imports this module and feeds it
 * fakes.
 *
 * The hook (`useRealtime`) calls these:
 *   - `parseRealtimeFrame(raw)` — turn a text frame into either an
 *     event or null (silently drops malformed frames).
 *   - `createRealtimeConnection({ url, kinds, onOpen, onMessage, onClose })`
 *     — opens a `WebSocket`, subscribes, and routes events to the
 *     callbacks. The returned `close()` cleans up the socket.
 */

export interface RealtimeEvent {
  kind: string;
  proposalId: string;
  projectId: string;
  at: string;
  payload?: Record<string, unknown>;
}

export type RealtimeFrame =
  | { type: 'event'; event: RealtimeEvent }
  | { type: 'hello'; serverTime: string; backfill?: RealtimeEvent[] }
  | { type: 'ping' }
  | null;

/**
 * Parse a single WebSocket message. Returns the structured frame or
 * `null` if the payload isn't a valid realtime event. Malformed JSON
 * is intentionally swallowed — the protocol's other frame types
 * (hello, ping) carry no event payload, so the caller wants `null`
 * for them as well.
 */
export function parseRealtimeFrame(raw: string | ArrayBuffer | ArrayBufferView): RealtimeFrame {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as { type?: unknown; event?: unknown };
  if (obj.type === 'event' && obj.event && typeof obj.event === 'object') {
    const e = obj.event as {
      kind?: unknown;
      proposalId?: unknown;
      projectId?: unknown;
      at?: unknown;
    };
    if (
      typeof e.kind === 'string' &&
      typeof e.proposalId === 'string' &&
      typeof e.projectId === 'string' &&
      typeof e.at === 'string'
    ) {
      return {
        type: 'event',
        event: {
          kind: e.kind,
          proposalId: e.proposalId,
          projectId: e.projectId,
          at: e.at,
        },
      };
    }
    return null;
  }
  if (obj.type === 'hello' && typeof (parsed as { serverTime?: unknown }).serverTime === 'string') {
    return {
      type: 'hello',
      serverTime: (parsed as { serverTime: string }).serverTime,
    };
  }
  if (obj.type === 'ping') {
    return { type: 'ping' };
  }
  return null;
}

export interface CreateConnectionOptions {
  url: string;
  kinds: string[];
  onOpen: () => void;
  onMessage: (raw: string) => void;
  onClose: () => void;
}

export interface RealtimeConnection {
  close: () => void;
  /** The WebSocket that was created (exposed for tests). */
  socket: WebSocket;
}

type WebSocketLike = {
  send: (data: string) => void;
  close: () => void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
};

/**
 * Open a WebSocket and wire the supplied callbacks. The constructor
 * call is wrapped in a try/catch so callers that fail to resolve
 * `url` (e.g. invalid scheme) get a clean `onClose` instead of a
 * thrown exception. Returns a connection handle that closes the
 * underlying socket.
 */
export function createRealtimeConnection(opts: CreateConnectionOptions): RealtimeConnection {
  let socket: WebSocketLike;
  try {
    // We type the global WebSocket as `unknown` because the browser
    // bundle injects its own; the constructor returns a compatible
    // shape regardless of the host environment.
    const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
    if (!Ctor) {
      throw new Error('WebSocket is not available in this environment');
    }
    socket = new Ctor(opts.url);
  } catch {
    // Schedule close synchronously so callers can wire reconnection
    // via the `onClose` callback.
    setTimeout(opts.onClose, 0);
    // Return a stub connection — the caller treats close() as best-effort.
    return {
      socket: { send: () => undefined, close: () => undefined } as unknown as WebSocket,
      close: () => undefined,
    };
  }
  socket.onopen = () => {
    opts.onOpen();
    try {
      socket.send(JSON.stringify({ type: 'subscribe', kinds: opts.kinds }));
    } catch {
      // ignore — server may have already closed
    }
  };
  socket.onmessage = (ev) => {
    const data = ev.data;
    if (typeof data === 'string') {
      opts.onMessage(data);
    }
  };
  socket.onclose = () => opts.onClose();
  socket.onerror = () => {
    try {
      socket.close();
    } catch {
      // ignore
    }
  };
  return {
    socket: socket as unknown as WebSocket,
    close: () => {
      try {
        socket.close();
      } catch {
        // ignore
      }
    },
  };
}
