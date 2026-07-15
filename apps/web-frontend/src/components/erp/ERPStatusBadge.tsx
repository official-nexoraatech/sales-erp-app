import Badge, { type BadgeVariant } from '../ui/Badge.js';

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  active: 'success',
  approved: 'info',
  completed: 'success',
  paid: 'success',
  pending: 'warning',
  draft: 'default',
  inactive: 'default',
  blocked: 'danger',
  rejected: 'danger',
  cancelled: 'danger',
  failed: 'danger',
  expired: 'danger',
};

interface Props {
  status: string;
}

/** Maps a status string to the matching semantic Badge variant (Active→green,
 * Pending→orange, Approved→blue, Rejected→red, everything else→gray), so pages don't
 * each hand-roll the same status→color mapping. */
export default function ERPStatusBadge({ status }: Props) {
  const variant = STATUS_VARIANTS[status.toLowerCase()] ?? 'default';
  return <Badge variant={variant}>{status}</Badge>;
}
