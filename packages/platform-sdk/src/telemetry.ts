import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import * as api from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  enabled?: boolean;
}

export interface SpanOptions {
  attributes?: Record<string, string | number | boolean>;
}

let sdk: NodeSDK | null = null;

export function initializeTelemetry(options: TelemetryOptions): void {
  const otlpEndpoint = options.otlpEndpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  const enabled = options.enabled ?? Boolean(otlpEndpoint);
  if (!enabled || !otlpEndpoint) return;

  try {
    const exporter = new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    });

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
        [ATTR_SERVICE_VERSION]: options.serviceVersion ?? '0.1.0',
      }),
      traceExporter: exporter,
    });

    sdk.start();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[telemetry] failed to initialize, continuing without tracing:', error);
    sdk = null;
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

export async function trace<T>(
  spanName: string,
  fn: () => Promise<T>,
  options?: SpanOptions
): Promise<T> {
  const tracer = api.trace.getTracer('erp-platform-sdk');
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }
    try {
      const result = await fn();
      span.setStatus({ code: api.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// Inject correlation ID into current OTel span attributes
export function setCorrelationId(correlationId: string): void {
  const span = api.trace.getActiveSpan();
  if (span) {
    span.setAttribute('correlation.id', correlationId);
  }
}
