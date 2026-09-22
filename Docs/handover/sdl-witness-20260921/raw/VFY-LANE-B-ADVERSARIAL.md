# ADVERSARIAL VERIFICATION OF LANE B — 2026-09-21T23:1x UTC

Verifier clone HEAD asserted: e717e19d05542a80254ea056aa95a59c2cde4053 (40 chars), tree clean.
Lane B branch feat/sdl-state-spine-witness @ 9ce6d44ee4f60f862996a2673f036086c2ac2b75 — CONFIRMED,
sits directly on e717e19d.
Served staging build NOW (23:16:06Z): bd35cc9 ; gh staging head = bd35cc9e1a838159ec3949a278a89820acb01151 (40).
graph_cas NOW: {"app_mode":"observe","rpc_mode":"enforce","enforcing":true} -> p_cas_enforce TRUE
(supabase-store.ts:1318 `p_cas_enforce: rpcMode === 'enforce'`). CONFIRMED.

## CONFIRMED (re-derived independently)

C1. SQL ordering, REPO: OLGC1 raise 693 < replay SELECT 706 / `v_turn_preexisting := FOUND` 710.
C2. SQL ordering, LIVE (I pulled pg_get_functiondef myself, read-only, sliced after BEGIN,
    `--` comments stripped): OLGC1 at body-line 118, replay SELECT at 130, v4 call at 140,
    replay arm at 162. ORDERING HOLDS ON THE DEPLOYED FUNCTION. Lane B disclaimed this; it is true.
C3. Expected-base hash is never request-supplied. All 19 computeExpectedGraphCasHashes call sites
    enumerated; every expected-base one takes a server-read graph (result.baseGraph /
    context.persistedGraph / before / strictBase / rereadGraph / base). The three that take
    `write.graph` compute p_incoming_*, not p_expected_*. CONFIRMED.
C4. deterministicMutationId: 5 of 5 versioned live rows match
    sha256('olumi:model-version:committed-mutation:<sc>:<turn>') reshaped per commit.ts:828-833
    (note the variant nibble is a LITERAL 'a', not computed — my first probe computed it and
    mis-flagged 3 of 5; the probe was wrong, not the lane). Contrast control: the two minted ids
    produce c72bb390-721f-5583-af6a-… and 64ba2ca6-99c3-53c0-a443-…, colliding with nothing.
C5. append_turn_atomic_v5 runs for GUEST scenarios: scenario ee26ba7c user_id IS NULL,
    model_versions for it = 0, global model_versions = 3939 (contrast non-zero). CONFIRMED.
C6. structural_delete stale gate exists and refuses; structural-delete.ts contains NO commit call
    (1 hit, a comment at :18) with contrast dispatch.ts = 23. CONFIRMED exactly as reported.
C7. base_graph_hash counts (rg -ac): structural-delete 7, structural-add 7, structural-add-edge 8,
    structural-rename 12, dispatch 24; edge-strength-edit / factor-value-edit /
    option-intervention-edit / scale-ask = 0. CONFIRMED.
C8. Deploy-window claim. gh compare e717e19d...bd35cc9 = 55 files. I widened the target pattern to
    also include system-events/, route-v2 and request-id.ts: still 1 hit, and it is
    supabase/migrations/20260920120000_v5_replacement_state.sql. Contrast orchestrator-v5/replacement/ = 46.
    The static reading at e717e19d does describe the served build on the defect path. CONFIRMED (strengthened).
C9. Render-log absence + contrast, re-pulled by me:
    REPLAY window 22:57:45-22:58:40Z  -> b5d96e17 = 0 hits, 714dd8ae = 41 hits
    FIRST  window 22:54:00-22:55:15Z  -> b5d96e17 = 9 hits, 3c36f068 = 30 hits
    Both id families appear in the corpus. The absence is real, not a blind probe. CONFIRMED.
C10. committedTurnRowId has exactly one runtime caller, the v4 superseded branch
    (supabase-store.ts:1178 -> tryFirstWriteExemptRecovery:1435 -> committedTurnRowId:1457).
    The v5 path (appendAtomicVersioned) has no recovery. CONFIRMED.

## REFUTED

R1. "the ingress turn_id is never presented to the store" (keyFinding 2) is FALSE.
    MANIFEST, derived by me over the two committing files:
      src/orchestrator/route-v2.ts        : 9 of 9 commitDirectAnswer/commitTurn sites pass
                                            `turn_id: ingress.turn_id`  (CLIENT-SUPPLIED)
      src/orchestrator-v5/turn-executor.ts: 35 of 38 pass `turn_id: context.request_id` (minted)
      src/orchestrator-v5/handlers/draft-graph-dispatch.ts: commits with `payload.turn_id` (:1146)
    EMPIRICALLY: all 5 live rows that carry a model_version_mutation_id — i.e. every row that
    actually reached append_turn_atomic_v5 — have turn_id == the id the harness POSTed
    (b5d96e17, 234220ee, 638b1ece, 3941a9f0, e104225d). The family that reaches the RPC is
    precisely the family that commits under the INGRESS turn_id. This is the opposite of the claim.
    Lane B's own contrast control (keyFinding 3) already contained this refutation.

R2. The mechanism attributed to the message-family result is wrong, so the result does not
    generalise. The first send and the "byte-identical replay" did not run the same code path:
      first send  -> row 60beee4e turn_class=direct_answer, log "draft_graph: starting unified…"
      replay      -> row ea2d9f2c turn_class=clarify,       log "v5.continuation.guard_applied"
    The replay committed a NEW turn with model_version_mutation_id NULL — it never reached the v5
    RPC at all. Same body, different branch, because conversational state had advanced. Nothing
    "intercepted" it: it ran to completion and returned 200.

R3. "each intercepted upstream of the RPC by a different named guard" (headline) is inaccurate for
    family 1. Families 2 and 3 were genuinely refused by named gates (BASE_HASH_DIVERGED,
    edge_expected_tuple_mismatch). Family 1 was not refused by anything.

R4. "the fence would refuse / nothing reaches the replay arm" is not supported by the DEPLOYED v4,
    which I pulled myself. v4 computes `v_already_committed` FIRST, and its fence gate is guarded by
    `IF p_fence_generation IS NOT NULL AND p_graph IS NOT NULL AND NOT v_already_committed`.
    A replay of a committed turn therefore SKIPS the fence entirely, falls to
    `INSERT … ON CONFLICT DO NOTHING`, `IF NOT FOUND` -> returns the existing row id with no side
    effect. So on a same-turn_id replay the fence never speaks and v5's replay arm at :738 IS
    entered — provided the CAS at :693 does not fire first. That is exactly the defect, and the
    fence is not a barrier to it.

## UNSUPPORTED (not refuted, but not evidenced)

U1. "NOT reachable from the wire" / "no wire path reaches the ordering it changes". What was shown
    is that ONE single-client sequential replay of each of three bodies did not reach it. The
    load-bearing barrier is CAS conjunct 3 (`v_current_hash IS DISTINCT FROM
    p_expected_graph_identity_hash`), which is false only because expected and current are the same
    fresh server read. Two concurrent wire clients on one scenario make it true — that is the race
    the CAS exists for, and the lane concedes it neither observed nor staged it. "Not reachable" and
    "not reachable by a single sequential client" are different claims.
U2. The system_event manifest is incomplete as presented. system-events/*.ts holds 9 files, not 7;
    scale-ask.ts is never mentioned. dispatch.ts routes 7 `mutating` kinds (the ones named) AND 4
    further `fact_and_commit` kinds — feedback, edge_adjudication, prior_range_edit, finding_dissent
    (dispatch.ts:454-493 via buildJudgementFact) — which are never enumerated or excluded with a
    reason. Mitigating: the v5 RPC requires a graph carrier, so the non-mutating four are unlikely
    to reach it — but that argument is not made and not measured.
U3. "There is no client-facing endpoint that replays a turn to recover a receipt." Definitional.
    Given 9 of 9 route-v2 commit sites use the ingress turn_id, a client re-POSTing a used turn_id
    to a direct-answer path is functionally that replay.
U4. The two 409 refusals (structural_delete BASE_HASH_DIVERGED, edge_strength_edit
    edge_expected_tuple_mismatch) I did NOT re-run live. I corroborated only their end state from
    the DB (D1/D2/E1 rows present with their reported ids and mutation ids; head = ff395615…,
    the post-E1 value, i.e. unmoved by the replays). Taken from the lane's transcript, not re-derived.

## FACT CORRECTIONS (minor)

F1. The CAS predicate begins at :687 (`IF p_cas_enforce`), not :688. Raise at :693, ERRCODE at :694.
F2. structural-delete stale gate: comment at :455, `return refuse(` at :477. Cited as 462-484/456-484.
F3. supabase-store: :1438 is the CALL to committedTurnRowId inside tryFirstWriteExemptRecovery
    (defined :1435); :1457 is the definition. The lane lists 1438 and 1457 both as "definitions".
F4. `turn_id: context.request_id` occurs 36 times in turn-executor.ts, not "≈30".
