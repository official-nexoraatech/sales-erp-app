# @erp/ui — Input & Form Design System

The shared input/form component library for the entire ERP (web-frontend: POS-adjacent
back-office, Inventory, CRM, Purchase, Sales, Manufacturing, Accounting, HR; and pos-frontend:
the cashier app). One visual language, one component API, both apps.

## Rationale

Enterprise SaaS products that feel "expensive" (Stripe, Linear, Shopify Admin, Vercel) share a
few concrete traits, not just a color palette:

- **One radius, everywhere.** No mix of `rounded-md`/`rounded-lg`/`rounded-full` per component.
  Every control here uses `rounded-xl` (→ `--radius-xl`, ~12px, tenant sharp/rounded scale still
  applies on top).
- **A focus state that's a treatment, not a browser default.** A crisp border-color change plus
  a soft, colored diffusion (`--shadow-focus`) — not the default blue outline, not just `ring-2`.
- **Restraint in elevation.** Resting state has no shadow; only floating surfaces (dropdowns,
  the search command palette) get `shadow-token-lg`. Depth communicates layering, not decoration.
- **Density without cramping.** Generous horizontal padding always; vertical rhythm comes from
  the height scale (`sm`/`md`/`lg`/`xl`), not from squeezing padding.

## Tokens

All values live in `packages/design-tokens/tokens.css` (imported by both apps as
`@erp/design-tokens/tokens.css`) — this package's components read them, never hardcode a color.

| Token                                                    | Purpose                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--input-height-sm/md/lg/xl`                             | 32 / 40 / 48 / 56px — the only heights any input-family control uses. `xl` is POS's hero search/quantity size. |
| `--radius-xl`                                            | ~12px, scaled by the tenant sharp/rounded radius preset (`[data-radius-scale]`)                                |
| `--shadow-focus`, `--shadow-focus-error/success/warning` | crisp border + soft `color-mix` glow, one per semantic state                                                   |
| `--border-default/strong/focus/error`                    | resting / hover / focus / error border colors                                                                  |
| `--surface-card/subtle/raised/overlay`                   | fill colors (default / filled variant / hover / floating panels)                                               |
| `--duration-fast/normal/slow`, `--ease-*`                | all transitions (150ms `ease-out` by default)                                                                  |

Dark mode (`.dark`) and high-contrast mode (`.hc`) are handled entirely by the token layer —
no component in this package has dark-mode-specific code. Reduced-motion is handled the same
way (`--duration-*` collapses to `0ms` under `prefers-reduced-motion` or `[data-motion='none']`).

## Component API

Every input-family component shares the same `size`/`variant` vocabulary via `inputVariants`
(`packages/ui/src/inputVariants.ts`):

```tsx
<Input
  size="sm | md | lg | xl"          // default md
  variant="default | filled | ghost | outline"
  label="Customer name"
  error="Required"                  // or success / warning
  leftIcon={<Search size={16} />}
  loading
  clearable
  onClear={() => ...}
/>
```

`Button` follows the same shape (`variant`, `size`, `loading`), and exports its underlying
`buttonVariants` recipe so app-specific button variants (see POS below) can extend the same
color language without re-implementing it.

### Components in this package

| Component                 | Notes                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Input`                   | The base text input. Backward-compatible `label/error/hint/wrapperClassName/rightElement` props plus new `size/variant/leftIcon/loading/clearable/prefix`.                                                                                                                        |
| `Textarea`                | Same visual language, `showCount`+`maxLength` for a character counter.                                                                                                                                                                                                            |
| `Select`                  | A **restyled native `<select>`**, not a custom listbox — see "Why Select isn't a custom dropdown" below.                                                                                                                                                                          |
| `Combobox`                | The real searchable/checkmarked/floating-panel dropdown. Sync (`options`) or async (`loadOptions`) mode; `multiple` for multi-select. This is what "Autocomplete / Customer Search / Product Search" mean in practice — pass a `loadOptions` that calls the customer/product API. |
| `SearchInput`             | The hero component. Search icon, clear button, optional `shortcut` kbd chip, optional `onBarcodeClick` scan button. `size="xl"` is POS's large search/scan box — same component, not a fork.                                                                                      |
| `NumberInput`             | Quantity: large centered value, +/- steppers, clamped to `[min, max]`.                                                                                                                                                                                                            |
| `CurrencyInput`           | ₹-prefixed, right-aligned, decimals/negatives via `useControlledNumericText`.                                                                                                                                                                                                     |
| `DiscountInput`           | %-suffixed sibling of `CurrencyInput`, clamps to `max` (default 100).                                                                                                                                                                                                             |
| `BarcodeInput`            | Monospace, select-all-on-focus (a re-scan overwrites instead of appending).                                                                                                                                                                                                       |
| `PasswordInput`           | `Input` + a visibility-toggle `rightIcon`.                                                                                                                                                                                                                                        |
| `DateInput` / `TimeInput` | Styled native `<input type="date"/"time">` — see scope note below.                                                                                                                                                                                                                |
| `DateRangeInput`          | Two `DateInput`s + 7D/30D/90D preset chips (replaces `ERPDateRangePicker`).                                                                                                                                                                                                       |
| `Checkbox`                | Net new. Supports `indeterminate` (for "some rows selected" bulk-action headers).                                                                                                                                                                                                 |
| `Radio`                   | Net new.                                                                                                                                                                                                                                                                          |
| `Switch`                  | Same track/thumb toggle as before, now with a visible keyboard focus ring.                                                                                                                                                                                                        |
| `Button`                  | Same variants as before (`primary/secondary/danger/ghost/outline/danger-outline/link`) plus `success`, CVA-ified, `rounded-xl`, focus-glow.                                                                                                                                       |

### Why `Select` isn't a custom dropdown

This app binds most `<Select>` usages via `react-hook-form`'s `{...register('field')}`, which
needs a real, form-associated `<select>` DOM node — a `div`-based listbox would silently break
every one of those call sites (uncontrolled value tracking, no native change events). So `Select`
restyles the native element (custom chevron, radius, focus-glow, size scale) instead of replacing
it. For a fully custom dropdown — floating panel, checkmarks, keyboard-navigable, no native
browser chrome — use `Combobox`.

### Deliberate scope cuts

- **No custom calendar-grid date picker.** No date-picker library is installed in this repo;
  `DateInput`/`TimeInput`/`DateRangeInput` restyle the native controls, which already give
  correct keyboard entry, locale formatting, and accessibility for free. A custom calendar
  widget is a reasonable follow-up, not part of this pass.
- **No separate "Email Input" / "Phone Input" components.** They're `Input` presets
  (`type="email"` / `type="tel"` + an icon) — see examples below.

## Migration

Nothing at any existing call site had to change. `apps/web-frontend/src/components/ui/{Input,
Select,Button,PasswordInput}.tsx` (the components actually used across ~60/~55/~90 call sites)
are now one-line re-exports of this package. The same is true for the low-adoption
`apps/web-frontend/src/components/erp/{ERPInput,ERPSelect,ERPTextarea,ERPAsyncSelect,
ERPSwitch}.tsx`. `pos-frontend`'s `POSInput`/`POSSearch`/`POSButton` are now thin wrappers over
`Input`/`SearchInput`/`buttonVariants` instead of a parallel, hand-rolled visual system —
POS keeps its own touch-target-aware size scale (≥44px per
`ERP-PLANNING`'s POS touch-target rule) layered on top of the shared color/radius/focus classes.

Both apps' Tailwind entry (`src/index.css`) adds `@source "../../../packages/ui/src"` — Tailwind
v4's automatic class-name scanner only walks each app's own directory, so the shared package's
class names need to be added as an explicit extra source.

## Examples

**POS search/scan box** (`pos-frontend`'s `POSSearch.tsx`):

```tsx
<SearchInput
  ref={barcodeRef}
  size="xl"
  placeholder="Scan barcode or type item name…"
  onBarcodeClick={onToggleCamera}
  barcodeActive={cameraOpen}
/>
```

**Customer search** (generic `Combobox` in async mode):

```tsx
<Combobox
  label="Customer"
  placeholder="Type to search customers…"
  loadOptions={(q) => customerApi.search(q).then((r) => r.content)}
  value={selectedCustomer}
  onChange={setSelectedCustomer}
/>
```

**Product search with a custom row** (image/SKU/stock instead of the default label/sublabel):

```tsx
<Combobox
  label="Product"
  loadOptions={loadProducts}
  value={product}
  onChange={setProduct}
  renderOption={(p) => (
    <div className="flex items-center justify-between">
      <span>{p.label}</span>
      <span className="text-xs text-secondary">{p.sublabel}</span>
    </div>
  )}
/>
```

**Barcode field:**

```tsx
<BarcodeInput label="Barcode" value={code} onChange={(e) => setCode(e.target.value)} />
```

**Quantity stepper:**

```tsx
<NumberInput label="Qty" value={qty} onChange={setQty} min={1} max={stock} />
```

**Discount + currency in a line-item row:**

```tsx
<CurrencyInput label="Rate" value={rate} onChange={setRate} />
<DiscountInput label="Discount" value={discountPct} onChange={setDiscountPct} />
```

**Email / phone (presets, not separate components):**

```tsx
<Input type="email" label="Email" leftIcon={<Mail size={16} />} {...register('email')} />
<Input type="tel" label="Phone" leftIcon={<Phone size={16} />} {...register('phone')} />
```

**A filter bar** (compact size, `Select` + `DateRangeInput`):

```tsx
<div className="flex items-center gap-2">
  <Select size="sm" options={statusOptions} value={status} onChange={...} />
  <DateRangeInput size="sm" value={range} onChange={setRange} />
</div>
```

**A dialog form** — same components, no special-casing:

```tsx
<ERPFormSection title="New Cost Center">
  <Input label="Code" required {...register('code')} error={errors.code?.message} />
  <Input label="Name" required {...register('name')} error={errors.name?.message} />
  <Checkbox label="Active" {...register('isActive')} />
</ERPFormSection>
```

**A table's bulk-select header checkbox:**

```tsx
<Checkbox
  indeterminate={selectedCount > 0 && selectedCount < rows.length}
  checked={selectedCount === rows.length}
  onChange={(e) => toggleAll(e.target.checked)}
/>
```

**Mobile** — the same components at `size="lg"` give a ≥48px touch target without a separate
mobile variant; density is a token (`[data-density]`), not a prop any of these components take.

## Accessibility

- Every control links its label via `htmlFor`/`id` (auto-generated with `useId` when no `id` is
  passed) and wires `aria-invalid`/`aria-describedby` to its error/hint text.
- `Combobox` implements the same `role="combobox"` + `aria-activedescendant` + `role="listbox"`
  pattern the pre-existing `ERPAsyncSelect` already proved out — no new a11y pattern introduced.
- Focus is always visible: every focusable element gets `--shadow-focus` (or the semantic
  error/success/warning variant), never `outline: none` with nothing to replace it.
- `Checkbox`'s indeterminate visual state is driven by the real DOM `.indeterminate` property
  (set via `ref`) and the CSS `:indeterminate` pseudo-class, not a fake prop.
- See `apps/web-frontend/src/components/erp/__tests__/erp-ui-inputs.test.tsx` for axe-core
  passes on `Input`/`Select` in their default, error, and disabled states.
