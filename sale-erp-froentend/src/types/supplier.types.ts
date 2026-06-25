export interface SupplierListItem {
  id: number;
  supplierCode: string;
  supplierName: string;
  mobile: string;
  balance: number;
}

export interface SupplierDetail {
  id: number;
  supplierCode: string;
  firstName: string;
  lastName: string;
  mobile?: string;
  whatsappNo?: string;
  email?: string;
  gstNumber?: string;
  creditLimit: number;
  openingBalance: number;
  currentBalance: number;
}

export interface CreateSupplierRequest {
  firstName: string;
  lastName: string;
  mobile: string;
  whatsappNo?: string;
  email?: string;
  gstNumber?: string;
  creditLimit?: number;
  openingBalance?: number;
}

export type UpdateSupplierRequest = CreateSupplierRequest;
