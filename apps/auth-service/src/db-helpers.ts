import { sql } from 'drizzle-orm';

// Postgres has no implicit text->inet cast for bound (parameterized) query
// values — only literal SQL constants get the automatic unknown-type coercion.
// Any value written to or compared against an `inet` column must be cast explicitly.
export function inetParam(ip: string) {
  return sql`${ip}::inet`;
}
