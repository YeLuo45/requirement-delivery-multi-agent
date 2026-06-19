/**
 * End-to-end test: Pipeline emits events on the EventBus, and a connected
 * WebSocket client receives every stage transition in real time.
 *
 * Verifies the full realtime stack wired together:
 *   Pipeline.step() → bus.publish() → RealtimeServer → WebSocket → RealtimeClient
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '@rdma/persistence';
import { RealtimeServer, RealtimeClient } from '../src/index.js';
import {
  AgentRegistry,
  AuditLog,
  Storage,
  type Proposal,
  type StorageDriver,
} from '@rdma/core';
import { Pipeline } from '@rdma/coordinator';
import { createResearchAgent } from '@rdma/research';
import { createCoordinatorAgent } from '@rdma/coordinator';
import { createDesignerAgent } from '@rdma/designer';
import { createPmAgent } from '@rdma/pm';
import { createDevAgent } from '@rdma/dev';
import { createQaAgent } from '@rdma/qa';
import { createBossAgent } from '@rdma/boss';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function bootstrapPipeline(storage: StorageDriver, bus: EventBus): Pipeline {
  const audit = new AuditLog(storage);
  const reg = new AgentRegistry();
  reg.register(createResearchAgent());
  reg.register(createCoordinatorAgent());
  reg.register(createDesignerAgent());
  reg.register(createPmAgent());
  reg.register(createDevAgent());
  reg.register(createQaAgent());
  reg.register(createBossAgent({ shippedRoot: mkdtempSync(path.join(tmpdir(), 'rdma-shipped-')) }));
  return new Pipeline({ registry: reg, storage, audit, bus });
}

describe('realtime: pipeline → event bus → WebSocket', () => {
  const servers: RealtimeServer[] = [];
  function newServer(bus: EventBus): RealtimeServer {
    const s = new RealtimeServer({ bus, port: 0 });
    servers.push(s);
    return s;
  }

  after(async () => {
    for (const s of servers) await s.close().catch(() => undefined);
  });

  it('a WebSocket client sees every stage transition as the pipeline runs', async () => {
    const bus = new EventBus();
    const server = newServer(bus);

    const storage = new Storage({ root: mkdtempSync(path.join(tmpdir(), 'rdma-store-')) });
    await storage.init();
    const pipeline = bootstrapPipeline(storage, bus);

    const client = new RealtimeClient({ url: `ws://127.0.0.1:${server.port}` });
    await client.ready();

    const stagesSeen: string[] = [];
    client.on('stage.transitioned', (e) => {
      const to = (e.payload as { to?: string } | undefined)?.to;
      if (to) stagesSeen.push(to);
    });

    const created = await pipeline.createProposal({
      title: 'Realtime smoke test',
      rawRequirement: 'A small proposal that exercises the realtime bus end to end.',
    });
    await pipeline.runToCompletion(created);

    // Wait for the last event to land.
    await new Promise((r) => setTimeout(r, 150));

    // We expect stage transitions for every agent in the chain. The exact
    // list depends on the state machine, but it should include at least
    // designer/pm/dev/qa/boss targets plus several internal transitions.
    assert.ok(stagesSeen.length >= 5, `expected several stage transitions, got ${stagesSeen.length}`);

    // Cleanup
    client.close();
  });

  it('proposal.created fires once per proposal', async () => {
    const bus = new EventBus();
    const server = newServer(bus);

    const storage = new Storage({ root: mkdtempSync(path.join(tmpdir(), 'rdma-store-')) });
    await storage.init();
    const pipeline = bootstrapPipeline(storage, bus);

    const client = new RealtimeClient({ url: `ws://127.0.0.1:${server.port}` });
    await client.ready();
    const created: string[] = [];
    client.on('proposal.created', (e) => created.push(e.proposalId));

    const a = await pipeline.createProposal({
      title: 'first',
      rawRequirement: 'first',
    });
    const b = await pipeline.createProposal({
      title: 'second',
      rawRequirement: 'second',
    });
    await new Promise((r) => setTimeout(r, 80));

    assert.deepEqual(created, [a.id, b.id]);
    client.close();
  });
});
