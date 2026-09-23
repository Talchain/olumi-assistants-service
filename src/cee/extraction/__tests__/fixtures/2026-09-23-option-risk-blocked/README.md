# Real staging captures — the option→risk readiness block

`POST /assist/v1/draft-graph?schema=v3` against **deployed staging**
(`cee-staging.onrender.com`), 23 Sep 2026, HTTP 200. Trimmed to `nodes`, `edges`,
`goal_node_id` and `analysis_ready` — nothing else is read, and no value was edited.

| file | brief | nodes/edges | blocked options |
|---|---|---|---|
| `draft.json` | *Should I hire a Tech lead or two developers to increase productivity?* | 13 / 27 | **4 of 4** |
| `draft-hiring2.json` | same brief, second sample | 13 / 24 | 2 of 4 |
| `draft-pricing.json` | the canonical pricing brief | 10 / 13 | 2 of 3 |

⭐ **Why these are committed rather than hand-written.** Every `unresolved_targets`
entry in all three is a `kind: "risk"` node reached by an option→risk edge, and one
such entry blocks the whole option. A fixture I wrote myself could not establish
that — the corpus has to come from outside the author's head for a claim about the
wire to mean anything. `../option-risk-wire-replay.test.ts` replays them and fails
loudly if they are missing rather than passing vacuously.
