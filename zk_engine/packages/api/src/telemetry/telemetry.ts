/**
 * OpenTelemetry bootstrap (§15). One http-server span per request chains into
 * engine.verify / registry.* spans via the async context manager — status
 * attributes never carry proof data, inputs, or secrets.
 */

import { context, propagation, trace, type Context, type Span } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import type { SpanHandle, TracerPort } from '../domain/ports.js';

let globalProvider: BasicTracerProvider | null = null;

export function initTelemetry(opts: {
  serviceName: string;
  serviceVersion: string;
  endpoint?: string;
  disabled?: boolean;
  samplerRatio?: number;
  exporter?: SpanExporter;
}): BasicTracerProvider {
  if (globalProvider) return globalProvider;

  const provider = new BasicTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: opts.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: opts.serviceVersion,
    }),
    ...(opts.samplerRatio !== undefined && opts.samplerRatio < 1
      ? { sampler: new TraceIdRatioBasedSampler(opts.samplerRatio) }
      : {}),
  });

  if (opts.exporter) {
    provider.addSpanProcessor(new SimpleSpanProcessor(opts.exporter));
  } else if (opts.endpoint) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new OTLPTraceExporter({ url: opts.endpoint })));
  } else if (!opts.disabled) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  provider.register();
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  globalProvider = provider;
  return provider;
}

/** Application-facing tracer adapter (TracerPort). */
export class ApiTracer implements TracerPort {
  private readonly tracer = trace.getTracer('@zkpe/api');

  startSpan(name: string, attrs?: Record<string, string | number | boolean>): SpanHandle {
    return new ApiSpan(this.tracer.startSpan(name, attrs ? { attributes: attrs } : {}));
  }

  active(): SpanHandle | null {
    const span = trace.getSpan(context.active());
    return span ? new ApiSpan(span) : null;
  }
}

class ApiSpan implements SpanHandle {
  constructor(private readonly span: Span) {}

  setAttributes(attrs: Record<string, string | number | boolean>): void {
    this.span.setAttributes(attrs);
  }

  ok(msg?: string): void {
    this.span.setStatus({ code: 1, ...(msg !== undefined ? { message: msg } : {}) });
  }

  fail(msg: string): void {
    this.span.setStatus({ code: 2, ...(msg !== undefined ? { message: msg } : {}) });
  }

  end(): void {
    this.span.end();
  }
}

/** Extract W3C traceparent from request headers; non-trivial when absent. */
export function traceContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): Context | null {
  const value = headers['traceparent'] ?? headers['Traceparent'];
  if (typeof value !== 'string' || !value) return null;
  const carrier: Record<string, string> = { traceparent: value };
  return propagation.extract(context.active(), carrier);
}

/** No-op tracer (disabled telemetry) — keeps span calls free. */
export class NoopTracer implements TracerPort {
  startSpan(): SpanHandle {
    return NOOP_SPAN;
  }

  active(): SpanHandle | null {
    return NOOP_SPAN;
  }
}

const NOOP_SPAN: SpanHandle = { setAttributes() {}, ok() {}, fail() {}, end() {} };