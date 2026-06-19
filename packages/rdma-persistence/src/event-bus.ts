/**
 * EventBus — minimal pub/sub for cross-component notifications.
 *
 * Used by Storage to broadcast changes so the web dashboard can subscribe
 * and update in real time. Storage is the publisher; the WebSocket server
 * is the relay; the web UI is the consumer.
 *
 * Design constraints:
 *   - Zero dependencies (no redis, no nats).
 *   - Synchronous dispatch (callers are in async contexts already).
 *   - One-shot subscriptions supported.
 *   - Errors in handlers are swallowed + logged (don't crash the publisher).
 *   - Use `'*'` as the kind to subscribe to all events.
 *
 * Replay:
 *   - Every published event is assigned a monotonically increasing sequence
 *     number so consumers can request "everything since seq=42".
 *   - A bounded ring buffer (default 1000) keeps the most recent events in
 *     memory. Older events must be reloaded from the audit log via
 *     Storage/AuditLog if needed.
 *   - `subscribeFrom(sequence, handler)` replays buffered events with
 *     sequence > the given starting point and then continues with live ones.
 */

export type EventKind =
  | 'proposal.created'
  | 'proposal.updated'
  | 'proposal.deleted'
  | 'audit.appended'
  | 'stage.transitioned';

export const ALL_EVENTS = '*' as const;

export interface Event {
  kind: EventKind;
  /** Proposal id (P-YYYYMMDD-NNN). */
  proposalId: string;
  /** Project id (PRJ-YYYYMMDD-NNN). */
  projectId: string;
  /** ISO 8601 timestamp. */
  at: string;
  /** Optional payload. */
  payload?: Record<string, unknown>;
}

export interface SequencedEvent extends Event {
  /** Monotonically increasing sequence number (1-based). */
  sequence: number;
}

export type Handler = (event: Event) => void | Promise<void>;
export type SequencedHandler = (event: SequencedEvent) => void | Promise<void>;

export const DEFAULT_BUFFER_SIZE = 1000;

interface BufferedEntry {
  sequence: number;
  event: Event;
}

export class EventBus {
  private readonly handlers = new Map<EventKind | typeof ALL_EVENTS, Set<Handler>>();
  private droppedCount = 0;
  private nextSequence = 1;
  private buffer: BufferedEntry[] = [];
  private readonly bufferLimit: number;

  constructor(opts: { bufferSize?: number } = {}) {
    this.bufferLimit = Math.max(1, opts.bufferSize ?? DEFAULT_BUFFER_SIZE);
  }

  /**
   * Subscribe to events. Pass a specific kind to filter, or '*' to receive all.
   * Returns an unsubscribe function.
   */
  subscribe(kind: EventKind | typeof ALL_EVENTS, handler: Handler): () => void {
    let set = this.handlers.get(kind);
    if (!set) {
      set = new Set();
      this.handlers.set(kind, set);
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(kind);
      if (s) {
        s.delete(handler);
        if (s.size === 0) this.handlers.delete(kind);
      }
    };
  }

  /** Like subscribe() but fires once then auto-unsubscribes. */
  subscribeOnce(kind: EventKind | typeof ALL_EVENTS, handler: Handler): () => void {
    let triggered = false;
    const unsubscribe = this.subscribe(kind, (event) => {
      if (triggered) return;
      triggered = true;
      // Unsubscribe FIRST so re-entrant publishes don't double-fire.
      unsubscribe();
      void Promise.resolve(handler(event)).catch(() => {
        // EventBus swallows handler errors itself
      });
    });
    return unsubscribe;
  }

  /**
   * Subscribe to events with replay. When called with a starting sequence,
   * every buffered event with a strictly greater sequence number is fired
   * synchronously to the handler (in order), then the handler stays attached
   * for live events. If `fromSequence` is omitted, replays from the
   * beginning of the buffer (effectively the same as a fresh subscribe but
   * with the historical snapshot).
   *
   * The starting sequence is exclusive: a `fromSequence` of 5 replays
   * events 6, 7, 8, ...
   */
  subscribeFrom(fromSequence: number, handler: SequencedHandler): () => void {
    // Replay buffered events (sequence > fromSequence) synchronously, in order.
    for (const entry of this.buffer) {
      if (entry.sequence > fromSequence) {
        this.safeInvokeSequenced(handler, { sequence: entry.sequence, ...entry.event });
      }
    }
    // Attach to live events.
    const liveUnsubscribe = this.subscribe(ALL_EVENTS, (event) => {
      // Wrap with the next sequence number. publish() already incremented
      // before calling handlers, so we need to derive it. We do this by
      // looking at nextSequence-1 (the latest) — but that's only safe if
      // this handler runs synchronously before any subsequent publish.
      // For correctness, publish() stashes the assigned sequence on the
      // event via a Symbol sidechannel; if absent, fall back to nextSequence-1.
      const seq = (event as Event & { __seq?: number }).__seq ?? this.nextSequence - 1;
      this.safeInvokeSequenced(handler, { sequence: seq, ...event });
    });
    return liveUnsubscribe;
  }

  /** Publish an event. Handler errors are caught and counted. */
  publish(event: Event): void {
    const sequence = this.nextSequence++;
    // Stash the sequence on the event so subscribers can recover it.
    (event as Event & { __seq?: number }).__seq = sequence;

    // Append to the ring buffer first so subscribeFrom() can see this event
    // when called immediately after publish.
    this.buffer.push({ sequence, event });
    if (this.buffer.length > this.bufferLimit) {
      this.buffer.splice(0, this.buffer.length - this.bufferLimit);
    }

    const specific = this.handlers.get(event.kind);
    const all = this.handlers.get(ALL_EVENTS);
    const dispatch = (handler: Handler): void => {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch(() => {
            this.droppedCount++;
          });
        }
      } catch {
        this.droppedCount++;
      }
    };
    specific?.forEach(dispatch);
    all?.forEach(dispatch);
  }

  /** Returns the count of errors caught during dispatch (since startup). */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  /** Returns the next sequence number that will be assigned. */
  getNextSequence(): number {
    return this.nextSequence;
  }

  /**
   * Returns the buffered events with sequence >= fromSequence, in order.
   * Used by clients that want to inspect history without subscribing.
   */
  getBufferedEvents(fromSequence = 0): SequencedEvent[] {
    const out: SequencedEvent[] = [];
    for (const entry of this.buffer) {
      if (entry.sequence > fromSequence) {
        out.push({ sequence: entry.sequence, ...entry.event });
      }
    }
    return out;
  }

  /** Total number of events currently held in the replay buffer. */
  getBufferedCount(): number {
    return this.buffer.length;
  }

  /** Drop all subscriptions and reset the sequence counter (used for clean shutdown in tests). */
  clear(): void {
    this.handlers.clear();
    this.buffer = [];
    this.nextSequence = 1;
  }

  private safeInvokeSequenced(handler: SequencedHandler, event: SequencedEvent): void {
    try {
      const result = handler(event);
      if (result instanceof Promise) {
        result.catch(() => {
          this.droppedCount++;
        });
      }
    } catch {
      this.droppedCount++;
    }
  }
}