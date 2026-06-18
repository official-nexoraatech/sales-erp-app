import React from 'react';
import { Badge } from '../ui/Badge';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const statusConfig = {
    ACTIVE: { variant: 'success' as const, label: 'Active' },
    INACTIVE: { variant: 'danger' as const, label: 'Inactive' },
    PENDING: { variant: 'warning' as const, label: 'Pending' },
    COMPLETED: { variant: 'success' as const, label: 'Completed' },
    DRAFT: { variant: 'info' as const, label: 'Draft' },
    CANCELLED: { variant: 'danger' as const, label: 'Cancelled' },
  };

  const config = statusConfig[status as keyof typeof statusConfig] || {
    variant: 'neutral' as const,
    label: status,
  };

  return <Badge variant={config.variant}>{config.label}</Badge>;
};
