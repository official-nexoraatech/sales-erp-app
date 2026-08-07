/* global fetch */
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'ai-copilot-service' });

export interface CopilotTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolExecutionContext {
  userJwt: string;
  tenantId: number;
}

// v1 scope: READ-ONLY tools only — every tool call proxies through api-gateway using the
// REQUESTING USER'S OWN JWT (never a service-level bypass), so RBAC is inherited exactly as
// it would be for that user clicking around the UI themselves. No tool ever writes to a
// domain table directly, and no tool queries raw SQL — report questions route through
// report-service's existing ~90-case registry (run_report), not freeform SQL generation, per
// the guardrail that an AI-generated answer is only as trustworthy as the layer it reads
// through. Draft generation (email/WhatsApp/quotation-summary) is deliberately NOT a tool —
// Claude's own final text response IS the draft; the frontend hands it off to the existing
// creation flows rather than this service ever calling a write endpoint.
const GATEWAY_URL = process.env['API_GATEWAY_URL'] ?? 'http://localhost:3000';

async function gatewayGet(path: string, ctx: ToolExecutionContext): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { Authorization: `Bearer ${ctx.userJwt}` },
  });
  if (!res.ok) {
    return { error: `Request failed with status ${res.status}`, path };
  }
  return res.json();
}

async function gatewayPost(
  path: string,
  body: unknown,
  ctx: ToolExecutionContext
): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.userJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { error: `Request failed with status ${res.status}`, path };
  }
  return res.json();
}

export const COPILOT_TOOLS: CopilotTool[] = [
  {
    name: 'list_invoices',
    description:
      'List recent invoices, optionally filtered by status or customer search text. Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'DRAFT | CONFIRMED | PAID | PARTIALLY_PAID | CANCELLED',
        },
        search: { type: 'string', description: 'Customer name or invoice number search text' },
        pageSize: { type: 'number', description: 'Max rows to return, default 10' },
      },
    },
  },
  {
    name: 'get_invoice',
    description: 'Get full details of a single invoice by its numeric id.',
    input_schema: {
      type: 'object',
      properties: { invoiceId: { type: 'number' } },
      required: ['invoiceId'],
    },
  },
  {
    name: 'list_customers',
    description: 'List customers, optionally filtered by a name/phone/GSTIN search text.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        pageSize: { type: 'number', description: 'Max rows to return, default 10' },
      },
    },
  },
  {
    name: 'get_customer',
    description:
      'Get full details of a single customer by their numeric id, including credit limit and balance.',
    input_schema: {
      type: 'object',
      properties: { customerId: { type: 'number' } },
      required: ['customerId'],
    },
  },
  {
    name: 'list_purchase_orders',
    description: 'List recent purchase orders, optionally filtered by status.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        pageSize: { type: 'number', description: 'Max rows to return, default 10' },
      },
    },
  },
  {
    name: 'list_reports',
    description:
      'List every available report definition in the report registry, grouped by category — use this before run_report to find the right report slug.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'run_report',
    description:
      'Run a specific report by its slug (from list_reports) with parameters, returning structured rows. Always prefer this over guessing numbers — never fabricate business data.',
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        params: {
          type: 'object',
          description:
            'Report-specific filter parameters, e.g. {"fromDate": "2026-07-01", "toDate": "2026-07-31"}',
        },
      },
      required: ['slug'],
    },
  },
];

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<unknown> {
  try {
    switch (toolName) {
      case 'list_invoices': {
        const params = new URLSearchParams();
        if (input['status']) params.set('status', String(input['status']));
        if (input['search']) params.set('search', String(input['search']));
        params.set('pageSize', String(input['pageSize'] ?? 10));
        return await gatewayGet(`/api/sales/invoices?${params.toString()}`, ctx);
      }
      case 'get_invoice':
        return await gatewayGet(`/api/sales/invoices/${Number(input['invoiceId'])}`, ctx);
      case 'list_customers': {
        const params = new URLSearchParams();
        if (input['search']) params.set('search', String(input['search']));
        params.set('pageSize', String(input['pageSize'] ?? 10));
        return await gatewayGet(`/api/sales/customers?${params.toString()}`, ctx);
      }
      case 'get_customer':
        return await gatewayGet(`/api/sales/customers/${Number(input['customerId'])}`, ctx);
      case 'list_purchase_orders': {
        const params = new URLSearchParams();
        if (input['status']) params.set('status', String(input['status']));
        params.set('pageSize', String(input['pageSize'] ?? 10));
        return await gatewayGet(`/api/purchase/purchase-orders?${params.toString()}`, ctx);
      }
      case 'list_reports':
        return await gatewayGet('/api/report/api/v2/reports', ctx);
      case 'run_report': {
        // report-service's own slugs are all kebab-case identifiers (see REPORT_REGISTRY) —
        // reject anything else before it reaches a URL path segment, since an unvalidated
        // slug interpolated directly into a path is a path-traversal / endpoint-redirection
        // risk (Claude's tool input is effectively untrusted — it can be steered by the
        // content of prior tool results or the user's own message).
        const slug = String(input['slug'] ?? '');
        if (!/^[a-z0-9-]+$/.test(slug)) {
          return { error: `Invalid report slug: ${slug}` };
        }
        return await gatewayPost(
          `/api/report/api/v2/reports/${slug}/run`,
          { params: input['params'] ?? {}, format: 'JSON' },
          ctx
        );
      }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    logger.warn({ err, toolName }, 'Copilot tool execution failed');
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
