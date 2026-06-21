/**
 * Performance benchmark for the persistence + realtime stack.
 *
 * Three scenarios:
 *   1. JSON vs SQLite: 50 sequential proposals through the full pipeline
 *   2. Realtime ring buffer: 10,000 published events
 *   3. WS broadcast: 5 clients × 1,000 events each
 *
 * Outputs a markdown-friendly table to stdout.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { after, before, describe, it } from 'node:test';
import { createBossAgent } from '@rdma/boss';
import { Pipeline } from '@rdma/coordinator';
import { createCoordinatorAgent } from '@rdma/coordinator';
import { AgentRegistry, AuditLog, Storage, type StorageDriver } from '@rdma/core';
import { createDesignerAgent } from '@rdma/designer';
import { createDevAgent } from '@rdma/dev';
import { EventBus, SqliteStorage } from '@rdma/persistence';
import { createPmAgent } from '@rdma/pm';
import { createQaAgent } from '@rdma/qa';
import { RealtimeClient, RealtimeServer } from '@rdma/realtime';
import { createResearchAgent } from '@rdma/research';
import WebSocket from 'ws';

const SHIPPED = mkdtempSync(path.join(tmpdir(), 'rdma-shipped-'));

function bootstrap(storage: StorageDriver): Pipeline {
  const audit = new AuditLog(storage);
  const reg = new AgentRegistry();
  reg.register(createResearchAgent());
  reg.register(createCoordinatorAgent());
  reg.register(createDesignerAgent());
  reg.register(createPmAgent());
  reg.register(createDevAgent());
  reg.register(createQaAgent());
  reg.register(createBossAgent({ shippedRoot: SHIPPED }));
  return new Pipeline({ registry: reg, storage, audit });
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return { result, ms };
}

describe('bench: persistence + realtime', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('JSON backend: 50 sequential proposals', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-bench-json-'));
    dirs.push(root);
    const store = new Storage({ root });
    await store.init();
    const pipeline = bootstrap(store);

    const { ms } = await time('50 proposals', async () => {
      for (let i = 0; i < 50; i++) {
        const p = await pipeline.createProposal({
          title: `JSON bench #${i}`,
          rawRequirement: `Benchmark proposal number ${i}.`,
        });
        await pipeline.runToCompletion(p);
      }
    });
    // 50 proposals should finish in well under 30s.
    assert.ok(ms < 30_000, `JSON bench too slow: ${ms.toFixed(0)}ms`);
  });

  it('SQLite backend: 50 sequential proposals', async () => {
    // Try a probe open; if the native binding is missing, skip.
    let probe: SqliteStorage | null = null;
    try {
      probe = await SqliteStorage.open({ path: ':memory:' });
    } catch (err) {
      if (/bindings file|Install better-sqlite3|native binding/i.test(String(err))) {
        console.log('  skip: better-sqlite3 not installed');
        return;
      }
      throw err;
    }
    try {
      const pipeline = bootstrap(probe);

      const { ms } = await time('50 proposals', async () => {
        for (let i = 0; i < 50; i++) {
          const p = await pipeline.createProposal({
            title: `SQLite bench #${i}`,
            rawRequirement: `Benchmark proposal number ${i}.`,
          });
          await pipeline.runToCompletion(p);
        }
      });
      assert.ok(ms < 30_000, `SQLite bench too slow: ${ms.toFixed(0)}ms`);
    } finally {
      probe?.close();
    }
  });

  it('EventBus: 10,000 events deliver in <500ms', async () => {
    const bus = new EventBus();
    let received = 0;
    bus.subscribe('*', () => {
      received++;
    });
    const { ms } = await time('10k events', async () => {
      for (let i = 0; i < 10_000; i++) {
        bus.publish({
          kind: 'audit.appended',
          proposalId: `P-${i}`,
          projectId: 'PRJ-1',
          at: new Date().toISOString(),
        });
      }
    });
    assert.equal(received, 10_000);
    assert.ok(ms < 500, `EventBus too slow: ${ms.toFixed(0)}ms`);
  });

  it('RealtimeServer: 5 clients × 1,000 events', async () => {
    const bus = new EventBus();
    const server = new RealtimeServer({ bus, port: 0 });
    const url = `ws://127.0.0.1:${server.port}`;

    const sockets: WebSocket[] = [];
    const counts: number[] = [0, 0, 0, 0, 0];
    try {
      // Open 5 raw WS clients so we can count received frames directly.
      for (let i = 0; i < 5; i++) {
        const ws = new WebSocket(url);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'subscribe', kinds: ['*'] }));
            resolve();
          });
          ws.on('error', reject);
        });
        ws.on('message', (data) => {
          const parsed = JSON.parse(String(data)) as { type?: string };
          if (parsed.type === 'event') counts[i] = (counts[i] ?? 0) + 1;
        });
      }
      await new Promise((r) => setTimeout(r, 60)); // drain hello/backfill

      const { ms } = await time('5 clients × 1k events', async () => {
        for (let i = 0; i < 1_000; i++) {
          bus.publish({
            kind: 'proposal.updated',
            proposalId: `P-${i}`,
            projectId: 'PRJ-1',
            at: new Date().toISOString(),
          });
        }
        // Wait for the last frame to land.
        await new Promise((r) => setTimeout(r, 200));
      });
      for (const c of counts) {
        assert.ok(c >= 1_000, `client received only ${c} events`);
      }
      assert.ok(ms < 2_000, `Broadcast too slow: ${ms.toFixed(0)}ms`);
    } finally {
      for (const ws of sockets) ws.close();
      await server.close();
    }
  });

  it('RealtimeClient: round-trip latency <50ms (single client)', async () => {
    const bus = new EventBus();
    const server = new RealtimeServer({ bus, port: 0 });
    const url = `ws://127.0.0.1:${server.port}`;
    const client = new RealtimeClient({ url });
    await client.ready();
    const sentAt = new Map<string, number>();
    const latencies: number[] = [];
    const sub = bus.subscribe('*', (e) => {
      sentAt.set(e.proposalId, performance.now());
    });
    client.on('audit.appended', (e) => {
      const sent = sentAt.get(e.proposalId);
      if (sent !== undefined) latencies.push(performance.now() - sent);
    });
    try {
      for (let i = 0; i < 50; i++) {
        bus.publish({
          kind: 'audit.appended',
          proposalId: `P-${i}`,
          projectId: 'PRJ-1',
          at: new Date().toISOString(),
        });
        await new Promise((r) => setTimeout(r, 5));
      }
      await new Promise((r) => setTimeout(r, 80));
      const avg = latencies.reduce((s, n) => s + n, 0) / latencies.length;
      const max = Math.max(...latencies);
      console.log(
        `  latency: avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms samples=${latencies.length}`,
      );
      assert.ok(avg < 50, `Avg latency too high: ${avg.toFixed(1)}ms`);
    } finally {
      sub();
      client.close();
      await server.close();
    }
  });
});
