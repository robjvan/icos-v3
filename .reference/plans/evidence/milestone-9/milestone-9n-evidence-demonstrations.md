# M9n Evidence — End-to-End Demonstrations

## Claim

All five M9 demonstration flows hold together on the current tree,
in one session, against a real provider. No new code: this slice is
a consolidated pass over M9a–M9m.

## Run

- Server: working tree on `dev` (`c66cfeb` + M9l work), `PORT=3103`,
  tmp SQLite files, memory extraction off. Provider: OpenRouter
  `deepseek/deepseek-v4-flash-0731`.
- Session `db0d1089`, five turns:

| # | Flow | Result |
|---|---|---|
| 0 | Seed two facts | `ok`, completed run |
| D1 | Single-step: "What do I collect?" | `ok`, answered teal from context |
| D2 | Multi-step: both facts in one turn | `ok`, both answered correctly |
| D3 | Approval-gated rename | parked → approved → resumed `ok`, title durably `"M9n finale"` |
| D4 | Recovery: duplicate resume | byte-identical reply, no re-execution |
| D5 | Bounded repeat: "search three times, summarize" | `ok`, completed, 4 iterations / 1 execution |

## Honest notes

- D1/D2 answered from context without tool calls (model discretion
  with a short history — correct behavior, tools offered every
  turn). The multi-step *machinery* is proven by D5 (4 iterations,
  repeat-skip engaged, single execution) and by every earlier M9e
  live run, not by D2's tool count here.
- D5's repeat collapsed to 1 execution via the M9j skip path:
  observed in the run row (`toolSteps: 1` over 4 iterations) and in
  the ledger (single `succeeded` search row for the turn).
- Run rows: all five `completed`/`final_answer` with goals, step
  counts, and terminals; ledger rows resolve 1:1 with run request
  lists.

## Milestone close check

M9a run state · M9b lifecycle · M9c planning · M9d observations ·
M9e iteration · M9f termination · M9g budgets · M9h approval-aware
planning · M9i recovery · M9j loop protection · M9k context · M9l
cancel/restart · M9m verification · M9n demonstrations — all marked
`[x]` with evidence files. M9 is complete pending this commit.
