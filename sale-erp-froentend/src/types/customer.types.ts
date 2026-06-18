export interface CustomerListItem {
  id: number;
  customerCode: string;
  customerName: string;
  mobile: string;
  balance: number;
}

export interface CustomerAddressRequest {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateId: number;
  countryId: number;
  pincode: string;
}

export interface CustomerAddress extends CustomerAddressRequest {
  id: number;
  addressType: 'BILLING' | 'SHIPPING';
  stateName: string;
  countryName: string;
}

export interface CustomerDetail {
  id: number;
  customerCode: string;
  companyName: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  mobile?: string;
  whatsappNo?: string;
  gstNumber?: string;
  panNumber?: string;
  creditLimit: number;
  openingBalance: number;
  openingBalanceType: 'RECEIVABLE' | 'PAYABLE';
  isWholesale: boolean;
  currentBalance: number;
  billingAddress?: CustomerAddress;
  shippingAddress?: CustomerAddress;
}

export interface CreateCustomerRequest {
  companyName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  whatsappNo: string;
  gstNumber: string;
  panNumber: string;
  creditLimit: number;
  openingBalance: number;
  openingBalanceType: '' | 'RECEIVABLE' | 'PAYABLE';
  isWholesale: boolean;
  billingAddress?: CustomerAddressRequest;
  shippingAddress?: CustomerAddressRequest;
}

export type UpdateCustomerRequest = CreateCustomerRequest;
