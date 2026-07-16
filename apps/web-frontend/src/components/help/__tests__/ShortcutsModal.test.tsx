import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import { ShortcutsModal } from '../ShortcutsModal.js';

describe('ShortcutsModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ShortcutsModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the app's registered shortcuts when open", () => {
    render(<ShortcutsModal open onClose={vi.fn()} />);
    expect(screen.getByText('Open global search / command palette')).toBeInTheDocument();
    expect(screen.getByText('Quick create')).toBeInTheDocument();
    expect(screen.getByText('Toggle this help panel')).toBeInTheDocument();
    expect(screen.getByText('Close any open panel, modal, or dropdown')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<ShortcutsModal open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(<ShortcutsModal open onClose={vi.fn()} />);
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
