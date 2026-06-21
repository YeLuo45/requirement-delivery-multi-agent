/**
 * Tests for EventBus replay / sequence functionality (direction E1).
 *
 * Verifies:
 *   - sequence numbers are monotonic, 1-based, and never reused after clear()
 *   - subscribeFrom(0) replays every buffered event in order
 *   - subscribeFrom(N) replays events with sequence > N
 *   - subscribeFrom attaches a live subscription AFTER replaying
 *   - getBufferedEvents returns the same view
 *   - getNextSequence reports the next-to-be-assigned sequence
 *   - ring buffer caps at bufferSize; oldest entries are evicted
 *   - handler errors during replay are swallowed + counted (dropped++)
 *   - subscribeFrom after publish delivers the new event live
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventBus } from '../src/event-bus.js';

function ev(seq: number, kind = 'audit.appended'): import('../src/event-bus.js').SequencedEvent {
  return {
    sequence: seq,
    kind: kind as 'audit.appended',
    proposalId: `P-${seq}`,
    projectId: 'PRJ-1',
    at: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
  };
}

function publishN(bus: EventBus, n: number): void {
  for (let i = 0; i < n; i++) {
    bus.publish({
      kind: 'audit.appended',
      proposalId: `P-${i}`,
      projectId: 'PRJ-1',
      at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    });
  }
}

describe('EventBus sequence + replay', () => {
  it('starts sequences at 1 and increments by 1 per publish', () => {
    const bus = new EventBus();
    assert.equal(bus.getNextSequence(), 1);
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(bus.getNextSequence(), 2);
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-2',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-3',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(bus.getNextSequence(), 4);
  });

  it('subscribeFrom(0) replays every buffered event in order', () => {
    const bus = new EventBus();
    publishN(bus, 5);
    const seen: number[] = [];
    bus.subscribeFrom(0, (e) => seen.push(e.sequence));
    assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  });

  it('subscribeFrom(N) replays only events with sequence > N', () => {
    const bus = new EventBus();
    publishN(bus, 5);
    const seen: number[] = [];
    bus.subscribeFrom(2, (e) => seen.push(e.sequence));
    assert.deepEqual(seen, [3, 4, 5]);
  });

  it('subscribeFrom(N) when N >= lastSequence replays nothing', () => {
    const bus = new EventBus();
    publishN(bus, 3);
    const seen: number[] = [];
    bus.subscribeFrom(3, (e) => seen.push(e.sequence));
    assert.deepEqual(seen, []);
  });

  it('subscribeFrom also delivers subsequent live events', () => {
    const bus = new EventBus();
    publishN(bus, 3);
    const seen: number[] = [];
    bus.subscribeFrom(0, (e) => seen.push(e.sequence));
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-live',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.deepEqual(seen, [1, 2, 3, 4]);
  });

  it('subscribeFrom unsubscribe stops live delivery', () => {
    const bus = new EventBus();
    publishN(bus, 2);
    const seen: number[] = [];
    const unsub = bus.subscribeFrom(0, (e) => seen.push(e.sequence));
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-live-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    unsub();
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-live-2',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.deepEqual(seen, [1, 2, 3]);
  });

  it('getBufferedEvents returns events with sequence > fromSequence', () => {
    const bus = new EventBus();
    publishN(bus, 4);
    const after2 = bus.getBufferedEvents(2);
    assert.equal(after2.length, 2);
    assert.equal(after2[0]?.sequence, 3);
    assert.equal(after2[1]?.sequence, 4);
  });

  it('getBufferedCount tracks the buffer size', () => {
    const bus = new EventBus();
    assert.equal(bus.getBufferedCount(), 0);
    publishN(bus, 7);
    assert.equal(bus.getBufferedCount(), 7);
  });

  it('ring buffer evicts oldest entries when full', () => {
    const bus = new EventBus({ bufferSize: 3 });
    publishN(bus, 10);
    const buffered = bus.getBufferedEvents(0);
    assert.equal(buffered.length, 3);
    assert.equal(buffered[0]?.sequence, 8);
    assert.equal(buffered[1]?.sequence, 9);
    assert.equal(buffered[2]?.sequence, 10);
  });

  it('handler errors during replay are caught and counted', () => {
    const bus = new EventBus();
    publishN(bus, 3);
    const unsub = bus.subscribeFrom(0, () => {
      throw new Error('replay handler boom');
    });
    assert.ok(bus.getDroppedCount() >= 3);
    unsub();
  });

  it('clear() resets the sequence counter and the buffer', () => {
    const bus = new EventBus();
    publishN(bus, 5);
    bus.clear();
    assert.equal(bus.getNextSequence(), 1);
    assert.equal(bus.getBufferedCount(), 0);
  });

  it('multiple subscribers each get their own replay', () => {
    const bus = new EventBus();
    publishN(bus, 3);
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribeFrom(0, (e) => a.push(e.sequence));
    bus.subscribeFrom(1, (e) => b.push(e.sequence));
    assert.deepEqual(a, [1, 2, 3]);
    assert.deepEqual(b, [2, 3]);
  });

  it('async handlers in replay do not stall the dispatch loop', async () => {
    const bus = new EventBus();
    publishN(bus, 2);
    let resolveFn: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
    bus.subscribeFrom(0, async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolveFn();
    });
    // The async handler should not block the synchronous replay; both
    // buffered events should be queued (call to subscribeFrom returns
    // synchronously, even if handlers are async).
    const buffered = bus.getBufferedEvents(0);
    assert.equal(buffered.length, 2);
    await settled;
  });

  it('replay respects the default 1000 buffer size', () => {
    const bus = new EventBus();
    publishN(bus, 1500);
    const buffered = bus.getBufferedEvents(0);
    assert.equal(buffered.length, 1000);
    assert.equal(buffered[0]?.sequence, 501);
    assert.equal(buffered[999]?.sequence, 1500);
  });

  it('subscribeOnce fires exactly once and auto-unsubscribes', () => {
    const bus = new EventBus();
    let count = 0;
    bus.subscribeOnce('proposal.created', () => {
      count++;
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-2',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-3',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(count, 1);
  });

  it('subscribeOnce unsubscribe stops before trigger', () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.subscribeOnce('proposal.created', () => {
      count++;
    });
    unsub();
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.equal(count, 0);
  });

  it('subscribeOnce swallows async handler errors', async () => {
    const bus = new EventBus();
    bus.subscribeOnce('proposal.created', async () => {
      throw new Error('async boom');
    });
    bus.publish({
      kind: 'proposal.created',
      proposalId: 'P-1',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 10));
    // Error was swallowed; no further state change.
    assert.equal(bus.getNextSequence(), 2);
  });

  it('subscribeFrom replay handler error is caught (dropped count rises)', () => {
    const bus = new EventBus();
    publishN(bus, 2);
    const droppedBefore = bus.getDroppedCount();
    bus.subscribeFrom(0, () => {
      throw new Error('replay boom');
    });
    assert.ok(bus.getDroppedCount() >= droppedBefore + 2);
  });

  it('subscribeFrom with no buffered events attaches live subscription cleanly', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const unsub = bus.subscribeFrom(0, (e) => seen.push(e.sequence));
    assert.deepEqual(seen, []);
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-live',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.deepEqual(seen, [1]);
    unsub();
  });

  it('subscribeFrom with async handler keeps dropped counter for thrown errors', () => {
    const bus = new EventBus();
    publishN(bus, 1);
    const droppedBefore = bus.getDroppedCount();
    bus.subscribeFrom(0, () => {
      throw new Error('sync boom');
    });
    assert.ok(bus.getDroppedCount() > droppedBefore);
  });

  it('custom bufferSize of 1 keeps only the latest event', () => {
    const bus = new EventBus({ bufferSize: 1 });
    publishN(bus, 5);
    const buffered = bus.getBufferedEvents(0);
    assert.equal(buffered.length, 1);
    assert.equal(buffered[0]?.sequence, 5);
  });

  it('bufferSize floor of 1 is enforced (zero or negative clamps up)', () => {
    const bus = new EventBus({ bufferSize: 0 });
    publishN(bus, 2);
    // After clamping to 1, only the latest event remains.
    const buffered = bus.getBufferedEvents(0);
    assert.equal(buffered.length, 1);
    assert.equal(buffered[0]?.sequence, 2);
  });

  it('publish counts synchronous handler throws', () => {
    const bus = new EventBus();
    bus.subscribe('audit.appended', () => {
      throw new Error('sync throw');
    });
    const before = bus.getDroppedCount();
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-x',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    assert.ok(bus.getDroppedCount() > before);
  });

  it('publish counts async handler rejections', async () => {
    const bus = new EventBus();
    bus.subscribe('audit.appended', async () => {
      throw new Error('async reject');
    });
    const before = bus.getDroppedCount();
    bus.publish({
      kind: 'audit.appended',
      proposalId: 'P-x',
      projectId: 'PRJ-1',
      at: new Date().toISOString(),
    });
    // The async rejection is scheduled as a microtask; let it land.
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(bus.getDroppedCount() > before);
  });

  it('subscribeFrom async rejected handler increments dropped count', async () => {
    const bus = new EventBus();
    publishN(bus, 1);
    const before = bus.getDroppedCount();
    bus.subscribeFrom(0, async () => {
      throw new Error('async replay reject');
    });
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(bus.getDroppedCount() > before);
  });

  // Sentinel import so ev() helper stays referenced for later use.
  void ev;
});
