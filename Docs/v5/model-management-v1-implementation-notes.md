# Model Management v1 — implementation notes (Layer 2, DARK)

> **CORRECTION (2026-07-08, CEE hygiene batch FIX 2):** the "migration
> AUTHORED, NOT EXECUTED" status below described this lane's state as of
> the original 2026-07-05 authoring date only. Paul's mandated execution
> approval has since landed and the migration **has been executed on
> staging** (2026-07-08, build e122f16) — live `model_versions` rows exist.
> See `acceptance-evidence/gm-mm/03-mm-owned-scenario-proof.md` +
> `Docs/lanes/LANE-MM-P1-COMPLETION-2026-07-09.md` for current status; the
> rest of this document is left as the historical design record and is NOT
> updated claim-by-claim beyond this note and the two execution-status
> lines below.

**Status:** draft / do-not-merge lane · everything dark · migration AUTHORED, **NOT EXECUTED** *(as of 2026-07-05 — see correction above: executed 2026-07-08)*
**Date:** 2026-07-05
**Branch:** `claude/layer2-model-management-v1` (base: staging `93d39f1bf`)
**Decisions carried (both signed 2026-07-05):**
- **D1** — substrate is a new `model_versions` table + `scenarios.current_model_version_id`
  pointer; `scenario_snapshots` is NOT extended (substrate brief Option B).
- **D3 — Branch A (login first)** — `owner_user_id NOT NULL`; authenticated-owned durable
  versions only; guest scenarios get a typed, recoverable "version history requires
  sign-in" refusal (lightest safe interim posture). No guest sentinel, no nullable owner,
  no unowned service-role rows.

Design inputs: `model-management-substrate-decision-brief-v0.md` (§3 schema, §4
ownership/RLS checklist) and `layer-1-architecture-decisions-memo-v0.md` (v0.4) on the
layer-1 docs lane.

---

## 1. What is built

### 1.1 Migration — `supabase/migrations/20260705120000_v5_model_versions.sql`

**⚠ As of 2026-07-05 this was authored as code only and never executed — that
approval step has since happened: EXECUTED on staging 2026-07-08 (build
e122f16), see `acceptance-evidence/gm-mm/03-mm-owned-scenario-proof.md`.**
The service module below still only ever returns typed store errors while
the flag is off (staging opt-in only, prod locked false) — execution alone
does not change the flag posture.

Contents (all additive):

- **`model_versions` table** — append-only, CEE-owned, service-role-written. Row identity
  = surrogate uuid; ordering identity = per-scenario `version_number`
  (`UNIQUE (scenario_id, version_number)`, RPC-assigned under the scenarios row lock);
  content identity = the Group A `graphIdentityHash` **envelope stored verbatim**
  (`graph_identity_hash`, `hash_algorithm`, `identity_projection_version`,
  `identity_normaliser_version`, `graph_schema_version`) — hashes only compare within
  matching projection/normaliser versions; deliberately not unique (restores repeat
  hashes). Full-JSONB `graph` snapshots (no deltas at this scale). `owner_user_id uuid
  NOT NULL`, denormalised from `scenarios.user_id` at write time; **no FK to
  `auth.users`** (the brief's §3 sketch carries none — `scenarios.user_id` itself lost
  that FK in the guest relaxation, so the denormalisation source cannot guarantee it).
  Nullable `label` / `provenance`; nullable self-FK `restored_from_version_id` for restore
  lineage; no `updated_at` (immutable rows).
- **`scenarios.current_model_version_id`** — nullable uuid pointer, FK
  `model_versions(id) ON DELETE SET NULL`. The only touch on an existing table. Moved
  exclusively inside the RPCs.
- **`create_model_version(...)`** — one transaction: `FOR UPDATE` lock on the scenarios
  row → guest refusal (`user_id IS NULL` → SQLSTATE **MV001**) → optional CAS
  (`p_expected_graph_identity_hash` vs the current head's stored hash → mismatch =
  SQLSTATE **MV409**) → no-op dedupe (identical identity envelope at head → return head,
  no new row/pointer/event; also makes post-commit retries idempotent) → `version_number
  = max+1` → INSERT → pointer move → journey event.
- **`restore_model_version(...)`** — same discipline; target must belong to the scenario
  (else SQLSTATE **MV404**); **restore = INSERT a NEW version** copying the target's graph
  + identity envelope byte-for-byte with `restored_from_version_id` lineage and
  `provenance = 'restore'` — history is never rewritten; pointer move; journey event.
- **Journey events** — `model_version_created` / `model_version_restored` appended into
  the existing `scenarios.events` + `event_seq` substrate with the exact
  `append_scenario_event` shape (`event_id/event_type/seq/timestamp/details/hashes`), so
  the DGAI Journey tab renders them with zero UI change. Appended **inline** in the RPC
  (the existing `append_scenario_event` RPC checks `user_id = auth.uid()`, which is NULL
  for the service role), idempotent by `event_id`, inside the same transaction as the
  version insert.
- **A4 checklist applied:** ENABLE + FORCE RLS; owner-only SELECT policy for
  `authenticated` (`auth.uid() = owner_user_id`); NO INSERT/UPDATE/DELETE policies for JWT
  roles; table `REVOKE ALL FROM PUBLIC, anon, authenticated` + SELECT-only re-grant to
  `authenticated`; every function `SECURITY DEFINER` + pinned `search_path` + **explicit
  `REVOKE ... FROM PUBLIC, anon, authenticated`** (Supabase default privileges auto-grant
  — the revokes are load-bearing) + `GRANT ... TO service_role` only; distinct function
  names, never overloads (PostgREST ambiguity class). Live `pg_proc`/`proacl` grant
  verification remains a post-execution step.

### 1.2 CEE service module — `src/orchestrator-v5/model-management/` (isolated, dark)

Mirrors Track 3's isolation discipline: **zero production call sites** — nothing in
routes, `turn-executor.ts`, or any live path imports this module. Wiring is a later,
separately-reviewed slice.

- `types.ts` — typed vocabulary: `ModelVersionSummary/Record`, `VersionWriteOutcome`,
  `ModelManagementResult` (`ok | disabled | conflict | error`), error codes
  (`sign_in_required` — recoverable, exact copy `"Version history requires sign-in."` —
  `version_not_found`, `empty_graph`, `store_error`), CAS conflict kind
  `analysis_affecting_conflict` (**local string literal** for A3 vocabulary consistency —
  #346 has not landed on staging; import the type when it does), and the
  **`VersionEventSink`** seam (contract §7.3 shape: at-least-once, idempotent-by-key,
  never fails the user-facing result).
- `service.ts` — `ModelManagementService`: every entry point (`saveVersion`,
  `restoreVersion`, `listVersions`, `getVersion`, `compareVersions`) checks
  `CEE_MODEL_VERSIONS_ENABLED` first and fail-closed no-ops to `{status:'disabled'}`.
  Computes the identity envelope CEE-side via the **reused** Group A
  `computeGraphIdentityHash` (never re-implemented); identity-empty graphs are refused
  (`empty_graph`) before any store call. Never throws — all failures map to typed results.
- `store-adapter.ts` — `SupabaseModelVersionStore` (constructor-injected service-role
  client, session-store idiom): writes via the two RPCs, reads via SELECT
  (`listVersions` ordered by `version_number DESC`, graph column excluded from list
  reads; `getVersion` filters by scenario_id AND id; `getCurrentVersionId` reads the
  pointer). Maps MV001/MV404/MV409 to typed errors.
- `compare.ts` — pure CEE-side compare: identity-hash **short-circuit** (equal hash under
  equal envelope versions ⇒ `identical`); otherwise analysis-affecting equivalence via
  the sanctioned `computeAnalysisAffectingHashRecord` plus a compact structural diff
  summary (counts of added/removed/changed nodes/edges — no prose). Total: malformed
  persisted payloads degrade (`analysis_equivalent: null`), never throw.
- `version-event-sink.ts` — the v1 sink is the RPC journey event (persisted
  **in-transaction**, strictly atomic — stronger than the seam's at-least-once minimum);
  the TS-side sink is the additional-consumer seam, dispatched post-commit with failures
  logged and never propagated.
- `index.ts` — `getModelManagementService()` factory (call-time env read, mirrors
  `session/index.ts`), the single seam the future wiring slice consumes.

### 1.3 Feature flag

`CEE_MODEL_VERSIONS_ENABLED` (`config.cee.modelVersionsEnabled`), **default OFF**, via
`createEnvEnforcedBoolean`: locked `false` in prod; staging `true` requires explicit
opt-in and is audit-logged; local/test may enable. Registered in `Docs/FEATURE_FLAGS.md`.

### 1.4 Tests (74, all green; no DB execution anywhere)

| File | Pins |
|---|---|
| `__tests__/migration-static-guards.test.ts` | SQL-text guardrails: executed-on-staging header (corrected 2026-07-08 — was authored-not-executed); `owner_user_id NOT NULL` + no `auth.users` FK; ENABLE+FORCE RLS; exactly one (SELECT-only) policy; REVOKE (PUBLIC+anon+authenticated) present per function; GRANT EXECUTE to service_role only, never authenticated/anon; unique (scenario_id, version_number); pointer ON DELETE SET NULL; MV001×2 / MV409×2 / MV404×1; FOR UPDATE ×2; append-only (no UPDATE/DELETE of version rows); restore-inserts-new-row; journey-event shape keys |
| `__tests__/service-flag-gate.test.ts` | flag OFF ⇒ all 5 entry points return typed `disabled` with zero store/sink calls; config default is OFF; flag read at call time |
| `__tests__/store-adapter.test.ts` | RPC arg shapes (all named args, explicit nulls); MV001/MV404/MV409/other error mapping; dedupe outcome passthrough; list ordering by version_number (graph excluded); getVersion scenario+id filter; pointer read semantics |
| `__tests__/service.test.ts` | CEE-side envelope computation matches Group A module exactly; empty-graph refusal; guest-refusal copy verbatim; CAS conflict kind `analysis_affecting_conflict`; restore-creates-new-version; event-sink emission (once per durable write, keyed by RPC event id; none on dedupe; sink failure never fails the result); compare wiring + not-found |
| `__tests__/compare.test.ts` | short-circuit incl. envelope-regime guard; label-only edit ⇒ analysis-equivalent; structural edit ⇒ not; malformed payload degrades to null; diff counts exact |
| `__tests__/version-event-sink.test.ts` | at-least-once + idempotent-by-key semantics; sync/async sink failures contained |

## 2. What is deliberately NOT built (dark boundaries)

- **No wiring**: no route, no turn-executor path, no handler, no chip/prose surface. The
  module is dead code by design until the separately-reviewed wiring slice.
- **No SQL executed** *(stale as of 2026-07-08 — see the correction note at the top of this document: the migration has since been executed on staging under Paul-gated approval)*.
- **No schemas-package changes**: the identity envelope stays CEE-local per D2 (promote
  nothing this layer); the hash is opaque on any future wire surface.
- **No guest version history** (D3 Branch A): guests keep today's behaviour — single live
  graph, no history; surfaced (when wired) only as the typed sign-in-required error. The
  §4 claim/expiry/promotion guest model remains a pre-designed later decision.
- **Untouched:** `scenario_snapshots`, `stable-stringify.ts`, `graph-management/`
  (Track 3), the pending-gate/analysis hashes, routes, UI.
- **No retention/GC, no deltas, no branching lineages** (explicit v1 non-goals per the
  brief).

## 3. Sequencing to go live (each step separately gated)

1. Paul approves + executes `20260705120000_v5_model_versions.sql` against staging;
   verify grants live via `pg_proc`/`proacl` (the Group A method).
2. Wiring slice (separate review): route/handler surface consuming
   `getModelManagementService()`, plus copy surfaces for `sign_in_required` /
   conflict results.
3. `CEE_MODEL_VERSIONS_ENABLED=true` on staging (explicit opt-in; audit-logged).
4. Prod remains locked OFF by the env-enforced flag until a deliberate config change.
