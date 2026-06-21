/**
 * OtelSdkAdapter — thin wrapper around `@opentelemetry/api`'s
 * `Tracer` / `Span` interfaces.
 *
 * This file deliberately uses a dynamic import for `@opentelemetry/api`
 * so the package stays at zero runtime dependencies by default. Real
 * OTEL-backed users wire the adapter in themselves:
 *
 *   import { OtelSdkAdapter } from '@rdma/observability/otel-sdk-adapter';
 *   import { trace } from '@opentelemetry/api';
 *
 *   setOtelAdapter(new OtelSdkAdapter({
 *     tracer: trace.getTracer('rdma', '0.2.0'),
 *   }));
 *
 * The adapter accepts either a real OTEL Tracer (anything with a
 * `startSpan(name, opts)` method that returns something with our
 * Span shape) or a no-op stub. We normalise the OTEL span to our
 * internal Span so the rest of the codebase never sees an OTEL
 * type directly.
 */

import type { Exporter, Span, SpanOptions, Tracer } from './index.js';
import type { OtelAdapter } from './otel-adapter.js';

/**
 * Subset of the OTEL Span API we actually use. Declared locally so
 * the file compiles without `@opentelemetry/api` installed; the
 * real values satisfy this shape at runtime.
 */
interface OtelLikeSpan {
  spanContext(): { traceId: string; spanId: string };
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(error: unknown): void;
  end(): void;
  updateName(name: string): void;
  parentSpanId?: string;
}

interface OtelLikeTracer {
  startSpan(
    name: string,
    opts?: { attributes?: Record<string, string | number | boolean> },
  ): OtelLikeSpan;
}

export interface OtelSdkAdapterOptions {
  /**
   * Either an OTEL-style tracer (anything with `startSpan`) or a
   * factory returning one. The factory form is preferred because it
   * lets the caller defer the OTEL SDK init until after
   * `setOtelAdapter()` resolves.
   */
  tracer?: OtelLikeTracer | (() => OtelLikeTracer);
  /**
   * Optional exporter factory — when omitted, spans are kept
   * in-process and only the in-memory bridge receives them. When
   * supplied, the returned exporter is invoked once per `span.end()`
   * with the normalised `Readonly<Span>` payload.
   */
  exporter?: () => Exporter;
}

export class OtelSdkAdapter implements OtelAdapter {
  readonly #tracer: OtelLikeTracer | (() => OtelLikeTracer);
  readonly #exporter: (() => Exporter) | undefined;
  readonly #defaultName: string;
  readonly #defaultVersion: string;

  constructor(opts: OtelSdkAdapterOptions = {}) {
    if (!opts.tracer) {
      throw new Error(
        '[rdma-observability] OtelSdkAdapter requires a `tracer`. ' +
          'Pass an OTEL Tracer (or a factory that returns one). ' +
          'Install `@opentelemetry/api` if you have not already.',
      );
    }
    this.#tracer = opts.tracer;
    this.#exporter = opts.exporter;
    this.#defaultName = 'rdma';
    this.#defaultVersion = '0.0.0';
  }

  #resolveTracer(): OtelLikeTracer {
    const t = this.#tracer;
    return typeof t === 'function' ? t() : t;
  }

  buildTracer(_opts?: { name?: string; version?: string }): Tracer {
    const otelTracer = this.#resolveTracer();
    const exporter = this.#exporter ? this.#exporter() : undefined;
    return {
      startSpan(name, opts2) {
        const startMs = Date.now();
        const span = otelTracer.startSpan(name, opts2);
        let spanName = name;
        let ended = false;
        const attributes: Record<string, string | number | boolean> = {
          ...opts2?.attributes,
        };
        const ctx = span.spanContext();
        const traceId = ctx.traceId;
        const spanId = ctx.spanId;
        return {
          traceId,
          spanId,
          parentSpanId: span.parentSpanId,
          setAttribute(key, value) {
            if (ended) return;
            attributes[key] = value;
            span.setAttribute(key, value);
          },
          recordError(error) {
            if (ended) return;
            const message = error instanceof Error ? error.message : String(error);
            attributes['error.message'] = message;
            span.recordException(error);
            // OTEL status code 2 = ERROR.
            span.setStatus({ code: 2, message });
          },
          setName(next) {
            if (ended) return;
            spanName = next;
            span.updateName(next);
          },
          end() {
            if (ended) return;
            ended = true;
            const endMs = Date.now();
            span.end();
            if (exporter) {
              exporter.export([
                Object.freeze({
                  traceId,
                  spanId,
                  parentSpanId: span.parentSpanId,
                  name: spanName,
                  attributes,
                  status: attributes['error.message'] ? 'error' : 'ok',
                  startMs,
                  endMs,
                }) as unknown as Readonly<Span>,
              ]);
            }
          },
        };
      },
      async withSpan(name, opts3, fn) {
        const span = this.startSpan(name, opts3);
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

  buildExporter(): Exporter {
    if (!this.#exporter) {
      // Default exporter: drop on the floor. Real users wire
      // their own exporter so the SDK can flush to OTLP.
      return { export() {} };
    }
    return this.#exporter();
  }

  name(): string {
    return `otel-sdk:${this.#defaultName}@${this.#defaultVersion}`;
  }
}
