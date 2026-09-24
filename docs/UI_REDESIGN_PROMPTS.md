# MedAssist UI redesign: Claude Code prompts (after Phase 3)

**Scope:** change the UI only. Backend, API endpoints, database, features, data flow and routes all stay exactly as they are.

**Current state:** Phases 0–3 are complete (setup, auth/RBAC, admin setup data, patients), and Phase 4 hasn't started. These prompts restyle only the screens that exist now. Appointments/queue, consult workspace, lab, billing, follow-ups, notifications and real dashboards come later, and each future phase uses the add-on at the end of this file so new screens are built in the new style.

**Why now is a good time:** the design system and app shell get set up before Phase 4. Every screen from here on starts in the new style, so nothing has to be redesigned twice.

---

## Before you start

1. **Commit Phase 3, then create a branch:** `git checkout -b ui-redesign`. If a step goes wrong, you can throw it away. Merge it into main before you start Phase 4.
2. **Put the screenshots in the repo** at `docs/design-reference/`, for example `01-overview.png`, `02-dashboard.png`, `03-patients.png`, `04-appointments.png`, `05-settings.png`, `06-messages.png`. Claude Code can only use images it can open. The appointments screenshot is used in Phase 4 and the messaging one in Phase 8.
3. **Status colours:** spec §13.3 sets scheduled blue, checked-in amber, in consultation purple, completed green, cancelled grey, no-show red. These prompts keep those meanings, use softer tints, and use **violet** for "in consultation" so it doesn't look like the indigo brand colour.
4. **After every prompt:** run `npm run dev` and click through each role's pages (the seed has one account per role). Then run `npm test` and `npm run lint`, and commit. Move on only when everything still works.
5. Paste **Prompt 0 at the start of every Claude Code session**, then give one prompt at a time.

---

## Prompt 0: Guardrails (start of every session)

```
UI REDESIGN CONSTRAINTS (MedAssist)

This is a UI-only redesign. Read CLAUDE.md first. The backend, features, database, API endpoints and data flow must stay exactly as they are.

DO NOT modify:
- anything in server/ (models, routes, controllers, services, policies, middleware, seed, tests)
- client/src/app/store.js and client/src/app/apiSlice.js (base query, auto-refresh, mutex)
- RTK Query endpoints in client/src/features/*/api.js (queries, mutations, tags, invalidation)
- Socket.IO connection/listeners, if any exist yet
- Redux slices (auth, etc.) — except adding purely visual state (sidebar collapsed, mobile menu open) to the ui slice
- client/src/routes/*: AppRoutes, ProtectedRoute, RoleRoute, routeConfig paths, lazy loading, role redirects
- Zod schemas (features/*/schemas.js) and react-hook-form validation rules
- client/src/constants/* (roles, statuses mirrored from the server)
- date/time (clinic timezone) and money (₹ from paise) formatting utilities
- .env files, package scripts, ESLint/Prettier config
- event handlers' logic: what a button does, what it sends, when it fires

You MAY modify:
- JSX structure and Tailwind classes in pages/, components/, layouts/
- client/src/components/ui/* (restyle or extend, keeping existing props working)
- tailwind.config.js, index.css / global CSS, fonts
- new purely presentational components (PageHeader, StatCard, SectionCard, StatusPill, Avatar, icons, skeletons, empty states)

Keep from the spec:
- WCAG AA contrast, visible focus, keyboard navigation, labelled inputs
- status never shown by colour alone (icon or text too)
- every list keeps loading skeleton, empty state and error state with retry
- confirmation dialogs on destructive/irreversible actions
- only show fields the API already returns for that role
- no fake/hard-coded data, no new features, no pages for later phases
- JavaScript only; no new npm dependency without asking me first

If a visual change seems to need a change in behaviour, data, API calls or routes: STOP and ask me.

Goal: SAME FEATURES + NEW LOOK + RESTRAINED MOTION + BETTER RESPONSIVE LAYOUT.
```

---

## Prompt 1: Audit and plan (no changes)

```
I'm redesigning the MedAssist frontend before starting Phase 4. Phases 0–3 are complete (setup, auth/RBAC/audit, admin setup data, patients). Visual reference screenshots are in docs/design-reference/ — open and study every image.

Do NOT modify any files in this step.

1. Inventory client/ and list every page that exists, grouped by role (admin, receptionist, doctor, labtech, patient) and public/auth. Mark each as complete or placeholder.
2. Report:
   - layouts (AuthLayout, AppLayout, PrintLayout), sidebar, top bar, mobile navigation
   - components/ui/* and where each is used; one-off styled buttons/inputs/tables/modals that duplicate them
   - Tailwind config, colours, fonts, spacing, radius, shadows in use
   - how status badges are coloured and whether there's one central map
   - Headless UI, Recharts, react-hot-toast usage (and whether react-big-calendar is installed yet)
   - existing animations
   - responsive behaviour (sidebar on mobile, tables below 768px)
   - visible accessibility gaps
3. Describe the reference screenshots' visual language: palette, type scale, spacing, radius, borders, shadows, icons, card anatomy, navigation, charts, motion.
4. Give me the plan:
   A. Current UI architecture
   B. Proposed UI architecture (same routes, same data flow)
   C. Design system (tokens + component specs)
   D. Components to restyle vs components needing layout changes
   E. New presentational components
   F. Animation strategy (CSS + Headless UI Transition, no new libraries)
   G. Responsive strategy (360px → desktop; tables → cards < 768px)
   H. Implementation order
   I. Risks: files where UI and logic are tangled, and how you'll change markup without touching logic
   J. Which new components Phase 4 will need (StatusPill for appointment statuses, card/list patterns) so the design system covers them from day one

References are for visual language only — an original MedAssist design, no copied names, assets or text.

WAIT FOR MY APPROVAL BEFORE MODIFYING ANY FILES.
```

---

## Prompt 2: Design system

```
Follow the UI redesign constraints. Plan approved. Build the MedAssist design system.

1. Tokens in tailwind.config.js (extend — don't remove classes pages still rely on until they're migrated):
   Colours
   - canvas (page background): cool off-white ~#F6F7FB
   - surface #FFFFFF, surface-muted ~#F9FAFC
   - border ~#E6E8F0, border-strong ~#D5D9E4
   - ink (headings) dark navy ~#0F1B3D, body ~#1E293B, muted ~#5B6478
   - primary indigo/periwinkle scale 50–900; buttons/links use primary-600 (~#4F5BD5) so white text passes AA; light periwinkle (~#7C86F0) only for charts, tints, decoration
   - status as soft pills (50 bg / 700 text / 500 dot):
       used now: active/inactive (users, departments, services, doctors, lab tests) → emerald / slate; locked account → amber; portal linked / pending verification → emerald / amber
       define now for Phase 4+, keeping spec §13.3 meanings: scheduled → blue · checked_in → amber · in_consultation → violet (distinct from primary) · completed → emerald · cancelled → slate · no_show → coral/red · emergency/critical → red + icon; priority → amber
   Check every text/background pair against WCAG AA and list the ratios.

   Typography: Inter or Plus Jakarta Sans self-hosted via @fontsource (ask before installing). Scale: page title, section title, card title, body, small, caption, big-number. tabular-nums for numbers, money, times, tokens.

   Shape: cards 20px radius, inputs/buttons 12px, pills full. 1px borders. shadow-card ≈ 0 1px 2px rgb(16 24 40 / .04); shadow-card-hover slightly stronger. No heavy shadows; minimal gradients.

   Spacing: card padding 20–24px, grid gaps 16–24px, page gutters 16px mobile / 32px desktop.

   Motion: 150 / 200 / 250ms, easing cubic-bezier(0.2,0,0,1), a fade-up keyframe; all motion behind motion-safe:.

2. Restyle components/ui/* without changing their props or behaviour:
   Button (primary, secondary, ghost, danger; sm/md; loading; disabled), Input / Select / Textarea (44px, clear focus ring, error text from Zod and server error.details), Badge → StatusPill driven by ONE central status→style map keyed by constants/, Modal / ConfirmDialog, Table (+ mobile card variant), EmptyState, Skeleton, Pagination, DateRangePicker, Tabs.
   Add: Card / SectionCard, PageHeader (title, description, actions), StatCard (icon chip, label, big number, optional trend, status dot), Avatar (initials fallback), Toggle (Headless UI Switch), FilterChip.

3. Theme react-hot-toast and Recharts (shared colour array, light grid, muted axes) to match.

4. Write docs/DESIGN_SYSTEM.md (tokens, components, status map, do/don't) and add a "UI conventions" section to CLAUDE.md saying every new screen in later phases must use these tokens and components.

Show me the token values and component list before changing anything outside components/ui and tailwind.config.js.
```

---

## Prompt 3: App shell (layouts, sidebar, top bar)

```
Follow the UI redesign constraints. Redesign AppLayout and AuthLayout. The role menus' items, paths, RoleRoute checks and lazy loading stay exactly as they are — only presentation changes.

SIDEBAR (one component, driven by the existing role menu config):
- white surface, 1px right border, MedAssist wordmark
- line icons (use the icon set already installed; ask before adding one), muted inactive items, active item as a soft primary-50 rounded pill with primary-700 text, clear hover/focus
- collapsible to icons on desktop (visual state in the ui slice) with tooltips
- user card at the bottom (avatar, name, role) with the existing logout

TOP BAR:
- page title area, user menu with existing actions (profile, change password, sessions, logout)
- notifications bell / global search: only restyle them if they already exist — do not build them (they're Phase 10)
- 1px bottom border, no heavy shadow

CONTENT: canvas background, max-width container, consistent vertical rhythm, PageHeader on every page.

RESPONSIVE:
- ≥1280px full sidebar · 1024–1279px icon sidebar · <1024px hidden sidebar + bottom-sheet menu (spec §13.3) using Headless UI Dialog + Transition, focus-trapped
- no horizontal scroll at 360px

AUTH LAYOUT: form card on the left, soft primary-tinted panel with simple original shapes on the right (hidden on mobile).

PrintLayout and print styles stay plain and unaffected.
```

---

## Prompt 4: Auth and account pages

```
Follow the UI redesign constraints. Restyle /login, /register, /forgot-password, /reset-password/:token, the forced change-password screen, /profile, /change-password and /sessions.

- centred white card on AuthLayout with a clear heading and one-line description
- new Input/Button components, password show/hide toggle, inline field errors (Zod + server error.details)
- keep the exact behaviour and wording of: generic invalid-credentials message, ACCOUNT_LOCKED, PASSWORD_CHANGE_REQUIRED, forgot-password always-success message
- loading state on submit, no layout jump when errors appear
- profile: card with avatar and the fields that are already editable
- sessions: cards (device, IP, last used) with revoke; "Log out of all devices" in a restrained red danger-zone card with its existing confirmation
- auth API calls, token handling and redirects untouched
```

---

## Prompt 5: Role dashboards (current placeholders)

```
Follow the UI redesign constraints. The five role dashboards are still placeholders (real widgets arrive in Phase 10). Restyle them as polished shells using docs/design-reference/02-dashboard.png as inspiration — without inventing any data.

- PageHeader: greeting with the user's name, today's date in clinic timezone, short role description
- if a dashboard already shows real numbers or lists, present them with StatCard / list cards
- otherwise use a clean "quick links" grid of cards to the role's existing pages (icon chip, title, one-line description) — links only to routes that exist
- no fake statistics, no placeholder charts
- grid: 3–4 columns desktop → 2 → 1 on mobile

Build the StatCard / chart-card patterns so Phase 10 can drop real widgets straight in; document them in docs/DESIGN_SYSTEM.md.
```

---

## Prompt 6: Admin setup pages

```
Follow the UI redesign constraints. Restyle the admin pages that exist: users (list + detail), departments, services, doctors (list + profile / schedule / leave), lab test catalogue and settings. CRUD behaviour, validation and API calls stay unchanged.

LIST PAGES (users, departments, services, doctors, lab tests):
- PageHeader with the primary "Add …" action
- search + filter chips for the filters that already exist
- table ≥768px, cards below; active/inactive as StatusPill; row actions in a Headless UI Menu
- activate/deactivate/unlock/reset keep their confirmation dialogs
- prices shown with the existing ₹-from-paise formatter

FORMS (create/edit modals or pages): grouped SectionCards, two-column on desktop, one on mobile.

DOCTOR DETAIL: header card (avatar, name, department, specialisation, room, accepting-appointments pill) + tabs for Profile / Schedule / Leave.
- weekly schedule as a clean 7-day grid of session chips (09:00–13:00), overlap errors shown inline
- leave list as cards; the "affected appointments" result shown in an amber panel

LAB TEST CATALOGUE: test cards/rows with code, category, sample type, price, TAT; parameters and reference ranges in a clean nested table.

SETTINGS (/admin/settings) — keep the spec tabs: Clinic, Appointments, Billing, Lab, AI, Notifications. Use docs/design-reference/05-settings.png as inspiration.
- horizontal tabs (scrollable row on mobile), active tab in primary
- each tab = SectionCards with title, one-line description, fields and the save area
- booleans (self-booking, dual verification, AI toggles, email) as pill Toggles
- AI kill switches in their own clearly explained card
```

---

## Prompt 7: Patients

```
Follow the UI redesign constraints. Restyle the patient screens: reception patient list, new patient form, patient details, doctor "my patients" (if it exists) and the patient's own profile page. Use docs/design-reference/03-patients.png as inspiration.

PATIENT LIST:
- search (MRN / phone / name — existing behaviour) + filter chips that mirror the query string (existing filters only)
- collapsible filter panel on desktop, bottom sheet on mobile
- rows/cards: initials avatar, name, MRN, age/sex, phone (only if the role's response includes it), portal status pill
- table ≥768px, cards below; existing pagination restyled

NEW PATIENT FORM:
- SectionCards: Demographics, Contact, Emergency contact, Allergies, Insurance, Language & consent
- duplicate-check result as an amber panel listing matches with "Open existing" / "Create anyway" (existing override + reason flow unchanged)

PATIENT DETAIL:
- header card: avatar, name, MRN, age/sex, blood group, primary actions that already exist (edit, portal invite, confirm link) — no "Book appointment" button yet (Phase 4)
- allergies as red pills with an icon, chronic conditions as neutral pills — only when the API returns them for this role
- Headless UI tabs for sections that already exist; don't add a timeline tab (Phase 8)

PATIENT PROFILE (patient role): same header style, editable contact / emergency contact / language / consent fields that already exist, consents as Toggles.

Subtle transitions only: row hover, tab switch, filter change.
```

---

## Prompt 8: Motion layer

```
Follow the UI redesign constraints. Add restrained motion: calm, fast, clinical. Motion confirms actions and never decorates.

Use Tailwind transitions, CSS keyframes and Headless UI Transition (already installed). No Framer Motion or other libraries unless I approve.

- durations 150ms (hover/press), 200ms (menus, tabs), 250ms (modals, sheets); easing cubic-bezier(0.2,0,0,1)
- route change: one 8px fade-up on the page container only
- clickable cards: -2px lift + shadow-card-hover
- buttons: colour transition, active scale 0.98, focus ring always visible
- sidebar: active pill and collapse width transitions
- dashboard cards: 40ms stagger on first load only
- modals: opacity + scale 0.98→1; bottom sheets slide up
- dropdowns/menus: fade + 4px translate
- toasts: themed slide-in
- skeleton shimmer is the only looping animation

Everything behind motion-safe: / prefers-reduced-motion.
```

---

## Prompt 9: Responsive and accessibility audit

```
Follow the UI redesign constraints. Audit every redesigned page at 1440, 1280, 1024, 768, 640, 480, 375 and 360px.

- desktop: full sidebar, multi-column grids
- tablet: icon sidebar, 2-column grids
- mobile: bottom-sheet menu, single column, tables → cards below 768px, 44px touch targets, single-column forms, no horizontal page overflow
- reflow layouts; don't just shrink them

Accessibility (WCAG 2.1 AA): contrast of all token pairs, focus order + visible focus, keyboard access for menus, tabs and dialogs, labels on all inputs, aria-live for toasts, status never colour-only.

List the issues per page first, then fix them (presentation only).
```

---

## Prompt 10: Final polish

```
Follow the UI redesign constraints. Do a final consistency pass over every page against docs/DESIGN_SYSTEM.md and docs/design-reference/.

Look for: off-token colours, inconsistent spacing / radius / type sizes, shadows heavier than shadow-card, one-off buttons or inputs not using components/ui, misaligned icons, inconsistent avatar sizes, weak hierarchy, missing loading / empty / error states, print styles broken by the redesign.

List the findings grouped by page and explain any structural change before making it. Then fix, run `npm run lint`, `npm test` and the frontend tests, and confirm nothing in server/, api.js files, routes or schemas changed (show me `git diff --stat`).
```

---

## After the redesign: add-on for Phases 4–11

Merge `ui-redesign` into main, then add this block to every phase prompt so new screens come out in the new style.

```
UI: build every new screen with docs/DESIGN_SYSTEM.md — components/ui, PageHeader, SectionCard, StatCard, StatusPill via the central status map. No new colours, radii or shadows. Include loading, empty and error states, a mobile layout from 360px, and motion-safe transitions only.
```

**Extra UI notes for specific phases** (add them alongside the block above):

- **Phase 4 (appointments and queue):**
  ```
  UI reference: docs/design-reference/04-appointments.png.
  - appointments list: PageHeader with date control, status filter chips, list/calendar toggle, "New appointment"; appointment cards with time pill + StatusPill, type, patient avatar + name + MRN, doctor, overflow menu for actions
  - react-big-calendar: restyle via a scoped CSS file (light grid, rounded status-tinted event chips, our Buttons in the toolbar, today in primary-50)
  - booking wizard: stepper with progress, doctor cards, availability date picker, slot pills (selected = primary); 409 errors as calm inline alerts
  - queue screen: Waiting / In consultation / Done columns, large rounded token badge, priority pill, prominent "Call next"; a brief ≤600ms highlight on rows changed by socket updates
  - queue board: large tokens + rooms, high contrast, NO patient names
  ```
- **Phase 5 (consult workspace):** sticky patient header with autosave indicator and Sign button, a red allergy banner that is always visible, tabs as SectionCards, and a yellow "AI draft – review before use" banner in Phase 9.
- **Phase 6 (lab):** status tabs with counts, urgent first, a status stepper on the order detail, and flag pills in the results grid (critical is red with an icon).
- **Phase 7 (billing):** invoice StatusPills, a sticky totals card, payment method pills, refunds shown in muted red.
- **Phase 8 (follow-ups):** use `docs/design-reference/06-messages.png`. Three-pane list, thread and context, with incoming bubbles in white and outgoing in primary-50. The emergency banner must stay prominent.
- **Phase 10 (dashboards and notifications):** put real widgets into the StatCard and chart-card patterns from the redesign.