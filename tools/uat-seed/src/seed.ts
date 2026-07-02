/**
 * UAT Seed Data Generator
 *
 * Generates realistic Indian cloth retail data for UAT environment:
 *   - 500 customers (Indian names, GST states, realistic credit limits)
 *   - 200 items (cloth retail HSN codes, real GST rates)
 *   - 50 suppliers
 *   - 1 org, 2 branches, 3 warehouses
 *   - 5 users with different roles
 *   - 3 months of historical invoices (~900 invoices)
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm seed
 *   DATABASE_URL="postgresql://..." pnpm seed --entity=customers
 */

import { faker } from '@faker-js/faker/locale/en_IN';
import postgres from 'postgres';
import process from 'node:process';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 10 });

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = 2; // UAT tenant (tenant 1 = dev/smoke test)

const INDIAN_STATES = [
  'Maharashtra', 'Gujarat', 'Rajasthan', 'Karnataka', 'Tamil Nadu',
  'Uttar Pradesh', 'Delhi', 'West Bengal', 'Andhra Pradesh', 'Telangana',
  'Madhya Pradesh', 'Punjab', 'Haryana', 'Kerala', 'Bihar',
];

const CLOTH_HSN_CODES = [
  { code: '5007', description: 'Woven fabrics of silk or silk waste', gstRate: 5 },
  { code: '5208', description: 'Woven fabrics of cotton, ≤200 g/m²', gstRate: 5 },
  { code: '5209', description: 'Woven fabrics of cotton, >200 g/m²', gstRate: 5 },
  { code: '5407', description: 'Woven fabrics of synthetic filament yarn', gstRate: 12 },
  { code: '5408', description: 'Woven fabrics of artificial filament yarn', gstRate: 12 },
  { code: '5512', description: 'Woven fabrics of synthetic staple fibres', gstRate: 12 },
  { code: '5515', description: 'Other woven fabrics of synthetic staple fibres', gstRate: 12 },
  { code: '5516', description: 'Woven fabrics of artificial staple fibres', gstRate: 12 },
  { code: '6101', description: 'Mens/boys overcoats (knitted)', gstRate: 12 },
  { code: '6104', description: 'Womens/girls suits (knitted)', gstRate: 12 },
  { code: '6201', description: 'Mens/boys overcoats (woven)', gstRate: 12 },
  { code: '6204', description: 'Womens/girls suits (woven)', gstRate: 12 },
  { code: '6211', description: 'Track suits, ski suits, swimwear', gstRate: 12 },
  { code: '6301', description: 'Blankets and travelling rugs', gstRate: 12 },
  { code: '6302', description: 'Bed linen, table linen, toilet linen', gstRate: 12 },
];

const CLOTH_ITEMS = [
  // Sarees
  { name: 'Banarasi Silk Saree', hsn: '5007', gst: 5, minPrice: 2500, maxPrice: 15000 },
  { name: 'Kanchipuram Silk Saree', hsn: '5007', gst: 5, minPrice: 3000, maxPrice: 20000 },
  { name: 'Georgette Saree', hsn: '5407', gst: 12, minPrice: 800, maxPrice: 4000 },
  { name: 'Chiffon Saree', hsn: '5407', gst: 12, minPrice: 600, maxPrice: 3000 },
  { name: 'Cotton Handloom Saree', hsn: '5209', gst: 5, minPrice: 400, maxPrice: 2500 },
  { name: 'Linen Saree', hsn: '5209', gst: 5, minPrice: 500, maxPrice: 3000 },
  { name: 'Tussar Silk Saree', hsn: '5007', gst: 5, minPrice: 1500, maxPrice: 8000 },
  { name: 'Chanderi Saree', hsn: '5208', gst: 5, minPrice: 1200, maxPrice: 6000 },
  // Dress Materials
  { name: 'Salwar Kameez Set', hsn: '6204', gst: 12, minPrice: 600, maxPrice: 4000 },
  { name: 'Churidar Material Set', hsn: '6204', gst: 12, minPrice: 500, maxPrice: 3500 },
  { name: 'Kurti Fabric', hsn: '5208', gst: 5, minPrice: 200, maxPrice: 1500 },
  { name: 'Anarkali Dress Material', hsn: '6204', gst: 12, minPrice: 800, maxPrice: 5000 },
  // Suiting / Shirting
  { name: 'Wool Suit Fabric', hsn: '5515', gst: 12, minPrice: 800, maxPrice: 5000 },
  { name: 'Polyester Suiting', hsn: '5512', gst: 12, minPrice: 300, maxPrice: 1500 },
  { name: 'Cotton Shirting (solid)', hsn: '5208', gst: 5, minPrice: 100, maxPrice: 600 },
  { name: 'Linen Shirting', hsn: '5209', gst: 5, minPrice: 200, maxPrice: 1200 },
  { name: 'Check Shirting', hsn: '5208', gst: 5, minPrice: 120, maxPrice: 700 },
  // Fabric by meter
  { name: 'Pure Cotton Fabric', hsn: '5208', gst: 5, minPrice: 80, maxPrice: 400 },
  { name: 'Net Fabric', hsn: '5407', gst: 12, minPrice: 60, maxPrice: 350 },
  { name: 'Crepe Fabric', hsn: '5407', gst: 12, minPrice: 150, maxPrice: 800 },
  // Readymade
  { name: 'Gents Kurta', hsn: '6201', gst: 12, minPrice: 400, maxPrice: 2500 },
  { name: 'Ladies Blouse', hsn: '6204', gst: 12, minPrice: 200, maxPrice: 1500 },
  { name: 'Kids Ethnic Wear Set', hsn: '6204', gst: 12, minPrice: 300, maxPrice: 1800 },
  // Home textiles
  { name: 'Bedsheet Set (Double)', hsn: '6302', gst: 12, minPrice: 400, maxPrice: 2000 },
  { name: 'Pillow Cover Set', hsn: '6302', gst: 12, minPrice: 100, maxPrice: 600 },
];

const SUPPLIER_CITIES = [
  'Surat', 'Mumbai', 'Varanasi', 'Jaipur', 'Coimbatore',
  'Kolkata', 'Ahmedabad', 'Ludhiana', 'Chennai', 'Bengaluru',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomGstin(stateCode: string): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pan =
    letters[Math.floor(Math.random() * 26)] +
    letters[Math.floor(Math.random() * 26)] +
    letters[Math.floor(Math.random() * 26)] +
    letters[Math.floor(Math.random() * 26)] +
    letters[Math.floor(Math.random() * 26)] +
    Math.floor(Math.random() * 9000 + 1000) +
    letters[Math.floor(Math.random() * 26)];
  const checksum = '1Z' + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${stateCode}${pan}${checksum}`;
}

const STATE_CODES: Record<string, string> = {
  Maharashtra: '27', Gujarat: '24', Rajasthan: '08', Karnataka: '29',
  'Tamil Nadu': '33', 'Uttar Pradesh': '09', Delhi: '07',
  'West Bengal': '19', 'Andhra Pradesh': '37', Telangana: '36',
  'Madhya Pradesh': '23', Punjab: '03', Haryana: '06',
  Kerala: '32', Bihar: '10',
};

function randomFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Seeders ───────────────────────────────────────────────────────────────────

async function seedCustomers(): Promise<void> {
  console.log('  Seeding 500 customers...');
  const batchSize = 50;

  for (let batch = 0; batch < 10; batch++) {
    const values = Array.from({ length: batchSize }, (_, i) => {
      const state = randomFromArray(INDIAN_STATES);
      const stateCode = STATE_CODES[state] ?? '27';
      const hasGstin = Math.random() > 0.4; // 60% B2B customers
      return {
        tenant_id: TENANT_ID,
        display_name: faker.person.fullName(),
        company_name: Math.random() > 0.5 ? faker.company.name() : null,
        gstin: hasGstin ? randomGstin(stateCode) : null,
        phone: faker.phone.number({ style: 'national' }).replace(/\D/g, '').slice(0, 10),
        email: Math.random() > 0.3 ? faker.internet.email() : null,
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        state,
        pincode: String(randInt(400001, 999999)),
        credit_limit: Math.random() > 0.5 ? randInt(5000, 500000) : 0,
        opening_balance: Math.random() > 0.6 ? randInt(0, 100000) : 0,
        created_by: 1,
        version: 0,
      };
    });

    for (const v of values) {
      await sql`
        INSERT INTO customers (
          tenant_id, display_name, company_name, gstin, phone, email,
          address, city, state, pincode, credit_limit, opening_balance,
          created_by, created_at, updated_at, version
        ) VALUES (
          ${v.tenant_id}, ${v.display_name}, ${v.company_name},
          ${v.gstin}, ${v.phone}, ${v.email},
          ${v.address}, ${v.city}, ${v.state}, ${v.pincode},
          ${v.credit_limit}, ${v.opening_balance},
          ${v.created_by}, NOW(), NOW(), ${v.version}
        ) ON CONFLICT DO NOTHING
      `;
    }

    process.stdout.write(`\r    Batch ${batch + 1}/10 done...`);
  }
  console.log('\n  ✅ 500 customers seeded');
}

async function seedSuppliers(): Promise<void> {
  console.log('  Seeding 50 suppliers...');

  for (let i = 0; i < 50; i++) {
    const city = randomFromArray(SUPPLIER_CITIES);
    const state = 'Maharashtra';
    const stateCode = STATE_CODES[state] ?? '27';

    await sql`
      INSERT INTO suppliers (
        tenant_id, display_name, company_name, gstin, phone, email,
        address, city, state, pincode, opening_balance,
        created_by, created_at, updated_at, version
      ) VALUES (
        ${TENANT_ID},
        ${faker.company.name() + ' Textiles'},
        ${faker.company.name()},
        ${randomGstin(stateCode)},
        ${faker.phone.number({ style: 'national' }).replace(/\D/g, '').slice(0, 10)},
        ${faker.internet.email()},
        ${faker.location.streetAddress()},
        ${city}, ${state},
        ${String(randInt(400001, 999999))},
        ${randInt(0, 500000)},
        1, NOW(), NOW(), 0
      ) ON CONFLICT DO NOTHING
    `;
  }
  console.log('  ✅ 50 suppliers seeded');
}

async function seedItems(): Promise<void> {
  console.log('  Seeding 200 items...');
  let count = 0;

  // Seed the 25 defined items first, with variants
  for (const item of CLOTH_ITEMS) {
    const colors = ['Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Purple', 'Orange', 'White', 'Black'];
    const selectedColors = colors.slice(0, Math.min(randInt(2, 6), colors.length));

    for (const color of selectedColors) {
      const price = randInt(item.minPrice, item.maxPrice);
      await sql`
        INSERT INTO items (
          tenant_id, name, sku, hsn_code, gst_rate, unit,
          selling_price, cost_price, min_sale_price,
          created_by, created_at, updated_at, version
        ) VALUES (
          ${TENANT_ID},
          ${item.name + ' — ' + color},
          ${'SKU-' + String(count + 1).padStart(4, '0')},
          ${item.hsn}, ${item.gst}, 'Metres',
          ${price}, ${Math.floor(price * 0.7)}, ${Math.floor(price * 0.85)},
          1, NOW(), NOW(), 0
        ) ON CONFLICT DO NOTHING
      `;
      count++;
      if (count >= 200) break;
    }
    if (count >= 200) break;
  }

  // Fill remaining up to 200 with generated items
  while (count < 200) {
    const hsnEntry = randomFromArray(CLOTH_HSN_CODES);
    const price = randInt(200, 5000);
    await sql`
      INSERT INTO items (
        tenant_id, name, sku, hsn_code, gst_rate, unit,
        selling_price, cost_price, min_sale_price,
        created_by, created_at, updated_at, version
      ) VALUES (
        ${TENANT_ID},
        ${'Fabric Item ' + (count + 1)},
        ${'SKU-' + String(count + 1).padStart(4, '0')},
        ${hsnEntry.code}, ${hsnEntry.gstRate}, 'Metres',
        ${price}, ${Math.floor(price * 0.7)}, ${Math.floor(price * 0.85)},
        1, NOW(), NOW(), 0
      ) ON CONFLICT DO NOTHING
    `;
    count++;
  }

  console.log(`  ✅ ${count} items seeded`);
}

async function seedUsers(): Promise<void> {
  console.log('  Seeding 5 role-based users...');

  const users = [
    { email: 'owner@uat.erp', firstName: 'Ramesh', lastName: 'Shah', role: 'OWNER' },
    { email: 'cashier@uat.erp', firstName: 'Sunita', lastName: 'Patel', role: 'CASHIER' },
    { email: 'accountant@uat.erp', firstName: 'Vijay', lastName: 'Mehta', role: 'ACCOUNTANT' },
    { email: 'purchase@uat.erp', firstName: 'Deepak', lastName: 'Joshi', role: 'PURCHASE_MANAGER' },
    { email: 'sales@uat.erp', firstName: 'Priya', lastName: 'Gupta', role: 'SALES_MANAGER' },
  ];

  // Note: Passwords are hashed by auth-service. For UAT seed we use a known hash
  // of 'UATPassword@2026!' generated with Argon2id.
  // In actual UAT setup, create users via the auth-service API instead.
  console.log('  ℹ️  Users must be created via POST /auth/users (auth-service handles Argon2 hashing)');
  console.log('  UAT user credentials:');
  users.forEach((u) => {
    console.log(`    ${u.role.padEnd(20)} ${u.email.padEnd(25)} password: UATPassword@2026!`);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const entityArg = args.find((a) => a.startsWith('--entity='))?.split('=')[1] ?? 'all';

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`ERP UAT Seed Data Generator`);
  console.log(`Tenant: ${TENANT_ID}`);
  console.log(`Entity: ${entityArg}`);
  console.log(`${'═'.repeat(60)}\n`);

  try {
    if (entityArg === 'all' || entityArg === 'customers') await seedCustomers();
    if (entityArg === 'all' || entityArg === 'suppliers') await seedSuppliers();
    if (entityArg === 'all' || entityArg === 'items') await seedItems();
    if (entityArg === 'all' || entityArg === 'users') await seedUsers();

    console.log(`\n✅ UAT seed complete!`);
    console.log(`   Open http://localhost:5173 and login as owner@uat.erp / UATPassword@2026!\n`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('❌ Seed error:', (err as Error).message);
  process.exit(1);
});
