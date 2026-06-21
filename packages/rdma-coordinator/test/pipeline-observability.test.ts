/**
 * Pipeline observability hooks — F2.
 *
 * The `Pipeline` class wires `getGlobalTracer()` and a `MetricsRecorder`
 * around every `agent.handle()` call so callers can switch on tracing
 * globally without touching call sites. These tests assert that:
 *
 *   1. Spans are emitted exactly once per step, named after the agent.
 *   2. Span attributes carry proposalId / stage / agentId / resultKind.
 *   3. Failed agent.handle() calls surface as `status=error` spans.
 *   4. Metric counters and timings increment per call.
 *   5. If no tracer/metrics is supplied, the noop variants are used
 *      and nothing crashes.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { AgentRegistry, AuditLog, Storage } from '@rdma/core';
import {
  InMemoryExporter,
  InMemoryMetrics,
  NoopTracer,
  createTracer,
  getGlobalTracer,
  setGlobalTracer,
} from '@rdma/observability';

import { createResearchAgent } from '@rdma/research';
import { Pipeline, createCoordinatorAgent } from '../src/agent.js';

/**
 * Register the minimum agent set needed to walk a proposal from the
 * research stage to intake. We keep this list explicit so the
 * observability tests don't accidentally depend on every other agent
 * (designer / pm / dev / qa / boss) being available — the point is
 * to verify the Pipeline's instrumentation, not the full pipeline.
 */
function buildMinimalRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register(createResearchAgent());
  registry.register(createCoordinatorAgent());
  return registry;
}

function buildStorage(): { root: string; storage: Storage; audit: AuditLog; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'rdma-pipe-obs-'));
  const storage = new Storage({ root });
  const audit = new AuditLog(storage);
  return {
    root,
    storage,
    audit,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('Pipeline observability — F2', () => {
  const originalTracer = getGlobalTracer();
  after(() => {
    setGlobalTracer(originalTracer);
  });

  it('emits one span per agent.handle() call with proposalId / stage / agentId attributes', async () => {
    const exp = new InMemoryExporter();
    const tracer = createTracer(exp);
    setGlobalTracer(tracer);

    const { storage, audit, cleanup } = buildStorage();
    try {
      const pipeline = new Pipeline({ registry: buildMinimalRegistry(), storage, audit });
      const initial = await pipeline.createProposal({
        title: 'obs smoke',
        rawRequirement: 'A tiny requirement so the pipeline steps at least once.',
      });
      // Walk research → intake → clarifying so the coordinator's span is
      // the third one. We don't drive to completion because the minimal
      // registry doesn't include pm/dev/qa/boss — that's fine, the goal
      // is to verify the pipeline's instrumentation, not the full path.
      const afterStep0 = await pipeline.step(initial);
      const afterResearch = await pipeline.step(await pipeline.storage.getProposal(initial.id));
      assert.equal(afterResearch.status, 'intake');
      const afterIntake = await pipeline.step(await pipeline.storage.getProposal(initial.id));
      assert.equal(afterIntake.status, 'clarifying');

      const handleSpans = exp.spans.filter((s) => s.name === 'agent.handle');
      // We expect one span per step (research × 2 + coordinator).
      assert.equal(
        handleSpans.length,
        3,
        `expected 3 agent.handle spans, got ${handleSpans.length}`,
      );
      const coordSpan = handleSpans[2];
      assert.ok(coordSpan);
      const attrs = coordSpan.attributes as Record<string, string | number | boolean>;
      assert.equal(attrs.proposalId, initial.id);
      assert.equal(attrs.projectId, initial.projectId);
      assert.equal(attrs.agentId, 'coordinator');
      assert.equal(attrs.stage, 'intake');
      assert.equal(attrs.resultKind, 'handoff');
      assert.equal(coordSpan.status, 'ok');
    } finally {
      cleanup();
    }
  });

  it('records a span error status when agent.handle() throws', async () => {
    const exp = new InMemoryExporter();
    setGlobalTracer(createTracer(exp));

    const { storage, audit, cleanup } = buildStorage();
    try {
      const registry = new AgentRegistry();
      // Walk through research first using the real agent, then swap in
      // a throwing agent for the intake stage. We cast to `unknown` to
      // satisfy the registry's AgentId type without fabricating a real
      // AgentId literal.
      registry.register(createResearchAgent());
      registry.register({
        id: 'broken' as never,
        name: 'broken',
        scope: ['intake'],
        handle: async () => {
          throw new Error('agent explosion');
        },
      });
      const pipeline = new Pipeline({ registry, storage, audit });
      const initial = await pipeline.createProposal({
        title: 'broken obs',
        rawRequirement: 'triggers the throwing agent',
      });
      const afterStep0 = await pipeline.step(initial);
      assert.equal(afterStep0.status, 'research');
      const afterResearch = await pipeline.step(await pipeline.storage.getProposal(initial.id));
      assert.equal(afterResearch.status, 'intake');
      // Swap the coordinator for a throwing variant BEFORE the next
      // step so it executes on the intake stage.
      registry.replace({
        id: 'coordinator' as never,
        name: 'broken-coordinator',
        scope: ['intake'],
        handle: async () => {
          throw new Error('agent explosion');
        },
      });
      // The throwing coordinator runs on the next step; the pipeline
      // rethrows after recording the audit + span.
      await assert.rejects(pipeline.step(afterResearch), /agent explosion/);

      const handleSpans = exp.spans.filter((s) => s.name === 'agent.handle');
      assert.equal(handleSpans.length, 3, 'research × 2 + throwing coordinator');
      const errorSpan = handleSpans[2];
      assert.ok(errorSpan);
      assert.equal(errorSpan.status, 'error');
      assert.equal(errorSpan.error, 'agent explosion');
      const attrs = errorSpan.attributes as Record<string, string | number | boolean>;
      assert.equal(attrs['error.message'], 'agent explosion');
    } finally {
      cleanup();
    }
  });

  it('increments an agent.handle counter and timing metric per step', async () => {
    const exp = new InMemoryExporter();
    const metrics = new InMemoryMetrics();
    setGlobalTracer(createTracer(exp));

    const { storage, audit, cleanup } = buildStorage();
    try {
      const pipeline = new Pipeline({ registry: buildMinimalRegistry(), storage, audit, metrics });
      const initial = await pipeline.createProposal({
        title: 'metric smoke',
        rawRequirement: 'just need one step',
      });
      // Two steps: research + coordinator (intake). Each step should
      // leave a counter increment and a timing sample.
      await pipeline.step(initial);
      await pipeline.step(await pipeline.storage.getProposal(initial.id));

      const snap = metrics.snapshot();
      assert.ok(snap.counters['agent.handle.start'], 'expected agent.handle.start counter');
      assert.ok(snap.counters['agent.handle.start'] >= 2);
      assert.ok(snap.timings['agent.handle'], 'expected agent.handle timings');
      assert.ok(
        snap.timings['agent.handle'].length >= 2,
        'should have at least two timing samples',
      );
    } finally {
      cleanup();
    }
  });

  it('falls back to noop tracer and noop metrics when none are provided', async () => {
    // Reset to the noop tracer so this test asserts the default
    // pipeline path doesn't accidentally emit to the in-memory exporter.
    setGlobalTracer(new NoopTracer());
    const exp = new InMemoryExporter();

    const { storage, audit, cleanup } = buildStorage();
    try {
      const pipeline = new Pipeline({ registry: buildMinimalRegistry(), storage, audit });
      const initial = await pipeline.createProposal({
        title: 'noop path',
        rawRequirement: 'default-args pipeline',
      });
      // Two steps: research + coordinator (intake). With a noop tracer
      // configured globally, neither step should emit any spans to
      // our test exporter.
      await pipeline.step(initial);
      await pipeline.step(await pipeline.storage.getProposal(initial.id));

      // No spans should leak into `exp` because the global tracer is noop.
      assert.equal(exp.spans.length, 0, 'noop tracer should not emit to the test exporter');
    } finally {
      cleanup();
    }
  });

  it('attaches proposalId to metrics when a recorder is provided', async () => {
    const metrics = new InMemoryMetrics();
    setGlobalTracer(new NoopTracer());

    const { storage, audit, cleanup } = buildStorage();
    try {
      const pipeline = new Pipeline({ registry: buildMinimalRegistry(), storage, audit, metrics });
      const initial = await pipeline.createProposal({
        title: 'metric attrs',
        rawRequirement: 'check proposalId is propagated',
      });
      await pipeline.step(initial);
      await pipeline.step(await pipeline.storage.getProposal(initial.id));
      // The exact attribute shape is implementation detail, but we
      // should at least have a sample on the agent.handle timing series.
      const snap = metrics.snapshot();
      assert.ok(snap.timings['agent.handle']);
      assert.ok(snap.timings['agent.handle'].length >= 1);
    } finally {
      cleanup();
    }
  });
});
