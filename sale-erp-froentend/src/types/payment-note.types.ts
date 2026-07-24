export type PaymentNoteType = 'DISCOUNT_NEGOTIATION' | 'PENDING_PAYMENT' | 'PAYMENT_DISPUTE' | 'OTHER';
export type PaymentNotePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type PaymentNoteStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export const PAYMENT_NOTE_TYPES: { value: PaymentNoteType; label: string }[] = [
  { value: 'DISCOUNT_NEGOTIATION', label: 'Discount Negotiation' },
  { value: 'PENDING_PAYMENT', label: 'Pending Payment' },
  { value: 'PAYMENT_DISPUTE', label: 'Payment Dispute' },
  { value: 'OTHER', label: 'Other' },
];

export const PAYMENT_NOTE_PRIORITIES: PaymentNotePriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export const PAYMENT_NOTE_STATUSES: PaymentNoteStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

export interface PaymentNoteListItem {
  paymentNoteId: number;
  noteNo: string;
  subject: string;
  contactName: string;
  noteType: PaymentNoteType;
  priority: PaymentNotePriority;
  status: PaymentNoteStatus;
  amount?: number;
  assignedToName?: string;
  createdAt: string;
}

export interface PaymentNoteDetail {
  paymentNoteId: number;
  noteNo: string;
  contact: { id: number; name: string };
  sale?: { id: number; name: string };
  payment?: { id: number; name: string };
  noteType: PaymentNoteType;
  subject: string;
  description?: string;
  amount?: number;
  priority: PaymentNotePriority;
  status: PaymentNoteStatus;
  assignedTo?: { id: number; name: string };
  resolutionNotes?: string;
  resolvedAt?: string;
  createdAt: string;
  createdBy: string;
}

export interface PaymentNoteRequest {
  contactId: number;
  saleId?: number | null;
  paymentId?: number | null;
  noteType: PaymentNoteType;
  subject: string;
  description?: string;
  amount?: number | null;
  priority?: PaymentNotePriority;
  assignedToId?: number | null;
}

export interface PaymentNoteStatusUpdateRequest {
  status: PaymentNoteStatus;
  resolutionNotes?: string;
}

export interface PaymentNoteAssignRequest {
  assignedToId: number;
}

export interface PaymentNoteAuditEntry {
  action: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  performedBy: string;
  performedAt: string;
}
