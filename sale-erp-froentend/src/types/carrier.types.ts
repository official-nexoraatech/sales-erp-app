export interface Carrier {
  id: number;
  name: string;
  mobile?: string;
  whatsappNo?: string;
  email?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  address?: string;
  note?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface CreateCarrierRequest {
  name: string;
  email?: string;
  mobile?: string;
  whatsappNo?: string;
  status: 'ACTIVE' | 'INACTIVE';
  address?: string;
  note?: string;
}

export type UpdateCarrierRequest = CreateCarrierRequest;
