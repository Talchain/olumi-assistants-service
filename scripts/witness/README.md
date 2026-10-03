# Joined OpenAI witness

One command that drives RC's fast-path gate end to end and prints a PASS/FAIL per
assertion:

```
bash scripts/witness/joined-openai-witness.sh [output-dir]
```

`fresh brief → graph → suggest assumptions → deterministic approve → explicit Run
→ reload → provider purity`

Needs `RENDER_API_KEY` and `ASSIST_API_KEY` in
`olumi-assistants-service/.env.staging.local`. Drives deployed staging; writes
nothing but its own JSON captures. A construction turn is ~40–60s, so the whole
run takes about three minutes.

## Why each assertion is what it is

Every gate below came from a control falsified live on served `cd9b6158`, not from
a specification. The three that are easy to get wrong:

- **Served SHA is derived, never assumed.** It takes the deploy whose
  `status == "live"`, *not* the newest — a newer deploy is often still building
  while an older commit serves. CEE has no `/version.json`; the Render API is the
  only authority.
- **`_provider_calls_truncated` is checked by PRESENCE, not `=== false`.** The
  route emits it only when true (`agent-v1-turn.ts`, spread-conditional), so
  asserting `=== false` fails against a perfectly healthy ledger. Without this
  field "no Anthropic calls" and "none that fit" are indistinguishable (#1779).
- **The approve chip id is read back from the brief turn, never constructed.** The
  typed-approval path keys on the chip's own id, so a hand-built id would exercise
  a different branch than a user's click.

## What the gates assert

| gate | assertion | why |
|---|---|---|
| brief → graph | `draft_graph.node_count > 0` | the canvas has something to render |
| FP1 | `_provider_calls` purposes `== ['construction']` | one model call, no conversation rounds. Measured before: 5 calls / 3 hops |
| FP1 | assumptions offered as a chip | the approve path needs a typed target |
| FP2 | **zero** provider calls | RC: "0 model calls" |
| FP2 | `mutated === true` | the approval actually wrote |
| FP2 | no `run_analysis` in `tool_calls` | RC: "no surprise Run" |
| FP3 | exactly ONE provider call | deterministic analysis + one interpreting call |
| FP3 | `tool_calls == ['run_analysis']` | one deterministic run |
| reload | `analysis_state` or `analysis_ready` present | currentness survives |
| purity | ledger non-empty AND buckets sum to its length | a zero from an empty probe is worthless |
| purity | zero `anthropic`, counting `refused_before_network` | a refused call is still recorded, so zero means never attempted |

⚠ **Latency expectation.** The FP1 call-count drop is 5 → 1, but the surviving
constructor call is the dominant term — median 40–44s at `reasoning_effort:
'medium'` (`model-budgets.ts`). A fresh brief lands at **~40–44s, not ~12s**. The
user-visible win is that the graph reaches the wire as soon as register+readback
complete, instead of after two more conversation calls.

⚠ **Do not judge a change from one run.** Measured n=6 on identical briefs: mean
54.1s, sd 10.4s, **CV 19%**. Detecting a 35% effect needs n≥5 per arm, 30% needs
n≥7, 20% needs n≥15.

## Known gap this cannot yet assert

A replay under a fast path should return a **receipt bound to the proposal id**
without writing. `_agent.receipts` was populated in **0 of 18** witnesses,
including 13 where `mutated: true` — so that control is unproven. Add the
assertion once receipts surface.
