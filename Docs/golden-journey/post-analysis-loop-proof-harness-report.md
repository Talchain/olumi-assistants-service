# Post-analysis-loop proof harness — RED baseline + blind-spot closure

**Track B (parallel eval/proof).** Recovers the existing golden-journey harness onto
a clean `origin/staging` base and closes the four lived post-analysis defects with
named, reviewable invariants. Produces a deterministic **RED baseline** that names
each defect and the CEE acceptance requirement to turn it green.

## Provenance

- **Base SHA:** `ed93c0ad` (`origin/staging`, "Spine A — suppress option-controlled
  levers", #308). Worktree branch: `eval/post-analysis-proof`.
- **Mode:** deterministic replay only. **No live cee-staging run** was performed
  (not authorised for this pass).
- **Repo note:** shallow clone; `merge-base` with other branches is empty (expected).
  The current `zen-chaplygin` working branch had *dropped* the harness — Track B was
  built on a fresh `origin/staging` worktree where it exists.

## What already existed (reused, not rebuilt)

- `tools/golden-journey-harness/` — the offline+live post-analysis journey runner,
  pure A1–A7 classifiers, 6-component taxonomy, classified markdown report, and the
  deterministic `--replay` self-test fixture.
- `tools/v5-journey-replay/` — HTTP client, deploy/preflight/auth gates, secret
  redaction, `forbidden-terms` + `assertions` (mutation-ack / clarification / denial
  patterns), `format-timings`. The new invariants **reuse** these detectors; they
  invent no new prose heuristics.

## What was added (blind-spot closure for the four lived defects)

| defect (lived) | new invariant | gating? | how it's proven |
|---|---|---|---|
| 1. Phantom success on a non-committing edit | **A8** no phantom success | **gating** | **role-agnostic** (runs on every turn except committed `mutate`/draft/analysis). The **graph hash is authoritative**: an opening success claim (or, on `mutate_intent`, any mutation-ack) with an unmoved `current_graph_hash` OR a `proposed_*`-only turn ⇒ fail. A non-mutating handler is NOT treated as proof of a commit. No hash + not a proposal ⇒ inconclusive (acceptance requirement), never pass. Opening-anchored detection (mirrors the product's `SUCCESS_CLAIM_PATTERNS`) so descriptive prose like "…reflects the updated Budget importance" does not false-fire |
| 2. AI-facing context not observable | **A9** context observable on the wire | inconclusive = requirement | looks for `_context_summary` / `trace.context_summary`; absent everywhere today ⇒ inconclusive + explicit CEE acceptance requirement (complements A2's in-process proof) |
| 3. Latency / wrongful escalation on deterministic-eligible turns | **A10** latency + escalation | advisory | reads `_timings.turn.total_ms` (+ `llm_calls_used`); `llm_calls=0` turns get a tight 1.5 s budget, draft/analysis/LLM get generous budgets; **AND** a deterministic-eligible turn (`mutate`/`mutate_intent`/`explain_changed`) that made ≥1 LLM call is flagged as **wrongful LLM escalation even within the time budget**. Advisory + per-turn latency summary table |
| 4. Premortem/challenge mishandling | **A11** premortem handled safely | advisory | safe-handling only — structural framing + a clear next step + no overclaiming (reuses the success-claim / leakage detectors) |

New journey turns: `9_mutate_intent` (non-committing) and `10_premortem`; synthetic
coverage steps renumbered to `11_verify_chips` / `12_capture_debug`. Report gained a
**CEE acceptance requirements** section (derived from inconclusive findings) and a
**latency summary** table.

## Baseline results (deterministic replay)

| fixture | command target | findings | exit |
|---|---|---|---|
| all-green self-test | `fixtures/golden-journey-v1.json` | **0 fail**, 2 inconclusive (A2, A9 = context acceptance requirements) | **0** |
| **RED baseline** | `fixtures/golden-journey-v1-defects.json` | **3 fail (1 gating A8 + 2 advisory A10/A11)**, 2 inconclusive (A2, A9) | **1** |
| real-defect regression (sanitized) | `fixtures/golden-journey-v1-f4835349-regression.json` | **1 advisory fail (A10 escalation)**, A8 **pass** (honest), 2 inconclusive (A2, A9) | **0** |

RED baseline detail:
- **A8 (gating):** `9_mutate_intent` — *"Updated the Budget factor … now"* with the
  graph hash unchanged ⇒ phantom success on a no-op edit.
- **A10 (advisory):** `9_mutate_intent` — deterministic turn (`llm_calls=0`) at 2300 ms
  over the 1500 ms budget.
- **A11 (advisory):** `10_premortem` — discuss-only turn opens with a success verb
  ("Updated the model…") ⇒ overclaiming.
- **A9 + A2 (inconclusive → acceptance requirements):** no wire context summary on any
  turn ⇒ context completeness provable in-process only.

## Validation against the real lived defect (read-only, build f4835349)

Before treating the harness as gate-ready, the new invariants were validated against
the **real** persisted turn (row `a9da06f2`), not only the synthetic fixtures. Server
facts were pulled **read-only** from staging (`v5_conversation_turns`): `turn_class=direct_answer`,
**`handler_id=null`**, **`llm_calls_used=1`**, **`duration_ms=11347`** (~11.3 s), a
`proposed_concept` pending action (proposal, not a commit), graph hash `acfa3515`
unchanged. The persisted assistant text was reconstructed transiently (kept in
session scratch only — **not** committed, copied into this report, or logged).

**Finding — the real turn is HONEST on the A8 axis.** The assistant text opens
*"…the model change failed because…"*, offers two proposals, and ends *"Which would
you like to try?"* — it makes **no** mutation-success claim. So:

| invariant | current code | hardened code | correct? |
|---|---|---|---|
| **A8** | pass (but only because it was role-gated to `mutate_intent`) | **pass** — text is honest; verified the success-claim tokens are absent | ✅ no false-positive; and now role-agnostic so a *genuine* phantom claim on a `direct_answer`/`explain` turn would be caught |
| **A10** | **pass (missed it)** — 11347 ms < 12 s LLM budget | **fail (advisory)** — *wrongful LLM escalation*: a deterministic-eligible proposal turn made 1 LLM call | ✅ now caught |

So the real lived defect this turn exemplifies is the **A10 wrongful-LLM-escalation /
latency** one (an edit-failure + proposal that should be handled by the deterministic
gate took an ~11 s LLM route), not an A8 false-success. The harness reports this
faithfully. Two hardening fixes were driven by this validation:

1. **A8 made role-agnostic + hash-authoritative.** It previously only ran on the
   synthetic `mutate_intent` step (would have missed a phantom claim on the real
   `direct_answer` turn) and briefly mis-credited a non-mutating `handler_id` as proof
   of a commit. The graph hash is now the sole authoritative durability signal;
   handler/proposal are evidence/secondary signals. Claim detection is opening-anchored
   so honest descriptive prose ("…the updated Budget importance" on a reload) does not
   false-fire.
2. **A10 widened** to flag wrongful LLM escalation on deterministic-eligible roles even
   when the turn lands inside the generic LLM time budget.

A **sanitized, committable** reproduction lives at
`fixtures/golden-journey-v1-f4835349-regression.json` (generic decision content):
A8 **pass** (honest proposal) + A10 **advisory** (escalation) + A9/A2 acceptance
requirements. The real assistant text is never stored.

## Capability 2 acceptance target

`golden-journey-v1-f4835349-regression.json` is retained as a **permanent durable
real-defect baseline** and the **Capability 2 acceptance target**. The target is
encoded in the fixture's `capability_2_acceptance_target` block:

| | `llm_calls_used` | A8 | A10 |
|---|---|---|---|
| **today (baseline)** | 1 | pass (honest proposal) | **advisory fail** — wrongful LLM escalation |
| **accepted when** | 0 | pass | pass — no escalation |

Capability 2 is accepted when the same deterministic-eligible mutation-intent/proposal
turn is handled by the deterministic gate (`llm_calls_used=0`) and A10 no longer fires
the escalation advisory. Until then:

- **A10 stays ADVISORY** — this fixture must **not** be a hard CI failure. It is tracked
  evidence in the deterministic harness/report set, not a gate (replay exit code = 0).
- **A8 must remain a pass** — the real answer is honest (proposal, not a phantom-success
  claim); a regression to phantom-success would flip A8 to a gating fail.
- It is **deterministic-only evidence** — never a live staging run.

## Commands run

```bash
# fresh worktree off origin/staging (ed93c0ad)
git worktree add -b eval/post-analysis-proof .claude/worktrees/eval-post-analysis-proof origin/staging

# green self-test (exit 0) and RED baseline (exit 1)
tsx tools/golden-journey-harness/index.ts --replay tools/golden-journey-harness/fixtures/golden-journey-v1.json         --out Docs/golden-journey/golden-journey-v1-report.md
tsx tools/golden-journey-harness/index.ts --replay tools/golden-journey-harness/fixtures/golden-journey-v1-defects.json --out Docs/golden-journey/golden-journey-v1-defects-baseline.md

# unit tests (run via main-repo binaries with --root <worktree>, LOG_LEVEL=fatal)
vitest run --root <wt> tests/unit/golden-journey-harness   # 52 passed
tsc --noEmit -p tsconfig.json                              # 0 errors in changed files
```

> Worktree note: the worktree's tracked `node_modules` is partial (missing
> `esbuild`), so `tsx`/`vitest` are run from the **main repo's** binaries with
> `--root <worktree>` (per the repo's worktree discipline).

## Test + typecheck results

- **Harness unit tests:** `tests/unit/golden-journey-harness` — **57/57 pass**
  (56 invariant cases incl. A8–A11, the role-agnostic/hash-authoritative A8 cases, and
  the A10 wrongful-escalation cases + 1 context-completeness).
- **Typecheck:** **0 errors in any changed file**; the 543 inherited `tsc` errors are
  all in pre-existing test files (none in paths Track B touched).
- **Regression sweep:** `tests/unit/v5-journey-replay` has **5 inherited-red** cases
  (in `what-changed-denial.test.ts` + `explain-leader-stale-chips.test.ts`). Proven
  **not PR-caused**: those test files and their imported `tools/v5-journey-replay/*`
  sources are byte-identical to `origin/staging` (`git diff --name-only origin/staging`
  is empty) and import none of the changed harness code. Contract tests
  (`v5-golden-path-acceptance`, `fixtures-schema`) pass.

## What this harness can and cannot prove

**Can prove (deterministically, in CI):**
- A non-committing edit that claims success without moving canonical state (A8) — the
  headline lived defect — fails the gate.
- Premortem overclaiming and slow deterministic turns are detected (A10/A11 advisory).
- The happy path (all-green fixture) stays green, so the gate is not a blanket red.

**Cannot prove yet (reported as CEE acceptance requirements, not passes):**
- **Live** behaviour — no staging run this pass; the RED baseline encodes *observed*
  defect shapes, pending live re-capture for a true product baseline.
- **A9 / A2 context completeness on the wire** — needs the canonical-state M3
  `_context_summary` surface; until then A2 is in-process-only and A9 is inconclusive.
- A8's phantom-success verdict needs the **graph-hash trio on edit-intent turns**;
  without it A8 is inconclusive, not pass.

## Acceptance-gate readiness

- **Deterministic replay: ready as a gate.** The green self-test (exit 0) is a stable
  regression gate; the RED baseline (exit 1) is the documented target the
  post-analysis-loop brief must move toward. A8 gating is safe (a false-fail is the
  safe direction).
- **Live: evidence-grade, not a hard gate** — variance-prone and needs the staging key
  + trace flag; run it for real evidence once authorised.

## Recommended future invariants (deferred per scope)

- **Spine-A controlled-lever suppression** — assert option-controlled levers never
  surface in tunable-driver prose (needs a controlled-lever fixture/turn).
- **Scientific-overclaiming egress** — a Tier-0 held-science claim filter on
  `direct_answer`/explanation prose.

Both should be added only with deterministic evidence behind them; until then they are
recommendations, not gates.

## Rollback

Pure additive, eval-only. Remove the worktree (`git worktree remove`) and drop the
`eval/post-analysis-proof` branch. No runtime/product code, schemas, contracts,
migrations, or dependencies were touched. Generated `Docs/golden-journey/*` artefacts
carry no runtime effect. Nothing pushed.
