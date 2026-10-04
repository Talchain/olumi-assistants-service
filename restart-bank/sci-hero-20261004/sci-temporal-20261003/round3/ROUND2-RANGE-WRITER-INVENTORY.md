# SCI-TEMPORAL round-2 writer inventory and proposed closure

Actual inspected head: `67e4e03e5b24cc9365f131ffeff239a5fbfbc077`, clean. Review: PR2382/5974558843 at2677; DL direction #87/5974558954. The two-file67e4 correction does not close these unchanged persistence seams. No source edits in this inventory pass.

## Measured population

The existing production writer-population guard passed **13/13** at67e4. Comment-stripped census: **1,280 production TS files**, **39 turn-producer call sites in11 files**, **one store.append call**, **four checked-append calls in3 files**, **one restoreVersionAtomic call**, **zero storeDraftGraph production calls**, **13 migration files with SET graph assignments**. JSON has every caller/line and SQL filename. The scope is current source and migration text; no deployed database catalogue, SQL execution, provider/science/browser call or served journey proof.

| Producer / contract / branches | Actual persistence floor / trusted base | Approval and readback |
|---|---|---|
| Agent standalone `propose_option_interventions`, compound/starting-point levels; authorised stored `set_option_intervention` operations (`agent-capabilities.ts:4520-4574`, single port5180, compound2371) → `commitOptionLevelsInProcess` (`dispatch.ts:3244`) → native batch/transaction | `option-intervention-edit.ts:916` → `commitDirectAnswer` → `appendCheckedGraphWrite` → store.append. Native writer reads actual stored base, computes CAS and verifies exact postimage; range currently arrives in the native figure. | Existing `proposals.authorise` checks scenario, authenticated user, content/id integrity, current base/partial continuation; only its stored `execute` proposal grants an approved operation. Native batch uses exact store.loadGraph +committed turn/version readback. Ordinary direct inspector event has no likely-range payload and grants no new range consent. |
| Generic `applyOperations` port (approved structural edits, add-option/whole-map/nested/slash operations; off/shadow policy variants included) | `apply-operations.ts:665` → same commit/floor/append. Port reads stored `before`; current early presence guard wrongly refuses unchanged whole-map range. | Whole-operation approval does not approve a newly claimed range. Final range decision must use strict stored base; actual port readback/turn binding stays. Missing native batch dependency is refusal, never fallback authority. |
| `edit_graph`: LLM generic, clarification/chip retry/repair and V2/V5 edit lanes; graph-management off/shadow; unrelated edit with echo-added/changed/omitted/stale ranges; first stored-null graph | `edit-graph.ts` encoder → `edit-graph-dispatch.ts:5702`/executor/legacy route → commit/floor/append. Current3978 comparison uses context.graph echo and is not authoritative. `mergeAppliedGraphForPersistence` can carry echo nodes into stored postimage. | Request echoes, LLM operations, field stamps and range_user_stated claims grant no consent. Terminal range comparison must independently read the actual stored base (read errors refuse), not caller context/base defaults. Canonical route and existing edit receipt read stored graph. |
| All other turn producers: draft/redraft, run-time graph repair, D1 factor/cap/limit/constraint edits, option adoption/participation/status, structural add/delete/rename, link/identity/goal changes, and read-only rows that carry a graph | All39 call sites listed below converge on `commit.ts:1628` → `persist-graph-write.ts:362/376`. They can carry or change quantities/units/legacy range carriers even when they do not explicitly write a range. | No new range authority arises from these callers. Same native quantity/effective unit retains inherited valid range; changed quantity/unit clears inherited range before hashes. Canonical postcommit/readback stays in existing consumers. No-graph calls are skipped by range admission. |
| Initial/replacement/import/Agent raw graph registration; canonical, nested and slash carriers; owner-authenticated first graph/null base and replay | `assist.v1.scenario-graph-register.ts:1005` projection → same-byte preflight1101 → checked append1119 → store.append376. Trusted stored read722 supplies CAS. Current floor enforces structural invariants only. | Ownership/CAS/replay is not range consent. A new/changed range needs existing server-bound approved operations; imported/request range flags do not grant it. Strict stored read error already refuses. Actual canonical graph-read is cold reload source. Preflight must refuse before turn-fence generation and match the final append check. |
| Model-version restore, including return-leg/undo and older/legacy version carriers | `assist.v1.scenario-versions.ts:1056` server current graph read +stored target ingress parse → projection1084 → normal branch shared check1187 → atomic restore1258. **Return-leg skips that structural check** and directly reaches the same RPC; range check must cover both branches independently of structural widening. | Stored target/current/head are server reads; version selection/ownership alone does not attest dedicated range approval. Do not invent a restore exemption or infer consent from returnLeg. Refuse new/changed ranges unless existing attested approval can be bound; retaining legitimate previously approved historical range requires an explicit existing-authority decision, not a request flag. Restore RPC owns graph+undo+version+head+event and stronger CAS; keep it. Cold reload uses canonical graph-read. |
| Agent conversational claim and final answer rows (`agent-v1-turn.ts:1938/3433`) | Checked append with **writesGraph:false**, no graph write. | No range authority and no route edit needed. Preserve existing Shared Data final-answer/permission work. |
| Legacy `SupabaseSessionStore.storeDraftGraph` /store_draft_graph | Zero production callers at67e4. Method itself bypasses this floor and applies only intercept repair. Existing population guard must continue refusing any new caller. | Do not call it, activate it or claim the unused RPC is covered. SQL text is inherited, not changed by this plan. |

## Coverage and ordering

The structural floor alone does **not** currently enforce range consent; all three graph-writer classes must take the shared range obligation, including restore's return branch. Store append selects existing v2/v3/v4/v5 atomic RPCs and its own retry without changing graph bytes; the restore service uses its existing atomic RPC. No extra terminal writer is needed.

One comparison must distinguish: inherited unchanged range (retain it even when a generic replacement omits it), inherited range with changed native quantity/effective unit (clear before hashing), newly added/changed bounds/meaning/source/quote (existing approved-operation binding required), malformed/missing-point/out-of-bounds range (never persist), absent/unreadable stored base (null means first graph; read error means refuse), and no-graph/no-range turns (unchanged behavior). Reuse `buildFactorScaleMap`, `resolveRawInterventionValue`, `unitComparisonKey` and the existing `sameNativeQuantity` logic; do not create a second numerical/unit interpretation.

**Ordering constraint:** range carry/clear/sanitation happens in shared preparation before identity/analysis hashes, pending re-pins and version-plan construction. The terminal floor independently asserts the final unchanged postimage against its strict server-read base and existing approved-operation scope immediately before append/RPC. Do not repair graph bytes inside append after hashing, or rehash pending/version metadata there. Projection sanitation must retain its admitted result even when best-effort logging throws; validator exceptions must propagate/fail closed.

## Proposed exact production boundaries (not yet edited)

1. `src/orchestrator-v5/intervention-range.ts`: existing range reader/validator; one shared postimage range comparison/carry-clear assessment for nodes and mirrored options plus malformed/legacy contrasts. Reuse native quantity/unit authority; no new meaning/source literal.
2. `src/orchestrator/tools/encode-option-interventions.ts`: expose/reuse existing native quantity comparison and carry stored metadata for same-quantity whole-map replacement; no second inference rule. Existing parser/predicate remains.
3. `src/orchestrator-v5/persist-graph-write.ts`: add the terminal shared range assertion on final bytes +strict actual stored base, both append/check-only paths. Keep scope-pending sidecar/goal-scope invariants and graph/hash bytes unchanged at append.
4. `src/orchestrator-v5/commit.ts`: shared preparation before its current projection/hash/version steps; obtain authoritative server-read base with fail-closed range admission. **SharedData/B1 lease collision** around base, projection, final append and public response snapshot; coordinate first.
5. `src/routes/assist.v1.scenario-graph-register.ts`: call same preparation before its hash/version/replay/preflight; preflight and append use same prepared bytes. Preserve current scope/limit/edge facts and fence/replay rules. **Shared scope writer seam**, coordinate first.
6. `src/routes/assist.v1.scenario-versions.ts`: same preparation before hash/atomic restore, range assertion unconditionally on normal+return branches; retain existing stronger RPC/CAS and structural return-leg rule. No restored-range consent exemption.
7. `src/orchestrator-v5/persisted-graph-projection.ts`: isolate best-effort range refusal logging from validator result; validator failure propagates rather than restoring unsanitized graph. No changes to other projection passes or scope authority.
8. `src/orchestrator-v5/apply-operations.ts` and `src/orchestrator/tools/edit-graph.ts`: remove blanket range presence refusal, rely on shared final delta obligation; unchanged approved whole-map range can round-trip. Request echo is never the terminal base. Do not add a parallel generic consent predicate.
9. `src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts`: the two range-request predicates use actual range fields or range_user_stated===true, so explicit false/no fields equals omitted. Standalone and delegated starting-point controls. Bind only the already-authorised stored proposal operations when executing native single/compound range writes; preserve currentness/permissions.
10. `src/orchestrator-v5/agent-lane/approved-adoption-context.ts`: **proposed transport of the existing authorised proposal only**, in the existing server-internal execution scope. Current context covers adopted values/levels, not user-authored range approval. Any extension must be derived solely from `proposals.authorise(...).status==='execute'`, matched to exact scenario/proposal/option/factor/value/unit/range and never widen adoption stamps. No independent consent decision, wire member, header, request flag or second store. This integration boundary needs DL/PL agreement before code, because absence of a range context must refuse rather than infer approval.

No `agent-v1-turn.ts`, permission reader, Context P0, model/schema/PLoT, migration, engine/VOI or provider/browser changes proposed.

## Owner alignment before implementation

Shared file collisions: persist-graph-write.ts already owns `assertNoPendingScopeAmendment`/scope carry; commit.ts also carries SharedData/B1 public-answer/permission snapshot work; registration carries shared goal scope. DL/PL/root must identify the current writer and serial slot for these exact hunks before C edits them. Preserve existing scope and permission matrix authority. Restore historical-range attestation and the existing-authorisation execution binding above need disposition; no fabricated new approval mechanism.

Validation: focused actual-port/registration/restore/terminal-floor tests with echo added/changed/omitted/stale, stored-null/read-error, unchanged range included/omitted, native unit/quantity change, single+compound approved positive, malformed ranges/log throw, false/omitted ordinary levels, canonical cold read; existing population guard; discriminating mutants. One focused worker, current0.75 source gate/scoped lint, fresh changed-head Required/Drift and SAME reviewer after one combined push. No broad local suite/paid/science/browser. Source/mock proof is not JOURNEY.

## Every turn-producer call site at inspected head

- `src/orchestrator-v5/turn-executor.ts:1814`
- `src/orchestrator-v5/apply-operations.ts:665`
- `src/orchestrator-v5/system-events/option-intervention-edit.ts:916`
- `src/orchestrator-v5/system-events/dispatch.ts:1270`
- `src/orchestrator-v5/system-events/dispatch.ts:1549`
- `src/orchestrator-v5/system-events/dispatch.ts:1614`
- `src/orchestrator-v5/system-events/dispatch.ts:2004`
- `src/orchestrator-v5/system-events/dispatch.ts:2071`
- `src/orchestrator-v5/system-events/dispatch.ts:2404`
- `src/orchestrator-v5/system-events/dispatch.ts:2466`
- `src/orchestrator-v5/system-events/dispatch.ts:3411`
- `src/orchestrator-v5/system-events/dispatch.ts:3536`
- `src/orchestrator-v5/system-events/dispatch.ts:3760`
- `src/orchestrator-v5/system-events/dispatch.ts:3819`
- `src/orchestrator-v5/system-events/dispatch.ts:4119`
- `src/orchestrator-v5/system-events/dispatch.ts:4180`
- `src/orchestrator-v5/system-events/dispatch.ts:4487`
- `src/orchestrator-v5/system-events/dispatch.ts:4547`
- `src/orchestrator-v5/system-events/dispatch.ts:4855`
- `src/orchestrator-v5/system-events/dispatch.ts:4914`
- `src/orchestrator-v5/system-events/dispatch.ts:5258`
- `src/orchestrator-v5/system-events/olumi-option-adoption.ts:145`
- `src/orchestrator-v5/routing/persist-asked-question.ts:263`
- `src/orchestrator-v5/handlers/clarify-v2-dispatch.ts:232`
- `src/orchestrator-v5/handlers/edit-graph-dispatch.ts:5702`
- `src/orchestrator-v5/handlers/chip-click-dispatch.ts:1168`
- `src/orchestrator-v5/handlers/chip-click-dispatch.ts:2304`
- `src/orchestrator-v5/handlers/draft-graph-dispatch.ts:1113`
- `src/orchestrator/route-v2.ts:3296`
- `src/orchestrator/route-v2.ts:4106`
- `src/orchestrator/route-v2.ts:4293`
- `src/orchestrator/route-v2.ts:4360`
- `src/orchestrator/route-v2.ts:5082`
- `src/orchestrator/route-v2.ts:5869`
- `src/orchestrator/route-v2.ts:6098`
- `src/orchestrator/route-v2.ts:7051`
- `src/orchestrator/route-v2.ts:7357`
- `src/orchestrator/route-v2.ts:8011`
- `src/orchestrator/route-v2.ts:8582`

## Migration files identified by the existing writer census

- `supabase/migrations/20260422120000_v5_store_draft_graph.sql`
- `supabase/migrations/20260422200000_v5_append_turn_atomic_with_graph.sql`
- `supabase/migrations/20260422210000_v5_append_turn_atomic_graph_idempotency_fix.sql`
- `supabase/migrations/20260502120000_v5_brief_text_persistence.sql`
- `supabase/migrations/20260505120000_v5_pending_actions.sql`
- `supabase/migrations/20260602120000_v5_coaching_state_snapshot.sql`
- `supabase/migrations/20260609120000_v5_conversation_content.sql`
- `supabase/migrations/20260711000000_v5_append_turn_atomic_for_share.sql`
- `supabase/migrations/20260717120000_v5_append_turn_atomic_v3_graph_cas.sql`
- `supabase/migrations/20260731130000_v5_turn_fence_atomic_append.sql`
- `supabase/migrations/20260802120000_v5_turn_fence_atomic_append_generation_key.sql`
- `supabase/migrations/20260806120000_v5_turn_fence_first_write_exemption.sql`
- `supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql`
