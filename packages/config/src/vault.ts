export interface VaultClientOptions {
  addr: string;
  token: string;
  /** Cache TTL in ms before a secret is re-fetched from Vault. Default 60s. */
  cacheTtlMs?: number;
}

interface CachedSecret {
  value: string;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 60_000;

/**
 * Minimal client for Vault's KV-v2 HTTP API, built on Node's native fetch
 * rather than the `node-vault` package — this package has zero runtime
 * dependencies today and is imported at boot by every service, so a new
 * dependency here has an outsized blast radius.
 */
export class VaultClient {
  private readonly cache = new Map<string, CachedSecret>();
  private readonly cacheTtlMs: number;

  constructor(private readonly options: VaultClientOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async getSecret(path: string, key: string): Promise<string> {
    const cacheKey = `${path}#${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.fetchSecret(path, key);
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.cacheTtlMs });
    return value;
  }

  private async fetchSecret(path: string, key: string): Promise<string> {
    const url = `${this.options.addr}/v1/secret/data/${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'X-Vault-Token': this.options.token },
      });
    } catch (err) {
      throw new Error(
        `Vault unreachable at ${this.options.addr}: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new Error(`Vault request for "${path}" failed with status ${response.status}`);
    }

    const body = (await response.json()) as { data?: { data?: Record<string, string> } };
    const value = body.data?.data?.[key];
    if (value === undefined) {
      throw new Error(`Vault secret "${path}" has no key "${key}"`);
    }
    return value;
  }
}

export async function loadSecret(
  options: VaultClientOptions,
  path: string,
  key: string,
): Promise<string> {
  return new VaultClient(options).getSecret(path, key);
}
