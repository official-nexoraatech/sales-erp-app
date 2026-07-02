import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './drizzle-schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? 'postgresql://erp_user:erp_pass@localhost:5432/erp_db' },
});
