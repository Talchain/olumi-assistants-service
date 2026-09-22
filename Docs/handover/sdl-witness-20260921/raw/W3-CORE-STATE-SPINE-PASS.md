# CORE STATE SPINE: **PASS** — owned scenario, deployed staging, 2026-09-21

Scenario `b6bf8e80-960f-48f8-818e-e7b02d890332`, owner `0a43a097-2917-4860-b0bb-89fdaeac5b01`
(synthetic `@olumi-witness.test`, created with Paul's approval).
Every line below is a database row or a wire JSON field. No assistant prose is used as evidence.

## The chain, as measured

| | version | identity hash | mutation id | parent |
|---|---|---|---|---|
| v1 | `initial` | `3a8de13d0899e783…` | `13960910-586e-5e10…` | (none) |
| v2 | `committed_mutation` | `7b286fec914261d7…` | `81fdf077-f1e9-58a8…` | v1 |
| v3 | `committed_mutation` | `294012a29085f7d4…` | `a15bc68c-e331-5f82…` | v2 |

`scenarios.graph_identity_hash` = `294012a29085f7d4…` = v3's identity.
`scenarios.current_model_version_id` = v3. Chain roots at v1 for all three.

## Assertions

| | claim | result |
|---|---|---|
| A1 | more than one version exists | **true** (3) |
| A2 | head is `committed_mutation` | **true** |
| A3 | `current_model_version_id` points at head | **true** |
| A4 | scenario identity hash == head identity hash | **true** |
| A5 | head's `parent_version_id` == previous version | **true** |
| A6 | chain roots at v1 | **true** |
| A7 | identity genuinely changed from v1 | **true** |

Ownership was proven, not assumed: `scenarios.user_id` equals the `sub` of the
JWT the witness signed in with. The token is ES256, `iss` =
`https://…supabase.co/auth/v1`, `aud` = `authenticated` — the exact shape CEE's
verifier requires (HS256 is retired, so a locally minted token could never work).

## Why this matters more than it looks

**These are the first `committed_mutation` versions created anywhere in the estate
since 10 Sep 08:57 — eleven days.** Not because the path was broken: zero owned
turns were silently suppressed across September, and `initial` versions are
written daily. It is because no signed-in scenario had a second graph-changing
turn in that window. So this path was genuinely unproven on the current build
rather than merely unobserved, and it is now proven.

## ⚠ A real defect found on the way: the unit parser blocks the natural phrasing

Three separate attempts to change a factor that ALREADY has a value were refused,
each time on a unit mismatch the user cannot resolve from the message:

| sent | refused with |
|---|---|
| `Change Entry Plan Monthly Price to £62.` | "This factor uses £/month; the value provided is in £." |
| `Change Entry Plan Monthly Price to £62 per month.` | **identical refusal** |
| `Change Price-Driven Churn Uplift to 2 percentage points.` | "This factor uses percentage points; the value provided is in %." |

The second row is the finding: the message states the rate unit explicitly, in
the same words the factor uses, and is still read as the bare unit. The third
shows it is not specific to currency. The reply invites the user to "tell me what
you'd like instead", but no phrasing tried reaches the rate form — a polite dead
end, which is the failure mode nobody reports because it reads as reasonable.

This is the same family as the recorded `isAmountStatedInBrief(59,"£")` true vs
`(59,"£/month")` false result. It belongs to the producer / model-generation lane,
not this one; it is recorded here because it blocks the most natural route to a
confirmed mutation.

**What does work:** setting a factor that has no value yet —
`Set Monthly Churn Rate to 3%.` and `Set Active Customer Base to 1200.` both
returned a `model_version_receipt` and each produced a `committed_mutation`
version. That is the phrasing the witness uses.

## Also worth recording

The version's `source_turn_id` is NOT the client's `turn_id` — v2 records
`f9c7902d…` while the client sent `de977500…`. Anything reconciling a client
retry against `source_turn_id` would not match. The replay key is the client
`turn_id` on `v5_conversation_turns`, which is a different column.

---

# Steps 4 and 5 — reload and analysis identity: **PASS**

Measured after the chain had grown to v5 (two further confirmed mutations).

## Step 4 — reload agrees with the head version

`POST /assist/v1/scenarios/:id/graph`, HTTP 200:

| field | value | agrees with |
|---|---|---|
| `graph_identity_hash.value` | `6cdc982c34bcd60fa5135cee37af5bde145465c13a158a5943373664c278df7a` | **== `model_versions.graph_identity_hash` for the head** ✅ |
| `graph_hash` (16-hex) | `eaffb2fd4cfd2946` | **== head `analysis_affecting_hash` truncated to 16** ✅ |
| `graph_present` | `true` | |

Both hash families agree with the head version, each compared against its own
counterpart. The 16-hex value was compared **only after truncating** the 64-hex
one — never string-equalled across families.

⚠ **My first comparison was wrong and I am recording it rather than quietly
fixing it.** `graph_identity_hash` is not a string: it is a rich object
(`{kind, value, algorithm, projection_version, graph_schema_version,
normaliser_version}`). Comparing the object to a string printed
`[object Object]` and reported a MISMATCH. The mismatch was my probe, not the
product. Compare `.value`. A terse wrong answer and a real finding look
identical in a log.

## Step 5 — the analysis is bound to the version it ran on, and a stale result is withheld

One `run_analysis` fact exists, from before the mutations:

| | |
|---|---|
| fact `payload.result.graph_hash_at_run` | `a3d229c42b5b7026` |
| that value | **== v1's `analysis_affecting_hash` truncated** ✅ |
| current head `aah16` | `eaffb2fd4cfd2946` (different, as it must be) |
| `computed_at` | `2026-09-21T23:00:10.505Z` |

So the fact is correctly bound to the model version it actually ran against, and
that is v1 — not the current head, because three mutations have landed since.

And the system says so, from structured state:

```
analysis_state.run_state = { kind: "complete_stale", cause: "graph_changed",
                             computed_at: "2026-09-21T23:00:10.505Z" }
analysis_state.requires_rerun = true
analysis_result = null
```

**This is the "no result from an earlier model is presented as current" guarantee,
proven on the deployed build.** The stale result is withheld (`analysis_result:
null`) and the reason is named as `graph_changed` rather than inferred.

# VERDICT

**CORE STATE SPINE: PASS** — canonical identity, authorised mutation, receipt,
version chain, pointer, reload agreement and analysis identity all hold on the
deployed build, on an owned scenario, measured from database rows and wire JSON.

**Idempotent replay: FAIL** (documented separately in `W3A-REPLAY-FINDING.md`) —
refused with `409 GRAPH_DIVERGED` / `turn_fence_superseded`, no corruption and no
duplicate version, but no recovery either. Root cause is not the CAS ordering: the
client `turn_id` is discarded on handler turns, so the RPC's replay key can never
match one the client holds.

**SINGLE-SNAPSHOT GUARANTEE: FAIL, reproduced** — see
`SINGLE-SNAPSHOT-STATUS.md` and branch `feat/single-snapshot-run-analysis`.
