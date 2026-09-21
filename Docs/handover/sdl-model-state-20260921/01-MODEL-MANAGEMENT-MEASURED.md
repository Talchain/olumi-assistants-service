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

Only **296 committed mutations in the estate's entire history** produced a
version. Versions are overwhelmingly created **once, at scenario creation**.

⚠ So even fixing the guest gate would not give you usable version history —
the mutation→version path is itself barely exercised. **UNVERIFIED** whether
that is because mutations rarely commit or because commits rarely version;
that is the next measurement.

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

⭐ **`claim_guest_scenario` exists** — so guest→owner promotion is a designed
flow. **UNVERIFIED:** whether claiming a guest scenario backfills any version
history, or whether all pre-claim history is permanently absent. That is the
question that decides whether the guest gate is a bug or an accepted limit.
