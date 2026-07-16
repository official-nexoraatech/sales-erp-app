import Modal from '../ui/Modal.js';
import { Kbd } from '@erp/ui';

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'K'], description: 'Open global search / command palette' },
  { keys: ['Ctrl', 'Shift', 'N'], description: 'Quick create' },
  { keys: ['G', 'D'], description: 'Go to Dashboard (press one after the other)' },
  { keys: ['['], description: 'Collapse sidebar' },
  { keys: [']'], description: 'Expand sidebar' },
  { keys: ['?'], description: 'Toggle this help panel' },
  { keys: ['Esc'], description: 'Close any open panel, modal, or dropdown' },
];

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <ul className="space-y-3">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.description} className="flex items-center justify-between gap-4">
            <span className="text-sm text-secondary">{shortcut.description}</span>
            <span className="flex items-center gap-1 shrink-0">
              {shortcut.keys.map((key, idx) => (
                <span key={key} className="flex items-center gap-1">
                  {idx > 0 && <span className="text-xs text-disabled">+</span>}
                  <Kbd>{key}</Kbd>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export default ShortcutsModal;
