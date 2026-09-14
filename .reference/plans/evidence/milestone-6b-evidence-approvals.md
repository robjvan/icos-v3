# Milestone 6b — Approvals Evidence

Date: 2026-09-11
Scope: structured human-approval state only (M6c clarifications pending).

## Design decisions

- Persistence: `approvals` + `approval_events` tables in the sessions DB (FK `session_id → sessions`, cascade). No background sweeper: `expiresAt` flips to `expired` lazily on every read, with the event recorded by whichever read lands the transition (guarded against double-record races).
- API (`/core/approvals`): create (201) → list (session/status filters) → get (embeds event trail) → approve/reject/cancel. Every mutation requires the owning `sessionId` in the body.
- Errors: unknown id → 404, wrong-session binding → 400 (no cross-session oracle beyond that), terminal re-resolve → 409. Malformed DTOs → 400 via the global pipe.
- Transcript isolation: approvals write zero message rows. History is purely conversational; the event trail lives in `approval_events` and rides the approval detail view.
- Concurrency policy: conversation messages never resolve approvals (no linked task exists until M8 tools); multiple pending per session allowed, disambiguated by id. `forkSession` copies transcript only, not approvals.
- Security invariant: no path exists from `ConversationService`/LLM to the approval repository. Proven by an e2e where the model says "Sure, you approved that" and the request stays pending.
- Test client: polls pending approvals per session, renders cards with explicit Approve/Reject buttons. No in-client create affordance (requesters arrive with M8 tools; curl covers creation until then).

## Verification

- Unit: 159 passed (20 new: lifecycle incl. all three terminal states, filters, lazy expiry on get + list, unexpired stays pending, event order, service session-binding + HTTP mapping).
- E2E: 22 passed (3 new: full lifecycle, error-path matrix, LLM-text-cannot-approve + transcript isolation).
- `tsc` clean, `eslint` clean. M1–M6a suites green, unchanged.
- Live (no LLM involved): `/new` → create → pending list (1) → approve → events `[created, approved]` → double-approve 409 → transcript 0 rows. Test-client HTML serves with approval UI.
