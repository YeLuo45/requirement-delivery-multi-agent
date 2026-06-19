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

export type Handler = (event: Event) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<EventKind | typeof ALL_EVENTS, Set<Handler>>();
  private droppedCount = 0;

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

  /** Publish an event. Handler errors are caught and counted. */
  publish(event: Event): void {
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

  /** Drop all subscriptions (used for clean shutdown in tests). */
  clear(): void {
    this.handlers.clear();
  }
}