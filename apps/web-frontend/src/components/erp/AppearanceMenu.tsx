import { type ComponentType } from 'react';
import { Check, Sun, Moon, Contrast, Gauge, Waves, Sparkles, Zap, MinusCircle } from 'lucide-react';
import { useTheme, type ThemeMode } from '../../context/ThemeContext.js';
import { useUIStore } from '../../store/ui.store.js';
import ERPDropdownMenu, { type ERPMenuItem } from './ERPDropdownMenu.js';

type IconType = ComponentType<{ size?: number; className?: string }>;

const MODE_OPTIONS: { mode: ThemeMode; label: string; icon: IconType }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'hc', label: 'High Contrast', icon: Contrast },
];

const DENSITY_OPTIONS: {
  value: 'compact' | 'comfortable' | 'spacious';
  label: string;
  icon: IconType;
}[] = [
  { value: 'compact', label: 'Compact', icon: Gauge },
  { value: 'comfortable', label: 'Comfortable', icon: Waves },
  { value: 'spacious', label: 'Spacious', icon: Sparkles },
];

/** Header appearance control — mode (Light/Dark/High Contrast), density, and a reduced-motion
 * override. Per ERP-PLANNING/05_ERP_THEME_SYSTEM.md §3, §6. Replaces the old single sun/moon
 * toggle button, which only covered light/dark. */
export default function AppearanceMenu() {
  const { mode, setMode, reducedMotion, setReducedMotion } = useTheme();
  // Selector form (not the whole-store destructure) so this menu only re-renders when
  // density itself changes — not on every route nav, which pushes to recentPages in the
  // same store.
  const density = useUIStore((s) => s.density);
  const setDensity = useUIStore((s) => s.setDensity);

  const modeItems: ERPMenuItem[] = MODE_OPTIONS.map((o) => ({
    label: o.label,
    ...(o.mode === mode ? { icon: Check } : { icon: o.icon }),
    onClick: () => setMode(o.mode),
  }));

  const densityItems: ERPMenuItem[] = DENSITY_OPTIONS.map((o) => ({
    label: o.label,
    ...(o.value === density ? { icon: Check } : { icon: o.icon }),
    onClick: () => setDensity(o.value),
  }));

  const motionItem: ERPMenuItem = {
    label: reducedMotion ? 'Reduced motion: On' : 'Reduced motion: Off',
    icon: reducedMotion ? MinusCircle : Zap,
    onClick: () => setReducedMotion(!reducedMotion),
  };

  const items: ERPMenuItem[] = [
    ...modeItems,
    { label: '', onClick: () => {}, separator: true },
    ...densityItems,
    { label: '', onClick: () => {}, separator: true },
    motionItem,
  ];

  const ModeIcon = mode === 'dark' ? Moon : mode === 'hc' ? Contrast : Sun;

  return (
    <ERPDropdownMenu
      align="right"
      items={items}
      ariaLabel="Appearance settings"
      trigger={<ModeIcon size={18} />}
    />
  );
}
