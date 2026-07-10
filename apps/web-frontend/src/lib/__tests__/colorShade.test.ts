import { describe, it, expect } from 'vitest';
import { shiftLightness } from '../colorShade.js';

describe('shiftLightness', () => {
  it('darkens a color when given a negative delta', () => {
    // #4f46e5 is the default brand-primary — darkening it should reduce every channel's
    // magnitude toward black while roughly preserving hue.
    const darker = shiftLightness('#4f46e5', -10);
    expect(darker).toMatch(/^#[0-9a-f]{6}$/);
    expect(darker).not.toBe('#4f46e5');
  });

  it('lightens a color when given a positive delta', () => {
    const lighter = shiftLightness('#4f46e5', 40);
    expect(lighter).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps at white when the delta would overshoot 100% lightness', () => {
    expect(shiftLightness('#ffffff', 20)).toBe('#ffffff');
  });

  it('clamps at black when the delta would undershoot 0% lightness', () => {
    expect(shiftLightness('#000000', -20)).toBe('#000000');
  });

  it('is a no-op for a zero delta (round-trips through HSL without drift)', () => {
    expect(shiftLightness('#4f46e5', 0)).toBe('#4f46e5');
  });
});
