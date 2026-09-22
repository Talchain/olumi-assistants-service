# VERIFIER RUN Mon 21 Sep 2026 23:00:24 UTC
HEAD=e717e19d05542a80254ea056aa95a59c2cde4053

## VERDICT: lane C headline SURVIVES; one cited mechanism REFUTED; not safe to escalate as written.

### R1 REFUTED — the register route CANNOT reach append_turn_atomic_v4.
Lane: "deployed append_turn_atomic_v4 lines 108-111 ... so the register route DOES advance the identity hash."
Chain re-derived at HEAD e717e19d05542a80254ea056aa95a59c2cde4053:
 - supabase-store.ts:364-365 reaches v4 ONLY when fencePlan.path==='atomic'.
 - enforceTurnFence():686 needs handle.generation!==null, which needs currentTurnFenceSlot() (:644) defined.
 - The ONLY non-test site that opens that AsyncLocalStorage is turn-fence-prehandler.ts:104
   (runWithPendingTurnFence), reached ONLY via turnFencePreHandler, attached to EXACTLY ONE route:
   route-v2.ts:2902  app.post('/orchestrate/v2/turn', { preHandler: turnFencePreHandler }, ...).
 - The register route registers at :189-191 with a rate-limit config and NO fence preHandler.
 => slot undefined -> :645-656 returns {path:'checked'} -> dispatchCheckedAppend (:377)
    -> append_turn_atomic_v3 when rpcMode!=='off' (:382-383), else v2.
CONCLUSION SURVIVES, re-proved on the right function + a control the lane did not run:
 - deployed v3 lines 83-86: UPDATE scenarios SET graph=p_graph, graph_identity_hash=p_incoming_graph_identity_hash
 - deployed v2: graph_identity_hash occurrences = 0 (cannot stamp)
 - DISCRIMINATOR (live 2026-09-21T23:04:17Z): scenarios whose ONLY turns are registrations = 168,
   hash_stamped TRUE for 168/168. CONTROL: scenarios with a graph and NO turns at all = 17,
   hash_stamped FALSE for 17/17. => the registration write itself stamps, via v3.

### R2 REFUTED — "SQL re-decides 'initial' at c8:623-626".
c8:623-626 is comment prose about v4's CAS guards. The re-decision is c8:826  WHEN NOT v_has_versions THEN 'initial'.
(c8:590-591 carrier hard-refusal IS correct as cited.)

### R3 INCOMPLETE CONTROL — "the pointer is only ever moved on the v5 version branch".
Lane tested v4(0) and v5(2) only. Completed contrast set, deployed defs, this run:
  v2 cmvid=0 | v3 cmvid=0 | v4 cmvid=0 | v5 cmvid=2. Conclusion survives; the control as run
  omitted both RPCs this route actually uses.

### R4 IMPRECISE — contract says "MV409 = unclaimable turn row".
MV409 is raised at six sites in c8 (357,366,741,752,760,802) for five distinct conditions.
:802 alone is "unclaimable turn row". An integrator told this will mis-classify a replay conflict.

### CONFIRMED independently (re-derived, not accepted)
 - HEAD 40 chars, matches.
 - register file: rg -a modelVersion -> exit 1, ZERO. Control commit.ts -> 8 (:358,982,1516,1544,1548,1629,1632,1853).
   appendCheckedGraphWrite at :455, write object :478-:496. persist-graph-write.ts injects no modelVersion (exit 1).
 - supabase-store.ts:355 `if (write.modelVersion !== undefined)`; fall-through :364-368.
 - turn_id minted assist.v1.scenario-graph-register.ts:176-178; prefix 'graph_registration:' minted in
   EXACTLY ONE non-test place (control: 'direct_answer' in 37 non-test files) => 442 count is identity-bound.
 - Deployed v4/v5 fetched by me are BYTE-IDENTICAL to the lane's saved copies.
 - ORDERING, own strip+slice: c8 OLGC1@2064 < v_turn_preexisting:=@2590 (CAS_FIRST);
   control migration 20260920210000 inverts to 1812 < 2577 (REPLAY_FIRST). Deployed == c8.
 - 20260920210000 NOT in supabase_migrations; newest applied 20260918014756.
 - c8:615-616 v_should_create; deployed v5 def lines 66-67 identical. c8:808 returns receipt NULL.
 - commit.ts:1849 `const graphPersisted = writesGraph;`; :1160 graphWasProvided(metadata.graph);
   receipt try :1542 / catch :1557 / close :1576.
 - mutation-receipt.ts:115-136 .strict() schema (version_id :120); wire key :173.
 - graph-hash.ts HASH_HEX_LENGTH=16 :24, :115 short, :119 slice, :129 sha256.
   graph-identity.ts:384 computeGraphIdentityHash; :425 computeVersionAnalysisAffectingHashRecord
   DELEGATES to computeAnalysisAffectingGraphHashSha256 => the truncation rule holds in code.
   commit.ts:1144 hashes projectedGraphForStore (:1138) => "over the PERSISTED bytes" is correct.
 - run-analysis.ts:937 compute / :2145 stamp; compose.ts:1350 computed_against_hash.
 - apply-operations.ts:302 currentModelRevision, :444 createApplyOperations, :152 idempotencyKey,
   :590 commitDirectAnswer, :595 turn_id = idempotencyKey.
 - ABSENCE createApplyOperations: 1 file total (its own definition), 0 non-test importers.
 - ABSENCE model_version_id 0/0/0 in run-analysis / freshness / scenario-graph-analysis-read;
   control graph_hash_at_run 6/25/1. run_id: 1 file, a test; control 2581 .ts files, scenario_id in 769.
 - LIVE re-run 2026-09-21T23:01:51Z: reg 442 / 331 scenarios / all mvc NULL / latest 2026-09-21T20:43:17Z;
   mvc true 3354, false 8379 (lane 3353/8374 at 22:50 — consistent drift); owned+graph+noversion 89
   = 72 reg-touched+stamped + 17 neither; owned+graph+version 3470, 16 reg-touched;
   suppressed 8379/8379 guest, created 3354/3354 owned.

### CORRECTIONS the lane should carry
 - The 72 are a CLOSED HISTORICAL COHORT: created 2026-08-25T20:59Z .. 2026-08-30T13:22Z. Not growing.
 - The 72 carry 208 turns, model_version_created NULL on ALL of them => no v5 append ever ran there.
   They were NOT stranded by hash-equality suppression; the versioned path never ran at all.
 - "all 442 NULL" is weakly discriminating alone: NULL is 26,344 of ~38,061 turns (69%).
 - "100% of 331 stamped" was CONFOUNDED by later turns; see the R1 discriminator for the clean form.
 - commitDirectAnswer control "10 non-test importers" is probe-dependent; plain rg -a -l gives 33.
 - persisted-graph-projection ":38-40" are the IMPORTS, not the calls.
 - expectedGraphIdentityHash appears 5x in the register file (also :99, prose), not 4.

### UNSUPPORTED / UNVERIFIED
 - The suppression chain also needs v3's stamped hash to EQUAL v5's carrier hash for identical bytes.
   v3 stamps computeExpectedGraphCasHashes -> hashesForRawGraph (graph-cas-conflict.ts:179-186) which
   GraphStateIngressSchema.safeParse's first; v5's carrier is computeGraphIdentityHash(asGraphStateIngress(graph))
   with NO parse (commit.ts:1034-1035). Both end in computeGraphIdentityHash but over differently
   preprocessed objects. NOT shown equal in this run.
 - Nothing PROVEN-BY-TEST. node_modules still absent (test -d -> NO). The guard test source DOES assert the
   exact two-caller set and carries its own discrimination control, but an unrun test is not a result.
 - Render 886/421 target counts accepted from the lane's file, not re-derived by me.
 - Lane A's RED/GREEN is HEARSAY inside lane C's report ("appears to"). I inspected the artefacts —
   container probe RED 2059<2417 / GREEN 1639<2572 / MUTANT flips replay OK->OLGC1 and C2 MV422->OLGC1,
   with identity-bound controls (receipt_deep_equal_to_T1, turn_row_id_equal_to_T1) — but I did NOT re-run it.
 - Whether /graph/register is on the OpenAI workstream's path at all is unshown. VERDICT A is advice about
   a route nobody has demonstrated they intend to use.
