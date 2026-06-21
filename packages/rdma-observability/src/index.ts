/**
 * @rdma/observability — minimal tracing + metrics primitives.
 *
 * The point of this package is to give the rest of the codebase a
 * single, well-typed place to instrument itself without pulling in
 * the full `@opentelemetry/*` stack. The shape mirrors OTEL's
 * Tracer/Span API closely enough that a future drop-in
 * `OTelTracer` can wrap a real OTEL SDK Tracer and emit to a real
 * exporter (OTLP, Jaeger, etc.) without changing the call sites.
 *
 * Concepts:
 *   - `Tracer.startSpan(name, attrs?)` returns a `Span`; call
 *     `span.setAttribute(k, v)` to annotate, `span.recordError(e)`
 *     to mark a failure, and `span.end()` to finalize.
 *   - Spans nest: a span started inside another span becomes the
 *     parent's child. `context.active()` returns the current span.
 *   - An `Exporter` receives every ended span. `InMemoryExporter`
 *     is the only built-in exporter and is what tests use; real
 *     production callers plug in their own exporter.
 *   - A `MetricsRecorder` collects named counters and durations.
 *     The default `NoopMetrics` does nothing; the `InMemoryMetrics`
 *     keeps the last N samples for inspection.
 */

export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
}

export interface SpanOptions {
  attributes?: Record<string, string | number | boolean>;
}

export interface Span extends SpanContext {
  /** Attach a key/value pair. Strings, numbers, booleans only. */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Mark the span as failed and record the error message. */
  recordError(err: unknown): void;
  /** Mark the span as finished. Spans are read-only after end(). */
  end(): void;
  /** Set the human-readable span name (used when a span is renamed). */
  setName(name: string): void;
}

export interface Tracer {
  startSpan(name: string, opts?: SpanOptions): Span;
  /** Convenience wrapper — runs `fn` inside a span and records the result. */
  withSpan<T>(
    name: string,
    opts: SpanOptions | undefined,
    fn: (span: Span) => T | Promise<T>,
  ): Promise<T>;
}

export interface Exporter {
  export(spans: ReadonlyArray<Readonly<Span>>): void | Promise<void>;
}

export interface MetricsRecorder {
  /** Increment a counter by `value` (default 1). */
  increment(name: string, value?: number, attributes?: Record<string, string>): void;
  /** Record a duration in milliseconds. */
  timing(name: string, ms: number, attributes?: Record<string, string>): void;
  /** Snapshot the current metrics (for tests and debug pages). */
  snapshot(): MetricsSnapshot;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  timings: Record<string, number[]>;
}

export type { _NoopSpan } from './noop.js';
// (no actual type needed; NoopSpan is an internal class in noop.ts)

export { NoopTracer, NoopMetrics } from './noop.js';
export { InMemoryExporter, InMemoryMetrics } from './in-memory.js';
export { createTracer, setGlobalTracer, getGlobalTracer, getGlobalExporter } from './tracer.js';
export { createInMemoryMetrics } from './metrics.js';
export { setOtelAdapter, getOtelAdapter, resetOtelAdapter } from './otel-adapter.js';
export type { OtelAdapter } from './otel-adapter.js';
