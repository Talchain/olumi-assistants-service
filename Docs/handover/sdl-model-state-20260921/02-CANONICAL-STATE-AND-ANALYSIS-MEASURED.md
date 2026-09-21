# Canonical state & analysis identity — measured at the database

Live Supabase project, PostgREST, read-only, 21 Sep 2026.
⚠ ONE project serves staging + production + demo. These are production numbers.

---

## 1. The authoritative persisted graph

**`scenarios.graph`**, with `scenarios.graph_identity_hash` alongside it and
`scenarios.current_model_version_id` as the pointer into version history.
14,828 rows.

Supporting columns on the same row: `brief`, `brief_text`, `framing`, `events`,
`event_seq`, `last_turn_nonce`, `rolling_summary`, `stage`,
`scenario_schema_version`, `source_scenario_id`.

### Identity-hash coverage — a real gap

| | count |
|---|---|
| graph present **and** `graph_identity_hash` set | **13,183** |
| graph present but `graph_identity_hash` **NULL** | **678** |

**678 scenarios carry a graph that has no identity hash.** Anything deriving
freshness or CAS from that hash cannot do so for those rows.

---

## 2. Alternative / stale sources of graph truth

| source | rows | risk |
|---|---|---|
| `scenarios.graph` | 14,828 | **authoritative** |
| `model_versions.graph` | 3,929 | per-version copy; only 3,465 scenarios point at one |
| `backup_013c2_scenarios_graph` | **97** | ⚠ **a literal backup table of graphs, still present** |
| `canvas_versions` | 46 | a **separate** version concept from `model_versions` — two version vocabularies coexist |
| `scenario_snapshots` | **0** | empty; dead or never adopted |

⭐ **Two independent version concepts** (`model_versions` 3,929 vs
`canvas_versions` 46) is itself a finding — the successor should establish which
is authoritative before building comparison on either.

---

## 3. The analysis-state columns on `scenarios` are DEAD

Sampled the 5 most recently updated scenarios directly:

| column | state |
|---|---|
| `analysis` | **NULL on every row measured** |
| `analysis_status` | `'none'` on every row |
| `latest_analysis_summary` | NULL on every row (0 non-null estate-wide) |
| `analysis_invalidated_at` | NULL |
| `analysis_error` | not observed populated |
| **`analysis_provenance`** | ⭐ **POPULATED** — ~186 B of JSON on 3 of 5 |
| **`graph_identity_hash`** | ⭐ **POPULATED** — on 4 of 5 |

**Positive control:** `analysis_provenance` and `graph_identity_hash` are
non-empty in the *same query*, so the probe reads real data and the empty
columns are genuinely empty — not a filtering artefact. (⚠ My first attempted
control, `latest_analysis_summary`, is itself empty estate-wide and therefore
did not discriminate; it is not evidence either way.)

**Consequence:** analysis results do NOT live on the scenario row. They live in
`v5_handler_facts` (15,334 rows) and `decision_analysis` (43 rows). A schema
that still carries five analysis columns which nothing populates is a standing
invitation to read the wrong source.

---

## 4. Analysis is not bound to a model version

`decision_analysis` columns: `analysis_data, created_at, decision_id, id,
metadata, organisation_id, status, updated_at, version`.

**No `model_version_id`. No graph hash.** `version` is an integer local to the
analysis row, unrelated to `model_versions.version_number`.

So *"which exact canonical graph did this result run against?"* cannot be
answered from this table. Any binding must come from `v5_handler_facts` or from
`scenarios.analysis_provenance` — **UNVERIFIED which, and that is the single
most important open question for analysis identity.**

---

## 5. Relevant RPCs that exist

`create_model_version` · `restore_model_version` ·
`restore_model_version_atomic_v1` · `create_decision_record` ·
`store_draft_graph` · `store_analysis_and_log` · `store_analysis_failure` ·
`get_latest_analysis_version` · `claim_guest_scenario` ·
`append_scenario_event` · `ensure_scenario_exists` · `duplicate_scenario`

187 tables are exposed in total.
