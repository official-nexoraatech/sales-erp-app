import { useState } from 'react';
import { UserCog } from 'lucide-react';
import Modal from '../ui/Modal.js';
import Button from '../ui/Button.js';
import ERPTextarea from './ERPTextarea.js';

interface TargetUser {
  firstName: string;
  lastName: string;
  email: string;
  roles?: string[];
}

interface Props {
  open: boolean;
  targetUser: TargetUser | null;
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export default function ImpersonateConfirmDialog({ open, targetUser, isLoading = false, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');

  function handleClose() {
    setReason('');
    onClose();
  }

  if (!targetUser) return null;

  return (
    <Modal title="Impersonate this user?" open={open} onClose={handleClose} size="sm" closeOnBackdropClick={!isLoading}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-warning-bg flex items-center justify-center shrink-0">
            <UserCog size={20} className="text-warning" />
          </div>
          <p className="text-sm text-secondary">
            You will see and act in the app exactly as{' '}
            <strong className="text-primary">{targetUser.firstName} {targetUser.lastName}</strong> ({targetUser.email})
            {targetUser.roles && targetUser.roles.length > 0 && (
              <> — role{targetUser.roles.length > 1 ? 's' : ''}: {targetUser.roles.join(', ')}</>
            )}
            . This session expires automatically after <strong className="text-primary">1 hour</strong> and is fully
            audit-logged.
          </p>
        </div>
        <ERPTextarea
          label="Reason"
          required
          rows={2}
          maxLength={500}
          placeholder="Why are you impersonating this user? (recorded in the security audit log)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" className="flex-1" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => onConfirm(reason.trim())}
            loading={isLoading}
            disabled={reason.trim().length === 0}
          >
            Start impersonating
          </Button>
        </div>
      </div>
    </Modal>
  );
}
