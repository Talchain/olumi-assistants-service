# Coach thinking-disable — latency lever verdict (POC-BOARD item 9)

**Date:** 2026-07-17 · **Branch:** `feat/coach-thinking-disabled-flag` (off `staging`)
**Flag:** `CEE_COACH_THINKING_DISABLED` (default OFF, Paul-gated)
**Scope:** the V5 coach/routing turn only (`orchestrator-v5/routing/route-with-tool-use.ts`
→ `chatWithToolsAnthropic`).

---

## The go/no-go, in one line

**Land the flag dark (GO). Do NOT flip it yet (HOLD) — the sub-10s win is real and
mechanically sound, but coaching quality is UNPROVEN in this environment and the
Anthropic contract names two specific ways disabling thinking on a Sonnet-5 *tool-use*
turn can degrade it. The token-drop headline is NOT evidence of degradation.**

| Question | Answer |
|---|---|
| Sub-10s latency? | **Yes** — inherited spike (real staging, N=5): median ~26s → ~9s. Mechanism verified API-valid (Sonnet 5 accepts `thinking:{type:'disabled'}`; not a 400). |
| Quality ≥ 26s baseline? | **UNPROVEN here.** No live key in this env and no captured adaptive/disabled transcript pairs in the branch, so no empirical quality score was produced. |
| Is the output-token drop (1400-2158 → 464-564) proof of "shallower"? | **No.** Under adaptive thinking, thinking tokens are generated AND BILLED as output and share `max_tokens` with the answer. The drop is consistent with "removed ~900-1600 invisible thinking tokens, visible answer roughly unchanged." Total-output-tokens cannot distinguish "tighter" from "shallower" — only the visible `answer_text` (+ routing correctness) can. |
| Net verdict | **TRADEOFF, quality-unquantified → flag-dark GO, flip HOLD.** Reclassify to WIN or NO-GO only after the live A/B in `part-b-quality-gate.md` runs. |

---

## Why "HOLD the flip," specifically (not just "we didn't measure")

Disabling adaptive thinking on this turn is not a neutral speed knob. The coach/routing
turn's entire job is to emit ONE `olumi_action` tool call that classifies intent
(execute / coach / clarify) and carries the user-visible coaching in
`explanation.answer_text`. The Anthropic model contract (claude-api skill, Sonnet-5
section) names two concrete degradation modes for exactly this shape:

1. **Reduced tool-calling propensity.** "With thinking disabled, [Sonnet 5] is less
   likely to reach for tools or consider searching." Here the tool call *is* the routing
   decision — a drop in tool-call rate surfaces as more turns misrouted to plain
   text/converse instead of a correct execute/clarify, i.e. the coach stops guiding.
2. **Reasoning leaking into the visible answer.** With thinking off the model "may write
   longer reasoning into the visible response" — raw deliberation can land in
   `answer_text`, changing tone/quality (and tripping the egress claim-safety cage in
   ways adaptive thinking did not).

These are the two things the live quality gate must measure. They are why total-output
tokens are the wrong proxy and why the flip is Paul-gated behind a real A/B.

---

## What is DONE and proven (PART A)

- Flag added, default OFF, **byte-identical when off** (proven by test + mutation-check).
- Scope is the coach turn only; V4 streaming path untouched.
- Gates all green on this branch: `pnpm test:required` 20979 passed / 0 failed · `tsc -p
  tsconfig.build.json` 0 errors · eslint clean on touched files · forbidden-boundary
  ratchet == baseline · typecheck ratchet within baseline · frozen telemetry registry
  green.
- See `part-a-mechanism.md`.

## What is NOT done (the honest gap — PART B)

- **No live A/B.** `ANTHROPIC_API_KEY` is unset in this environment and staging creds are
  not reachable, so adaptive-vs-disabled coach outputs were NOT generated. The
  quality scorers exist and run (positive control green), but they need the paired
  outputs as input.
- **No spike transcripts in the branch.** `acceptance-evidence/coach-ab-2026-07-17/` (named
  in the task) does not exist on `staging` or this branch, so a deterministic re-score of
  captured pairs was not possible either.
- The inherited spike numbers (26s/9s; 1400-2158 → 464-564 output tokens) are carried as
  PROVENANCE from the measurement spike — they were NOT re-measured on this branch.
- See `part-b-quality-gate.md` for the exact, runnable A/B recipe that closes this gap
  the moment a key is available, and for the deterministic analysis that WAS done.
