# Deterministic spine — end-to-end verification on deployed staging
**22 September 2026 · build `c12a54d` (`degraded:false`) · AI Coaching / Core**

Every result below was executed against deployed staging or the live database this
session. Nothing is inferred from a comment, a docblock or a previous document.
Where an earlier claim of mine was wrong, the correction is stated in place.

---

## 1. The loop, witnessed end to end

**authorised write → canonical state → reload → analysis that reflects it.**

| leg | result |
|---|---|
| **Durable turn identity** | committed `turn_id` **equals the client's** |
| **Replay recovery** | same `turn_row_id`, **same `version_id`**, Δturns 0, Δversions 0 |
| **Contrast control** | a genuinely new operation still acts (+1 turn, +1 version, hash moves) |
| **Write fidelity** | `raw_value` 25,000→90,000, normalised `value` 0.5→**1.8** recomputed, `provenance` `ai_inferred`→**`user_set`**, `source` `cee_inference`→**`user_override`** |
| **Analyse leg** | substantive: a ranked winner with a probability, a **named** fragile edge, a robustness caveat, elimination counts |
| **Write → analysis coupling** | edit 25,000→5,000 moved `graph_hash_at_run` `56eacec6`→`f98140f2` **and** moved the numbers (`0.3147…`→`0.5783…`) |

### ⚠ A coincidence I nearly reported as a defect

Two analyses either side of an edit both said *"68% of runs"*. That looked like the
analysis ignoring the write. It is not: the winner simply did not change, and the
**underlying numbers did**. Separately, the product itself explains why a *baseline*
edit often cannot move a ranking — *"Every option here sets its own value for this
factor, so this figure is the baseline they all replace."* The prose was right and
my suspicion was wrong; the fact payload settled it.

---

## 2. The single-snapshot race — CONFIRMED AT THE WIRE (PR #1679)

SDL's witness was a unit test. This is the defect through `POST /orchestrate/v2/turn`.

Fire `run the analysis` without awaiting it, land a real `set_factor_value`
mutation after a controlled delay, then compare the turn's two graph reads: the
response's `graph_hash` against the `run_analysis` fact's `graph_hash_at_run`.

| mutation lands after | response | fact | |
|---|---|---|---|
| **150 ms** | `56eacec6adfe` | `96cae050527f` | **DIVERGED** |
| **400 ms** | `56eacec6adfe` | `96cae050527f` | **DIVERGED** |
| **800 ms** | `56eacec6adfe` | `96cae050527f` | **DIVERGED** |
| 1500 / 2500 / 4000 ms | `56eacec6adfe` | `56eacec6adfe` | agree |

**A boundary, not flakiness.** The two reads are held apart by a deterministic
window of roughly **0.8–1.5 seconds**. Every diverged run returned **HTTP 200 with
no warning**.

⚠ **Control first.** A quiet arm (no concurrent write) agrees exactly, which is what
makes the two fields comparable. A first pass compared `graph_hash_at_run` against
`scenarios.graph_identity_hash` — **different projections, would differ by design**.
That comparison was discarded, not published.

### This corrects my own sizing, in the branch's favour

I had reasoned from the `run_analysis` p50 of **~42 s** and offered **≤1.6%** of
analysis turns as the exposure. **Wrong** — the 42 s is overwhelmingly PLoT/ISL
compute *after* both reads. The real window is ~1 s, so the true rate is order
**0.04%**. Refusing therefore costs about **four analyses in ten thousand**, which
makes REFUSE cheaper than I originally argued.

---

## 3. Goal direction — mechanism VERIFIED, reach measured at 1.3% (PR #1680)

Live against deployed PLoT `5039cca` → ISL. Goal node **"Monthly churn"**, `seed: 7`:

| arm | `opt_low` | `opt_high` | winner |
|---|---|---|---|
| **absent** (today) | 0.0239 | **0.9761** | `opt_high` |
| **`minimise`** | **0.9761** | 0.0239 | `opt_low` — **flips** |
| **`maximise`** (control) | 0.0239 | **0.9761** | **identical to absent** |

The `maximise` control proves *absent ⇒ maximise*, so an unattested reduce-goal has
the engine actively crowning the worst option.

### But the reach is small, and I overstated it first

I called this *"one merge from correcting every reduce-goal ranking"*. **I had
measured that it WORKS, not how often it FIRES.** Running the real
`deriveGoalIntent` over **637 live goal labels / 10,948 scenarios**:

| derived | labels | scenarios |
|---|---|---|
| `undetermined` | 517 | **8,663 (79.1%)** |
| `increase` | 72 | 2,144 (19.6%) |
| **`decrease` → attested** | **48** | **141 (1.3%)** |

Lower bound on the miss — labels with unambiguous reduce wording left undetermined —
is **17 labels / 169 scenarios (1.5%)** (positive control: the same regex matches
43/48 of the labels the deriver itself calls `decrease`). So even a perfect deriver
caps out near **2.8%**.

**Decision: land #1680 as-is; do NOT widen the deriver.** The ceiling does not
justify touching a component where a wrong attestation confidently inverts a
ranking, and much of the 79% is genuinely undecidable — `Revenue Is Flat and Churn
Is Rising` (3,887 scenarios, the most common label) names two movements and is a
problem statement, not an objective.

---

## 4. Contract hazard — THREE stage vocabularies

| source | values |
|---|---|
| **Database** `scenarios_stage_check` | `frame` · `ideate` · `evaluate` · `decide` · `optimise` |
| **Wire** `OrchestratorTurnPayload.stage` | `frame` · `analyse` · `decide` · `review` |
| **Doctrine** (CLAUDE.md "one stage vocabulary") | STRATEGISE · FRAME · IDEATE · EVALUATE · ACT · IMPROVE |

**Only `frame` and `decide` are common to the database and the wire.** Sending
`evaluate` on the wire is a **422**; writing `analyse` into `scenarios.stage`
violates the check constraint. I hit both building one witness.

Latent because live data is **14,959 `frame` / 14 `evaluate`** — which is exactly
why it will surprise the first client that exercises the others. **A client that
echoes `scenarios.stage` to the wire works for 99.9% of rows and 422s on the rest.**

Not fixed here: widening the constraint is a production-shared migration and
changing the wire enum breaks the UI. Both are owner decisions.

---

## 5. Re-run recipes

Harness: `witness/` beside this file. Gotchas that cost real time:
- `turn_class` ∈ `frame|clarify|propose|decide|review`; **`edit` 422s**.
- wire `stage` ∈ `frame|analyse|decide|review`; the DB takes a *different* set.
- Supabase pooler: **only `aws-0-us-east-1` resolves**.
- A witness account's JWT expires in ~1 h — **all arms returning the same answer is
  the tell that the probe, not the product, is broken.**
- A signed-in scenario is required for any receipt: guests mint none.
