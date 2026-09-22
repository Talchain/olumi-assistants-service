# INDEPENDENT ADVERSARIAL VERIFICATION — lane A (replay-precedes-CAS)
Verifier run started 2026-09-21T23:42Z. All live reads under `set transaction read only`.

## CONFIRMED (re-derived independently)
- HEAD assertions: cee clone = e717e19d05542a80254ea056aa95a59c2cde4053; lane-a = a626f87bc1196577d6563e7c922c9705ec1b2636, tree CLEAN, 1 commit on top of base, 3 files / +644 lines.
- Live `append_turn_atomic_v5` NOW: md5 7b78d8e12550628570e15b2b739c2d4d, prosrc 17372, pronargs 30, prosecdef true, proacl {postgres=X/postgres,service_role=X/postgres}. (my read 2026-09-21T23:42:27Z)
- Live PRE-change body md5 829c3deb90594099397d64d747f4854e / 16299 chars — corroborated by TWO OTHER LANES' captures (laneC 22:47:39Z, VFY-B 23:13:12Z), not lane A's.
- SOURCE<->DEPLOYED IDENTITY, container-free: the append_turn_atomic_v5 body inside
  supabase/migrations/20260920210000_*.sql md5s to 7b78d8e1... (== live now); the body inside
  20260824200000_*.sql md5s to 829c3deb... (== live before). Fixture fidelity UPHELD.
- Rollback file body md5 = 829c3deb... exactly. "THE ROLLBACK IS EXACT" UPHELD.
  (The .sql file does NOT delete the ledger row, but the lane's script does, at line ~165.)
- Ledger row 20260920210000 present: name v5_append_v5_replay_precedes_cas, created_by NULL,
  statements[1] is CHARACTER-IDENTICAL to the repo file (both md5 70f44ab16d6ab3c624a441bfaaccbdde,
  23270 codepoints / 23384 bytes). Not merely the same length — the same bytes.
- Live ordering re-derived with -- stripped and body sliced at \nBEGIN:
  OLD  cas 1743 < olgc1 2059 < lookup 2417, guard ABSENT(-1); controls MV422 3505, v4( 2660.
  NEW  lookup 1639 < guard 1862 < cas 2242 < olgc1 2572; controls MV422 3754, v4( 2909.
  Lane A's six numbers reproduce EXACTLY.
- p_cas_enforce: rpcMode === 'enforce' at src/orchestrator-v5/session/supabase-store.ts:1318 — line CONFIRMED.
  "rejected a stale graph write" for v5 is at :1355 — CONFIRMED.
- 20260920220000 not needed for the turn path: create_model_version / restore_model_version BOTH
  absent (-1) from the comment-stripped installed v5 body, contrast controls
  'INSERT INTO public.model_versions' present (6828 old / 7077 new) and 'append_turn_atomic_v4(' present. UPHELD.

## REFUTED
1. "NOT APPLIED BY THIS LANE ... WHO applied it is UNVERIFIED ... the only remaining question."
   The applier is NAMED in the same evidence directory lane A wrote to:
   scratchpad/lane-d/scripts/witness/apply-migration.mjs (byte-identical copy at
   scratchpad/witness-auth/apply-migration.mjs) produced scratchpad/evidence/migration-apply.log —
   mode "apply", result "COMMITTED", stamps 2026-09-21T23:13:31.791Z / 23:13:34.429Z, orderingBefore
   1743/2059/2417 guard null, orderingAfter 2242/2572/1639 guard 1862. Lane D's own note
   evidence/MIGRATION-APPLIED-AND-RETESTED.md (mtime 23:15:38Z) opens "Applied on Paul's explicit
   instruction". Lane A's dry run at 23:20:07Z is 7 minutes AFTER that note existed.
2. created_by = NULL as a suspicion signal. Selective window. Same ledger: 20260824200000,
   20260802120000, 20260731130000, 20260731120000 ALL carry created_by NULL. No discrimination.
3. "post-hoc validation of live production behaviour". EXECUTED refutation of reachability:
   live v5_claim_turn_fence = INSERT ... ON CONFLICT (scenario_id, turn_id) DO UPDATE ... RETURNING
   generation, over UNIQUE INDEX v5_turn_fence_scenario_turn_key. A replay with the SAME turn_id gets
   back its ORIGINAL generation; v5_evaluate_turn_fence compares mine.generation to MAX(generation);
   /orchestrate/v2/turn is mounted `{ preHandler: turnFencePreHandler }` (route-v2.ts:2902) and
   turn-fence.ts:493 returns verdict 'superseded' (OLTF2). So the replay is refused BEFORE the RPC.
   Lane A's fixture hands the RPC the ORIGINAL fenceGeneration g1 by hand — no HTTP request can.
   Lane D's post-apply wire witness measured the same 409 GRAPH_DIVERGED / turn_fence_superseded
   before AND after, receipt absent in both. Zero user-visible change demonstrated.

## UNSUPPORTED (not refuted, not evidenced)
- base test:required run at e717e19d: base-control-wt is no longer a git worktree (node_modules +
  .DS_Store only; `git worktree list` from cee and lane-a shows neither). The log records the PATH,
  never a SHA.
- The container RED/GREEN/MUTANT runs are not reproducible here: no postgres:15.19 container exists
  (`docker ps -a` = langfuse only) and no one-command rebuild was left.
- "all 14 head-failing files PASS in isolation" — not re-run by me.
- "no connection opened" on the skip path — asserted, not instrumented.
- "CI gate steps 1-12 all exit 0" — the unit-tests job has 16 NAMED steps; step 16
  "Check for quarantined tests" was neither run nor mentioned.
- "26 applied / 3 failed / 2 skipped" — only the 31 top-level .sql count is re-derivable.

## CORRECTED
- schema_migrations.statements is text[], not text. The available stronger fact: statements[1] is
  BYTE-IDENTICAL to the repo file (both md5 70f44ab16d6ab3c624a441bfaaccbdde, 23270 cp / 23384 B).
- Live ordering offsets reproduce EXACTLY only when the slice INCLUDES the leading "\nBEGIN";
  slicing after it gives 1737/2053/2411. State the convention.
- The ledger-row DELETE on rollback is in the SCRIPT (~line 165), not in the rollback .sql (0 DELETEs).
- Live ledger total is 138 rows.
- v5_turn_fence also carries UNIQUE (scenario_id, turn_id) — a second cause of the fixture collision
  the lane attributed to the global BIGSERIAL alone.
