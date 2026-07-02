export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  incrBy(key: string, increment: number): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, field: string, value: string): Promise<void>;
  hGetAll(key: string): Promise<Record<string, string>>;
  sAdd(key: string, ...members: string[]): Promise<number>;
  sIsMember(key: string, member: string): Promise<boolean>;
  publish(channel: string, message: string): Promise<void>;
  quit(): Promise<void>;
}

export interface CacheConfig {
  url: string;
  keyPrefix?: string;
}

export function createCacheClient(_config: CacheConfig): CacheClient {
  throw new Error('Cache client not implemented — implement with ioredis in Milestone 0.4');
}
