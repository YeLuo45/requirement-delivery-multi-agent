/**
 * useRealtime — React hook that opens a WebSocket connection to the
 * RDMA realtime bridge and re-runs the supplied callback whenever a
 * pipeline event arrives.
 *
 * The hook is connection-state aware:
 *   - "connecting" — initial attempt
 *   - "open"       — receiving events
 *   - "closed"     — server unreachable; falls back to manual reload
 *
 * Uses the browser's native WebSocket (no `ws` package in the browser
 * bundle). Protocol matches @rdma/realtime/src/server.ts.
 *
 * Usage:
 *   const { status, lastEvent } = useRealtime({
 *     url: 'ws://127.0.0.1:47555',
 *     onEvent: () => refetch(),
 *   });
 */

import { useEffect, useState } from 'react';

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

export interface RealtimeEvent {
  kind: string;
  proposalId: string;
  projectId: string;
  at: string;
  payload?: Record<string, unknown>;
}

export interface UseRealtimeOptions {
  /** WebSocket URL. If omitted, the hook stays in "closed" state. */
  url?: string;
  /** Called for every event. */
  onEvent: (event: RealtimeEvent) => void;
  /** Event kinds to subscribe to. Empty = all. */
  kinds?: string[];
  /** Reconnect delay in ms (default 2000). */
  reconnectMs?: number;
}

export interface UseRealtimeResult {
  status: RealtimeStatus;
  lastEvent: RealtimeEvent | null;
}

export function useRealtime(opts: UseRealtimeOptions): UseRealtimeResult {
  const [status, setStatus] = useState<RealtimeStatus>(opts.url ? 'connecting' : 'closed');
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);

  useEffect(() => {
    if (!opts.url) {
      setStatus('closed');
      return;
    }
    let alive = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect(): void {
      if (!alive) return;
      try {
        socket = new WebSocket(opts.url!);
      } catch {
        scheduleReconnect();
        return;
      }
      setStatus('connecting');
      socket.onopen = () => {
        if (!alive) return;
        setStatus('open');
        const kinds = opts.kinds ?? [];
        socket?.send(JSON.stringify({ type: 'subscribe', kinds }));
      };
      socket.onmessage = (msg) => {
        if (!alive) return;
        try {
          const parsed = JSON.parse(String(msg.data)) as unknown;
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            (parsed as { type?: string }).type === 'event'
          ) {
            const ev = (parsed as { event: RealtimeEvent }).event;
            setLastEvent(ev);
            opts.onEvent(ev);
          }
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        if (!alive) return;
        setStatus('closed');
        scheduleReconnect();
      };
      socket.onerror = () => {
        try {
          socket?.close();
        } catch {
          // ignore
        }
      };
    }

    function scheduleReconnect(): void {
      if (!alive) return;
      reconnectTimer = setTimeout(connect, opts.reconnectMs ?? 2000);
    }

    connect();
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // ignore
      }
    };
    // We deliberately do not include `opts` in deps — consumers should
    // wrap the callback in useCallback or the options object in useMemo
    // if they need stable references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.url]);

  return { status, lastEvent };
}

/** Resolve the realtime WebSocket URL for the current page. */
export function defaultRealtimeUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.hostname}:47555`;
}
