/** Minimal hex-color lightness shifter — used only to derive hover/active/subtle
 * variants from a tenant's single brand-primary override (ERP-PLANNING/05_ERP_THEME_SYSTEM.md
 * §4: "a tenant sets one color, not six"). Not a general color library. */
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Shifts lightness by `deltaPercent` (positive = lighter, negative = darker), clamped to [0,100]. */
export function shiftLightness(hex: string, deltaPercent: number): string {
  const [h, s, l] = hexToHsl(hex);
  const newL = Math.max(0, Math.min(100, l + deltaPercent));
  return hslToHex(h, s, newL);
}

/** Sets lightness to an absolute value (not relative like shiftLightness) — needed for the
 * sidebar, which must stay a consistently dark "chrome" regardless of how light or dark a
 * tenant's own brand color is (a relative shift off a pastel input wouldn't land dark
 * enough; off an already-black input it's redundant either way). */
export function setLightness(hex: string, targetPercent: number): string {
  const [h, s] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, Math.min(100, targetPercent)));
}
