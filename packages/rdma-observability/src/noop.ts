/**
 * Noop implementations for production code paths that don't
 * enable tracing. Spans are still real objects so call sites don't
 * need null checks; they just record into the void.
 */

import type { MetricsRecorder, MetricsSnapshot, Span, SpanOptions, Tracer } from './index.js';

class NoopSpan implements Span {
  traceId = '0000000000000000';
  spanId = '0000000000000000';
  parentSpanId: string | undefined;
  #name: string;
  #ended = false;
  constructor(name: string) {
    this.#name = name;
  }
  setAttribute(): void {
    /* noop */
  }
  recordError(): void {
    /* noop */
  }
  setName(name: string): void {
    this.#name = name;
  }
  end(): void {
    this.#ended = true;
  }
}

export class NoopTracer implements Tracer {
  startSpan(name: string): Span {
    return new NoopSpan(name);
  }
  async withSpan<T>(
    name: string,
    _opts: SpanOptions | undefined,
    fn: (span: Span) => T | Promise<T>,
  ): Promise<T> {
    return fn(new NoopSpan(name));
  }
}

export class NoopMetrics implements MetricsRecorder {
  increment(): void {
    /* noop */
  }
  timing(): void {
    /* noop */
  }
  snapshot(): MetricsSnapshot {
    return { counters: {}, timings: {} };
  }
}
