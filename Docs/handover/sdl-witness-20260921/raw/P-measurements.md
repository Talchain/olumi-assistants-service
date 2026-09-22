# Lane P — four measurements

Repo: fresh blobless clone of `Talchain/olumi-assistants-service` @ branch `staging`.
HEAD asserted twice (start and after first reads): `e717e19d05542a80254ea056aa95a59c2cde4053` (40 chars).
All live reads READ-ONLY. Postgres reads ran inside `set transaction read only`.
Run performed 2026-09-21, approx 22:46–22:58 UTC.

---

## INSTRUMENT CALIBRATION (read this before trusting any zero below)

The Render `GET /v1/logs` `text=` filter is **NOT a reliable plain substring match for
multi-word phrases.** Demonstrated on `cee-production`, 7d window, against a line I had
already retrieved verbatim:

| `text=` | rows |
|---|---|
| `[AUDIT] CEE_MODEL_VERSIONS_ENABLED enabled in staging environment` | 1 |
| `CEE_MODEL_VERSIONS_ENABLED enabled in staging environment` | 1 |
| `enabled in staging environment` | **0** ← substring of a line that exists |
| `staging environment` | 1 |
| `[AUDIT]` | 1 |
| `CEE_MODEL_VERSIONS_ENABLED` | 2 |

**Consequence:** every absence claim below is re-derived using SINGLE-TOKEN probes only,
with a same-shape positive control and a fabricated-token negative control in the same run.
Multi-word phrase results are reported but are NOT load-bearing.

Also: `logs` entries are under `d["logs"]`; pagination is `hasMore` + `nextEndTime`.
The API 429s readily — the helper backs off and throttles.

---

## M1 — Does the exactly-once (CAS conflict) defect fire in production traffic?

**Emitter derived first, not guessed.** `src/orchestrator-v5/session/supabase-store.ts:1353`
calls `this.emitRpcCasConflict(...)` then throws `GraphStaleWriteError` (`:1354-1360`).
`emitRpcCasConflict` (`:1639-1660`) emits `TelemetryEvents.V5GraphCasRpcConflict`, whose
string value is `"v5.graph_cas.rpc_conflict"` (`src/utils/telemetry.ts:1446`).
`emit()` (`src/utils/telemetry.ts:3291-3299`) does `log.info({event, ...})` → pino JSON → Render.
So the literal logged token is **`v5.graph_cas.rpc_conflict`**.

**Query:** `GET /v1/logs` ownerId=`tea-d3eqr815pdvs73c6dn5g`,
resource[]=`srv-d4slpaili9vc73eiq4og` (cee-staging), `text=v5.graph_cas.rpc_conflict`,
limit=100, paginated.
**Window:** 2026-09-14T22:48:08Z → 2026-09-21T22:48:08Z (7 days).

### RAW COUNT: 4 conflicts. NOT zero — the defect fires.

| timestamp (UTC) | mode | rpc_code | expected hash | incoming hash | scenario |
|---|---|---|---|---|---|
| 2026-09-18T00:21:38.569Z | enforce | OLGC1 | 7ed2f7cda8cf3625 | dfabac8aa5fdb0a1 | 39a9a9c8 |
| 2026-09-18T12:56:58.496Z | enforce | OLGC1 | 7ed2f7cda8cf3625 | 5075bc55ec2673c7 | 3f14e465 |
| 2026-09-21T10:16:13.517Z | enforce | OLGC1 | 3a60aa02af81ea7c | be7dba2fed1ac188 | 171396f2 |
| 2026-09-21T19:56:43.366Z | enforce | OLGC1 | 7ed2f7cda8cf3625 | 3ba2274482229edc | 28719228 |

Corroborating counts, same window, same service:
`rpc_cas_conflict` = 4 · `OLGC1` = 4 · `GraphStaleWriteError` = **3** · `rejected a stale graph write` = 3.

**CONTRAST CONTROL:** `v5_turn_context_facts` = ≥300 (capped) and `buildTurnContext` = ≥300
in the same window/service — the instrument sees this service's traffic. Fabricated token
`ZzQxFabricatedNeverLogged` = 0. So 4 is a real 4, not an instrument floor.

**VERDICT: PROVEN — the CAS conflict fires in real traffic, 4 times in 7 days.**
All four are `mode=enforce`, all `rpc_code=OLGC1`, all on `event_kind: factor_value_edit`.
**Note the 4 vs 3 asymmetry:** 4 telemetry emits but only 3 `GraphStaleWriteError` log lines.
The emit precedes the throw on the same code path, so one conflict's error line is not present
in the search. UNVERIFIED which of the two counts is the true number of user-visible refusals.

**Timestamp:** measured 2026-09-21T22:48:26Z.

---

## M2 — Has the strict-union fact-read throw ever fired?

**Exact throw string derived:** `src/orchestrator-v5/session/supabase-store.ts:1851`
`` `readFactsWithTurnFor: payload failed HandlerFactSchema — ${parsed.error.message}` `` (SessionReadError).

**The throw does not reach the log directly.** Its main caller
`src/orchestrator-v5/build-turn-context.ts:2253` sits in a try whose catch (`:2273-2287`)
logs `'V5 buildTurnContext: session.readFactsFor failed, continuing with empty prior_facts'`
**and** emits `TelemetryEvents.SessionReadDegraded` = `"session.read_degraded"`
(`src/utils/telemetry.ts:1678`). That event is the correct detector.

**Queries (single-token, 7d, cee-staging, 2026-09-14T22:55:52Z → 2026-09-21T22:55:52Z):**

| probe | count |
|---|---|
| `readFactsWithTurnFor` | **0** |
| `HandlerFactSchema` | **0** |
| `session.read_degraded` | **0** |
| `read_degraded` | **0** |
| `SessionReadError` | **0** |
| `v5.prior_facts.read_failed` | **0** |

**POSITIVE CONTROL (same single-token shape, expected present):**

| control | count |
|---|---|
| `v5_turn_context_facts` — the SUCCESS return of the very same try block (`build-turn-context.ts:2261`) | **≥300 (capped at 3 pages)**; ≥4000 on a 40-page run |
| `v5.graph_cas.rpc_conflict` | 4 |
| `buildTurnContext` | ≥300 (capped) |

**NEGATIVE CONTROL (fabricated tokens, expected absent):**
`ZzQxFabricatedNeverLogged` = 0 · `readFactsWithTurnForZZZ` = 0.

This is a true contrast pair: `v5_turn_context_facts` and `session.read_degraded` are the
**mutually exclusive outcomes of one try/catch**. One read ≥300/≥4000, the other read 0.

### VERDICT: the "one alien fact row poisons the whole batch" defect has NEVER FIRED on cee-staging in the last 7 days. It is a real code path that has not been exercised.

**SCOPE LIMIT, stated plainly.** There are three non-test callers of `readFactsWithTurnFor`:
- `build-turn-context.ts:2253` — instrumented (the catch above). Covered by this measurement.
- `supabase-store.ts:1765` (`readFactsFor` wraps it) — reached from the same instrumented try.
- **`src/orchestrator-v5/system-events/option-intervention-edit.ts:285` — a BARE `catch {}`
  at `:299` that logs NOTHING and returns `reason: 'canonical_readback_failed'`.**
  A throw reached from there is invisible to log search.
  Bounding probe: `option_intervention_edit` = 5 events in the window (the path ran ~5 times),
  `canonical_readback_failed` = 0, `committed_fact_unverified` = 0, `committed_turn_unverified` = 0
  — but those are RETURN VALUES, not log fields, so their zero is weak evidence.
  **UNVERIFIED for that caller; exposure bounded at ~5 invocations vs ≥300 instrumented reads.**
  What would settle it: add a log line to that catch, or query the turn rows those 5 events touched.

**Timestamp:** measured 2026-09-21T22:56:28Z (targets/controls), 22:57:22Z (silent-catch probe).

---

## M3 — Two documentation facts

### (a) Is `POST /assist/v1/scenarios/:id/versions/compare` published in openapi.yaml?

**Scope searched:** `openapi.yaml` at repo root (the only OpenAPI spec; `openapi/` contains
one unrelated file, `draft-graph.yml`). Searched with `rg -a` (NUL-safe).

**COMPLETE MANIFEST — all 29 path entries in openapi.yaml** (`rg -a -n "^  /" openapi.yaml`):
`/healthz` · `/assist/draft-graph` · `/assist/draft-graph/stream` · `/assist/suggest-options` ·
`/assist/v1/explain-diff` · `/assist/explain-diff` · `/assist/v1/draft-graph` ·
`/assist/v1/draft-graph/stream` · `/assist/v1/draft-graph/staged` ·
`/assist/v1/decision-review/example` · `/assist/v1/team-perspectives` · `/assist/v1/health` ·
`/assist/v1/sensitivity-coach` · `/assist/v1/options` · `/assist/v1/bias-check` ·
`/assist/v1/graph-readiness` · `/assist/v1/elicit-belief` · `/assist/v1/suggest-utility-weights` ·
`/assist/v1/elicit-risk-tolerance` · `/assist/v1/elicit/preferences` ·
`/assist/v1/elicit/preferences/answer` · `/assist/v1/explain/tradeoff` ·
`/assist/v1/suggest-edge-function` · `/assist/v1/evidence-helper` · `/assist/v1/explain-graph` ·
`/assist/v1/isl-synthesis` · `/assist/v1/narrate-conditions` · `/assist/v1/explain-policy` ·
`/assist/v1/ask`

**CONTRAST CONTROLS — both PRESENT, as expected:**
- `/assist/v1/explain-diff` → **openapi.yaml:301** ✅
- `/assist/v1/graph-readiness` → **openapi.yaml:994** ✅

**TARGET: `versions/compare` → 0 occurrences in openapi.yaml.** The token `versions` appears
twice in the file (`:5366`, `:5509`) and both are prose descriptions, not paths.

**The route DOES exist in code** (so this is a documentation gap, not a missing feature):
`src/server.ts:222` and `src/routes/assist.v1.scenario-versions.ts:716`.

**VERDICT: NOT PUBLISHED — and the gap is wider than asked.** Zero `/assist/v1/scenarios/...`
paths of ANY kind appear in openapi.yaml. All six scenario routes registered at
`src/server.ts:218-224` are unpublished: `…/graph`, `…/graph/register`, `…/versions`,
`…/versions/compare`, `…/versions/save`, `…/versions/restore`.

### (b) CEE_MODEL_VERSIONS_ENABLED and CEE_REQUIRE_USER_JWT on cee-PRODUCTION

**Query:** `GET /v1/services/srv-d46fp8q4d50c73b1dqqg/env-vars?limit=100`, **paginated**
via the last row's cursor. Pages: 100 + 18 = **118 vars total** (a single unpaginated call
would have truncated at 100 and missed 18).

| var | cee-production | cee-staging (118 vs 121 vars) |
|---|---|---|
| `CEE_MODEL_VERSIONS_ENABLED` | `true` | `true` |
| `CEE_REQUIRE_USER_JWT` | `true` | `true` |
| `NODE_ENV` | `staging` | `staging` |
| **`OLUMI_ENV`** | **`staging`** | *(absent)* |
| `RENDER_SERVICE_NAME` | *(absent from user env-vars; Render injects it implicitly)* | *(absent)* |

### ⛔ IS PRODUCTION FORCED? **NO — and this is the headline finding.**

`modelVersionsEnabled: createEnvEnforcedBoolean(true, "CEE_MODEL_VERSIONS_ENABLED")`
— `src/config/index.ts:1390`. The production lockdown is
`if (env === "prod") { ...; return false; }` — `src/config/index.ts:158-171`.

But `env` is `getRuntimeEnv()` (`src/config/index.ts:141`), resolved by
`src/config/env-resolver.ts:88-119` in this precedence:
1. **`OLUMI_ENV`** (discriminating) — `:93-96`
2. `RENDER_SERVICE_NAME` contains "staging" → staging, else prod — `:99-106`
3. `NODE_ENV === "production"` → prod (NOT discriminating) — `:113-115`
4. default → local

**cee-production sets `OLUMI_ENV=staging`, which wins at step 1.** So `getRuntimeEnv()`
returns `"staging"` on the production service, the `env === "prod"` lockdown never runs, the
staging branch runs with `allowStaging` defaulting to `true` (`config/index.ts:135`), and
`createEnvEnforcedBoolean` **returns the requested value `true`**.

**RUNTIME CONFIRMATION — not inference.** The staging-allowed branch emits
`console.warn("[AUDIT] ${settingName} enabled in staging environment")` (`config/index.ts:194`)
and the prod branch emits `[SECURITY] ... cannot be enabled in production (forced to false)`
(`config/index.ts:160`). Searching **cee-production** logs, 7d:

| probe on cee-production | count |
|---|---|
| `[AUDIT] CEE_MODEL_VERSIONS_ENABLED enabled in staging environment` | **1** — at **2026-09-19T23:44:39.250Z** (boot) |
| `CEE_MODEL_VERSIONS_ENABLED cannot be enabled in production` | **0** |
| `cannot be enabled in production (forced to false)` | **0** |
| CONTRAST `/orchestrate/v2/turn` (service is alive) | 3 (incl. `"V5 orchestrator registered"` at 2026-09-19T23:44:40.863Z) |

**VERDICT:**
- `CEE_MODEL_VERSIONS_ENABLED` on cee-production is **`true`, NOT forced false** — proven by
  the service's own boot log naming the staging branch. Any doctrine saying "prod flag forced
  false" is **REFUTED for this service as configured**.
- `CEE_REQUIRE_USER_JWT` is `requireUserJwt: booleanString.default(false)`
  (`src/config/index.ts:579`) — a **plain** boolean, NOT `createEnvEnforcedBoolean`. There is
  no environment forcing of any kind. cee-production's `true` is honoured as `true`.
- **cee-production is not identified as production by its own runtime.** Three signals all say
  "staging" (`OLUMI_ENV=staging`, `NODE_ENV=staging`, and no discriminating override), so
  every `createEnvEnforcedBoolean` production lockdown in the codebase is inert on that service.
  Scope limit: I measured this for `CEE_MODEL_VERSIONS_ENABLED` only; the same resolution
  applies to every other env-enforced flag by construction, but I did not enumerate them.
- Stale comments found: `src/config/env-resolver.ts:53-54` and `src/config/index.ts:2152` both
  assert "BOTH Render services set `NODE_ENV=production`". **Measured false** — both set
  `NODE_ENV=staging`.
- `v5.model_versions.version_committed` on cee-production = **0** in 7 days; the service
  served ~no turn traffic in the window (only boot lines), so that zero reflects no traffic,
  not the flag.

**Timestamp:** env vars 2026-09-21T22:47:20Z; production log probes 2026-09-21T22:54:50Z and 22:55:36Z.

---

## M4 — The silent no-op rate

**Field names confirmed at the bytes.** `src/orchestrator-v5/commit.ts:1632-1643`:
```
const receipt = appendOutcome.modelVersionReceipt;
emit(TelemetryEvents.V5ModelVersionCommitted, {
  scenario_id, turn_id,
  status: receipt === undefined ? 'no_receipt' : 'committed',
  version_number: receipt?.version_number ?? null,
  graph_identity_hash_prefix: receipt === undefined ? null : receipt.graph_identity_hash.slice(0,16),
  provenance: 'commit',
});
```
Event string `"v5.model_versions.version_committed"` (`src/utils/telemetry.ts:1566`).

### LOG COUNT — cee-staging, 7d window queried (2026-09-14T22:51:38Z → 2026-09-21T22:51:38Z)

| status | events | distinct scenarios |
|---|---|---|
| `no_receipt` | **117** | 106 |
| `committed` | **16** | 16 |
| **total** | **133** (uncapped, 2 pages) | 122 |

`provenance` was `commit` for all 133. `version_number` non-null for 16/16 `committed`
and 0/117 `no_receipt`. **Silent no-op rate = 117/133 = 88.0%.**

⚠ **WINDOW CAVEAT:** although 7 days were queried, all 133 events fall in
**2026-09-21T00:51:32Z → 22:22:40Z (~21.5 hours)**. This is NOT log retention —
the same service returns logs from **2026-09-15T04:49:33Z** in the same window. The emit is
simply younger than the window (its own code comment dates the success-path emit to 20 Sep 2026).
So the log figure is a **~21.5h** measurement, not a 7-day one.

### DB-SIDE PROXY — the full 7 days (this is the stronger number)

Live Supabase, `set transaction read only`, session pooler :5432. DB clock `now()` at read =
**2026-09-21T21:53:41.919Z UTC**. Window coverage confirmed: `v5_conversation_turns` rows from
2026-09-14T23:26:32.859Z to 2026-09-21T22:23:21.641Z (n=5271).

```sql
select t.model_version_created, (s.user_id is null) as guest_scenario,
       count(*) as turns, count(distinct t.scenario_id) as scenarios
from v5_conversation_turns t join scenarios s on s.id = t.scenario_id
where t.model_version_mutation_id is not null
  and t.created_at >= now() - interval '7 days'
group by 1,2;
```

| model_version_created | guest_scenario | turns | scenarios |
|---|---|---|---|
| **false** | **true** | **1658** | 1466 |
| **true** | **false** | **374** | 374 |

**The 2×2 collapses to a perfect diagonal. The cells (false, non-guest) and (true, guest) are
both EMPTY.** Silent no-op rate over 7 days = **1658 / 2032 = 81.6%**.

Wider context, same window, same join, including turns with a NULL mutation id:
`has_mutation_id=false` → 2884 guest + 355 signed-in turns (versioning not attempted at all).

**CONTROLS.** Column-existence control: the four columns used are present in
`information_schema.columns`. Fabricated-column control `model_version_zzz_fabricated`
returned ZERO rows in the same query shape.

### CROSS-INSTRUMENT CHECK — logs joined to the DB

I took the 122 distinct `scenario_id`s out of the log events and looked up their ownership:

| log status | scenarios supplied | found in DB | guest=true | guest=false |
|---|---|---|---|---|
| `no_receipt` | 106 | 106 | **106** | 0 |
| `committed` | 16 | 16 | 0 | **16** |

Zero overlap between the two id sets. And the DB proxy restricted to the log's own window
(2026-09-21T00:51:32Z–22:22:41Z) returns **116 not-created (all guest) / 16 created (all
signed-in)** against the log's **117 / 16** — two independent instruments agreeing to within
one row. (The off-by-one is unexplained; most likely a rolled-back turn that emitted but left
no row, or a boundary rounding. UNVERIFIED.)

### ⛔ IS THE CODE COMMENT WRONG? **YES — PROVEN WRONG.**

The comment at `src/orchestrator-v5/commit.ts:1629-1631` says *"`modelVersionReceipt` is
undefined when v5 was not the selected RPC."* At this emit site that is **impossible**. The chain:

1. The emit is inside `} else if (atomicVersionPlan.kind === 'plan') {` — `commit.ts:1603`.
2. A `plan` is exactly what puts the carrier on the write:
   `...(atomicVersionPlan.kind === 'plan' ? { modelVersion: atomicVersionPlan.write } : {})`
   — `commit.ts:1515-1517`.
3. The store's selector is the **first** branch after the fence, unconditional:
   `if (write.modelVersion !== undefined) { return await this.appendAtomicVersioned(...); }`
   — `supabase-store.ts:355-361`. Both fallbacks (`appendAtomicFenced`, `dispatchCheckedAppend`)
   sit **after** it and are unreachable once `modelVersion` is set.
4. `appendAtomicVersioned` returns only `parseAtomicVersionedAppend(data)` — `supabase-store.ts:1388`.
5. And that parser contains the real source of `undefined`:
   **`if (receiptRaw === null) return { id: row.turn_row_id };`** — `supabase-store.ts:117`
   — returning an object with **no `modelVersionReceipt` key at all**, i.e. `undefined`.

So at `commit.ts:1632`, v5 was **always** the selected RPC, and `no_receipt` can only mean
**"`append_turn_atomic_v5` ran and its SQL returned a NULL receipt."** The comment names the
one cause that cannot occur there.

**Consequence:** anyone reading `no_receipt` as "versioning wasn't attempted" is reading
88% of the events backwards. v5 WAS called every single time.

### WHICH NULL-RECEIPT CAUSE IS IT?

The two candidate causes are (i) guest scenario, (ii) stored hash already equals incoming hash.
The DB proxy separates them:
- **Guest accounts for 1658/1658 of the no-version turns.** Every single one.
- **Among the 374 signed-in versioned turns, the hash-equal no-op occurred ZERO times**
  (the (created=false, guest=false) cell is empty across 7 days).

**VERDICT: the silent no-op rate is 81.6% over 7 days (1658/2032 turns; 88.0% / 117-of-133
events over the ~21.5h the telemetry has existed), and it is GUEST-CONDITIONAL in full.
The hash-equality cause contributed zero observable cases for signed-in scenarios in 7 days.**
Note 374 versioned turns across 374 distinct scenarios — exactly one each, consistent with the
`version_number: 1` seen in the log sample.

**Timestamps:** log counts 2026-09-21T22:52:01Z; DB proxy 2026-09-21T22:53:42Z (DB clock
21:53:41.919Z); cross-instrument join 2026-09-21T22:54:13Z.

---

## Files written

- `evidence/P-measurements.md` (this file)
- `evidence/M4-version-committed-raw.json` — all 133 parsed events
- `evidence/M4-scenarios.json` — the two scenario-id sets
- `evidence/envkeys-cee-production.json`, `evidence/envkeys-cee-staging.json` — full key manifests
- `evidence/envvars-*.json` — raw paginated API responses
