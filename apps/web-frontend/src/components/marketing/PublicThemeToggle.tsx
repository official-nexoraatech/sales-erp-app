import { type ComponentType } from 'react';
import { Check, Sun, Moon, Contrast } from 'lucide-react';
import { useTheme, type ThemeMode } from '../../context/ThemeContext.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../erp/ERPDropdownMenu.js';

type IconType = ComponentType<{ size?: number; className?: string }>;

const MODE_OPTIONS: { mode: ThemeMode; label: string; icon: IconType }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'hc', label: 'High Contrast', icon: Contrast },
];

/** Public-site equivalent of the authenticated app's AppearanceMenu — mode only (no density,
 * which is an authenticated-app concept). Shares ThemeContext, so a choice made here or in the
 * app persists across both since ThemeProvider wraps the whole app with no auth gate. */
export default function PublicThemeToggle() {
  const { mode, setMode } = useTheme();
  const TriggerIcon = MODE_OPTIONS.find((o) => o.mode === mode)?.icon ?? Sun;

  const items: ERPMenuItem[] = MODE_OPTIONS.map((o) => ({
    label: o.label,
    ...(o.mode === mode ? { icon: Check } : { icon: o.icon }),
    onClick: () => setMode(o.mode),
  }));

  return (
    <ERPDropdownMenu
      items={items}
      align="right"
      ariaLabel="Change appearance"
      triggerTitle="Appearance"
      triggerClassName="p-2 rounded-md text-secondary hover:bg-surface-subtle hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      trigger={<TriggerIcon size={18} />}
    />
  );
}
