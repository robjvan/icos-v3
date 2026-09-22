# Web Client — Phase 3 Evidence (Polish, a11y, ship)

Date: 2026-09-23. Branch: `dev`. Scope: `web-client/` + plan/evidence only.
`core/` sources untouched (a concurrent agent is active there): core was only
**run** (`nest start`, no watch) to serve the E2E/AXE checks, then shut down.
Ports 3000/4300 verified free afterwards.

## 1. Unit + static verification

- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- `npm run lint` (`eslint "src/**/*.ts"`) — clean.
- `CI=true npm test -- --watch=false` — **34 files / 98 tests green**
  (was 33/87: +sidebar spec, +composer attachment/focus tests, +nav
  focus tests, +chat refocus test).
- `npm run build` (production) — success, **initial 274.53 kB**
  (budget: 500 kB warn / 1 MB error). All 16 tab chunks lazy.

## 2. Contrast audit (computed, WCAG AA 4.5:1 normal text)

Script: `/tmp/contrast-final.py` (24 pairs, both themes). Before the fix,
6 pairs failed: white-on-`#6f8f82` buttons/bubbles (3.54), light
`--text-secondary` (4.20), amber badge text in light (1.72–3.82), dark error
red (2.18), footer `text-gray-500` (3.07/3.81).

Fixes shipped (`src/styles.css` + component CSS, no TS logic change):

- New `--accent-sage-deep: #45685c` / `--accent-sage-deep-hover: #3f6357`
  for all button + user-bubble backgrounds (white text: 6.20/6.70).
  Decorative `--accent-sage` uses (borders, active states) unchanged.
- Light `--bg-user-bubble` → `#45685c` (was `#6f8f82`).
- Light `--text-secondary` `#6b6b6b` → `#595959` (5.52 on bg).
- New `--badge-amber-text` (dark `#e8c06a` / light `#7a5c22`) for the three
  amber badges (placeholder, tools, composer attachments).
- New `--badge-sage-text` (dark `#a8c5a8` / light `#45685c`) for sage badges
  + memory candidate kinds.
- Dark `--accent-red` → `#e07a72` for error/status text (5.08); reject
  button keeps `--accent-red-deep: #af231c` (white text 6.82).
- Question-card Dismiss restyled to transparent + border (was solid
  secondary, which fails with light text in dark theme).
- Footer `text-gray-500` → `text-(--text-secondary)`.
- Tab-pane form/input hardcodes (`#111`/`#eee`/`#444` in skills/memory tab
  CSS) ported to `--bg-input` / `--text-primary` / `--border-strong`
  (this was the light-theme AXE failure, not just cosmetic).

Result: **24/24 pairs pass** (worst: 4.89 light sage/amber badge text).

## 3. AXE pass (axe-core + Chromium via playwright-core, real `ng serve`)

Pages: chat, skills, tools, memory, agents placeholder, client-settings —
each in dark AND light (12 runs). Initial run: 40 violations
(`aria-required-children`, `color-contrast` xN, `landmark-one-main`,
`page-has-heading-one`, `aria-allowed-role`, `definition-list`).

Fixes shipped:

- Sidebar empty states moved out of the `role=listbox` container
  (a listbox may only own options; new `showNoMatches`/`showNoSessions`
  signals, messages render as siblings).
- `dashboard-page` outlet wrapper is now `<main>` (landmark).
- Every route has exactly one `h1` (placeholder `h2`→`h1`, four functional
  tabs `h2`→`h1`; chat already had `h1`).
- Nav links dropped the fake `role=tab`/`tablist` (they are links:
  natively keyboard-accessible; the tablist pattern would require
  roving-tabindex arrow-key handling, deferred).
- Client-settings radiogroup moved off the `dd` into a nested `div`
  (fixes `aria-allowed-role` + `definition-list`).
- Footer `Online` status now uses the passing badge-sage color.

Result: **12/12 pages clean, 0 violations** (re-ran to confirm).

## 4. E2E 20/20 (Chromium, `ng serve :4300` + live core :3000)

Script (temporary, removed after the run): new → send
(`reply with exactly: phase3 e2e probe ok`) → streamed reply in transcript
→ session id assigned → composer refocused → switch session (header
changes, composer focused) → search → clear-search restores list →
`/health` system notice → seeded approval renders → Approve resolves →
seeded clarification renders → Answer resolves → attachment chip renders
local-only with badge → chip removable → theme toggle flips →
about dialog opens with focus on Close, Escape closes, focus returns →
390px viewport: no horizontal overflow, sidebar stacks.

Two script/race fixes during the run (both in the harness/app timing,
not product bugs): the pending stream bubble shares `.message.assistant`
so the reply wait keys on committed text, not bubble count; composer
refocus is deferred a macrotask past change detection (busy-disable would
otherwise swallow it) — covered by a unit test.

Parked-turn resume (`approval_required` → `resume-stream`) stays
unit-covered (7 store specs); the seeded approvals exercise the
resolve + refresh path honestly without faking a parked turn.

Footprint on shared state: one probe session + 2 messages, one
approved approval, one answered clarification (all `phase3-e2e-probe`
labelled, all terminal). No `core/` files touched.

## 5. Deferred / blocked

- `docker compose up --build`: **blocked, Docker daemon down**
  (`docker info` fails). No `core/` rebuild was attempted (concurrent
  agent). Mitigation: production build verified in budgets (above);
  `Dockerfile`/`docker-compose.yml` unchanged from Phase 2.
- Full per-route dynamic-import unit loop: still covered by the browser
  smoke (all 16 routes render), per the Phase 2 note.
- `fr/es/pa/zh` locales: deferred per plan (`lang="en"`, LTR only).
- Tablist arrow-key pattern: links are keyboard-accessible; roving
  tabindex deferred (noted in code via plain nav).

## 6. Files changed (all under `web-client/`)

- `src/styles.css` — contrast tokens (deep sage, badge texts, dark error
  red, light secondary).
- `composer.*` — attach button + hidden file input + local-only chips +
  badge + `focusInput()`; specs for select/remove/submit-clears/focus.
- `session-sidebar.*` — clear-search, result counts (`aria-live`),
  sibling empty states; new spec.
- `chat-ui-component.*` — focus composer after open/new/send-complete;
  refocus spec (mock promises fixed to resolve).
- `nav-tabs-component.*` — modal Escape host binding, focus into dialog
  on open, focus return on close, plain-link nav; focus specs.
- `footer-component.*` — `contentinfo` landmark, placeholder titles,
  passing status color.
- `dashboard-page.html` — `<main>` landmark.
- `tab-placeholder`, 4 functional tabs — `h1` per route.
- `client-settings-tab.html` — radiogroup nesting fix.
- `skills-tab` / `memory-tab` / `tools-tab` / `client-settings-tab` CSS —
  theme-var port of remaining hardcodes.
