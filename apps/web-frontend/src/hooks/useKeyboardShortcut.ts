import { useEffect } from 'react';

interface ShortcutOptions {
  // Matches Ctrl on Windows/Linux or Cmd on macOS — the standard cross-platform
  // "primary modifier" convention (Ctrl+K / Cmd+K).
  ctrlOrCmd?: boolean;
  /** Requires Shift held too, e.g. Ctrl/Cmd+Shift+N — ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §12. */
  shift?: boolean;
  preventDefault?: boolean;
}

// No global keyboard shortcut existed anywhere in this app before Ctrl+K/Cmd+K for the
// command palette (Part 22 of the design system) — this is the first one, so there's no
// existing hook to reuse; every other shortcut in the codebase (Escape-to-close on
// ERPDrawer/Modal/ERPDropdownMenu) is a local, component-scoped listener instead.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useKeyboardShortcut(key: string, callback: () => void, options: ShortcutOptions = {}): void {
  const { ctrlOrCmd = false, shift = false, preventDefault = true } = options;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Unmodified single-key shortcuts (e.g. "?") must not fire while the user is typing —
      // Ctrl/Cmd-modified ones are safe either way since no text field expects those combos.
      if (!ctrlOrCmd && isEditableTarget(e.target)) return;
      const modifierMatches = ctrlOrCmd ? (e.ctrlKey || e.metaKey) : true;
      // Only checked when explicitly requested — many characters (e.g. "?") already imply
      // Shift was held to produce that `e.key`, so requiring `!e.shiftKey` by default would
      // break every shortcut keyed on a shifted character.
      const shiftMatches = shift ? e.shiftKey : true;
      if (modifierMatches && shiftMatches && e.key.toLowerCase() === key.toLowerCase()) {
        if (preventDefault) e.preventDefault();
        callback();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [key, callback, ctrlOrCmd, shift, preventDefault]);
}
