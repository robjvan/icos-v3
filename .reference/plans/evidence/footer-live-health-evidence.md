# Evidence — Live footer health (`GET /core/health` + web-client polling)

Branch: `dev`. Verified 2026-09-23 after rebuild (`docker compose up --build`).

## Scope

Footer (`web-client`) showed hardcoded placeholders (`ctx 216000/1M`, CPU 6.2,
RAM 32.3, always Online). No HTTP health endpoint existed — health was only
the `/health` slash-command text via the conversation API.

Per user decision: Context readout removed from the global footer (token
usage is per-session; future chat-UI work). Footer shows system-wide CPU %,
RAM %, Online/Offline. Poll default 5s, slider 1–30s in Client settings.

## Core changes

- `core/src/health/health-report.ts` (new) — `buildHealthReport()` shared by
  the slash command and the endpoint, so the two can never drift:
  `SessionStore.pingStores()` + `MemoryCandidateRepository.ping()` liveness,
  LLM `unknown` when configured (never claim healthy without a probe),
  `HostHealthProvider.collect()` (150ms CPU sample, best-effort nulls),
  overall `healthy` unless a check is `degraded`.
- `core/src/health/health.service.ts` + `health.controller.ts` (new) —
  `GET /core/health`, registered in `conversation.module.ts`.
- `core/src/commands/runtime-commands.ts` — `HealthCommand` delegates to
  `buildHealthReport()`; reply text unchanged (`data: { ...report }` spread
  for the `Record<string, unknown>` contract).
- Tests: `core/src/health/health-report.spec.ts` (4 cases: healthy,
  degraded store ping, unconfigured LLM, null probes); e2e
  `GET /core/health` in `core/test/app.e2e-spec.ts` (no LLM, no extraction).

## Web-client changes

- `src/constants.ts` — `HEALTH_ENDPOINT = '/core/health'`.
- `src/app/models/health.ts` (new) — mirrors core `HealthReport`.
- `src/app/services/health.service.ts` (new) — `fetch` via `CoreApiService`,
  `health`/`error`/`pollIntervalSeconds` signals, localStorage-backed
  interval clamped 1–30s (default 5s), errors degrade to `error` signal.
  `ramPercent()` helper (one-decimal, from bytes).
- `footer-component` — `computed()`s for `cpuUsage` (`n/a` when null),
  `ramUsage`, `serverStatus` (Online iff `status==='healthy'` and no error),
  `healthTitle` tooltip (OS · arch · cores); `setInterval` poll restarted by
  an `effect` on the interval signal; Context readout removed.
- `client-settings-tab` — 1–30s range slider bound to the service.

## Verification

- Core: `npx tsc --noEmit` clean; `npx eslint` on touched files clean;
  `npx jest src/health src/commands/builtin-commands` 22 passed;
  full `npx jest` 37 suites / 557 tests passed;
  `npm run test:e2e` 45 passed (incl. new `GET /core/health` case).
- Web: `tsc -p tsconfig.app.json` + `tsconfig.spec.json` clean; eslint clean;
  `npx ng test --watch=false` 35 files / 106 tests passed
  (incl. new `health.service.spec.ts`, rewritten footer + settings specs).
- Live (`docker compose up --build`, both services healthy):
  - `GET /core/health` → 200, e.g.
    `status: healthy`, `runtime: core/sessions/memory healthy, llm unknown`,
    `host: Debian 12 bookworm, arm64, 10 cores, cpu 1.3, mem 33.4%`.
  - `POST /core/conversation {"message":"/health"}` → same
    `{host, runtime, status}` data shape (shared builder).
  - Served bundle: `chunk-HOHUWOAD.js` contains `/core/health`,
    `chunk-DUTA5A6U.js` contains the `health-poll` range slider,
    `chunk-W4CEFV3M.js` renders `CPU:`/`RAM:` with no `Context:`,
    no `216000` placeholder anywhere, `chunk-KIMDQFD2.js` holds the
    `HealthService` (`pollIntervalSeconds`, `localStorage` persist).
