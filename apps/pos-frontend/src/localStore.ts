// OFFLINE-03: basic CRUD primitives for the reference-data stores added alongside
// pending-sale persistence. Populating these from the server is OFFLINE-04's job;
// held-sale business logic is OFFLINE-05's. This file only provides get/upsert/clear.

import { db, type CatalogItem, type CachedCustomer, type CachedPriceListItem, type CachedTaxRate, type HeldSale, type SyncMeta } from './db.js';

// ─── Catalog items ───────────────────────────────────────────────────────────
export async function upsertCatalogItems(items: CatalogItem[]): Promise<void> {
  await db.catalogItems.bulkPut(items);
}
export async function getCatalogItemById(id: number): Promise<CatalogItem | undefined> {
  return db.catalogItems.get(id);
}
export async function getCatalogItemByBarcode(barcode: string): Promise<CatalogItem | undefined> {
  return db.catalogItems.where('barcode').equals(barcode).first();
}
export async function getAllCatalogItems(): Promise<CatalogItem[]> {
  return db.catalogItems.toArray();
}
export async function clearCatalogItems(): Promise<void> {
  await db.catalogItems.clear();
}

// ─── Customers ───────────────────────────────────────────────────────────────
export async function upsertCustomers(customers: CachedCustomer[]): Promise<void> {
  await db.customers.bulkPut(customers);
}
export async function getCustomerById(id: number): Promise<CachedCustomer | undefined> {
  return db.customers.get(id);
}
export async function getAllCustomers(): Promise<CachedCustomer[]> {
  return db.customers.toArray();
}
export async function deleteCustomerById(id: number): Promise<void> {
  await db.customers.delete(id);
}
export async function clearCustomers(): Promise<void> {
  await db.customers.clear();
}

// ─── Price list items ────────────────────────────────────────────────────────
export async function upsertPriceListItems(rows: CachedPriceListItem[]): Promise<void> {
  await db.priceListItems.bulkPut(rows);
}
export async function getPriceListItemsForItem(itemId: number): Promise<CachedPriceListItem[]> {
  return db.priceListItems.where('itemId').equals(itemId).toArray();
}
export async function getAllPriceListItems(): Promise<CachedPriceListItem[]> {
  return db.priceListItems.toArray();
}
export async function clearPriceListItems(): Promise<void> {
  await db.priceListItems.clear();
}

// ─── Tax rates ────────────────────────────────────────────────────────────────
export async function upsertTaxRates(rates: CachedTaxRate[]): Promise<void> {
  await db.taxRates.bulkPut(rates);
}
export async function getTaxRateByHsn(hsnCode: string): Promise<CachedTaxRate | undefined> {
  return db.taxRates.get(hsnCode);
}
export async function getAllTaxRates(): Promise<CachedTaxRate[]> {
  return db.taxRates.toArray();
}
export async function clearTaxRates(): Promise<void> {
  await db.taxRates.clear();
}

// ─── Held sales ───────────────────────────────────────────────────────────────
export async function upsertHeldSale(sale: HeldSale): Promise<number> {
  return db.heldSales.put(sale);
}
export async function getHeldSaleById(id: number): Promise<HeldSale | undefined> {
  return db.heldSales.get(id);
}
export async function getAllHeldSales(): Promise<HeldSale[]> {
  return db.heldSales.toArray();
}
export async function deleteHeldSale(id: number): Promise<void> {
  await db.heldSales.delete(id);
}
export async function clearHeldSales(): Promise<void> {
  await db.heldSales.clear();
}

// ─── Sync metadata ────────────────────────────────────────────────────────────
export async function getSyncMeta(store: string): Promise<SyncMeta | undefined> {
  return db.syncMeta.get(store);
}
export async function setSyncMeta(meta: SyncMeta): Promise<void> {
  await db.syncMeta.put(meta);
}
export async function clearSyncMeta(): Promise<void> {
  await db.syncMeta.clear();
}
