export interface AppConfig {
    nodeEnv: string;
    port: number;
    serviceName: string;
    databaseUrl: string;
    databaseReplicaUrl: string;
    redisUrl: string;
    kafkaBrokers: string[];
    kafkaClientId: string;
    minioEndpoint: string;
    minioAccessKey: string;
    minioSecretKey: string;
    elasticsearchUrl: string;
    jwtPublicKey: string;
    jwtPrivateKey: string;
    jwtAccessTokenTtl: number;
    jwtRefreshTokenTtl: number;
    vaultAddr: string;
    vaultToken: string;
    otlpEndpoint: string;
    logLevel: string;
}
export declare function requireEnv(name: string): string;
export declare function loadConfig(serviceName: string): AppConfig;
//# sourceMappingURL=index.d.ts.map