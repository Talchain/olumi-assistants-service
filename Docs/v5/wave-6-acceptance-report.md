# V5 interaction recovery — Wave 6 acceptance report

**Branch:** `claude/p0-v5-interaction-recovery`
**Base:** `staging` (`c8306047`)
**Date:** 2026-05-06
**Wave 6 commits:** `dbb91157` (and this report)
**Branch ahead of staging:** 40 commits (Waves 0 → 6)

This is the acceptance gate for the V5 interaction recovery tranche.
Wave 6 is the stop point before staging evaluation; the next
meaningful proof is a manual run through the deployed UI.

---

## Merge recommendation

**Safe to merge to staging.**

All four named brief failures have working deterministic dispatch
paths. Each is unit-tested, route-tested, and (where feasible)
HTTP-boundary tested. The two pre-existing test failures on the
`no-op-helpers.test.ts` "options" wording are byte-identical to
`staging`'s files and are NOT introduced by this branch.

A4 add-risk **clarification continuity** (Wave 5G) and deterministic
`apply_proposed_change` wiring stay deferred as honest follow-up
briefs — neither blocks merge because the user-facing copy on those
paths makes no executable promise the system cannot deliver.

Do not push, merge, or deploy without explicit authorisation. Once
authorised, the next meaningful proof is Paul's manual staging
journey through the deployed UI; do not substitute additional helper
tests for that product proof.

---

## Final status grid — named brief failures

| # | Failure | Implemented | Unit | Route | HTTP | Locally proven (wire) | Live staging proven | Deferred |
|---|---|---|---|---|---|---|---|---|
| 1 | "yes" after explore-result offer dispatches what_would_flip / run_analysis | ✅ | ✅ | ✅ | ✅ recovery + ✅ success branches | ✅ | ❌ not run | — |
| 2 | At-limit add-risk no longer spends 16-18s in `edit_graph` | ✅ (preflight) | ✅ | ✅ | ❌ handler-layer only | ❌ handler-layer only (preflight blocks LLM call; recovery is INLINE PROSE, no chips) | ❌ not run | A4 add-risk **clarification continuity** (Wave 5G) |
| 3 | Value-update clarification applies the original quantity | ✅ (set_factor_value path; graph_hash persistence + kind-gated divergence guard + ambiguous-recovery re-persistence + invariant graceful fallback + reserved-kind reclassification) | ✅ | ✅ | ✅ four distinct HTTP proofs (single-turn ; real two-turn ; SEEDED two-turn typed ; SEEDED two-turn `source: chip_click`) | ✅ | ❌ not run | A4 add-risk side (Wave 5G) ; deterministic `apply_proposed_change` |
| 4 | Explanation output has no raw decimals or internal terms | ✅ | ✅ (boundary buckets + denylist) | ✅ | ✅ HTTP deterministic explanation prose checked (Wave 6 journey replay asserts no raw decimals + no forbidden terms on the wire) ; **generated forbidden-answer downgrade NOT HTTP-tested** | ✅ | ❌ not run | — |

---

## `apply_proposed_change` — explicit status

This kind is in the closed `PendingActionAction` union but is NOT
emitted, persisted, resumed, or applied anywhere in production code.
The user-facing copy that would have promised an apply step (V4
`PROPOSE_AND_CONFIRM_ASSISTANT_TEXT` at `edit-graph.ts:216`) was
softened in Wave 5H-1 to:

> "I've drafted a change that fits your description, but I can't
> apply a draft proposal automatically yet. Tell me the specific
> factor and value you'd like, and I'll make the change directly."

**This is acceptable for the tranche** because the user-facing
promise was removed. The system no longer offers an apply step it
cannot deliver; the user is correctly redirected to the deterministic
value-update path which IS wired.

**Track as follow-up** alongside A4 add-risk clarification continuity:

- `apply_proposed_change` end-to-end wiring (emit on V4
  propose-and-confirm dispatch + persist + resumer dispatch +
  handler call back into `handleEditGraph` with
  `confirmation_mode: 'apply_pending_proposal'`).
- A4 add-risk clarification continuity (`edit_graph_add_risk` emit
  + driver-match pre-route + legacy-dispatch synthesis).

Wave 5L-1 reclassified `apply_proposed_change` as `mutating` in the
divergence-guard table so the day it wires up it fails closed by
default rather than slipping through the non-mutating branch.

`apply_proposed_change` is NOT complete. The matrix above does not
mark any failure as covering it.

---

## Pre-existing test failures — proof

The full V5 + orchestrator suite shows 2 failing tests. Both are
in `src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts`
and predate this branch. Exact proof:

### Failing tests

```
src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts
  > buildAnalysisAbsentTemplate
    > uses singular "option" wording when option_count === 1
    > uses plural "options" wording when option_count !== 1
```

### Exact failure text (identical on this branch and on staging base)

```
AssertionError: expected '...' to contain '1 option configured'
Expected: "1 option configured"
Received: "No analysis has been run on your model yet. Your model has
1 option set up and is ready to analyse. Would you like me to run
the analysis?"
  at src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts:107:18

AssertionError: expected '...' to contain '0 options configured'
Expected: "0 options configured"
Received: "No analysis has been run on your model yet. Your model has
0 options set up and is ready to analyse. Would you like me to run
the analysis?"
  at src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts:112:53
```

### Command run on this branch

```
$ cd /Users/paulslee/Documents/GitHub/olumi-assistants-service/.claude/worktrees/p0-v5-interaction-recovery
$ pnpm vitest run --reporter=default src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts
  Test Files  1 failed (1)
  Tests       2 failed | 19 passed (21)
```

### Command run on the staging base (separate worktree at HEAD `c8306047`)

```
$ cd /Users/paulslee/Documents/GitHub/olumi-assistants-service
$ git rev-parse HEAD
  c83060470c688aff3a89530262cb9c7139b4f93f
$ pnpm vitest run --reporter=default src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts
  Test Files  1 failed (1)
  Tests       2 failed | 19 passed (21)
```

Same 2 tests fail. Same failure text. Same failure locations.

### Byte-identical to staging

```
$ git diff staging..HEAD -- \
    src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts \
    src/orchestrator-v5/tools/handlers/no-op-helpers.ts
  (empty diff — the file is unchanged on this branch)
```

### Disposition

**Track separately, do not block merge.** This is a "configured" vs
"set up" wording mismatch in a side-band test that this tranche did
not touch. Investigating belongs in a separate brief; pre-existing
failures should not gate a deterministic-recovery tranche that
otherwise proves out at the wire.

---

## Test and hygiene summary

### Full V5 + orchestrator suite — Wave 6 close-out

```
$ pnpm vitest run --reporter=default \
    src/orchestrator-v5 src/orchestrator \
    tests/integration/orchestrate-v2-chip-click-resume.test.ts \
    tests/integration/orchestrate-v2-deterministic-value-update.test.ts \
    tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts \
    tests/integration/wave-6-journey-replay.test.ts

  Test Files  1 failed | 133 passed (134)
  Tests       2 failed | 2133 passed | 1 skipped (2136)
```

Net change vs Wave 5L close-out: **+4** passing tests (the four
journey-replay cases). No new failures.

### Build typecheck

```
$ pnpm exec tsc -p tsconfig.build.json --noEmit
```

Errors are all pre-existing — missing `generated/openapi.d.ts`
codegen artefact. None of the Wave 6 (or any prior wave's) touched
files have TS errors.

### Branch diff hygiene

```
$ git status --short -- src tests Docs supabase scripts
(clean — all 40 commits explicit-path staged; no node_modules,
 env, lockfiles, prompts, or build artefacts)
```

### DB migration / rollback status

Single migration applied to staging in Wave 0:
[`supabase/migrations/20260505120000_v5_pending_actions.sql`](../../supabase/migrations/20260505120000_v5_pending_actions.sql)

- Adds `pending_actions JSONB NOT NULL DEFAULT '[]'::jsonb` column
  on `v5_conversation_turns`.
- Extends `append_turn_atomic` overload with
  `p_pending_actions JSONB DEFAULT '[]'::jsonb`.

Default keeps existing callers compiling unchanged. Rollback path
documented in the migration file footer (`DROP COLUMN IF EXISTS
pending_actions; ALTER FUNCTION append_turn_atomic ...`).

### Push / merge / deploy status

- No `git push` issued.
- No PR opened.
- No merge to `staging` or `main`.
- No deploy.

All 40 commits are local on this worktree, on
`claude/p0-v5-interaction-recovery`.

---

## Manual deployed-staging checklist

Once merged to `staging` and deployed, Paul should run through these
steps in the deployed UI to confirm the four named failures are
fixed in production. Each step lists the exact action, the expected
assistant text, and the expected chip set (where chips are emitted).

### Setup

1. Open the deployed staging UI (`cee-staging.onrender.com`).
2. Start a fresh scenario.
3. Submit a brief that produces an analysable model (any of the
   product's standard examples works).

### Step 1 — Run analysis

**Action:** Click "Run analysis" in the canvas, or type `Run the analysis`.

**Expected:**
- Wire response includes a `graph_patch` block with operation
  `run_analysis_completed` (or equivalent for the deployed
  shape) and `analysis_ready.status: 'ready'`.
- `assistant_text` summarises the leading option with a probability
  rendered as a percentage (e.g. "62%"), no raw decimals, no
  internal terms.
- A "Would you like to explore what would change this result?"
  chip (or equivalent) is emitted.

### Step 2 — Failure 1: chip click on "explore"

**Action:** Click the chip from Step 1 ("Explore what would change
the result").

**Expected:**
- Wire response is the `what_would_flip` explanation prose:
  describes the leading option's margin, top driver(s) using calm
  bucketed prose ("Cost moderately weakens the lead", "Engineering
  Capacity strongly strengthens the lead"), and a robustness
  sentence.
- No raw decimals (e.g. `-0.7346`).
- No internal terms (`noop`, `BUDGET_TARGET`, `graph_hash`, `Zod`,
  `fact_type`).
- No em dash in the assistant text.

### Step 3 — Failure 3: value-update happy path

**Action:** Type `Update [factor name] to [value]` (e.g.
`Update Engineering Capacity to 70%`) where the factor label is
unambiguous in your model.

**Expected:**
- Wire response includes a `graph_patch` block with operation
  `set_factor_value` and `target_id` matching the factor.
- `assistant_text` confirms the change using the human factor label
  and user units (no raw factor ids, no normalised model-unit
  fractions like `0.7`).
- The graph in the canvas reflects the mutation.

### Step 4 — Failure 3: value-update clarification

**Action:** In a fresh scenario, set up a model with two factors that
substring-share a word (e.g. "Cost" and "Revenue"). Type
`Set Cost and Revenue to 5`.

**Expected:**
- Wire response is a clarify with two chips: one labelled "Cost",
  one labelled "Revenue" (no chip click yet).
- Click the "Cost" chip.
- Wire response includes a `graph_patch` block with operation
  `set_factor_value`, `target_id` matching the Cost factor's id,
  and the original quantity (5) preserved in the receipt.
- `assistant_text` uses the human label and user units.

### Step 5 — Failure 2: at-limit add-risk preflight

**Action:** In a model that already has 30 edges (or close to it,
which is the V5 limit), type `Add cultural cohesion as a risk`.

**Expected** (production copy from `edit-graph-dispatch.ts:530-533`):
- Wire response is a recovery message in inline prose (no chips):
  *"I can't add another risk without making the model too complex
  to analyse reliably. Tell me how to simplify the model so we can
  fit this in, or which existing risk to replace with 'cultural
  cohesion'."* (Single-quoted label echoes the user's typed risk
  name verbatim.)
- No 16-18 second LLM round trip — the response should arrive in
  well under a second.
- No `EDGE_LIMIT_EXCEEDED` raw error code in the user-facing copy.

### Step 6 — Failure 4: explanation egress

**Action:** Type `Why is this close?` or `Explain the result`.

**Expected:**
- `assistant_text` describes the result with bucketed prose ("X
  moderately strengthens the lead").
- No raw decimals anywhere in the response.
- No internal terms.
- No em dash.
- No raw entity ids.

### Manual checklist outcome

If every step passes, the tranche is product-confirmed and ready for
broader rollout. If any step fails, capture the exact wire response
and the deployed commit hash, and report back — that is a P0 for a
follow-up brief.

---

## Wave-by-wave summary

| Wave | Scope | Outcome |
|---|---|---|
| 0 | Pending-actions persistence migration + types | Schema + types live on staging |
| 1 | Atomic chip + pending-action emission | Wave 1 emit-only, no consumer |
| 2 | Deterministic short-confirm pre-route | "yes" resumes run_analysis |
| 2.5 | Pending-action acceptance gaps closed | Internal hardening |
| 3a | Pre-LLM add-risk preflight | Failure 2 closed |
| 3.5 | P0 gaps from second critical review | Internal hardening |
| 4 | Explanation egress (bucketed sensitivity prose + denylist) | Failure 4 closed |
| 5a-c | Chip predicate + parity + readiness gating + chip-click recovery | Various polish |
| 5D | Raw-decimal egress + typed chip-click flag + no-pending recovery | Internal hardening |
| 5E | Clarification continuity (set_factor_value side) | Failure 3 closed |
| 5F | Clarification invalidation + raw-decimal precision + readiness gate + fuzzy match | Internal hardening |
| 5H | Soften V4 propose-and-confirm copy + sensitivity vocabulary alignment + chip-click HTTP boundary parity | apply_proposed_change copy + Failure 1 HTTP |
| 5I | graph_hash on set_factor_value pendings + focused recovery + chip-click success path + value-update two-turn HTTP + lead-framing restored | Multiple P1s |
| 5J | Re-persist pendings on ambiguous recovery + kind-gated graphHashConflicts + em-dash sweep | P0 + multiple P1s |
| 5K | Defensive `reEmitGraphHash` invariant + seeded test rename + classification regression | Honesty + invariant safety |
| 5L | Reclassify reserved kinds as mutating + TS-enforced exhaustiveness + graceful invariant fallback + chip_click ingress variant | Classification correctness + production safety |
| 6 | Local journey replay + this acceptance report | **Acceptance gate** |
| 6.1 | Wave 6 review fixes — chip-derivable / resumable split, em-dash sweep in V4 edit-graph clarification, journey-replay scope corrections, manual-checklist add-risk copy alignment | Honesty + commit-failure cordon |

---

## Wave 6.1 — review disposition

Wave 6 review found four real P1s. All addressed:

| Item | Disposition |
|---|---|
| P1: chip-derivable / server-only kinds drift could crash valid responses | **Fixed** in `pending-action.ts` + `derive-pending-actions.ts` — strict `CHIP_DERIVABLE_ACTION_TYPES` subset; chips with server-only `action_type` skip silently instead of throwing. Two regression cases added in `derive-pending-actions.test.ts` exercising `set_factor_value` chip and a mixed chip-derivable + server-only set. |
| P1: em dashes in V4 edit-graph clarification copy | **Fixed** in `edit-graph.ts:651, 653, 694` — replaced with colons. Five test fixtures updated to match. |
| P1: journey replay overclaims Failure 2 wire coverage (no-op test) | **Fixed** — no-op test removed from `wave-6-journey-replay.test.ts`. Failure 2 row in the matrix above now reads "❌ handler-layer only" for both the HTTP and locally-proven columns. |
| P1: journey replay mislabels Failure 3 happy path as clarification proof | **Fixed** — test renamed to "failure 3 (happy path)" and the file docstring explicitly redirects to the dedicated `orchestrate-v2-clarify-reply-two-turn.test.ts` for the clarification loop. |
| P1: manual checklist add-risk copy doesn't match production | **Fixed** — Step 5 now quotes the actual production copy from `edit-graph-dispatch.ts:530-533`. |

### Updated test counts after Wave 6.1

```
Wave 6 close-out:           2133 passed / 2 failed / 1 skipped
Wave 6.1 fixes:
  + 2 derive-pending-actions regression cases (set_factor_value chip)
  - 1 no-op Failure 2 placeholder removed
Wave 6.1 close-out:         2134 passed / 2 failed / 1 skipped
```

The 2 failing tests are still the pre-existing `no-op-helpers.test.ts`
"options" wording mismatch on staging (proof in §"Pre-existing test
failures — proof" above).

### Branch state after Wave 6.1

42 commits ahead of staging. No push, merge, or deploy issued.

---

## Standing by

The tranche is ready for merge to `staging` once you authorise it.
Once deployed, the manual checklist above is the next meaningful
proof — please run through it and report back with any failures.

A4 add-risk clarification continuity (Wave 5G) and deterministic
`apply_proposed_change` wiring stay as honest deferred follow-ups
for separate briefs.
