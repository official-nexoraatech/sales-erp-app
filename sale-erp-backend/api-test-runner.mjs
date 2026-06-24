import fs from 'fs';

const BASE = process.env.API_BASE_URL || 'http://localhost:8081';
const TEST_USERNAME = process.env.API_TEST_USERNAME;
const TEST_PASSWORD = process.env.API_TEST_PASSWORD;
const spec = JSON.parse(fs.readFileSync('openapi-local.json', 'utf8').replace(/^\uFEFF/, ''));
const httpMethods = new Set(['get', 'post', 'put', 'delete', 'patch']);
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
const today = '2026-06-03';
const fromDate = '2026-06-01';
const toDate = '2026-06-03';
let token = '';

const ids = {
  countryId: 1,
  stateId: 1,
  roleId: 1,
  organizationId: 1,
  userId: 1,
  missingId: 999999999
};
const results = new Map();

const ops = [];
for (const [path, item] of Object.entries(spec.paths || {})) {
  for (const [method, op] of Object.entries(item || {})) {
    if (httpMethods.has(method)) ops.push({ method: method.toUpperCase(), path, op });
  }
}
ops.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
const opMap = new Map(ops.map((o) => [`${o.method} ${o.path}`, o]));

function isPublic(method, path) {
  return path.startsWith('/api/v1/auth/')
    || (method === 'POST' && path === '/api/v1/users')
    || (method === 'POST' && path === '/api/v1/organizations');
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (['password', 'token', 'accesstoken', 'jwt', 'refreshtoken'].includes(k.toLowerCase())) out[k] = '<redacted>';
      else out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

function parseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function params(op, where) {
  return (op.parameters || [])
    .filter((p) => p.in === where)
    .map((p) => ({ name: p.name, in: p.in, required: !!p.required, schema: p.schema || null }));
}

function requestSchema(op) {
  const schema = op.requestBody?.content?.['application/json']?.schema;
  return schema?.$ref || schema?.type || (schema ? JSON.stringify(schema) : '');
}

function responseSchema(op) {
  const responses = op.responses || {};
  const status = Object.keys(responses).find((s) => /^2\d\d$/.test(s)) || Object.keys(responses)[0];
  const content = status ? responses[status].content || {} : {};
  const media = content['application/json'] || content['*/*'] || Object.values(content)[0];
  const schema = media?.schema;
  return schema?.$ref || schema?.type || (schema ? JSON.stringify(schema) : '');
}

function pathWithParams(path, replacements = {}) {
  return path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(String(replacements[name] ?? ids.missingId)));
}

function url(actualPath, query) {
  const qs = query ? new URLSearchParams(query).toString() : '';
  return `${BASE}${actualPath}${qs ? `?${qs}` : ''}`;
}

function docsHeaders(auth, hasBody) {
  const headers = { Accept: 'application/json' };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = 'Bearer <JWT_TOKEN>';
  return headers;
}

function standardUnauthorized() {
  return { success: false, message: 'Unauthorized access', errorCode: 'UNAUTHORIZED', timestamp: '<timestamp>' };
}

function standardValidationError() {
  return { success: false, message: 'Validation failed', errorCode: 'VALIDATION_FAILED', data: { field: 'reason' }, timestamp: '<timestamp>' };
}

function extractId(body, keys) {
  const data = body?.data ?? body;
  for (const key of keys) if (data?.[key] !== undefined && data?.[key] !== null) return data[key];
  return data?.id;
}

function responseRows(body) {
  const data = body?.data ?? body;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.content)) return data.content;
  return [];
}

async function lookupId(actualPath, { query, predicate = () => true, idKeys = ['id'] } = {}) {
  const res = await request('GET', actualPath, { query, auth: true });
  const rows = responseRows(res.body);
  const row = rows.find(predicate) || rows[0];
  if (!row) return ids.missingId;
  for (const key of idKeys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return row.id ?? ids.missingId;
}

async function request(method, actualPath, { query, body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url(actualPath, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, ok: response.status >= 200 && response.status < 300, body: parseBody(text), text };
}

async function run(method, specPath, options = {}) {
  const key = `${method} ${specPath}`;
  const opEntry = opMap.get(key);
  if (!opEntry) throw new Error(`OpenAPI operation not found: ${key}`);
  const auth = options.auth ?? !isPublic(method, specPath);
  const actualPath = options.actualPath || pathWithParams(specPath, options.pathParams);
  const base = {
    method,
    specPath,
    operationId: opEntry.op.operationId || '',
    apiName: opEntry.op.summary || opEntry.op.operationId || key,
    tag: (opEntry.op.tags || []).join(', '),
    url: url(actualPath, options.query),
    authRequired: auth,
    headers: docsHeaders(auth, options.body !== undefined),
    pathParameters: params(opEntry.op, 'path'),
    queryParameters: params(opEntry.op, 'query'),
    requestSchema: requestSchema(opEntry.op),
    responseSchema: responseSchema(opEntry.op),
    requestBody: options.body ?? null,
    successResponse: null,
    errorResponse: null,
    testResult: '',
    notes: options.note || '',
    status: null
  };

  if (options.skip) {
    results.set(key, {
      ...base,
      testResult: `SKIPPED: ${options.skipReason}`,
      notes: [base.notes, options.skipReason].filter(Boolean).join(' '),
      errorResponse: auth ? standardUnauthorized() : standardValidationError()
    });
    return null;
  }

  const res = await request(method, actualPath, { query: options.query, body: options.body, auth });
  const record = { ...base, status: res.status };
  if (res.ok) {
    record.successResponse = res.body;
    record.testResult = `PASS: HTTP ${res.status}`;
    if (options.expectFail) record.notes = [record.notes, 'Expected failure, but request succeeded.'].filter(Boolean).join(' ');
  } else {
    record.errorResponse = res.body;
    record.testResult = `${options.expectFail ? 'EXPECTED FAILURE' : 'FAIL'}: HTTP ${res.status}`;
  }
  results.set(key, record);
  return res;
}

function commonAddress() {
  return {
    addressLine1: 'API Test Address Line 1',
    addressLine2: 'API Test Address Line 2',
    city: 'Pune',
    stateId: ids.stateId,
    countryId: ids.countryId,
    pincode: '411001'
  };
}

async function main() {
  if (!TEST_USERNAME || !TEST_PASSWORD) {
    throw new Error('API_TEST_USERNAME and API_TEST_PASSWORD environment variables are required');
  }

  let res = await run('POST', '/api/v1/auth/login', {
    auth: false,
    body: { userName: TEST_USERNAME, password: TEST_PASSWORD }
  });
  token = res?.body?.data?.accessToken;
  if (!token) throw new Error(`Login did not return data.accessToken: ${JSON.stringify(res?.body)}`);

  const digits = runId.replace(/\D/g, '').slice(-9).padStart(9, '0');

  const org = { name: `API Test Organization ${runId}`, description: 'Created by API documentation test', logoUrl: '', address: 'API Test Address', status: true };
  res = await run('POST', '/api/v1/organizations', { auth: false, body: org, note: 'Public in SecurityConfig; OpenAPI still inherits global Bearer security.' });
  ids.testOrganizationId = extractId(res?.body, ['organizationId', 'id'])
    || await lookupId('/api/v1/organizations', { query: { search: org.name }, predicate: (r) => r.name === org.name });
  await run('PUT', '/api/v1/organizations/{id}', {
    actualPath: `/api/v1/organizations/${ids.testOrganizationId}`,
    pathParams: { id: ids.testOrganizationId },
    body: { ...org, name: `${org.name} Updated`, description: 'Updated by API documentation test' }
  });

  await run('POST', '/api/v1/users', {
    auth: false,
    note: 'Public in SecurityConfig. Test user was created inactive with status=false.',
    body: {
      firstName: 'Api',
      lastName: 'User',
      userName: `apitest_${runId}`.slice(0, 50),
      email: `apitest.user.${runId}@example.com`,
      mobileNo: `7${digits}`,
      roleId: ids.roleId,
      organizationId: ids.organizationId,
      password: 'ApiTest@12345',
      status: false
    }
  });

  const brand = { name: `API Test Brand ${runId}`, description: 'Created by API documentation test' };
  res = await run('POST', '/api/v1/brands', { body: brand });
  ids.brandId = extractId(res?.body, ['brandId', 'id'])
    || await lookupId('/api/v1/brands', { query: { search: brand.name }, predicate: (r) => r.name === brand.name });
  await run('PUT', '/api/v1/brands/{id}', { actualPath: `/api/v1/brands/${ids.brandId}`, pathParams: { id: ids.brandId }, body: { ...brand, name: `${brand.name} Updated`, description: 'Updated by API documentation test' } });

  const category = { name: `API Test Category ${runId}`, description: 'Created by API documentation test' };
  res = await run('POST', '/api/v1/categories', { body: category });
  ids.categoryId = extractId(res?.body, ['categoryId', 'id'])
    || await lookupId('/api/v1/categories', { query: { search: category.name }, predicate: (r) => r.name === category.name });
  await run('PUT', '/api/v1/categories/{id}', { actualPath: `/api/v1/categories/${ids.categoryId}`, pathParams: { id: ids.categoryId }, body: { ...category, name: `${category.name} Updated`, description: 'Updated by API documentation test' } });

  const unit = { name: `API Test Unit ${runId}`.slice(0, 100), shortName: `AT${runId.slice(-4)}`.slice(0, 20) };
  res = await run('POST', '/api/v1/units', { body: unit });
  ids.unitId = extractId(res?.body, ['unitId', 'id'])
    || await lookupId('/api/v1/units', { query: { search: unit.name }, predicate: (r) => r.name === unit.name });
  await run('PUT', '/api/v1/units/{id}', { actualPath: `/api/v1/units/${ids.unitId}`, pathParams: { id: ids.unitId }, body: { name: `${unit.name} Upd`.slice(0, 100), shortName: `AU${runId.slice(-4)}`.slice(0, 20) } });

  const warehouse = { name: `API Test Warehouse A ${runId}`.slice(0, 100), warehouseCode: `ATW1${runId.slice(-8)}`.slice(0, 50), description: 'Source warehouse for API documentation test', address: 'API Test Address A' };
  res = await run('POST', '/api/v1/warehouses', { body: warehouse });
  ids.warehouseId = extractId(res?.body, ['warehouseId', 'id'])
    || await lookupId('/api/v1/warehouses', { query: { search: warehouse.warehouseCode }, predicate: (r) => r.warehouseCode === warehouse.warehouseCode });
  await run('PUT', '/api/v1/warehouses/{id}', { actualPath: `/api/v1/warehouses/${ids.warehouseId}`, pathParams: { id: ids.warehouseId }, body: { ...warehouse, name: `API Test Warehouse A ${runId} Updated`.slice(0, 100), description: 'Updated source warehouse for API documentation test' } });
  const wh2 = await request('POST', '/api/v1/warehouses', {
    auth: true,
    body: { name: `API Test Warehouse B ${runId}`.slice(0, 100), warehouseCode: `ATW2${runId.slice(-8)}`.slice(0, 50), description: 'Destination warehouse for API documentation test', address: 'API Test Address B' }
  });
  const warehouse2Code = `ATW2${runId.slice(-8)}`.slice(0, 50);
  ids.warehouseToId = extractId(wh2.body, ['warehouseId', 'id'])
    || await lookupId('/api/v1/warehouses', { query: { search: warehouse2Code }, predicate: (r) => r.warehouseCode === warehouse2Code });

  const bankAccount = { bankName: 'API Test Bank', accountName: `API Test Account ${runId}`, accountNumber: `AC${runId}`.slice(0, 50), ifscCode: 'TEST0001234', branchName: 'API Test Branch', openingBalance: 0 };
  res = await run('POST', '/api/v1/bank-accounts', { body: bankAccount });
  ids.bankAccountId = extractId(res?.body, ['bankAccountId', 'id'])
    || await lookupId('/api/v1/bank-accounts', { predicate: (r) => r.accountNumber === bankAccount.accountNumber, idKeys: ['bankAccountId', 'id'] });

  const customer = {
    firstName: 'Api',
    lastName: 'Customer',
    email: `apitest.customer.${runId}@example.com`,
    phone: '0200000000',
    mobile: `9${digits}`,
    whatsappNo: `9${digits}`,
    gstNumber: '',
    panNumber: '',
    creditLimit: 1000,
    openingBalance: 0,
    openingBalanceType: 'RECEIVABLE',
    isWholesale: false,
    billingAddress: commonAddress(),
    shippingAddress: commonAddress()
  };
  res = await run('POST', '/api/v1/customers', { body: customer });
  ids.customerId = extractId(res?.body, ['customerId', 'id'])
    || await lookupId('/api/v1/customers', { query: { page: 0, size: 20, search: runId }, predicate: (r) => r.mobile === customer.mobile });
  await run('PUT', '/api/v1/customers/{id}', { actualPath: `/api/v1/customers/${ids.customerId}`, pathParams: { id: ids.customerId }, body: { ...customer, phone: '0200000001' } });

  const supplier = { firstName: 'Api', lastName: 'Supplier', mobile: `8${digits}`, email: `apitest.supplier.${runId}@example.com`, gstNumber: '', creditLimit: 1000, openingBalance: 0 };
  res = await run('POST', '/api/v1/suppliers', { body: supplier });
  ids.supplierId = extractId(res?.body, ['supplierId', 'id'])
    || await lookupId('/api/v1/suppliers', { query: { page: 0, size: 20, search: runId }, predicate: (r) => r.mobile === supplier.mobile });
  await run('PUT', '/api/v1/suppliers/{id}', { actualPath: `/api/v1/suppliers/${ids.supplierId}`, pathParams: { id: ids.supplierId }, body: supplier });

  const item = {
    itemName: `API Test Item ${runId}`,
    itemCode: `AIT${runId}`.slice(0, 50),
    sku: `SKU${runId}`.slice(0, 80),
    barcode: `BAR${runId}`.slice(0, 80),
    hsnCode: '1001',
    categoryId: ids.categoryId,
    subCategoryId: null,
    brandId: ids.brandId,
    baseUnitId: ids.unitId,
    secondaryUnitId: null,
    conversionRate: 1,
    purchasePrice: 50,
    purchasePriceWithTax: 55,
    taxPercentage: 10,
    salePrice: 75,
    wholesalePrice: 70,
    mrp: 80,
    msp: 60,
    discountPercentage: 0,
    profitMargin: 20,
    batchNo: `BATCH${runId}`.slice(0, 80),
    manufacturingDate: '2026-06-01',
    expiryDate: '2027-06-01',
    openingQuantity: 20,
    minimumStock: 5,
    warehouseId: ids.warehouseId,
    description: 'API documentation test item'
  };
  res = await run('POST', '/api/v1/items', { body: item });
  ids.itemId = extractId(res?.body, ['itemId', 'id'])
    || await lookupId('/api/v1/items', { query: { page: 0, size: 20, search: item.itemCode }, predicate: (r) => r.itemCode === item.itemCode });
  await run('PUT', '/api/v1/items/{id}', { actualPath: `/api/v1/items/${ids.itemId}`, pathParams: { id: ids.itemId }, body: { ...item, itemName: `API Test Item ${runId} Updated`, description: 'Updated API documentation test item' } });

  const purchase = {
    supplierId: ids.supplierId,
    purchaseDate: today,
    referenceNo: `API-PUR-${runId}`.slice(0, 100),
    warehouseId: ids.warehouseId,
    carrierId: null,
    stateId: ids.stateId,
    notes: 'API documentation test purchase',
    items: [{ itemId: ids.itemId, batchNo: `PURB${runId}`.slice(0, 80), manufacturingDate: '2026-06-01', expiryDate: '2027-06-01', quantity: 3, unitPrice: 50, discountPercent: 0, taxPercent: 0 }]
  };
  res = await run('POST', '/api/v1/purchases', { body: purchase });
  ids.purchaseId = extractId(res?.body, ['purchaseId', 'id'])
    || await lookupId('/api/v1/purchases', { query: { page: 0, size: 20, search: purchase.referenceNo, fromDate, toDate }, idKeys: ['purchaseId', 'id'] });
  await run('PUT', '/api/v1/purchases/{id}', { actualPath: `/api/v1/purchases/${ids.purchaseId}`, pathParams: { id: ids.purchaseId }, body: { ...purchase, referenceNo: `API-PUR-UPD-${runId}`.slice(0, 100), notes: 'Updated API documentation test purchase' } });
  res = await run('GET', '/api/v1/purchases/{id}', { actualPath: `/api/v1/purchases/${ids.purchaseId}`, pathParams: { id: ids.purchaseId } });
  ids.batchId = res?.body?.data?.items?.[0]?.batchId || ids.missingId;

  const sale = {
    customerId: ids.customerId,
    invoiceDate: today,
    warehouseId: ids.warehouseId,
    stateId: ids.stateId,
    salesPersonId: ids.userId,
    notes: 'API documentation test sale',
    items: [{ itemId: ids.itemId, batchId: ids.batchId, quantity: 1, unitPrice: 75, discountPercent: 0, taxPercent: 0 }]
  };
  res = await run('POST', '/api/v1/sales', { body: sale });
  ids.saleId = extractId(res?.body, ['saleId', 'id'])
    || await lookupId('/api/v1/sales', { query: { page: 0, size: 20, search: runId, fromDate, toDate }, idKeys: ['saleId', 'id'] });
  await run('PUT', '/api/v1/sales/{id}', { actualPath: `/api/v1/sales/${ids.saleId}`, pathParams: { id: ids.saleId }, body: { ...sale, notes: 'Updated API documentation test sale' } });

  const salesReturn = { saleId: ids.saleId, customerId: ids.customerId, returnDate: today, reason: 'API documentation test sales return', items: [{ itemId: ids.itemId, batchId: ids.batchId, quantity: 1, rate: 75 }] };
  res = await run('POST', '/api/v1/sales-returns', { body: salesReturn });
  ids.salesReturnId = extractId(res?.body, ['returnId', 'id'])
    || await lookupId('/api/v1/sales-returns', { query: { page: 0, size: 1 }, idKeys: ['returnId', 'id'] });
  const purchaseReturn = { purchaseId: ids.purchaseId, supplierId: ids.supplierId, returnDate: today, reason: 'API documentation test purchase return', items: [{ itemId: ids.itemId, batchId: ids.batchId, quantity: 1, rate: 50 }] };
  res = await run('POST', '/api/v1/purchase-returns', { body: purchaseReturn });
  ids.purchaseReturnId = extractId(res?.body, ['returnId', 'id'])
    || await lookupId('/api/v1/purchase-returns', { query: { page: 0, size: 1 }, idKeys: ['returnId', 'id'] });

  const stock = await request('GET', `/api/v1/items/${ids.itemId}/stock`, { auth: true });
  const qty = Number(stock.body?.data?.availableQty ?? 20);
  const adjustment = { warehouseId: ids.warehouseId, adjustmentDate: today, reason: 'API documentation test no-op stock adjustment', items: [{ itemId: ids.itemId, currentQty: qty, actualQty: qty }] };
  res = await run('POST', '/api/v1/stocks/adjustments', { body: adjustment, note: 'No-op adjustment: currentQty equals actualQty to avoid changing stock quantity.' });
  ids.stockAdjustmentId = extractId(res?.body, ['adjustmentId', 'id'])
    || await lookupId('/api/v1/stocks/adjustments', { query: { page: 0, size: 1 }, idKeys: ['adjustmentId', 'id'] });
  const transfer = { fromWarehouseId: ids.warehouseId, toWarehouseId: ids.warehouseToId, transferDate: today, notes: 'API documentation test stock transfer', items: [{ itemId: ids.itemId, quantity: 1 }] };
  res = await run('POST', '/api/v1/stocks/transfers', { body: transfer, note: 'Transferred quantity 1 between API-test warehouses.' });
  ids.stockTransferId = extractId(res?.body, ['transferId', 'id'])
    || await lookupId('/api/v1/stocks/transfers', { query: { page: 0, size: 1 }, idKeys: ['transferId', 'id'] });

  const expense = { expenseCategoryId: 1, expenseDate: today, amount: 10, paymentMethodId: 1, notes: 'API documentation test expense' };
  await run('POST', '/api/v1/expenses', { body: expense, expectFail: true, note: 'Fails because expense_categories and payment_methods lookup rows are absent and no HTTP lookup API is exposed.' });
  await run('PUT', '/api/v1/expenses/{id}', { actualPath: `/api/v1/expenses/${ids.missingId}`, pathParams: { id: ids.missingId }, body: expense, expectFail: true, note: 'No valid expenseId because create is blocked by missing lookup seed data.' });
  const paymentIn = { customerId: ids.customerId, paymentDate: today, paymentMethodId: 1, referenceNo: `API-PIN-${runId}`.slice(0, 100), amount: 10, notes: 'API documentation test payment in', saleIds: [ids.saleId] };
  await run('POST', '/api/v1/payment-in', { body: paymentIn, expectFail: true, note: 'Fails because payment_methods lookup rows are absent and no HTTP lookup API is exposed.' });
  const paymentOut = { supplierId: ids.supplierId, paymentDate: today, paymentMethodId: 1, referenceNo: `API-POUT-${runId}`.slice(0, 100), amount: 10, notes: 'API documentation test payment out', purchaseIds: [ids.purchaseId] };
  await run('POST', '/api/v1/payment-out', { body: paymentOut, expectFail: true, note: 'Fails because payment_methods lookup rows are absent and no HTTP lookup API is exposed.' });
  await run('POST', '/api/v1/pos/billing', { body: { customerId: ids.customerId, warehouseId: ids.warehouseId, paymentMethodId: 1, items: [{ itemId: ids.itemId, quantity: 1 }] }, expectFail: true, note: 'Fails because payment_methods lookup rows are absent and no HTTP lookup API is exposed.' });

  await runGets();
  await markSkippedDeletesAndCancels();
  fillMissed();
  writeDocs();
}

async function runGets() {
  await run('GET', '/api/v1/organizations', { query: { search: 'API' } });
  await run('GET', '/api/v1/organizations/{id}', { actualPath: `/api/v1/organizations/${ids.testOrganizationId}`, pathParams: { id: ids.testOrganizationId } });
  await run('GET', '/api/v1/brands', { query: { search: 'API' } });
  await run('GET', '/api/v1/categories', { query: { search: 'API' } });
  await run('GET', '/api/v1/units', { query: { search: 'API' } });
  await run('GET', '/api/v1/warehouses', { query: { search: 'API' } });
  await run('GET', '/api/v1/bank-accounts');
  await run('GET', '/api/v1/bank-accounts/{id}/transactions', { actualPath: `/api/v1/bank-accounts/${ids.bankAccountId}/transactions`, pathParams: { id: ids.bankAccountId } });
  await run('GET', '/api/v1/customers', { query: { page: 0, size: 5, search: 'API' } });
  await run('GET', '/api/v1/customers/{id}', { actualPath: `/api/v1/customers/${ids.customerId}`, pathParams: { id: ids.customerId } });
  await run('GET', '/api/v1/customers/{id}/ledger', { actualPath: `/api/v1/customers/${ids.customerId}/ledger`, pathParams: { id: ids.customerId } });
  await run('GET', '/api/v1/suppliers', { query: { page: 0, size: 5, search: 'API' } });
  await run('GET', '/api/v1/suppliers/{id}', { actualPath: `/api/v1/suppliers/${ids.supplierId}`, pathParams: { id: ids.supplierId } });
  await run('GET', '/api/v1/suppliers/{id}/ledger', { actualPath: `/api/v1/suppliers/${ids.supplierId}/ledger`, pathParams: { id: ids.supplierId } });
  await run('GET', '/api/v1/items', { query: { page: 0, size: 5, search: 'API' } });
  await run('GET', '/api/v1/items/{id}', { actualPath: `/api/v1/items/${ids.itemId}`, pathParams: { id: ids.itemId } });
  await run('GET', '/api/v1/items/{id}/stock', { actualPath: `/api/v1/items/${ids.itemId}/stock`, pathParams: { id: ids.itemId } });
  await run('GET', '/api/v1/purchases', { query: { page: 0, size: 5, search: 'API', fromDate, toDate } });
  await run('GET', '/api/v1/sales', { query: { page: 0, size: 5, search: 'API', fromDate, toDate } });
  await run('GET', '/api/v1/sales/{id}', { actualPath: `/api/v1/sales/${ids.saleId}`, pathParams: { id: ids.saleId } });
  await run('GET', '/api/v1/sales/{id}/invoice', { actualPath: `/api/v1/sales/${ids.saleId}/invoice`, pathParams: { id: ids.saleId } });
  await run('GET', '/api/v1/purchase-returns', { query: { page: 0, size: 5 } });
  await run('GET', '/api/v1/purchase-returns/{id}', { actualPath: `/api/v1/purchase-returns/${ids.purchaseReturnId}`, pathParams: { id: ids.purchaseReturnId } });
  await run('GET', '/api/v1/sales-returns', { query: { page: 0, size: 5 } });
  await run('GET', '/api/v1/sales-returns/{id}', { actualPath: `/api/v1/sales-returns/${ids.salesReturnId}`, pathParams: { id: ids.salesReturnId } });
  await run('GET', '/api/v1/stocks/adjustments', { query: { page: 0, size: 5 } });
  await run('GET', '/api/v1/stocks/adjustments/{id}', { actualPath: `/api/v1/stocks/adjustments/${ids.stockAdjustmentId}`, pathParams: { id: ids.stockAdjustmentId } });
  await run('GET', '/api/v1/stocks/transfers', { query: { page: 0, size: 5 } });
  await run('GET', '/api/v1/stocks/transfers/{id}', { actualPath: `/api/v1/stocks/transfers/${ids.stockTransferId}`, pathParams: { id: ids.stockTransferId } });
  await run('GET', '/api/v1/expenses', { query: { page: 0, size: 5 } });
  await run('GET', '/api/v1/expenses/{id}', { actualPath: `/api/v1/expenses/${ids.missingId}`, pathParams: { id: ids.missingId }, expectFail: true, note: 'No valid expenseId because create is blocked by missing lookup seed data.' });
  await run('GET', '/api/v1/payment-in', { query: { page: 0, size: 5 } });
  await run('GET', '/api/v1/payment-in/{id}', { actualPath: `/api/v1/payment-in/${ids.missingId}`, pathParams: { id: ids.missingId }, expectFail: true, note: 'No valid paymentInId because create is blocked by missing payment method seed data.' });
  await run('GET', '/api/v1/payment-out', { query: { page: 0, size: 5 } });
  await run('GET', '/api/v1/payment-out/{id}', { actualPath: `/api/v1/payment-out/${ids.missingId}`, pathParams: { id: ids.missingId }, expectFail: true, note: 'No valid paymentOutId because create is blocked by missing payment method seed data.' });
  await run('GET', '/api/v1/cash/summary', { expectFail: true, note: 'Fails with 500. Source cause: CashServiceImpl.getSummary is readOnly but FinanceSupport.cashSummary can insert a CashAccount via getOrCreateCashAccount when none exists.' });
  await run('GET', '/api/v1/cash/transactions');
  await run('GET', '/api/v1/dashboard/summary', { expectFail: true, note: 'Fails with 500 for the same cash account readOnly insert path used by financeSupport.totalCashBalance().' });
  await run('GET', '/api/v1/reports/customer-ledger/{customerId}', { actualPath: `/api/v1/reports/customer-ledger/${ids.customerId}`, pathParams: { customerId: ids.customerId } });
  await run('GET', '/api/v1/reports/supplier-ledger/{supplierId}', { actualPath: `/api/v1/reports/supplier-ledger/${ids.supplierId}`, pathParams: { supplierId: ids.supplierId } });
  await run('GET', '/api/v1/reports/day-book', { query: { date: today } });
  await run('GET', '/api/v1/reports/gst', { query: { fromDate, toDate } });
  await run('GET', '/api/v1/reports/inventory-valuation');
  await run('GET', '/api/v1/reports/low-stock');
  await run('GET', '/api/v1/reports/profit-loss', { query: { fromDate, toDate } });
  await run('GET', '/api/v1/reports/purchases', { query: { fromDate, toDate } });
  await run('GET', '/api/v1/reports/sales', { query: { fromDate, toDate } });
  await run('GET', '/api/v1/reports/stocks');
  await run('GET', '/api/v1/reports/top-selling-items');
}

async function markSkippedDeletesAndCancels() {
  const deleteOps = [
    ['/api/v1/brands/{id}', ids.brandId],
    ['/api/v1/categories/{id}', ids.categoryId],
    ['/api/v1/customers/{id}', ids.customerId],
    ['/api/v1/expenses/{id}', ids.missingId],
    ['/api/v1/items/{id}', ids.itemId],
    ['/api/v1/organizations/{id}', ids.testOrganizationId],
    ['/api/v1/suppliers/{id}', ids.supplierId],
    ['/api/v1/units/{id}', ids.unitId],
    ['/api/v1/warehouses/{id}', ids.warehouseId]
  ];
  for (const [path, id] of deleteOps) {
    await run('DELETE', path, {
      actualPath: path.replace('{id}', id),
      pathParams: { id },
      skip: true,
      skipReason: 'DELETE endpoint can remove or deactivate business data; not executed per safe-test instruction.'
    });
  }
  await run('PUT', '/api/v1/purchases/{id}/cancel', {
    actualPath: `/api/v1/purchases/${ids.purchaseId}/cancel`,
    pathParams: { id: ids.purchaseId },
    skip: true,
    skipReason: 'Cancel reverses stock and changes purchase status; not executed per safe-test instruction.'
  });
  await run('PUT', '/api/v1/sales/{id}/cancel', {
    actualPath: `/api/v1/sales/${ids.saleId}/cancel`,
    pathParams: { id: ids.saleId },
    skip: true,
    skipReason: 'Cancel reverses stock and changes sale status; not executed per safe-test instruction.'
  });
}

function fillMissed() {
  for (const o of ops) {
    const key = `${o.method} ${o.path}`;
    if (results.has(key)) continue;
    const auth = !isPublic(o.method, o.path);
    results.set(key, {
      method: o.method,
      specPath: o.path,
      operationId: o.op.operationId || '',
      apiName: o.op.summary || o.op.operationId || key,
      tag: (o.op.tags || []).join(', '),
      url: url(pathWithParams(o.path), null),
      authRequired: auth,
      headers: docsHeaders(auth, !!requestSchema(o.op)),
      pathParameters: params(o.op, 'path'),
      queryParameters: params(o.op, 'query'),
      requestSchema: requestSchema(o.op),
      responseSchema: responseSchema(o.op),
      requestBody: null,
      successResponse: null,
      errorResponse: null,
      testResult: 'NOT RUN: operation was discovered but not mapped in runner',
      notes: 'Runner mapping gap; review script.',
      status: null
    });
  }
}

function compact(value) {
  const safe = sanitize(value);
  function trim(v) {
    if (Array.isArray(v)) return v.slice(0, 3).map(trim);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, trim(val)]));
    return v;
  }
  return trim(safe);
}

function notObserved(record) {
  return { notObserved: true, schema: record.responseSchema || null, reason: record.testResult.startsWith('SKIPPED') ? 'Skipped by safe-test policy' : 'No successful response observed in this run' };
}

function curl(record) {
  const parts = [`curl -X ${record.method} '${record.url}'`];
  for (const [k, v] of Object.entries(record.headers || {})) parts.push(`  -H '${k}: ${v}'`);
  if (record.requestBody) parts.push(`  -d '${JSON.stringify(sanitize(record.requestBody))}'`);
  return parts.join(' \\\n');
}

function writeDocs() {
  const records = Array.from(results.values()).sort((a, b) => `${a.specPath} ${a.method}`.localeCompare(`${b.specPath} ${b.method}`));
  const summary = {
    baseUrlRequested: 'http://localhost:8080',
    baseUrlTested: BASE,
    openapiTitle: spec.info?.title,
    openapiVersion: spec.openapi,
    operationCount: ops.length,
    resultCount: records.length,
    passed: records.filter((r) => r.testResult.startsWith('PASS')).length,
    expectedFailures: records.filter((r) => r.testResult.startsWith('EXPECTED FAILURE')).length,
    failed: records.filter((r) => r.testResult.startsWith('FAIL')).length,
    skipped: records.filter((r) => r.testResult.startsWith('SKIPPED')).length,
    notRun: records.filter((r) => r.testResult.startsWith('NOT RUN')).length,
    testRunId: runId,
    createdIds: ids
  };

  fs.writeFileSync('api-test-results.json', JSON.stringify({ summary, records: records.map((r) => ({ ...r, requestBody: sanitize(r.requestBody), successResponse: sanitize(r.successResponse), errorResponse: sanitize(r.errorResponse) })) }, null, 2));

  const md = [];
  md.push('# BillTop API Documentation and Local Test Report', '');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push(`OpenAPI: ${spec.info?.title || ''} (${spec.openapi || ''})`);
  md.push('Requested base URL: `http://localhost:8080`');
  md.push(`Tested base URL: \`${BASE}\``);
  md.push(`Swagger/OpenAPI JSON tested from: \`${BASE}/v3/api-docs\``);
  md.push(`Operations discovered: ${ops.length}`);
  md.push(`Test run ID: \`${runId}\``, '');
  md.push('## Important Findings', '');
  md.push('- `http://localhost:8080` was not reachable. The running Spring Boot app listens on `8081`, matching `server.port=8081` in `application.properties`.');
  md.push('- OpenAPI declares global Bearer security for every operation, but Spring Security permits `/api/v1/auth/**`, `POST /api/v1/users`, and `POST /api/v1/organizations` without authentication.');
  md.push('- `payment_methods`, `expense_categories`, and `cash_accounts` had no rows before testing. Payment, POS, and expense create APIs cannot succeed through HTTP without lookup seed data or lookup CRUD APIs.');
  md.push('- Most create endpoints return `ApiResponseDto<Void>` with only success/message/timestamp. Clients must do a follow-up search to find the created ID; returning the created ID or a `Location` header would make the API easier to consume.');
  md.push('- `GET /api/v1/cash/summary` and `GET /api/v1/dashboard/summary` return HTTP 500 when no cash account exists. `FinanceSupport.cashSummary()` attempts to create a cash account inside read-only service methods.');
  md.push('- DELETE and cancel APIs were not executed because they delete/deactivate records or reverse stock/ledger state.', '');
  md.push('## Result Summary', '');
  md.push('| Metric | Count |', '|---|---:|');
  md.push(`| Passed | ${summary.passed} |`);
  md.push(`| Expected failures | ${summary.expectedFailures} |`);
  md.push(`| Failed | ${summary.failed} |`);
  md.push(`| Skipped | ${summary.skipped} |`);
  md.push(`| Not run | ${summary.notRun} |`, '');
  md.push('## Authentication', '');
  md.push('- Login endpoint: `POST /api/v1/auth/login`.');
  md.push('- Token field: `data.accessToken`.');
  md.push('- Secured request header: `Authorization: Bearer <JWT_TOKEN>`.');
  md.push('- Standard secured error response observed without token:', '', '```json');
  md.push(JSON.stringify(standardUnauthorized(), null, 2), '```', '');
  md.push('## Endpoint Details', '');

  for (const record of records) {
    const success = record.successResponse ? compact(record.successResponse) : notObserved(record);
    const error = record.errorResponse ? compact(record.errorResponse) : (record.authRequired ? standardUnauthorized() : standardValidationError());
    md.push(`### ${record.apiName}`, '');
    md.push(`- API Name: ${record.apiName}`);
    md.push(`- Operation ID: \`${record.operationId || 'n/a'}\``);
    md.push(`- Tag: \`${record.tag || 'n/a'}\``);
    md.push(`- HTTP Method: \`${record.method}\``);
    md.push(`- URL: \`${record.url}\``);
    md.push(`- Auth Required: ${record.authRequired ? 'Yes' : 'No'}`);
    md.push(`- Request Schema: \`${record.requestSchema || 'None'}\``);
    md.push(`- Response Schema: \`${record.responseSchema || 'None'}\``);
    md.push(`- Test Result: ${record.testResult}`);
    if (record.notes) md.push(`- Notes/Fixes: ${record.notes}`);
    md.push('', 'Headers:', '', '```json', JSON.stringify(record.headers, null, 2), '```', '');
    md.push('Path Parameters:', '', '```json', JSON.stringify(record.pathParameters || [], null, 2), '```', '');
    md.push('Query Parameters:', '', '```json', JSON.stringify(record.queryParameters || [], null, 2), '```', '');
    md.push('Request Body JSON:', '', '```json', record.requestBody ? JSON.stringify(sanitize(record.requestBody), null, 2) : 'null', '```', '');
    md.push('Curl-style Test Request:', '', '```bash', curl(record), '```', '');
    md.push('Success Response JSON:', '', '```json', JSON.stringify(success, null, 2), '```', '');
    md.push('Error Response JSON:', '', '```json', JSON.stringify(error, null, 2), '```', '');
  }

  md.push('## Suggested Spring Boot Fixes', '');
  md.push('1. Change `server.port` to `8080` or update client documentation to `8081`. Current runtime is `8081`.');
  md.push('2. Add OpenAPI security overrides for public endpoints so Swagger does not require Bearer for login, user creation, or organization creation.');
  md.push('3. Seed required lookup rows using Flyway, at minimum `payment_methods`, `expense_categories`, and an initial `cash_accounts` row per organization, or expose secured CRUD/list APIs for those lookup tables.');
  md.push('4. Return created resource IDs from POST endpoints or set a `Location` header so clients do not need follow-up searches.');
  md.push('5. Fix cash summary by avoiding writes in read-only transactions. Either create default cash account during organization setup/migration or remove `@Transactional(readOnly = true)` from paths that call `getOrCreateCashAccount()` and initialize explicitly.');
  md.push('6. Log unexpected exceptions in `GlobalExceptionHandler.handleUnexpected` so HTTP 500 defects are diagnosable from server logs.');
  md.push('');
  fs.writeFileSync('API_DOCUMENTATION.md', md.join('\n'), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
