# Deliverable 2 — Intra-batch ENTITY_NOT_FOUND: minimal live repro spec

**Status: REPRODUCED LIVE** on build e122f16, 2026-07-07 23:48:37Z, scenario `2cd44277-3c53-4d15-8bb4-3f222eef96a1`, turn `106157e0-fe20-4903-9b9b-95b93625005a`. This is the input spec for the queued CEE intra-batch referee-sequencing lane (HANDOVER §0 NEXT-WAVE item 2; lane15 follow-up 1 — "THE last blocker before Paul's GM live-mode decision").

## The defect (one sentence)

`refereeMutationBatch` judges each candidate envelope independently against the PRE-edit frame graph, so any batch that adds a node AND references it in the same batch (edges, or configuration updates) has its referencing envelopes rejected `ENTITY_NOT_FOUND` — the governing verdict becomes `rejected` (precedence `rejected > stale > held > clarify`) and live mode would wholesale-block a batch that CEE's own edit pipeline validates and applies fine.

## Minimal live repro (verified recipe)

1. Fresh scenario; draft any goal-bearing decision via `POST /orchestrate/v2/turn` (`stage:"frame"`, composer message). Wait for the graph.
2. Send the composer message:
   > "Add a factor called Client Referral Rate with a positive link to Customer Conversion Quality, and connect each launch option to it"
   (generalised: *"Add a factor called X with a positive link to \<existing outcome\>, and connect each option to it"* — the trailing clause matters, see "Repro hazard" below.)
3. Observe (Render logs, service srv-d4slpaili9vc73eiq4og):
   - `v5.edit_graph.turn` → `outcome:"success", branch:"apply", operations_count:6, graph_nodes_before:15, graph_nodes_after:16, graph_edges_before:28, graph_edges_after:33` — **CEE applied and committed the whole batch.**
   - Referee (shadow): `add_node` → `held` `STRUCTURAL_APPLY_HELD`; **all 5 `add_edge` envelopes → `rejected` `ENTITY_NOT_FOUND`** (`governing_candidate:true` on the first), because every edge references `fac_client_referral_rate`, which exists only intra-batch.
   - `base_hash_match:true` on all envelopes — the rejection is purely referential, not staleness.

Contrast pair (same session, proves the gap is intra-batch referencing, nothing else):
- t10 23:51:44 "Add a positive link from Client Referral Rate to Early Revenue Window" — node now pre-exists → the identical op class yields `held` `STRUCTURAL_APPLY_HELD`, not rejected.

## Repro hazard for the fix lane (important)

The naive one-edge phrasing ("Add a factor called X with a positive link to \<outcome\>", NO option-connection clause) does NOT reach the referee on this build: the LLM emits 2 ops (add_node + add_edge) with no upstream connectivity, CEE's own patch validation rejects the batch (`NO_PATH_TO_GOAL`, honest refusal), and **the referee gate never runs on CEE-rejected patches** (`edit-graph-dispatch.ts` gate requires `successfulAppliedMutation`). Verified live at 23:46:27Z (t3: `outcome:"rejected", failure_code:"NO_PATH_TO_GOAL", operations_count:2`, zero candidate_mutation events). The fix lane's RED fixture must use a batch CEE accepts — include the option-linkage clause or construct ops directly.

## Expected shape of the fix (from lane15 follow-up 1, for the lane brief)

Referee add-X-with-link batches against a cumulatively-applied candidate view (apply each envelope to a working copy of the frame graph before judging the next), or split/sequence batches producer-side so referenced entities are judged in dependency order. Acceptance for the fix, replayable via the recipe above: the same 6-op batch yields `held` on all 6 envelopes (add_node STRUCTURAL_APPLY_HELD + 5 add_edge STRUCTURAL_APPLY_HELD), governing verdict `held`, zero ENTITY_NOT_FOUND; and a batch referencing a genuinely absent node still rejects ENTITY_NOT_FOUND (negative control).

## Live-mode consequence (why this blocks the flip)

With `CEE_GRAPH_MANAGEMENT_MODE=live`, this turn's governing verdict `rejected` would wholesale-block the commonest structural edit ("add a factor and wire it in") that the edit pipeline itself handles correctly — the user would get a rejection template for a change CEE could have safely held for confirm. Evidence lines: `raw/logs-SA-turn4-verdicts.txt` (all 6 verdict events, full JSON) and `raw/logs-SA-turn4-full.txt` (the surrounding turn).
