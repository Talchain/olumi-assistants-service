# PART B — the quality gate (the decision-maker)

The plan says speed must not outrank correctness, so QUALITY is the gate. This file
records (1) what quality means here in terms of the existing scorers, (2) the
deterministic analysis that WAS possible in this environment, (3) the exact runnable A/B
that closes the live gap, and (4) an honest statement of the gap.

---

## 1. The four quality dims → concrete, deterministic scorers (no LLM judge needed)

The eval/harness tooling already carries deterministic, pure-function scorers that run
without an API key. They score response TEXT via the REAL runtime guards (not re-specs),
so they cannot drift from production. Positive control: `pnpm eval:orchestrator` runs
GREEN on this branch — it correctly FAILs the regression candidates and PASSes the good
ones, so the machinery can SEE a presence (a real defect), which makes an absence result
meaningful.

| Task dim | Concrete scorer (source of truth) | Where |
|---|---|---|
| **substance** | `substance_present` — non-empty, non-whitespace `answer_text` prose (an empty answer is the live pre-v42.2g defect class, 0/6 populated). | `tools/orchestrator-eval` + harness `D`-substance |
| **grounding** | `no_goal_fit_conflation` (win% ≠ target-attainment), `no_held_science_vocabulary` (raw sensitivity/robustness/EVPI/VOI tokens), `no_forbidden_terms` = runtime `findForbiddenMatches` | `tools/orchestrator-eval/src` + `scorer/*` |
| **chip-correctness** | `D1-chip-no-repeat` (semantic repeat key), `D2-chip-presence-per-question-class` | `tools/conversation-harness/scorer/dims.ts` |
| **unsupported-claims** | `no_mutation_language` = runtime `containsMutationLanguage`; `no_false_success_claim` = runtime `findSuccessClaimHit` | `tools/orchestrator-eval` (D6) |

Key point: **these scorers are deterministic and key-free — they need the coach OUTPUTS as
input.** The missing ingredient is the adaptive-vs-disabled output pairs, not the scoring
capability.

---

## 2. Deterministic analysis done in THIS environment (no key required)

### 2a. The output-token drop is NOT prima facie a quality loss

The spike's headline — output tokens 1400-2158 (adaptive) → 464-564 (disabled) — is a
**total-output-token** count. On Sonnet 5, adaptive thinking tokens are generated AND
BILLED as output and share the `max_tokens` budget with the answer (Anthropic contract,
confirmed via the claude-api skill; the codebase says the same at
`route-with-tool-use.ts:52-54`). Therefore:

```
adaptive output_tokens  = thinking_tokens (invisible, dropped by CEE) + answer_text_tokens
disabled output_tokens  = answer_text_tokens
```

The observed drop is fully consistent with "removed ~900-1600 invisible thinking tokens,
visible `answer_text` roughly unchanged (~464-564 both ways)." It is ALSO consistent with
"the visible answer itself shrank." **Total output tokens cannot distinguish these.** The
only quality-bearing quantity is the visible `answer_text` length + content — which is not
in the spike's headline numbers and is not captured in the branch. This is the single most
important correction to the "tokens dropped sharply ⇒ shallower" reading.

### 2b. Structural invariants — the quality blast radius is BOUNDED

Disabling thinking changes only whether the model produces (invisible, CEE-dropped)
thinking blocks. Everything else on the coach turn is byte-identical: the `olumi_action`
tool schema, the `answer_text` channel, `temperature: 0`, `maxTokens:
V5_ROUTING_MAX_OUTPUT_TOKENS` (3072), the REPAIR_ONCE mechanism, and all downstream chip
generation (deterministic, post-routing). So the deterministic dims that are pure functions
of the response text — forbidden-terms, mutation-language, false-success-claim,
science-vocab, chip repeat/presence — are **structurally unaffected in shape**; only the
CONTENT the LLM writes into `answer_text` can move. That narrows the real quality question
to: *does Sonnet 5 reason as well into `answer_text` without the scratchpad, and does it
still route correctly?*

### 2c. Two DOCUMENTED, turn-specific degradation modes (the reason to HOLD)

The coach turn is a Sonnet-5 **tool-use** turn. The Anthropic model contract names two
degradations that apply precisely to disabling thinking on such a turn:

1. **Lower tool-call propensity.** "With thinking disabled, [Sonnet 5] is less likely to
   reach for tools or consider searching." Here the `olumi_action` tool call IS the
   routing decision (execute/coach/clarify). A drop in tool-call rate ⇒ more turns fall to
   plain text/converse ⇒ the coach stops guiding/challenging. This is a
   **chip-correctness + substance** risk, measurable as the `text_only` rate and the
   intent-class distribution across the fixture set.
2. **Reasoning leakage into the visible answer.** "May write longer reasoning into the
   visible response." Raw deliberation can land in `answer_text` ⇒ tone/verbosity shift and
   possible **unsupported-claims / forbidden-term** hits the egress cage did not see under
   adaptive thinking.

Both are exactly what the deterministic scorers above measure — once the paired outputs
exist.

### 2d. API validity (no 400 risk)

`thinking:{type:'disabled'}` is ACCEPTED on Sonnet 5 (contract + live-probe 2026-07-14 per
the adapter comment). The flag cannot brick the turn with a 400. (Contrast Fable 5, where
`{type:'disabled'}` IS a 400 — not in scope; the coach turn runs Sonnet 5.)

---

## 3. The runnable A/B that closes the gap (env-gated; keys by name only)

When a key + staging access are available, this produces the medians-both-ways + quality
scores + sample transcripts the verdict needs. Nothing here is Paul-gated (it does not flip
the served flag — it drives the flag per-CEE-process for measurement).

The harness's built-in A/B (`prompt-eval.sh`) contrasts two arms that differ by PROMPT
STORE. This lever differs by the SAME prompt but a per-process ENV FLAG, so the two arms
are booted by hand from the SAME store with `CEE_COACH_THINKING_DISABLED` set only on
arm B. The runner/scorer/verdict invocation shapes below are copied verbatim from
`prompt-eval.sh` (env-var driven — `RUN_DIR`, `BASELINE_DIRS`/`CANDIDATE_DIRS`/`AB_OUT`,
`STORE`/`PORT`).

```bash
# 0. Creds by NAME only — never echo values.
#    export OLUMI_ASSIST_KEY=...             # CEE assist key the runner sends
#    export ANTHROPIC_API_KEY=...            # for the local hermetic CEE arm to call Sonnet 5
cd tools/conversation-harness
STORE=$PWD/stores/staging-mirror.json        # SAME prompt store for both arms
J=journeys/enterprise-portfolio-prioritisation.json   # + the other journeys/ fixtures

# 1. ARM A (adaptive, baseline): boot CEE WITHOUT the flag.
STORE=$STORE PORT=3103 ./arm/boot-arm.sh $PWD/armA.log &  # flag unset = today's behaviour
for i in 1 2 3 4 5; do
  node runner.mjs --journey "$J" --arm "base-$i" --base http://localhost:3103 --out "runs/base-$i"
  RUN_DIR="runs/base-$i" npx tsx scorer/score-run.ts
done

# 2. ARM B (disabled): boot a SECOND CEE with CEE_COACH_THINKING_DISABLED=true.
CEE_COACH_THINKING_DISABLED=true STORE=$STORE PORT=3113 ./arm/boot-arm.sh $PWD/armB.log &
for i in 1 2 3 4 5; do
  node runner.mjs --journey "$J" --arm "cand-$i" --base http://localhost:3113 --out "runs/cand-$i"
  RUN_DIR="runs/cand-$i" npx tsx scorer/score-run.ts
done

# 3. A/B verdict (substance, grounding, chip-correctness, unsupported-claims, latency):
BASELINE_DIRS="runs/base-1,runs/base-2,runs/base-3,runs/base-4,runs/base-5" \
CANDIDATE_DIRS="runs/cand-1,runs/cand-2,runs/cand-3,runs/cand-4,runs/cand-5" \
AB_OUT="runs/ab-thinkdisable" npx tsx scorer/ab-verdict.ts
#    → runs/ab-thinkdisable/ab-verdict.md   (per-dim deltas + latency, N=5 median)
```

Representative fixture set: reuse `tools/conversation-harness/journeys/` (the enterprise
coach/clarify/execute journeys). If the spike's `coach-ab-2026-07-17` fixtures resurface,
add them as extra journeys — they were NOT present on `staging`/this branch at authoring
time. Verify each arm actually took effect on the wire: arm B's CEE `calling Anthropic for
chat with tools` log line must show `thinking:"disabled"` (the telemetry value this PR
adds); arm A must show `thinking:"none"`.

**Acceptance bar (the flip gate):** ARM B (disabled, sub-10s) passes ONLY if, across the
fixture set, it holds:
- substance ≥ ARM A (no drop in non-empty, on-topic `answer_text`);
- grounding + unsupported-claims: zero NEW forbidden/mutation/success-claim/science-vocab
  hits vs ARM A (watch for 2c-#2 leakage);
- chip-correctness: intent-class distribution and `text_only` rate not worse than ARM A
  (watch for 2c-#1 lower tool-call rate);
- latency: median < 10s (re-confirm the spike).

Capture N≥5 per arm; record medians both ways + per-dim scores + 2-3 sample transcripts per
arm into this directory (`ab-A-adaptive.json`, `ab-B-disabled.json`, `transcripts/`).

Positive control for the ABSENCE assertions (CLAUDE.md #13): the run must first prove it can
SEE a hit — include at least one fixture that legitimately triggers a forbidden/mutation
term so a "0 new hits" result is not vacuous.

---

## 4. The live-run gap (stated plainly)

- **No live A/B was run here.** `ANTHROPIC_API_KEY` is unset in this environment and staging
  is not reachable, so no adaptive-vs-disabled coach outputs were generated and **no
  empirical quality scores exist**.
- **No captured pairs to re-score.** `acceptance-evidence/coach-ab-2026-07-17/` (named in
  the task) is absent on `staging` and this branch, so the deterministic scorers could not
  be pointed at pre-existing transcripts either.
- The scorer chassis itself is proven live here (`pnpm eval:orchestrator` PASS, 6 fixtures,
  discriminates good vs regression) — the ONLY missing ingredient is the paired outputs.
- Inherited spike numbers (26s/9s; 1400-2158 → 464-564 output tokens) are PROVENANCE, not a
  re-measurement on this branch.

**Consequence for the decision:** the flip stays HOLD until §3 runs. The flag-dark landing
carries zero live risk (byte-identical off), so it can merge now; the quality verdict is a
one-command follow-up the moment a key is in hand.
