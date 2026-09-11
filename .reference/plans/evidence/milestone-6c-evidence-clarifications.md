# Milestone 6c — Clarifications Evidence

Date: 2026-09-11
Scope: structured clarification/question state. Closes M6.

## Design decisions

- Persistence: `clarifications` + `clarification_events` tables in the sessions DB, mirroring the approvals pattern deliberately without merging: approvals gate actions, clarifications supply information, payloads resolve differently. A shared interaction abstraction stays future work until M8/M9 proves the common shape.
- Answer contract: free-form when no options; when options exist (2–10 unique, validated at the DTO boundary) the answer must equal one option, else 400. Invalid attempts leave the request pending.
- Resume semantics: the answer is stored on the request and readable via the detail view — that is the handoff surface the future pending task resumes from. Answers are never injected into the transcript, and ordinary conversation never resolves a question (proven: a chat turn answering the question in prose leaves it pending).
- Errors: unknown id → 404, wrong-session → 400, double-answer/cancel → 409, lapsed → `expired` via the same lazy-expiry pattern (no sweeper).
- Concurrency: same policy as approvals — multiple pending per session allowed, disambiguated by id; fork copies transcript only.
- Race hardening (also backported to approvals `resolveApproval`): terminal UPDATEs check `changes`; a lost race re-reads the real state for the 409 message instead of double-recording events.
- Test client: pending question cards with radio choices or free-form input, Answer + Dismiss (cancel), refreshed on open/send/resolve. Same poll-and-resolve contract as approvals, so a future frontend implements one pattern for both.

## Verification

- Unit: 172 passed (13 new: choice membership, empty-answer rejection, invalid attempts keep pending, filters, lazy expiry, event order, service binding + HTTP mapping).
- E2E: 25 passed (3 new: full lifecycle with answer availability, error matrix incl. off-option/wrong-session/double-answer, conversation-never-resolves + transcript isolation, option-set validation).
- `tsc` clean, `eslint` clean. M1–M6b suites green, unchanged.
- Live (no LLM): create with options → pending poll → answer `Staging` → double-answer 409 → transcript 0 rows. Client HTML serves with question UI.
- Flake note: one unit run showed 2 failures under heavy parallel load (build + tests + servers); 5 consecutive clean runs of 172 after, plus clean e2e. No cause found in test logic; treated as environmental.

## M6 close-out

Three distinct paths now exist: `/command` → deterministic Core action; conversation → LLM; pending interaction (approval | clarification) → explicit resolve by id. Commands never reach the LLM, LLM text never resolves interactions, interactions never pollute the transcript. The frontend contract for both interaction kinds is: poll pending per session, render by kind, resolve by id.
