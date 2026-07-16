import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import { WhatsNewModal } from '../WhatsNewModal.js';

describe('WhatsNewModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<WhatsNewModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists dated release notes when open', () => {
    render(<WhatsNewModal open onClose={vi.fn()} />);
    expect(screen.getByText('Theme & Help Center improvements')).toBeInTheDocument();
    expect(screen.getByText('2026-07-15')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<WhatsNewModal open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(<WhatsNewModal open onClose={vi.fn()} />);
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
