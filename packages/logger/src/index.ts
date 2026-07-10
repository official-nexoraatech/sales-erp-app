import winston from 'winston';
import { LokiTransport } from './loki-transport.js';

export { LokiTransport };
export { createMetricsHandler, createHttpMetricsHook } from './metrics.js';
export type { MetricsHookRequest, MetricsHookReply } from './metrics.js';
export { createCorrelationIdHook, generateCorrelationId, CORRELATION_ID_HEADER } from './correlation.js';
export {
  initializeErpMetrics,
  erpInvoiceCreateTotal,
  erpInvoiceCreateFailedTotal,
  erpSagaActiveCount,
  erpSagaStalledCount,
  erpSagaFailedTotal,
  erpSagaCompensationTotal,
  erpDlqDepth,
  erpOutboxPendingCount,
  erpStockAvailableQty,
  erpStockNegativeTotal,
  erpAuthLoginTotal,
  erpAuthBruteForceTotal,
  erpTenantBlockedRequestsTotal,
  erpHttpRequestTotal,
  erpHttpErrorTotal,
  erpHttpRequestDuration,
  erpOutboxRelayTotal,
  erpReplicaFallbackTotal,
} from './erp-metrics.js';

export interface StructuredLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
  debug(data: Record<string, unknown>, message: string): void;
  child(bindings: Record<string, unknown>): StructuredLogger;
}

export interface LoggerOptions {
  serviceName: string;
  level?: string;
  tenantId?: number;
  correlationId?: string;
}

// Mandatory structured log fields per CODING_STANDARDS.md §5
const MANDATORY_FIELDS = ['service', 'timestamp'] as const;
void MANDATORY_FIELDS; // documented for audit purposes

function wrapWinston(logger: winston.Logger): StructuredLogger {
  return {
    info: (data, message) => logger.info(message, data),
    warn: (data, message) => logger.warn(message, data),
    error: (data, message) => logger.error(message, data),
    debug: (data, message) => logger.debug(message, data),
    child: (bindings) => wrapWinston(logger.child(bindings)),
  };
}

export interface ExtendedLoggerOptions extends LoggerOptions {
  lokiUrl?: string;
}

export function createLogger(options: ExtendedLoggerOptions): StructuredLogger {
  const { serviceName, level, tenantId, correlationId, lokiUrl } = options;

  const defaultMeta: Record<string, unknown> = { service: serviceName };
  if (tenantId !== undefined) defaultMeta['tenantId'] = tenantId;
  if (correlationId) defaultMeta['correlationId'] = correlationId;

  const transports: winston.transport[] = [
    new winston.transports.Console({
      silent: process.env['NODE_ENV'] === 'test',
    }),
  ];

  if (lokiUrl && process.env['NODE_ENV'] !== 'test') {
    transports.push(
      new LokiTransport({
        lokiUrl,
        labels: { service: serviceName, env: process.env['NODE_ENV'] ?? 'development' },
      })
    );
  }

  const logger = winston.createLogger({
    level: level ?? 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta,
    transports,
  });

  return wrapWinston(logger);
}
