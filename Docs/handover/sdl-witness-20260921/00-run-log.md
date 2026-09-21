# Lane C run log
HEAD asserted e717e19d05542a80254ea056aa95a59c2cde4053 (40 chars) at 2026-09-21T22:45:31Z

## PROVEN-IN-CODE so far
- appendCheckedGraphWrite defined src/orchestrator-v5/persist-graph-write.ts:336; body = assertNoIntroducedGraphViolations then `store.append(write)` (:356).
- commit.ts:1490 calls it; write object conditionally spreads `modelVersion: atomicVersionPlan.write` at commit.ts:1514-1516.
- register route src/routes/assist.v1.scenario-graph-register.ts:455 calls it; write object ends at :495 with NO modelVersion key.
  ABSENCE: `rg -a -n "modelVersion" src/routes/assist.v1.scenario-graph-register.ts` -> exit 1, ZERO matches.
  CONTRAST A: same regex on commit.ts -> 8 matches (non-zero).
  CONTRAST B: same-family key `expectedGraphIdentityHash` IS present in register route at :405,:418,:430,:494 (probe sees that file).
- supabase-store.ts:355 `if (write.modelVersion !== undefined) return await this.appendAtomicVersioned(...)` -> v5 RPC. Absent carrier falls through to appendAtomicFenced (v4) / dispatchCheckedAppend (v3 or v2) at :364-368.

## Lane C — completed 2026-09-21T23:59Z
Files: OPENAI-SEAM-CONTRACT.md (136 lines), laneC-db-counts.txt, laneC-render-logs.txt.
Scratchpad artefacts: laneC-deployed-append_turn_atomic_v4.sql / _v5.sql (live pg_get_functiondef),
laneC-v5-body-stripped.sql, laneC-db{,2,3,4,5}.cjs, laneC-logs3.py, laneC-fndef.cjs.

### Decisive measurements (all timestamped in laneC-db-counts.txt)
1. /graph/register IS LIVE AND HEAVILY USED: 442 durable writes (turn_id LIKE 'graph_registration:%'),
   139 in 7d, latest 2026-09-21T20:43:17Z, 331 scenarios. Render 7d: 886 lines "graph/register".
2. ZERO of the 442 created a version (model_version_created all NULL). Control: 3,353 true / 8,374 false.
3. 100% of the 331 register-touched scenarios have graph_identity_hash STAMPED. Deployed v4 line 108-111
   does the stamping. Deployed v4 has 0 occurrences of current_model_version_id (v5 has 2; v4 has 4x 'scenarios').
4. Owned + graph + no version = 89 -> 72 register-touched & hash-stamped, 17 neither. Control: 3,469 have one.
5. Suppression conjunct: ALL 8,374 suppressed appends are GUEST scenarios. ZERO owned ever suppressed.
   => the hash-equality suppression is PROVEN-IN-CODE and in the deployed fn, NOT OBSERVED in production.
6. Deployed append_turn_atomic_v5 = c8 (CAS before replay). Body offsets OLGC1@2064 / v_turn_preexisting@2590,
   byte-identical to repo c8; fix migration inverts to 1812/2577. supabase_migrations lacks 20260920210000;
   newest applied is 20260918014756.

### Discipline notes
- HEAD asserted twice: e717e19d05542a80254ea056aa95a59c2cde4053, 40 chars, working tree clean (0 dirty).
- No DDL, no writes, no auth.users touched, no push, no PR. `set transaction read only` on every live connection.
- No test suite executed (clone has no node_modules) -> nothing labelled PROVEN-BY-TEST.
- The evidence/ directory is SHARED with lanes A and B; lane C files are namespaced laneC-* plus the
  assigned OPENAI-SEAM-CONTRACT.md.
