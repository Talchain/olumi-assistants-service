# Model Management — measured, and the premise was wrong

**Measured 21 Sep 2026** against the live Supabase project via PostgREST,
read-only, service role. ⚠ **There is no staging database** — staging,
production and demo share ONE project, so these are production numbers.

---

## ⛔ First, a correction to the brief

> *"…there are zero `model_versions`"*

**Globally false.** `model_versions` holds **3,929 rows**. The zero is
**scenario-scoped**, and a debug bundle showed us one session, not the estate.
This matters: "the table is empty" and "this scenario was never versioned" have
completely different causes.

---

## THE FINDING — versioning is guest-conditional, and the separation is total

| | **no model version** | **has one** |
|---|---|---|
| **guest** (`scenarios.user_id` IS NULL) | **11,129** | **0** |
| **signed-in** | 234 | **3,465** |

**Not one guest scenario in 11,129 has ever been versioned.** 93.7% of
signed-in scenarios have been.

**Confirmed from the other side:** `model_versions.owner_user_id` is
**non-NULL on all 3,929 rows** — 0 guest-owned versions exist.

⚠ My first control queried `model_versions.user_id`, which **does not exist**
(the column is `owner_user_id`); it returned empty and I nearly read that as a
result. Re-run against the real column, it confirms rather than contradicts.

### ⭐ The rollout-date confound is RULED OUT

A natural alternative explanation — *versioning was introduced on a date and
guest scenarios are simply older* — is refuted by holding the window fixed.

`model_versions` spans **2026-07-07T10:58Z .. 2026-09-21T18:43Z** (the newest is
from today, so versioning is live right now).

Scenarios created in the **last 7 days only**:

| | no version | has version |
|---|---|---|
| **guest** | 2,456 | **0** |
| **signed-in** | 7 | **457 (98.5%)** |

Same window, same deployed code, opposite outcome. **The variable is
authentication, not time.** (Since versioning began 2026-07-07: guest
10,611 / **0**; signed-in 219 / 3,465.)

### The graph still saves — only the version does not

| | count |
|---|---|
| scenarios with **no version but a non-NULL `graph`** | **10,394** |
| scenarios with no version and no graph | 969 |
| guest scenarios updated in the **last 7 days** | 2,455 |
| ...of those carrying a graph | 2,334 |

So guest sessions are the **dominant live usage**, their graphs persist
normally, and none of them acquire version history.

**This fully explains the witness:** a confirmed pricing mutation can persist
while `current_model_version_id` is NULL, because the mutation writes
`scenarios.graph` and version creation is gated on an owner the session has not
got.

---

## Second finding — even signed-in, mutations rarely version

`model_versions.creation_kind`, **exact counts, not a sample**:

| kind | rows |
|---|---|
| `initial` | **3,053** |
| `committed_mutation` | **296** |
| `restore` | 18 |
| NULL (pre-column legacy) | 562 |
| **total** | **3,929** |

⛔⛔ **CORRECTED 21 Sep — my original reading of this table was WRONG.**

I wrote that "only 296 committed mutations ever produced a version" and framed
it as a second defect. It is not. `creation_kind` is decided in SQL as
**`initial` iff the scenario has no versions yet, else `committed_mutation`** —
measured: `initial` is **3,056 rows, ALL at `version_number = 1`**;
`committed_mutation` is **296 rows, ALL at `version_number > 1`**.

So the split is **"first version" vs "later version", not "versioned" vs
"bypassed"**. Every one of those 3,056 first versions WAS created by a
committed mutation; it is merely labelled `initial`. The 296 is the count of
scenarios that were edited again after their first commit — a product-usage
fact, not a reliability defect.

⭐ **Versioning is coherent wherever it is reached.** `current_model_version_id`
is set on **3,468** scenarios and `model_versions` covers exactly **3,468**
distinct scenarios — no aggregate pointer drift. And owned scenarios that hold
a graph but no version total **89, with ZERO since 31 Aug** (clustered
27–30 Aug); the apparently-recent ones all have `graph IS NULL`, which is
correctly unversioned.

**The guest gate (DEFECT 1) is therefore the only systematic versioning gap.**

`mutation_id`: 3,367 set / 562 NULL (the NULLs align with the legacy
`creation_kind IS NULL` cohort).

---

## Analysis is not bound to a model version

`decision_analysis` columns: `analysis_data, created_at, decision_id, id,
metadata, organisation_id, status, updated_at, version`.

**There is no `model_version_id` and no graph hash.** `version` is a plain
integer local to the analysis row. So an analysis result cannot, from this
table alone, be tied to the exact canonical graph it ran against.

---

## Table inventory relevant to model state

| table | rows | note |
|---|---|---|
| `scenarios` | 14,828 | **the authoritative graph lives here** (`graph`, `graph_identity_hash`, `current_model_version_id`) |
| `model_versions` | 3,929 | version history |
| `v5_handler_facts` | 15,334 | analysis/turn facts |
| `decision_records` | 3,075 | |
| `canvas_versions` | 46 | a **separate** version concept |
| `decision_analysis` | 43 | |
| `decisions` | 213 | |
| `scenario_snapshots` | **0** | empty — dead or unused |
| `backup_013c2_scenarios_graph` | **97** | ⚠ **a stale alternative source of graph truth** |

Relevant RPCs present: `create_model_version`, `restore_model_version`,
`restore_model_version_atomic_v1`, `create_decision_record`,
`store_draft_graph`, `store_analysis_and_log`, `get_latest_analysis_version`,
`claim_guest_scenario`, `append_scenario_event`, `ensure_scenario_exists`.

⛔ **`claim_guest_scenario` does NOT backfill version history — ANSWERED 21 Sep
from the DEPLOYED body.** It updates `scenarios.user_id`,
`v5_conversation_turns.user_id`, `v5_handler_facts.user_id` and appends a
`guest_claimed` journey event. It touches `model_versions`,
`current_model_version_id`, `create_model_version` and `owner_user_id` — **none
of them** (all four probed). A guest who signs in gets the scenario, turns and
facts, and **zero version history for everything they did before**. The peer
lane measured the RPC at **0 uses**, so the path exists, has never run, and
would not recover history if it did.

**This makes DEFECT 1 a genuine gap, not an accepted limit.**
