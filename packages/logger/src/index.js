import winston from 'winston';
// Mandatory structured log fields per CODING_STANDARDS.md §5
const MANDATORY_FIELDS = ['service', 'timestamp'];
void MANDATORY_FIELDS; // documented for audit purposes
function wrapWinston(logger) {
    return {
        info: (data, message) => logger.info(message, data),
        warn: (data, message) => logger.warn(message, data),
        error: (data, message) => logger.error(message, data),
        debug: (data, message) => logger.debug(message, data),
        child: (bindings) => wrapWinston(logger.child(bindings)),
    };
}
export function createLogger(options) {
    const { serviceName, level, tenantId, correlationId } = options;
    const defaultMeta = { service: serviceName };
    if (tenantId !== undefined)
        defaultMeta['tenantId'] = tenantId;
    if (correlationId)
        defaultMeta['correlationId'] = correlationId;
    const logger = winston.createLogger({
        level: level ?? 'info',
        format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
        defaultMeta,
        transports: [
            new winston.transports.Console({
                silent: process.env['NODE_ENV'] === 'test',
            }),
        ],
    });
    return wrapWinston(logger);
}
//# sourceMappingURL=index.js.map