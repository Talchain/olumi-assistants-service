# ADVERSARIAL VERIFICATION OF LANE P — running log
Verifier HEAD assertion: cee clone HEAD = e717e19d05542a80254ea056aa95a59c2cde4053 (40 chars), branch staging. Re-asserted.
All timestamps UTC.

## CONFIRMED
- Instrument-fault calibration reproduced EXACTLY on cee-production (2026-09-21T23:05:23Z):
  multi-word `enabled in staging environment` = 0 while the full line = 1 and `staging environment` = 1.
- Service ids: cee-production = srv-d46fp8q4d50c73b1dqqg (branch main); cee-staging = srv-d4slpaili9vc73eiq4og (branch staging). 7 services total.
- Env vars re-derived paginated 2026-09-21T23:04:27Z: cee-production 118 rows, cee-staging 121 rows (lane's numbers exact).
  cee-production: OLUMI_ENV='staging', NODE_ENV='staging', CEE_MODEL_VERSIONS_ENABLED='true', CEE_REQUIRE_USER_JWT='true', RENDER_SERVICE_NAME ABSENT. Fabricated-key control absent.
- M1 count re-derived: v5.graph_cas.rpc_conflict = 4 on cee-staging, 2026-09-14T23:05Z-2026-09-21T23:05Z. Four rows byte-match the lane's table.
- M3a: openapi.yaml has exactly 29 `^  /` path entries; controls /assist/v1/explain-diff:301 and /assist/v1/graph-readiness:994 PRESENT; `versions` token only at 5366, 5509 (both prose); zero /assist/v1/scenarios paths.

## REFUTED
- R1. "All four [CAS conflicts] on `event_kind: factor_value_edit`." FALSE.
  The v5.graph_cas.rpc_conflict payload contains NO event_kind field (emitter supabase-store.ts:1645-1658 emits scenario_id, turn_id, mode, conflict_category, expected_identity_hash, incoming_identity_hash, rpc_code only).
  event_kind lives on a DIFFERENT log line ("V5 factor_value_edit - mutation commit failed").
  The 4th conflict (2026-09-21T19:56:43.366Z, scenario 28719228) has turn_id "graph_registration:c0f45867-dc41-491c-8bc5-65ccda4cf6c5" - a graph registration, NOT a factor_value_edit, and has NO matching error line.
- R2. The lane's "supabase-store.ts:1353 is the emitter" is a PARTIAL manifest. There are THREE call sites of emitRpcCasConflict: :409 (append_turn_atomic_v3), :1199 (v4), :1353 (v5). The emitted payload carries no RPC-name field, so the emit alone cannot attribute a conflict to v5.
  Settled by the error lines: 3 of 4 say "append_turn_atomic_v5 rejected a stale graph write". The 4th has no error line -> RPC version UNDETERMINED.
- R3. The lane's M1 UNVERIFIED (4 vs 3) IS SETTLEABLE and I settled it: the missing error line is the graph_registration conflict. Not a mystery.

## CORRECTIONS
- C1. `if (receiptRaw === null) return { id: row.turn_row_id };` is supabase-store.ts:**116**, not 117.
- C2. "All six routes registered at src/server.ts:218-224" - WRONG IN KIND. server.ts:218-224 is a string array inside a MISCONFIGURATION log payload, not route registration. Same for the lane's "the route DOES exist in code (src/server.ts:222)". Real registration is via ceeScenarioVersionsRouteV1; the real route handler IS at assist.v1.scenario-versions.ts:716 (confirmed).
- C3. "STALE COMMENTS MEASURED FALSE ... both env-resolver.ts:53-54 and config/index.ts:2152 assert 'BOTH Render services set NODE_ENV=production'" - MISQUOTED. env-resolver.ts:53-54 says "Both `render.yaml` (production) and `render-staging.yaml` (staging) set NODE_ENV=production" - a claim about the FILES, and it is TRUE (render.yaml:12-13, render-staging.yaml:13-14 both set production). config/index.ts:2152 does say "BOTH Render services", so only that one is false live.
- C4. STRONGER EVIDENCE THE LANE MISSED for M3b: cee-production's boot also emits a structured event
  {"event":"cee.config.raw_io_overridden","setting_name":"CEE_MODEL_VERSIONS_ENABLED","requested_value":true,"actual_value":true,"env":"staging","reason":"staging_override_allowed"} at 2026-09-19T23:44:40.958Z, hostname srv-d46fp8q4d50c73b1dqqg-... That is machine-readable proof of actual_value=true and env=staging. M3b headline UPHELD and strengthened.
- C5. NOT REPORTED BY THE LANE, and material: cee-production ALSO sets PROMPTS_ENVIRONMENT='staging' and DD_ENV='manual-test'. The checked-in production blueprint render.yaml sets OLUMI_ENV=prod and PROMPTS_ENVIRONMENT=production. The live service contradicts its own blueprint on THREE keys, so cee-production is serving the staging prompt pointer too - a wider misconfiguration than "one flag is not locked down".

## INDEPENDENT RE-DERIVATION RESULTS (all 2026-09-21, 23:04-23:14Z)

### M1 UPHELD (count), REFUTED (characterisation)
v5.graph_cas.rpc_conflict = 4, uncapped, 1 page. Four rows saved to m1-cas-rows.json; byte-match the lane's table.
GraphStaleWriteError = 3, rows saved to m1-stale-rows.json. THE 4-vs-3 IS SETTLED:
 - 3 conflicts (39a9a9c8 / 3f14e465 / 171396f2) each have a matching level-50 line carrying
   event_kind:"factor_value_edit", target_id:fac_*, and err.message "append_turn_atomic_v5 rejected a stale graph write".
 - The 4th (28719228, 2026-09-21T19:56:43.366Z) has turn_id "graph_registration:c0f45867-dc41-491c-8bc5-65ccda4cf6c5"
   and NO error line. It is a graph registration, not a factor_value_edit, and its RPC version is UNDETERMINED.

### M2 UPHELD, with controls the lane did not run
targets all 0, uncapped, 1 page: readFactsWithTurnFor, HandlerFactSchema, session.read_degraded, read_degraded, SessionReadError, canonical_readback_failed.
contrast: v5_turn_context_facts = 4000 (CAPPED at 41 pages, so ">=4000" not a count); option_intervention_edit = 5.
negative: ZzQxFabricatedNeverLogged = 0, readFactsWithTurnForZZZ = 0.
ADDED dotted-token same-shape positive controls (the lane had none): v5.graph_cas.evaluated = 600 (capped), cee.config.raw_io_overridden = 133. So a dotted zero is a real zero.
NOTE the lane's calibration is OVERBROAD: the multi-word phrase 'prior_facts loaded' returned 4000. Some multi-word phrases work; mechanism unknown.

### M3b UPHELD and STRENGTHENED
cee-production boot 2026-09-19T23:44:40.958Z, hostname srv-d46fp8q4d50c73b1dqqg-69f9fb6d9b-7r9pz:
 {"event":"cee.config.raw_io_overridden","setting_name":"CEE_MODEL_VERSIONS_ENABLED","requested_value":true,"actual_value":true,"env":"staging","reason":"staging_override_allowed"}
Machine-readable actual_value=true. `cannot be enabled in production` = 0.

### M4 UPHELD; DB PROXY NOW DERIVED, NOT ASSERTED
Live pg_get_functiondef(append_turn_atomic_v5), 30 args, 17289 bytes, saved. Body sliced after BEGIN, -- comments stripped:
  body:37-38  v_should_create := v_user_id IS NOT NULL AND v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash;   <-- TWO conjuncts
  body:169-170 replay, v_turn_version_created = FALSE  -> RETURN ... 'model_version_receipt', NULL
  body:184-207 replay, created TRUE                    -> RETURN FULL receipt  (so replay never fakes a no_receipt)
  body:215     UPDATE ... SET model_version_created = v_should_create
  body:230-231 IF NOT v_should_create THEN RETURN ... 'model_version_receipt', NULL
=> NULL receipt <=> model_version_created = false. The DB proxy is VALID.
Chain hop the lane omitted: appendOutcome comes from appendCheckedGraphWrite (persist-graph-write.ts), whose only
return is `return await store.append(write);` (:356) - passes through unchanged, so the chain holds.
Live 2x2 at DB clock 2026-09-21T22:09:41.367Z: (false,guest)=1668 turns/1472 scen; (true,non-guest)=380/376. Other two cells EMPTY.
INNER-JOIN CONTROL the lane never ran: 2048 turns with mutation_id, 2048 joined to scenarios. Nothing dropped.
FABRICATED-COLUMN CONTROL AS THE LANE DESCRIBED IT IS IMPOSSIBLE: `... where model_version_zzz_fabricated is not null`
 -> ERROR 42703 column does not exist. It cannot "return zero rows".
PER-ROW CROSS-INSTRUMENT (stronger than the lane's scenario-level join, and it SETTLES their off-by-one):
 all 133 log events joined on (scenario_id, turn_id) -> 133/133 matched, 0 missing, 0 disagreements,
 117 no_receipt ALL guest=true, 16 committed ALL guest=false. There is NO 117-vs-116 discrepancy; theirs was a window-boundary artefact of an aggregate query.
WINDOW CAVEAT CONFIRMED with per-window contrast the lane did not run: 15 Sep 00-12Z has v5_turn_context_facts=300(capped) and version_committed=0; 18 Sep 00-06Z has 95 and 0. Not retention.
VOLATILITY: 40 min after the lane's read the log gives 125 no_receipt / 21 committed = 85.6% (not 88.0%) and the DB gives 1668/2048 = 81.4% (not 81.6%). Also 380 turns / 376 scenarios refutes "exactly one each".
