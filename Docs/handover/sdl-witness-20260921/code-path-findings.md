# Lane B — code-path findings (static, repo HEAD e717e19d05542a80254ea056aa95a59c2cde4053)

All line refs are in the lane-b clone at that HEAD (asserted with `git rev-parse HEAD`).

## F1. The SQL ordering, in the repo (lane A owns the LIVE proof)
`supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql`
- `:693` `RAISE EXCEPTION USING ERRCODE = 'OLGC1'` — the CAS raise.
- `:710` `v_turn_preexisting := FOUND;` — the replay lookup.
=> CAS precedes the replay lookup in the repo's defining migration. 693 < 710.
The fix migration `supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql`
exists IN THE REPO at this HEAD and states it is NOT EXECUTED.

## F2. The exact CAS predicate (five conjuncts), :688-694
```
IF p_cas_enforce
   AND p_expected_base_known
   AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
   AND p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash
   AND NOT (v_current_hash IS NULL AND p_expected_graph_identity_hash IS NOT NULL)
```
Conjunct 3 is the one the wire controls: it needs expected != current.

## F3. THE WIRE CANNOT SUPPLY THE EXPECTED BASE
`src/orchestrator-v5/turn-executor.ts:1690-1692`
```
const expectedBaseGraph = resolvedCanonicalGraphForCommit
  ? resolvedCanonicalGraphForCommit.graph
  : context.persistedGraph;
expectedGraphCasHashes = computeExpectedGraphCasHashes(expectedBaseGraph);
```
`computeExpectedGraphCasHashes` (src/orchestrator-v5/context/graph-cas-conflict.ts:192-205)
is documented "trusted base rule - never call this with request-supplied graph_state".
The expected base is the SERVER-SIDE persisted graph read at turn start. A replayed HTTP
POST re-reads the head, so it sends expected = CURRENT head, and conjunct 3 is FALSE.

## F4. The replay arm IS designed to be wire-reachable (mutation id is deterministic)
`src/orchestrator-v5/commit.ts:828-834`
```
function deterministicMutationId(scenarioId: string, turnId: string): string {
  const hex = createHash('sha256')
    .update(`olumi:model-version:committed-mutation:${scenarioId}:${turnId}`)...
```
called at `commit.ts:1045` as `mutation_id: deterministicMutationId(metadata.scenario_id, metadata.turn_id)`.
So a replay with the SAME turn_id sends the SAME p_version_mutation_id, and the MV422 guard
at the migration's `:744` ("turn replay reused with another mutation id") does NOT fire.

## F5. The turn fence is idempotent on turn_id
`supabase/migrations/20260731120000_v5_turn_fence.sql:133-146` — `v5_claim_turn_fence` is
`INSERT ... ON CONFLICT (scenario_id, turn_id) DO UPDATE SET scenario_id = ... RETURNING generation`.
A replay re-claims its ORIGINAL generation. `generation < max_generation` => verdict `superseded`.
BUT the fence verdict is computed inside `append_turn_atomic_v4`, which v5 calls at `:715`,
i.e. AFTER the OLGC1 raise at `:693`. So when the CAS fires, the fence never speaks.

## F6. Asymmetry: the versioned path has NO replay passthrough
`src/orchestrator-v5/session/supabase-store.ts:1177-1179` (v4 path, `appendAtomicFenced`):
a `superseded` fence verdict calls `tryFirstWriteExemptRecovery` -> `committedTurnRowId`
and RETURNS the existing row id.
`supabase-store.ts:1340-1363` (v5 path, `appendAtomicVersioned`): the same
`classifyAtomicFenceError` branch throws `throwFenceRefusal` with NO recovery attempt.
So on the versioned path a superseded replay is refused where on v4 it was answered.

## F7. No retry loop re-sends the original args
`rg -a -n -i "retry|retries|attempt" src/orchestrator-v5/session/supabase-store.ts` returns
3 hits, all prose/comments (`:918`, `:978`, `:1429`). There is no loop in the store that
re-calls the RPC with the same `p_expected_graph_identity_hash` after a failure.
CONTRAST CONTROL: the same rg over `src/orchestrator-v5/turn-executor.ts` returns 20 hits
including a real multi-attempt seam (`:1700 lastCommitConflictError = null;` "clear any
previous attempt's conflict"), proving the probe finds attempt machinery where it exists.

---

## LIVE CONFIRMATION (added 2026-09-21T23:12Z, after the live run)

Served build for all live measurements: **bd35cc9e1a838159ec3949a278a89820acb01151**
(a deploy landed mid-run; the 55-file diff from e717e19d does NOT touch the defect
path — see evidence/W3A-live-witness.md for the grep and its contrast control).

- **F4 PROVEN LIVE.** `model_version_mutation_id` on two live turn rows equals
  `deterministicMutationId(scenario_id, turn_id)` exactly; the two server-minted
  ids produce different uuids (contrast control). This also proves
  `append_turn_atomic_v5` runs for GUEST scenarios (`scenarios.user_id IS NULL`).
- **F3 PROVEN LIVE.** `v5.graph_cas.evaluated` on the wire showed
  `expected_identity_hash == current_identity_hash`, `category=match`.
- **NEW, and it changes the verdict — the ingress `turn_id` is not always the
  committed one.** `route-v2-preflight.ts:416` -> `utils/request-id.ts:39-69`
  mints a request id per HTTP request, and the turn-executor commit sites pass
  `turn_id: context.request_id`. A replayed MESSAGE turn therefore commits under a
  NEW turn_id and `v_turn_preexisting` is FALSE. Measured in the Render logs, with
  the first send of the same body as the contrast control.
- **F6 stands** and is the asymmetry to cite in the migration request.

FULL WITNESS AND VERDICT: `evidence/W3A-live-witness.md`.
