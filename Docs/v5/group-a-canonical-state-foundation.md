# Group A — Safety and Canonical State Foundation

**Status:** implemented (A0/A1/A2/A6) + A4 DONE-live (see UPDATE below; was approval-gated plan at doc date) + A3 still approval-gated plan · **Date:** 2026-07-04
**Branch:** `claude/group-a-canonical-state-foundation` · **Base:** `origin/staging` @ `d60bffb32`
**Source of truth:** `Olumi_Cross_Workstream_Graph_Data_Contract_v0.2` + `Olumi_Group_A_..._Brief_v0.1`
**Constraints honoured:** no push · no merge · no deploy · no migration · no RPC change · no schema-package change · no UI/PLoT change · no #341 change · no Track 4 / versioning / restore / compare / timeline / M2-ledger work.

---

> ## ⚠ UPDATE (2026-07-08, ROADMAP 1.40, Lane A — orchestrator-verified, doc reconciliation hygiene item)
>
> **The §0 security finding below is SUPERSEDED — the live cross-tenant hole it describes is CLOSED, not open.** A later live-DB introspection (`pg_proc`/`proacl`, same read-only method as §0, re-run 2026-07-08) found:
>
> ```
> store_draft_graph(uuid, jsonb)  ACL: {postgres=X, service_role=X}   -- NOT authenticated
> ```
>
> `authenticated` EXECUTE is **no longer present** on the live grant — the `REVOKE EXECUTE ... FROM authenticated` this doc recommends in §0/§7 (or an equivalent) was **applied out-of-band** sometime between 2026-07-04 and 2026-07-08, outside this repo's migration history. **There is no live cross-tenant hole today.** A4 (§7) is DONE at the live-DB level, not merely "approval-gated plan."
>
> **One residual, tracked separately, NOT closed by this note:** the repo's own migration file (`20260422120000_*`) still contains the original `GRANT EXECUTE ... TO authenticated`, so a **fresh DB build or prod promotion from this repo's migrations would RE-ARM the hole** — repo state and live state have drifted apart. Fix = author a `REVOKE` migration so repo matches live (a DB-security-class change, Paul-gated separately from this doc edit; see the `claude-cee/store-draft-graph-revoke` PR in the same hygiene batch that produced this note).
>
> Every "queued / not applied / open" statement about the §0 finding below (§0, §7, §10, §12) describes the **2026-07-04 point-in-time state** and is being left as the historical record of that investigation — treat this UPDATE block, not those inline statements, as the current truth. `Docs/v5/V5_CURRENT_STATE.md` and `Docs/FEATURE_FLAGS.md` are reconciled to match (FEATURE_FLAGS.md already had this right).

## 0. ⚠ SECURITY FINDING (standalone — separate from Group A and from the A4 plan) — 2026-07-04 point-in-time record, see UPDATE above for current status

**`store_draft_graph` is an authenticated-reachable, ownership-blind durable graph writer.** Confirmed against the **live** staging database (read-only `pg_proc` introspection via the pooler, 2026-07-04), not migration filenames:

```
store_draft_graph(uuid, jsonb)  ACL: {postgres=X, authenticated=X, service_role=X}
  SECURITY DEFINER, search_path pg_catalog+public,
  body: UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id;  -- no ownership predicate
```

- **`authenticated` EXECUTE is applied live**, the function is `SECURITY DEFINER`, in the `public` schema → it is **reachable via the Supabase PostgREST RPC endpoint** (`POST /rest/v1/rpc/store_draft_graph`) by any holder of an `authenticated` JWT. Because it is `SECURITY DEFINER` it **runs as owner and bypasses the RLS policies** on `scenarios` (RLS is enabled, `relrowsecurity = t`). There is no `user_id = auth.uid()` check, so an authenticated user can overwrite **any** scenario's `graph` by id.
- I did **not** invoke the mutating RPC (it performs an UPDATE); reachability is asserted from the live grant + `SECURITY DEFINER` + `public`-schema exposure, which is definitionally how Supabase exposes RPCs.
- **TS surface:** `SupabaseSessionStore.storeDraftGraph` still has **zero production call sites** (guarded by a new static test). The hole is the **DB grant**, not CEE code.

**Fastest safe fail-closed fix (do NOT apply without approval):**

```sql
REVOKE EXECUTE ON FUNCTION store_draft_graph(uuid, jsonb) FROM authenticated;
-- keep service_role (and postgres) only; matches append_turn_atomic_v2's posture
```

**Related secondary finding (same class):** the **legacy** `append_turn_atomic` (live **13-arg** form incl. `p_coaching_state`; the migration-file trace under-counted it as 12-arg) **also carries `authenticated=X`** and is `SECURITY DEFINER` with an ownership-blind `UPDATE scenarios SET graph`. It has **no TS callers** (the v2 path is what CEE calls). `append_turn_atomic_v2` (15-arg) is correctly **service_role-only**. The same `REVOKE authenticated` fix applies to the legacy `append_turn_atomic`. Both are queued in the A4 plan; neither is applied here.

This finding is surfaced at the top per the Group A execution instruction; it is **not** part of the A1/A2 code delivered and **not** the A4 CAS-routing design.

---

## 1. Executive verdict

**Completed with caveats.** A0 (baseline + live DB verification), A1 (normalisation), A2 (`graphIdentityHash` + dark CAS evaluator) and A6 (fixtures/tests) are implemented, additive-only, and green. A3 (live-writer CAS) and A4 (`store_draft_graph` resolution) are **plans only**, below, awaiting explicit approval. The one caveat is the standalone security finding in §0.

## 2. A0 — baseline & live verification

- Worktree re-pointed: `git checkout -B claude/group-a-canonical-state-foundation origin/staging`. Recorded SHA **`d60bffb32`** (Track 2 #340). Tree clean; `pnpm install` (CI=1) repaired the partially-tracked `node_modules`; tracked state restored before edits.
- SHA had **not** moved from the exploration baseline → code map re-verification not required.
- **Live RPC definitions** captured read-only from the staging pooler (`pg_get_functiondef` + `proacl`): `append_turn_atomic` (13-arg), `append_turn_atomic_v2` (15-arg), `store_draft_graph` (2-arg). Verbatim defs saved to the session evidence pack. Key correction vs migration filenames: the **live** `append_turn_atomic` includes `p_coaching_state` (13 args, not 12).
- `scenarios` columns confirmed live: `graph jsonb`, `updated_at timestamptz` (trigger fires on brief writes, **not** graph writes), **no version column** → no optimistic-concurrency primitive today. RLS enabled.
- Lane: single Canonical State worktree, no third lane. `src/orchestrator-v5/graph-management/` (#341) absent from staging tip; new files are path-disjoint from all active worktrees.

## 3. Contract outcomes

| Concern | Outcome |
|---|---|
| **CEE-local normalisation** | New `normaliseGraphForIdentity` — full-fidelity, exclusion-based (`TRANSIENT_UI_KEYS`), deterministic ordering, versioned envelope. Single serialisation authority reused (`stableStringify`). The analysis projection is **not** reimplemented. |
| **`analysisAffectingHash`** | Preserved **byte-identical**. `computeAnalysisAffectingGraphHash` untouched; all call sites untouched. Golden pin `e48d776aa7552f74` locks it against drift. A §9.1 typed envelope (`computeAnalysisAffectingHashRecord`) merely **delegates** to it. |
| **`graphIdentityHash`** | New `computeGraphIdentityHash` — full 64-hex SHA-256 over the identity normalisation; §9.2 envelope with projection/normaliser/schema versions. Distinct from the topology hash (proven). Null on absent/empty graph. |
| **Pending-action stale-gate** | **Unchanged.** Still owned by `analysisAffectingHash` in `computeSurvivingPriorPendingsDetailed`. No code touched; a new cross-cutting test proves a cosmetic edit leaves the pending live while a value edit drops it. `graphIdentityHash` is **not** used for proposal/pending staleness. |
| **Live-writer CAS** | Plan only (§6). Dark/observe evaluator (`evaluateGraphIdentityCas`) shipped but **unwired** (zero prod call sites). |
| **`store_draft_graph`** | Classified (§0, §7) + plan only (§7). Not modified. |
| **Package alignment** | Findings + bridge plan (§8). `graphIdentityHash` stays CEE-local; promotion deferred. No aliases introduced. |
| **Envelope/provenance (A5)** | Not touched — `graph-management/` (#341) is not in this lane. Honestly skipped; handoff in §9. |

## 4. Files changed (all additive)

**Slice A1/A2 (code):**
- `src/orchestrator-v5/context/graph-identity.ts` — new. Normalisation, `graphIdentityHash`, `AnalysisAffectingHash`/`GraphIdentityHash` envelopes, `TRANSIENT_UI_KEYS`, dark CAS evaluator. Delegates analysis hashing to `graph-hash.ts`.
- `src/orchestrator/context/stable-stringify.ts` — **modified** (security hardening from the 2nd review): `sortKeysDeep` accumulator switched to `Object.create(null)` so an own `__proto__` key (which `JSON.parse` of wire JSON can produce, and `.passthrough()` does not strip) round-trips as a real own property instead of vanishing through the prototype setter. Byte-identical output for every payload without an own `__proto__` key — proven by the full 18k gate staying green. This also hardens the existing `analysisAffectingHash` and context hash against the same latent collision (they share this serialiser).

**Slice A6 (tests):**
- `src/orchestrator-v5/context/__tests__/graph-identity.test.ts` — new (31 tests): determinism, order-invariance, identity-vs-analysis split, layout=display-identity, transient-UI exclusion, identity≠topology, golden byte-parity pins, §9.1 envelope (incl. version metadata), CAS evaluator outcomes, plus adversarial-review regression pins (Unicode-collation order-invariance; `active` is a persisted field, not stripped; `__proto__` is identity-bearing, not dropped).
- `src/orchestrator-v5/__tests__/cosmetic-edit-pending-gate.test.ts` — new (3 tests): the hard acceptance criterion — label-only edit moves `graphIdentityHash`, not `analysisAffectingHash`, and the pending proposal survives; value-edit control drops it.
- `src/orchestrator-v5/context/__tests__/graph-identity-guards.test.ts` — new (3 tests): `store_draft_graph` zero prod call sites; identity module imports no V4 patch lineage; identity module imports no `graph-management/`.

**Slice A5 (docs):**
- `Docs/v5/group-a-canonical-state-foundation.md` — this file.
- `Docs/v5/V5_CURRENT_STATE.md` — one-line pointer.

**Not touched:** `graph-hash.ts` (analysis hash — byte-identical), `freshness.ts`, `commit.ts`, `pending-action.ts`, `supabase-store.ts`, any migration, any RPC, `package.json`, #341 files, UI/PLoT. (`stable-stringify.ts` was hardened — see §4 code list; behaviour byte-identical for all existing inputs.)

## 5. Tests run

- New suites: **37 tests, all pass** (31 + 3 + 3).
- **Adversarial review — round 1 (2 fixes):** (1) the identity-sort tiebreak used `localeCompare`, which returns 0 for distinct Unicode-canonically-equivalent strings → stable-sort would leak insertion order into the hash (an order-invariance defect for a CAS hash). Replaced with a codepoint total-order comparator; golden identity pin unchanged. (2) `TRANSIENT_UI_KEYS` narrowed to drop bare domain-ambiguous words (`active`/`focused`/`highlighted`/`zoom`/`scroll`/bare `panel`) — over-excluding a real persisted field would collapse distinct graphs to one identity hash (a false CAS `match` → silent overwrite); the list now keeps only unambiguous UI scaffolding, erring toward inclusion (fail-safe). Both pinned by regression tests.
- **Adversarial review — round 2 (xhigh /code-review, 3 finder angles + verify + sweep):** confirmed fix — `__proto__` collision (wire-reachable via `JSON.parse` → `.passthrough()`): a plain-object accumulator routed an own `__proto__` key through the prototype setter and dropped it, collapsing two different graphs to one identity hash. Fixed with `Object.create(null)` accumulators in `stripTransientDeep` **and** the shared `stableStringify` (both hops rebuild objects); pinned by a `__proto__` regression test. Cleanup applied: sort comparators now decorate-sort-undecorate (serialise each key once, O(n) not O(n·log n)); documented the JSON-safe-values assumption (`undefined`/`NaN` collapse is wire-unreachable and shared with the sanctioned analysis hash); strengthened the length-trivial `identity ≠ topology` assertion; added §9.1 envelope-version pins. Full 18k gate stayed green, proving the shared-serialiser change is byte-safe.
- Targeted baseline (unchanged): `graph-hash` / `freshness` / `commit-carry-forward` / pending-action liveness — **126 pass**.
- Full required gate `pnpm test:required`: **18,098 pass / 0 fail** (8 skipped files, 94 skipped tests) — my 37 included; run again after the round-2 `stable-stringify.ts` hardening, confirming byte-safety.
- `pnpm typecheck:src` (the src gate): **clean**. Full `pnpm typecheck`: **136 error-files, identical to the pre-edit baseline** (all pre-existing test-only); **zero** in the new files.
- `eslint` on the four new files: **clean**.
- Not run: full `pnpm typecheck` was run (above); no E2E/integration suites needed (module unwired). Prepush hook not invoked (no commit/push in this slice); equivalent tsc+vitest+eslint run directly.

---

## 6. A3 — Live-writer CAS plan (APPROVAL-GATED; not implemented)

Prepares strict server-side CAS on the durable writer, **dark/observe first**. Do not implement without explicit approval.

**Live RPC verified (read-only):** `append_turn_atomic_v2(p_scenario_id, …, p_graph jsonb DEFAULT NULL, …, p_user_message, p_assistant_message)` — 15-arg, `SECURITY DEFINER`, service_role-only, atomic turn-insert + `UPDATE scenarios SET graph = p_graph` gated on the `ON CONFLICT … FOUND` idempotency guard. Legacy `append_turn_atomic` (13-arg) is the non-CAS'd sibling with no TS callers. **CAS targets `append_turn_atomic_v2` only.**

**Files/functions that would change (all additive):**
- `src/orchestrator-v5/session/store.ts` / `supabase-store.ts` — add optional `expected_graph_identity_hash` to `SessionTurnWrite`; thread it into the `.rpc()` call.
- `src/orchestrator-v5/commit.ts` (`commitDirectAnswer`) — compute `computeGraphIdentityHash(graphForStore)` for the resulting hash; read the expected hash from the request/pending precondition; **all 20 `commitTurn` sites regression-covered**.
- `src/config/index.ts` — new enum flag `CEE_GRAPH_IDENTITY_CAS_MODE` (`off` | `observe` | `enforce`, default `off`), following the `features` / `booleanString` pattern (enum, not boolean).
- **D1 only (later):** one migration adds `scenarios.graph_identity_hash` (nullable) + two `DEFAULT NULL` params to `append_turn_atomic_v2` (`p_expected_graph_identity_hash`, `p_resulting_graph_identity_hash`).

**Dark/observe mechanics (D0, no migration):**
1. CEE computes `graphIdentityHash` server-side in the write path (CEE is the **sole** hash authority — SQL never computes it).
2. When the caller supplies an expected hash, `evaluateGraphIdentityCas(expected, currentPersistedGraph)` compares against the **persisted-first** graph (per the Track 2 seam doc's hashing rule), not the request graph.
3. In `observe`, a mismatch is logged/telemetered (`graph_identity_cas.mismatch`) and the write **proceeds** — existing callers that send no hash get `no_expected` and are never rejected.
4. `enforce` (later, flag-gated) turns a mismatch into a typed `stale_write` rejection **before** the UPDATE. User-facing copy must be non-technical and actionable ("This model changed since you started — reload to see the latest"), never a raw code.

**Safety properties:**
- Existing callers unaffected: new params default null; `no_expected` never rejects; flag default `off`.
- Guest null-owner rows: unaffected — CAS keys on `scenario_id` through the service-role path; ownership is out of scope (Group A.2).
- Idempotent replay: CAS must sit **outside** the `ON CONFLICT … DO NOTHING/FOUND` guard so a deduplicated retry is neither re-hashed nor rejected.
- Rollback: set mode `off` (code-free env change); D1 column/params are additive and reversible.
- **Tests required before enforce:** match / mismatch / legacy-caller (no expected hash) / idempotent-replay interplay with the turn-id conflict guard / all 20 `commitTurn` sites.

**Do not weaken the long-term strict CAS contract** — `graphIdentityHash`, no silent overwrite, no auto-merge, no client-only CAS.

**Deferred to Group A.2:** multi-tenant ownership on the CAS path; version writes; M2 artefact stale interplay.

## 7. A4 — `store_draft_graph` plan (2026-07-04: APPROVAL-GATED, not implemented — SEE UPDATE AT TOP: live-DB, this is now DONE; only the repo-migration re-arm risk remains, tracked as a separate Paul-gated REVOKE migration)

**Classification: dormant-but-reachable, with a live cross-tenant bypass** (evidence §0). Not dead: the DB grant is live and PostgREST-reachable. TS-side it is test-only (zero prod call sites, pinned by test).

**Recommended fix (fail-closed, minimal):**
1. **SQL (approval-gated migration):** `REVOKE EXECUTE ON FUNCTION store_draft_graph(uuid, jsonb) FROM authenticated;` — leaves service_role/postgres only. Same `REVOKE` for the legacy `append_turn_atomic` 13-arg overload (secondary finding §0).
2. **TS (later, low-risk):** retire `SupabaseSessionStore.storeDraftGraph` + its interface method once the revoke lands; until then the zero-call-site guard test holds the line.
3. Do **not** route it through a CAS path — it is not on any live product flow; the correct end-state is fail-closed then retire, not adopt.

**Why not now:** the brief gates all RPC/migration changes behind explicit approval. Revoke is a one-line, reversible grant change; recommended as the immediate fast-follow.

## 8. Package alignment — findings & bridge plan

| Repo | `@talchain/schemas` pin | Source |
|---|---|---|
| CEE (this repo) | `0.13.0` (vendored tgz) | `package.json` |
| UI (DecisionGuideAI) | `0.8.1` (vendored tgz) | `package.json` |
| PLoT (plot-lite-service) | `0.2.1` (registry) | `package.json` |
| olumi-schemas (source) | `0.13.1` | `package.json` |

- `@olumi/contracts` **absent everywhere** (confirmed) — not current package truth.
- `@talchain/schemas` exports **no** hash/normalisation functions today.
- **Bridge plan:** `graphIdentityHash` stays **CEE-local** this slice (contract §6.4/§6.5). Promotion to `@talchain/schemas` is gated on: shape ratified → consumer skew resolved (UI 0.8.1 / PLoT 0.2.1 re-vendored) → fixtures prove parity → owning lane authorised. Re-vendor is a **precondition for Track 4 / live cross-repo apply**, not a Group A blocker. The exported `GraphIdentityHash` type is designed for lift-and-shift (self-contained, no CEE-only imports). **No aliases introduced** — no hidden version skew.

## 9. A5 handoff (envelope/provenance — not touched)

`graph-management/` (#341, `CandidateMutationEnvelopeV1`) is not in this worktree. When merge-order resolves, #341 should:
- add optional `base_graph_identity_hash` consuming Group A's exported `GraphIdentityHash` type (keep `base_analysis_affecting_hash` for referee/stale gating);
- keep provenance `ui_safe: false` by default; never treat raw model rationale as UI-safe;
- not mint a third envelope shape; not wire live UI Apply/Reject.

No faking here — the seam is documented, not stubbed.

## 10. Blockers (classified)

- **Blocks #341:** none from Group A. #341 gains an optional identity-hash field to adopt (additive). Merge-order coordination only.
- **Blocks Track 4 UI actions:** package re-vendor (UI 0.8.1 / PLoT 0.2.1 → ratified version). UI↔CEE hash parity is an **expected documented blocker** — UI has no hasher and is on an old schema; not silently assumed.
- **Blocks live apply / CAS / versioning:** A3 approval + D1 migration; the `scenarios.graph_identity_hash` column and `append_turn_atomic_v2` params do not exist yet.
- **Non-blocking queued remediation (2026-07-04 status; SEE UPDATE AT TOP — the live REVOKE has since happened out-of-band):** A4 `REVOKE authenticated` on `store_draft_graph` **and** legacy `append_turn_atomic` (elevated by §0 — recommend fast-follow); later TS retirement of `storeDraftGraph`. Residual as of 2026-07-08: the repo migration still `GRANT`s — a separate Paul-gated REVOKE-migration PR closes that.
- **Dead / no action:** phantom writers `apply_patch_and_log` / `store_analysis_and_log` / `calculate_canvas_diff` / `restore_canvas_blocks` — confirmed non-existent in live DB + code.

## 11. Rollback notes

- All delivered work is additive and unwired: deleting the three new test files + `graph-identity.ts` + this doc + the one-line tracker edit fully reverts, with no behaviour change (nothing imports the module).
- No env flag was added or flipped (the `CEE_GRAPH_IDENTITY_CAS_MODE` flag is A3-plan only).
- No migration/RPC/grant was changed; the live DB is untouched (read-only introspection only).

## 12. Security / performance notes

- **Security:** §0 finding surfaced; fix is REVOKE-only, reversible. 2026-07-04 status was "not applied" — SEE UPDATE AT TOP: live-DB introspection on 2026-07-08 found the REVOKE (or equivalent) already applied out-of-band; no live hole remains, only the repo-migration re-arm risk (separately Paul-gated). No RLS/ownership/service-role change made by this doc. No sensitive provenance reaches any UI surface (identity hash is opaque, structured; not prose).
- **Performance:** `graphIdentityHash` is O(n) in graph size with one `stableStringify` + one SHA-256; it is **not** on any hot path (unwired). The dark CAS evaluator is pure and only runs where a future write path calls it. No unbounded hashing introduced.
- **No out-of-scope work:** no versioning/restore/compare/timeline/M2-ledger/Track 4 wiring; no UI hasher; `computeAnalysisAffectingGraphHash` values and the pending-gate behaviour are unchanged (golden + cross-cutting tests prove it).
