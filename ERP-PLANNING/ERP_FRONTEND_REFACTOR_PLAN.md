# NEXORAA ERP — Frontend Refactor Plan
## Milestone-by-Milestone Implementation Guide

**Created:** 2026-06-30  
**Status:** AWAITING APPROVAL — No code has been changed  
**Reference Documents:**
- `ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md` — The mandatory standard
- `ERP-PLANNING/FRONTEND_GAP_ANALYSIS.md` — 153 issues catalogued (GA-001 through GA-123)

---

## HOW TO USE THIS DOCUMENT

1. This plan is approved **one milestone at a time**.
2. Before implementing any milestone, confirm: "Implement Milestone X."
3. Do NOT start the next milestone until the current one passes every validation checkpoint.
4. Each milestone is atomic — every task within it must be completed before calling it done.
5. If a milestone is abandoned mid-way, roll back using the rollback plan.

---

## MILESTONE MAP

| # | Name | Priority | Effort | GA Issues | Depends On |
|---|------|----------|--------|-----------|------------|
| **M-01** | Fix Critical Bugs (No-UI-change) | P0 | XS | GA-095, GA-096, GA-097, GA-098, GA-122 | None |
| **M-02** | Design Token Foundation | P0 | S | GA-001, GA-002, GA-003 | M-01 |
| **M-03** | Icon System Migration | P0 | M | GA-012, GA-019, GA-020, GA-025, GA-039, GA-040, GA-041, GA-042, GA-043, GA-044 | M-02 |
| **M-04** | Theme System Consolidation | P0 | S | GA-018, GA-026 | M-02 |
| **M-05** | Core Component Rebuild — Part 1 (Button, Badge, Input, Select, Modal) | P0 | L | GA-041, GA-044, GA-082, GA-083, GA-084, GA-085, GA-086, GA-115, GA-117, GA-118 | M-03, M-04 |
| **M-06** | Core Component Rebuild — Part 2 (ERPDataGrid, ERPPagination, ERPEmptyState, ERPSkeleton) | P0 | XL | GA-045, GA-046, GA-047, GA-048, GA-049, GA-050, GA-051, GA-054, GA-103, GA-123 | M-05 |
| **M-07** | Layout Shell Rebuild | P1 | L | GA-013, GA-016, GA-017, GA-018, GA-019, GA-020, GA-021, GA-022, GA-023, GA-024 | M-03, M-04, M-06 |
| **M-08** | Page Header & Breadcrumb System | P1 | M | GA-060, GA-061, GA-062, GA-063, GA-013 | M-07 |
| **M-09** | Route Architecture & Code Splitting | P1 | L | GA-004, GA-005, GA-007, GA-008, GA-009, GA-010, GA-108 | M-06 |
| **M-10** | Shared Utility Library (dates, currency, state codes) | P1 | S | GA-069, GA-070, GA-112, GA-113 | None |
| **M-11** | Form Component Library | P1 | L | GA-064, GA-065, GA-066, GA-067, GA-068, GA-071, GA-072, GA-075, GA-077 | M-05, M-06 |
| **M-12** | Color Token Migration — All Pages | P1 | M | GA-026–GA-038, GA-114 | M-02 |
| **M-13** | List Page Standardization — Sales Module | P2 | L | GA-055, GA-056, GA-057, GA-058, GA-059, GA-049, GA-099, GA-100, GA-119 | M-06, M-08 |
| **M-14** | List Page Standardization — Inventory & Accounting Modules | P2 | L | GA-055, GA-057, GA-036, GA-037, GA-038, GA-119, GA-120 | M-13 |
| **M-15** | Invoice Form Complete Rewrite | P2 | XL | GA-066, GA-067, GA-068, GA-069, GA-070, GA-071, GA-107 | M-11 |
| **M-16** | Dashboard Real Data & Charts | P2 | L | GA-088, GA-089, GA-090, GA-091 | M-08 |
| **M-17** | Authentication Fixes | P2 | M | GA-092, GA-093, GA-094 | M-05 |
| **M-18** | Missing Routes — Delivery Challan, Quotation Detail, Transfer Detail | P2 | L | GA-007, GA-008, GA-121 | M-11 |
| **M-19** | Accessibility Pass | P3 | M | GA-101, GA-102, GA-103, GA-104, GA-105 | M-06, M-11 |
| **M-20** | Performance Pass (Virtual Scroll, AsyncSelect, Bundle Analysis) | P3 | L | GA-106, GA-107, GA-108 | M-09 |
| **M-21** | Tenant Theming & Logo System | P3 | L | GA-109, GA-110, GA-111 | M-02, M-04 |
| **M-22** | Command Palette & Global Search | P3 | XL | GA-014, GA-015 | M-07 |
| **M-23** | Final Verification Audit | P3 | M | All | All |

---

## MILESTONE M-01 — Fix Critical Production Bugs (No UI Changes)

**Objective:** Fix 5 bugs that cause data corruption or runtime failures in production environments. These are all one-line or two-line fixes. Zero visual change to users.

**Why first:** These bugs corrupt data (`branchId: 1`) or break in production (`localhost:` URLs). They must be fixed before anything else because they are active harm.

### Tasks

#### Task 1.1 — Fix dark mode variant (GA-122, GA-002)
- **File:** `apps/web-frontend/src/index.css` line 3
- **Change:** `@custom-variant dark (&:is(.dark *));` → `@custom-variant dark (&:where(.dark, .dark *));`
- **Why:** Current variant does not apply dark utilities when `.dark` is on `<html>` root.

#### Task 1.2 — Fix hardcoded localhost URL in ChartOfAccounts (GA-095)
- **File:** `apps/web-frontend/src/pages/accounting/ChartOfAccountsPage.tsx` line 85
- **Change:** Replace raw `fetch('http://localhost:3019/accounts/seed', ...)` with `accountApi.seed()` call from `api/endpoints.js`. If `accountApi.seed` doesn't exist, add it.
- **API pattern to add:** `seed: () => apiFetch('/api/v2/accounts/seed', { method: 'POST' })`

#### Task 1.3 — Fix hardcoded localhost URL in GstConfig (GA-096)
- **File:** `apps/web-frontend/src/pages/gst/GstConfigPage.tsx` line 25
- **Change:** Replace raw `fetch('http://localhost:3018/gst/seed-rates', ...)` with `gstApi.seedRates()`. Add method if missing.
- **API pattern to add:** `seedRates: () => apiFetch('/api/v2/gst/seed-rates', { method: 'POST' })`

#### Task 1.4 — Fix hardcoded branchId in PaymentsPage (GA-097)
- **File:** `apps/web-frontend/src/pages/sales/PaymentsPage.tsx` line 147
- **Change:** Remove `branchId: 1` from mutation payload. Read branch from `useAuthStore` once the store exposes `currentBranchId`. If auth store doesn't have branchId yet, temporarily read from `authStore.user?.branchId ?? 1` but add a `// TODO: replace with branch selector` comment.

#### Task 1.5 — Fix hardcoded branchId in SaleReturnsPage (GA-098)
- **File:** `apps/web-frontend/src/pages/sales/SaleReturnsPage.tsx` line 109
- **Same change as 1.4:** Read from auth store instead of hardcoding `branchId: 1`.

### Files Affected
- `apps/web-frontend/src/index.css`
- `apps/web-frontend/src/pages/accounting/ChartOfAccountsPage.tsx`
- `apps/web-frontend/src/pages/gst/GstConfigPage.tsx`
- `apps/web-frontend/src/pages/sales/PaymentsPage.tsx`
- `apps/web-frontend/src/pages/sales/SaleReturnsPage.tsx`
- `apps/web-frontend/src/api/endpoints.js` (additive only)

### Components Affected
None. Pure logic fixes.

### Breaking Change Risk
**None.** Every change is a fix, not a feature removal.

### Testing Checklist
- [ ] Dark mode toggle works correctly when applied to `<html>` element (not just body)
- [ ] Chart of Accounts "Seed Accounts" button works in all environments (not just localhost)
- [ ] GST Config "Seed Rates" button works in all environments
- [ ] Creating a payment assigns the correct branch from the logged-in user's profile, not always branch 1
- [ ] Creating a sale return assigns the correct branch
- [ ] Auth store includes `branchId` (or `user.branchId`) — if not, check why and add it from the JWT/`/me` response

### Rollback Plan
Each change is isolated to one function call or one prop value. If anything breaks:
- `index.css`: revert the single line
- `ChartOfAccountsPage.tsx`: revert mutation function to the raw fetch (only if API routing is broken — not ideal but safe)
- `endpoints.js`: seed methods are additive; removing them is safe if not called anywhere else

### Estimated Effort: XS (2–3 hours total)

---

## MILESTONE M-02 — Design Token Foundation

**Objective:** Create the CSS custom property token system that all future milestones depend on. No visual changes yet — tokens are defined but existing hardcoded classes still override them.

### Tasks

#### Task 2.1 — Create `src/styles/tokens.css` (GA-001)
Create new file with the full token set:

```
src/styles/tokens.css
```

Include all tokens from ERP_FRONTEND_DESIGN_SYSTEM.md Part 2:
- Surface tokens: `--surface-page`, `--surface-card`, `--surface-raised`, `--surface-overlay`, `--surface-subtle`
- Text tokens: `--text-primary`, `--text-secondary`, `--text-disabled`, `--text-inverse`, `--text-placeholder`
- Border tokens: `--border-default`, `--border-strong`, `--border-focus`
- Brand tokens: `--brand-primary`, `--brand-primary-hover`, `--brand-primary-foreground`
- Semantic tokens: `--color-success`, `--color-success-bg`, `--color-warning`, `--color-warning-bg`, `--color-danger`, `--color-danger-bg`, `--color-info`, `--color-info-bg`
- Elevation/shadow tokens: `--shadow-sm`, `--shadow-md`, `--shadow-lg`
- Z-index tokens: `--z-sidebar`, `--z-header`, `--z-dropdown`, `--z-modal`, `--z-toast`
- Spacing tokens: `--space-xs` through `--space-3xl`
- Radius tokens: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full`
- Animation tokens: `--duration-fast`, `--duration-normal`, `--duration-slow`

Both `:root` (light) and `.dark` overrides.

#### Task 2.2 — Import tokens in `index.css` (GA-001)
Add `@import './styles/tokens.css';` before the Tailwind import.

#### Task 2.3 — Install Inter font (GA-003)
```bash
pnpm --filter web-frontend add @fontsource/inter
```
Import in `main.tsx`:
```ts
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
```
Update `:root` in `tokens.css`:
```css
font-family: 'Inter', system-ui, -apple-system, sans-serif;
```

#### Task 2.4 — Register Tailwind token utilities
In `index.css`, after the Tailwind import, register CSS variable-based Tailwind utilities using `@layer utilities` so tokens can be used as class names: `bg-surface-card`, `text-primary`, `border-default`, etc.

### Files Created
- `apps/web-frontend/src/styles/tokens.css` (new)

### Files Modified
- `apps/web-frontend/src/index.css`
- `apps/web-frontend/src/main.tsx`
- `apps/web-frontend/package.json` (dependency)

### Components Affected
None yet. Tokens are defined but not used anywhere yet.

### Breaking Change Risk
**Very Low.** New file. New import. Font change could shift layout by 0–2px in some places if Inter's metrics differ from system-ui. Visual-only, no functionality change.

### Testing Checklist
- [ ] App still loads without errors after adding token file
- [ ] Inter font is visible on all text (open DevTools → Computed → font-family should show Inter)
- [ ] Dark mode still works (existing dark classes still apply)
- [ ] CSS variable `--brand-primary` is accessible in DevTools (inspect any element → Computed → scroll to see custom properties)
- [ ] No layout breaks from font change

### Rollback Plan
Delete `src/styles/tokens.css`. Remove the `@import` line from `index.css`. Remove font imports from `main.tsx`. Remove `@fontsource/inter` from package.json.

### Estimated Effort: S (half day)

---

## MILESTONE M-03 — Icon System Migration

**Objective:** Replace every emoji and text-character icon in the codebase with Lucide icons. Zero behavioral change. Only visual.

**Why now:** Emojis are inconsistent across platforms (different appearance on Windows vs Mac vs Android). They also cannot be styled, sized, or animated with CSS. This must be done before the shell rebuild.

### Tasks

#### Task 3.1 — Confirm lucide-react is installed
Check `package.json`. If not present, `pnpm --filter web-frontend add lucide-react`.

#### Task 3.2 — Create icon mapping reference file
Create `apps/web-frontend/src/lib/icons.ts` re-exporting named Lucide icons used in this app (enables tree-shaking and a single import point). Example:
```ts
export {
  LayoutDashboard, Settings, Building2, Store, Factory, Users, Truck, Package,
  Tag, BarChart3, FolderOpen, Sparkles, Ruler, DollarSign, RefreshCw,
  Edit3, Search, FileText, ShoppingCart, Receipt, CreditCard, Undo2, Archive,
  Unlock, ChevronRight, ChevronDown, X, Check, CheckCircle2, AlertCircle,
  Info, Loader2, Plus, MoreHorizontal, ArrowLeft, ArrowUp, ArrowDown,
  ArrowUpDown, PanelLeftClose, PanelLeftOpen, LogOut, Bell, Eye, EyeOff,
  LockOpen, Lock, History, Filter, Download, Upload, Trash2, Pencil
} from 'lucide-react';
```

#### Task 3.3 — Replace emoji icons in `Layout.tsx` (GA-012)
Replace each emoji in the `navItems` array with the corresponding Lucide component.

| Emoji | Replace With |
|-------|-------------|
| `⊞` / dashboard | `LayoutDashboard` |
| `⚙` / settings | `Settings` |
| `🏢` / org | `Building2` |
| `🏪` / store | `Store` |
| `🏭` / factory | `Factory` |
| `👥` / customers | `Users` |
| `🧑‍🤝‍🧑` / suppliers | `Handshake` |
| `🚚` / delivery | `Truck` |
| `📦` / inventory | `Package` |
| `🏷` / items | `Tag` |
| `📊` / reports | `BarChart3` |
| `📂` / accounts | `FolderOpen` |
| `✨` / GST | `Sparkles` |
| `📐` / UOM | `Ruler` |
| `💰` / prices | `DollarSign` |
| `🔄` / returns | `RefreshCw` |
| `✏` / adjustments | `Edit3` |
| `🔍` / verifications | `Search` |
| `🧵` / textile | `Layers` |
| `🛒` / purchase | `ShoppingCart` |
| `🧾` / invoices | `Receipt` |
| `📋` / quotations | `ClipboardList` |
| `💳` / payments | `CreditCard` |
| `↩` / sale returns | `Undo2` |
| `🗂` / challan | `Archive` |
| `🔓` / opening | `LockOpen` |

#### Task 3.4 — Replace text-character icons in Layout.tsx (GA-019, GA-020, GA-025)
- Sidebar collapse: `←` → `PanelLeftClose`, `→` → `PanelLeftOpen`
- Nav group chevron: `▶` → `ChevronRight` (rotate-90 when open)
- Logout button: `⇤` → `LogOut`

#### Task 3.5 — Replace emoji in DashboardPage.tsx (GA-039)
- `🧑‍🤝‍🧑` → `Users`
- `🚚` → `Truck`
- `🏷` → `Tag`
- `🔓` → `LockOpen`

#### Task 3.6 — Replace `✕` text characters in form remove buttons (GA-040)
- `InvoiceFormPage.tsx` line 259
- `StockAdjustmentFormPage.tsx` line 133
- `StockTransferFormPage.tsx` line 160
Replace with `<X size={14} />` inside a `<button aria-label="Remove item">`.

#### Task 3.7 — Replace `✕` in Modal.tsx close button (GA-041)
Replace text char with `<X size={18} />`. Add `aria-label="Close dialog"`.

#### Task 3.8 — Replace `▼`/`▶` in ChartOfAccountsPage.tsx (GA-042)
Tree expand/collapse buttons: text chars → `ChevronDown` / `ChevronRight` with `transition-transform`.

#### Task 3.9 — Replace `✓` in OpeningBalancesPage.tsx step tabs (GA-043)
Completed steps: `✓` → `<CheckCircle2 size={16} className="text-success" />`.
Pending step number: keep as text inside a styled circular `<span>`.

#### Task 3.10 — Replace `⟳` in Button.tsx loading spinner (GA-044)
Replace with `<Loader2 size={14} className="animate-spin" />`.

### Files Affected
- `apps/web-frontend/src/lib/icons.ts` (new)
- `apps/web-frontend/src/components/Layout.tsx`
- `apps/web-frontend/src/pages/DashboardPage.tsx`
- `apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx`
- `apps/web-frontend/src/pages/inventory/StockAdjustmentFormPage.tsx`
- `apps/web-frontend/src/pages/inventory/StockTransferFormPage.tsx`
- `apps/web-frontend/src/components/ui/Modal.tsx`
- `apps/web-frontend/src/pages/accounting/ChartOfAccountsPage.tsx`
- `apps/web-frontend/src/pages/accounting/OpeningBalancesPage.tsx`
- `apps/web-frontend/src/components/ui/Button.tsx`

### Components Affected
Button, Modal (visual only — no API change)

### Breaking Change Risk
**None.** Purely visual — replacing symbols with equivalent SVG icons. No logic, no props, no APIs change.

### Testing Checklist
- [ ] Every sidebar nav item shows a Lucide icon (no blank spaces)
- [ ] Sidebar collapse button shows `PanelLeftClose` / `PanelLeftOpen` correctly
- [ ] Chevron next to nav groups animates rotate when open/closed
- [ ] Logout shows `LogOut` icon
- [ ] Dashboard KPI cards show correct Lucide icons
- [ ] Line item remove button shows `X` icon and works to remove the row
- [ ] Modal close button shows `X` icon and closes modal
- [ ] ChartOfAccounts tree expand/collapse shows animated chevrons
- [ ] OpeningBalances step tabs show `CheckCircle2` for completed steps
- [ ] Button loading state shows spinning `Loader2` (not `⟳`)
- [ ] Icons render correctly in dark mode (color should adapt)
- [ ] No console errors about missing Lucide icons

### Rollback Plan
Git revert the icon-change commits. Since each file change is isolated, individual file reverts are possible without affecting other files.

### Estimated Effort: M (full day)

---

## MILESTONE M-04 — Theme System Consolidation

**Objective:** Remove the duplicated dark mode logic from Layout.tsx. Ensure ThemeContext is the single source of truth for `.dark` class management.

### Tasks

#### Task 4.1 — Audit ThemeContext / ThemeProvider
Read `src/context/ThemeContext.tsx` (or wherever it lives). Confirm it:
- Reads initial preference from `localStorage.getItem('theme')` or `prefers-color-scheme`
- Adds/removes `.dark` class on `document.documentElement` (`<html>`)
- Exposes `{ isDark, toggleTheme }` via context hook `useTheme()`
- Is wrapped around the app in `main.tsx` or `App.tsx`

If any of these is missing, fix them.

#### Task 4.2 — Remove duplicated theme logic from Layout.tsx (GA-018)
Remove the `useEffect` in `Layout.tsx` that reads `localStorage.getItem('theme')` and manages `.dark` class.
Replace with `const { isDark, toggleTheme } = useTheme()`.

#### Task 4.3 — Verify ThemeProvider wraps entire App
In `main.tsx` or `App.tsx`, ensure `<ThemeProvider>` wraps `<App>` (or the entire router). If it wraps only part of the tree, modals or toasts that render in a portal may not receive the dark class.

#### Task 4.4 — Remove any remaining localStorage.getItem('theme') calls outside ThemeContext
Grep for `localStorage.getItem('theme')` and `localStorage.setItem('theme')` across all files. All should live only inside ThemeContext.

### Files Affected
- `apps/web-frontend/src/components/Layout.tsx`
- `apps/web-frontend/src/context/ThemeContext.tsx` (possibly)
- `apps/web-frontend/src/main.tsx` (possibly)

### Components Affected
Layout.tsx (dark mode button behavior)

### Breaking Change Risk
**Low.** The visual result is identical. Risk is only if ThemeProvider is not currently set up correctly — but in that case, the fix is strictly an improvement.

### Testing Checklist
- [ ] Dark mode toggle button in header works
- [ ] `.dark` class is on `<html>` element (not `<body>`) when dark mode is active
- [ ] Page reload preserves dark mode preference
- [ ] OS dark mode preference is respected on first visit (no manual toggle needed)
- [ ] Modals that render in portal also receive dark mode styling
- [ ] No flash of incorrect theme on page load

### Rollback Plan
Restore the `useEffect` in Layout.tsx. Remove the `useTheme()` call. This is a two-minute revert.

### Estimated Effort: S (2–3 hours)

---

## MILESTONE M-05 — Core Component Rebuild Part 1 (Button, Badge, Input, Select, Modal)

**Objective:** Bring the 5 most-used shared components up to design system standard. These components are used on every page, so fixing them here propagates fixes everywhere.

### Tasks

#### Task 5.1 — Button component (GA-044, GA-115)
Additions/fixes:
- Replace `⟳` spinner with `<Loader2 className="animate-spin" />` (done in M-03, verify)
- Add missing variants: `outline`, `danger-outline`, `link`, `danger-ghost`
- Remove `isLoading` alias (mark deprecated with JSDoc `@deprecated use loading`)
- Ensure all size variants (`xs`, `sm`, `md`, `lg`) match DS spec
- Add `icon` prop support for icon-only buttons with `aria-label` enforcement
- All Tailwind classes must use CSS token utilities (from M-02), not raw `indigo-*`

#### Task 5.2 — Badge component (GA-117)
- `variant` prop is the only color control: `default`, `success`, `warning`, `danger`, `info`, `outline`
- All color classes must use CSS variable tokens, not hardcoded `green-*`, `red-*`, `amber-*`
- Add `dot` prop (shows a colored dot indicator before children)
- Formally deprecate `color` and `label` props with JSDoc. Keep them working (backward compat) until M-13 migrates all usages.

#### Task 5.3 — Input component
- Ensure all states styled via CSS tokens: default, hover, focus, disabled, error
- Add `error` prop displaying error text below input (with `aria-describedby`)
- Add `hint` prop for gray helper text below input
- Input wrapper must accept `className` on the wrapper div, not just the `<input>`
- All color classes use token utilities

#### Task 5.4 — Select component
- Same additions as Input (error, hint, token-based colors)
- Ensure disabled state is correctly styled

#### Task 5.5 — Modal component (GA-082, GA-083, GA-084, GA-085, GA-086, GA-118)
- Add `role="dialog"` to the dialog container
- Add `aria-modal="true"` to the dialog container
- Add `aria-labelledby="modal-title-{id}"` to the container, and `id="modal-title-{id}"` on the `<h2>` title element
- Close button: `aria-label="Close dialog"` (icon already done in M-03)
- Add Escape key handler: `useEffect(() => { const handler = (e) => { if (e.key === 'Escape') onClose(); }; ... })`
- Add focus management: on open, focus the first focusable element inside the modal
- Add focus trap: install `focus-trap-react` (or manual implementation) — tab key cycles only within modal
- Add missing sizes: `2xl` (`max-w-5xl`) and `fullscreen` (`w-full h-full max-w-none rounded-none`)
- Backdrop click should call `onClose` only if `closeOnBackdropClick !== false` prop

### Files Affected
- `apps/web-frontend/src/components/ui/Button.tsx`
- `apps/web-frontend/src/components/ui/Badge.tsx`
- `apps/web-frontend/src/components/ui/Input.tsx`
- `apps/web-frontend/src/components/ui/Select.tsx`
- `apps/web-frontend/src/components/ui/Modal.tsx`
- `apps/web-frontend/package.json` (add `focus-trap-react`)

### Components Affected
Button, Badge, Input, Select, Modal — all instances across all 51 pages.

### Breaking Change Risk
**Medium.**
- Button: adding variants is safe; removing `isLoading` must stay as deprecated (not deleted) until all usages updated
- Badge: deprecating `color`/`label` props but keeping them working — safe
- Modal: focus trap may interfere with pages that have custom focus handling inside modals. Test each modal carefully.
- Modal Escape key: could conflict if a page has its own Escape key handler. Rare but possible.

### Testing Checklist
- [ ] All Button variants render correctly (`primary`, `secondary`, `ghost`, `danger`, `outline`, `link`)
- [ ] Button loading state shows `Loader2` spinner (not `⟳`)
- [ ] Button icon-only variant (no text, just icon + aria-label) renders as a square
- [ ] Badge `variant` prop controls color correctly for all 6 variants
- [ ] Badge `dot` prop shows a small colored dot
- [ ] Input with `error` prop shows red border and error message below
- [ ] Input with `hint` prop shows gray hint text below
- [ ] Modal opens and focuses first focusable element automatically
- [ ] Tab key cycles only within the open modal
- [ ] Escape key closes the modal
- [ ] Backdrop click closes the modal
- [ ] Modal `2xl` and `fullscreen` sizes work
- [ ] All existing modals in the app still work (test every modal: confirm dialogs, form modals, etc.)
- [ ] Dark mode applied correctly to all components

### Rollback Plan
Each component is a self-contained file. Revert individual files via git. The `focus-trap-react` package can be removed if it causes problems — manual focus trap implementation is the alternative.

### Estimated Effort: L (2 days)

---

## MILESTONE M-06 — Core Component Rebuild Part 2 (ERPDataGrid, ERPPagination, ERPEmptyState, ERPSkeleton)

**Objective:** Build the `ERPDataGrid` system — the table component that every list page will use. This is the single largest component change and unblocks all list page standardization milestones.

### New Components to Create

All in `apps/web-frontend/src/components/erp/`:

#### Component 6.1 — ERPDataGrid
A full-featured data table replacing `DataTable`.

Props interface:
```ts
interface ERPDataGridProps<T> {
  columns: ERPColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  emptyState?: ReactNode;
  pagination?: ERPPaginationState;
  onPageChange?: (page: number) => void;
  onSort?: (key: string, dir: 'asc' | 'desc' | null) => void;
  sortState?: { key: string; dir: 'asc' | 'desc' } | null;
  rowKey: keyof T | ((row: T) => string);
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  density?: 'compact' | 'comfortable' | 'spacious';
  stickyHeader?: boolean;
  stickyActionsColumn?: boolean;
  footer?: ReactNode;
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
}

interface ERPColumnDef<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
  mono?: boolean;
  sticky?: 'left' | 'right';
  className?: string;
}
```

Features:
- Sortable columns with `ArrowUpDown` / `ArrowUp` / `ArrowDown` icons
- `animate-pulse` skeleton rows when `isLoading` (count matches last known row count or defaults to 5)
- Empty state: shows `ERPEmptyState` when `data.length === 0 && !isLoading`
- Bulk selection: sticky left checkbox column when `selectable` is true. Select-all header checkbox. When rows selected, show bulk action bar slot above table.
- Sticky header: `position: sticky; top: 0; z-var(--z-header)` on `<thead>`
- Sticky actions column: rightmost column with `position: sticky; right: 0`
- Row density: `compact` (28px row), `comfortable` (40px, default), `spacious` (52px)
- Footer totals row slot

#### Component 6.2 — ERPPagination
Below the table.

Props:
```ts
interface ERPPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}
```

Shows: "Showing 1–25 of 342 records" | Page buttons (prev, 1 2 3 ... 14, next) | Per-page select.

#### Component 6.3 — ERPEmptyState (GA-048, GA-067)
```ts
interface ERPEmptyStateProps {
  type: 'no-data' | 'no-results' | 'error' | 'no-access';
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: LucideIcon };
  icon?: LucideIcon;
}
```

#### Component 6.4 — ERPSkeleton variants
- `ERPTableSkeleton`: renders N skeleton rows (configurable) matching table width
- `ERPFormSkeleton`: renders form field skeletons (label + input, stacked)
- `ERPCardSkeleton`: renders a card-shaped skeleton
- `ERPDetailSkeleton`: renders a full page detail skeleton (header + KPI row + section cards)

All use `animate-pulse bg-surface-subtle rounded`.

#### Component 6.5 — ERPDropdownMenu (for row actions, GA-049)
Trigger button + popover menu.

```ts
interface ERPDropdownMenuProps {
  trigger?: ReactNode;
  items: ERPMenuItem[];
}

interface ERPMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  separator?: boolean;
}
```

Default trigger: `<button aria-label="More actions"><MoreHorizontal size={16} /></button>` in ghost variant.

### Deprecate Old DataTable
Add JSDoc `@deprecated Use ERPDataGrid instead` to `src/components/ui/DataTable.tsx`. Keep it working for now (it will be migrated page-by-page in M-13/M-14).

### Files Created
- `apps/web-frontend/src/components/erp/ERPDataGrid.tsx`
- `apps/web-frontend/src/components/erp/ERPPagination.tsx`
- `apps/web-frontend/src/components/erp/ERPEmptyState.tsx`
- `apps/web-frontend/src/components/erp/ERPSkeleton.tsx` (multiple exports)
- `apps/web-frontend/src/components/erp/ERPDropdownMenu.tsx`
- `apps/web-frontend/src/components/erp/index.ts` (re-exports)

### Files Modified
- `apps/web-frontend/src/components/ui/DataTable.tsx` (deprecation JSDoc only)

### Breaking Change Risk
**Low.** All new files. Old `DataTable` continues to work. Pages migrate one at a time in M-13.

### Testing Checklist
- [ ] ERPDataGrid renders data with correct columns
- [ ] ERPDataGrid shows skeleton rows when `isLoading` (5 animate-pulse rows)
- [ ] ERPDataGrid shows ERPEmptyState when data is empty
- [ ] Sorting works: click column header → ascending → descending → reset
- [ ] Sortable column shows `ArrowUpDown` when unsorted, `ArrowUp`/`ArrowDown` when sorted
- [ ] Non-sortable columns show no sort icon, header not clickable
- [ ] Sticky header stays at top when scrolling rows
- [ ] Sticky actions column stays at right when horizontal scrolling
- [ ] Checkbox column appears when `selectable` is true
- [ ] Select-all header checkbox selects/deselects all rows on current page
- [ ] `density` prop changes row height correctly
- [ ] Footer slot renders footer row with distinct background
- [ ] ERPPagination shows correct "Showing X–Y of Z records" text
- [ ] ERPPagination "next" and "prev" buttons work and are disabled at boundaries
- [ ] ERPPagination page size change triggers `onPageSizeChange`
- [ ] ERPEmptyState shows correct illustration for each type
- [ ] ERPDropdownMenu trigger (`···`) opens menu on click
- [ ] ERPDropdownMenu closes on Escape, on outside click, and after item click
- [ ] ERPDropdownMenu danger items render in red
- [ ] Separator renders between groups
- [ ] ERPSkeleton variants all render without errors

### Rollback Plan
These are all new files. If ERPDataGrid has critical bugs, simply do not use it on any list page yet. Delete or disable the new components. Pages continue using old `DataTable`.

### Estimated Effort: XL (3–4 days)

---

## MILESTONE M-07 — Layout Shell Rebuild

**Objective:** Rebuild `Layout.tsx` to match the design system standard: module group headers, tooltip on collapsed icons, notification bell, quick-create button, global search trigger. Depends on M-03 (icons), M-04 (theme), M-06 (for ERPEmptyState in notification panel).

### Tasks

#### Task 7.1 — Create `ui.store.ts` in Zustand (GA-006)
```ts
// src/store/ui.store.ts
interface UIState {
  sidebarCollapsed: boolean;
  density: 'compact' | 'comfortable' | 'spacious';
  commandPaletteOpen: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  setDensity: (v: UIState['density']) => void;
  setCommandPaletteOpen: (v: boolean) => void;
}
```
Persist `sidebarCollapsed` and `density` to localStorage.

#### Task 7.2 — Rebuild sidebar navigation with module groups (GA-021)
Replace the flat `navItems` array with a `navGroups` array:
```ts
const navGroups = [
  { label: 'WORKSPACE', items: [{ label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' }] },
  { label: 'MASTER DATA', items: [Organization, Branches, Warehouses, UOM] },
  { label: 'SALES & CRM', items: [Customers, Quotations, Invoices, DeliveryChallans, Payments, SaleReturns] },
  { label: 'INVENTORY', items: [Items, StockLevels, StockAdjustments, StockTransfers, PhysicalVerifications] },
  { label: 'PURCHASING', items: [Suppliers, ...] },
  { label: 'ACCOUNTING', items: [ChartOfAccounts, OpeningBalances, GST] },
  { label: 'REPORTS', items: [Reports] },
  { label: 'SETTINGS', items: [Settings, Users] },
];
```
Group headers: `text-[10px] uppercase tracking-widest font-semibold text-text-secondary px-3 mb-1 mt-4`.

#### Task 7.3 — Add tooltip on collapsed sidebar items (GA-022)
When `sidebarCollapsed`, each nav item wraps in a tooltip component showing the item label.
Use a simple CSS tooltip or a `Tooltip` component with `title` attribute as fallback.

#### Task 7.4 — Add quick-create button in header (GA-016)
`+` (`Plus` icon) button in top-right header area. Opens a dropdown with 6–8 creatable entities: New Invoice, New Customer, New Item, New Payment, New Stock Adjustment, New Quotation.

#### Task 7.5 — Add notification bell stub (GA-017)
`Bell` icon button. Shows badge with unread count (hardcoded `0` for now, to be connected to real API in Phase 5+).
Clicking opens a side panel `<ERPDrawer>` (or simple dropdown) with "No notifications" `ERPEmptyState`.

#### Task 7.6 — Read sidebar state from `ui.store.ts` (GA-018 cleanup)
Replace all `useState` for sidebar state in Layout.tsx with `useUIStore()`.

#### Task 7.7 — User menu improvements (GA-023)
User avatar area at sidebar bottom:
- Show name, email, role (from auth store)
- Add Settings link
- Logout with `LogOut` icon and `aria-label`

### Files Affected
- `apps/web-frontend/src/components/Layout.tsx` (major rewrite)
- `apps/web-frontend/src/store/ui.store.ts` (new)

### Components Affected
Layout.tsx is used by every authenticated page. Any bug here affects the whole app.

### Breaking Change Risk
**High.** This is the main app shell. Changes affect every page simultaneously.

Mitigation:
- Build new Layout as `LayoutV2.tsx` first
- Test it in parallel with the old Layout (behind a temporary feature flag or just swap at the end)
- Switch the import in App.tsx only after all tests pass

### Testing Checklist
- [ ] All navigation items appear under correct module groups
- [ ] Module group headers are visible and not clickable
- [ ] Nav group items are expandable/collapsible if they have sub-items
- [ ] Active nav item is highlighted correctly (current route)
- [ ] Sidebar collapses to icon-only mode
- [ ] When collapsed, hovering an icon shows tooltip with item label
- [ ] Collapse button icon is `PanelLeftClose` / `PanelLeftOpen`
- [ ] Sidebar state (collapsed/expanded) persists across page refresh
- [ ] Quick-create `+` button opens dropdown with correct items
- [ ] Quick-create items navigate to correct routes
- [ ] Notification bell icon is visible in header
- [ ] Dark mode works correctly in the new layout
- [ ] User menu shows: name, email, role, settings link, logout button
- [ ] Logout button calls the auth store's logout and redirects to `/login`
- [ ] Logo shows in sidebar header
- [ ] Sidebar does not overlay content at 1280px viewport width

### Rollback Plan
Keep old `Layout.tsx` in version control. If new Layout has blocking issues, swap `LayoutV2` import back to `Layout` in App.tsx. One-line change.

### Estimated Effort: L (full day + half day testing)

---

## MILESTONE M-08 — Page Header & Breadcrumb System

**Objective:** Build the `ERPPageHeader` component and a breadcrumb system, then migrate all 51 pages to use it.

### Tasks

#### Task 8.1 — Build ERPPageHeader component
Create `apps/web-frontend/src/components/erp/ERPPageHeader.tsx`:

**List variant** (for list pages):
- Left: optional icon, title (`text-2xl font-semibold`), subtitle (`text-sm text-secondary`)
- Right: action buttons slot

**Detail variant** (for record detail/edit pages):
- Left: back button (`ArrowLeft`), entity type label, entity number (mono), status badge (ERPBadge), metadata line
- Right: action buttons slot + more-actions dropdown (for destructive actions)

Use URL-based back navigation (e.g., `navigate('/sales/invoices')`) not `navigate(-1)`.

#### Task 8.2 — Build ERPBreadcrumb component
Create `apps/web-frontend/src/components/erp/ERPBreadcrumb.tsx`.

Uses React Router `useMatches()` — each route must define a `handle.breadcrumb` function.

Format: `Dashboard / Sales / Invoices / INV-0023`
Each part except the last is a clickable `<Link>`.

#### Task 8.3 — Add route `handle` metadata to App.tsx
Add `handle` to every route:
```tsx
{ path: 'sales/invoices', element: <InvoicesPage />, handle: { breadcrumb: () => [{ label: 'Invoices', to: '/sales/invoices' }] } }
```

#### Task 8.4 — Migrate all 51 pages from PageHeader to ERPPageHeader
Replace `<PageHeader title="..." subtitle="..." />` with `<ERPPageHeader variant="list" title="..." subtitle="..." icon={Receipt} actions={...} />` on every list page.

On detail/form pages, use `variant="detail"` with `entityType`, `entityNumber`, `status`, `backTo` props.

#### Task 8.5 — Deprecate old PageHeader
Mark `src/components/ui/PageHeader.tsx` as deprecated after all usages migrated.

### Files Created
- `apps/web-frontend/src/components/erp/ERPPageHeader.tsx`
- `apps/web-frontend/src/components/erp/ERPBreadcrumb.tsx`

### Files Modified
- `apps/web-frontend/src/App.tsx` (add `handle` to all routes)
- All 51 page files (replace `<PageHeader>` with `<ERPPageHeader>`)

### Breaking Change Risk
**Medium.** The visual change is significant (more information shown) but the underlying routing is unchanged.

### Testing Checklist
- [ ] Every list page shows `ERPPageHeader` with icon, title, subtitle, and action buttons
- [ ] Every detail/form page shows back button navigating to the correct parent list
- [ ] Breadcrumb in top header reflects current page path
- [ ] Breadcrumb links are clickable and navigate correctly
- [ ] Destructive actions (Cancel Invoice, Delete Customer) are hidden inside "More Actions" dropdown, not in primary button row
- [ ] Status badge appears next to entity number on detail pages
- [ ] Page header is not cut off on mobile (320px viewport minimum)

### Rollback Plan
If ERPPageHeader has blocking issues on any page, that page can revert to the old `PageHeader` import. They coexist.

### Estimated Effort: M (1 full day for component + migration)

---

## MILESTONE M-09 — Route Architecture & Code Splitting

**Objective:** Add `React.lazy()` for all 51 routes and wrap each in `<Suspense>` and `<ErrorBoundary>`. Fix the 3 broken routes (detail pages that render list components).

### Tasks

#### Task 9.1 — Create ERPErrorBoundary component (GA-005)
```tsx
// src/components/erp/ERPErrorBoundary.tsx
// Class component that catches render errors and shows ERPEmptyState type="error"
```

#### Task 9.2 — Convert all static imports to React.lazy (GA-004, GA-108)
In `App.tsx`, replace:
```ts
import InvoicesPage from './pages/sales/InvoicesPage';
```
with:
```ts
const InvoicesPage = React.lazy(() => import('./pages/sales/InvoicesPage'));
```
for all 51 pages.

#### Task 9.3 — Wrap each module group in Suspense + ErrorBoundary
Group routes by module. Wrap each group:
```tsx
<Route path="sales" element={
  <ERPErrorBoundary>
    <Suspense fallback={<ERPDetailSkeleton />}>
      <Outlet />
    </Suspense>
  </ERPErrorBoundary>
}>
```

#### Task 9.4 — Fix broken routes (GA-007, GA-008, GA-009)
- `/sales/quotations/:id` → Create `<QuotationDetailPage />` (stub — shows entity detail skeleton with "Detail coming soon" message until Phase 5)
- `/inventory/transfers/:id` → `<StockTransferDetailPage />` (stub)
- `/sales/payments/new` → Move payment creation to a dedicated `<PaymentFormPage />` or keep the modal but fix the route

#### Task 9.5 — Add 404 page (GA-010)
Create `<NotFoundPage />` for the catch-all route:
```tsx
<Route path="*" element={<NotFoundPage />} />
```
Shows `ERPEmptyState type="no-data"` with a "Go to Dashboard" button.

### Files Created
- `apps/web-frontend/src/components/erp/ERPErrorBoundary.tsx`
- `apps/web-frontend/src/pages/sales/QuotationDetailPage.tsx` (stub)
- `apps/web-frontend/src/pages/inventory/StockTransferDetailPage.tsx` (stub)
- `apps/web-frontend/src/pages/NotFoundPage.tsx`

### Files Modified
- `apps/web-frontend/src/App.tsx` (major — all imports become lazy)

### Breaking Change Risk
**Low–Medium.** `React.lazy` is well-supported. Risk: any circular import or dynamic import failure will cause a lazy load error (caught by ErrorBoundary).

### Testing Checklist
- [ ] App loads on first visit — no blank screen
- [ ] Each module group loads its pages lazily (verify via Network tab: separate chunks loaded on first visit to each module)
- [ ] Suspense fallback shows while chunk loads
- [ ] ErrorBoundary catches and shows a fallback if a page throws during render
- [ ] `/sales/quotations/123` now renders QuotationDetailPage, not the list
- [ ] `/inventory/transfers/123` now renders StockTransferDetailPage, not the list
- [ ] `/not-a-real-route` renders 404 page instead of redirecting
- [ ] All 51 routes still navigate to the correct page

### Rollback Plan
Convert lazy imports back to static imports in App.tsx. Revert takes about 30 minutes.

### Estimated Effort: L (1.5 days — mostly careful systematic work)

---

## MILESTONE M-10 — Shared Utility Library

**Objective:** Create shared utility functions for dates, currency, and Indian states. These utilities will be imported wherever formatting is done, replacing all one-off inline formatting.

### Tasks

#### Task 10.1 — Date formatting utilities
Create `apps/web-frontend/src/lib/format.ts`:
```ts
export function formatDate(date: string | Date | null | undefined): string
// Returns "29 Jun 2026" or "–" if null

export function formatDateTime(date: string | Date | null | undefined): string
// Returns "29 Jun 2026, 3:45 PM" or "–"

export function formatDateRelative(date: string | Date): string
// Returns "2 days ago", "just now", "in 3 hours"
```

#### Task 10.2 — Currency formatting utilities
```ts
export function formatCurrency(amount: number | string | null | undefined, options?: { showSymbol?: boolean }): string
// Returns "₹1,23,456.00" (Indian lakh format) or "–" if null

export function formatNumber(value: number | string | null | undefined): string
// Returns "1,23,456" (Indian format, no decimals)
```

#### Task 10.3 — Indian states/UTs constant
```ts
// src/lib/indianStates.ts
export const INDIAN_STATES = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  // ... all 37 states and UTs
  { code: '27', name: 'Maharashtra' },
  // ...
];
```

#### Task 10.4 — Replace `sellerState: '27'` hardcoding (GA-069)
In `InvoiceFormPage.tsx`, fetch seller state from org settings instead of hardcoding `'27'`. Use `useQuery` to get org settings.

#### Task 10.5 — Replace Place of Supply free-text input (GA-070)
In `InvoiceFormPage.tsx`, replace the `<Input>` for state code with a `<Select>` that uses `INDIAN_STATES` as options.

#### Task 10.6 — Replace all `.toLocaleDateString()` calls (GA-112)
Grep for `.toLocaleDateString` and `toLocaleString` across all files. Replace with `formatDate()` from the utility.

#### Task 10.7 — Replace all inline currency formatting (GA-113)
Grep for `toLocaleString('en-IN'` and `toFixed(2)`. Replace with `formatCurrency()`.

### Files Created
- `apps/web-frontend/src/lib/format.ts`
- `apps/web-frontend/src/lib/indianStates.ts`

### Files Modified
- `apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx`
- Multiple list and detail pages (GA-112, GA-113)

### Breaking Change Risk
**None.** Utility functions are additive. Old inline formatting replaced with equivalent result.

### Testing Checklist
- [ ] `formatDate(null)` returns `"–"` (not crash)
- [ ] `formatDate("2026-06-29T10:30:00Z")` returns `"29 Jun 2026"` (not "6/29/2026")
- [ ] `formatCurrency(123456)` returns `"₹1,23,456.00"` (Indian lakh format)
- [ ] `formatCurrency(null)` returns `"–"`
- [ ] Invoice form Place of Supply dropdown lists all 37 states
- [ ] Invoice GST calculation uses the org's state code, not hardcoded `'27'`
- [ ] All table columns showing dates use the consistent format
- [ ] Currency values in tables are right-aligned and monospace

### Rollback Plan
None needed — no structural changes. Individual utility imports can be removed and replaced with old inline code if needed.

### Estimated Effort: S (1 day)

---

## MILESTONE M-11 — Form Component Library

**Objective:** Build the form component library (`components/form/`) and implement ERPStickyFooter. After this milestone, every form in the app can use the same set of consistent, validated, accessible form components.

### New Components to Create

All in `apps/web-frontend/src/components/form/`:

#### ERPInput (wraps existing Input with better API)
Props: `name`, `label`, `required`, `error`, `hint`, `prefix`, `suffix`, icon, `type`. Connects to React Hook Form via `register()`.

#### ERPSelect (wraps existing Select)
Props: `name`, `label`, `required`, `error`, `options: {value, label}[]`.

#### ERPTextarea
Props: `name`, `label`, `rows`, `maxLength`, `autoResize`, `error`. Auto-resize on content change.

#### ERPSwitch
Toggle switch for booleans. Props: `name`, `label`, `description`.

#### ERPAsyncSelect
Searchable select with async loading. Debounced search, minimum chars, loading spinner.

#### ERPGSTINInput
GSTIN field with format validation and checksum verification.

#### ERPFormSection
Card wrapper for form sections. Props: `title`, `subtitle`, `icon`, `children`.

#### ERPStickyFooter
Fixed footer for form pages.
- Monitors `useScrollTrigger()` — shows when user scrolls past the inline submit buttons
- Shows: dirty indicator `●`, `Cancel` (ghost), optionally `Save Draft` (outline), `Save & Submit` (primary)
- `position: fixed; bottom: 0; left: sidebarWidth; right: 0; z-var(--z-header)`

#### ERPConfirmModal (GA-086)
Standardized confirmation dialog.
Props: `isOpen`, `onClose`, `onConfirm`, `title`, `description`, `confirmLabel`, `cancelLabel`, `variant: 'danger' | 'warning' | 'primary'`, `isLoading`.

#### ERPDrawer (GA-087)
Side panel for complex forms that don't warrant a full page.
Props: `isOpen`, `onClose`, `title`, `subtitle`, `size: 'sm'|'md'|'lg'|'xl'`.
Slides in from the right. Has same focus trap and Escape behavior as Modal.

### Tasks

#### Task 11.1 — Create all form components above
Save to `apps/web-frontend/src/components/form/`.

#### Task 11.2 — Fix SaleReturnsPage (GA-076, GA-077, GA-098)
- Replace raw `<Input type="number">` for invoice and customer selection with `ERPAsyncSelect`
- Replace raw `<input type="checkbox">` with `ERPSwitch`
- Confirm `branchId` is fixed (from M-01)

#### Task 11.3 — Add ERPStickyFooter to InvoiceFormPage (GA-064)
The Invoice form is long — the Save button scrolls off screen. Add `ERPStickyFooter` at the bottom of the page that appears when scrolled past the inline buttons.

#### Task 11.4 — Fix Notes field in InvoiceFormPage (GA-071)
Replace `<Input>` single-line for notes with `<ERPTextarea autoResize rows={3} />`.

#### Task 11.5 — Fix CustomerFormPage (GA-072, GA-073, GA-074)
- Wrap form sections in `ERPFormSection` cards
- Replace hardcoded green/red GSTIN status with Lucide `CheckCircle2`/`AlertCircle` + token colors

#### Task 11.6 — Fix ItemFormPage (GA-075)
Replace raw `<input type="checkbox">` with `ERPSwitch`.

### Files Created
- `apps/web-frontend/src/components/form/ERPInput.tsx`
- `apps/web-frontend/src/components/form/ERPSelect.tsx`
- `apps/web-frontend/src/components/form/ERPTextarea.tsx`
- `apps/web-frontend/src/components/form/ERPSwitch.tsx`
- `apps/web-frontend/src/components/form/ERPAsyncSelect.tsx`
- `apps/web-frontend/src/components/form/ERPGSTINInput.tsx`
- `apps/web-frontend/src/components/form/ERPFormSection.tsx`
- `apps/web-frontend/src/components/erp/ERPStickyFooter.tsx`
- `apps/web-frontend/src/components/erp/ERPConfirmModal.tsx`
- `apps/web-frontend/src/components/erp/ERPDrawer.tsx`
- `apps/web-frontend/src/components/form/index.ts`

### Files Modified
- `apps/web-frontend/src/pages/sales/SaleReturnsPage.tsx`
- `apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx`
- `apps/web-frontend/src/pages/customers/CustomerFormPage.tsx`
- `apps/web-frontend/src/pages/items/ItemFormPage.tsx`

### Breaking Change Risk
**Low.** All new components. Modified pages change presentation only — business logic (API calls, state) unchanged.

### Testing Checklist
- [ ] ERPAsyncSelect: typing 1 character shows spinner, 2+ characters shows results
- [ ] ERPAsyncSelect: selecting a result sets the form value correctly
- [ ] ERPAsyncSelect: clearing selection resets the form value
- [ ] ERPSwitch: toggling works, value reflected in form state
- [ ] ERPStickyFooter: appears when page is scrolled down far enough
- [ ] ERPStickyFooter: `●` indicator shows when form is dirty
- [ ] ERPStickyFooter: Cancel button shows confirm dialog if form is dirty
- [ ] ERPConfirmModal: appears when triggered, Escape and Cancel both close it
- [ ] ERPConfirmModal: clicking "Confirm" calls the mutation, shows loading state
- [ ] ERPDrawer: slides in from right, focus trapped inside, Escape closes it
- [ ] SaleReturnsPage: can search for an invoice by number (not type raw ID)
- [ ] SaleReturnsPage: "Physical Return" toggle works
- [ ] Invoice form: Notes field is multi-line and auto-resizes
- [ ] Customer form: sections appear in section cards
- [ ] Item form: "Track Inventory" shows as a toggle switch

### Rollback Plan
All new components are additive. Modified pages can revert their component imports individually.

### Estimated Effort: L (2 full days)

---

## MILESTONE M-12 — Color Token Migration — All Pages

**Objective:** Replace every hardcoded `indigo-*`, `green-*`, `red-*`, `amber-*`, `orange-*`, `gray-*` color class with CSS token utilities across all 51 page files and all shared components.

### Tasks

#### Task 12.1 — Run a comprehensive grep for hardcoded color classes
Find every instance of:
- `indigo-` (brand color, should be `primary`)
- `text-green-` / `bg-green-` (should be `success`)
- `text-red-` / `bg-red-` (should be `danger`)
- `text-amber-` / `bg-amber-` (should be `warning`)
- `text-orange-` / `bg-orange-` (should be `warning`)
- `gray-750` (invalid Tailwind class, GA-123)
- `bg-white` in cards (should be `bg-surface-card`)
- `dark:bg-gray-800`, `dark:bg-gray-900`, `dark:bg-gray-700` (should be token variants)

#### Task 12.2 — Apply systematic replacements

| Hardcoded Class | Replace With | Context |
|----------------|-------------|---------|
| `text-indigo-600 dark:text-indigo-400` | `text-primary` | Brand links |
| `bg-indigo-600 hover:bg-indigo-700` | `bg-primary hover:bg-primary-hover` | Brand backgrounds |
| `text-green-600 dark:text-green-400` | `text-success` | Positive values |
| `bg-green-50 dark:bg-green-900/20` | `bg-success-bg` | Success backgrounds |
| `text-red-600 dark:text-red-400` | `text-danger` | Negative values |
| `bg-red-50 dark:bg-red-900/20` | `bg-danger-bg` | Error backgrounds |
| `text-amber-600 dark:text-amber-400` | `text-warning` | Warning values |
| `bg-amber-50 dark:bg-amber-900/20` | `bg-warning-bg` | Warning backgrounds |
| `bg-white dark:bg-gray-900` | `bg-surface-card` | Card backgrounds |
| `bg-white dark:bg-gray-800` | `bg-surface-raised` | Raised surface |
| `border-gray-200 dark:border-gray-700` | `border-default` | Default borders |
| `text-gray-900 dark:text-gray-100` | `text-primary` | Primary text |
| `text-gray-500 dark:text-gray-400` | `text-secondary` | Secondary text |
| `text-gray-400 dark:text-gray-500` | `text-disabled` | Disabled/placeholder |
| `dark:hover:bg-gray-750` | `dark:hover:bg-surface-raised` | Invalid class |
| `hover:bg-indigo-50` | `hover:bg-primary/5` | Hover on light bg |

#### Task 12.3 — Fix Badge component colors
Replace inline Tailwind color strings in Badge with CSS variable-based classes from M-05 work.

#### Task 12.4 — Replace ERPInlineAlert / alert banners (GA-037, GA-038)
In `OpeningBalancesPage.tsx`, replace hardcoded alert banner divs with the `ERPInlineAlert` component (built as part of the form component library in M-11).

### Files Affected
All 51 page files + `Layout.tsx` + all UI components.

### Components Affected
Badge, Button (verify tokens applied), Layout, all page files.

### Breaking Change Risk
**Low.** Visual changes only. All semantic colors map 1:1 to their intended meaning. Dark mode automatically handled by the token system.

### Testing Checklist
- [ ] No instances of `indigo-`, `green-`, `red-`, `amber-`, `orange-`, `gray-750` remain in page files
- [ ] Brand color (`--brand-primary`) used consistently for all interactive elements
- [ ] Success color used for positive amounts, completed statuses
- [ ] Danger color used for negative amounts, cancelled/error statuses
- [ ] Warning color used for pending/unallocated amounts
- [ ] Card backgrounds use `bg-surface-card` (lighter in light mode, darker in dark mode)
- [ ] All changes look correct in light AND dark mode
- [ ] No elements have become invisible (e.g., white text on white background)

### Rollback Plan
Individual file reverts. Since this is a systematic text replacement, each file can be reverted independently.

### Estimated Effort: M (1 day systematic replacement)

---

## MILESTONE M-13 — List Page Standardization — Sales Module

**Objective:** Migrate all Sales module list pages to use `ERPDataGrid` (from M-06), `ERPToolbar` (filter area), `ERPPageHeader`, debounced search, and confirmation dialogs for destructive actions.

### Pages in Scope
- CustomersPage
- SuppliersPage
- QuotationsPage
- InvoicesPage
- PaymentsPage
- SaleReturnsPage
- DeliveryChallansPage

### Per-Page Tasks

#### For Each Page:
1. Replace `<DataTable>` with `<ERPDataGrid>` — configure correct columns, row key, `sortable` columns
2. Replace inline filter div with `<ERPToolbar>` component
3. Add `useDebounce(searchQuery, 300)` to search input (GA-057)
4. Add `onPageChange` and `pagination` props to `ERPDataGrid` — connect to URL query params `?page=1&pageSize=25`
5. Row actions → `<ERPDropdownMenu>` with `···` trigger (GA-049)
6. Delete/Cancel actions → show `<ERPConfirmModal>` before executing (GA-099, GA-100)
7. Replace deprecated `Badge color="..."` usages with `Badge variant="..."` (GA-117)
8. Customer/Item name in columns: ensure API returns the name, not just ID (GA-119)
9. Replace `toast.success('Customer deactivated')` with accurate message (GA-099)

#### Additional for InvoicesPage:
- Balance due column: right-align, `font-mono`, `text-danger` for nonzero
- Date column: use `formatDate()` utility
- Status badge using correct `variant`

### Files Modified
- `apps/web-frontend/src/pages/customers/CustomersPage.tsx`
- `apps/web-frontend/src/pages/suppliers/SuppliersPage.tsx`
- `apps/web-frontend/src/pages/sales/QuotationsPage.tsx`
- `apps/web-frontend/src/pages/sales/InvoicesPage.tsx`
- `apps/web-frontend/src/pages/sales/PaymentsPage.tsx`
- `apps/web-frontend/src/pages/sales/SaleReturnsPage.tsx`
- `apps/web-frontend/src/pages/sales/DeliveryChallansPage.tsx`

### Breaking Change Risk
**Medium.** Pagination changes require backend to support page/pageSize parameters and return total counts. If backend doesn't support this yet, implement client-side pagination as a temporary workaround (slice the array).

### Testing Checklist
- [ ] Each page table renders all expected columns
- [ ] Sorting works on sortable columns
- [ ] Skeleton rows appear during load
- [ ] Empty state appears with message and create button when no records
- [ ] Pagination controls show and navigate between pages
- [ ] Search input is debounced (no API call until 300ms after typing stops)
- [ ] Active filters show filter chips below toolbar
- [ ] `···` row action menu opens with View, Edit, and conditional other actions
- [ ] Delete action requires confirmation via ERPConfirmModal
- [ ] Confirmation "Confirm Delete" executes the mutation
- [ ] Toast message after delete is accurate (not "deactivated" if deleted)
- [ ] No customer/supplier/item shown as a raw ID number in any column
- [ ] Currency columns right-aligned and monospace

### Rollback Plan
Pages can be individually reverted. `DataTable` is still available (deprecated but working).

### Estimated Effort: L (2 days — 7 pages × ~3 tasks each)

---

## MILESTONE M-14 — List Page Standardization — Inventory & Accounting Modules

**Objective:** Apply the same standardization from M-13 to all Inventory and Accounting list pages.

### Pages in Scope
- ItemsPage
- StockLevelsPage
- StockAdjustmentsPage
- StockTransfersPage
- PhysicalVerificationPage
- ChartOfAccountsPage (special: tree table)
- GstConfigPage

### Special Case: ChartOfAccountsPage (tree table)
The chart of accounts is a tree structure, not a flat list. `ERPDataGrid` does not support trees natively. Options:
1. Build an `ERPTreeGrid` extension of `ERPDataGrid` that supports `children` in the row data
2. Keep the custom `AccountRow` but replace:
   - Text chars `▼`/`▶` → Lucide icons (already done in M-03)
   - `TYPE_COLORS` `'indigo'` → `ERPStatusBadge` variant
   - Loading state → skeleton
   - Empty state → ERPEmptyState

**Decision:** Option 2 (improve in place) — tree table is a specialized enough component that a full ERPDataGrid integration would be over-engineering.

### Files Modified
- `apps/web-frontend/src/pages/items/ItemsPage.tsx`
- `apps/web-frontend/src/pages/inventory/StockLevelsPage.tsx`
- `apps/web-frontend/src/pages/inventory/StockAdjustmentsPage.tsx`
- `apps/web-frontend/src/pages/inventory/StockTransfersPage.tsx`
- `apps/web-frontend/src/pages/inventory/PhysicalVerificationPage.tsx`
- `apps/web-frontend/src/pages/accounting/ChartOfAccountsPage.tsx`
- `apps/web-frontend/src/pages/gst/GstConfigPage.tsx`

### Testing Checklist
Same as M-13 checklist, applied to each inventory and accounting page.

Additional:
- [ ] Stock levels page shows warning/danger colors for low/critical stock
- [ ] Chart of Accounts tree expand/collapse still works with new icon implementation
- [ ] ChartOfAccounts account type badges display correctly for all account types

### Estimated Effort: L (1.5 days — 7 pages, tree table is special case)

---

## MILESTONE M-15 — Invoice Form Complete Rewrite

**Objective:** Rewrite `InvoiceFormPage.tsx` using React Hook Form + Zod, `ERPAsyncSelect` for customer, `ERPLineItemsTable`, `ERPStickyFooter`, and Place of Supply dropdown.

This is the most complex form in the app. It needs its own dedicated milestone.

### Tasks

#### Task 15.1 — Define Zod schema
```ts
const invoiceLineSchema = z.object({
  itemId: z.number({ required_error: 'Item required' }),
  hsnCode: z.string().optional(),
  qty: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().nonnegative(),
  discountPct: z.number().min(0).max(100).optional(),
  taxRateId: z.number().optional(),
});

const invoiceSchema = z.object({
  customerId: z.number({ required_error: 'Customer required' }),
  branchId: z.number(),
  warehouseId: z.number({ required_error: 'Warehouse required' }),
  placeOfSupply: z.string().length(2, 'Select a state'),
  invoiceDate: z.string(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(invoiceLineSchema).min(1, 'Add at least one item'),
});
```

#### Task 15.2 — Replace `useState` with `useForm` + `useFieldArray`
- `useForm({ resolver: zodResolver(invoiceSchema) })`
- `useFieldArray({ control, name: 'lines' })` for line items

#### Task 15.3 — Replace customer dropdown
Replace `useQuery({ queryFn: () => customerApi.list({}) })` (loads all) with `ERPAsyncSelect` that searches by typing.

#### Task 15.4 — Replace Place of Supply input with Select
Use `INDIAN_STATES` constant from M-10. Default to org state.

#### Task 15.5 — Read seller state from org settings (GA-069)
Use `useQuery({ queryKey: ['org-settings'], queryFn: orgApi.get })` to get org's GSTIN state.

#### Task 15.6 — Fix Notes field
Replace `<Input>` with `<ERPTextarea autoResize>`.

#### Task 15.7 — Rebuild line items table as ERPLineItemsTable
Replace raw `<table>` + raw `<input>` elements with a proper component that uses `ERPInput` in inline-edit mode.

#### Task 15.8 — Add ERPStickyFooter
Shows when scrolled past the visible submit button area.

#### Task 15.9 — Validate and submit via form.handleSubmit
Remove manual `if (!customerId || !branchId) { toast.error }` validation. All validation from Zod schema. Errors shown below fields.

### Files Modified
- `apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx` (complete rewrite)

### New Components
- `apps/web-frontend/src/components/erp/ERPLineItemsTable.tsx` (reusable for purchase orders too)

### Breaking Change Risk
**High.** Complete rewrite of the most complex page. A bug here could break invoice creation.

Mitigation: Keep the old file as `InvoiceFormPage.bak.tsx` until fully validated. Switch import only after all tests pass.

### Testing Checklist
- [ ] Customer search: typing shows results, selecting sets `customerId`
- [ ] Warehouse dropdown shows all warehouses
- [ ] Place of Supply shows all 37 states, defaults to org's state
- [ ] Invoice Date is required, shows error if empty
- [ ] Adding an item: search works, item added to table
- [ ] Item quantity: must be positive, shows error if 0 or negative
- [ ] Item price: shows correctly, editable
- [ ] Discount: 0–100%, shows error if out of range
- [ ] GST calculated correctly based on Place of Supply vs seller state (IGST vs CGST+SGST)
- [ ] Notes field is multi-line
- [ ] Submit button disabled while form is invalid
- [ ] Submitting with empty lines shows "Add at least one item" error
- [ ] Successful submission navigates to the new invoice detail page
- [ ] Dirty state indicator (`●`) appears when any field is changed
- [ ] Leaving page with dirty form shows confirmation dialog
- [ ] ERPStickyFooter appears when scrolled down
- [ ] Branchid comes from auth store (not hardcoded 1)

### Rollback Plan
`InvoiceFormPage.bak.tsx` → rename back. Swap import in App.tsx. This is why the backup file is kept.

### Estimated Effort: XL (3 days)

---

## MILESTONE M-16 — Dashboard Real Data & Charts

**Objective:** Replace the placeholder dashboard with real API data, remove dev scaffolding text, and add basic charts.

### Tasks

#### Task 16.1 — Remove "Phase 2" dev scaffolding text (GA-089)
Immediate fix — remove the hardcoded development instructions text from DashboardPage.tsx.

#### Task 16.2 — Connect KPI cards to real APIs (GA-088)
Replace static `stats` array with `useQuery` calls:
- Total Customers: `customerApi.list({ page: 1, pageSize: 1 })` → use `total` from response
- Total Suppliers: same pattern
- Active Items: `itemApi.list({ status: 'active', page: 1, pageSize: 1 })` → `total`
- Today's Invoice Total: `invoiceApi.list({ dateFrom: today, page: 1, pageSize: 1 })` → sum or get from an aggregate endpoint

#### Task 16.3 — Make KPI cards clickable (GA-091)
Wrap each `ERPStatCard` in a `<Link>` to the relevant list page.

#### Task 16.4 — Add basic charts (GA-090)
Requires `recharts` package:
```bash
pnpm --filter web-frontend add recharts
```

**Sales Trend:** `LineChart` showing last 30 days of invoice totals. Requires new backend endpoint: `GET /api/v2/reports/sales-trend?days=30`

**Low Stock Alert List:** Table of top 10 items below reorder level. Requires: `itemApi.listLowStock()` or a query param.

#### Task 16.5 — Recent Activity (optional if API not ready)
If the activity log API is not yet available, show the top 5 most recent invoices as a "Recent Invoices" list instead.

### Files Modified
- `apps/web-frontend/src/pages/DashboardPage.tsx`

### Backend Dependencies
This milestone has the highest backend dependency. If backend aggregate/report endpoints don't exist:
- Remove dev text (Task 16.1) ← always safe
- Connect what's possible from existing APIs (Tasks 16.2, 16.3) ← safe
- Charts require new endpoints ← defer Task 16.4 until backend is ready

### Testing Checklist
- [ ] "Phase 2" text is gone
- [ ] KPI cards show real numbers from the API
- [ ] KPI cards show skeleton while loading
- [ ] Clicking a KPI card navigates to the correct list page
- [ ] Charts render with data (if backend endpoints available)
- [ ] Charts show skeleton/empty state while loading or when no data
- [ ] Dashboard looks correct in dark mode

### Estimated Effort: L (1 day if APIs exist; 0.5 day for cleanup only if APIs not ready)

---

## MILESTONE M-17 — Authentication Fixes

**Objective:** Fix 3 auth-related issues: remove the visible Tenant ID field, add password visibility toggle, harden JWT parsing.

### Tasks

#### Task 17.1 — Remove Tenant ID input (GA-092)
This requires coordination with the backend team. Options:
- **Option A (Preferred):** Backend resolves tenant from subdomain (`tenant.erp.nexoraa.com`). Frontend reads `window.location.hostname` to determine tenant context. No ID field.
- **Option B (Interim):** Backend provides a `/api/v2/tenants/resolve?domain=...` endpoint. Frontend calls it on load.
- **Option C (Quickest, not ideal):** Hide the tenant ID field, hardcode `tenantId: 1` for now with a TODO comment.

Implement Option A if backend supports it; Option C as a temporary fix otherwise.

#### Task 17.2 — Password visibility toggle (GA-093)
In `LoginPage.tsx`, add `Eye` / `EyeOff` Lucide icon button as a suffix on the password input. Toggle `type` between `password` and `text`.

#### Task 17.3 — Harden JWT parsing (GA-094)
Replace manual `atob()` JWT decode with:
```bash
pnpm --filter web-frontend add jwt-decode
```
```ts
import { jwtDecode } from 'jwt-decode';
const payload = jwtDecode<TokenPayload>(token);
```
Or better: read roles/permissions from the `/me` API response (which should already return user data including roles).

### Files Modified
- `apps/web-frontend/src/pages/auth/LoginPage.tsx`
- `apps/web-frontend/src/store/auth.store.ts` (JWT parsing change)

### Breaking Change Risk
**High for 17.1** (tenant resolution is an auth flow change). **Low for 17.2 and 17.3.**

### Testing Checklist
- [ ] Login works with the new tenant resolution approach
- [ ] Password field shows dots by default
- [ ] Eye icon toggles password visibility
- [ ] JWT decode does not crash on malformed token (shows login error instead)
- [ ] User's role and permissions are correctly read after login
- [ ] Logout clears all auth state

### Estimated Effort: M (1 day)

---

## MILESTONE M-18 — Missing Routes (Delivery Challan, Detail Pages)

**Objective:** Build the three missing pages that have broken or stub routes.

### Pages to Build

#### Task 18.1 — DeliveryChallanFormPage (GA-121)
Create a full delivery challan creation form at `/sales/delivery-challans/new`:
- Invoice selector (`ERPAsyncSelect` searching by invoice number)
- Customer auto-populated from selected invoice
- Dispatch date, vehicle number, transporter name, notes
- Line items auto-populated from invoice, with editable quantity
- Submit → creates the challan, redirects to detail page

#### Task 18.2 — QuotationDetailPage (GA-007)
Create a quotation detail page at `/sales/quotations/:id`:
- Fetch quotation by ID
- Show status, dates, customer, line items, totals
- Actions: Convert to Invoice, Send to Customer (email), Cancel
- Until full functionality is built, a partial page is acceptable

#### Task 18.3 — StockTransferDetailPage (GA-008)
Create a stock transfer detail page at `/inventory/transfers/:id`:
- Fetch transfer by ID
- Show status (PENDING → DISPATCHED → RECEIVED)
- Show from/to warehouses, line items, notes
- Actions: Dispatch (if PENDING), mark Received (if DISPATCHED)
- Note: The existing `StockTransferReceivePage.tsx` may already cover the receive functionality

### Files Created
- `apps/web-frontend/src/pages/sales/DeliveryChallanFormPage.tsx`
- `apps/web-frontend/src/pages/sales/QuotationDetailPage.tsx`
- `apps/web-frontend/src/pages/inventory/StockTransferDetailPage.tsx`

### Files Modified
- `apps/web-frontend/src/App.tsx` (routes now render correct components)

### Breaking Change Risk
**None.** These routes were already broken (pointing to wrong pages). Any working page is an improvement.

### Testing Checklist
- [ ] `/sales/delivery-challans/new` renders the challan form (not the list)
- [ ] `/sales/quotations/123` renders the quotation detail (not the list)
- [ ] `/inventory/transfers/123` renders the transfer detail (not the list)
- [ ] Delivery challan form submits and creates a challan record
- [ ] Quotation detail shows correct data for the given ID
- [ ] Stock transfer detail shows correct status and line items

### Estimated Effort: L (1.5 days — 3 new pages)

---

## MILESTONE M-19 — Accessibility Pass

**Objective:** Apply WCAG 2.1 AA accessibility fixes across all components and pages.

### Tasks

#### Task 19.1 — Add `aria-label` to all icon-only buttons (GA-101)
Grep for `<button` and `<Button` with no visible text content. Add `aria-label` to each.

#### Task 19.2 — Fix label associations for all checkboxes (GA-102)
All `<input type="checkbox">` must have an associated `<label>` via `htmlFor` or by wrapping.

#### Task 19.3 — Add `scope="col"` to all table `<th>` headers (GA-103)
In `ERPDataGrid` and `ChartOfAccountsPage` tree table: `<th scope="col">`.

#### Task 19.4 — Add focus-visible ring to all interactive elements (GA-104)
Systematically review all interactive elements. Ensure `focus-visible:ring-2 focus-visible:ring-focus` (or equivalent) is applied.

#### Task 19.5 — Add document.title management (GA-105, GA-011)
Create `useDocumentTitle(title: string)` hook:
```ts
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | NEXORAA ERP` : 'NEXORAA ERP';
    return () => { document.title = 'NEXORAA ERP'; };
  }, [title]);
}
```
Add `useDocumentTitle('Page Name')` to every page component.

### Files Affected
All 51 page files (for title management), `ERPDataGrid`, `ChartOfAccountsPage`, all form pages with checkboxes.

### Breaking Change Risk
**None.** All additive changes.

### Testing Checklist
- [ ] Screen reader announces page title changes when navigating (test with NVDA or VoiceOver)
- [ ] All icon-only buttons have `aria-label`
- [ ] All checkboxes have associated labels
- [ ] Table column headers have `scope="col"`
- [ ] Focus ring visible on all interactive elements when tabbing through the app
- [ ] Modal has correct ARIA attributes (role, aria-modal, aria-labelledby)
- [ ] Color contrast ratios meet 4.5:1 minimum for text (use browser accessibility checker)

### Estimated Effort: M (1 day)

---

## MILESTONE M-20 — Performance Pass

**Objective:** Add virtual scrolling for large lists, convert customer select in InvoiceForm to async, and analyze bundle.

### Tasks

#### Task 20.1 — Install and configure TanStack Virtual (GA-106)
```bash
pnpm --filter web-frontend add @tanstack/react-virtual
```
Add virtual scrolling to `ERPDataGrid` as an optional mode: `virtualScroll?: boolean`. When enabled, only the visible rows (+ overscan) are in the DOM.

Enable for: StockLevelsPage (can have many items), ItemsPage.

#### Task 20.2 — Convert InvoiceForm customer to async (GA-107)
Already done in M-15. Verify in this milestone that the `ERPAsyncSelect` performs well (debounced, < 300ms response time with backend).

#### Task 20.3 — Bundle analysis
```bash
npx vite-bundle-analyzer
```
Target: Initial JS bundle < 200KB gzipped (after code splitting from M-09).
If any page chunk is unusually large, investigate and split further.

### Files Modified
- `apps/web-frontend/src/components/erp/ERPDataGrid.tsx` (virtualScroll option)

### Testing Checklist
- [ ] Large lists (1000+ items) scroll without jank
- [ ] Virtual scroll maintains correct scroll position when navigating away and back
- [ ] Bundle size report shows < 200KB initial chunk
- [ ] Each module page loads only its own chunk (verify in Network tab)

### Estimated Effort: L (1 day)

---

## MILESTONE M-21 — Tenant Theming & Logo System

**Objective:** Implement `TenantThemeProvider` that loads tenant branding at runtime.

### Tasks

#### Task 21.1 — Build TenantThemeProvider
Fetches `GET /api/v2/tenant/branding` on mount. Response:
```json
{ "primaryColor": "#4F46E5", "logoUrl": "...", "appName": "NEXORAA ERP" }
```
Injects CSS variable overrides via a `<style>` element:
```css
:root { --brand-primary: #4F46E5; }
```

#### Task 21.2 — Replace hardcoded logo letter in Layout.tsx (GA-111)
Use `tenantLogo` from `TenantThemeProvider`. Fallback to company initial.

#### Task 21.3 — Replace hardcoded "N" logo in LoginPage.tsx (GA-110)
Same as 21.2.

### Files Created
- `apps/web-frontend/src/context/TenantThemeContext.tsx`

### Files Modified
- `apps/web-frontend/src/components/Layout.tsx`
- `apps/web-frontend/src/pages/auth/LoginPage.tsx`
- `apps/web-frontend/src/main.tsx` (wrap in TenantThemeProvider)

### Testing Checklist
- [ ] App loads with default brand color when no tenant override exists
- [ ] Tenant-specific brand color overrides the default
- [ ] Tenant logo displays in sidebar and login page
- [ ] Logo falls back to initial letter if URL fails to load

### Estimated Effort: L (1 day)

---

## MILESTONE M-22 — Command Palette & Global Search

**Objective:** Implement Ctrl+K command palette with navigation shortcuts and recent pages.

### Tasks

#### Task 22.1 — Build useRecentPages hook
Track last 8 visited routes in Zustand + localStorage. Store `{ label: string; to: string; icon: LucideIcon }` per visit.

#### Task 22.2 — Build ERPCommandPalette component
- Triggered by Ctrl+K (or clicking the search input in the header)
- Full-screen overlay with a centered search input
- Results sections: Navigation (all pages), Recent (from useRecentPages), Quick Actions (New Invoice, New Customer, etc.)
- Arrow keys navigate results
- Enter navigates to the selected result
- Escape closes

#### Task 22.3 — Connect to Layout header search (GA-015)
Clicking the header search or pressing Ctrl+K anywhere in the app opens the palette.

### Files Created
- `apps/web-frontend/src/components/erp/ERPCommandPalette.tsx`
- `apps/web-frontend/src/hooks/useRecentPages.ts`

### Files Modified
- `apps/web-frontend/src/components/Layout.tsx`
- `apps/web-frontend/src/store/ui.store.ts` (add commandPaletteOpen flag)

### Breaking Change Risk
**Low.** Additive feature. Ctrl+K does nothing today.

### Testing Checklist
- [ ] Ctrl+K opens command palette from any page
- [ ] Typing filters results
- [ ] All navigation routes appear in search results
- [ ] Recent pages show up-to-date history
- [ ] Arrow keys navigate results
- [ ] Enter navigates to selected result
- [ ] Escape closes palette
- [ ] Clicking outside closes palette
- [ ] Focus returns to the trigger element after closing

### Estimated Effort: XL (2 days)

---

## MILESTONE M-23 — Final Verification Audit

**Objective:** Run a complete re-audit of the frontend against the design system to verify all milestones have been implemented correctly and no regressions introduced.

### Audit Checklist

**Architecture**
- [ ] `src/styles/tokens.css` exists with all tokens
- [ ] `@custom-variant dark (&:where(.dark, .dark *))` in index.css
- [ ] All 51 routes use `React.lazy()` and are wrapped in `<Suspense>` and `<ErrorBoundary>`
- [ ] No hardcoded `localhost:` URLs anywhere
- [ ] No hardcoded `branchId: 1` anywhere

**Icons**
- [ ] Zero emoji in any source file (grep: `[\u{1F300}-\u{1FFFF}]`)
- [ ] Zero text-character icons (grep: `[▼▶←→✕✓⟳⇤]`)
- [ ] All icons are from `lucide-react`

**Colors**
- [ ] Zero instances of `indigo-` in page files
- [ ] Zero instances of `gray-750` anywhere
- [ ] Zero hardcoded green/red/amber color classes for semantic states
- [ ] All card backgrounds use `bg-surface-card` or similar token class

**Components**
- [ ] Zero usages of deprecated `<DataTable>` on any list page
- [ ] Zero usages of deprecated `Badge color="..."` prop
- [ ] All modals have ARIA attributes and focus trap
- [ ] All form pages have sticky footer

**Navigation**
- [ ] Breadcrumb visible on every page
- [ ] Sidebar has module group headers
- [ ] Sidebar icon-only tooltips work in collapsed mode
- [ ] Ctrl+K opens command palette

**Forms**
- [ ] No raw `<input>`, `<select>`, `<textarea>` in page files (only in component library)
- [ ] All forms use React Hook Form + Zod
- [ ] All forms show field-level validation errors

**Accessibility**
- [ ] All icon-only buttons have `aria-label`
- [ ] Document title updates on every page navigation
- [ ] Focus ring visible on all interactive elements in keyboard navigation mode

**Performance**
- [ ] Initial JS chunk < 200KB gzipped
- [ ] No API calls that fetch unlimited data (all paginated or async-select)

### Deliverable
After this audit, update `FRONTEND_GAP_ANALYSIS.md` with a "Verified" column for each issue, and update `project_phase_status.md` memory file to mark the frontend refactor as complete.

### Estimated Effort: M (1 day for full sweep)

---

## PHASE GATE — Before Starting Phase 5 (Purchase Module)

All of the following milestones must be COMPLETE before Phase 5 Purchase Module frontend can begin:

| Milestone | Status | Required? |
|-----------|--------|-----------|
| M-01 (Critical Bug Fixes) | Pending | YES — data corruption |
| M-02 (Design Tokens) | Pending | YES — foundation |
| M-03 (Icon Migration) | Pending | YES — standard enforced |
| M-04 (Theme Consolidation) | Pending | YES — dark mode correct |
| M-05 (Core Components Part 1) | Pending | YES — Modal must be accessible |
| M-06 (ERPDataGrid System) | Pending | YES — all new lists use it |
| M-07 (Layout Shell) | Pending | YES — Purchase module navigation |
| M-08 (Page Header) | Pending | YES — Purchase module pages need it |
| M-09 (Route Architecture) | Pending | YES — code splitting |
| M-10 (Utility Library) | Pending | YES — date/currency shared |
| M-11 (Form Components) | Pending | YES — Purchase Order form needs them |
| M-12 (Color Migration) | Pending | YES — no new pages should use hardcoded colors |

M-13 through M-23 may run in parallel with Phase 5 development if they don't conflict with purchase module files.

---

## TOTAL EFFORT ESTIMATE

| Milestone | Effort |
|-----------|--------|
| M-01 | XS (2–3 hrs) |
| M-02 | S (4–6 hrs) |
| M-03 | M (1 day) |
| M-04 | S (3 hrs) |
| M-05 | L (2 days) |
| M-06 | XL (3–4 days) |
| M-07 | L (1.5 days) |
| M-08 | M (1 day) |
| M-09 | L (1.5 days) |
| M-10 | S (1 day) |
| M-11 | L (2 days) |
| M-12 | M (1 day) |
| M-13 | L (2 days) |
| M-14 | L (1.5 days) |
| M-15 | XL (3 days) |
| M-16 | L (1 day) |
| M-17 | M (1 day) |
| M-18 | L (1.5 days) |
| M-19 | M (1 day) |
| M-20 | L (1 day) |
| M-21 | L (1 day) |
| M-22 | XL (2 days) |
| M-23 | M (1 day) |
| **Total (Phase Gate: M-01–M-12)** | **~19 days** |
| **Total (All 23 milestones)** | **~37 days** |

---

*This plan was generated by a complete code audit of 51 `.tsx` files. Every milestone references specific GA-XXX issue IDs from `FRONTEND_GAP_ANALYSIS.md`. No code has been changed. Awaiting approval to begin implementation.*
