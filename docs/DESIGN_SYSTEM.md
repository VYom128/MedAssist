# MedAssist design system

Calm, card-first UI for a clinic: one indigo anchor colour, soft status tints, generous whitespace,
restrained motion. Every screen in later phases uses these tokens and components; don't add
one-off colours, radii or hand-rolled buttons, inputs, dialogs or tables.

- Tokens: `client/src/index.css` (`@theme`, Tailwind v4 — there is no `tailwind.config.js`)
- Components: `client/src/components/ui/`
- Shell: `client/src/layouts/` (Sidebar, TopBar, MobileNav, UserMenu, AuthLayout)
- Headless UI (`@headlessui/react`) for Dialog, Menu and Switch; icons from `lucide-react`

## 1. Tokens

### Colour

| Token (utility) | Value | Use |
|---|---|---|
| `canvas` | #F6F7FB | Page background |
| `surface` / `surface-muted` | #FFFFFF / #F9FAFC | Cards / table headers, footers, hover |
| `line` / `line-strong` | #E6E8F0 / #D5D9E4 | Card borders and dividers (decorative only) |
| `line-control` | #8A93A6 | Input, select and switch outlines (3.09:1, WCAG 1.4.11) |
| `ink` | #0F1B3D | Headings, key values |
| `body` | #1E293B | Body text |
| `muted` / `subtle` | #5B6478 / #6B7385 | Secondary text / placeholders, inactive icons |
| `primary-50…900` | #EEF0FD … #2B3175 | Brand. `600` #4F5BD5 buttons and links, `700` #3F49B8 active text, `400` #7C86F0 charts and decoration only |
| `info` · `success` · `warning` · `consult` · `danger` · `neutral` | 50 / 100 / 500 / 700 | Status tones: 50 background, 100 ring, 500 dot, 700 text (`danger-600` for filled danger buttons) |

`brand-*` still works as an alias of `primary-*` until the last page is migrated; don't use it in
new code.

**Contrast (WCAG AA, 4.5:1 for text)** — every pair below passes:

| Pair | Ratio |
|---|---|
| ink on surface / canvas | 16.87 / 15.76 |
| body on surface / canvas | 14.63 / 13.66 |
| muted on surface / canvas / surface-muted | 5.93 / 5.54 / 5.68 |
| subtle on surface | 4.76 |
| white on primary-600 / primary-700 | 5.54 / 7.35 |
| primary-600 on surface / canvas | 5.54 / 5.18 |
| primary-700 on primary-50 / primary-100 | 6.48 / 5.79 |
| info-700 on info-50 | 6.12 |
| success-700 on success-50 | 5.14 |
| warning-700 on warning-50 | 5.64 |
| consult-700 on consult-50 | 6.69 |
| danger-700 on danger-50 / surface | 5.68 / 6.29 |
| white on danger-600 | 4.97 |
| neutral-700 on neutral-50 | 8.39 |
| white on ink (tooltips) | 16.87 |
| line-control on surface (non-text) | 3.09 |

`line` and `line-strong` (1.22 / 1.41) are never the only way to see a control.

### Type — Plus Jakarta Sans (self-hosted, `@fontsource-variable/plus-jakarta-sans`)

| Utility | Size / line | Weight | Use |
|---|---|---|---|
| `text-page` | 24/32 (28/36 from `lg`) | 700 | Page title (`PageHeader`, the page's only h1) |
| `text-section` | 18/28 | 600 | Section and dialog titles |
| `text-card` | 16/24 | 600 | Card titles |
| `text-sm` | 14/20 | 400–600 | Body, labels, table cells |
| `text-caption` | 12/16, +0.04em | 600 | Table headers, eyebrows (uppercase) |
| `text-stat` | 28/34 | 700 | Big numbers in `StatCard` |

Add `tabular` to anything with digits that should line up: money, times, MRNs, tokens, counts.

### Shape, elevation, spacing

- Radius: `rounded-card` 20px (cards, dialogs, sheets), `rounded-control` 12px (inputs, buttons,
  nav items), `rounded-full` (pills, avatars).
- Borders: 1px `line`. Shadows: `shadow-card` (resting), `shadow-card-hover` (clickable cards on
  hover), `shadow-overlay` (dialogs, menus, tooltips only). No heavy shadows, no gradients.
- Spacing: card padding 20px (`p-5`, `lg:p-6`); grid gaps 16px (`gap-4`, `lg:gap-6` for large
  cards); page gutters 16 / 24 / 32px (`px-4 sm:px-6 xl:px-8`, set by `AppLayout`); stacked cards
  24px apart (`space-y-6`); major page sections (e.g. dashboard rows) 32px apart (`space-y-8`).
- Page widths: lists, dashboards and the audit log use the full content width (`max-w-content`,
  1280px, set by `AppLayout`); record/detail pages `max-w-5xl`; forms and account pages
  `max-w-form` (768px) or narrower.

### Motion

Calm, fast, clinical: motion confirms an action or shows where something came from; it never
decorates. Tailwind transitions, CSS keyframes and Headless UI `transition` only.

| What | How | Duration |
|---|---|---|
| Hover / press | colour transitions; buttons and chips `active:scale-[0.98]` | 150ms |
| Clickable cards (`QuickLinkCard`, `StatCard to`) | `-translate-y-0.5` (2px) + `shadow-card-hover` | 150ms |
| Menus, tabs, sidebar pill | menus fade + 4px (`data-closed:-translate-y-1`); tab panel fades in on switch | 200ms |
| Modals | opacity + scale 0.98→1 from `sm`; on phones a bottom sheet sliding up (`translate-y-full`); the mobile menu sheet too | 250ms in, 200ms out |
| Route change | one 8px fade-up of the page container (`layouts/usePageTransition.ts`, Web Animations API — no remount); query-string changes don't animate | 250ms |
| Dashboard cards | `animate-fade-up` with a 40ms stagger, first dashboard visit per page load only | 250ms |
| Sidebar collapse | width transition | 250ms |
| Toasts | react-hot-toast's slide-in, themed by `TOAST_OPTIONS` (respects reduced motion itself) | — |
| Loading | `Skeleton` shimmer — the only looping animation (the button spinner only spins with motion allowed) | 1.4s loop |

Easing is always `ease-standard` (cubic-bezier(0.2, 0, 0, 1)). Everything is behind `motion-safe:`;
the global `prefers-reduced-motion` rule turns CSS durations to ~0 and `usePageTransition` skips
the route animation. Don't add page-level `animate-fade-up` to headers or cards — the container
already animates.

## 2. Components (`components/ui`)

| Component | Notes |
|---|---|
| `Button` | `variant`: primary, secondary, ghost, danger, soft, softDanger. `size`: md (44px, default), sm (44px on phones, 36px from 768px). `loading` shows a spinner and disables. One primary button per area. |
| `Input`, `Select`, `Textarea`, `PasswordInput`, `MoneyInput`, `TimeInput`, `TagInput`, `SearchableSelect` | Labelled, 44px, `line-control` outline, primary focus ring, red ring + icon + message on error. `reserveMessage` keeps a line for the error on short forms (no layout jump). Server field errors (`error.details`) arrive through `applyServerFieldErrors`. |
| `FormField` | Label + control + hint/error with the ARIA ids wired; use for custom controls. |
| `Card` | Plain white card with optional title + actions. |
| `FormSection` | Titled group of fields inside a dialog or form (legend + description); lighter than `SectionCard`. |
| `Code` | Mono chip for codes and identifiers (service/lab codes, MRN). |
| `buttonClass(variant, size)` | Button look for a `Link` (e.g. "Add lab test"). |
| `linkClass` | Inline text link (primary, underline on hover, focus ring). |
| `BackLink` | "‹ Patients" link above a title; `PageHeader back` uses it. |
| `RecordHeader` | Header card of a record page (§6): `name`, `title`, `meta`, `pills`, `actions`, children (e.g. allergies). |
| `SectionCard` | Titled block: `title`, `description`, `icon`, `actions`, `footer` (save area). Forms: wrap the `SectionCard` in the `<form>` so the footer's submit button is inside it. |
| `PageHeader` | `title` (h1), `description`, `actions`, `eyebrow`, `back`. Every page starts with one. |
| `StatCard` | One real number: `label`, `value`, `icon` + `tone`, `hint`, `trend` (`direction`, visible `label`, `sentiment`), `status` dot + text, `to` makes it a link. |
| `ChartCard` | Frame for a chart: `title`, `description`, `actions`, `loading` / `error` + `onRetry` / `empty`, `height`, and `summary` (text alternative; the chart is hidden from screen readers when given). |
| `QuickLinkCard` | Link card: icon chip, title, one-line description, optional `badge`. |
| `StatusPill` | `domain` + `status` from the central map (below). Icon + label, never colour alone. |
| `Badge` | Small label for non-status things (role, count). Tones: neutral, info, success, warning, danger, purple, primary; optional `icon` or `dot`. |
| `Avatar` | Initials, `sm`/`md`/`lg`/`xl`, tint picked from the name (never red). Decorative unless `labelled`. |
| `IconChip` | Line icon on a tinted square (`tone`, `size`). Decorative. |
| `DescriptionList` | Label/value grid for detail pages; empty values show "—". |
| `Table` | Table from 768px, cards below (spec §13.3). `renderExpanded` for details, `cardHeader` for a title row on phone cards (put `hideOnCard` on the column it repeats), `cardFooter` for row actions under the card. Row actions stay visible buttons (`size="sm"`), not a menu. |
| `FilterBar`, `FilterChip` | Filter card with "Clear filters"; `FilterChip` is an `aria-pressed` toggle with a check mark. |
| `Tabs` | WAI-ARIA tabs (arrow keys, Home/End). `variant`: underline (page sections), pills (settings). |
| `Modal`, `ConfirmDialog` | Headless UI Dialog: focus trap, Escape, outside click, scroll lock, sheet on phones, `variant="drawer"`. `ConfirmDialog tone="danger"` for anything that can't be undone — say what can't be undone. |
| `Switch` | Headless UI Switch (`role="switch"`), label + description; only the switch toggles. This is the "Toggle". |
| `Alert` | Inline message with an icon per tone (error = `role="alert"`). |
| `EmptyState`, `ErrorState`, `ListSkeleton`, `Skeleton` | Every list has all three states: skeleton while loading, empty with the next action, error with "Try again". |
| `Pagination` | "Showing 21–40 of 95" + previous/next. |

Theme helpers: `chartTheme.ts` (`CHART_COLORS`, `CHART_MUTED_FILL`, `CHART_THEME`) and
`toastTheme.ts` (`TOAST_OPTIONS`).

## 3. Status map

One map for the whole app: `components/ui/statusStyles.ts` (`STATUS_STYLES`). Keys are the values
the API returns; each entry has a tone, a label and an icon. Render with
`<StatusPill domain="appointment" status={appt.status} />`. Add new statuses there, never inline.

| Domain | Status → tone (icon) |
|---|---|
| `record` | active → success (check) · inactive → neutral (minus) |
| `account` | active → success · inactive → neutral · locked → warning (lock) |
| `portal` | none → neutral · invited → info (mail) · linked → success (link) · pending → warning (clock) |
| `auditOutcome` | success → success · denied → danger (shield) · failure → warning (triangle) |
| `booking` | accepting → info (calendar-check) · paused → warning (pause) |
| `leave` | leave / conference / other → info · emergency → danger (triangle) · cancelled → neutral (ban) |
| `appointment` (Phase 4) | scheduled → info/blue (calendar) · checked_in → warning/amber (user-check) · in_consultation → consult/violet (stethoscope) · completed → success/green (check) · cancelled → neutral/grey (ban) · no_show → danger/red (user-x) |
| `priority` | priority → warning (arrow-up) · emergency → danger (siren) · critical → danger (triangle) |

These keep the spec §13.3 meanings. "In consultation" is violet so it never looks like the indigo
brand colour.

## 4. Layout

- **Sidebar** (from routeConfig, never hard-coded): full width from 1280px, collapsible to icons
  (remembered per browser); icons only from 768px (tablets), with tooltips; below 768px a bottom
  sheet opened from the top bar.
- **Top bar**: current section, account menu. No search or bell until Phase 10.
- **Content**: `PageHeader`, then sections `space-y-8`. Phone first: one column at 360px, no
  horizontal scroll; grids go 1 → 2 (`sm`) → 3 (`lg`) → 4 (`2xl`).
- Print: the sidebar and top bar are hidden (`print:hidden`); `Table` always prints as a table
  (never the phone cards); printable documents are PDFs from the server (§12.3).

## 5. Dashboard patterns (for Phase 10)

The role dashboards (`features/dashboards`) are shells today: greeting `PageHeader` with the
clinic date (`TodayPill`), real cards, quick links built from routeConfig, and "Coming in later
phases". Phase 10 replaces the quick links and the "coming" card with widgets from spec §14:

```tsx
<section className="space-y-8">
  <PageHeader eyebrow="Admin dashboard" title={`Welcome, ${user.firstName}`} actions={<TodayPill />} />

  {/* KPI row: real numbers only */}
  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <li>
      <StatCard
        label="Appointments today"
        value={data.today.total}
        icon={CalendarClock}
        trend={{ direction: 'up', label: '+8% vs last week', sentiment: 'positive' }}
        to="/reception/appointments"
      />
    </li>
    …
  </ul>

  {/* Charts: 2/3 + 1/3 on desktop, stacked on phones */}
  <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
    <ChartCard
      className="lg:col-span-2"
      title="Revenue, last 30 days"
      loading={isLoading}
      error={error}
      onRetry={refetch}
      empty={data?.points.length === 0}
      summary={`Total ₹${…}; highest on ${…}.`}
    >
      {/* Recharts (ask before installing) using CHART_THEME / CHART_COLORS */}
    </ChartCard>
    <SectionCard title="Needs attention" actions={<Link to="…">See all</Link>}>…list…</SectionCard>
  </div>
</section>
```

Charts: one highlighted series in `primary-600`, the rest in `CHART_MUTED_FILL` or
`CHART_COLORS`; light horizontal grid, no axis lines, muted 12px ticks, rounded bar tops; values
in `tabular` figures; always a `summary` or a table next to the chart.

## 6. Record pages (patients, doctors, users)

- **Header card** (`RecordHeader`, with a `BackLink` above it): `Avatar size="xl"`, the name as the page's h1, identifiers as `Code` chips
  (MRN), a muted meta line (age · sex · blood group · phone), status pills, and the page's actions
  on the right. Patient allergies sit in the header: red box and red pills with an icon when there
  are any, a neutral box when none are recorded.
- **List filters**: search always visible; other filters in a panel toggled by a "Filters" button
  (a bottom sheet below 768px). Active filters show as removable chips under the search, next to
  "Clear filters". Results fade slightly while refetching.
- **Detail sections**: `SectionCard` + `DescriptionList`, two columns from `lg`.

## 7. Do / don't

- **Do** use `PageHeader` + `SectionCard`/`Card` on every page, and the three list states.
- **Do** show status with `StatusPill` (icon + text); show money with `formatINR` and dates with
  the clinic-timezone helpers in `utils/dates.ts`.
- **Do** keep one primary action per area; destructive actions use `danger` + `ConfirmDialog`.
- **Do** keep touch targets ≥ 44px below 768px (compact 36–40px controls only from `md`) and a
  visible focus ring on everything interactive.
- **Don't** invent numbers, charts or sample rows — a shell with links beats fake data.
- **Don't** use raw `slate-*`/`rose-*`/hex colours, new radii, heavy shadows or gradients.
- **Don't** hand-roll buttons, inputs, dialogs, menus or tables — extend `components/ui`.
- **Don't** add motion that isn't behind `motion-safe:`, or loops other than loading.
