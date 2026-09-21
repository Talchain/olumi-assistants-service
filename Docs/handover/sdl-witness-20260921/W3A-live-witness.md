# W3-A LIVE WITNESS — is the append_turn_atomic_v5 replay-before-CAS defect WIRE-REACHABLE?

**Lane B. Written 2026-09-21T23:10Z. Every number below was measured in this run.**

## VERDICT

**NOT REACHABLE FROM THE WIRE.** The SQL defect is real (lane A owns that proof),
but a wire client cannot drive the deployed staging service into the OLGC1 raise
by replaying a turn. Three different turn families were replayed byte-identically
against the deployed service and **all three were intercepted upstream of
`append_turn_atomic_v5`**, each by a different, named guard.

This is a finding, not a failure to reproduce: it bounds the defect's live blast
radius and it means the fix migration is low-risk against current traffic.

---

## BINDING — what was tested

| | |
|---|---|
| Base URL | `https://cee-staging.onrender.com` |
| Served build at run time | **`bd35cc9`** (`/healthz.build`) |
| Full served SHA | `bd35cc9e1a838159ec3949a278a89820acb01151` (`gh api .../commits/staging`, asserted 40 chars) |
| Served `graph_cas` | `{"app_mode":"observe","rpc_mode":"enforce","enforcing":true,"requires_expected_hash":true}` — **so `p_cas_enforce` is TRUE** |
| Repo clone HEAD (static reading) | `e717e19d05542a80254ea056aa95a59c2cde4053` |
| Scenario used | `ee26ba7c-0006-47e6-8bc1-9c8cc269c681`, **`scenarios.user_id IS NULL` = GUEST** |

### A deploy landed DURING this run — recorded, not hidden
At **22:49:43Z** `/healthz` served `e717e19`. At **22:53:00Z** it served `bd35cc9`
(PR #1659 merged 22:50:35Z). Every live measurement below is from **`bd35cc9`**.

The static reading was done at `e717e19d`. That remains valid for the served
build because the 55 changed files do **not** include the defect path:

```
gh api .../compare/e717e19d...bd35cc9 --jq '.files[].filename'   # 55 files
grep -E 'supabase/migrations/|supabase-store.ts|turn-executor.ts|commit.ts|turn-fence|graph-cas-conflict.ts|system-events/dispatch.ts|route-v2.ts'
  -> 1 hit: supabase/migrations/20260920120000_v5_replacement_state.sql  (the replacement module's OWN state table, not append_turn_atomic_v5)
CONTRAST CONTROL: grep 'orchestrator-v5/replacement/'  -> 46 hits
```
Target ~0 on the defect path, contrast non-zero. The probe sees changes where they exist.

---

## THE W3-A SEQUENCE, AS RUN (message-turn family)

| step | UTC | what | result |
|---|---|---|---|
| 1 seed | 22:54:04–22:55:12 | guest scenario from the FIXED brief | graph persisted, **hash A = `bc8fc135a50835642310f72275a497df2d902f5e20bd1cb1042114aa89bbf3cd`**; 13 nodes / 4 options / 24 edges |
| 1b | 22:55 | version check | **`model_versions` = 0 rows.** Expected: `user_id IS NULL` ⇒ `v_should_create` FALSE. **Documented design, NOT a failure.** The turn row still carries `model_version_mutation_id` (see below), which is the proof v5 ran. |
| 2 head move | 22:57:48–22:57:53 | `structural_delete` of option `27a94e3e` | **hash B = `8140894a85fd8ee7e6f831458f4beaa1a77ee43e59c107ad8e3d682f66fff806`**, head MOVED |
| 3 replay | 22:58:04–22:58:15 | **byte-identical** re-POST of step 1's body (same `turn_id b5d96e17-…`) | **HTTP 200, `error: null`**, head unchanged |
| 4 durability | 22:58:44 | read `v5_conversation_turns` | step 1's row **UNCHANGED** — same row id `60beee4e-…`, same `model_version_mutation_id`, same `created_at 22:55:00.236344+00` |

**Expected under the defect: step 3 refused as stale. It was NOT.** And the reason
is not that the defect is absent — it is that step 3 never reached the defect.

---

## WHY STEP 3 NEVER REACHED THE RPC — the code path that decides it

### The interception, measured in the Render logs of the deployed service

`GET /v1/logs` on `srv-d4slpaili9vc73eiq4og`, window 22:57:45–22:58:40Z, filtered on the scenario id (51 entries, `hasMore:false`):

```
22:58:12 … request_id=714dd8ae-0ebe-42c8-8085-f35aa4137655  event=v5.continuation.guard_applied
22:58:13 … request_id=714dd8ae-…  event=turn_executor.started
22:58:21 … turn_id=714dd8ae-…     event=v5.coaching_state.persisted
```

The replay was POSTed with `turn_id = b5d96e17-8384-42f9-90cd-d4bb8cceacd1`.
**`b5d96e17` appears NOWHERE in the replay's log window.** The whole request ran,
and COMMITTED, under a server-minted id `714dd8ae-…`, which is also the
`turn_id` of the new row written to `v5_conversation_turns` at 22:58:21.

**CONTRAST CONTROL — the probe is not blind to ingress-turn_id commits.** In the
window of the FIRST send of that same body (22:54:00–22:55:15Z, 65 entries):

```
22:54:11 … request_id=3c36f068-6936-40bf-b5a7-d1d51c1f77d0  event=v5.clarify_v2.proceeded
22:54:59 … turn_id=b5d96e17-8384-42f9-90cd-d4bb8cceacd1     event=v5.graph_cas.evaluated
22:55:00 … turn_id=b5d96e17-…                               event=v5.model_versions.version_committed
```
The first send's `request_id` was ALSO minted (`3c36f068`), yet its commit carried
the **ingress** `turn_id b5d96e17`. So both id families really do appear in these
logs; the absence of `b5d96e17` on the replay is a real absence.

### The code

- `src/orchestrator/route-v2-preflight.ts:416` — `const requestId = getOrGenerateRequestId(req);`
- `src/utils/request-id.ts:39-69` — `getOrGenerateRequestId` reads `X-Request-Id` /
  `X-CEE-Request-ID` / `x-correlation-id` and otherwise **generates a fresh UUID per HTTP request**.
- `src/orchestrator-v5/turn-executor.ts` — the turn-executor commit sites pass
  **`turn_id: context.request_id`** (≈30 occurrences, e.g. `:8308`, `:8427`, `:8614`).
- `src/orchestrator-v5/commit.ts:969,1497` — `turn_id: metadata.turn_id`, i.e. whatever the caller passed.

So on the turn-executor branch the persisted `v5_conversation_turns.turn_id` is the
**per-HTTP-request generated id**, not the client's body `turn_id`. The body
`turn_id` is consumed only by the **turn fence**
(`src/orchestrator/turn-fence-prehandler.ts:74-82` reads `body.turn_id`), which is
idempotent on it (`supabase/migrations/20260731120000_v5_turn_fence.sql:141-145`,
`ON CONFLICT (scenario_id,turn_id) DO UPDATE … RETURNING generation`).

**Consequence:** on a message-turn replay, `append_turn_atomic_v5` receives a
`p_turn_id` it has never seen, so `v_turn_preexisting` is FALSE, the replay arm at
the migration's `:738` is never entered, and the CAS-before-replay ordering cannot
bite.

---

## THE OTHER TWO FAMILIES — both also intercepted, each by a different guard

A `message` turn is not the whole wire. The **system_event** families DO commit
under the ingress `turn_id` (proven below), so they were replayed too.

### (2) `structural_delete` — refused by the whole-graph consent gate

Run 23:02:13–23:02:40Z on the same scenario:

```
D1  delete 699effec  turn=638b1ece-a2ab-41c9-9569-60fb68e7d452  HTTP 200
    head 8140894a… -> d1a330cdea332c898d38b8902379d310b72d676dce8618a0dee848e1bbf8c4e3
D2  delete 94f899fa  turn=3941a9f0-9cb3-49de-9cba-68a727f13f8f  HTTP 200
    head d1a330cd… -> 64e08264a5f09825fead39e91061de3e2e97a7173cff847b2d0c248fd130e41b
REPLAY D1 byte-identical=true -> HTTP 409  error="GRAPH_DIVERGED"  conflict_category="BASE_HASH_DIVERGED"
    head UNCHANGED (64e08264…)
    D1 turn row before == after: id 3ae0d73f-2c07-4c3a-9b37-7a6ca89f4964,
       model_version_mutation_id 1d549076-fef3-512c-a4f7-36ea60d51ea5, created_at 23:02:24.835109+00
```

**Code path that decides it:** `src/orchestrator-v5/system-events/structural-delete.ts:456-484`
— *"THE STALE GATE, before anything is resolved"*: it recomputes
`computeAnalysisAffectingGraphHash(persistedGraph)` and `return refuse(payload, BASE_HASH_DIVERGED, …)`
when it differs from `event.base_graph_hash`. **That file contains no commit call at all**
(`rg -a -n "commitDirectAnswer|commitTurn|append\(" structural-delete.ts` → 1 hit, a
comment at `:18` naming `dispatch.ts` as the committer). The refusal returns before
dispatch commits, so the RPC is never called.

### (3) `edge_strength_edit` — refused by the per-edge expected-tuple gate

`edge_strength_edit`, `factor_value_edit` and `option_intervention_edit` carry
**no** `base_graph_hash` (`rg -ac base_graph_hash` over `src/orchestrator-v5/system-events/*.ts`:
`structural-delete 7`, `structural-add 7`, `structural-add-edge 8`, `structural-rename 12`,
**`edge-strength-edit 0`, `factor-value-edit 0`, `option-intervention-edit 0`**), so they
were tested separately. Run 23:04:56–23:05:00Z:

```
E1  edge_strength_edit 18653591->3b985e55 set mean 0.65 -> 0.5   turn=e104225d-46c9-4b59-a848-2bad7742d316
    HTTP 200; head 64e08264… -> ff3956153b57febc62e0de4140cd4af659188ba9f353189a59f712e811c51454
    turn row: id afb90bab-105f-4eee-aa27-faf795df6486, turn_class handler,
              model_version_mutation_id 998d872a-012d-587b-a041-7a5d444b5bd8
REPLAY E1 byte-identical -> HTTP 409  error="GRAPH_DIVERGED"
    conflict_category="edge_expected_tuple_mismatch"
    details.edge = {from:18653591, to:3b985e55, expected:{mean:0.65,...}, current:{mean:0.5,...}, match_count:1}
    head UNCHANGED; E1 turn row byte-for-byte UNCHANGED
```

The per-edge `expected` tuple the client sent is stale the moment its own edit
commits, so the replay is refused before the commit.

---

## THE INVARIANT THAT MAKES THIS STRUCTURAL, NOT ACCIDENTAL

Even past every gate above, the CAS predicate's third conjunct could not be
satisfied. `append_turn_atomic_v5` raises OLGC1 only when

```
p_cas_enforce AND p_expected_base_known
  AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash   <-- needs expected != current
  AND p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash
  AND NOT (v_current_hash IS NULL AND p_expected_graph_identity_hash IS NOT NULL)
```
(`supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql:688-694`,
raise at `:693`; the replay lookup is at `:702-710` — **693 < 710**, the defect.)

**`p_expected_graph_identity_hash` can never be supplied by a wire client.**
Every producer in the tree computes it from a graph the SERVER read inside the
same request, moments before the RPC:

| producer | source |
|---|---|
| `turn-executor.ts:1690-1692` | `resolvedCanonicalGraphForCommit ?? context.persistedGraph` |
| `system-events/dispatch.ts:1074, 1478, 1802, 2431, 2733, 3057` | `computeExpectedGraphCasHashes(result.baseGraph)` |
| `routes/assist.v1.scenario-graph-register.ts:405-420` | `store.loadGraph(scenarioId)` — comment: *"The trusted CAS base — the SERVER's bytes, never the request's"* |

and `computeExpectedGraphCasHashes` (`context/graph-cas-conflict.ts:192-205`) is
documented *"trusted base rule — never call this with request-supplied `graph_state`"*.

**Measured confirmation on the wire**, from the head-mover's own telemetry at 22:57:51Z:
```
event=v5.graph_cas.evaluated  turn_id=234220ee-…
  expected_identity_hash=bc8fc135a5083564
  current_identity_hash =bc8fc135a5083564      <-- IDENTICAL
  incoming_identity_hash=8140894a85fd8ee7
  category=match  mode=observe
```
Expected equals current because both are the same fresh server read. Conjunct 3 is FALSE.

**So OLGC1 on an already-committed turn requires a concurrent writer to land
between the server's base read and its RPC — a sub-second race.** And that race
cannot be staged from the wire, because every replay family is refused by one of
the three upstream gates above **before** it can get into that window.

---

## COLLATERAL FACT, PROVEN LIVE — the replay arm IS designed for wire replay

`src/orchestrator-v5/commit.ts:828-834` derives the version id deterministically:
```
sha256(`olumi:model-version:committed-mutation:${scenarioId}:${turnId}`)
```
used at `commit.ts:1045`. Recomputed against the live rows:

| turn_id | computed | observed in `v5_conversation_turns` | match |
|---|---|---|---|
| `b5d96e17-8384-42f9-90cd-d4bb8cceacd1` | `64fb167b-d230-52a7-a637-9022cc24989f` | `64fb167b-d230-52a7-a637-9022cc24989f` | **YES** |
| `234220ee-b072-4b11-b5f9-42625f0b58dd` | `5fd1dc62-4572-54de-ab8a-35fbca409478` | `5fd1dc62-4572-54de-ab8a-35fbca409478` | **YES** |

**CONTRAST CONTROL:** the two server-minted ids produce different uuids
(`714dd8ae…`→`c72bb390-…`, `36a12764…`→`64ba2ca6-…`), neither matching any observed value.

Two consequences:
1. **`append_turn_atomic_v5` really does run for GUEST scenarios.** A non-null
   `model_version_mutation_id` on a `user_id IS NULL` scenario can only come from
   the versioned RPC. Confirmed on a scenario this run created.
2. A replay carrying the same `turn_id` would send the **same** `p_version_mutation_id`,
   so the `MV422` replay-identity guard (`:744`) would NOT fire. The replay arm is
   built to be reached by a wire replay. Today nothing reaches it.

---

## ASYMMETRY WORTH RECORDING FOR THE MIGRATION REQUEST

`src/orchestrator-v5/session/supabase-store.ts:1177-1179` (the **v4** path) answers a
`superseded` fence verdict by calling `tryFirstWriteExemptRecovery` →
`committedTurnRowId`, returning the existing row id. The **v5** path
(`:1340-1363`) has no such recovery: it calls `throwFenceRefusal` directly. So the
versioned path lost the read-only replay passthrough that v4 has.

`committedTurnRowId`'s only runtime caller is that v4 branch
(`rg -a committedTurnRowId src --glob '!**/__tests__/**'` → `store.ts:416` interface,
`supabase-store.ts:1178` call, `:1438`/`:1457` definitions, `apply-operations.ts:96` comment).
**There is no client-facing endpoint that replays a turn to recover a receipt.**
That is why the reconciliation contract the fix migration describes has no live user today.

---

## WHAT THIS DOES AND DOES NOT SUPPORT

**Supports:** the fix migration `20260920210000_v5_append_v5_replay_precedes_cas.sql`
is **low-risk against current live traffic** — no wire path reaches the ordering it
changes, so applying it cannot regress a path that is in use. It makes a currently
dead reconciliation contract work.

**Does NOT support:** any claim that the SQL defect is absent. It is present in the
deployed function (lane A's Postgres proof is the authority). It is latent.

**Does NOT support:** "the product is unaffected". Users ARE refused on replay — three
times in this run, with `GRAPH_DIVERGED`. Those refusals come from the consent gates,
are deliberate, and would not be changed by this migration.

---

## UNVERIFIED — and exactly what would settle each

1. **The sub-second race.** I did not land a concurrent writer inside the window
   between a server base read and its RPC, so I have not OBSERVED OLGC1 on a
   preexisting turn from the wire. I also could not stage it: every replay family is
   refused upstream first. *Settled by:* a server-side concurrency test that calls the
   store directly with a preexisting `turn_id` and a base hash made stale mid-flight —
   lane A's territory, not the wire's.
2. **Turn families not replayed.** `structural_add`, `structural_add_edge`,
   `structural_rename` (all carry `base_graph_hash`, so they are expected to behave like
   `structural_delete`) and `factor_value_edit` / `option_intervention_edit` (no
   `base_graph_hash`, expected to behave like `edge_strength_edit`) were NOT run live.
   The grep counts above are the whole manifest of `system-events/*.ts`; the behaviour
   of the five untested ones is INFERRED from the two tested. *Settled by:* running
   `--sysevent-w3a` against each.
3. **Which route-v2 branch uses the ingress `turn_id` vs `context.request_id`.** I proved
   BOTH happen and which happened in each measured case, but I did not enumerate every
   branch in the 8,391-line `route-v2.ts`. *Settled by:* enumerating the `commitTurn` /
   `commitDirectAnswer` call sites and their `turn_id` argument.

---

## THE HARNESS

`scripts/witness/sdl-state-spine.mjs` (committed on `feat/sdl-state-spine-witness`),
flags documented in its header:
`--seed --read --mutate --move-head --replay --sysevent-w3a --stale --race --w3a --report`,
plus `--scenario/--base-url/--state/--out`. Env: `SDL_API_KEY`, `SDL_SUPABASE_URL`,
`SDL_SUPABASE_KEY`, `SDL_EXPECT_SHA` (halts on a build-prefix mismatch — it halted this
run when the deploy landed, which is how the flip was caught).

Every assertion reads a DB row or a wire JSON field. Nothing asserts on assistant prose.
It never calls the RPC directly and never writes to the database.

**Cleanup:** scenario `ee26ba7c-0006-47e6-8bc1-9c8cc269c681` is left in place (guest,
synthetic). Nothing was deleted.

Machine transcript with every step's raw JSON: `evidence/W3A-machine-transcript.md`.
Static code findings: `evidence/code-path-findings.md`.
