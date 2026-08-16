# Canonical committed-graph receipt — component handoff

Status: **review-ready local freeze; not pushed, merged, deployed or enabled**.
The CEE branch is based exactly on serving staging
`424f912912ec8e56edca9091ed39e966be9a6f5f` (tree
`de7ae6f5818a730c4a0931e7aece380a13291483`), which contains the independently
accepted Readiness #983 authority. The pre-repair rollback pin is
`acaf2d4952c1e58017a0d3ff003371b012a6ac17`; the original foundation remains
preserved at `62899d5cbbd4dab629cba0ae9cd0170c0d44ff0e`.

## Boundary and completion state

This component makes a successful transactional response describe the exact
analysis-affecting graph bytes accepted by the atomic append. It does not add
model repair, science, Context/Memory, product-experience work, or a second
readiness authority.

The five canonical hash carriers are:

- `nodes`
- `edges`
- `options`
- own `goal_node_id` (`string` or explicit `null`)
- `goal_constraints` (including explicit `[]`)

`node_count` and `edge_count` are derived receipt metadata. They must equal the
lengths of the exact carried arrays; they are not copied from the stored object
and are not hash inputs.

Legacy `draft_graph` reads remain additive-compatible: legacy responses may
omit the newer carriers. Canonical transactional producers are a stricter
barrier. Before append, `projectGraphForPersistence` authors explicit carrier
absence and refuses to guess between multiple goal nodes. After commit,
`buildCanonicalCommittedGraphReceipt` requires every own key and validates the
exact `CommitResult.persistedGraph`; it never falls back to an applied,
requested, parsed, or pre-projection graph. A missing or invalid persisted graph
therefore produces no success receipt.

Explicit `goal_node_id: null` is valid only when the graph has no goal node.
When one or more goal nodes exist, a canonical receipt must carry an explicit id
that resolves to one of them. This prevents a receipt from attesting ambiguous
or internally contradictory goal authority.

## Shared contract authority

CEE is pinned locally to the live schemas 0.43.0 contract built from:

- schemas base/tag v0.42.0:
  `bbfb7eb1e3f450598ff061a8651ce8c7e053468d`
- guarded main/tag `v0.43.0`:
  `fdc30a4d74d3b3cf52c5674fcd4a7805cb8e6807`
- original isolated correction head (same exact tree):
  `3c3dc78cb08eb63135da7c2a90a9d4609ce28267`
- corrected schemas tree:
  `fc96888fc41cf537ed83f041bab159447e23bc2d`
- vendored sha256:
  `9865bfc0891cfed383ae7a0741b324087ba33db03479f97295174f031dc8ea5e`

Schemas 0.43 provides two deliberately different reader/producer shapes:

- additive legacy `DraftGraphBlockSchema`, for compatibility;
- strict `CanonicalCommittedGraphReceiptSchema` and producer block, including
  count refinements and explicit goal absence.

It also exports the versioned nested projection vocabulary. CEE remains the
only hash projector/digest implementation and imports that vocabulary directly;
there is no second keep-list or shared competing digest. A manifest-derived
mutation suite proves every declared nested field moves the hash, including the
conditional treatment of `raw_interventions`.

## Migrated writers

The singular post-commit builder is wired into:

- initial `draft_graph`;
- `edit_graph`;
- edge-strength set and `confirm_current`;
- factor-value set;
- graph-management held apply (single and all);
- routed D1 application.

Adoption/no-write responses remain receipt-free. `confirm_current` remains a
provenance-only operation: canonicalising omitted explicit empty/null carriers
is admitted only when the raw-before and projected-before analysis hashes are
equal. A legacy graph with one goal but no `goal_node_id` is refused because
deriving that id moves the hash; confirmation cannot silently migrate it.

## Atomic append acknowledgement

The receipt can be authoritative only when this write attempt itself was
accepted. Graph-bearing appends therefore use one additive, graph-only
`append_turn_atomic_v5` RPC with a strict JSONB acknowledgement. The store maps
its three raw outcomes to:

- `accepted_insert` — the only successful graph commit and receipt authority;
- `byte_identical_replay` — typed failure, no receipt and no post-insert hooks;
- `divergent_replay` — typed failure, no receipt and no post-insert hooks.

The migration adds nullable, immutable `v5_conversation_turns.accepted_graph`
as the exact JSONB accepted with the turn. Replay classification uses JSONB
`IS NOT DISTINCT FROM`, not another hash. A legacy row with a null witness is
therefore divergent/unverifiable for a non-null graph. Replays return before
fence/CAS mutation, graph update, facts and brief writes; CAS refusal rolls the
new turn witness back in the same transaction.

`SupabaseSessionStore` strictly parses `{id, disposition}`. Missing v5,
malformed acknowledgement, unknown disposition and both replay outcomes fail
closed with no fallback or post-read recovery. `commitDirectAnswer` separately
requires `accepted_insert` before pending-created telemetry, Model Versions,
Decision Records or rolling-summary hooks. The direct scenario graph
registration route has the same independent guard and cannot return
`registered:true` for a non-insert result. Graph-free turns alone retain v2.

## Readiness convergence

Do not derive readiness in the receipt builder and do not add
`canonical_graph_hash_analysis_state` or any other attestation sidecar. #983's
`buildCanonicalAnalysisReadyFromGraph` is the required sole whole-status
authority.

#983 is now integrated and serving at the exact base named above. Transactional
draft, edit, edge, factor, readiness-repair and routed-D1 receipt paths derive
whole-status readiness once from the exact `CommitResult.persistedGraph`, after
canonical receipt validation. Held-single/all additionally need readiness to
choose the durable recovery copy, chip and matching pending action. Their sole
#983 derivation therefore runs in an optional synchronous commit callback after
`projectGraphForPersistence` has produced the exact object that becomes
`CommitResult.persistedGraph`, but before assistant text, chips, pending actions
or append input are assembled. The callback result is persisted atomically and
is exposed only after the accepted append plus receipt/hash validation; an
undefined result, throw or graph mutation aborts before append. An undefined
canonical result elsewhere suppresses the mutation success receipt and fails
the turn closed; no lossy `GraphV3` gate or pre-mutation/fallback wire status can
authorise it. Pure first-touch adoption is deliberately receipt-free and still
accepts the legacy-permissive ingress graph contract: it persists and hashes the
exact projected bytes, exposes the exact-persisted canonical status only when
#983 can derive one, and otherwise clears readiness rather than inventing or
reusing a request-derived verdict.
Pipeline readiness remains a semantic detail producer for narration/bias
material only; it cannot decide returned wire status, Run chips or recovery.
Receipt-side readiness and hash-state sidecars remain forbidden.

Required completion sequence:

1. **Complete:** schemas 0.43 is reviewed, guarded-merged, tagged and published;
   CEE and UI hold the same source-pack artifact bytes.
2. **Complete:** #983 is independently accepted, integrated and serving; this
   component is rebased on its exact staging SHA and converged on its builder.
3. Deploy and prove the UI's fail-closed 0.43 canonical-receipt consumer from
   serving origin `7ad0cefcd8c386491680e9656b8720ce36df6b4e` or newer. Producer-first
   emission remains forbidden.
4. Apply `20260816120000_v5_graph_append_ack.sql` DB-first, refresh the schema
   cache, and probe inserted/identical/divergent outcomes with service-role
   credentials. Do not deploy the app first.
5. Run focused receipt/writer/readiness/ack suites, type/lint and the serialized
   broad gate; obtain a fresh independent review.
6. Only after steps 3–5, deploy the app/receipt producer and drain every old
   graph-writing worker. Missing v5 fails graph writes closed during cutover.
7. Roll back app/producer first if needed. After all new workers are drained,
   the v5 function/trigger may be revoked and dropped; retain `accepted_graph`
   unless a separately approved data-loss cleanup is intended.

## Architecture disposition

| Item | Disposition | Reason |
|---|---|---|
| `buildCanonicalCommittedGraphReceipt` | **KEEP** | Sole exact post-commit receipt validator/transporter. |
| schemas 0.43 producer receipt + nested vocabulary | **KEEP** | Shared wire contract and one field vocabulary; no duplicate digest. |
| `projectGraphForPersistence` carrier authoring | **KEEP** | Makes append bytes canonical before the irreversible commit. |
| `buildAppliedGraphWireField` / `applied-graph-emit.ts` | **REMOVE** | Lossy nodes/edges-only projection from the wrong authority. |
| manual initial-draft receipt composer | **REPLACE** | Now routed through the singular post-commit helper. |
| writer fallbacks to `appliedGraph`, request graph or `committedParse.data` | **REMOVE** | Can attest bytes that were never stored. |
| `computeStructuralReadiness` as whole-status response authority | **QUARANTINE** | Superseded by serving #983; it may not decide transactional wire status. |
| receipt-side readiness or hash-state sidecar | **REMOVE / FORBID** | Would create a parallel authority. |
| `append_turn_atomic_v5` + immutable `accepted_graph` | **KEEP** | Sole atomic proof that this attempt's graph was accepted. |
| graph-bearing v2/v3/v4 app dispatch | **REPLACE / REMOVE** | UUID-only success cannot distinguish insert from replay. |
| v2 for graph-free turns | **KEEP** | No graph authority is advertised; existing semantics remain valid. |
| database v3/v4 functions | **QUARANTINE** | Retained only as rollback-era artifacts; the app never falls back to them for a graph. |
| SELECT-only replay recovery | **REMOVE / FORBID** | Racy and cannot prove this attempt atomically changed current authority. |

The former v3/v4 graph-CAS and first-write-exemption test suites were removed
with their retired app dispatch/recovery paths. This is a deliberate
**QUARANTINE/rollback-only replacement**, not unexplained coverage loss: v5 CAS,
fence, stopped/superseded/first-write, replay and draft-loss suites now pin the
live graph path, while the checked-in legacy migrations remain available only
for app-first rollback history.

### Old-suite to live-suite disposition

| Retired test expectation | Disposition | Exact live replacement |
|---|---|---|
| v3 `off`/`shadow`/`enforce` graph routing, expected/incoming hashes and clean insert | **REPLACE** | `supabase-store-graph-cas-v5.test.ts`: “non-graph writes alone remain on v2”, “default shadow config calls v5 with enforcement off”, “off still calls v5, with null CAS inputs” |
| OLGC1 discrimination, generic error, stale second edit and self-noop | **REPLACE** | `supabase-store-graph-cas-v5.test.ts`: “maps OLGC1…”, “keeps non-OLGC1 errors generic…”, “accepts the first and atomically refuses the stale second without a turn row”, “allows a distinct-turn self-noop…” |
| v4 stopped/superseded/current generation behavior | **REPLACE** | `turn-fence-atomic-append.test.ts`: “refuses a Stop…”, “allows a superseded first graph…”, “refuses a superseded graph…”, “passes the admitted generation…” |
| graph-less first-write exemption and its no-failure-mark control | **REPLACE** | `turn-fence-atomic-append.test.ts`: “allows a superseded first graph under the same scenario lock” (also asserts no failed-write mark) plus `graph-append-v5-migration-static.test.ts` v4-safety/order guard |
| failed claim/unclaimed and absent v5 availability | **REPLACE** | `turn-fence-stop-vs-disconnect.test.ts`: “a failed ingress claim refuses before append”; `turn-fence-atomic-append.test.ts`: “missing v5 fails closed with no graph fallback” |
| stopped/superseded/unclaimed failed-write marks | **KEEP / MOVE** | the three refusal controls above assert exact `markGraphWriteFailed(scenario, turn, reason, 'draft_loss')`; `turn-fence-draft-loss-lifecycle.test.ts` pins disclosure state and content-free telemetry |
| app-side scenario read, OLTF2 recovery and Stop/rival interleaving windows | **REMOVE** | the pre-read/retry architecture no longer exists; `supabase-store-graph-ack-v5.test.ts`: “has one graph RPC and no SELECT-only replay recovery or legacy graph dispatch”, plus the SQL ordering guard |
| arrival-8 id-only replay success, with or without current graph | **REPLACE (semantic correction)** | `turn-fence-stop-vs-disconnect.test.ts`: identical and divergent same-turn replays are explicit non-authoritative failures; `commit-graph-replay-side-effect-guard.test.ts` proves no receipt or post-insert hooks |
| mark/disclose/resolve lifecycle, missing-column degradation and graph-free no-resolution | **KEEP / MOVE** | `turn-fence-draft-loss-lifecycle.test.ts`; `supabase-store-graph-ack-v5.test.ts` and commit hook guards prove only an accepted graph insert reaches loss resolution/success hooks |
| other-live-turn/self/stopped/failed/42703 continuation reads | **KEEP / MOVE** | `turn-fence-draft-loss-lifecycle.test.ts`: “continuation reads retain the live-turn contract after v5 cutover” controls |
| graph-bearing fallback to v2/v3/v4 or UUID/SELECT recovery | **REMOVE / MUTANT-PIN** | `supabase-store-graph-ack-v5.test.ts` missing/malformed/PGRST202/static guards and `graph-append-v5-migration-static.test.ts` strict acknowledgement/order guards |

The old migration SQL remains untouched for rollback archaeology; none of its
UUID-only graph-success expectations remain authoritative application behavior.

## Verification and operational properties

Decisive tests cover the five exact carriers, nested option/intervention fields,
explicit null goal identity, empty-constraint deletion, projection-mutating
append, factor/edge set and no-op/confirmation, held single/all, routed D1,
invalid/missing post-commit graphs, count mismatch, architecture drift, the
shared projection version/manifest, strict append acknowledgement parsing,
replay-with-zero-hooks, scenario-registration refusal, migration ordering,
immutable witness and service-role-only ACL.

The receipt path is linear in graph size: one schema validation, bounded numeric
validation, one canonical hash, and one receipt hash witness. It performs no
network or persistence read and does not log graph content. Typed failures carry
only a fixed code, preventing labels, values, or private scenario content from
leaking into logs. The helper does not mutate its input; carrier defaults are
authored once before append, and the persisted projection is reference-idempotent
after canonicalisation.

### Frozen verification evidence

- recovered 66-file compatibility matrix: 66/66 files, 548/548 tests;
- bounded receipt/readiness/append-ack matrix: 18/18 files, 280/280 tests;
- D1 adoption plus source guards: 2/2 files, 15/15 tests;
- full TypeScript typecheck: green, resolving `@talchain/schemas@0.43.0`;
- changed-code lint: 0 errors (one ignored-script warning only);
- full lint: 0 errors (two pre-existing unused-disable warnings only);
- single authorised full required suite: 1,728 passed and 19 skipped files;
  30,065 passed, 176 skipped and 12 todo tests; exit 0 in 221.02 seconds;
- final post-full static correction removed the residual edge/factor `GraphV3`
  post-commit scrub projection; its exact source guard plus both writer suites
  passed 3/3 files and 58/58 tests, followed by a green full typecheck and
  zero-error targeted lint;
- `git diff --check`: clean.

No Supabase migration, schema-cache refresh, service-role probe, push, PR,
merge, app deployment or receipt-producer enablement was performed. Fresh
independent review, the UI consumer barrier and the DB-first rollout order above
remain mandatory.
