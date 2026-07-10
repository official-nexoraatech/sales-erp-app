import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultClient } from '../vault.js';
import { loadConfig, loadConfigWithSecrets } from '../index.js';

function mockVaultResponse(data: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { data } }),
  } as Response;
}

describe('VaultClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a secret and caches it for subsequent calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockVaultResponse({ DATABASE_URL: 'postgresql://vault-value' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new VaultClient({ addr: 'http://localhost:8200', token: 'dev-root-token' });
    const first = await client.getSecret('erp/auth-service', 'DATABASE_URL');
    const second = await client.getSecret('erp/auth-service', 'DATABASE_URL');

    expect(first).toBe('postgresql://vault-value');
    expect(second).toBe('postgresql://vault-value');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cache TTL expires', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockVaultResponse({ DATABASE_URL: 'postgresql://vault-value' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new VaultClient({ addr: 'http://localhost:8200', token: 'dev-root-token', cacheTtlMs: 10 });
    await client.getSecret('erp/auth-service', 'DATABASE_URL');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.getSecret('erp/auth-service', 'DATABASE_URL');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws naming the path and key when the secret is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockVaultResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const client = new VaultClient({ addr: 'http://localhost:8200', token: 'dev-root-token' });
    await expect(client.getSecret('erp/auth-service', 'JWT_PRIVATE_KEY')).rejects.toThrow(
      /erp\/auth-service.*JWT_PRIVATE_KEY/,
    );
  });

  it('throws when Vault is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new VaultClient({ addr: 'http://localhost:8200', token: 'dev-root-token' });
    await expect(client.getSecret('erp/auth-service', 'DATABASE_URL')).rejects.toThrow(/Vault unreachable/);
  });
});

describe('loadConfigWithSecrets', () => {
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    envSnapshot['NODE_ENV'] = process.env['NODE_ENV'];
    envSnapshot['VAULT_ADDR'] = process.env['VAULT_ADDR'];
    envSnapshot['VAULT_TOKEN'] = process.env['VAULT_TOKEN'];
    envSnapshot['FIELD_ENCRYPTION_KEY'] = process.env['FIELD_ENCRYPTION_KEY'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [name, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('matches loadConfig() in test/development with no Vault dependency', async () => {
    process.env['NODE_ENV'] = 'test';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = await loadConfigWithSecrets('auth-service');

    expect(config).toEqual(loadConfig('auth-service'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sources priority-1 secrets from Vault in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VAULT_ADDR'] = 'http://localhost:8200';
    process.env['VAULT_TOKEN'] = 'test-token';
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/secret/data/erp/auth-service')) {
        return mockVaultResponse({
          DATABASE_URL: 'postgresql://vault-db',
          DATABASE_REPLICA_URL: 'postgresql://vault-replica',
          JWT_PRIVATE_KEY: 'vault-jwt-private-key',
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = await loadConfigWithSecrets('auth-service');

    expect(config.databaseUrl).toBe('postgresql://vault-db');
    expect(config.databaseReplicaUrl).toBe('postgresql://vault-replica');
    expect(config.jwtPrivateKey).toBe('vault-jwt-private-key');
  });

  it('fails fast, naming the missing secret, when Vault is unreachable in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VAULT_ADDR'] = 'http://localhost:8200';
    process.env['VAULT_TOKEN'] = 'test-token';
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadConfigWithSecrets('auth-service')).rejects.toThrow(/DATABASE_URL/);
  });

  it('fails fast when VAULT_ADDR/VAULT_TOKEN are not set in production', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['VAULT_ADDR'];
    delete process.env['VAULT_TOKEN'];

    await expect(loadConfigWithSecrets('auth-service')).rejects.toThrow(/VAULT_ADDR and VAULT_TOKEN/);
  });

  it('fetches extraSecrets from Vault and writes them into process.env', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VAULT_ADDR'] = 'http://localhost:8200';
    process.env['VAULT_TOKEN'] = 'test-token';
    delete process.env['FIELD_ENCRYPTION_KEY'];
    const fetchMock = vi.fn().mockResolvedValue(
      mockVaultResponse({
        DATABASE_URL: 'postgresql://vault-db',
        DATABASE_REPLICA_URL: 'postgresql://vault-replica',
        JWT_PRIVATE_KEY: 'vault-jwt-private-key',
        FIELD_ENCRYPTION_KEY: 'vault-field-encryption-key',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await loadConfigWithSecrets('auth-service', { extraSecrets: ['FIELD_ENCRYPTION_KEY'] });

    expect(process.env['FIELD_ENCRYPTION_KEY']).toBe('vault-field-encryption-key');
  });

  it('fails fast, naming the missing extra secret, when it cannot be fetched', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VAULT_ADDR'] = 'http://localhost:8200';
    process.env['VAULT_TOKEN'] = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue(
      mockVaultResponse({
        DATABASE_URL: 'postgresql://vault-db',
        DATABASE_REPLICA_URL: 'postgresql://vault-replica',
        JWT_PRIVATE_KEY: 'vault-jwt-private-key',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      loadConfigWithSecrets('auth-service', { extraSecrets: ['FIELD_ENCRYPTION_KEY'] }),
    ).rejects.toThrow(/FIELD_ENCRYPTION_KEY/);
  });
});
