/**
 * Tests for `OtelSdkAdapter` (F4).
 *
 * The adapter wraps an OTEL-style Tracer into our internal Tracer
 * shape. We don't import `@opentelemetry/api` here — we fabricate a
 * minimal OTEL-like Tracer/Span pair in JS and assert that the
 * adapter:
 *
 *   1. throws a friendly error when constructed without a tracer;
 *   2. wraps each `startSpan` into our Span shape with the same
 *      traceId / spanId / attributes;
 *   3. calls `setAttribute` / `recordException` / `setStatus` /
 *      `end` on the underlying OTEL span;
 *   4. invokes the supplied exporter once per `end()`;
 *   5. propagates errors via `recordError` and refuses to double-end.
 */

import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

import {
  InMemoryExporter,
  OtelSdkAdapter,
  type Span,
  getGlobalTracer,
  resetOtelAdapter,
  setGlobalTracer,
} from '../src/index.js';

interface FakeOtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attrs: Record<string, string | number | boolean>;
  status: { code: number; message?: string } | undefined;
  recordedErrors: unknown[];
  ended: boolean;
  name: string;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(err: unknown): void;
  updateName(name: string): void;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
}

function makeFakeSpan(name: string): FakeOtelSpan {
  const traceId = `trace-${Math.random().toString(16).slice(2, 10)}`;
  const spanId = `span-${Math.random().toString(16).slice(2, 8)}`;
  return {
    traceId,
    spanId,
    attrs: {},
    status: undefined,
    recordedErrors: [],
    ended: false,
    name,
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    setStatus(status) {
      this.status = status;
    },
    recordException(err) {
      this.recordedErrors.push(err);
    },
    updateName(next) {
      this.name = next;
    },
    end() {
      this.ended = true;
    },
    spanContext() {
      return { traceId: this.traceId, spanId: this.spanId };
    },
  };
}

interface FakeTracerHandle {
  startSpan: (
    name: string,
    opts?: { attributes?: Record<string, string | number | boolean> },
  ) => FakeOtelSpan;
  started: FakeOtelSpan[];
}

function makeFakeTracer(): FakeTracerHandle {
  const handle: FakeTracerHandle = {
    started: [],
    startSpan(name, opts) {
      const span = makeFakeSpan(name);
      if (opts?.attributes) {
        for (const [k, v] of Object.entries(opts.attributes)) {
          span.setAttribute(k, v);
        }
      }
      handle.started.push(span);
      return span;
    },
  };
  return handle;
}

describe('OtelSdkAdapter (F4)', () => {
  before(() => {
    // Ensure the global tracer is reset so unrelated tests don't
    // leak state into the adapter's checks.
    setGlobalTracer(getGlobalTracer());
  });
  afterEach(() => {
    resetOtelAdapter();
  });

  it('throws a friendly error when constructed without a tracer', () => {
    assert.throws(() => new OtelSdkAdapter({}), /requires a `tracer`/);
  });

  it('reports the scope + version in name()', () => {
    const handle = makeFakeTracer();
    const adapter = new OtelSdkAdapter({ tracer: handle });
    assert.equal(adapter.name(), 'otel-sdk:rdma@0.0.0');
    const ourTracer = adapter.buildTracer();
    assert.equal(typeof ourTracer.startSpan, 'function');
  });

  it('wraps startSpan into our Span shape and threads attributes', () => {
    const handle = makeFakeTracer();
    const adapter = new OtelSdkAdapter({ tracer: handle });
    const ourTracer = adapter.buildTracer();
    const span = ourTracer.startSpan('agent.handle', {
      attributes: { proposalId: 'P-1', stage: 'intake' },
    });
    assert.equal(span.traceId, handle.started[0]?.traceId);
    assert.equal(span.spanId, handle.started[0]?.spanId);
    span.setAttribute('extra', 'value');
    span.end();
    const otelSpan = handle.started[0];
    assert.ok(otelSpan);
    assert.equal(otelSpan.attrs.proposalId, 'P-1');
    assert.equal(otelSpan.attrs.stage, 'intake');
    assert.equal(otelSpan.attrs.extra, 'value');
    assert.equal(otelSpan.ended, true);
  });

  it('records errors via OTEL recordException + setStatus(ERROR)', () => {
    const handle = makeFakeTracer();
    const adapter = new OtelSdkAdapter({ tracer: handle });
    const ourTracer = adapter.buildTracer();
    const span = ourTracer.startSpan('agent.handle');
    span.recordError(new Error('boom'));
    span.end();
    const otelSpan = handle.started[0];
    assert.ok(otelSpan);
    assert.equal(otelSpan.recordedErrors.length, 1);
    assert.equal(otelSpan.status?.code, 2, 'OTEL ERROR code is 2');
    assert.match(otelSpan.status?.message ?? '', /boom/);
  });

  it('invokes the supplied exporter once per span.end()', () => {
    const handle = makeFakeTracer();
    const exporter = new InMemoryExporter();
    const adapter = new OtelSdkAdapter({
      tracer: handle,
      exporter: () => exporter,
    });
    const ourTracer = adapter.buildTracer();
    const span = ourTracer.startSpan('agent.handle', { attributes: { k: 'v' } });
    span.setAttribute('late', 1);
    span.end();
    assert.equal(exporter.exportCount, 1);
    const exported = exporter.spans[0];
    assert.ok(exported);
    const attrs = exported.attributes as Record<string, string | number | boolean>;
    assert.equal(attrs.k, 'v');
    assert.equal(attrs.late, 1);
    assert.equal(exported.name, 'agent.handle');
    assert.equal(exported.status, 'ok');
  });

  it('withSpan rethrows after recordError + end', async () => {
    const handle = makeFakeTracer();
    const adapter = new OtelSdkAdapter({ tracer: handle });
    const ourTracer = adapter.buildTracer();
    await assert.rejects(
      ourTracer.withSpan('outer', undefined, () => {
        throw new Error('inner');
      }),
      /inner/,
    );
    const otelSpan = handle.started[0];
    assert.ok(otelSpan);
    assert.equal(otelSpan.ended, true);
    assert.equal(otelSpan.status?.code, 2);
  });

  it('does not double-end or double-record attributes', () => {
    const handle = makeFakeTracer();
    const adapter = new OtelSdkAdapter({ tracer: handle });
    const ourTracer = adapter.buildTracer();
    const span = ourTracer.startSpan('outer');
    span.end();
    span.setAttribute('late', 1);
    span.recordError(new Error('post-end'));
    span.end();
    const otelSpan = handle.started[0];
    assert.ok(otelSpan);
    // Late setAttribute / recordError were silently dropped (we
    // mirrored the in-memory exporter's defensive style).
    assert.equal(otelSpan.attrs.late, undefined);
    assert.equal(otelSpan.recordedErrors.length, 0);
  });

  it('buildExporter() returns a working no-op when none supplied', () => {
    const handle = makeFakeTracer();
    const adapter = new OtelSdkAdapter({ tracer: handle });
    const exporter = adapter.buildExporter();
    // Calling export with a span shape should not throw.
    assert.doesNotThrow(() => {
      exporter.export([
        Object.freeze({
          traceId: 't',
          spanId: 's',
          name: 'n',
          attributes: {},
          status: 'ok',
        }) as unknown as Readonly<Span>,
      ]);
    });
  });

  it('accepts a factory function for lazy tracer init', () => {
    let called = 0;
    const handle = makeFakeTracer();
    const adapter = new OtelSdkAdapter({
      tracer: () => {
        called += 1;
        return handle;
      },
    });
    const ourTracer = adapter.buildTracer();
    ourTracer.startSpan('a');
    ourTracer.startSpan('b');
    assert.equal(called, 1, 'tracer factory should be called exactly once per buildTracer');
    assert.equal(handle.started.length, 2);
  });
});
