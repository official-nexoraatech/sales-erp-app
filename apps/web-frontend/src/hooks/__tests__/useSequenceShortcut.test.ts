import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSequenceShortcut } from '../useSequenceShortcut.js';

describe('useSequenceShortcut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the callback when the second key follows the first within the window', () => {
    const callback = vi.fn();
    renderHook(() => useSequenceShortcut(['g', 'd'], callback));

    fireEvent.keyDown(document, { key: 'g' });
    fireEvent.keyDown(document, { key: 'd' });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not fire if the second key is pressed after the 1s window expires', () => {
    const callback = vi.fn();
    renderHook(() => useSequenceShortcut(['g', 'd'], callback));

    fireEvent.keyDown(document, { key: 'g' });
    vi.advanceTimersByTime(1500);
    fireEvent.keyDown(document, { key: 'd' });

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire for an unrelated key sequence', () => {
    const callback = vi.fn();
    renderHook(() => useSequenceShortcut(['g', 'd'], callback));

    fireEvent.keyDown(document, { key: 'x' });
    fireEvent.keyDown(document, { key: 'd' });

    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores the sequence while a modifier key is held', () => {
    const callback = vi.fn();
    renderHook(() => useSequenceShortcut(['g', 'd'], callback));

    fireEvent.keyDown(document, { key: 'g', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'd' });

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire while focus is in an editable field', () => {
    const callback = vi.fn();
    renderHook(() => useSequenceShortcut(['g', 'd'], callback));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'g' });
    fireEvent.keyDown(input, { key: 'd' });

    expect(callback).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
