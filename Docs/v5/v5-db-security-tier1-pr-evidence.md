# V5 DB Security — Tier 1 Hardening PR Evidence

**Migration:** `supabase/migrations/20260610120000_v5_db_security_tier1_hardening.sql`
**Rollback:** `supabase/migrations/rollback/20260610120000_v5_db_security_tier1_hardening_rollback.sql.do-not-apply`
**Target DB:** `etmmuzwxtcjipwphdola` (the single live DecisionGuideAI app DB; `cee-staging` writes V5 turns here — there is no separate prod CEE DB; `cee-production` is a stale Jan-2026 build with no Supabase config).
**Method:** read-only catalog verification (`has_table_privilege`, `has_function_privilege`, `pg_class`, `pg_proc`, `pg_policies`, `pg_default_acl`). No DB mutated; no conversation/user text inspected. Migration **not applied** — "after" columns are the deterministic result of the REVOKE/ENABLE-RLS statements.

## 1. Objects changed
| object | change |
|---|---|
| `v5_conversation_turns` | REVOKE TRUNCATE from anon, authenticated |
| `v5_handler_facts` | REVOKE TRUNCATE from anon, authenticated |
| `turn_observations` | REVOKE TRUNCATE from anon, authenticated |
| `cee_prompt_observations` | REVOKE TRUNCATE from anon, authenticated; **ENABLE + FORCE RLS** |
| `append_turn_atomic(13-arg legacy)` | REVOKE EXECUTE from anon, PUBLIC |
| `insert_conversation_turn` | REVOKE EXECUTE from anon, PUBLIC |
| `purge_old_observations` | REVOKE EXECUTE from anon, PUBLIC |
| `ensure_scenario_exists` | REVOKE EXECUTE from anon, PUBLIC |
| `append_turn_atomic_v2` | **untouched** (already service_role-only) |

## 2. Before/After — table privileges (`has_table_privilege`)
TRUNCATE is the only table privilege Tier 1 changes; SELECT/INSERT/UPDATE/DELETE are unchanged in Tier 1 (deferred to Tier 2). `✔`=granted, `✗`=revoked by this migration.

| table | role | SELECT | INSERT | UPDATE | DELETE | TRUNCATE before | TRUNCATE after |
|---|---|---|---|---|---|---|---|
| v5_conversation_turns | anon | ✔ | ✔ | ✔ | ✔ | ✔ | **✗ revoked** |
| v5_conversation_turns | authenticated | ✔ | ✔ | ✔ | ✔ | ✔ | **✗ revoked** |
| v5_conversation_turns | service_role | ✔ | ✔ | ✔ | ✔ | ✔ | **✔ kept** |
| v5_handler_facts | anon | ✔ | ✔ | ✔ | ✔ | ✔ | **✗ revoked** |
| v5_handler_facts | authenticated | ✔ | ✔ | ✔ | ✔ | ✔ | **✗ revoked** |
| v5_handler_facts | service_role | ✔ | ✔ | ✔ | ✔ | ✔ | **✔ kept** |
| turn_observations | anon | ✔ | ✔ | ✔ | ✔ | ✔ | **✗ revoked** |
| turn_observations | authenticated | ✔ | ✔ | ✔ | ✔ | ✔ | **✗ revoked** |
| turn_observations | service_role | ✔ | ✔ | ✔ | ✔ | ✔ | **✔ kept** |
| cee_prompt_observations | anon | ✔ | ✔ | ✔ | ✔ | ✔ | **✗ revoked** |
| cee_prompt_observations | authenticated | ✔ | ✔ | ✔ | ✔ | ✔ | **✗ revoked** |
| cee_prompt_observations | service_role | ✔ | ✔ | ✔ | ✔ | ✔ | **✔ kept** |

Note: anon/authenticated retain SELECT/INSERT/UPDATE/DELETE *grants* after Tier 1, but row access stays gated by RLS (see §3). Removing those latent grants is Tier 2.

## 3. Before/After — RLS
| table | RLS before | RLS after | policies | effect on anon/authenticated |
|---|---|---|---|---|
| v5_conversation_turns | ON (not forced) | ON (unchanged) | 1 SELECT `auth.uid()=user_id` | unchanged: anon reads 0 rows (`auth.uid()` null); authenticated own-rows only |
| v5_handler_facts | ON (not forced) | ON (unchanged) | 1 SELECT `auth.uid()=user_id` | unchanged: as above |
| turn_observations | ON (forced) | ON (unchanged) | 0 | unchanged: row DML default-denied |
| **cee_prompt_observations** | **OFF** | **ON + FORCE** | 0 | **was fully open to anon DML → now default-deny** to anon/authenticated; service_role bypasses |

## 4. Before/After — function EXECUTE (`has_function_privilege`)
| function | role | before | after |
|---|---|---|---|
| append_turn_atomic (legacy 13-arg) | anon | ✔ | **✗ revoked** |
| append_turn_atomic (legacy 13-arg) | authenticated | ✔ | ✔ kept (Tier 2) |
| append_turn_atomic (legacy 13-arg) | service_role | ✔ | **✔ kept** |
| insert_conversation_turn | anon | ✔ | **✗ revoked** |
| insert_conversation_turn | authenticated | ✔ | ✔ kept (Tier 2) |
| insert_conversation_turn | service_role | ✔ | **✔ kept** |
| purge_old_observations | anon | ✔ | **✗ revoked** |
| purge_old_observations | authenticated | ✔ | ✔ kept (Tier 2) |
| purge_old_observations | service_role | ✔ | **✔ kept** |
| ensure_scenario_exists | anon | ✔ | **✗ revoked** |
| ensure_scenario_exists | authenticated | ✔ | ✔ kept (Tier 2) |
| ensure_scenario_exists | service_role | ✔ | **✔ kept** |
| **append_turn_atomic_v2** | anon | ✗ | ✗ (untouched) |
| **append_turn_atomic_v2** | authenticated | ✗ | ✗ (untouched) |
| **append_turn_atomic_v2** | service_role | ✔ | ✔ (untouched) |

**`authenticated` preservation check (per review request).** `aclexplode` on all four functions confirms `authenticated` holds an **explicit** EXECUTE grant and **no PUBLIC EXECUTE grant exists** (`public_execute=false`, single overload each). Therefore `REVOKE EXECUTE … FROM anon, PUBLIC` removes only anon (the `PUBLIC` clause is a no-op) and does **not** strip `authenticated`. The migration nonetheless adds explicit, idempotent `GRANT EXECUTE … TO authenticated` (step 3b) to **guarantee** the Tier-1 matrix above regardless of any apply-time ACL drift.

## 5. Service-role compatibility evidence (why the CEE backend cannot break)
- **No statement names `service_role`.** Every `REVOKE` targets only `anon` (+`PUBLIC`); `service_role` keeps all grants (see §2/§4 "kept").
- **`service_role` has `BYPASSRLS`** → the new RLS on `cee_prompt_observations` does not affect it.
- **Commit path uses the service-role RPC:** live `src/orchestrator-v5/session/supabase-store.ts:136` calls `append_turn_atomic_v2` (service_role only), not the legacy RPC. The session client is built service-role: `src/orchestrator-v5/session/index.ts:48` `createClient(url, serviceRoleKey)`.
- **`cee_prompt_observations` is read/written only by the prompt store**, which also uses the service-role client and asserts the role: `src/prompts/stores/supabase.ts:156` (`createClient(url, serviceRoleKey)`), role checked at `:148`. So enabling RLS cannot break the PMS store. (Repo-wide grep found no other caller of that table or the legacy RPCs in `src/`.)

## 6. Rollback
Run `supabase/migrations/rollback/20260610120000_v5_db_security_tier1_hardening_rollback.sql.do-not-apply` (re-grants TRUNCATE + the 4 anon EXECUTEs, and `DISABLE`s RLS on `cee_prompt_observations`). Grants/RLS only — no data affected. Fully restores the pre-migration state.

## 7. Exact risk left for Tier 2 / Tier 3 (NOT closed here)
- **Tier 2 (V5, after a UI-usage check):** `authenticated` still holds EXECUTE on all 4 legacy RPCs; anon+authenticated still hold INSERT/UPDATE/DELETE *grants* on the 4 tables (RLS-gated for rows, but latent). Decision gated on confirming the DGAI UI does not call these RPCs/tables with the user JWT (CEE-side grep shows the backend does not; the UI repo is not in this tree).
- **Tier 3 (app-wide, separate lane — higher severity):** over-broad `anon`/`authenticated` grants in the `public` schema (default-privilege exposure) and a set of sensitive `SECURITY DEFINER` functions. Details are kept private; **private remediation required** — tracked separately (see issue #254). NOT in this PR.
