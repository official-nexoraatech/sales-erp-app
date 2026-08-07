/**
 * ToolRegistry permission-inheritance: every Copilot tool call must proxy through the
 * api-gateway using the REQUESTING USER'S OWN JWT (never a service-level bypass), so a tool
 * call fails/succeeds exactly as if that user hit the same endpoint themselves. This is the
 * single most important test in the Copilot feature (see the implementation plan's Feature 3
 * testing section) — a bug here would mean the Copilot could read data the calling user isn't
 * actually permitted to see.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeTool } from '../domain/ToolRegistry.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: () => Promise.resolve(body) };
}

describe('ToolRegistry.executeTool — permission inheritance via caller JWT', () => {
  it("forwards the caller's own JWT on list_invoices, never a service-level token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(true, 200, { data: [] }));

    await executeTool('list_invoices', {}, { userJwt: 'user-own-jwt-abc', tenantId: 1 });

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain('/api/sales/invoices');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer user-own-jwt-abc',
    });
  });

  it('propagates a 403 from the gateway as a tool-level error instead of retrying with elevated rights', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(false, 403, { error: 'Forbidden' }));

    const result = await executeTool(
      'get_customer',
      { customerId: 5 },
      { userJwt: 'low-priv-jwt', tenantId: 1 }
    );

    expect(result).toMatchObject({ error: expect.stringContaining('403') });
    expect(mockFetch).toHaveBeenCalledTimes(1); // no retry-as-someone-else
  });

  it('builds the correct gateway path + query for list_invoices with filters', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(true, 200, { data: [] }));

    await executeTool(
      'list_invoices',
      { status: 'CONFIRMED', search: 'acme', pageSize: 25 },
      { userJwt: 'x', tenantId: 1 }
    );

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toBe(
      'http://localhost:3000/api/sales/invoices?status=CONFIRMED&search=acme&pageSize=25'
    );
  });

  it('builds the correct gateway path for get_invoice by numeric id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(true, 200, { data: {} }));

    await executeTool('get_invoice', { invoiceId: 42 }, { userJwt: 'x', tenantId: 1 });

    expect(mockFetch.mock.calls[0]![0]).toBe('http://localhost:3000/api/sales/invoices/42');
  });

  it('builds the correct gateway path for list_purchase_orders', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(true, 200, { data: [] }));

    await executeTool('list_purchase_orders', { status: 'PENDING' }, { userJwt: 'x', tenantId: 1 });

    expect(mockFetch.mock.calls[0]![0]).toBe(
      'http://localhost:3000/api/purchase/purchase-orders?status=PENDING&pageSize=10'
    );
  });

  it("routes run_report through report-service's registry, never freeform SQL", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(true, 200, { data: { rows: [] } }));

    await executeTool(
      'run_report',
      { slug: 'sales-summary', params: { fromDate: '2026-07-01' } },
      { userJwt: 'x', tenantId: 1 }
    );

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/api/report/api/v2/reports/sales-summary/run');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      params: { fromDate: '2026-07-01' },
      format: 'JSON',
    });
  });

  it('rejects a run_report slug that is not a plain kebab-case identifier (path-injection guard)', async () => {
    const result = await executeTool(
      'run_report',
      { slug: '../../../etc/passwd' },
      { userJwt: 'x', tenantId: 1 }
    );

    expect(result).toMatchObject({ error: expect.stringContaining('Invalid report slug') });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a run_report slug containing a full URL (would redirect the call off report-service)', async () => {
    const result = await executeTool(
      'run_report',
      { slug: 'http://evil.example.com/steal' },
      { userJwt: 'x', tenantId: 1 }
    );

    expect(result).toMatchObject({ error: expect.stringContaining('Invalid report slug') });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns an error object (not a throw) for an unknown tool name', async () => {
    const result = await executeTool('delete_everything', {}, { userJwt: 'x', tenantId: 1 });

    expect(result).toMatchObject({ error: expect.stringContaining('Unknown tool') });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('catches a network-level failure and returns an error object instead of throwing (does not crash the Claude tool-use loop)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await executeTool('list_customers', {}, { userJwt: 'x', tenantId: 1 });

    expect(result).toMatchObject({ error: expect.stringContaining('ECONNREFUSED') });
  });

  it('never sends a write request — no tool constructs a POST/PUT/DELETE against a domain write endpoint', async () => {
    mockFetch.mockResolvedValue(jsonResponse(true, 200, { data: [] }));

    for (const [name, input] of [
      ['list_invoices', {}],
      ['get_invoice', { invoiceId: 1 }],
      ['list_customers', {}],
      ['get_customer', { customerId: 1 }],
      ['list_purchase_orders', {}],
      ['list_reports', {}],
    ] as const) {
      await executeTool(name, input, { userJwt: 'x', tenantId: 1 });
    }

    // run_report is the one legitimate POST — routes through the read-only report registry,
    // never a domain write endpoint.
    for (const call of mockFetch.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      const method = init?.method ?? 'GET';
      expect(method).toBe('GET');
    }
  });
});
