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
 * Pure helpers (`parseRealtimeFrame`, `createRealtimeConnection`) live
 * in `./realtime-core.ts` so they can be unit-tested without React.
 *
 * Usage:
 *   const { status, lastEvent } = useRealtime({
 *     url: 'ws://127.0.0.1:47555',
 *     onEvent: () => refetch(),
 *   });
 */

import { useEffect, useState } from 'react';
import {
  type RealtimeConnection,
  type RealtimeFrame,
  createRealtimeConnection,
  parseRealtimeFrame,
} from './realtime-core.js';

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
  const url = opts.url;
  const kinds = opts.kinds;
  const onEvent = opts.onEvent;
  const reconnectMs = opts.reconnectMs;

  useEffect(() => {
    if (!url) {
      setStatus('closed');
      return;
    }
    let alive = true;
    let connection: RealtimeConnection | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handle = (frame: RealtimeFrame): void => {
      if (frame.type === 'event' && frame.event) {
        setLastEvent(frame.event);
        onEvent(frame.event);
      }
    };

    const open = (): void => {
      if (!alive) return;
      try {
        connection = createRealtimeConnection({
          url,
          kinds: kinds ?? [],
          onOpen: () => {
            if (!alive) return;
            setStatus('open');
          },
          onMessage: (raw) => {
            if (!alive) return;
            const frame = parseRealtimeFrame(raw);
            if (frame) handle(frame);
          },
          onClose: () => {
            if (!alive) return;
            setStatus('closed');
            scheduleReconnect();
          },
        });
      } catch {
        scheduleReconnect();
        return;
      }
      setStatus('connecting');
    };

    const scheduleReconnect = (): void => {
      if (!alive) return;
      reconnectTimer = setTimeout(open, reconnectMs ?? 2000);
    };

    open();
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        connection?.close();
      } catch {
        // ignore
      }
    };
  }, [url, kinds, onEvent, reconnectMs]);

  return { status, lastEvent };
}

/** Resolve the realtime WebSocket URL for the current page. */
export function defaultRealtimeUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.hostname}:47555`;
}
