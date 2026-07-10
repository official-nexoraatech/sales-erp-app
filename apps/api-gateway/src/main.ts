import { initializeTelemetry } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { loadGatewayConfig } from './config.js';
import { buildGateway } from './app.js';

initializeTelemetry({ serviceName: 'api-gateway' });

async function bootstrap(): Promise<void> {
  const config = loadGatewayConfig();
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({ serviceName: 'api-gateway', level: 'info', ...(lokiUrl ? { lokiUrl } : {}) });

  const fastify = await buildGateway(config, logger);
  const address = await fastify.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ address }, 'API gateway started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});
