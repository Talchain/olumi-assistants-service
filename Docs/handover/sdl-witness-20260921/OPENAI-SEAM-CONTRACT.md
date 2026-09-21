# CEE canonical-write seam — integration contract for the connected-witness workstream

Derived 2026-09-21 (UTC) against `Talchain/olumi-assistants-service` **HEAD `e717e19d05542a80254ea056aa95a59c2cde4053`** (branch `staging`),
and against the LIVE Supabase project (`set transaction read only`) that serves staging AND production.
Every line number is from that SHA. Status is one of **PROVEN-IN-CODE** / **MEASURED-LIVE** / **UNVERIFIED**. No test suite was executed in this session (`node_modules` absent), so nothing here is labelled PROVEN-BY-TEST.

---

## VERDICT on `POST /assist/v1/scenarios/:scenario_id/graph/register`

**A — it is NOT an acceptable authoritative initial-write path.** It is already in heavy use, and it has never once produced a version.

| Measured | Value | Control (same run) |
|---|---|---|
| Register writes ever (`v5_conversation_turns.turn_id LIKE 'graph_registration:%'`) | **442**, over 331 scenarios, latest `2026-09-21T20:43:17Z` | all turns: 38,055 |
| …in the last 7 days | **139** | all turns in 7d: 5,271 |
| Of those 442, how many set `model_version_created` | **0** (all NULL — the v5 RPC never ran) | across all turns: `true` 3,353 / `false` 8,374 |
| Render logs 7d, text `graph/register` | **886** lines | `orchestrate/v2/turn` ≥1500 (hit the 15-page cap) |
| Owned scenarios with a graph and `current_model_version_id IS NULL` | **89**: 72 register-touched + hash-stamped, 17 neither | owned+graph+**has** version: 3,469 |

Live reads timestamped 2026-09-21T22:50–22:52Z. The `turn_id` prefix is minted at `assist.v1.scenario-graph-register.ts:176-178`
(`graph_registration:${crypto.randomUUID()}`), so the count is identity-bound, not a text match.

**What breaks (all PROVEN-IN-CODE at this SHA):**

1. **No version row.** The route's `appendCheckedGraphWrite` call (`assist.v1.scenario-graph-register.ts:455`, `write` object ends `:496`)
   carries **no `modelVersion` key** — `rg -a -n "modelVersion" <that file>` returns **zero** matches (exit 1).
   *Contrast controls in the same run:* `commit.ts` → 8 matches; the same-family key `expectedGraphIdentityHash` IS found in the register file at `:405,:418,:430,:494`.
   `supabase-store.ts:355` (`if (write.modelVersion !== undefined)`) is the only door to `append_turn_atomic_v5`, so the write falls to v4/v3/v2.
2. **Pointer never moves.** `scenarios.current_model_version_id` is written only inside v5's version branch; v4 (deployed definition, read live) touches `graph` and `graph_identity_hash` only.
3. **The subtle one — it DOES advance `scenarios.graph_identity_hash`.** Deployed `append_turn_atomic_v4`, line 108-111 of `pg_get_functiondef`:
   `UPDATE scenarios SET graph = p_graph, graph_identity_hash = p_incoming_graph_identity_hash`.
   **100% of the 331 register-touched scenarios have `graph_identity_hash` stamped (MEASURED-LIVE).**
   `append_turn_atomic_v5` then decides at `20260824200000_c8_...sql:615-616`:
   `v_should_create := v_user_id IS NOT NULL AND v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash;`
   → a follow-up v5 turn that commits **the same bytes** the register just stored is silently skipped
   (`:808` returns `model_version_receipt: NULL`, turn and graph still commit). **So "register, then mint the initial version by re-committing" is a no-op.**
   ⚠ **Status: PROVEN-IN-CODE and in the DEPLOYED function; NOT OBSERVED IN PRODUCTION.** All 8,374 suppressed appends belong to **guest**
   scenarios (`user_id IS NULL`, the other conjunct); **zero owned scenarios have ever been suppressed**. The hazard is mechanical, not yet realised.

**The remedy (B), recommended, NOT implemented — and it is the smaller of the two options.**
Thread the version carrier into the register route's existing call: build the plan with `buildAtomicCommittedModelVersion`
(`commit.ts:978`, gate at `:982` = `config.cee.modelVersionsEnabled && graphWasProvided`) and spread it exactly as `commit.ts:1515-1516` does.
Cost, honestly stated:
- `buildAtomicCommittedModelVersion` is **module-private** (`function`, not `export function`) at `commit.ts:978` — it must be exported.
- It takes `(graph, metadata: CommitMetadata)`; the register route holds no `CommitMetadata` and would have to compose one.
- The RPC hard-refuses anything but `creation_kind='committed_mutation'` with `p_version_source_turn_id = p_turn_id` (`c8:590-591`); SQL then re-decides `'initial'` when the scenario has no versions (`c8:623-626`). A register into an empty scenario therefore lands `'initial'` correctly.
- It does **not** help guests: `v_user_id IS NOT NULL` still gates (`c8:615`).
- The alternative — a new authoritative route — is strictly larger and duplicates the persistence floor.

---

## The six questions

### 1 Initial model — which write path may create canonical state AND an initial version?
**Only `commitDirectAnswer`** (`src/orchestrator-v5/commit.ts:1100`).
Chain: `:1144` `buildAtomicCommittedModelVersion(...)` → `:1490` `appendCheckedGraphWrite({...})` with `modelVersion` spread at `:1515-1516`
→ `persist-graph-write.ts:336` (invariant check, then `store.append` at `:356`) → `supabase-store.ts:355` selects `append_turn_atomic_v5`.
`creation_kind` is decided **in SQL, never in TS**: `c8:623-626` → `'initial'` when the scenario has no versions, else `'committed_mutation'`.
Status: **PROVEN-IN-CODE**. A guard test asserting "exactly two callers" exists at `orchestrator-v5/__tests__/graph-writer-population.guard.test.ts:142`
— ⚠ **NOT RUN in this session** (the clone is blobless, `node_modules` absent), so treat it as a test that EXISTS, not as a passing result.

### 2 Revision — which exact function performs an authorised mutation?
`createApplyOperations(deps)` → the returned `applyOperations(input)` (`src/orchestrator-v5/apply-operations.ts:444`).
It resolves the memoised canonical store (`:450`), reads the base once, and delegates to `commitDirectAnswer` at `:590`.
Status: **PROVEN-IN-CODE**. ⛔ It has **no production importer at this SHA** — see "what does not exist yet".

### 3 Receipt — which structured fields prove success, and which prove refusal?
**Success is `model_version_receipt` on the response**, and nothing weaker.
Schema `ModelVersionMutationReceiptV1LocalSchema` (`model-management/mutation-receipt.ts:115-136`, `.strict()`), wire key at `:173`.
Load-bearing fields: `version_id`, `mutation_id`, `sequence`, `full_hash` (64-hex, over the PERSISTED bytes), `analysis_affecting_hash` (64-hex),
`graph_identity_hash`↔`full_hash`, `creation.kind` (`initial` | `committed_mutation` | `restore`), `lineage`, `source_turn_id`, `event_id`.
**Refusal / absence is `model_version_receipt` being absent**, plus the RPC's typed errors: `OLGC1` = stale graph CAS, `MV409` = unclaimable turn row.

⚠ **THE TRAP, verified.** `commit.ts:1849` is literally `const graphPersisted = writesGraph;` and `writesGraph` is
`graphWasProvided(metadata.graph)` (`:1160`) — i.e. **whether a graph was SUPPLIED, not whether the RPC stored one**.
The receipt is then built and attached inside a `try/catch` at `commit.ts:1542` / `catch (receiptErr)` at `:1557`, closing `:1576`, which **degrades to no-receipt** on any throw.
So `graphPersisted: true`, and any prose that says "saved", **is not evidence of a durable write**.
**What IS evidence:** the presence of `model_version_receipt` with a `version_id`, or a read-back of `scenarios.current_model_version_id`.
Status: **PROVEN-IN-CODE**.

### 4 Idempotency — what key must an Agent retry with, and what is not true about it?
**`ApplyOperationsInput.idempotencyKey`, which IS the `turn_id`** (`apply-operations.ts:152`, doc says so explicitly; used as `turn_id` at `:594`).
The DB carries `UNIQUE (scenario_id, turn_id)`, so a replay with the same key writes nothing and returns the same row id.
⛔ **NOT TRUE TODAY.** The deployed `append_turn_atomic_v5` evaluates its CAS **before** it looks up whether the turn already exists, so a replay of an
already-committed turn whose graph has since moved on is told `OLGC1` — *"your write was stale"* — when the write in fact committed.
**MEASURED-LIVE 2026-09-21T22:48:20Z** by `pg_get_functiondef`, comments stripped and body sliced after `BEGIN`:
`OLGC1` at body offset **2064**, `v_turn_preexisting :=` at **2590** — byte-identical offsets to repo `c8`.
*Discriminating control:* the fix migration `20260920210000_v5_append_v5_replay_precedes_cas.sql` run through the same procedure inverts them (1812 < 2577).
Second, independent confirmation: `supabase_migrations.schema_migrations` contains `20260824200000` and **not** `20260920210000`; the newest applied migration is `20260918014756`.
**Fixed only once `20260920210000` is applied. It is not applied.**

### 5 Revision token — which identifier, minted where, and why a client-supplied one is wrong
Supply **`ApplyOperationsInput.modelRevision`**, minted **server-side** by `currentModelRevision(scenarioId)` (`apply-operations.ts:302`),
which is `modelRevisionOf(await store.loadGraph(...))` = `computeAnalysisAffectingGraphHash` (16-hex) over the **stored** graph.
⛔ **Never mint it from the request's `extensions.graphState`** (the field's own doc says so at `apply-operations.ts:157-160`).
**Why, with the projection cited:** `projectGraphForPersistence` (`src/orchestrator-v5/persisted-graph-projection.ts:57`) runs three passes —
`repairGraphForPersistence`, `normaliseOptionInterventionContract`, `reconcileTopLevelOptionsFromNodes` (`:38-40`) — and its own header (`:9-14`)
records that these move `intercept`, node/option `interventions` and top-level `options[]`, **all three of which are inside the analysis-affecting
projection**. The ingress graph and the persisted graph therefore hash **differently**: bind consent to an ingress hash and every accept refuses.
Status: **PROVEN-IN-CODE**.

### 6 Analysis identity — which identity proves an analysis belongs to a model, and the truncation rule
Three projections, two of which share a name-stem. **Comparable only after truncation, never by string equality across families.**

| Identity | Function | Width | Lands in |
|---|---|---|---|
| Analysis-affecting, short | `computeAnalysisAffectingGraphHash` (`context/graph-hash.ts:115`) | **16-hex** (`:119`, `HASH_HEX_LENGTH = 16` at `:24`) | run_analysis fact `payload.result.graph_hash_at_run`; wire `analysis_result.computed_against_hash` |
| Analysis-affecting, full | `computeAnalysisAffectingGraphHashSha256` (`:129`) — **same projection**, `:163` | **64-hex** | `model_versions.analysis_affecting_hash` |
| Graph identity — a **different** projection | `computeGraphIdentityHash` (`context/graph-identity.ts:384`) | **64-hex** | `scenarios.graph_identity_hash`, `model_versions.graph_identity_hash` |

**Rule:** an analysis belongs to a model version iff `fact.payload.result.graph_hash_at_run === model_versions.analysis_affecting_hash.slice(0,16)`.
The fact value is written at `tools/handlers/run-analysis.ts:937` (`computeAnalysisAffectingGraphHash`) and stamped at `:2145`; it reaches the wire at `compose.ts:1350`.
Never compare `graph_identity_hash` against either analysis hash — different projection, not a truncation of each other. Status: **PROVEN-IN-CODE**.

---

## What does NOT exist yet (each an absence claim with its contrast control, same run)

- **No `model_version_id` anywhere on the analysis fact or the wire.** `rg -a -c model_version_id` = **0** in `tools/handlers/run-analysis.ts`,
  `context/freshness.ts` and `routes/scenario-graph-analysis-read.ts`; *control*, `graph_hash_at_run` in the same three files = 6 / 25 / 1.
  `SelectedRunAnalysisFact` (`freshness.ts:233-238`) carries exactly `fact, index, graph_hash_at_run, computed_at, status`.
- **No `run_id` at all.** `rg -a -c '\brun_id\b'` over `src/` = **1 file, and it is a test** (`context/__tests__/context-pack-assembler.test.ts`);
  *control*, `graph_hash_at_run` matches 244 files. There is no production run identifier to join on.
- **No route mounts `createApplyOperations`.** `rg -a -n createApplyOperations --type ts src/` returns matches only in
  `__tests__/apply-operations.test.ts` and in its own file's JSDoc. Under one identical multiline import regex,
  `createApplyOperations` has **0** non-test importers (1 including tests) while *control* `commitDirectAnswer` has **10**
  (`route-v2.ts`, `turn-executor.ts`, the four `handlers/*-dispatch.ts`, `system-events/dispatch.ts`, `system-events/option-intervention-edit.ts`,
  `routing/persist-asked-question.ts`, `apply-operations.ts`). The authorised-mutation port exists and is unreachable.
- **Guest scenarios never version.** `c8:615` gates on `v_user_id IS NOT NULL`. MEASURED-LIVE: `model_version_created = false` on **8,374** turns,
  **100% of them guest-owned**; `= true` on **3,353**, **100% owned**. 10,321 guest scenarios hold a graph and no version.

## UNVERIFIED / not settled in this run
- Whether the 72 stranded owned scenarios were *intended* to have versions. What would settle it: the client that called `/graph/register` for them.
- Whether `/graph/register` is on the OpenAI workstream's intended path at all, or only the UI's import lane.
- Render's control probes hit the 15-page pagination cap (1,500), so those are **lower bounds**; the target counts (886 / 421) are under the cap and complete for the window.
