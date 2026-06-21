/**
 * In-memory implementations of `Exporter` and `MetricsRecorder`.
 * Tests use these to assert on what the system emitted without
 * dragging in a real OTEL SDK.
 *
 * The `Span` type we implement here is a *mutable* carrier that
 * records attributes, errors, and an ended status. We keep a list
 * of every ended span for later inspection.
 */

import { randomUUID } from 'node:crypto';
import type {
  Exporter,
  MetricsRecorder,
  MetricsSnapshot,
  Span,
  SpanContext,
  SpanOptions,
} from './index.js';

const TRACE_ID_LEN = 16;
const SPAN_ID_LEN = 8;

function randomHex(bytes: number): string {
  // crypto.randomBytes is the canonical source. We re-encode as hex.
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  return randomBytes(bytes).toString('hex');
}

class InMemorySpan implements Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  #name: string;
  #attributes: Record<string, string | number | boolean> = {};
  #status: 'ok' | 'error' = 'ok';
  #error: string | undefined;
  #start: number;
  #end: number | undefined;
  #exporter: InMemoryExporter;
  #ended = false;

  constructor(
    name: string,
    parent: SpanContext | undefined,
    exporter: InMemoryExporter,
    attrs: Record<string, string | number | boolean>,
  ) {
    this.#name = name;
    this.#exporter = exporter;
    this.#start = Date.now();
    this.#attributes = { ...attrs };
    if (parent) {
      this.traceId = parent.traceId;
      this.parentSpanId = parent.spanId;
    } else {
      this.traceId = randomHex(TRACE_ID_LEN);
    }
    this.spanId = randomHex(SPAN_ID_LEN);
  }

  setAttribute(key: string, value: string | number | boolean): void {
    if (this.#ended) return;
    this.#attributes[key] = value;
  }

  recordError(err: unknown): void {
    if (this.#ended) return;
    this.#status = 'error';
    this.#error = err instanceof Error ? err.message : String(err);
    this.setAttribute('error.message', this.#error);
  }

  setName(name: string): void {
    if (this.#ended) return;
    this.#name = name;
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#end = Date.now();
    this.#exporter.export([this.snapshot()]);
  }

  /** Build a read-only snapshot for the exporter. */
  snapshot(): Readonly<Span> {
    return Object.freeze({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.#name,
      attributes: { ...this.#attributes },
      status: this.#status,
      error: this.#error,
      startMs: this.#start,
      endMs: this.#end,
    } as Readonly<Span> & {
      name: string;
      status: string;
      error: string | undefined;
      startMs: number;
      endMs: number | undefined;
      attributes: Record<string, string | number | boolean>;
    });
  }
}

export class InMemoryExporter implements Exporter {
  readonly spans: Array<Readonly<Span> & Record<string, unknown>> = [];
  #exports = 0;

  /** Build a Tracer that emits finished spans into this exporter. */
  buildTracer(): {
    startSpan: (name: string, opts?: SpanOptions) => Span;
    withSpan: <T>(
      name: string,
      opts: SpanOptions | undefined,
      fn: (span: Span) => T | Promise<T>,
    ) => Promise<T>;
  } {
    const self = this;
    return {
      startSpan(name, opts) {
        return new InMemorySpan(name, undefined, self, opts?.attributes ?? {});
      },
      async withSpan(name, opts, fn) {
        const span = new InMemorySpan(name, undefined, self, opts?.attributes ?? {});
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

  export(spans: ReadonlyArray<Readonly<Span>>): void {
    this.#exports += 1;
    for (const s of spans) this.spans.push(s as Readonly<Span> & Record<string, unknown>);
  }

  /** Reset captured spans (between tests). */
  reset(): void {
    this.spans.length = 0;
    this.#exports = 0;
  }

  /** Number of times `export()` was called. */
  get exportCount(): number {
    return this.#exports;
  }
}

export class InMemoryMetrics implements MetricsRecorder {
  #counters: Record<string, number> = {};
  #timings: Record<string, number[]> = {};
  readonly #timingCap: number;

  constructor(options: { timingCap?: number } = {}) {
    this.#timingCap = options.timingCap ?? 100;
  }

  increment(name: string, value = 1, _attributes?: Record<string, string>): void {
    this.#counters[name] = (this.#counters[name] ?? 0) + value;
  }

  timing(name: string, ms: number, _attributes?: Record<string, string>): void {
    const list = this.#timings[name] ?? [];
    list.push(ms);
    if (list.length > this.#timingCap) list.shift();
    this.#timings[name] = list;
  }

  snapshot(): MetricsSnapshot {
    return { counters: { ...this.#counters }, timings: { ...this.#timings } };
  }
}
