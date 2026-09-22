# Web Client — Implementation Plan (`web-client/`)

Status: planning (2026-09-22) — no code changes in this file. Build starts after plan sign-off.
Scope: `web-client/` only. No changes to `core/` in this plan.
Source-of-truth hierarchy: `.reference/web-client-blueprint.md` → this plan → code.
Branch: `dev`. Commits per-phase, NO pushing.
Layout inspiration: `core/test-client.html` (no UI mockup exists — blueprint "mockup" line was a copy-paste error, confirmed 2026-09-22).

## [ ] 1. Goal

Replace `core/test-client.html` with a proper Angular SPA in `web-client/` that reaches full chat parity first, then adds tabbed management UI (functional where the server supports it, clearly-badged placeholders where it does not).

Explicit non-goals (deferred to next major phase per blueprint):

- M17+ server features (autonomous agency, etc.) — frontend renders placeholders only.
- SSR, NgRx, new state libs, new i18n locales beyond `en`.
- Any `core/` endpoint additions (including `GET /core/health`).

## [ ] 2. Locked decisions (Q&A 2026-09-22)

- [x] API base: fix `src/constants.ts` to `${SERVER_URL}/core/...` direct CORS. No `proxy.conf.json`, no `environments/` files in Phase 0–1.
- [x] Phase 1 scope: full test-client parity (chat / sessions / approvals / clarifications); Phase 2+ adds real tabs; everything without a server backing it is a routed placeholder card.
- [x] Skills tab reads the live read-only API; tools auto-approve toggles persist to `localStorage` as frontend-only prefs with a `server unimplemented` badge.
- [x] No mockup: use `test-client.html` layout + blueprint floating-windows / both-themes description.
- [x] PrimeNG allowed selectively; default is Tailwind + `@lucide/angular` (already installed). Install PrimeNG only when a Phase 2 widget proves the need.
- [x] Health footer + health tab: static placeholders with a `TODO(core health endpoint)` in code. No HTTP `/health` exists — health today is only the `/health` slash-command text via the conversation API, and this plan adds no `core/` endpoints.

## [ ] 3. Ground truth: what exists

### [ ] 3.1 Backend contract (do not change)

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

### [ ] 3.2 Frontend starting point

- `web-client/src/constants.ts:1-10` is WRONG (`/api/v1/core/...` does not exist on core). Phase 0 fixes it.
- Scaffold exists but empty: `dashboard-page/` (shell), `chat-ui-component/` (stub), `nav-tabs-component/` (stub), `footer-component/` (hardcoded values + `ngClass` violation of `web-client/AGENTS.md:33`), `about-modal/`, `settings-modal/`. `services/`, `models/`, `guards/` are empty dirs.
- `src/app/app.spec.ts:11-22` asserts stale `Hello, web-client` title — fails against current shell.
- `src/styles.css:6-44` has `data-theme` dark/light CSS vars; Tailwind v4 imported. Fonts (`Inter` + `JetBrains Mono` via Fontsource), theme toggle, and lucide wiring still TODO.
- `angular.json:33-44` production budgets (500kB warn / 1MB error initial; 4kB/8kB component style). `Dockerfile` runs `ng serve --host 0.0.0.0 --port 4200`; `docker-compose.yml` gates `web-client:4200` on `core:3000` healthy.

### [ ] 3.3 Angular rules (from `web-client/AGENTS.md` + blueprint addendum — binding)

Standalone components only (no `standalone: true` flag); signals + `computed()`; `OnPush`; `input()`/`output()`; `inject()` + `providedIn: 'root'` services; no `effect()` unless explicitly allowed; no `ngClass`/`ngStyle` (use `class`/`style` bindings); native `@if/@for/@switch`; Reactive forms; `async` pipe; no `mutate` on signals; one dir per component with separate `.ts/.html/.css` (kebab-case, matching existing `dashboard-page/` pattern); lazy `loadComponent` routes; AXE-clean + WCAG 2.1 AA.

## [ ] 4. Phase 0 — Foundation + corrections

Goal: truthful constants, honest shell, clean toolchain baseline.

- [ ] Fix `src/constants.ts`: `SERVER_URL='http://localhost:3000'`, `CONVERSATION_ENDPOINT='/core/conversation'`, `SESSIONS_ENDPOINT='/core/sessions'`, `APPROVALS_ENDPOINT='/core/approvals'`, `CLARIFICATIONS_ENDPOINT='/core/clarifications'`, `SKILLS_ENDPOINT='/core/skills'`, `MEMORY_CANDIDATES_ENDPOINT='/core/memory-candidates'`. All fetches compose `${SERVER_URL}${*_ENDPOINT}...`. Docker quirk to document: `localhost` inside a container is the container itself — compose/NAT users set `SERVER_URL` to `host.docker.internal` or a LAN address.
- [ ] Fix `footer-component`: remove `ngClass` (`footer-component.html:4`), `OnPush` + signals, live clock, static health/context/CPU/RAM placeholders each with `TODO(core health endpoint)` comment. Keep `ServerStatus` enum pattern.
- [ ] Fix `app.spec.ts`: replace stale title assert with router-outlet / dashboard render assert.
- [ ] Shell: `dashboard-page` hosts `nav-tabs` + `router-outlet` + `footer`; move tab content to lazy `loadComponent` routes in `app.routes.ts` (keep `** → ''` fallback).
- [ ] Theme: `data-theme` dark/light toggle persisted to `localStorage`; blueprint palette (smoky granite `#25282A` dark / lilac mist `#E4E4E7` light / hawkesbury `#6F8F82` accent / Kimirucha `#8A6D3B` secondary / upsed tomato `#AF231C` destructive); Fontsource `Inter` + `JetBrains Mono`; `@lucide/angular` icons. Evaluate PrimeNG here — install only on proven need.
- [ ] Verify: `tsc`, `eslint`, `ng test`, `ng build` clean — commit, NO push.

## [ ] 5. Phase 1 — Chat parity with `test-client.html`

Goal: Angular client does everything `test-client.html:418-1057` does, with identical stream/resume semantics.

### [ ] Models (`src/app/models/`)

- [ ] `message.ts`, `session.ts`, `approval.ts`, `clarification.ts`
- [ ] `stream-event.ts` (`meta | token | tool | approval | done | error`)
- [ ] `turn-outcome.ts` (`ok | approval_required | processing` + `command | tool | approval | outcome | result`)

### [ ] Services (`providedIn: root`, `inject()`, signals, no `effect()`)

- [ ] `conversation.service.ts` — `POST ${SERVER_URL}${CONVERSATION_ENDPOINT}/stream` + `/resume-stream` via `fetch` + `ReadableStream` SSE parser (`\n\n` framing, `event:`/`data:` lines, `JSON.parse` per event).
- [ ] `session.service.ts` — `GET conversation/:id`, `GET sessions?limit=50`, `GET sessions/search?q=&limit=50`.
- [ ] `approval.service.ts` — `GET approvals?sessionId=&status=pending`, `POST :id/approve|reject|cancel {sessionId}`.
- [ ] `clarification.service.ts` — `GET clarifications?sessionId=&status=pending`, `POST :id/answer {sessionId,answer}`, `POST :id/cancel {sessionId}`.
- [ ] Sidebar/search/approval/question failures stay auxiliary: log + keep chat usable (same policy as test client `catch {}` blocks).

### [ ] Components (one dir + separate `.ts/.html/.css` each; `OnPush`; `input()/output()`; `@if/@for`; `class`/`style` bindings; Reactive forms)

- [ ] `session-sidebar/` — list (title/preview, `messageCount · updatedAt`), 250ms-debounce search, `+ New`, active highlight, short-id + date formatting.
- [ ] `message-list/` — user/assistant/system bubbles, `excludedFromContext` dim + `/undo` title, auto-scroll, `Running tool <name>...` progress, `Tool ran: <name>` trace line, system-notice rendering for `command` results.
- [ ] `composer/` — textarea, Enter=send / Shift+Enter=newline, busy-disable with `...` state, autofocus.
- [ ] `approval-card/` — action + description + Approve/Reject; `question-card/` — question + radio options (first checked) or free-text + Answer/Dismiss.

### [ ] State (`conversation-store`, signals)

- [ ] Owns `sessionId`, `messages`, `busy`, `pendingResumes: Map<approvalId, {requestId, sessionId}>`.
- [ ] `meta` sets `sessionId`; tokens stream into the pending bubble; `approval` event triggers early approval refresh; `done` without tokens fills `reply`.
- [ ] Resolve (approve or reject) → refresh approvals → consume `pendingResumes` → `resume-stream` exactly once.
- [ ] `processing` → bounded re-`resume-stream` (≤10 attempts, 1s delay); beyond bound append `(still running — send a message to retry)`.
- [ ] `command.kind === 'session'` (`/new`, `/fork`) replaces pane with the single system bubble.
- [ ] After every send AND every resume: refresh sessions + approvals + questions.

### [ ] Verify

- [ ] Unit where useful: SSE parser (split chunks, `\n\n` boundaries, `meta/token/done/error`), store transitions (approval-park → resume-once, processing bound, session-command reset). `ng test` green.
- [ ] Integration vs live `localhost:3000`: send → streamed tokens → history persists; sessions list/search; approval approve+reject both resume; clarification answer+cancel; `/health`, `/new` command rendering. No evidence committed without a live run.
- [ ] `tsc` + `eslint` clean — commit, NO push.

## [ ] 6. Phase 2 — Tabs (functional where server exists, placeholders elsewhere)

Goal: blueprint tab bar with lazy routes; only skills/tools get live logic, everything else is an honest placeholder.

- [ ] `nav-tabs-component/` lazy routes: `chat | agents | tools | skills | files | memory | kb | sensors | mcp | models | cron | metrics | client-settings | server-settings | comms | identity`.
- [ ] `skills-tab/` (functional read): `GET skills`, `discover?q=`, `active?sessionId=`, `:name` body view. No CRUD controls — API has no mutations; any CRUD affordance ships disabled with `filesystem is the writer` note. Auto-approve-style prefs (if any) are `localStorage`-only with `server unimplemented` badge.
- [ ] `tools-tab/` (local prefs): tool list shown from observed `tool` stream events / static registry copy; per-tool auto-approve toggles persist to `localStorage` only, badged `frontend-only — server unimplemented`.
- [ ] Placeholders (routed cards with `TODO(server milestone)`, no fake data): `agents-tab/` (M9/M14 persona), `models-tab/` (set-model, unimplemented), `cron-tab/` (M17), `files-tab/` (generated files, persistence unimplemented), `kb-tab/` incl. upload (M21), `sensors-tab/` (M18), `memory-tab/` (candidates list via `GET memory-candidates` read is allowed; ranking/consolidation M10–12 placeholder), `mcp-tab/` (M13), `comms-tab/` (SMS/Email/Discord, M16), `metrics-tab/` (token usage today/7d/30d/90d/custom + wakatime-style per-project — placeholder until server exposes usage), `client-settings-tab/` (`SERVER_URL`, theme), `server-settings-tab/` (read-only note), `identity-tab/` (SOUL.md/persona/system prompt, M14).
- [ ] `settings-modal/` (client settings) + `about-modal/` content. `guards/` stays empty (blueprint auth: none).
- [ ] Verify: `ng test`, lazy-route smoke (every tab loads, placeholders render badges), `tsc` + `eslint` clean — commit, NO push.

## [ ] 7. Phase 3 — Polish, a11y, ship

- [ ] Floating disconnected windows + gap layout per blueprint; system health footer bar (still static + `TODO`); file-upload placeholder input on composer (images/docs/audio-video, badged `server unimplemented`); session search/filters final pass.
- [ ] i18n: `en` only; `fr/es/pa/zh` deferred. LTR only.
- [ ] WCAG 2.1 AA: focus management (session switch, modal open/close, send/busy), contrast check on both themes, ARIA on tabs/cards/modals/composer. AXE pass required.
- [ ] Responsive: ≤700px sidebar stacks (mirror `test-client.html:348-379` breakpoints).
- [ ] E2E important flows: new → send → stream → switch session → approve → resume → answer clarification. (`ng e2e` harness is not scaffolded — pick one in this phase if time allows, else document manual script as evidence.)
- [ ] Production: `ng build` inside budgets (`angular.json:33-44`); `docker compose up --build` → `core:3000` healthy → `web-client:4200` serves 200.
- [ ] Evidence to `.reference/plans/evidence/` (unit + e2e + live run per repo ground rules) — commit, NO push.

## [ ] 8. Execution order

1. Phase 0 → verify → commit.
2. Phase 1 models → services → components → store → unit → live integration → commit.
3. Phase 2 chat route first, then skills/tools, then placeholders batch → commit.
4. Phase 3 styling → a11y → E2E → docker → evidence → commit.

## [ ] 9. Open items for build (defaults if unanswered)

- Keep `models/ + services/ + guards/` top-level layout (default YES; collapse to per-feature only if imports get messy).
- PrimeNG stays out until a Phase 2 widget proves need (default YES).
- `environments/` files: not in this plan (constants.ts only); revisit only if prod `SERVER_URL` injection demands it.
