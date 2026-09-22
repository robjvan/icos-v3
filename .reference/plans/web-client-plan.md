# Web Client — Implementation Plan (`web-client/`)

Status: Phase 3 complete (2026-09-23) — composer upload placeholder, search final
pass, focus/ARIA hardening, contrast 24/24, AXE 12/12 clean, unit 34/98,
E2E 20/20 vs live core, prod build 274.53 kB in budgets. Docker compose-up
blocked (daemon down) — documented. Evidence:
`.reference/plans/evidence/web-client-phase3.md`. Committed on `dev`, no push.
(Phase 1–2 evidence retained below.)
Scope: `web-client/` only. No changes to `core/` in this plan.
Source-of-truth hierarchy: `.reference/web-client-blueprint.md` → this plan → code.
Branch: `dev`. Commits per-phase, NO pushing.
Layout inspiration: `core/test-client.html` (no UI mockup exists — blueprint "mockup" line was a copy-paste error, confirmed 2026-09-22).

## 1. Goal

Replace `core/test-client.html` with a proper Angular SPA in `web-client/` that reaches full chat parity first, then adds tabbed management UI (functional where the server supports it, clearly-badged placeholders where it does not).

Explicit non-goals (deferred to next major phase per blueprint):

- M17+ server features (autonomous agency, etc.) — frontend renders placeholders only.
- SSR, NgRx, new state libs, new i18n locales beyond `en`.
- Any `core/` endpoint additions (including `GET /core/health`).

## 2. Locked decisions (Q&A 2026-09-22)

- [x] API base: fix `src/constants.ts` to `${SERVER_URL}/core/...` direct CORS. No `proxy.conf.json`, no `environments/` files in Phase 0–1.
- [x] Phase 1 scope: full test-client parity (chat / sessions / approvals / clarifications); Phase 2+ adds real tabs; everything without a server backing it is a routed placeholder card.
- [x] Skills tab reads the live read-only API; tools auto-approve toggles persist to `localStorage` as frontend-only prefs with a `server unimplemented` badge.
- [x] No mockup: use `test-client.html` layout + both-themes description. The blueprint's "floating windows" line was dropped 2026-09-22 — the docked dashboard layout + card-style tabs ship as-is.
- [x] PrimeNG allowed selectively; default is Tailwind + `@lucide/angular` (already installed). Install PrimeNG only when a Phase 2 widget proves the need.
- [x] Health footer + health tab: static placeholders with a `TODO(core health endpoint)` in code. No HTTP `/health` exists — health today is only the `/health` slash-command text via the conversation API, and this plan adds no `core/` endpoints.

## 3. Ground truth: what exists

### 3.1 Backend contract (do not change)

| Frontend need | Method + path | Source |
| --- | --- | --- |
| Send / stream turn | `POST /core/conversation/stream` | `core/src/conversation/conversation.controller.ts:73` |
| Resume parked/running turn | `POST /core/conversation/resume-stream` (+ non-streaming `POST /core/conversation/resume`) | `conversation.controller.ts:46,93` |
| Non-streaming turn | `POST /core/conversation` | `conversation.controller.ts:29` |
| History | `GET /core/conversation/:id` | `conversation.controller.ts:61` |
| Sessions list / search | `GET /core/sessions`, `GET /core/sessions/search` | `core/src/conversation/sessions.controller.ts:10` |
| Approvals list / resolve | `GET /core/approvals`, `POST /core/approvals/:id/approve\|reject\|cancel {sessionId}` | `core/src/approvals/approvals.controller.ts:23` |
| Clarifications list / resolve | `GET /core/clarifications`, `POST /core/clarifications/:id/answer {sessionId,answer}`, `POST /core/clarifications/:id/cancel` | `core/src/clarifications/clarifications.controller.ts:18` |
| Skills (read-only) | `GET /core/skills`, `GET /core/skills/discover?q=`, `GET /core/skills/active?sessionId=`, `GET /core/skills/:name` | `core/src/skills/skills.controller.ts:14` |
| Memory candidates (inspect) | `GET /core/memory-candidates` | `core/src/conversation/candidates.controller.ts:13` |
| CORS | Permissive `core.enableCors()` for non-same-origin dev clients | `core/src/main.ts:24` |
| Test client served at | `GET /` (same-origin `:3000`) | `core/src/test-client.controller.ts:11` |

Stream protocol (`core/test-client.html:907-1027`, `conversation.service.ts:89-106`): SSE `meta → token* → (tool | approval)* → done | error`. `done` carries `status: ok | approval_required | processing`, optional `command` (`kind === 'session'` resets pane), `tool`, `approval`, `outcome`, `result`.

Turn-resume semantics (must be preserved exactly):

- `pendingResumes: Map<approvalId, {requestId, sessionId}>`; set on `done.approval_required`, consumed on approval resolve (approve AND reject both resume).
- `processing` polls `resume-stream` bounded ≤10 × 1s, never re-executes.
- `tool` mid-turn progress line; streamed tokens always win once they arrive.
- Structured command results render as system notices, not assistant messages.
- `excludedFromContext` messages render dimmed with `/undo` title.
- Session search debounced 250ms; sidebar is auxiliary — chat must keep working when it fails.

### 3.2 Frontend starting point

- `web-client/src/constants.ts:1-10` is WRONG (`/api/v1/core/...` does not exist on core). Phase 0 fixes it.
- Scaffold exists but empty: `dashboard-page/` (shell), `chat-ui-component/` (stub), `nav-tabs-component/` (stub), `footer-component/` (hardcoded values + `ngClass` violation of `web-client/AGENTS.md:33`), `about-modal/`, `settings-modal/`. `services/`, `models/`, `guards/` are empty dirs.
- `src/app/app.spec.ts:11-22` asserts stale `Hello, web-client` title — fails against current shell.
- `src/styles.css:6-44` has `data-theme` dark/light CSS vars; Tailwind v4 imported. Fonts (`Inter` + `JetBrains Mono` via Fontsource), theme toggle, and lucide wiring still TODO.
- `angular.json:33-44` production budgets (500kB warn / 1MB error initial; 4kB/8kB component style). `Dockerfile` runs `ng serve --host 0.0.0.0 --port 4200`; `docker-compose.yml` gates `web-client:4200` on `core:3000` healthy.

### 3.3 Angular rules (from `web-client/AGENTS.md` + blueprint addendum — binding)

Standalone components only (no `standalone: true` flag); signals + `computed()`; `OnPush`; `input()`/`output()`; `inject()` + `providedIn: 'root'` services; no `effect()` unless explicitly allowed; no `ngClass`/`ngStyle` (use `class`/`style` bindings); native `@if/@for/@switch`; Reactive forms; `async` pipe; no `mutate` on signals; one dir per component with separate `.ts/.html/.css` (kebab-case, matching existing `dashboard-page/` pattern); lazy `loadComponent` routes; AXE-clean + WCAG 2.1 AA.

## 4. Phase 0 — Foundation + corrections

Status: complete (2026-09-22).

- [x] Fix `src/constants.ts`: `SERVER_URL='http://localhost:3000'`, `CONVERSATION_ENDPOINT='/core/conversation'`, `SESSIONS_ENDPOINT='/core/sessions'`, `APPROVALS_ENDPOINT='/core/approvals'`, `CLARIFICATIONS_ENDPOINT='/core/clarifications'`, `SKILLS_ENDPOINT='/core/skills'`, `MEMORY_CANDIDATES_ENDPOINT='/core/memory-candidates'`. All fetches compose `${SERVER_URL}${*_ENDPOINT}...`. Docker quirk documented in `constants.ts`: `localhost` inside a container is the container itself — compose/NAT users set `SERVER_URL` to `host.docker.internal` or a LAN address.
- [x] Fix `footer-component`: removed `ngClass`, `OnPush` + signals + `computed()`, live 1s clock with `OnDestroy` cleanup, static health/context/CPU/RAM placeholders each with `TODO(core health endpoint)` comment. Kept `ServerStatus` enum pattern. Added footer + theme-toggle specs.
- [x] Fix `app.spec.ts`: replaced stale title assert with router-outlet render assert.
- [x] Shell: `dashboard-page` hosts `nav-tabs` + `router-outlet` + `footer`; tab content is a lazy `loadComponent` child route in `app.routes.ts` (kept `** → ''` fallback). Fixed `nav-tabs-component.spec.ts` class-name typo (`NavTabsComponents` → `NavTabsComponent`) which was failing `ng test`.
- [x] Theme: `ThemeService` (`providedIn: root`, signals, `localStorage icos-theme`, pre-boot `initFromStorage()` in `main.ts`); `data-theme` toggle in nav + footer with `aria-label`; blueprint palette aligned (dark `#25282A` / light `#E4E4E7`); Fontsource `Inter` 400/500/600 + `JetBrains Mono` 400 wired in `styles.css`; `@lucide/angular` icons registered via `provideLucideIcons` (message-square, settings, info, sun, moon, send, search, plus). PrimeNG evaluated — not needed in Phase 0, stays out.
- [x] Toolchain: added `eslint.config.mjs` (flat config, type-checked rules, spec-file relaxations) + `npm run lint`. Verify: `tsc -p tsconfig.app.json` clean, `eslint "src/**/*.ts"` clean, `ng test` 8 files / 15 tests green, `ng build --configuration production` inside budgets (initial 265.84 kB) with `dashboard-page` + `chat-ui-component` lazy chunks. About/settings modals stubbed with Phase 2 notes; `guards/` untouched.
- [x] Evidence: this section + commit below. No live-core integration in Phase 0 (no services yet) — integration evidence lands in Phase 1.

## 5. Phase 1 — Chat parity with `test-client.html`

Status: complete (2026-09-22).

### Models (`src/app/models/`) — done

- [x] `message.ts` (`ChatMessage` + `excludedFromContext`), `session.ts` (`SessionSummary`, `SessionSearchResult`, history), `approval.ts`, `clarification.ts`
- [x] `stream-event.ts` (`meta | token | tool | approval | done | error` + `parseStreamBlock` / `splitStreamBlocks` extracted for tests)
- [x] `turn-outcome.ts` (`ok | approval_required | processing` + `command | tool | approval | outcome | result`)

### Services — done (names adjusted from plan)

- [x] `core-api.service.ts` — `GET`/`POST` JSON wrapper with error-body surfacing + URL join
- [x] `conversation-stream.service.ts` — `POST .../stream` + `/resume-stream` via `fetch` + `ReadableStream` (`\n\n` framing, `event:`/`data:` lines, `JSON.parse` per event)
- [x] `session-data.service.ts` — `SessionService` (`GET conversation/:id`, `GET sessions?limit=50`, `GET sessions/search?q=&limit=50`), `ApprovalService` (`GET approvals?sessionId=&status=pending`, `POST :id/approve|reject|cancel {sessionId}`), `ClarificationService` (`GET clarifications?...`, `POST :id/answer {sessionId,answer}`, `POST :id/cancel {sessionId}`)
- [x] Sidebar/search/approval/question failures stay auxiliary: `try/catch` + chat keeps working (same policy as test client)

### Components — done (one dir + separate `.ts/.html/.css` each; `OnPush`; `input()/output()`; `@if/@for`; `class` bindings; Reactive forms)

- [x] `session-sidebar/` — list (title/preview, `messageCount · updatedAt`), 250ms-debounce search, `+ New`, active highlight, short-id + date formatting, `role=listbox/option` + `aria-selected`
- [x] `message-list/` — user/assistant/system bubbles, `excludedFromContext` dim + `/undo` title, pending bubble with `typing` class, `role=log` + `aria-live=polite` (auto-scroll owned by `chat-ui-component`)
- [x] `composer/` — Reactive-form textarea, Enter=send / Shift+Enter=newline, busy-disable with `...` state, autofocus
- [x] `approval-card/` — action + description + Approve/Reject emitting `{id, decision}`; `question-card/` — question + radio options (first checked by default) or free-text + Answer/Dismiss

### State (`conversation-store`, signals) — done

- [x] Owns `sessionId`, `messages`, `busy`, `sessions`, `searchQuery`/`searchResults`, `approvals`, `clarifications`, `pendingText`/`pendingTyping`, `pendingResumes: Map<approvalId, {requestId, sessionId}>`
- [x] `meta` sets `sessionId`; tokens stream into the pending bubble; `approval` event triggers early approval refresh; `done` without tokens fills `reply`
- [x] Resolve (approve or reject) → refresh approvals → consume `pendingResumes` → `resume-stream` exactly once
- [x] `processing` → bounded re-`resume-stream` (≤10 attempts, 1s delay via `scheduleProcessingPoll`); beyond bound commits `(still running — send a message to retry)`
- [x] `command.kind === 'session'` (`/new`, `/fork`) replaces pane with the single system bubble; other commands commit as system notices
- [x] After every send AND every resume: refresh sessions + approvals + questions
- [x] `chat-ui-component/` shell wires sidebar + scroll-host (pin-to-bottom, 48px stickiness) + approvals/questions + composer; session header + `+ New`

### Verify — done

- [x] Unit: SSE parser (token/meta/done-approval, keep-alive/malformed skip, split-chunk reassembly), store transitions (token stream commit, approval-park → resume-once on approve AND reject, processing bound + retry hint, session-command reset, tool trace line, error surfacing), component specs (chat shell, composer trim/reset/empty-guard, approval approve+reject, question first-option-default/free-text-trim/dismiss). `ng test`: 13 files / 40 tests green.
- [x] Integration vs live `localhost:3000` (core `nest start --watch`, OpenRouter `deepseek-v4-flash-0731`): REST script 9/10 — sessions list, history, search, `done`+`Status: healthy` on `/health` stream, approvals shape + create/approve lifecycle, clarifications shape + create/answer lifecycle. The 1 miss is expected server behavior, not a client gap: `/health` emits `done` with NO `meta` (command path only emits `meta` when the dispatch yields a session id — `conversation.service.ts:676-685`), which the client handles (no `meta` → keep current session). Live LLM turn: `meta` + 2×`token` + `done status:ok`, reply echoed exactly, history round-trip shows 2 messages. `/new` returns `command.kind: 'session'` with a fresh session id. Browser E2E (playwright-core + bundled Chromium, real `ng serve` app): 6/6 — app loads, sidebar lists 19 live sessions, send → streamed reply in transcript, session id assigned, search returns results, `/health` renders system notice.
- [x] `tsc` + `eslint` clean, `ng build --configuration production` inside budgets — commit, NO push. `playwright-core` added as devDependency for the browser E2E path (reused in Phase 3).

## 6. Phase 2 — Tabs (functional where server exists, placeholders elsewhere)

Status: complete (2026-09-22). Rebuilt once after an accidental `web-client/` deletion; restored from git + re-applied the working-tree diff (16-tab nav spec, settings-modal content, routes spec).

### Routes + nav — done

- [x] `app.routes.ts`: dashboard shell with 16 lazy `loadComponent` children — `'' (chat) | agents | tools | skills | files | memory | kb | sensors | mcp | models | cron | metrics | client-settings | server-settings | comms | identity`; `** → ''` fallback kept. Shell route drops `pathMatch: 'full'` so children match.
- [x] `nav-tabs-component/`: all 16 tabs with lucide icons in a horizontally scrolling `tablist`, active highlighting per-tab (`exact: true`), settings shortcut, about-dialog button, theme toggle. About dialog renders `AboutModal` in a modal backdrop (`role=dialog`, `aria-modal`).
- [x] `app.routes.spec.ts`: asserts all 16 child routes declare `loadComponent` + resolves the chat chunk. (Full per-route dynamic-import loop removed — importing all 16 chunks in one test exceeded the 5s vitest timeout.)

### Functional tabs — done

- [x] `skills-tab/` (live read): `GET skills` catalog + `discover?q=` + `:name` body view; blank-query guard; disabled-state placeholder when `enabled: false`; skipped-count note; `filesystem is the writer` badge; no CRUD controls (API has no mutations).
- [x] `tools-tab/` (local prefs): static registry copy (`session.search` no-approval, `session.rename` approval-required — mirrors `core/src/tools/tool-registry.ts`); per-tool auto-approve checkboxes persist to `localStorage icos-tool-auto-approve`; `frontend-only · server unimplemented` badge + hint that chat approvals still follow server policy.
- [x] `memory-tab/` (live read): `GET memory-candidates` ledger with optional session filter; kind/subject/predicate/object + confidence/importance/stability + extractor + provenance rendering; `ranking unimplemented (M10–M12)` badge.
- [x] `client-settings-tab/`: compiled-in `SERVER_URL` display + theme radio group through `ThemeService`.
- [x] `server-settings-tab/`: read-only placeholder (core exposes no settings endpoint; env-var note).

### Placeholders — done (routed cards with `TODO(server milestone)`, no fake data)

- [x] Shared `tab-placeholder/` (`title`, `description`, `milestone` inputs; `server unimplemented` badge): `agents-tab/` (M9/M14), `models-tab/` (model selection endpoint, unplanned), `cron-tab/` (M17), `files-tab/` (generated-file persistence, unplanned), `kb-tab/` (M21), `sensors-tab/` (M18), `mcp-tab/` (M13), `comms-tab/` (M16), `metrics-tab/` (usage/metrics endpoint, unplanned), `identity-tab/` (M14).
- [x] `settings-modal/` (quick theme + server-URL display) + `about-modal/` content (capability summary + plan pointer). `guards/` stays empty (blueprint auth: none).

### Verify — done

- [x] `ng test`: 33 files / 87 tests green (new: 3 service specs, 5 functional-tab specs, 10 placeholder specs, placeholder badge spec, routes spec, expanded nav spec).
- [x] Lazy-route smoke via browser (playwright-core + bundled Chromium, real `ng serve` + live core): 22/22 — app loads, nav lists 16 tabs, all 16 routes render their marker, skills tab lists 2 live skills, memory ledger renders, tools tab lists 2 tools with the frontend-only badge.
- [x] `tsc` + `eslint` clean (one fix: unnecessary type assertion in tools spec), `ng build --configuration production` inside budgets — commit, NO push.

### Chat theming fix (pre-Phase 3, 2026-09-22)

- [x] Chat stylesheets ported from dark-only hex to theme vars: new `--bg-input`, `--bg-user-bubble`, `--bg-assistant-bubble`, `--border-default`, `--border-strong` tokens in `styles.css` (dark preserves the old look; light uses white inputs, sage user bubbles, white assistant cards); `chat-ui-component`, `message-list`, `session-sidebar`, `composer`, `approval-card`, `question-card` converted; dashboard `hr` uses `--border-default`. Assistant bubbles in light mode are white on lilac-mist — accepted, revisit if contrast feels off. Verified `tsc` + `eslint` clean, 33 files / 87 tests green, prod build in budgets.

## 7. Phase 3 — Polish, a11y, ship

Status: complete (2026-09-23). Full evidence in
`.reference/plans/evidence/web-client-phase3.md`.

- [x] Docked dashboard layout + card-style tabs kept ("floating" dropped
  2026-09-22); footer stays static + `TODO` (now with `contentinfo`
  landmark, placeholder titles, passing status color); composer has a
  file-upload placeholder (attach button, images/docs/audio/video accept,
  local-only chips + `server unimplemented` badge, never uploaded);
  session search has clear button, live result counts, sibling empty
  states (out of the listbox per axe).
- [x] i18n: `en` only (`lang="en"`); LTR only. Other locales deferred.
- [x] WCAG 2.1 AA: focus returns to composer after open/new/send-complete
  (deferred past CD so busy-disable can't swallow it); about dialog
  focuses Close on open, Escape closes, focus returns to trigger;
  computed contrast audit 24/24 pairs pass (deep-sage buttons, badge
  text tokens, dark error red, light secondary fix); **AXE 12/12 pages
  clean, 0 violations** (chat/skills/tools/memory/agents/client-settings
  × dark/light; fixes: listbox children, `<main>` landmark, one `h1` per
  route, plain-link nav, radiogroup nesting).
- [x] Responsive: 390px verified — no horizontal overflow, sidebar stacks
  (`flex-direction: column`); tab bar scrolls horizontally.
- [x] E2E 20/20 (playwright-core Chromium, `ng serve` + live core):
  new → send → stream → refocus → switch → search → clear → `/health` →
  seeded approve → seeded answer → attach/remove → theme toggle →
  dialog focus in/out → responsive. Parked-turn resume stays
  unit-covered. Ephemeral `phase3-e2e-probe` rows only, all terminal.
- [x] Production: `ng build` 274.53 kB initial (500 kB warn / 1 MB error);
  `docker compose up --build` **blocked — Docker daemon down**, and no
  `core/` rebuild attempted (concurrent agent active). `Dockerfile` /
  `docker-compose.yml` unchanged.
- [x] Evidence committed (this plan + `evidence/web-client-phase3.md`) —
  commit, NO push.

## 8. Execution order

1. Phase 0 → verify → commit.
2. Phase 1 models → services → components → store → unit → live integration → commit.
3. Phase 2 chat route first, then skills/tools, then placeholders batch → commit.
4. Phase 3 styling → a11y → E2E → docker → evidence → commit.

## 9. Open items for build (defaults if unanswered)

- Keep `models/ + services/ + guards/` top-level layout (default YES; collapse to per-feature only if imports get messy).
- PrimeNG stays out until a Phase 2 widget proves need (default YES).
- `environments/` files: not in this plan (constants.ts only); revisit only if prod `SERVER_URL` injection demands it.
