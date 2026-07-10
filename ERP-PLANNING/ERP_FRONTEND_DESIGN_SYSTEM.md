# NEXORAA ERP — Frontend Design System
## The Mandatory Standard for Every Screen, Every Component, Every Module

**Version:** 1.0  
**Status:** ENFORCED — All existing and future code MUST conform  
**Scope:** `apps/web-frontend`, `apps/pos-frontend`, all future frontend apps  
**Stack:** React 19, TypeScript 5 strict, Tailwind CSS v4, TanStack Query v5, React Router v7, Zustand

---

## PREAMBLE

This document defines every visual, structural, behavioral, and architectural decision for the NEXORAA ERP frontend. It is not a style guide suggestion. It is the law. Any screen that does not conform is a bug. Any PR that introduces deviation fails review.

The ERP will eventually have 250+ modules, thousands of screens, and be used daily by accountants, cashiers, warehouse operators, branch managers, auditors, owners, and administrators across multiple tenants, branches, and roles. This scale demands absolute consistency. A user who learns Invoice Entry must instantly understand Purchase Order Entry, HR Payroll, and Fixed Asset Registration — because every screen follows the same laws.

We compete with SAP Business One, Oracle NetSuite, Microsoft Dynamics 365, Odoo Enterprise, ERPNext, Zoho One, and Tally Prime Enterprise. They have invested decades into UI consistency. We must match that standard from day one.

---

## PART 1 — DESIGN PHILOSOPHY

### 1.1 Core Tenets

**Enterprise First.**  
Every design decision optimizes for professionals who use this system 8 hours a day, 250 days a year. Not for first-time visitors. Not for marketing impressions. Every pixel must earn its place by helping a power user be faster, more accurate, or less fatigued.

**Speed First.**  
Perceived performance is a feature. The UI must feel instant. Skeleton loaders instead of spinners. Optimistic updates for common operations. Virtualized lists for large datasets. No screen should require a user to wait more than 200ms to interact.

**Keyboard First.**  
Every action must be reachable without a mouse. Tab order must be intentional. Every modal must trap focus. Every list must support arrow navigation. Every form must submit on Enter. Every common operation must have a keyboard shortcut. The command palette (Ctrl+K / Cmd+K) must reach any page or action in ≤ 3 keystrokes.

**Power User Friendly.**  
Users will eventually memorize layouts, shortcuts, and workflows. Design for the expert, not the novice. Once a user knows the system, nothing should stand in their way. No confirmation dialogs for non-destructive actions. No unnecessary steps. No re-entering data that the system already knows.

**Consistency Over Creativity.**  
Every module must feel like it was built by the same person on the same day. When a developer wants to "improve" a pattern they see elsewhere, they must instead update this standard so the improvement applies everywhere. Local creativity is forbidden. System-wide improvement is always welcome.

**Maximum Data Density.**  
Enterprise users process enormous amounts of information. Use compact table rows. Use 12-column grids. Use sidebar panels instead of full-page modals for quick details. Every screen must show as much relevant data as fits without scrolling — and handle overflow gracefully.

**Minimal Clicks.**  
The 3-click rule: any action must be reachable from any screen in ≤ 3 clicks. Navigation to any module in 1 click via sidebar. Record creation in 1 click via page header. Record action (approve, print, duplicate) in 1 click via row action.

**Zero Learning Curve (Within the System).**  
Once a user knows one module, they know all modules. Breadcrumbs always show where you are. Page headers always look the same. Tables always behave the same. Filters always work the same. Actions are always in the same position.

**Permission-Driven Rendering.**  
Never show a user something they cannot use. Buttons for forbidden actions must not render — not be disabled, not be grayed out — unless the UX specifically benefits from showing the user what they lack access to (rare). The UI adapts to the user's role automatically.

**Accessibility Without Compromise.**  
WCAG 2.1 AA minimum. WCAG 2.1 AAA for critical flows (login, payment, approval). Every interactive element is keyboard accessible. Every image has alt text. Every form field has a label. Color is never the only carrier of meaning.

**No Decorative Components.**  
No animations for their own sake. No gradient backgrounds. No drop shadows on every element. No cards with colored side borders "just to look nice." Visual weight must always carry semantic meaning. A red border means error. A green badge means active. A yellow warning icon means action required.

**Mobile Secondary.**  
The ERP is primarily a desktop application. However, managers and owners need mobile-accessible dashboards and approval workflows. Use responsive breakpoints, but never sacrifice desktop density to achieve mobile elegance.

### 1.2 What This Is NOT

- Not a consumer app
- Not a marketing website
- Not a portfolio project
- Not a landing page
- Not a place to showcase animation capabilities
- Not a place to experiment with new color combinations
- Not a place to "make it look fresh" every six months

---

## PART 2 — DESIGN TOKENS

### 2.1 The Token System

All visual values — colors, spacing, typography, shadows, radii — must come from CSS custom properties defined in `src/styles/tokens.css`. **No hardcoded colors anywhere in the codebase.** Searching for `#`, `rgb(`, `rgba(`, `hsl(`, `indigo-`, `blue-`, `red-600` in component files must return zero matches (only token definitions are exempt).

```css
/* src/styles/tokens.css */
:root {
  /* ─── Brand ─────────────────────────────────────────── */
  --brand-primary:          220 98% 48%;   /* HSL — Indigo */
  --brand-primary-hover:    220 98% 42%;
  --brand-primary-light:    220 98% 96%;
  --brand-secondary:        261 80% 52%;
  --brand-accent:           35 100% 50%;

  /* ─── Semantic Status ───────────────────────────────── */
  --color-success:          142 72% 36%;
  --color-success-light:    142 72% 95%;
  --color-warning:          38 95% 48%;
  --color-warning-light:    38 95% 95%;
  --color-danger:           0 84% 50%;
  --color-danger-light:     0 84% 96%;
  --color-info:             204 86% 45%;
  --color-info-light:       204 86% 95%;

  /* ─── Surface ───────────────────────────────────────── */
  --surface-base:           0 0% 100%;
  --surface-subtle:         220 14% 97%;
  --surface-raised:         0 0% 100%;
  --surface-overlay:        0 0% 100%;
  --surface-sidebar:        224 20% 17%;
  --surface-header:         0 0% 100%;

  /* ─── Text ──────────────────────────────────────────── */
  --text-primary:           220 25% 10%;
  --text-secondary:         220 10% 40%;
  --text-tertiary:          220 10% 60%;
  --text-disabled:          220 10% 75%;
  --text-on-primary:        0 0% 100%;
  --text-link:              var(--brand-primary);

  /* ─── Border ────────────────────────────────────────── */
  --border-default:         220 13% 91%;
  --border-strong:          220 13% 82%;
  --border-focus:           var(--brand-primary);
  --border-error:           var(--color-danger);

  /* ─── Spacing scale (px values expressed as rem) ────── */
  --space-1:  0.25rem;
  --space-2:  0.5rem;
  --space-3:  0.75rem;
  --space-4:  1rem;
  --space-5:  1.25rem;
  --space-6:  1.5rem;
  --space-8:  2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* ─── Radius ────────────────────────────────────────── */
  --radius-sm:   0.25rem;
  --radius-md:   0.5rem;
  --radius-lg:   0.75rem;
  --radius-xl:   1rem;
  --radius-full: 9999px;

  /* ─── Shadow ────────────────────────────────────────── */
  --shadow-sm:  0 1px 2px 0 hsl(220 13% 10% / 0.05);
  --shadow-md:  0 4px 6px -1px hsl(220 13% 10% / 0.07), 0 2px 4px -1px hsl(220 13% 10% / 0.05);
  --shadow-lg:  0 10px 15px -3px hsl(220 13% 10% / 0.08), 0 4px 6px -2px hsl(220 13% 10% / 0.04);
  --shadow-xl:  0 20px 25px -5px hsl(220 13% 10% / 0.10), 0 10px 10px -5px hsl(220 13% 10% / 0.04);

  /* ─── Z-index scale ─────────────────────────────────── */
  --z-sidebar:     100;
  --z-header:      200;
  --z-dropdown:    300;
  --z-modal:       400;
  --z-toast:       500;
  --z-tooltip:     600;
  --z-command:     700;
}

.dark {
  --surface-base:           224 20% 12%;
  --surface-subtle:         224 20% 10%;
  --surface-raised:         224 20% 15%;
  --surface-overlay:        224 20% 18%;
  --surface-sidebar:        224 20% 9%;
  --surface-header:         224 20% 13%;

  --text-primary:           220 14% 96%;
  --text-secondary:         220 10% 68%;
  --text-tertiary:          220 10% 50%;
  --text-disabled:          220 10% 35%;

  --border-default:         224 20% 22%;
  --border-strong:          224 20% 30%;
}
```

### 2.2 Tenant Theme Overrides

Every tenant can override brand tokens at runtime via a `TenantThemeProvider` that injects a `<style>` tag with CSS variable overrides. The base token file must never be modified per tenant. Only `--brand-*` tokens and `--surface-sidebar` are tenant-overridable. All other tokens derive from the brand tokens automatically.

```typescript
// packages/shared-ui/src/providers/TenantThemeProvider.tsx
interface TenantTheme {
  primaryHsl: string;     // e.g. "220 98% 48%"
  sidebarHsl: string;     // e.g. "224 20% 17%"
  logoUrl: string;
  faviconUrl: string;
}
```

---

## PART 3 — TYPOGRAPHY STANDARD

### 3.1 Font Stack

```css
/* Primary — UI Chrome, labels, buttons, navigation */
--font-sans: 'Inter', 'system-ui', '-apple-system', 'sans-serif';

/* Monospace — Codes, IDs, amounts, barcodes, JSON fields */
--font-mono: 'JetBrains Mono', 'Fira Code', 'monospace';
```

**Inter must be loaded via `@fontsource/inter`** (self-hosted, no Google Fonts CDN dependency).

### 3.2 Type Scale

| Token Name         | Size    | Weight | Line Height | Usage |
|--------------------|---------|--------|-------------|-------|
| `--text-xs`        | 11px    | 500    | 1.4         | Table column headers, helper text, timestamps |
| `--text-sm`        | 12px    | 400    | 1.5         | Table cell values, form hints, badges |
| `--text-base`      | 13px    | 400    | 1.6         | Body text, descriptions, sidebar items |
| `--text-md`        | 14px    | 500    | 1.5         | Form labels, button text, tab labels |
| `--text-lg`        | 16px    | 600    | 1.4         | Section headings, card titles |
| `--text-xl`        | 18px    | 600    | 1.3         | Page titles |
| `--text-2xl`       | 22px    | 700    | 1.2         | Dashboard KPI numbers |
| `--text-3xl`       | 28px    | 700    | 1.2         | Login page headings |

**Note:** 13px is the default body text for an enterprise ERP (not 16px as in consumer apps). This maximizes data density without sacrificing readability on modern high-DPI displays.

### 3.3 Number and Currency Formatting

- All currency values use monospace font, right-aligned
- INR format: `₹1,23,456.00` (Indian lakh system)
- Negative amounts shown in red: `-₹1,234.00`
- Zero shown in gray: `₹0.00`
- Percentage: `18.00%`, right-aligned
- Quantity: locale-aware, decimal varies by unit
- Dates: `DD MMM YYYY` for display (e.g., `29 Jun 2026`), ISO for storage
- Timestamps: `29 Jun 2026, 14:32` for display

---

## PART 4 — ICON STANDARD

### 4.1 Icon Library

**Mandatory:** `lucide-react` (v0.400+). This is the ONLY icon library used in the project.  
**Forbidden:** Emoji as icons (current violation), FontAwesome, Material Icons, HeroIcons, custom SVGs unless they have no Lucide equivalent.

```typescript
// Correct
import { Package, ChevronRight, AlertTriangle } from 'lucide-react';

// Forbidden
<span>📦</span>
<i className="fa fa-box" />
```

### 4.2 Icon Sizes

| Context | Size | Class |
|---------|------|-------|
| Inline text icon | 14px | `size-3.5` |
| Button icon | 16px | `size-4` |
| Sidebar nav icon | 18px | `size-4.5` |
| Table row action | 16px | `size-4` |
| Page header action | 16px | `size-4` |
| Status icon | 14px | `size-3.5` |
| Empty state illustration | 48px | `size-12` |
| Dashboard KPI icon | 24px | `size-6` |

### 4.3 Icon Usage Rules

1. Every icon button MUST have a `title` attribute or an accompanying visible label
2. Icons in tables communicate status — never decorate
3. Icon color must use semantic tokens, not arbitrary colors
4. The same concept always uses the same icon across all modules (see mapping below)

### 4.4 Semantic Icon Mapping

| Concept | Lucide Icon |
|---------|-------------|
| Add / Create | `Plus` |
| Edit | `Pencil` |
| Delete | `Trash2` |
| View / Open | `Eye` |
| Save | `Save` |
| Cancel | `X` |
| Close modal | `X` |
| Search | `Search` |
| Filter | `SlidersHorizontal` |
| Export | `Download` |
| Import | `Upload` |
| Print | `Printer` |
| Share | `Share2` |
| Duplicate | `Copy` |
| Refresh | `RefreshCw` |
| Approve | `CheckCircle2` |
| Reject | `XCircle` |
| Warning | `AlertTriangle` |
| Info | `Info` |
| Success | `CheckCircle2` |
| Error | `AlertCircle` |
| Dashboard | `LayoutDashboard` |
| Settings | `Settings` |
| Users | `Users` |
| Customer | `UserCheck` |
| Supplier | `Truck` |
| Inventory | `Package` |
| Sales | `ShoppingCart` |
| Purchase | `ShoppingBag` |
| Accounting | `BookOpen` |
| GST | `Receipt` |
| Reports | `BarChart2` |
| Collapse sidebar | `PanelLeftClose` |
| Expand sidebar | `PanelLeftOpen` |
| Chevron right | `ChevronRight` |
| Chevron down | `ChevronDown` |
| Sort ascending | `ArrowUp` |
| Sort descending | `ArrowDown` |
| Unsorted | `ArrowUpDown` |
| Calendar | `Calendar` |
| Clock | `Clock` |
| Lock | `Lock` |
| Unlock | `Unlock` |
| Branch | `Building2` |
| Warehouse | `Warehouse` |
| Barcode | `Barcode` |
| QR Code | `QrCode` |
| More actions | `MoreHorizontal` |
| Expand row | `ChevronRight` |
| Command palette | `Command` |
| Notifications | `Bell` |
| Help | `HelpCircle` |
| Logout | `LogOut` |
| Dark mode | `Moon` |
| Light mode | `Sun` |
| Favorite | `Star` |
| Pin | `Pin` |
| History | `History` |
| Audit | `FileSearch` |
| Attachment | `Paperclip` |
| Email | `Mail` |
| Phone | `Phone` |
| Address | `MapPin` |
| GST Rate | `Percent` |
| Amount | `IndianRupee` |
| Stock In | `PackagePlus` |
| Stock Out | `PackageMinus` |
| Transfer | `ArrowLeftRight` |

---

## PART 5 — COLOR STANDARD

### 5.1 Rules

1. **No hardcoded color classes** — use semantic utility classes that map to CSS variables
2. **Color carries meaning** — never use red/green/yellow for decoration only
3. **All status colors are tokens** — never reach for `text-green-600` directly
4. **Contrast ratios enforced** — 4.5:1 for normal text, 3:1 for large text (WCAG AA)

### 5.2 Semantic Color Usage

| Usage | Light Token | Dark Token | Tailwind Pattern |
|-------|-------------|------------|-----------------|
| Page background | `--surface-base` | same | `bg-surface` |
| Sidebar background | `--surface-sidebar` | same | `bg-sidebar` |
| Card / Table background | `--surface-raised` | same | `bg-surface-raised` |
| Input background | `--surface-base` | `--surface-raised` | `bg-input` |
| Primary action | `--brand-primary` | same | `bg-primary` |
| Primary hover | `--brand-primary-hover` | same | `hover:bg-primary-hover` |
| Body text | `--text-primary` | same | `text-primary` |
| Muted text | `--text-secondary` | same | `text-secondary` |
| Disabled text | `--text-disabled` | same | `text-disabled` |
| Default border | `--border-default` | same | `border-default` |
| Focus ring | `--border-focus` | same | `ring-focus` |

### 5.3 Status Color Map

| Status | Background | Text | Border | Dot |
|--------|------------|------|--------|-----|
| Active / Success | `--color-success-light` | `--color-success` | `--color-success` | green |
| Draft | `--surface-subtle` | `--text-secondary` | `--border-default` | gray |
| Pending | `--color-warning-light` | `--color-warning` | `--color-warning` | amber |
| In Review | `--color-info-light` | `--color-info` | `--color-info` | blue |
| Approved | `--color-success-light` | `--color-success` | `--color-success` | green |
| Rejected | `--color-danger-light` | `--color-danger` | `--color-danger` | red |
| Cancelled | `--surface-subtle` | `--text-tertiary` | `--border-default` | gray |
| Confirmed | `--color-info-light` | `--color-info` | `--color-info` | blue |
| Completed | `--color-success-light` | `--color-success` | `--color-success` | green |
| Archived | `--surface-subtle` | `--text-disabled` | `--border-default` | gray |
| Overdue | `--color-danger-light` | `--color-danger` | `--color-danger` | red |
| Due Soon | `--color-warning-light` | `--color-warning` | `--color-warning` | amber |

---

## PART 6 — LAYOUT STANDARD

### 6.1 Shell Layout

Every authenticated page uses an identical outer shell. There are no exceptions.

```
┌────────────────────────────────────────────────────────────────────┐
│  SIDEBAR (240px expanded / 60px collapsed)                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Logo area (64px height)                                     │  │
│  │  ─────────────────────────────────────────────────────────   │  │
│  │  Module search / Command palette trigger                     │  │
│  │  ─────────────────────────────────────────────────────────   │  │
│  │  Navigation groups (scrollable)                              │  │
│  │  ─────────────────────────────────────────────────────────   │  │
│  │  User profile + settings (pinned bottom)                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  MAIN AREA (flex-1)                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  TOP HEADER (56px height, sticky)                            │  │
│  │  Breadcrumb (left) | Search + Actions (right)                │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  PAGE CONTENT (scrollable)                                   │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  PAGE HEADER                                           │  │  │
│  │  │  Title + Subtitle + Status + Page Actions              │  │  │
│  │  ├────────────────────────────────────────────────────────┤  │  │
│  │  │  SUMMARY CARDS ROW (optional)                          │  │  │
│  │  ├────────────────────────────────────────────────────────┤  │  │
│  │  │  FILTER BAR / TOOLBAR                                  │  │  │
│  │  ├────────────────────────────────────────────────────────┤  │  │
│  │  │  DATA GRID / TABLE / CONTENT                           │  │  │
│  │  ├────────────────────────────────────────────────────────┤  │  │
│  │  │  PAGINATION                                            │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### 6.2 Page Content Regions

Every list/index page follows this exact vertical order:

1. **Page Header** — Always present. Contains title, subtitle, status, page actions (Add, Import, Export, Print)
2. **Summary Cards** — Present only when meaningful KPIs exist (total records, total amount, pending count)
3. **Filter / Toolbar** — Always present when a table exists. Contains search, quick filters, date range, view toggle
4. **Data Grid / Table** — The main content
5. **Pagination** — Immediately below the table, never floating

Every form/detail page follows this exact vertical order:

1. **Page Header** — Title, entity ID, status badge, workflow status, action buttons (Save, Cancel, Delete, Approve)
2. **Form Sections** — Logically grouped in cards
3. **Related Tabs** — Sub-tables, history, activity log, attachments
4. **Sticky Footer** — Save / Cancel buttons (appear on scroll when header buttons scroll away)

### 6.3 Spacing Tokens

| Area | Value | Token |
|------|-------|-------|
| Page padding (horizontal) | 24px | `px-6` |
| Page padding (vertical) | 24px | `py-6` |
| Section gap | 24px | `gap-6` |
| Card internal padding | 20px | `p-5` |
| Form field gap | 16px | `gap-4` |
| Table cell padding H | 16px | `px-4` |
| Table cell padding V | 10px | `py-2.5` |
| Summary card gap | 16px | `gap-4` |

---

## PART 7 — SIDEBAR NAVIGATION STANDARD

### 7.1 Structure

```
Sidebar
├── Logo Area (64px, fixed)
│   ├── Tenant Logo
│   ├── ERP Name (when expanded)
│   └── Collapse toggle button
├── Quick Search (Ctrl+K trigger, fixed)
├── Navigation (scrollable flex-1)
│   ├── Group Header (e.g., "OPERATIONS")
│   ├── NavItem (leaf — no children)
│   └── NavGroup (has children)
│       ├── Group trigger button
│       └── Children list (animated expand/collapse)
├── Recent Pages (collapsible section, bottom of scroll)
└── User Area (fixed bottom)
    ├── Avatar + Name + Role
    ├── Branch selector
    ├── Settings link
    └── Logout button
```

### 7.2 Sidebar Dimensions

| State | Width | Transition |
|-------|-------|-----------|
| Expanded | 240px | 200ms ease |
| Collapsed | 60px | 200ms ease |
| Mobile (overlay) | 240px | slide from left |

### 7.3 NavGroup State

- Collapsed sidebar: shows only icon with tooltip on hover
- Expanded sidebar: shows icon + label + chevron
- Active child: parent group auto-opens and stays open
- Hover state: `bg-white/8` on sidebar dark background
- Active leaf: `bg-brand-primary` text + background highlight
- Group header label: `text-xs uppercase tracking-widest text-sidebar-text-muted` — never interactive

### 7.4 Navigation Module Groups

```
WORKSPACE
  Dashboard

SALES & CRM
  Customers
  Sales Orders
  Invoices
  Quotations
  Payments Received
  Sale Returns
  Delivery Challans
  POS

PURCHASE
  Suppliers
  Purchase Orders
  Purchase Bills
  Payments Made
  Purchase Returns
  Goods Receipt Notes

INVENTORY
  Items
  Stock Levels
  Warehouses
  Stock Transfers
  Stock Adjustments
  Physical Verification
  Fabric Rolls
  Price Lists

ACCOUNTING
  Chart of Accounts
  Journal Entries
  Bank Reconciliation
  Opening Balances

TAXATION
  GST Configuration
  GST Returns
  HSN Master
  E-Way Bills

PAYROLL / HR
  Employees
  Attendance
  Payroll Runs
  Leave Management

REPORTS
  Sales Reports
  Purchase Reports
  Inventory Reports
  Financial Reports
  GST Reports
  Custom Reports

ADMINISTRATION
  Organization
  Branches
  Users & Roles
  Permissions
  Audit Log
  System Settings
  Import / Export
```

### 7.5 Keyboard Shortcuts for Navigation

| Key | Action |
|-----|--------|
| `Ctrl+K` / `Cmd+K` | Open command palette |
| `Ctrl+B` / `Cmd+B` | Toggle sidebar |
| `Alt+1` through `Alt+9` | Jump to pinned module (positions 1–9) |
| `Escape` | Close any open panel / return to previous |
| `?` | Open keyboard shortcuts reference |

---

## PART 8 — TOP HEADER STANDARD

### 8.1 Header Anatomy (56px height, sticky, z-200)

```
LEFT                                          RIGHT
[Breadcrumb]                [GlobalSearch] [QuickCreate] [Notifications] [HelpMenu] [ThemeToggle]
```

### 8.2 Global Search

- Shortcut: `/` (focused anywhere) or `Ctrl+K`
- Shows results in a modal overlay with sections: Pages, Records, Actions, Recent
- Fuzzy match with highlight
- Shows result type icon + label + module breadcrumb

### 8.3 Quick Create Button

- `+` icon button with dropdown listing creatable entities
- Items sorted by frequency of use
- Always visible, never permission-gated (the list adapts to permissions)

### 8.4 Notifications

- Bell icon with unread count badge
- Panel slides in from right on click
- Grouped by: Pending Approvals, Alerts, Info
- Shows timestamp, actor, and deep link to relevant record

---

## PART 9 — BREADCRUMB STANDARD

### 9.1 Rules

1. Breadcrumbs appear in the top header bar, left side
2. Every page has a breadcrumb — no exceptions
3. Maximum 4 segments before overflow truncation
4. Never show "Home" as a crumb — home is the logo
5. Last segment is not a link (current page) — use `text-primary font-medium`
6. Separators use `ChevronRight` (Lucide, 14px) with `text-tertiary`
7. Clicking any ancestor crumb navigates to that page (not back-history)
8. On mobile (< 768px), show only last 2 crumbs

### 9.2 Structure

```
Dashboard  ›  Sales  ›  Invoices  ›  INV-2026-0047
 ↑link           ↑link    ↑link         ↑current page (no link)
```

### 9.3 Breadcrumb Examples

| Page | Breadcrumb |
|------|-----------|
| All Customers | `Sales › Customers` |
| Customer Detail | `Sales › Customers › Ramesh Textiles` |
| New Customer | `Sales › Customers › New Customer` |
| Invoice Detail | `Sales › Invoices › INV-2026-0047` |
| Edit Invoice | `Sales › Invoices › INV-2026-0047 › Edit` |
| Settings | `Administration › Settings` |
| New User | `Administration › Users › New User` |
| Physical Verification | `Inventory › Physical Verifications › PV-2026-0012` |

### 9.4 Implementation

```typescript
// packages/shared-ui/src/components/ERPBreadcrumb.tsx
interface BreadcrumbItem {
  label: string;
  href?: string;   // undefined = current page (not a link)
}
```

---

## PART 10 — PAGE HEADER STANDARD

### 10.1 List Page Header

```
┌─────────────────────────────────────────────────────────────────┐
│  [Icon] Page Title                    [Export] [Import] [+ Add] │
│  Optional subtitle / description                                │
└─────────────────────────────────────────────────────────────────┘
```

Rules:
- Title: `text-xl font-semibold text-primary` — 18px
- Subtitle: `text-sm text-secondary` — optional, max 1 line
- Title icon: 22px Lucide icon, matches sidebar module icon
- Action buttons: right-aligned, ordered: secondary actions left → primary action rightmost
- Primary action (`+ New Invoice`) always uses `variant="primary"` button
- All secondary actions use `variant="outline"` or `variant="ghost"`
- Export, Import, Print, Refresh are secondary (ghost/outline)
- "New" / "Add" / "Create" is always primary

### 10.2 Detail / Form Page Header

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back    INV-2026-0047              [CONFIRMED] badge         │
│  Invoice · Ramesh Textiles · ₹59,000  [Edit] [Print] [Actions▼]│
│  Created 29 Jun 2026 by Suresh D.     Last modified 2 hrs ago   │
└─────────────────────────────────────────────────────────────────┘
```

Rules:
- Back arrow (`ArrowLeft`, 18px) always present on detail pages
- Entity number in `font-mono font-semibold` 
- Status badge immediately follows title (same line)
- Summary line (customer name, total amount) in `text-sm text-secondary`
- Created / Modified metadata in `text-xs text-tertiary`
- Actions: Edit (when editable), Print, and "More Actions" dropdown for secondary actions
- Destructive actions (Delete, Cancel) live ONLY inside the "More Actions" dropdown, never as top-level buttons
- Workflow actions (Approve, Reject, Submit) shown as prominent buttons ONLY when the current user can take that action

### 10.3 Forbidden Pattern

```
// FORBIDDEN — inconsistent header patterns:
<h1>Customers</h1>
<button onClick={...}>+ New</button>   // raw elements

// CORRECT — always use ERPPageHeader
<ERPPageHeader
  title="Customers"
  icon={UserCheck}
  subtitle="Manage your customer master data"
  actions={[
    { label: 'Export', icon: Download, variant: 'outline', onClick: handleExport },
    { label: 'Import', icon: Upload, variant: 'outline', onClick: handleImport },
    { label: 'New Customer', icon: Plus, variant: 'primary', href: '/customers/new' },
  ]}
/>
```

---

## PART 11 — SUMMARY CARDS (KPI ROW) STANDARD

### 11.1 When to Use

Use summary cards when the list page has meaningful aggregate information:
- Total record count
- Total monetary value
- Pending approvals count
- Status breakdown

Never add cards just to fill space or for decoration.

### 11.2 Card Design

```
┌─────────────────────────┐
│  IndianRupee icon (24px)│
│  ₹12,34,567.00          │  ← text-2xl font-bold font-mono
│  Total Invoice Value    │  ← text-sm text-secondary
│  ↑ 12% vs last month    │  ← text-xs text-success (optional trend)
└─────────────────────────┘
```

Rules:
- Minimum 3, maximum 6 cards per row
- Equal width (`flex-1` in a flex row)
- Background: `bg-surface-raised border border-default rounded-lg p-5`
- Icon: 24px, colored with semantic token matching the card's topic
- Value: bold monospace for numbers, bold sans-serif for counts
- Label: `text-sm text-secondary`
- Trend (optional): green arrow + percentage for positive, red for negative
- Cards are NOT clickable by default — if clickable, show cursor-pointer and hover state

---

## PART 12 — FILTER / TOOLBAR STANDARD

### 12.1 Toolbar Anatomy

```
[🔍 Search...] [Status ▼] [Date Range] [Branch ▼]    [Density] [Columns] [Saved Views ▼]
```

### 12.2 Search Input

- Always leftmost in toolbar
- Placeholder: `Search {entity name}...`
- Debounce: 300ms
- Minimum 3 characters before API call
- Clears with ×
- Width: 280px (desktop), full width on mobile

### 12.3 Filter Chips

Active filters appear as chips below the toolbar:

```
[Status: Active ×] [Branch: Mumbai ×] [Date: Jun 2026 ×]   [Clear All]
```

Rules:
- Each active filter renders as a chip with label + × remove button
- "Clear All" appears when 2+ filters are active
- Removing a filter chip triggers immediate refetch

### 12.4 Quick Filters

Common filters appear as pills directly in the toolbar (not in a dropdown). They apply on click (toggle). Maximum 5 quick filters. Examples: `All | Active | Inactive | Draft | Pending`.

### 12.5 Advanced Filter Drawer

A `SlidersHorizontal` button opens a right-side drawer with:
- Every filterable field
- Multi-select options
- Date range pickers
- Range sliders for numeric fields
- Apply button and Reset button
- Save as named filter option
- Load saved filter option

### 12.6 Date Presets

Date pickers in filters always show presets:
- Today
- Yesterday
- This Week
- Last Week
- This Month
- Last Month
- This Quarter
- Last Quarter
- This Financial Year
- Last Financial Year
- Custom Range

### 12.7 Column Chooser

A columns button opens a popover listing all columns. User can:
- Show/hide columns (checkbox)
- Reorder columns (drag handles)
- Reset to defaults
- Per-user preferences saved to localStorage and API

### 12.8 Density Toggle

Three density modes (default: Comfortable):

| Mode | Row height | Padding |
|------|-----------|---------|
| Compact | 36px | `py-1.5` |
| Comfortable | 44px | `py-2.5` |
| Spacious | 56px | `py-4` |

---

## PART 13 — DATA GRID / TABLE STANDARD

### 13.1 Table Anatomy

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☐ │ Invoice No    │ Customer     │ Date       │ Amount  │ Status │ Actions │
│───│───────────────│──────────────│────────────│─────────│────────│─────────│
│ ☐ │ INV-2026-0047 │ Ramesh Tex.. │ 29 Jun 26  │ ₹59,000 │ [CONF] │  ···    │
│ ☐ │ INV-2026-0046 │ Sharma Silk  │ 28 Jun 26  │ ₹12,500 │ [DRAFT]│  ···    │
│   │               │              │            │         │        │         │
│───│───────────────│──────────────│────────────│─────────│────────│─────────│
│ Total             │              │            │ ₹71,500 │        │         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 13.2 Column Rules

| Column Type | Alignment | Font | Width |
|-------------|-----------|------|-------|
| Serial no / ID | Left | Mono | 80px fixed |
| Entity name | Left | Sans | flexible |
| Date | Left | Sans | 120px |
| Currency amount | Right | Mono | 120px fixed |
| Percentage | Right | Mono | 80px |
| Status badge | Center | Sans | 120px fixed |
| Actions | Center | — | 80px fixed |
| Checkbox | Center | — | 44px fixed |
| Short code | Left | Mono | 100px |
| Phone / GSTIN | Left | Mono | 150px |

### 13.3 Column Header Rules

- `text-xs font-semibold uppercase tracking-wide text-secondary`
- Sortable columns show `ArrowUpDown` icon on hover, `ArrowUp`/`ArrowDown` when sorted
- Click header to sort ascending; click again to sort descending; click again to reset
- Current sort column has a subtle background highlight
- Non-sortable columns: no icon, no hover state

### 13.4 Sticky Elements

- Checkbox column: sticky left
- Actions column: sticky right (always visible)
- Table header: sticky top within the table scroll area
- Footer totals row: sticky bottom when table is in a constrained height container

### 13.5 Row Actions

Each row has an `···` (`MoreHorizontal`) button in the sticky right column. Clicking opens a dropdown:

```
───────────────
  View          (always first)
  Edit
─ ─ ─ ─ ─ ─
  Print
  Duplicate
  Export Row
─ ─ ─ ─ ─ ─
  Delete        (always last, always red)
───────────────
```

Rules:
- "View" is always the first action
- Destructive actions are always last and always `text-danger`
- Permission-filtered: missing actions don't render (no disabled state unless the UX reason is explicit)
- Keyboard: clicking `···` focuses first item; Arrow keys navigate; Enter selects; Escape closes

### 13.6 Bulk Actions

When rows are selected, a bulk action bar replaces the toolbar:

```
[☑ 12 selected]  [Export Selected] [Delete Selected]  [× Cancel selection]
```

Rules:
- The count updates dynamically
- Bulk actions are permission-gated
- Destructive bulk actions require a confirmation modal
- Select-all checkbox in header selects all rows on current page (not all pages)
- A "Select all N records" link appears for cross-page bulk operations

### 13.7 Empty State

```
         [Package icon, 48px, text-tertiary]
         No invoices found
         Try adjusting your filters or create a new invoice.
         [+ New Invoice]
```

Every empty state has: icon + heading + description + primary action button.

### 13.8 Loading State

- Skeleton rows replace actual rows during initial load
- Number of skeleton rows = 10 (default page size)
- Skeleton uses `bg-surface-subtle animate-pulse rounded`
- Never show a spinner over the table

### 13.9 Pagination

```
Showing 1–25 of 347 records    [< Prev]  1  2  3  ...  14  [Next >]   [25 per page ▼]
```

Rules:
- Position: directly below the table, same horizontal span
- Show total record count
- Jump to page via direct input (on hover/focus of page number)
- Page size options: 10, 25, 50, 100
- Default: 25
- State persisted to URL query params (`?page=2&pageSize=25`)

### 13.10 Footer Totals Row

For tables with numeric columns (invoices, payments, stock):
- A footer row with background `bg-surface-subtle` shows:
  - `Total` label in the Name column
  - Sum of each numeric column, right-aligned in monospace font
  - If selected rows > 0, shows "Selected: X of Y total"

### 13.11 Row Expansion

For tables with sub-line items (invoice lines, PO lines):
- A `ChevronRight` in the leftmost column (before checkbox) indicates expandable
- Clicking expands an inline sub-table below the row
- The expanded row background uses `bg-surface-subtle`

### 13.12 Inline Edit

For simple text fields in a table:
- Click-to-edit supported where explicitly enabled
- Shows input field inline; Tab moves to next editable cell
- Escape cancels; Enter / Tab saves and moves
- Dirty indicator on row (subtle left border)

---

## PART 14 — FORM DESIGN STANDARD

### 14.1 Form Page Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  PAGE HEADER (back + title + status + action buttons)                │
├──────────────────────────────────────────────────────────────────────┤
│  SECTION: Basic Information                                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  [Field 1      ]  [Field 2      ]  [Field 3      ]             ││
│  │  [Field 4      ]  [Field 5      ]                              ││
│  └─────────────────────────────────────────────────────────────────┘│
│  SECTION: Address Details                                            │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  ...                                                            ││
│  └─────────────────────────────────────────────────────────────────┘│
│  SECTION: Tax & Financial                                            │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  ...                                                            ││
│  └─────────────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────────────┤
│  STICKY FOOTER: [Cancel] [Save as Draft] [Save and Submit]          │
└──────────────────────────────────────────────────────────────────────┘
```

### 14.2 Grid Layout Rules

| Context | Columns | Column width |
|---------|---------|-------------|
| Full-page form | 12-col grid | varies |
| Standard field (most) | span 4 | ~280px |
| Name / Description | span 6–12 | flexible |
| Short code, numeric | span 3 | ~200px |
| Rich text / Textarea | span 12 | full width |
| Two-column form | 2 × span 6 | half each |
| Three-column form | 3 × span 4 | third each |
| Full-width field | span 12 | full width |

### 14.3 Section Card Rules

Each logical group lives in a section card:
```
Section Title                              [expand/collapse toggle optional]
─────────────────────────────────────────
  Field content
```

- Section title: `text-sm font-semibold text-primary uppercase tracking-wide`
- Separator below title: `border-b border-default`
- Card background: `bg-surface-raised rounded-lg p-5`
- Card gap: `gap-6` (24px between cards)

### 14.4 Required Field Indicator

- Required fields show `*` in `text-danger` after the label
- The `*` is always `aria-hidden="true"` — required state conveyed via `required` attribute
- An optional label note `(Optional)` in `text-tertiary text-xs` for fields that are non-required in a primarily required form

### 14.5 Field States

| State | Border | Label | Ring |
|-------|--------|-------|------|
| Default | `border-default` | `text-secondary` | none |
| Focus | `border-focus` | `text-primary` | `ring-2 ring-brand-primary/20` |
| Error | `border-danger` | `text-danger` | `ring-2 ring-danger/20` |
| Disabled | `border-default/50` | `text-disabled` | none |
| Read-only | `bg-surface-subtle border-default` | `text-secondary` | none |

### 14.6 Validation

- **Client-side**: React Hook Form with Zod schema
- **Real-time**: `mode: 'onChange'` for critical fields (GSTIN, PAN, phone)
- **On blur**: Standard text fields validate on blur
- **On submit**: All fields validate on submit
- **Server errors**: API error fields map to form field errors via `setError()`
- **Error message**: `text-xs text-danger` immediately below the field
- **Error scroll**: On submit with errors, scroll to and focus first error field

### 14.7 Dirty State and Unsaved Changes

- Track form dirty state with React Hook Form `isDirty`
- Show a `●` indicator in the page title when dirty
- Show a browser `beforeunload` warning when navigating away with unsaved changes
- "Cancel" button shows a confirmation dialog if `isDirty` is true

### 14.8 Auto Save (where applicable)

For long forms (invoice entry, purchase order):
- Auto-save to draft every 60 seconds
- Show "Auto-saved 2 min ago" in `text-xs text-tertiary` near the footer
- Auto-save indicator: `CheckCircle2` icon + text on success, `AlertCircle` on failure

### 14.9 Sticky Footer

The save bar sticks to the bottom of the viewport when the user scrolls past the page header:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ● Unsaved changes                [Cancel] [Save Draft] [Save & Submit]
└──────────────────────────────────────────────────────────────────────┘
```

- Fixed at bottom, full width of main content area
- Background: `bg-surface-raised border-t border-default shadow-lg`
- Visible only when there are changes (tracks `isDirty`)
- OR always visible for new entity creation forms

### 14.10 Tab Order

Every form defines explicit `tabIndex` or relies on DOM order. Tab order must follow the logical reading order of the form (left to right, top to bottom within each row, then to the next row). Form section headers and decorative elements must have `tabIndex={-1}`.

---

## PART 15 — FORM COMPONENTS STANDARD

All form components must be from `packages/shared-ui/src/components/form/`. No inline form elements in page files.

### 15.1 ERPInput

```typescript
interface ERPInputProps {
  label: string;
  name: string;
  required?: boolean;
  error?: string;
  hint?: string;
  prefix?: string;        // e.g. "₹", "+91"
  suffix?: string;        // e.g. "kg", "%"
  type?: HTMLInputTypeAttribute;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  maxLength?: number;
  showCount?: boolean;    // character counter
  clearable?: boolean;    // show × to clear
}
```

### 15.2 ERPTextarea

Same as ERPInput but renders `<textarea>`. Additional props:
- `rows?: number` (default 3)
- `autoResize?: boolean` (grow with content up to `maxRows`)
- `maxRows?: number`

### 15.3 ERPSelect

```typescript
interface ERPSelectProps<T> {
  label: string;
  name: string;
  options: { value: T; label: string; disabled?: boolean }[];
  searchable?: boolean;   // enables type-to-filter
  clearable?: boolean;
  multiple?: boolean;
  required?: boolean;
  error?: string;
  hint?: string;
  placeholder?: string;
  loading?: boolean;
}
```

- Non-searchable: native `<select>` for performance
- Searchable: custom combobox with keyboard navigation (↑/↓ navigate, Enter select, Escape close)
- Multiple: shows chips in the input field
- Uses `--surface-overlay` for dropdown background, with shadow

### 15.4 ERPAsyncSelect

Like ERPSelect but with:
- `loadOptions: (inputValue: string) => Promise<Option[]>`
- Shows loading indicator while fetching
- Debounce 300ms
- Minimum search length: 1 character

Used for: Customer search, Supplier search, Item search, User search.

### 15.5 ERPDatePicker

```typescript
interface ERPDatePickerProps {
  label: string;
  name: string;
  required?: boolean;
  error?: string;
  minDate?: Date;
  maxDate?: Date;
  showPresets?: boolean;       // show Today, Yesterday, etc.
  dateFormat?: string;         // default 'DD MMM YYYY'
  includeTime?: boolean;
  disabledDates?: Date[];
  financialYearBound?: boolean; // restrict to current FY
}
```

### 15.6 ERPDateRangePicker

Two linked date inputs with a calendar popover. Includes presets (This Week, This Month, etc.).

### 15.7 ERPCurrencyInput

Specialized numeric input for monetary values:
- Formats with Indian number system (lakh/crore)
- Shows `₹` prefix
- Allows only digits and one decimal point
- Always 2 decimal places on blur
- Right-aligned internally
- Uses monospace font

### 15.8 ERPGSTINInput

Input with built-in GSTIN format validation:
- Format: `29AABCR1234C1Z5` (15 chars)
- Auto-uppercase
- Format hint shown on focus
- `CheckCircle2` on valid, `AlertCircle` on invalid
- Can trigger auto-fetch of party details from GSTIN

### 15.9 ERPPhoneInput

- Country code selector dropdown (defaults to `+91`)
- 10-digit validation for Indian numbers
- Formats display as `+91 98765 43210`

### 15.10 ERPFileUpload

```typescript
interface ERPFileUploadProps {
  label: string;
  name: string;
  accept?: string;           // MIME types
  maxSize?: number;          // bytes, default 10MB
  multiple?: boolean;
  maxFiles?: number;
  showPreview?: boolean;     // image preview
  uploadEndpoint?: string;   // direct upload URL
}
```

- Drag-and-drop zone + click to browse
- Shows upload progress bar per file
- Shows thumbnail for image files
- Lists uploaded files with name, size, remove button

### 15.11 ERPSwitch

Toggle switch for boolean values. NOT a checkbox (checkboxes are for multi-select lists). Shows label + switch + optional helper text. Uses `role="switch"` and `aria-checked`.

### 15.12 ERPCheckbox

For multi-select within a list:
- Standalone or within a group (ERPCheckboxGroup)
- Indeterminate state supported (for select-all scenarios)

### 15.13 ERPRadioGroup

For mutually exclusive selection from a short list (≤ 6 options). For longer lists, use ERPSelect.

### 15.14 ERPRichText

Rich text editor using `@tiptap/react`:
- Toolbar: Bold, Italic, Underline, Bullet List, Numbered List, Link
- No custom fonts, no custom colors, no images (those go via file upload)
- Output: HTML string stored in database
- Max toolbar extensions to maintain simplicity

### 15.15 ERPOTPInput

6-digit OTP input. 6 individual single-character inputs that auto-advance on digit entry. Backspace moves to previous.

### 15.16 ERPBarcodeInput

Text input that also accepts input from a barcode scanner:
- Detects scanner mode (rapid character input < 50ms per char)
- Triggers `onScan` callback when scan is detected
- Shows `Barcode` icon prefix

---

## PART 16 — BUTTON STANDARD

### 16.1 Variants

| Variant | When to Use | Visual |
|---------|-------------|--------|
| `primary` | Single primary action per context | Filled brand color |
| `secondary` | Alternative actions | Filled neutral, bordered |
| `outline` | Secondary actions in toolbars | Transparent, border |
| `ghost` | Tertiary, icon buttons, table row actions | No border, subtle hover |
| `danger` | Destructive (only in modal confirm) | Filled red |
| `danger-outline` | Destructive as secondary action | Red border + text |
| `link` | Navigation-style, inline text | No padding, brand color text |

### 16.2 Sizes

| Size | Padding | Font | Icon |
|------|---------|------|------|
| `xs` | `px-2 py-1` | 11px | 12px |
| `sm` | `px-3 py-1.5` | 12px | 14px |
| `md` | `px-4 py-2` | 13px | 16px (default) |
| `lg` | `px-5 py-2.5` | 14px | 18px |
| `xl` | `px-6 py-3` | 15px | 20px |

### 16.3 States

- `loading`: Shows a `Loader2` icon spinning (replaces or prepends); button is disabled
- `disabled`: 50% opacity, cursor not-allowed, no hover effects
- `active`: Pressed/selected state for toggle buttons

### 16.4 Icon Buttons

- Always have `aria-label` or `title`
- Use `ghost` or `outline` variant
- Size `sm` (32px) or `md` (36px)
- Use `rounded-md` by default, `rounded-full` ONLY for avatar-style buttons

### 16.5 Button Groups

Related buttons can be grouped in a `ERPButtonGroup` that removes gaps and joins borders:
```
[Export ▼] [Print] [Email]
```

### 16.6 Split Button

A button with a primary action and a dropdown for secondary actions:
```
[Save and Submit][▼] → dropdown: Save as Draft, Save and Print
```

### 16.7 Position Rules

- Primary CTA: always rightmost in a button group
- Destructive actions: always leftmost (then a gap separator) in footer button groups, or in dropdown menus only
- Modal confirm buttons: Cancel (left, `outline`) | Confirm action (right, `primary` or `danger`)
- Page header buttons: from left — Export, Import, Print, then | New Entity (rightmost, `primary`)
- Sticky form footer: Cancel (left, `ghost`) | Save Draft (center-left, `outline`) | Save & Submit (rightmost, `primary`)

---

## PART 17 — MODAL STANDARD

### 17.1 Modal Sizes

| Size | Width | When |
|------|-------|------|
| `sm` | 400px | Confirmation, delete, simple message |
| `md` | 560px | Short forms, quick-create |
| `lg` | 720px | Multi-field forms, complex confirmation |
| `xl` | 960px | Full preview, complex wizard step |
| `2xl` | 1200px | PDF preview, data import review |
| `fullscreen` | 100vw | Document editor, advanced search |

### 17.2 Modal Anatomy

```
┌──────────────────────────────────────────────────┐
│  Modal Title                               [× X]  │
│  Optional subtitle                               │
├──────────────────────────────────────────────────┤
│                                                  │
│  Content                                         │
│                                                  │
├──────────────────────────────────────────────────┤
│  [Cancel]                        [Action Button] │
└──────────────────────────────────────────────────┘
```

### 17.3 Modal Rules

- `Escape` always closes (unless `closeOnEscape={false}` for critical workflows)
- Clicking the backdrop closes (unless `closeOnBackdropClick={false}`)
- Focus trap: Tab cycles only within the modal
- On open: focus first interactive element or close button
- On close: return focus to the element that opened the modal
- Scroll lock on `<body>` when modal is open
- Maximum 1 modal stack depth — nested modals are FORBIDDEN (use drawer panels instead)
- Overlay: `bg-black/50 backdrop-blur-sm`
- Modal background: `bg-surface-overlay`
- Enter key in confirmation modal triggers the primary action

### 17.4 Confirmation Modal Pattern

```typescript
// Every destructive action uses this:
<ERPConfirmModal
  title="Delete Invoice?"
  description="This will permanently delete INV-2026-0047. This action cannot be undone."
  confirmLabel="Delete Invoice"
  confirmVariant="danger"
  onConfirm={handleDelete}
  icon={Trash2}
/>
```

### 17.5 Drawer (Side Panel)

The drawer is the preferred alternative to `xl` and `2xl` modals. It slides in from the right (360px–640px wide depending on content) and leaves the main content partially visible.

Use drawer for:
- Record quick-view (clicking a row to see details without navigating away)
- Quick-create forms that need more room than `md` modal
- Filters (advanced filter drawer)

Rules:
- Drawer backdrop: semi-transparent, `50%` opacity
- Closing a dirty form drawer shows the same confirmation as navigating away with unsaved changes
- Drawer has its own scroll context (content inside scrolls independently)

### 17.6 Wizard Modal

For multi-step processes (Onboarding, Opening Balance Wizard, Import Wizard):

```
Step 1 ─── Step 2 ─── Step 3 ─── Step 4
[Step title]
[Step content]
[← Back]                    [Next →] or [Submit]
```

- Step indicator at top (breadcrumb-style or numbered circles)
- Progress percentage shown
- Back button always visible
- Cannot skip steps unless the step is optional
- Data persisted across steps (no re-entry)

---

## PART 18 — STATUS BADGE STANDARD

### 18.1 ERPStatusBadge Props

```typescript
interface ERPStatusBadgeProps {
  status: string;     // 'DRAFT' | 'CONFIRMED' | 'PENDING' | etc.
  dot?: boolean;      // show colored dot before label
  size?: 'sm' | 'md';
}
```

### 18.2 Badge Appearance

- `rounded-full` with `px-2.5 py-0.5`
- Text: `text-xs font-medium`
- Color uses semantic status color map from Section 5.3
- Optional dot: 6px circle, same color as text
- Never use colored background without text — always include the status label

### 18.3 Forbidden Patterns

```
// FORBIDDEN
<span className="bg-green-100 text-green-700 px-2 py-1 rounded">Active</span>

// CORRECT
<ERPStatusBadge status="ACTIVE" dot />
```

---

## PART 19 — NOTIFICATION STANDARD

### 19.1 Toast Notifications

All user-facing feedback after actions (save, delete, error) uses toast notifications from `react-hot-toast` or `sonner` (unified via an `ERPToast` wrapper).

### 19.2 Toast Rules

- Position: top-right, below the header (offset for header height)
- Auto-dismiss: 4 seconds for success/info; 8 seconds for error; indefinite for progress
- Maximum 3 toasts visible at once (older ones stack above / queue)
- Never use `alert()`, `confirm()`, or `prompt()` — always use toast or modal

### 19.3 Toast Variants

| Variant | Icon | Color |
|---------|------|-------|
| `success` | `CheckCircle2` | Green |
| `error` | `AlertCircle` | Red |
| `warning` | `AlertTriangle` | Amber |
| `info` | `Info` | Blue |
| `loading` | `Loader2` spinning | Blue |
| `promise` | Transitions from loading to success/error | — |

### 19.4 Toast Content Pattern

```typescript
// After saving a record:
toast.success('Customer saved', {
  description: 'Ramesh Textiles has been updated.',
  action: { label: 'View', onClick: () => navigate('/customers/123') }
});

// After a destructive action:
toast.success('Invoice deleted', {
  description: 'INV-2026-0047 was deleted.',
  action: { label: 'Undo', onClick: handleUndo }
});
```

- Short title (2–4 words)
- Optional description (1 sentence)
- Optional action button (View, Undo, Retry)

### 19.5 Inline Notifications

For page-level alerts (not transient), use inline notification banners:

```
[Info icon]  The opening balance wizard has not been completed. [Complete Now →]
```

- Appears directly below the page header
- Stays until dismissed or the underlying issue is resolved
- Never use inline notifications for save confirmations (use toast)

---

## PART 20 — EMPTY STATE STANDARD

Every empty state follows this structure:

```typescript
interface ERPEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    icon?: LucideIcon;
    onClick: () => void;
    variant?: ButtonVariant;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  type: 'no-data' | 'no-results' | 'permission-denied' | 'error' | 'offline' | 'maintenance';
}
```

### Empty State Scenarios

| Type | Icon | Title | Description |
|------|------|-------|-------------|
| `no-data` | Module icon | `No {entities} yet` | `Create your first {entity} to get started.` |
| `no-results` | `SearchX` | `No results found` | `Try adjusting your search or filters.` |
| `permission-denied` | `Lock` | `Access restricted` | `You don't have permission to view this.` |
| `error` | `AlertCircle` | `Something went wrong` | `An error occurred. Please try again.` |
| `offline` | `WifiOff` | `You're offline` | `Check your connection and try again.` |
| `maintenance` | `Wrench` | `Under maintenance` | `This feature is temporarily unavailable.` |

---

## PART 21 — LOADING STANDARD

### 21.1 Skeleton Loading

All data-fetching screens show skeletons, not spinners. Skeletons mimic the exact layout of the content they replace.

```typescript
// Table skeleton: 10 rows × column widths
<ERPTableSkeleton columns={6} rows={10} />

// Card skeleton
<ERPCardSkeleton />

// Form skeleton (matches form field layout)
<ERPFormSkeleton sections={3} fieldsPerSection={4} />
```

### 21.2 Spinner Usage

Spinners are ONLY used for:
- Button loading state (inline within the button)
- Global page transition (small, centered, not full-screen)
- File upload progress (within the upload zone)

Never show a full-page spinner/overlay for data fetching.

### 21.3 Optimistic UI

For common mutations (toggle status, delete, add tag):
- Update the UI immediately on user action
- Revert on API error and show an error toast with "Retry"
- For delete: show a 3-second "Undo" window before the actual API call

### 21.4 Background Refresh

- TanStack Query automatically refetches on window focus (`refetchOnWindowFocus: true`)
- Stale time: 30 seconds for most lists
- Show a subtle "Refreshing..." indicator in the top-right corner during background refetch
- Never block UI during background refresh

---

## PART 22 — COMMAND PALETTE STANDARD

### 22.1 Trigger

- `Ctrl+K` (Windows/Linux) or `Cmd+K` (macOS)
- Also: Clicking the search area in the sidebar (when expanded) or the global search in the header

### 22.2 Layout

```
┌────────────────────────────────────────────────────────┐
│  🔍  Search pages, records, actions...                  │
├────────────────────────────────────────────────────────┤
│  RECENT PAGES                                          │
│  📄 INV-2026-0047 · Invoice                            │
│  👤 Ramesh Textiles · Customer                         │
│  📦 Cotton Fabric 60" · Item                           │
├────────────────────────────────────────────────────────┤
│  QUICK ACTIONS                                         │
│  ➕ New Invoice                                         │
│  ➕ New Customer                                        │
│  ➕ New Purchase Order                                  │
├────────────────────────────────────────────────────────┤
│  NAVIGATION                                            │
│  Sales › Invoices                                      │
│  Inventory › Stock Levels                              │
└────────────────────────────────────────────────────────┘
```

### 22.3 Behavior

- Opens as a `fullscreen` modal (on mobile) or centered `lg` modal (desktop)
- Keyboard: `↑`/`↓` navigate items; `Enter` selects; `Escape` closes
- Groups: Pages, Records, Actions, Navigation
- Search is instant (local index) + Elasticsearch for record search (debounced 300ms)
- Recent items stored in Zustand + localStorage (up to 10)
- Closes on selection and on `Escape`

---

## PART 23 — DASHBOARD STANDARD

### 23.1 Structure

```
Page Header (Dashboard · Today, 29 Jun 2026)   [Customize] [Date Range ▼]
─────────────────────────────────────────────────────────────────────────
KPI Row (4–6 stat cards)
─────────────────────────────────────────────────────────────────────────
CHART ROW (2 charts side by side, or 1 full-width)
─────────────────────────────────────────────────────────────────────────
QUICK LISTS ROW: Pending Approvals | Recent Invoices | Low Stock Items
```

### 23.2 KPI Stat Card

```typescript
interface ERPStatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  trend?: {
    value: number;        // percentage
    direction: 'up' | 'down';
    isPositive: boolean;  // up revenue = positive (green), up losses = negative (red)
    label: string;        // "vs last month"
  };
  onClick?: () => void;   // drills into the relevant list page
  loading?: boolean;
}
```

### 23.3 Dashboard Personalization

- Users can drag-to-reorder widgets
- Users can show/hide widgets
- Layouts stored per user in the database
- Role-based default layouts: Owner sees financial KPIs; Cashier sees POS summary; Warehouse sees stock alerts

### 23.4 Charts

- Chart library: `recharts` (already in stack)
- All charts use design token colors: `--brand-primary`, `--color-success`, `--color-warning`, etc.
- No random color palettes
- All charts are responsive (use `<ResponsiveContainer>`)
- All charts have tooltips with formatted values
- Charts never show raw data — always formatted (INR with commas, percentages with %, dates formatted)

---

## PART 24 — PERMISSION-DRIVEN UI STANDARD

### 24.1 Principles

1. Hidden > Disabled: if a user cannot perform an action, the button does not render (not disabled)
2. Exception: show disabled state only when the UI specifically needs to communicate "this exists but you can't do it" — rare, only in teaching contexts
3. Read-only views are shown when a user can view but not edit — form renders in read-only mode
4. Permission checks are ALWAYS server-side — client-side is UX only, not security

### 24.2 PermissionGate Component

```typescript
interface PermissionGateProps {
  permission: string;              // e.g. 'invoices:create'
  children: React.ReactNode;
  fallback?: React.ReactNode;      // default: null (nothing rendered)
}
```

Usage:
```tsx
<PermissionGate permission="invoices:create">
  <Button onClick={handleNew}>New Invoice</Button>
</PermissionGate>

// With read-only fallback:
<PermissionGate
  permission="customers:edit"
  fallback={<ReadOnlyCustomerForm customer={customer} />}
>
  <CustomerEditForm customer={customer} />
</PermissionGate>
```

### 24.3 Field-Level Permissions

Some fields are conditionally editable (e.g., cost price visible only to managers):

```tsx
<ERPInput
  label="Cost Price"
  name="costPrice"
  readOnly={!hasPermission('items:view-cost-price')}
  type={hasPermission('items:view-cost-price') ? 'text' : 'password'}
/>
```

---

## PART 25 — MULTI-TENANT THEMING STANDARD

### 25.1 What Tenants Can Customize

Without code changes, via the Administration → Settings → Branding UI:

| Customizable | What changes |
|-------------|-------------|
| Primary color | All buttons, links, active states, focus rings |
| Sidebar color | Sidebar background and text |
| Logo URL | Sidebar logo, login page logo |
| Favicon URL | Browser tab icon |
| Login background | Login page hero image / gradient |
| Application name | Browser title, sidebar header text |

### 25.2 What Tenants Cannot Customize

- Typography (font family is fixed)
- Spacing and layout (consistent UX across all tenants)
- Icon library (always Lucide)
- Component structure and behavior

### 25.3 Theme Application

1. On app load, `TenantThemeProvider` fetches `GET /api/v2/tenant/branding`
2. Injects `<style>` tag into `<head>` with CSS variable overrides
3. Hot-switchable: changing the theme in Settings applies immediately without page reload

### 25.4 White Label

Enterprise tenants can suppress all NEXORAA branding:
- Remove NEXORAA from sidebar header
- Custom application name
- Custom login page
- Custom email/PDF template headers

---

## PART 26 — ACCESSIBILITY STANDARD

### 26.1 Requirements

- WCAG 2.1 AA for all screens
- WCAG 2.1 AAA for: Login, Payment screens, Approval flows, Critical alerts

### 26.2 Keyboard Navigation

- Every interactive element reachable via Tab
- Tab order matches visual reading order
- `Shift+Tab` reverses
- Arrow keys navigate within: dropdowns, menus, radio groups, table rows
- `Enter` activates focused element
- `Space` toggles checkboxes, switches, buttons (where appropriate)
- `Escape` closes modals, drawers, dropdowns

### 26.3 ARIA Requirements

- All form fields have associated `<label>` or `aria-label`
- All icon buttons have `aria-label` or `title`
- All status badges have readable text content (not just color)
- All modals have `role="dialog"`, `aria-labelledby`, `aria-describedby`
- Data tables use `<thead>`, `<th scope="col">`, `<tbody>`
- Sortable columns have `aria-sort="ascending|descending|none"`
- Loading states use `aria-busy="true"` on the container
- Expanded/collapsed states use `aria-expanded`
- Required fields use `aria-required="true"` in addition to visual indicator

### 26.4 Focus Management

- On modal open: focus first focusable element inside
- On modal close: return focus to trigger element
- On route change: focus the page heading (H1)
- On form error: scroll to and focus first errored field
- Focus ring: always visible, never `outline: none` without `outline: 0` + custom ring

### 26.5 Color and Contrast

- Body text: minimum 7:1 contrast ratio (AAA)
- UI elements: minimum 4.5:1 (AA)
- Icons: minimum 3:1 against background
- Never convey information by color alone (status shown with text label + icon + color)

### 26.6 Motion

- All animations respect `prefers-reduced-motion`
- Default transition durations: 150–200ms
- No auto-playing videos
- No flashing content at frequencies > 3Hz

---

## PART 27 — RESPONSIVE STANDARD

### 27.1 Breakpoints

| Name | Min Width | Target |
|------|-----------|--------|
| `xs` | 0 | Mobile portrait |
| `sm` | 640px | Mobile landscape / small tablet |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Laptop / tablet landscape |
| `xl` | 1280px | Desktop (primary target) |
| `2xl` | 1536px | Wide desktop |
| `3xl` | 1920px | Ultra-wide / 4K |

### 27.2 Desktop First (1280px primary)

The ERP is a desktop-first application. All designs start at 1280px. Mobile adaptations are explicitly added, not the default.

### 27.3 Responsive Rules

| Element | Mobile (< 768px) | Desktop (≥ 1024px) |
|---------|------------------|---------------------|
| Sidebar | Hidden by default, overlay on toggle | Always visible, expandable |
| Navigation | Bottom tab bar (5 main modules) | Left sidebar |
| Table | Horizontal scroll; only show 3 key columns | All columns |
| Form grid | Single column | 3-column grid |
| Filters | Collapsed in drawer | Toolbar visible |
| Breadcrumb | Last 2 crumbs only | Full crumbs |
| Page header actions | Icon only buttons | Icon + label |
| KPI cards | 2 per row | 4–6 per row |
| Charts | Full width, vertical stacked | Side-by-side |

### 27.4 Minimum Width

The desktop application has a minimum viewport width of `1024px`. Below this, a horizontal scroll container appears (not a broken layout).

---

## PART 28 — ANIMATION STANDARD

### 28.1 Philosophy

Every animation must serve a purpose:
- Communicating state change (loading → loaded)
- Directing attention (new notification)
- Providing spatial context (drawer sliding in = content came from the right)
- Confirming an action (success checkmark pulse)

No animation is decorative.

### 28.2 Duration Rules

| Animation Type | Duration | Easing |
|---------------|----------|--------|
| Microinteraction (button press, hover) | 100ms | `ease-out` |
| Component transition (tab switch, accordion) | 150ms | `ease-in-out` |
| Layout shift (sidebar expand/collapse) | 200ms | `ease-in-out` |
| Modal/drawer open | 200ms | `ease-out` |
| Modal/drawer close | 150ms | `ease-in` |
| Toast enter | 200ms | `ease-out` (slide + fade) |
| Toast exit | 150ms | `ease-in` (fade) |
| Page transition | 100ms | `ease-in-out` (fade) |
| Success confirmation | 300ms | custom spring |

### 28.3 Forbidden Animations

- Bounce effects
- Shake effects (except for error emphasis — use sparingly)
- Rotation (except Loader spinning)
- Scale transforms larger than 1.02
- Infinite loops (except spinners)
- Parallax
- Particle effects

---

## PART 29 — PRINT STANDARD

### 29.1 Print Document Types

| Document | Format | Layout |
|----------|--------|--------|
| Tax Invoice | A4 Portrait | Company header, party details, item table, GST summary, totals, signatures |
| Quotation | A4 Portrait | Same as invoice |
| Purchase Order | A4 Portrait | Same as invoice |
| Delivery Challan | A4 Portrait | Simplified invoice without GST |
| Barcode Labels | 50×30mm, 40×25mm | Barcode + item name + price |
| Reports | A4 Landscape | Title, filters applied, data table, totals |

### 29.2 Print Rules

- Print views are separate React components rendered to PDF via `apps/report-service` (Puppeteer/Handlebars)
- Never use `window.print()` directly — always generate PDF via report service
- PDF is embedded in an `<iframe>` preview before print
- All prices show GST breakdown in print format
- Invoice print always shows company logo, GSTIN, CIN
- Tenant logo and colors applied to print documents

### 29.3 Thermal Printer (POS)

- Paper width: 80mm or 57mm (configurable per branch)
- Uses `@react-thermal-printer/renderer` or equivalent
- Items table in compact format
- GST summary at bottom
- QR code for UPI payment
- Footer with return policy

---

## PART 30 — INTERNATIONALIZATION STANDARD

### 30.1 Current Scope

- Language: English (India) — primary
- Currency: INR (₹) — primary
- Number system: Indian (lakh/crore)
- GST: Indian tax system
- Future: Hindi UI strings (i18n keys ready from day 1)

### 30.2 i18n Architecture

- All user-facing strings use `react-i18next` with translation keys
- No hardcoded English strings in component JSX (only in translation files)
- Translation files: `src/locales/en-IN.json`, `src/locales/hi-IN.json` (stub)
- Date formatting: `date-fns` with locale
- Number formatting: `Intl.NumberFormat` with `{ locale: 'en-IN' }`
- Currency formatting: `Intl.NumberFormat` with `{ style: 'currency', currency: 'INR' }`

### 30.3 RTL Readiness

All layout uses logical CSS properties where possible (`start/end` instead of `left/right`) so RTL support requires only `dir="rtl"` on `<html>`. The sidebar must flip. Tables must flip. Breadcrumb separators must reverse.

---

## PART 31 — PERFORMANCE STANDARD

### 31.1 Targets

| Metric | Target |
|--------|--------|
| Time to First Byte | < 200ms |
| First Contentful Paint | < 1.0s |
| Largest Contentful Paint | < 2.0s |
| Time to Interactive | < 2.5s |
| Cumulative Layout Shift | < 0.1 |
| Input Delay | < 100ms |
| Bundle size (initial JS) | < 200KB gzipped |

### 31.2 Code Splitting

Every module (Sales, Inventory, Purchase, etc.) is lazily loaded:
```typescript
const SalesModule = lazy(() => import('./modules/sales'));
const InventoryModule = lazy(() => import('./modules/inventory'));
```

Each module chunk should be < 100KB gzipped.

### 31.3 Virtual Scrolling

Tables with > 100 rows use TanStack Virtual for virtualized rows. This is mandatory for:
- All report pages
- Transaction history tabs
- Audit log
- Import/export review screens

### 31.4 Memoization Rules

- Use `React.memo` for table row components
- Use `useMemo` for expensive derivations (filtered/sorted data, totals calculation)
- Use `useCallback` for event handlers passed as props to memoized children
- Never memoize everything — only where profiler shows a problem

### 31.5 Image Optimization

- All logos uploaded via the branding UI are auto-resized and served as WebP
- Max logo dimensions: 200×60px (sidebar), 300×100px (print header)
- Product images (future): served via CDN with size-appropriate srcset

---

## PART 32 — FOLDER STRUCTURE STANDARD

```
apps/web-frontend/src/
├── main.tsx                        Entry point
├── App.tsx                         Root router + providers
├── styles/
│   ├── tokens.css                  Design tokens (CSS variables)
│   └── index.css                   Tailwind directives, global resets
│
├── providers/                      React context providers
│   ├── AuthProvider.tsx
│   ├── ThemeProvider.tsx
│   ├── TenantThemeProvider.tsx
│   └── QueryProvider.tsx
│
├── store/                          Zustand global state
│   ├── auth.store.ts
│   ├── ui.store.ts                 Sidebar, theme, command palette
│   └── notifications.store.ts
│
├── layouts/                        Shell layouts
│   ├── AppLayout.tsx               Main authenticated layout
│   ├── AuthLayout.tsx              Login/register layout
│   └── PrintLayout.tsx             PDF print layout
│
├── components/                     Shared UI components
│   ├── ui/                         Primitive UI (no business logic)
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Checkbox.tsx
│   │   ├── Switch.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── Drawer.tsx
│   │   └── Tooltip.tsx
│   │
│   ├── erp/                        ERP-specific compound components
│   │   ├── ERPPageHeader.tsx
│   │   ├── ERPBreadcrumb.tsx
│   │   ├── ERPDataGrid.tsx
│   │   ├── ERPDataGridSkeleton.tsx
│   │   ├── ERPFilter.tsx
│   │   ├── ERPFilterDrawer.tsx
│   │   ├── ERPStatusBadge.tsx
│   │   ├── ERPStatCard.tsx
│   │   ├── ERPEmptyState.tsx
│   │   ├── ERPCommandPalette.tsx
│   │   ├── ERPConfirmModal.tsx
│   │   ├── ERPForm.tsx
│   │   ├── ERPFormSection.tsx
│   │   └── ERPWizard.tsx
│   │
│   └── form/                       Form field components
│       ├── ERPInput.tsx
│       ├── ERPTextarea.tsx
│       ├── ERPSelect.tsx
│       ├── ERPAsyncSelect.tsx
│       ├── ERPDatePicker.tsx
│       ├── ERPDateRangePicker.tsx
│       ├── ERPCurrencyInput.tsx
│       ├── ERPGSTINInput.tsx
│       ├── ERPPhoneInput.tsx
│       ├── ERPFileUpload.tsx
│       ├── ERPSwitch.tsx
│       ├── ERPCheckbox.tsx
│       ├── ERPRadioGroup.tsx
│       ├── ERPRichText.tsx
│       └── ERPBarcodeInput.tsx
│
├── hooks/                          Shared hooks
│   ├── usePermission.ts            Check permission for current user
│   ├── useDebounce.ts
│   ├── usePagination.ts
│   ├── useTableState.ts            Sort, filter, page, pageSize in URL
│   ├── useConfirm.ts               Programmatic confirm modal
│   ├── useCommandPalette.ts
│   └── useExport.ts                Export to CSV/XLSX/PDF
│
├── services/                       API client layer
│   ├── api.client.ts               Axios instance with auth interceptors
│   ├── auth.service.ts
│   ├── customers.service.ts
│   ├── suppliers.service.ts
│   ├── items.service.ts
│   ├── inventory.service.ts
│   ├── sales.service.ts
│   └── ... (one file per backend service)
│
├── modules/                        Feature modules (lazy loaded)
│   ├── sales/
│   │   ├── index.tsx               Module router
│   │   ├── pages/
│   │   │   ├── InvoicesPage.tsx
│   │   │   ├── InvoiceDetailPage.tsx
│   │   │   ├── InvoiceFormPage.tsx
│   │   │   └── ...
│   │   ├── components/             Module-specific components
│   │   │   ├── InvoiceLineItems.tsx
│   │   │   └── ...
│   │   └── hooks/                  Module-specific hooks
│   │       └── useInvoiceForm.ts
│   │
│   ├── inventory/
│   ├── purchase/
│   ├── accounting/
│   ├── gst/
│   ├── hr/
│   ├── reports/
│   └── settings/
│
└── types/                          Frontend TypeScript types
    ├── api.types.ts                 API response shapes
    ├── ui.types.ts                  UI state shapes
    └── entities.types.ts            Business entity types (mirrors @erp/types)
```

---

## PART 33 — NAMING STANDARDS

### 33.1 Component Files

- PascalCase, `.tsx` extension
- Name matches the default export: `InvoiceFormPage.tsx` exports `InvoiceFormPage`
- ERP-level shared components prefixed with `ERP`: `ERPDataGrid.tsx`, `ERPStatusBadge.tsx`
- Primitive UI components not prefixed: `Button.tsx`, `Modal.tsx`, `Input.tsx`

### 33.2 Hook Files

- camelCase with `use` prefix, `.ts` extension
- Specific: `useInvoiceForm.ts`, `useCustomerSearch.ts`
- Generic: `usePagination.ts`, `useDebounce.ts`

### 33.3 Service Files

- camelCase + `.service.ts`: `customers.service.ts`, `inventory.service.ts`
- One file per backend microservice domain

### 33.4 Store Files

- camelCase + `.store.ts`: `auth.store.ts`, `ui.store.ts`

### 33.5 CSS / Tailwind Classes

- No custom CSS class names except for design tokens (in `tokens.css`)
- All styling via Tailwind utility classes
- Complex repeated patterns extracted to component, not CSS class
- If a utility combination repeats 3+ times, extract to a component

### 33.6 Route Paths

| Pattern | Example |
|---------|---------|
| List | `/sales/invoices` |
| New | `/sales/invoices/new` |
| Detail | `/sales/invoices/:id` |
| Edit | `/sales/invoices/:id/edit` |
| Sub-resource | `/sales/invoices/:id/payments` |
| Settings | `/settings/:section` |
| Reports | `/reports/:reportType` |

All route params use `id` for the primary identifier. Sub-resource identifiers use explicit names: `/purchase/orders/:orderId/lines/:lineId`.

### 33.7 API Query Keys (TanStack Query)

```typescript
// Convention: ['entity', 'list', filters] or ['entity', 'detail', id]
['invoices', 'list', { status: 'CONFIRMED', page: 1 }]
['invoices', 'detail', 'inv-uuid-123']
['customers', 'list', { search: 'ramesh' }]
['customers', 'detail', 'cust-uuid-456']
['customers', 'history', 'cust-uuid-456']
```

---

## PART 34 — FRONTEND CODING STANDARDS

### 34.1 TypeScript Rules

- `strict: true` always
- No `any` (use `unknown` and narrow, or explicit types)
- No non-null assertions (`!`) unless genuinely impossible to be null and the reason is commented
- All API response types explicitly typed (no implicit inference from `fetch`)
- Use `satisfies` instead of `as` where possible
- Prefer `interface` for object shapes, `type` for unions and mapped types

### 34.2 State Management Rules

- **Server state**: TanStack Query only — no Redux/Zustand for fetched data
- **Global UI state**: Zustand (sidebar collapsed, command palette open, active notifications)
- **Form state**: React Hook Form + Zod
- **URL state**: Use URL query params for table filters, page, pageSize, sort (`useSearchParams`)
- **Local component state**: `useState` for purely local UI state (dropdown open/closed, hover state)
- Never duplicate server state into local state — derive from the cache

### 34.3 Error Boundaries

Every module router wraps its content in an `<ErrorBoundary>` that shows the `ERPEmptyState type="error"` and a "Try Again" button.

```typescript
// modules/sales/index.tsx
<ErrorBoundary fallback={<ERPEmptyState type="error" title="Sales module error" />}>
  <Outlet />
</ErrorBoundary>
```

### 34.4 Data Fetching Pattern

```typescript
// Every page that fetches data follows this pattern:
function InvoicesPage() {
  const { filters } = useTableState('invoices');   // reads from URL
  const { data, isLoading, isError } = useInvoices(filters);

  if (isLoading) return <ERPDataGridSkeleton columns={7} />;
  if (isError)   return <ERPEmptyState type="error" />;

  return (
    <>
      <ERPPageHeader ... />
      <ERPFilter ... />
      <ERPDataGrid data={data.items} columns={columns} ... />
      <ERPPagination total={data.total} ... />
    </>
  );
}
```

### 34.5 Mutation Pattern

```typescript
// Every mutation follows this pattern:
const { mutate: saveInvoice, isPending } = useMutation({
  mutationFn: (data: InvoiceFormData) => invoicesService.create(data),
  onSuccess: (invoice) => {
    queryClient.invalidateQueries({ queryKey: ['invoices', 'list'] });
    toast.success('Invoice created', { description: invoice.invoiceNo });
    navigate(`/sales/invoices/${invoice.id}`);
  },
  onError: (error: ApiError) => {
    if (error.fieldErrors) {
      Object.entries(error.fieldErrors).forEach(([field, message]) => {
        form.setError(field as FieldPath<InvoiceFormData>, { message });
      });
    } else {
      toast.error('Failed to create invoice', { description: error.message });
    }
  },
});
```

### 34.6 API Client

```typescript
// services/api.client.ts
// Axios instance with:
// - Base URL from env
// - Authorization header from auth store
// - Response interceptor: 401 → logout + redirect to login
// - Response interceptor: 422 → parse validation errors into ApiError.fieldErrors
// - Request interceptor: inject X-Tenant-ID and X-Branch-ID from auth store
```

### 34.7 Security Rules

- Never store tokens in localStorage (use httpOnly cookies via `/api/v2/auth/refresh`)
- Access tokens stored in Zustand in-memory only (lost on page refresh, refreshed automatically)
- Never log sensitive data (GSTIN, PAN, amounts in console)
- All inputs sanitized before display (`DOMPurify` for rich text HTML)
- No direct DOM manipulation — always via React state
- CSP headers set by Nginx — no `unsafe-inline` scripts

---

## PART 35 — COMPONENT CATALOG

This is the complete list of components that must exist in `packages/shared-ui` or `apps/web-frontend/src/components/`. Every module uses only these components. No raw HTML elements in page-level code.

### Layout Components
- `ERPAppShell` — outer shell (sidebar + header + main)
- `ERPSidebar` — navigation sidebar
- `ERPTopHeader` — top header bar
- `ERPPageLayout` — page content wrapper (padding, max-width)
- `ERPPageHeader` — title + actions header
- `ERPBreadcrumb` — breadcrumb trail
- `ERPStickyFooter` — form save footer

### Data Display
- `ERPDataGrid` — full-featured table
- `ERPDataGridSkeleton` — loading state for data grid
- `ERPStatCard` — KPI summary card
- `ERPStatusBadge` — colored status pill
- `ERPTag` — inline tag/label
- `ERPAvatar` — user/entity avatar
- `ERPEmptyState` — no-data / error / permission states
- `ERPTimeline` — activity feed / audit log
- `ERPChart` — wrapper around recharts

### Navigation
- `ERPCommandPalette` — Ctrl+K overlay
- `ERPBreadcrumb` — already listed

### Forms
- `ERPForm` — form wrapper (handles React Hook Form context)
- `ERPFormSection` — titled card section within a form
- `ERPFormGrid` — 12-column grid inside a section
- `ERPInput` — text / number / email / tel input
- `ERPTextarea` — multi-line text
- `ERPSelect` — dropdown selection
- `ERPAsyncSelect` — API-backed search select
- `ERPDatePicker` — date input with calendar
- `ERPDateRangePicker` — date range selection
- `ERPCurrencyInput` — formatted Indian currency input
- `ERPGSTINInput` — GSTIN-validated input
- `ERPPhoneInput` — phone with country code
- `ERPFileUpload` — drag-drop file upload
- `ERPSwitch` — toggle boolean
- `ERPCheckbox` — single checkbox
- `ERPCheckboxGroup` — list of checkboxes
- `ERPRadioGroup` — mutually exclusive radio group
- `ERPRichText` — Tiptap rich text editor
- `ERPOTPInput` — 6-digit OTP
- `ERPBarcodeInput` — barcode scanner input

### Actions
- `ERPButton` — all button variants
- `ERPButtonGroup` — joined button group
- `ERPDropdownMenu` — ··· menu
- `ERPSplitButton` — action + dropdown

### Feedback
- `ERPToast` — toast wrapper (via sonner)
- `ERPConfirmModal` — confirmation modal
- `ERPModal` — generic modal shell
- `ERPDrawer` — side panel drawer
- `ERPWizard` — multi-step wizard shell
- `ERPInlineAlert` — page-level inline alert banner

### Filter
- `ERPToolbar` — search + quick filters + options
- `ERPFilterChips` — active filter chip list
- `ERPFilterDrawer` — advanced filter side panel
- `ERPPagination` — page navigation

### Permission
- `PermissionGate` — conditional render by permission

---

## PART 36 — DEVIATION AUDIT CHECKLIST

Use this checklist to audit every existing screen against this design system. Mark each item as ✅ Pass, ❌ Fail, or ⚠️ Partial.

### Layout Compliance
- [ ] Uses `ERPAppShell` / `AppLayout` — not a custom layout
- [ ] Header is `ERPPageHeader` component
- [ ] Breadcrumb is rendered in the top header
- [ ] Page actions are right-aligned in the page header
- [ ] "New" button is always the rightmost action, `variant="primary"`
- [ ] Form pages have sticky footer save bar
- [ ] No hardcoded `px-6 py-6` directly on page — uses `ERPPageLayout`

### Icon Compliance
- [ ] No emoji used as icons
- [ ] All icons from `lucide-react`
- [ ] All icon buttons have `aria-label` or `title`
- [ ] Icon sizes match the standard size table

### Color Compliance
- [ ] No hardcoded `indigo-*`, `blue-*`, `green-*`, `red-*` classes in component code
- [ ] All colors via CSS token classes
- [ ] Status colors use `ERPStatusBadge`, not custom spans
- [ ] No inline `style={{ color: '...' }}`

### Typography Compliance
- [ ] No hardcoded font sizes (`text-2xl` etc. only from the type scale)
- [ ] Currency values right-aligned in tables
- [ ] Monospace font for IDs, codes, amounts
- [ ] No missing labels on form fields

### Table Compliance
- [ ] Uses `ERPDataGrid`, not custom `<table>`
- [ ] Has skeleton loading state
- [ ] Has empty state
- [ ] Row actions in sticky right column with `···` menu
- [ ] Pagination present
- [ ] Column headers sortable (where applicable)

### Form Compliance
- [ ] Uses `ERPForm` wrapper
- [ ] Uses `ERPFormSection` for grouping
- [ ] All fields are ERP form components (no raw `<input>`)
- [ ] Required fields marked with `*`
- [ ] Shows field-level validation errors
- [ ] Has sticky footer or visible save/cancel buttons
- [ ] Cancel shows confirmation dialog when form is dirty

### Accessibility
- [ ] All form fields have labels
- [ ] All icon buttons have `aria-label`
- [ ] Modals have `role="dialog"` and proper ARIA attributes
- [ ] Focus trapped in modals
- [ ] Status badges convey meaning via text, not only color

### Performance
- [ ] Module is lazy loaded
- [ ] List page shows skeleton, not spinner
- [ ] Data fetched via TanStack Query
- [ ] Table with > 100 rows uses virtual scrolling

---

## PART 37 — CURRENT DEVIATION REGISTER

All deviations found in Phase 2–4 frontend code as of 2026-06-30. Each must be corrected before Phase 5 frontend begins.

> **Resolved 2026-07-05:** D-004 and D-033 (no command palette / global search) — `ERPCommandPalette` is now
> built per the Part 22 spec and wired into `Layout.tsx` behind `Ctrl+K`/`Cmd+K`, gated on `SEARCH_GLOBAL`.
> See `ERP-PLANNING/phase-completions/GLOBAL-SEARCH_COMPLETION.md`.

### Critical (blocks new module development)

| ID | File | Deviation | Fix Required |
|----|------|-----------|-------------|
| D-001 | `Layout.tsx` | Emoji used as navigation icons (⊞, ⚙, 📦, 🛒, 📊) | Replace with Lucide icons from icon mapping table |
| D-002 | `Layout.tsx` | Hardcoded `indigo-600` primary color | Replace with `bg-primary` CSS token class |
| D-003 | `Layout.tsx` | No breadcrumb rendered | Add `ERPBreadcrumb` to top header |
| D-004 | `Layout.tsx` | No top header global search / command palette | Add `ERPCommandPalette` and `Ctrl+K` handler |
| D-005 | `Layout.tsx` | ThemeContext logic duplicated in Layout (localStorage read, class toggle) | Remove from Layout; use ThemeProvider from context only |
| D-006 | `Button.tsx` | Missing `outline`, `danger-outline`, `link` variants | Add per variant table in Part 16 |
| D-007 | `DataTable.tsx` | No sorting, no pagination, no bulk actions, no skeleton, no footer totals | Rebuild as `ERPDataGrid` per Part 13 |
| D-008 | `PageHeader.tsx` | Does not accept `icon`, `breadcrumb`, entity status, or standardized action list | Rebuild as `ERPPageHeader` per Part 10 |
| D-009 | All page files | No breadcrumb definition per page | Each page must pass breadcrumb items to layout |
| D-010 | All page files | Raw `<table>` / `<input>` / `<button>` elements used directly | Replace with ERP component equivalents |

### High (fix before phase-end)

| ID | File | Deviation | Fix Required |
|----|------|-----------|-------------|
| D-011 | `Input.tsx` | Missing `prefix`, `suffix`, `clearable`, `showCount` props | Add props per Part 15.1 |
| D-012 | `Select.tsx` | Not searchable, no async option, no multi-select | Rebuild or replace with ERPSelect per Part 15.3 |
| D-013 | `InvoiceFormPage.tsx` | No sticky footer save bar | Add ERPStickyFooter |
| D-014 | `InvoiceFormPage.tsx` | No dirty state tracking / unsaved changes warning | Add React Hook Form isDirty + beforeunload |
| D-015 | All list pages | No filter toolbar (only search input in some) | Add ERPToolbar + ERPFilterChips |
| D-016 | All list pages | No summary/KPI cards | Add ERPStatCard row where meaningful data exists |
| D-017 | `CustomersPage.tsx` | Import / Export buttons not implemented | Wire to `useExport` hook and import API |
| D-018 | All pages | Empty state is plain text only | Replace with `ERPEmptyState` component |
| D-019 | All pages | Loading state is text "Loading…" only | Replace with `ERPDataGridSkeleton` |
| D-020 | `Badge.tsx` | Colors hardcoded per status string inline | Route through `ERPStatusBadge` with semantic map |

### Medium (fix in next refactor sprint)

| ID | File | Deviation | Fix Required |
|----|------|-----------|-------------|
| D-021 | `Layout.tsx` | Sidebar has no recent pages section | Add `useRecentPages` hook and section |
| D-022 | `Layout.tsx` | No quick-create button in header | Add `ERPQuickCreateMenu` |
| D-023 | `Layout.tsx` | No notification bell | Add `ERPNotificationBell` |
| D-024 | All form pages | Form sections not in card containers | Wrap in `ERPFormSection` |
| D-025 | All pages | No keyboard shortcut hints visible | Add shortcut labels to buttons and sidebar |
| D-026 | All pages | Missing ARIA labels on icon-only buttons | Add `aria-label` to all icon buttons |
| D-027 | All tables | No column chooser | Add column visibility control to ERPDataGrid |
| D-028 | All tables | No density toggle | Add density toggle to ERPDataGrid toolbar |
| D-029 | All tables | No saved views | Add saved views system |
| D-030 | Router | Modules not lazy loaded | Wrap each module with `lazy()` |

### Low (backlog)

| ID | File | Deviation | Fix Required |
|----|------|-----------|-------------|
| D-031 | Global | No design tokens CSS file | Create `src/styles/tokens.css` |
| D-032 | Global | No `TenantThemeProvider` | Implement runtime tenant theme injection |
| D-033 | Global | No command palette | Implement `ERPCommandPalette` |
| D-034 | Global | No keyboard shortcut reference overlay | Implement `?` shortcut overlay |
| D-035 | Global | No `Inter` font self-hosting | Add `@fontsource/inter` |
| D-036 | Dashboard | KPI cards not clickable to drill down | Add `onClick` navigation |
| D-037 | Dashboard | No personalization / widget reorder | Implement drag-to-reorder |
| D-038 | Global | Responsive breakpoints not tested below 1024px | Add responsive CSS |

---

## PART 38 — PHASED REFACTORING ROADMAP

Execute this roadmap BEFORE starting Phase 5 module development. Each milestone must pass the deviation audit checklist before the next begins.

### Milestone R.1 — Design Token Foundation (Priority: CRITICAL, Est: 1 session)

1. Create `apps/web-frontend/src/styles/tokens.css` with all tokens from Part 2
2. Update `src/index.css` to import tokens
3. Configure `@custom-variant dark` (already done — verify it still works)
4. Remove all `indigo-*`, `gray-*` hardcoded color usages from `Layout.tsx`, `Button.tsx`, `Input.tsx` — replace with token-based classes
5. Add `@fontsource/inter` and update font stack

**Done when:** `grep -r "indigo-" src/components` returns 0 results.

### Milestone R.2 — Icon System Migration (Priority: CRITICAL, Est: 0.5 sessions)

1. Install `lucide-react` (if not present)
2. Replace all emoji icons in `Layout.tsx` navigation with Lucide icons per mapping table
3. Replace all emoji/text icons in page files with Lucide icons
4. Add `title` attributes to all icon-only buttons

**Done when:** `grep -r "className=\"text-base shrink-0\">{item.icon}" src/` returns 0 results.

### Milestone R.3 — Core Component Rebuild (Priority: CRITICAL, Est: 2–3 sessions)

Build the following components (in order):

1. `ERPButton` — all variants, all sizes, loading state
2. `ERPInput` — all props from Part 15.1
3. `ERPSelect` — searchable, multi-select, async
4. `ERPStatusBadge` — full status color map
5. `ERPEmptyState` — all 6 types
6. `ERPDataGridSkeleton` — configurable columns × rows
7. `ERPPageHeader` — list and detail variants
8. `ERPBreadcrumb` — with auto-truncation
9. `ERPStatCard` — with trend indicators
10. `ERPToolbar` — search + filters + options
11. `ERPFilterChips` — active filter display
12. `ERPConfirmModal` — standardized confirmation
13. `ERPStickyFooter` — form save bar
14. `ERPDataGrid` — full table with sort, skeleton, empty state, row actions, pagination

**Done when:** All components exist and have basic usage in at least one page.

### Milestone R.4 — Layout Rebuild (Priority: CRITICAL, Est: 1 session)

1. Rebuild `Layout.tsx` as `AppLayout.tsx`:
   - Remove duplicated ThemeContext logic
   - Replace emoji icons with Lucide
   - Add `ERPBreadcrumb` in top header (passed from child pages via outlet context or React Router's `useMatches`)
   - Add global search input (wired to command palette)
   - Add notification bell (stub with counter)
   - Add quick-create dropdown (stub)
   - Implement module groups in sidebar per navigation standard
2. Add `ERPCommandPalette` component (even as stub that navigates to pages)

**Done when:** Every page shows breadcrumb, sidebar uses Lucide icons, no emoji anywhere in chrome.

### Milestone R.5 — Page-by-Page Migration (Priority: HIGH, Est: 2–3 sessions)

For each existing page (51 `.tsx` files), apply:
1. Wrap in `ERPPageLayout`
2. Replace `<PageHeader>` with `<ERPPageHeader>`
3. Replace `<DataTable>` with `<ERPDataGrid>`
4. Add `<ERPStatCard>` row (where applicable)
5. Add `<ERPToolbar>` with search
6. Add `<ERPEmptyState>` and `<ERPDataGridSkeleton>`
7. Add breadcrumb metadata to each page
8. Replace raw form elements with ERP form components

Pages in priority order:
1. `InvoicesPage.tsx` (most used)
2. `InvoiceFormPage.tsx`
3. `InvoiceDetailPage.tsx`
4. `CustomersPage.tsx`
5. `CustomerFormPage.tsx`
6. `ItemsPage.tsx`
7. `ItemFormPage.tsx`
8. All remaining pages

**Done when:** Deviation audit checklist passes for all Critical and High items.

### Milestone R.6 — Performance and Accessibility (Priority: MEDIUM, Est: 1 session)

1. Add `lazy()` to all module routers
2. Add `<ErrorBoundary>` to each module
3. Run Lighthouse audit — fix all accessibility violations
4. Add `aria-label` to all icon buttons
5. Add `role="dialog"` and ARIA to all modals
6. Test tab order in 5 representative forms
7. Test keyboard navigation in DataGrid

**Done when:** Lighthouse accessibility score ≥ 90 on all main pages.

### Milestone R.7 — Design System Verification (Priority: MEDIUM, Est: 0.5 sessions)

1. Run full deviation audit against all 51 pages
2. All Critical deviations: 0 remaining
3. All High deviations: 0 remaining
4. Medium deviations: documented with target milestone
5. Update this document with any new standards discovered during the refactor

**Done when:** Deviation register shows 0 Critical, 0 High items.

---

## PART 39 — GOVERNANCE

### 39.1 How to Add New Patterns

1. Identify the new pattern needed (e.g., a timeline component, a wizard step, a new table feature)
2. Check if an existing component can be extended
3. Write the specification in this document (add a new sub-section)
4. Build the component in `packages/shared-ui`
5. Update the component catalog in Part 35
6. Update the deviation audit checklist in Part 36

### 39.2 How to Override This Standard

You cannot. If a specific business requirement demands deviation from this standard, the deviation must be:
1. Documented as an exception in the relevant section of this document
2. Reviewed and approved via PR comment
3. Generalized if the exception is needed in more than 1 place

### 39.3 Code Review Gate

Every PR that touches frontend code must pass this checklist before merge:
- [ ] No emoji icons
- [ ] No hardcoded color values
- [ ] No raw `<input>`, `<button>`, `<table>` elements in page-level code
- [ ] All new pages use `ERPPageHeader`, `ERPBreadcrumb`, `ERPDataGrid`
- [ ] All new forms use ERP form components with validation
- [ ] New components are in the correct folder per Part 32
- [ ] New components added to the catalog in Part 35

---

*This document is the single source of truth for all frontend decisions in the NEXORAA ERP platform. Last updated: 2026-06-30. When in doubt, refer here first.*
