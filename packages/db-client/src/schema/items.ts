import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
  decimal,
} from 'drizzle-orm/pg-core';

// ─── Categories ────────────────────────────────────────────────────────────
export const categories = pgTable(
  'categories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 30 }),
    parentId: integer('parent_id'),
    description: text('description'),
    imageUrl: text('image_url'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('categories_tenant_name').on(t.tenantId, t.name),
    index('idx_categories_tenant').on(t.tenantId),
    index('idx_categories_parent').on(t.parentId, t.tenantId),
  ]
);

// ─── Brands ────────────────────────────────────────────────────────────────
export const brands = pgTable(
  'brands',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 30 }),
    logoUrl: text('logo_url'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('brands_tenant_name').on(t.tenantId, t.name),
    index('idx_brands_tenant').on(t.tenantId),
  ]
);

// ─── Units of Measure ──────────────────────────────────────────────────────
export const units = pgTable(
  'units',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    abbreviation: varchar('abbreviation', { length: 20 }).notNull(),
    type: varchar('type', { length: 20 })
      .notNull()
      .default('QUANTITY')
      .$type<'QUANTITY' | 'LENGTH' | 'WEIGHT' | 'AREA' | 'VOLUME'>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('units_tenant_abbr').on(t.tenantId, t.abbreviation),
    index('idx_units_tenant').on(t.tenantId),
  ]
);

// ─── Attribute Sets (e.g., "Clothing" has Size, Color, Fabric) ────────────
export const attributeSets = pgTable(
  'attribute_sets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('attribute_sets_tenant_name').on(t.tenantId, t.name),
    index('idx_attribute_sets_tenant').on(t.tenantId),
  ]
);

// ─── Attributes (e.g., "Size", "Color") ────────────────────────────────────
export const attributes = pgTable(
  'attributes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    attributeSetId: integer('attribute_set_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    inputType: varchar('input_type', { length: 20 })
      .notNull()
      .default('SELECT')
      .$type<'SELECT' | 'TEXT' | 'NUMBER' | 'COLOR'>(),
    sortOrder: integer('sort_order').notNull().default(0),
    isRequired: boolean('is_required').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('attributes_tenant_code').on(t.tenantId, t.attributeSetId, t.code),
    index('idx_attributes_tenant').on(t.tenantId),
    index('idx_attributes_set').on(t.attributeSetId),
  ]
);

// ─── Attribute Values (e.g., "S", "M", "L", "Red", "Blue") ───────────────
export const attributeValues = pgTable(
  'attribute_values',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    attributeId: integer('attribute_id').notNull(),
    value: varchar('value', { length: 200 }).notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    colorHex: varchar('color_hex', { length: 7 }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('attribute_values_tenant_attr_value').on(t.tenantId, t.attributeId, t.value),
    index('idx_attribute_values_attribute').on(t.attributeId),
  ]
);

// ─── Items (Master Product Catalog) ───────────────────────────────────────
export const items = pgTable(
  'items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    itemCode: varchar('item_code', { length: 50 }),
    name: varchar('name', { length: 300 }).notNull(),
    description: text('description'),
    categoryId: integer('category_id'),
    brandId: integer('brand_id'),
    unitId: integer('unit_id').notNull(),
    attributeSetId: integer('attribute_set_id'),
    // GST
    hsnCode: varchar('hsn_code', { length: 20 }).notNull(),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }).notNull().default('18'),
    cessRate: decimal('cess_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    // Pricing
    mrp: decimal('mrp', { precision: 15, scale: 2 }),
    salePrice: decimal('sale_price', { precision: 15, scale: 2 }).notNull().default('0'),
    minSalePrice: decimal('min_sale_price', { precision: 15, scale: 2 }).notNull().default('0'),
    purchasePrice: decimal('purchase_price', { precision: 15, scale: 2 }).notNull().default('0'),
    // Barcodes
    barcode: varchar('barcode', { length: 100 }),
    barcodeType: varchar('barcode_type', { length: 20 })
      .default('EAN13')
      .$type<'EAN13' | 'CODE128' | 'QR' | 'CUSTOM'>(),
    // Inventory config
    trackInventory: boolean('track_inventory').notNull().default(true),
    reorderLevel: decimal('reorder_level', { precision: 15, scale: 3 }).notNull().default('0'),
    reorderQty: decimal('reorder_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    // Variants config
    hasVariants: boolean('has_variants').notNull().default(false),
    variantAttributeIds: jsonb('variant_attribute_ids').$type<number[]>().default([]),
    // Images
    imageUrls: jsonb('image_urls').$type<string[]>().default([]),
    thumbnailUrl: text('thumbnail_url'),
    // Status
    status: varchar('status', { length: 20 })
      .notNull()
      .default('ACTIVE')
      .$type<'ACTIVE' | 'INACTIVE' | 'DISCONTINUED'>(),
    isFabricItem: boolean('is_fabric_item').notNull().default(false),
    fabricWidth: decimal('fabric_width', { precision: 8, scale: 2 }),
    // Live stock counters (updated atomically via UPDATE WHERE available_qty >= qty)
    availableQty: decimal('available_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    reservedQty: decimal('reserved_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    // ES-13: inventory valuation (FIFO / WACC costing)
    costingMethod: varchar('costing_method', { length: 10 })
      .notNull()
      .default('WACC')
      .$type<'FIFO' | 'WACC'>(),
    waccCost: decimal('wacc_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    currentStockValue: decimal('current_stock_value', { precision: 15, scale: 2 }).notNull().default('0'),
    tags: jsonb('tags').$type<string[]>().default([]),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().default({}),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('items_tenant_code').on(t.tenantId, t.itemCode),
    unique('items_tenant_barcode').on(t.tenantId, t.barcode),
    index('idx_items_tenant').on(t.tenantId),
    index('idx_items_category').on(t.categoryId, t.tenantId),
    index('idx_items_brand').on(t.brandId, t.tenantId),
    index('idx_items_barcode').on(t.barcode),
    index('idx_items_hsn').on(t.hsnCode, t.tenantId),
    index('idx_items_status').on(t.status, t.tenantId),
  ]
);

// ─── Item Variants ─────────────────────────────────────────────────────────
export const itemVariants = pgTable(
  'item_variants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    itemId: integer('item_id').notNull(),
    sku: varchar('sku', { length: 100 }).notNull(),
    barcode: varchar('barcode', { length: 100 }),
    attributeCombination: jsonb('attribute_combination')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    mrp: decimal('mrp', { precision: 15, scale: 2 }),
    salePrice: decimal('sale_price', { precision: 15, scale: 2 }).notNull().default('0'),
    purchasePrice: decimal('purchase_price', { precision: 15, scale: 2 }).notNull().default('0'),
    imageUrl: text('image_url'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('item_variants_tenant_sku').on(t.tenantId, t.sku),
    unique('item_variants_tenant_barcode').on(t.tenantId, t.barcode),
    index('idx_item_variants_item').on(t.itemId, t.tenantId),
    index('idx_item_variants_barcode').on(t.barcode),
  ]
);

// ─── Items History ─────────────────────────────────────────────────────────
export const itemsHistory = pgTable(
  'items_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemId: integer('item_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    changedBy: integer('changed_by').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
    previousData: jsonb('previous_data').notNull(),
    changeType: varchar('change_type', { length: 20 }).notNull().$type<'UPDATE' | 'PRICE_CHANGE'>(),
  },
  (t) => [
    index('idx_items_history_item').on(t.itemId),
    index('idx_items_history_tenant').on(t.tenantId, t.changedAt),
  ]
);

// ─── Price Lists ────────────────────────────────────────────────────────────
export const priceLists = pgTable(
  'price_lists',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 30 }).notNull(),
    currency: varchar('currency', { length: 10 }).notNull().default('INR'),
    priceIncludesTax: boolean('price_includes_tax').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('price_lists_tenant_code').on(t.tenantId, t.code),
    index('idx_price_lists_tenant').on(t.tenantId),
  ]
);

// ─── Price List Items ───────────────────────────────────────────────────────
export const priceListItems = pgTable(
  'price_list_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    priceListId: integer('price_list_id').notNull(),
    itemId: integer('item_id').notNull(),
    variantId: integer('variant_id'),
    salePrice: decimal('sale_price', { precision: 15, scale: 2 }).notNull(),
    minQty: decimal('min_qty', { precision: 15, scale: 3 }).notNull().default('0'),
    discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
  },
  (t) => [
    unique('price_list_items_unique').on(t.priceListId, t.itemId, t.variantId),
    index('idx_price_list_items_list').on(t.priceListId),
    index('idx_price_list_items_item').on(t.itemId, t.tenantId),
  ]
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type Unit = typeof units.$inferSelect;
export type NewUnit = typeof units.$inferInsert;
export type AttributeSet = typeof attributeSets.$inferSelect;
export type Attribute = typeof attributes.$inferSelect;
export type AttributeValue = typeof attributeValues.$inferSelect;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ItemVariant = typeof itemVariants.$inferSelect;
export type NewItemVariant = typeof itemVariants.$inferInsert;
export type PriceList = typeof priceLists.$inferSelect;
export type NewPriceList = typeof priceLists.$inferInsert;
export type PriceListItem = typeof priceListItems.$inferSelect;
