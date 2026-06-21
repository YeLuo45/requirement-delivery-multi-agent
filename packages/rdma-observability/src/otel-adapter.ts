/**
 * OTel adapter contract.
 *
 * Real OpenTelemetry SDK is a large dependency tree. Most production
 * call sites only need a small slice: a Tracer, a Span, and a way to
 * record errors. We define that slice as our own `Tracer` / `Span`
 * types in `index.js` and expose an `OtelAdapter` interface so a
 * future OTel-backed implementation can be wired in without touching
 * the call sites.
 *
 * This file is a pure interface — it does not import the OTEL
 * packages. The optional real adapter lives in
 * `otel-real-adapter.js` and is loaded only when the user opts in
 * via `setOtelAdapter()`. That keeps the dependency graph small
 * while keeping the integration point stable.
 */

import type { Exporter, Span, Tracer } from './index.js';

export interface OtelAdapter {
  /**
   * Build a `Tracer` that mirrors the supplied OTEL `tracer.startSpan`
   * shape. The implementation is free to use any real OTEL SDK it
   * has loaded (e.g. `@opentelemetry/api`); we only require the
   * `Tracer` / `Span` shape to match our internal types.
   */
  buildTracer(opts?: { name?: string; version?: string }): Tracer;
  /**
   * Build an `Exporter` that, on every export, translates the
   * internal span shape into whatever wire format the underlying
   * SDK expects (OTLP, Jaeger, console, etc.).
   */
  buildExporter(): Exporter;
  /**
   * Human-readable name of the underlying implementation
   * (`"otel-sdk"` or `"fake"`). Useful for the doctor's
   * observability report.
   */
  name(): string;
}

/**
 * Default no-op adapter. The package ships this; real OTEL-backed
 * adapters can be plugged in at runtime by calling
 * `setOtelAdapter()`. Until then, `getOtelAdapter()` returns a
 * fake that does nothing and prints "no-op" for `name()`.
 */
import { InMemoryExporter } from './in-memory.js';

class FakeOtelAdapter implements OtelAdapter {
  buildTracer(): Tracer {
    // Re-export the in-memory tracer so tests can still assert on
    // spans emitted through this adapter path.
    const mem = new InMemoryExporter();
    return {
      startSpan(name) {
        let spanName = name;
        const traceId = Math.random().toString(16).padStart(16, '0').slice(0, 16);
        const spanId = Math.random().toString(16).padStart(8, '0').slice(0, 8);
        const attributes: Record<string, string | number | boolean> = {};
        let ended = false;
        let status: 'ok' | 'error' = 'ok';
        return {
          traceId,
          spanId,
          parentSpanId: undefined,
          setAttribute(k, v) {
            if (ended) return;
            attributes[k] = v;
          },
          recordError(e) {
            if (ended) return;
            status = 'error';
            attributes['error.message'] = e instanceof Error ? e.message : String(e);
          },
          setName(n) {
            spanName = n;
          },
          end() {
            if (ended) return;
            ended = true;
            mem.export([
              Object.freeze({
                traceId,
                spanId,
                parentSpanId: undefined,
                name: spanName,
                attributes,
                status,
                startMs: Date.now(),
                endMs: Date.now(),
              }) as unknown as Readonly<Span>,
            ]);
          },
        };
      },
      async withSpan(name, opts, fn) {
        const span = this.startSpan(name, opts);
        try {
          return await fn(span);
        } catch (e) {
          span.recordError(e);
          throw e;
        } finally {
          span.end();
        }
      },
    } as Tracer;
  }

  buildExporter(): Exporter {
    return {
      export() {
        // no-op
      },
    };
  }

  name(): string {
    return 'fake';
  }
}

let currentAdapter: OtelAdapter = new FakeOtelAdapter();

export function setOtelAdapter(adapter: OtelAdapter): void {
  currentAdapter = adapter;
}

export function getOtelAdapter(): OtelAdapter {
  return currentAdapter;
}

export function resetOtelAdapter(): void {
  currentAdapter = new FakeOtelAdapter();
}
