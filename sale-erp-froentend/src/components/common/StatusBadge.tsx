import React from 'react';
import { Badge } from '../ui/Badge';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

interface StatusBadgeProps {
  status: string;
}

const STATUS_MAP: Record<string, { variant: BadgeVariant; label: string }> = {
  ACTIVE:       { variant: 'success',    label: 'Active' },
  INACTIVE:     { variant: 'danger',     label: 'Inactive' },
  PENDING:      { variant: 'pending',    label: 'Pending' },
  COMPLETED:    { variant: 'success',    label: 'Completed' },
  COMPLETE:     { variant: 'success',    label: 'Complete' },
  PAID:         { variant: 'success',    label: 'Paid' },
  DUE:          { variant: 'danger',     label: 'Due' },
  OVERDUE:      { variant: 'danger',     label: 'Overdue' },
  DRAFT:        { variant: 'draft',      label: 'Draft' },
  CANCELLED:    { variant: 'neutral',    label: 'Cancelled' },
  CANCELED:     { variant: 'neutral',    label: 'Cancelled' },
  PROCESSING:   { variant: 'processing', label: 'Processing' },
  APPROVED:     { variant: 'success',    label: 'Approved' },
  REJECTED:     { variant: 'danger',     label: 'Rejected' },
  PARTIAL:      { variant: 'warning',    label: 'Partial' },
  OPEN:         { variant: 'info',       label: 'Open' },
  IN_PROGRESS:  { variant: 'processing', label: 'In Progress' },
  RESOLVED:     { variant: 'success',    label: 'Resolved' },
  CLOSED:       { variant: 'neutral',    label: 'Closed' },
  CONFIRMED:    { variant: 'info',       label: 'Confirmed' },
  SHIPPED:      { variant: 'processing', label: 'Shipped' },
  DELIVERED:    { variant: 'success',    label: 'Delivered' },
  RETURNED:     { variant: 'warning',    label: 'Returned' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const normalized = status?.toUpperCase?.() ?? '';
  const config = STATUS_MAP[normalized] ?? { variant: 'neutral' as BadgeVariant, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
};
