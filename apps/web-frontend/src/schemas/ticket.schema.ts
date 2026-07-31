import { z } from 'zod';

// Mirrors TicketCreateSchema/MessageSchema in apps/sales-service/src/api/ticket.routes.ts.
export const TICKET_TYPES = ['COMPLAINT', 'INQUIRY', 'RETURN_REQUEST', 'OTHER'] as const;
export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;

export const ticketFormSchema = z.object({
  customerId: z.coerce.number().int().positive('Required'),
  subject: z.string().min(2, 'Must be at least 2 characters').max(300),
  description: z.string().max(5000).optional(),
  ticketType: z.enum(TICKET_TYPES).default('OTHER'),
  priority: z.enum(TICKET_PRIORITIES).default('MEDIUM'),
});

export type TicketFormData = z.infer<typeof ticketFormSchema>;

export const ticketMessageSchema = z.object({
  visibility: z.enum(['INTERNAL', 'CUSTOMER_VISIBLE']),
  body: z.string().min(1, 'Required').max(5000),
});

export type TicketMessageFormData = z.infer<typeof ticketMessageSchema>;
