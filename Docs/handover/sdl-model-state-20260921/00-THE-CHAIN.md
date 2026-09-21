# SDL / Model State — the chain the successor asked for

```
canonical graph → authorised mutation → receipt → persisted state
                → model version → reload → analysis identity/history
```

Every link below is either **MEASURED against the live database** (marked ⓂⒹ),
measured in deployed logs (ⓂⓁ), or read from code at staging tip `e717e19d`.

---

## The chain, link by link

| link | where it lives | state |
|---|---|---|
| **canonical graph** | `scenarios.graph` + `scenarios.graph_identity_hash` (JSONB/TEXT) | ⓂⒹ 14,828 rows; **678 carry a graph with NO identity hash** |
| **authorised mutation** | `commit.ts:1100 commitDirectAnswer` → `appendCheckedGraphWrite` → `store.append` → RPC `append_turn_atomic_v5` | 3 production graph writers only, pinned by `graph-writer-population.guard.test.ts` |
| **CAS** | `append_turn_atomic_v5`, `ERRCODE OLGC1` | ⚠ **opt-in** — `p_cas_enforce`, default mode `'shadow'` = "no write is ever rejected" |
| **mutation identity** | `model_versions.mutation_id` (UUID); turn mirror `v5_conversation_turns.model_version_mutation_id` | turn path derives it: `deterministicMutationId(scenarioId, turnId)` (`commit.ts:828`) |
| **receipt** | `ModelVersionMutationReceiptV1Local` (`mutation-receipt.ts:115-163`), wire key `model_version_receipt` | graph carried **verbatim by reference**; re-parsing changes the hash |
| **persisted state** | `scenarios.graph` updated in the same RPC | ✅ commits |
| **model version** | `model_versions` + `scenarios.current_model_version_id` | ⛔ **silently skipped for guests** — see below |
| **reload** | `supabase-store.ts:2233-2237` — `select('graph, brief_text')` ONLY | ⛔ **does NOT reproduce exact state** — no load-side projection; `pending_actions`/`coaching_state` written but absent from the read list. See `04-RELOAD-AND-COMPARISON.md` |
| **analysis identity** | `run_analysis` fact fields `graph_hash_at_run` + `computed_at`, **both OPTIONAL** | ⛔ no `model_version_id`, no `run_id` anywhere on the fact |
| **comparison** | `POST /versions/compare` → `compareVersionRecords`, deterministic, no LLM | exists and is real; gated 3 ways — see `04-RELOAD-AND-COMPARISON.md` |

---

## ⛔ DEFECT 1 — versioning is silently skipped for guests (THE witness answer)

**First wrong boundary:** `supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql:615`,
inside the **deployed** `append_turn_atomic_v5`:

```sql
v_should_create := v_user_id IS NOT NULL
  AND v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash;
```
and `:805-810` — if not, *"graph, turn and every ordinary side effect still commit,
but there is no durable version/head/event"*, returning `model_version_receipt: NULL`.

ⓂⒹ **Verified present in the live deployed function body** (`pg_get_functiondef`,
`v_should_create :=` at body offset 1420), not only in the migration file.

### ⓂⒹ The measurement that discriminates it from the other three candidate gates

| | no version | has version |
|---|---|---|
| **guest** (`scenarios.user_id` IS NULL) | **11,129** | **0** |
| **signed-in** | 234 | **3,465** |

**Last 7 days only** (rules out a rollout-date confound): guest **2,456 / 0**;
signed-in **7 / 457 (98.5%)**. Same window, same code, opposite outcome — the
variable is authentication, not time.

Confirmed from the other side: `model_versions.owner_user_id` is non-NULL on
**all 3,929 rows**. And 10,394 scenarios hold a graph with no version at all.

⚠ **The brief said "zero `model_versions`". Globally that is false — there are
3,929.** The zero is scenario-scoped. A debug bundle described one session.

### Why nothing alarms
`create_model_version`'s loud `MV001` *"version history requires sign-in"*
refusal is **never reached** — that RPC is only the explicit **Save version**
button (`assist.v1.scenario-versions.ts:866`) and the collab round
(`collab/store.ts:384`). On the mutation path the skip is silent, and
`supabase-store.ts:116` → `commit.ts:1629,1636` make *"v5 wasn't selected"* and
*"v5 ran and suppressed the version"* **indistinguishable in telemetry**.

**Contrast:** the sibling decision-record path *does* pre-check guest in TS and
logs a typed `DR001` refusal (`capture.ts:412-449`). Model versions have no
equivalent anywhere in TS.

**Verdict: FIX — but it is a product decision, not a bug.** Guest refusal is
deliberate, documented design (`20260705120000:44,95,127` — *"D3 Branch A;
guests refused"*). The mismatch is that **guests are the dominant PoC usage**
(ⓂⒹ 2,455 guest scenarios in 7 days) while the model-state layer requires
sign-in. `claim_guest_scenario` exists; **UNVERIFIED whether claiming backfills
any history.** That question decides whether this is a bug or an accepted limit.

---

## ⛔ DEFECT 2 — exactly-once is broken on the turn path, and it is DEPLOYED

**First wrong boundary:** deployed `append_turn_atomic_v5` evaluates CAS
**before** it checks whether the turn already exists.

ⓂⒹ **Measured in the live function body** (comments stripped, offsets after
`BEGIN`):

| statement | offset |
|---|---|
| `v_should_create :=` (guest gate) | 1420 |
| `IF p_cas_enforce` (CAS guard) | 1743 |
| `ERRCODE = 'OLGC1'` (CAS raise) | 2059 |
| `INTO v_existing_turn_id` (**replay lookup**) | **2417** |

**CAS at 1743/2059 precedes the replay lookup at 2417.**

⚠ My first probe reported the opposite — it matched `v_existing_turn_id` in the
`DECLARE` block. Re-measured against the executable body only, after `BEGIN`.
**Never measure an ordering with a regex that a declaration can satisfy.**

**Consequence** (`apply-operations.ts:76-90`): replaying an already-committed
turn raises a stale-write error whenever the head has moved — *"the NORMAL state
during the interruption a replay exists to recover from. The caller is told its
write was refused as stale. **The write committed.**"* It surfaces to the caller
as a **throw**, deliberately neither `ok:false` nor `ok:true`.

**The fix is written and NOT deployed:**
`supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql` —
*"NOT EXECUTED BY THIS CHANGE. Migration execution on staging is Paul-gated."*
Sibling `20260920220000` (dedupe precedes CAS, for `create_model_version`) is
in the same state.

**Verdict: FIX — needs Paul to run two migrations.** ⚠ There is no staging
database; this is a production change.

---

## ⛔ DEFECT 3 — analysis is not bound to a model version

ⓂⒹ `decision_analysis` columns: `analysis_data, created_at, decision_id, id,
metadata, organisation_id, status, updated_at, version`. **No `model_version_id`,
no graph hash.** `version` is a local integer.

On the fact side the binding is `graph_hash_at_run` + `computed_at`, **both
optional** (`RunAnalysisResultSchema`), stamped conditionally at
`run-analysis.ts:2145` — an unhashable graph yields a fact with **no identity at
all**.

**Two token widths coexist:** the fact carries a **16-hex** prefix
(`graph-hash.ts:118`) while `model_versions.analysis_affecting_hash` is
**64-hex**. `analysis-admission.ts:1118-1121`: comparable *"ONLY after
truncation — a consumer must never string-equal one against the other."*

**Verdict: FIX, and it is the blocker for trustworthy comparison.**

---

## ⚠ DEFECT 4 — `prior_facts_absent` names the wrong thing, and hides a real one

Three distinct mechanisms, only one of which is a defect:

1. **By design (dominant).** `ctx.priorFacts` is threaded only when *this turn*
   completed a run (`turn-executor.ts:16507`). Not a storage claim.
2. **Real defect.** `supabase-store.ts:1848-1854` `safeParse`s every fact row
   against a **strict 14-member discriminated union**; one alien row **throws**
   for the whole batch → `build-turn-context.ts:2274-2287` catches → `facts: []`.
   Facts exist and are invisible. ⚠ This path does **not** report
   `prior_facts_absent` — it reports **`insufficient_runs`**, a different and
   misleading reason. Same shape already shipped once (`Docs/v5/v5-baseline-evidence.md:52`).
3. **Naming.** The label asserts something about *storage*; the code tests
   *this turn's dispatch*.

**Verdict: KEEP (1) · FIX (2) · FIX the label (3).**

---

## Other findings

| # | finding | verdict |
|---|---|---|
| ⓂⒹ | **`CEE_V5_GRAPH_CAS_RPC = enforce` on staging** (Render env, verified) — so DEFECT 2 is live-reachable, not theoretical. `CEE_MODEL_VERSIONS_ENABLED=true`, `CEE_REQUIRE_USER_JWT=true` | — |
| ⓂⒹ | **Migration ledger read**: `supabase_migrations.schema_migrations` holds `20260824200000` and **neither `20260920210000` nor `20260920220000`**. Newest applied is `20260918014756` | confirms both fixes are unapplied |
| D5 | `constraint_unevaluated` can return `codes: []` on **two of three** routes (`constraint-feasibility.ts:918-920`, `:947-954`) — the consumer cannot tell "producer said nothing" from "CEE found a constraint the producer never scored" | FIX |
| D6 | ⓂⒹ `scenarios.analysis`, `analysis_status`, `latest_analysis_summary`, `analysis_invalidated_at` are **dead columns** — NULL/`'none'` on every row measured. Positive control: `analysis_provenance` (186 B) and `graph_identity_hash` ARE populated in the same query | PARK (remove later) |
| D7 | ⓂⒹ **Two version vocabularies**: `model_versions` (3,929) and `canvas_versions` (46). Establish which is authoritative before building comparison | FIX first |
| D8 | ⓂⒹ `backup_013c2_scenarios_graph` (97 rows) — a literal backup table of graphs, still present | PARK |
| D9 | `CEE_MODEL_VERSIONS_ENABLED`: two comments say "default OFF"; the resolver `config/index.ts:1389` is `createEnvEnforcedBoolean(true, …)` = **default true**. Production is **forced false** (`:158-170`) | FIX the comments |
| D10 | ⓂⒹ 678 scenarios hold a graph with **no `graph_identity_hash`** — CAS and freshness cannot be derived for them | FIX |
| D11 | `create_model_version` silently skips a colliding journey event and **returns the event_id anyway**; sibling `create_decision_record` **raises 22023** for precisely this and says so (`20260710113000:585-598`) | FIX |
| D12 | ⓂⒹ `scenario_snapshots` is **empty (0 rows)**; referenced only as a legacy hash regime "the three regimes never compare" | PARK |
| D13 | `store_draft_graph` RPC updates `scenarios.graph` with **no ownership predicate**; dormant (zero TS callers, pinned by a guard test), `authenticated` grant later revoked | KEEP (guarded) |

---

## Owned elsewhere — do not duplicate

| item | owner |
|---|---|
| Brief → Trusted Canonical Model | **Producer lane** — `output/producer-handover-20260921/HANDOVER.md` |
| #1659 / #1660 consent-token wiring | Core. **#1660 is OPEN**, Part 2/2, stacked on #1659 |
| #1674 observed-state salvage | this lane — see `03-PR-1674-EXACT-STATE.md` |

**What #1660 fixes:** consent token minted from the **store**, never the
request; a null mint declines the turn (`?? 'graph-unhashable'` removed); a
failed read **throws**; the accept port is injected so the layer saves.
**What it leaves:** it is scoped to the **consent/accept** token, and changes
nothing about `graph_hash_at_run`, `computed_against_hash`, freshness, or the
16-hex/64-hex split. Its own body warns its CI is **silence, not success**,
because it targets a feature branch where the required check does not dispatch.

---

## Unresolved questions for the successor

1. **Does `claim_guest_scenario` backfill version history?** Decides whether
   DEFECT 1 is a bug or an accepted limit. Highest-value question here.
2. **Which service created and owns `scenarios`?** It has no `CREATE TABLE` in
   this repo (contrast control: `model_versions` does). CEE only `ALTER`s it.
3. **Is `p_cas_enforce` actually `'enforce'` on staging?** Code default is
   `'shadow'` = never rejects. Not read from deployed env.
4. **Has the strict-union fact-read throw actually fired?** Code path verified;
   rate unmeasured.
5. **Why do only 296 mutations in all history produce a version** (vs 3,053
   `initial`)? Even fixing the guest gate may not yield usable history.
6. **Is `model_versions` or `canvas_versions` authoritative?**
