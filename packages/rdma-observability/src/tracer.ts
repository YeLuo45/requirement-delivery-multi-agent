/**
 * Global tracer registry. Code that wants to emit spans does
 * `import { getGlobalTracer } from '@rdma/observability'` and calls
 * `tracer.startSpan(...)` — the test harness can swap the global
 * tracer to an `InMemoryExporter`-backed one without touching the
 * instrumentation call sites.
 *
 * The default is `NoopTracer` so production runs without a tracer
 * configured don't pay the cost of building Span objects they
 * can't emit anywhere.
 */

import { type Exporter, NoopTracer, type Span, type SpanOptions, type Tracer } from './index.js';

let globalTracer: Tracer = new NoopTracer();
let globalExporter: Exporter | undefined;

export function setGlobalTracer(tracer: Tracer, exporter?: Exporter): void {
  globalTracer = tracer;
  globalExporter = exporter;
}

export function getGlobalTracer(): Tracer {
  return globalTracer;
}

export function getGlobalExporter(): Exporter | undefined {
  return globalExporter;
}

export function createTracer(exporter?: Exporter): Tracer {
  // The default tracer emits to the supplied exporter if it
  // understands the InMemorySpan shape; for an unknown exporter,
  // we still build spans but the exporter must accept our snapshot.
  return {
    startSpan(name: string, opts?: SpanOptions): Span {
      if (exporter) {
        // Defer span creation to the exporter's own builder so the
        // exporter owns the lifecycle. We do this via dynamic import
        // to avoid a hard dependency on `in-memory.js`.
        return buildInMemorySpan(name, opts, exporter);
      }
      return new NoopTracer().startSpan(name, opts);
    },
    async withSpan<T>(
      name: string,
      opts: SpanOptions | undefined,
      fn: (span: Span) => T | Promise<T>,
    ): Promise<T> {
      const span = this.startSpan(name, opts);
      try {
        return await fn(span);
      } catch (err) {
        span.recordError(err);
        throw err;
      } finally {
        span.end();
      }
    },
  };
}

function buildInMemorySpan(name: string, opts: SpanOptions | undefined, exporter: Exporter): Span {
  // Minimal Span implementation that emits to the exporter on end.
  // This duplicates the in-memory helper so the tracer module
  // doesn't depend on `in-memory.js` directly.
  const traceId = Math.random().toString(16).padStart(16, '0').slice(0, 16);
  const spanId = Math.random().toString(16).padStart(8, '0').slice(0, 8);
  const attributes: Record<string, string | number | boolean> = { ...opts?.attributes };
  const startedAt = Date.now();
  let ended = false;
  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | undefined;
  let finalName = name;

  return {
    traceId,
    spanId,
    parentSpanId: undefined,
    setAttribute(key, value) {
      if (ended) return;
      attributes[key] = value;
    },
    recordError(err) {
      if (ended) return;
      status = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
      attributes['error.message'] = errorMessage;
    },
    setName(n) {
      if (ended) return;
      finalName = n;
    },
    end() {
      if (ended) return;
      ended = true;
      const snapshot = Object.freeze({
        traceId,
        spanId,
        parentSpanId: undefined,
        name: finalName,
        attributes,
        status,
        error: errorMessage,
        startMs: startedAt,
        endMs: Date.now(),
      });
      exporter.export([snapshot as unknown as Readonly<Span>]);
    },
  };
}
