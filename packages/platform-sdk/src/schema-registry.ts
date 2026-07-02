import { eq, desc } from 'drizzle-orm';
import { schemaRegistryTable } from '@erp/db';
import type { TenantScopedDatabase } from './database.js';

export interface JsonSchema {
  type: string;
  required?: string[];
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SchemaEntry {
  eventType: string;
  schemaVersion: number;
  jsonSchema: JsonSchema;
  compatibilityMode: 'BACKWARD' | 'FORWARD' | 'FULL' | 'NONE';
  description?: string;
  registeredBy?: string;
}

export interface CompatibilityCheckResult {
  compatible: boolean;
  incompatibilities: string[];
}

// Simple in-memory cache for schema registry (L1 cache)
const schemaCache = new Map<string, SchemaEntry>();
const CACHE_TTL_MS = 60_000;
const cacheExpiry = new Map<string, number>();

export class SchemaRegistry {
  constructor(private readonly db: TenantScopedDatabase) {}

  async register(entry: SchemaEntry): Promise<SchemaEntry> {
    const latest = await this.getLatest(entry.eventType);

    if (latest) {
      const compat = this.checkCompatibility(latest.jsonSchema, entry.jsonSchema, entry.compatibilityMode);
      if (!compat.compatible) {
        throw new SchemaCompatibilityError(entry.eventType, entry.schemaVersion, compat.incompatibilities);
      }
    }

    await this.db.raw.insert(schemaRegistryTable).values({
      eventType: entry.eventType,
      schemaVersion: entry.schemaVersion,
      jsonSchema: entry.jsonSchema as Record<string, unknown>,
      compatibilityMode: entry.compatibilityMode,
      description: entry.description,
      registeredBy: entry.registeredBy,
    });

    this.invalidateCache(entry.eventType);
    return entry;
  }

  async getLatest(eventType: string): Promise<SchemaEntry | null> {
    const cacheKey = `latest:${eventType}`;
    const cached = this.fromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.db.raw
      .select()
      .from(schemaRegistryTable)
      .where(eq(schemaRegistryTable.eventType, eventType))
      .orderBy(desc(schemaRegistryTable.schemaVersion))
      .limit(1);

    if (!rows[0]) return null;
    const entry = this.toEntry(rows[0]);
    this.toCache(cacheKey, entry);
    return entry;
  }

  async getVersion(eventType: string, version: number): Promise<SchemaEntry | null> {
    const cacheKey = `v:${eventType}:${version}`;
    const cached = this.fromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.db.raw
      .select()
      .from(schemaRegistryTable)
      .where(eq(schemaRegistryTable.eventType, eventType))
      .limit(100);

    const row = rows.find((r) => r.schemaVersion === version);
    if (!row) return null;
    const entry = this.toEntry(row);
    this.toCache(cacheKey, entry);
    return entry;
  }

  async getCatalog(): Promise<SchemaEntry[]> {
    const rows = await this.db.raw
      .select()
      .from(schemaRegistryTable)
      .orderBy(desc(schemaRegistryTable.registeredAt));

    return rows.map(this.toEntry);
  }

  checkCompatibility(
    existing: JsonSchema,
    proposed: JsonSchema,
    mode: 'BACKWARD' | 'FORWARD' | 'FULL' | 'NONE'
  ): CompatibilityCheckResult {
    if (mode === 'NONE') return { compatible: true, incompatibilities: [] };

    const incompatibilities: string[] = [];

    if (mode === 'BACKWARD' || mode === 'FULL') {
      // Backward: new schema can read old data
      // Check: required fields in new schema that don't exist in old schema are incompatible
      const newRequired = proposed.required ?? [];
      const oldProps = Object.keys(existing.properties ?? {});
      for (const req of newRequired) {
        if (!oldProps.includes(req)) {
          incompatibilities.push(
            `BACKWARD_INCOMPATIBLE: New required field '${req}' not present in existing schema`
          );
        }
      }

      // Check: property type changes are incompatible
      const existingProps = existing.properties ?? {};
      const proposedProps = proposed.properties ?? {};
      for (const [field, existingDef] of Object.entries(existingProps)) {
        const proposedDef = proposedProps[field];
        if (proposedDef && (existingDef as Record<string, unknown>)['type'] !== (proposedDef as Record<string, unknown>)['type']) {
          incompatibilities.push(
            `BACKWARD_INCOMPATIBLE: Field '${field}' type changed from '${(existingDef as Record<string, unknown>)['type']}' to '${(proposedDef as Record<string, unknown>)['type']}'`
          );
        }
      }
    }

    if (mode === 'FORWARD' || mode === 'FULL') {
      // Forward: old schema can read new data
      // Check: fields removed from new schema that were required in old schema
      const oldRequired = existing.required ?? [];
      const newProps = Object.keys(proposed.properties ?? {});
      for (const req of oldRequired) {
        if (!newProps.includes(req)) {
          incompatibilities.push(
            `FORWARD_INCOMPATIBLE: Field '${req}' was required in old schema but removed in new schema`
          );
        }
      }
    }

    return { compatible: incompatibilities.length === 0, incompatibilities };
  }

  validate(eventType: string, schema: JsonSchema, payload: Record<string, unknown>): string[] {
    const errors: string[] = [];
    const required = schema.required ?? [];
    const properties = schema.properties ?? {};

    for (const field of required) {
      if (!(field in payload)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    for (const [field, def] of Object.entries(properties)) {
      if (field in payload) {
        const expectedType = (def as Record<string, unknown>)['type'] as string;
        const actualValue = payload[field];
        if (!this.typeMatches(actualValue, expectedType)) {
          errors.push(`Field '${field}' expected type '${expectedType}', got '${typeof actualValue}'`);
        }
      }
    }

    return errors;
  }

  private typeMatches(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'integer':
      case 'number':
        return typeof value === 'number';
      case 'string':
        return typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true;
    }
  }

  private toEntry(row: typeof schemaRegistryTable.$inferSelect): SchemaEntry {
    const entry: SchemaEntry = {
      eventType: row.eventType,
      schemaVersion: row.schemaVersion,
      jsonSchema: row.jsonSchema as JsonSchema,
      compatibilityMode: row.compatibilityMode,
    };
    if (row.description !== null) entry.description = row.description;
    if (row.registeredBy !== null) entry.registeredBy = row.registeredBy;
    return entry;
  }

  private fromCache(key: string): SchemaEntry | null {
    const expiry = cacheExpiry.get(key);
    if (!expiry || Date.now() > expiry) {
      schemaCache.delete(key);
      cacheExpiry.delete(key);
      return null;
    }
    return schemaCache.get(key) ?? null;
  }

  private toCache(key: string, entry: SchemaEntry): void {
    schemaCache.set(key, entry);
    cacheExpiry.set(key, Date.now() + CACHE_TTL_MS);
  }

  private invalidateCache(eventType: string): void {
    for (const key of schemaCache.keys()) {
      if (key.includes(eventType)) {
        schemaCache.delete(key);
        cacheExpiry.delete(key);
      }
    }
  }
}

export class SchemaCompatibilityError extends Error {
  public readonly statusCode = 422;
  public readonly code = 'SCHEMA_INCOMPATIBLE';
  public readonly details: Record<string, unknown>;

  constructor(eventType: string, version: number, incompatibilities: string[]) {
    super(`Schema for ${eventType} v${version} is incompatible with the existing schema`);
    this.name = 'SchemaCompatibilityError';
    this.details = { eventType, version, incompatibilities };
  }
}

// ─── Upcasters ────────────────────────────────────────────────────────────────
// Code is the source of truth for upcasters (not DB)
export type Upcaster = (payload: Record<string, unknown>) => Record<string, unknown>;

const upcasters = new Map<string, Upcaster>();

// INVOICE_CONFIRMED v1 → v2: adds branchId and metadata wrapper
upcasters.set('INVOICE_CONFIRMED:1:2', (payload) => ({
  ...payload,
  branchId: (payload['branchId'] as number) ?? 1,
  metadata: { upcasted: true, originalVersion: 1 },
}));

export function getUpcaster(eventType: string, fromVersion: number, toVersion: number): Upcaster | null {
  return upcasters.get(`${eventType}:${fromVersion}:${toVersion}`) ?? null;
}

export function upcastEvent(
  eventType: string,
  currentVersion: number,
  targetVersion: number,
  payload: Record<string, unknown>
): Record<string, unknown> {
  let result = { ...payload };
  for (let v = currentVersion; v < targetVersion; v++) {
    const upcaster = getUpcaster(eventType, v, v + 1);
    if (upcaster) {
      result = upcaster(result);
    }
  }
  return result;
}
