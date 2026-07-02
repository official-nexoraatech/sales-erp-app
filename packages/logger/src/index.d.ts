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
export declare function createLogger(options: LoggerOptions): StructuredLogger;
//# sourceMappingURL=index.d.ts.map