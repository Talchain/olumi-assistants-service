# Model Management — Substrate Decision Brief v0

**Status:** DOC-ONLY · evidence-cited · no repo file modified, no SQL executed, no branch touched
**Date:** 2026-07-05
**Decision owner:** Paul
**Question:** which substrate carries versioned snapshots of a user's decision graph (current-version pointer, history, compare, restore, Journey/timeline events) —
(A) extend `scenario_snapshots` · (B) new `model_versions` table · (C) hybrid — plus the ownership/protection model (Decision 3 feed).

**Recommendation up front: Option B — a new, CEE-owned, service-role-written `model_versions` table with an explicit ownership model. Details and the smallest viable sketch in §3; ownership/protection in §4; one-page decision input in §5.**

---

## 1. Current substrate facts (as found, read-only)

Both repos migrate the **same staging Supabase database** (CEE migration headers: "Target: Staging Supabase", e.g. `supabase/migrations/20260417160000_v5_session_store.sql`; DGAI headers identical, e.g. `20260226000000_scenario_schema_v2.sql`). The two tables of interest are split across repos:

### 1.1 `scenarios` — the mutable working state (DGAI-owned migration, CEE-relaxed)

Defined in `/Users/paulslee/Documents/GitHub/DecisionGuideAI/supabase/migrations/20260226000000_scenario_schema_v2.sql` (lines 8–43):

- Columns: `id uuid PK`, `user_id uuid` (originally `NOT NULL REFERENCES auth.users(id)`), `title`, `stage`, **`graph JSONB`** (the single live graph — no history), `framing`, `analysis*` columns, **`events JSONB DEFAULT '[]'` + `event_seq INTEGER`** (embedded journey event log, lines 22–23), `brief`, timestamps. Later additive columns: `latest_analysis_summary` (DGAI `20260309000002`), `brief_text`, `pending_actions`, `coaching_state` (CEE `20260502120000`, `20260505120000`, `20260602120000`).
- RLS: enabled; four owner-only policies `auth.uid() = user_id` for SELECT/INSERT/UPDATE/DELETE (lines 32–43; made idempotent by CEE `20260226010000_scenario_schema_v2_0_1_hardening.sql`).
- **No version column, no optimistic-concurrency primitive** — confirmed live by Group A A0 (`Docs/v5/group-a-canonical-state-foundation.md` §2 on branch `origin/claude/group-a-canonical-state-foundation`): "`scenarios` columns confirmed live: `graph jsonb` … **no version column** → no optimistic-concurrency primitive today."
- **Guest relaxation** (CEE `supabase/migrations/20260422000000_v5_guest_mode_nullable_user_id.sql`): FK to `auth.users` **dropped**, `user_id` **nullable**. Guest rows are `user_id IS NULL`. `ensure_scenario_exists(p_scenario_id, p_user_id DEFAULT NULL)` is `SECURITY DEFINER`, **GRANT service_role only** (end of file). `v5_conversation_turns.user_id` / `v5_handler_facts.user_id` relaxed to match.
- **Journey/timeline substrate today:** `append_scenario_event` RPC (scenario_schema_v2 lines 84–146) appends `{event_id, event_type, seq, timestamp, details, turn_id?, hashes?}` into `scenarios.events` with idempotency + ownership check (`user_id = auth.uid()`), granted to `authenticated` only (lines 451–475). The DGAI Journey tab (`/Users/paulslee/Documents/GitHub/DecisionGuideAI/src/canvas/journey/` — `JourneyTabBody.tsx`, `renderTimeline.ts`, `types.ts`) renders `TimelineEntry` rows derived from these `ScenarioEvent`s. Event types already include `analysis_run`, `stage_changed`, `brief_generated`.

### 1.2 `scenario_snapshots` — the existing snapshot table (DGAI-owned, "BIL Phase 1")

Defined in `/Users/paulslee/Documents/GitHub/DecisionGuideAI/supabase/migrations/20260309000000_scenario_snapshots.sql`:

- Schema (lines 12–25): `id uuid PK`, `scenario_id uuid NOT NULL REFERENCES scenarios ON DELETE CASCADE`, **`user_id uuid NOT NULL REFERENCES auth.users(id)`**, `graph jsonb NOT NULL`, `analysis jsonb`, `brief_text`, `brief_hash`, `seed bigint`, `quality_mode`, **`graph_hash text`** (un-versioned, UI-computed), `created_at`. **No `updated_at` — "immutable by design".**
- RLS (lines 27–35): `ENABLE` + **`FORCE`**; `select_own_snapshots` / `insert_own_snapshots` for `authenticated`, both `auth.uid() = user_id`. **No UPDATE/DELETE policies** (immutability by policy absence). `REVOKE ALL … FROM anon` (line 42).
- Index (lines 38–39): `(scenario_id, created_at DESC)` — ordering is **by timestamp only**; no version number.
- Write path: `create_snapshot(...)` RPC, `SECURITY DEFINER` **with an explicit ownership predicate** (`scenarios.user_id = auth.uid()`, lines 68–72), `REVOKE … FROM PUBLIC; GRANT EXECUTE … TO authenticated` (lines 84–85). This is the *correct* grant pattern (contrast §1.4).

**Who writes it:** the DGAI browser client (user JWT), best-effort fire-and-forget — `createSnapshot()` in `/Users/paulslee/Documents/GitHub/DecisionGuideAI/src/services/threadService.ts:96–131`, called **once per analysis run** from `useConversation.ts:2069–2091` ("One snapshot per analysis run… async fire-and-forget… acceptable best-effort"). `conversation_turns.snapshot_id` / `analysis_snapshot_id` link turns to the snapshot (`useThreadPersistence.ts:196, 237–238`; table in DGAI `20260309000001_conversation_turns.sql`).

**Who reads it: nobody.** Grep of DGAI `src/` (excluding node_modules) for `.from('scenario_snapshots')` and any select path: **0 read sites**; the only references are the write RPC and migration-contract tests (`src/canvas/analysis/__tests__/persistenceContract.spec.ts`). Claim type: no code loads rows from this table in DGAI `src/`; CEE current worktree `src/` + `tools/`: 0 references at all. It is a **write-only audit artifact** today.

**Guests never write it:** in guest/PoC mode the DGAI Supabase client is **aliased to a stub** (`/Users/paulslee/Documents/GitHub/DecisionGuideAI/src/lib/supabase.ts:9–17`, `VITE_AUTH_MODE === 'guest'` → "mock" binding), and even against the real client `create_snapshot` raises `forbidden` when `auth.uid()` is null. The table structurally **cannot hold guest rows** (`user_id NOT NULL` + FK `auth.users`).

### 1.3 Who writes the graph today

- **Live path:** CEE, **service-role** (`src/orchestrator-v5/session/index.ts:48,74` — client built from `SUPABASE_SERVICE_ROLE_KEY`), via `append_turn_atomic_v2` (15-arg), which does `UPDATE scenarios SET graph = p_graph` inside the turn transaction (CEE `20260609120000_v5_conversation_content.sql:189–190`); grants: `REVOKE PUBLIC/anon/authenticated`, `GRANT service_role` only (lines 244–248).
- **Dormant:** `SupabaseSessionStore.storeDraftGraph` (`src/orchestrator-v5/session/supabase-store.ts:358–368`) → `store_draft_graph` RPC — **zero production call sites** (pinned by guard test on the Group A branch).
- DGAI also writes graph via `apply_patch_and_log` (ownership-checked, authenticated) — scenario_schema_v2 lines 149–182.

### 1.4 The A4 precedent — the warning this brief must not repeat

CEE `supabase/migrations/20260422120000_v5_store_draft_graph.sql` created `store_draft_graph(uuid, jsonb)` as `SECURITY DEFINER` with **no ownership predicate** ("UPDATE scenarios SET graph … WHERE id = p_scenario_id") and **granted EXECUTE to `authenticated`** (last lines of file). Group A's live introspection (`Docs/v5/group-a-canonical-state-foundation.md` §0, branch `origin/claude/group-a-canonical-state-foundation` @ `b9d168e2`) confirmed: PostgREST-reachable by any `authenticated` JWT, `SECURITY DEFINER` bypasses `scenarios` RLS → **any authenticated user could overwrite any scenario's graph by id**. The same class of hole existed on the legacy 13-arg `append_turn_atomic`. The fail-closed fix — `REVOKE EXECUTE … FROM authenticated` on both, leaving service_role/postgres only — has been **applied live to staging** (grant-layer verified; operational note, no repo migration file records it yet).

**Lesson, stated once:** a service-role-written table is *safe only as a whole system* — the moment any `SECURITY DEFINER` helper around it is granted to `authenticated` without an `auth.uid()` predicate, RLS is bypassed and tenant safety is gone. A second, subtler trap is recorded in CEE `20260609120000` lines 235–243: **Supabase default privileges auto-GRANT EXECUTE to `anon` and `authenticated` on every new public function**, so `REVOKE FROM PUBLIC` alone is insufficient — every new RPC needs explicit `REVOKE … FROM anon, authenticated`.

### 1.5 `graphIdentityHash` — the candidate version identity (Group A, unmerged)

`src/orchestrator-v5/context/graph-identity.ts` on `origin/claude/group-a-canonical-state-foundation` (@ `b9d168e2`, draft PR #343, review-only):

- `computeGraphIdentityHash(graph)` → **64-hex SHA-256** over a versioned, full-fidelity identity projection: transient-UI-stripped (conservative EXCLUDE list; layout kept as display identity), deterministically ordered (nodes by id, edges by (from,to), codepoint total order, serialised tiebreaks), `__proto__`-safe (null-prototype accumulators), via the single shared `stableStringify`.
- The value ships inside a **typed envelope**: `{kind:'graph_identity_hash', value, algorithm:'sha256', projection_version:'identity.v1', graph_schema_version:'graph_v3', normaliser_version:'1'}` — hashes are only comparable **within the same projection/normaliser versions**; persistence must store the version fields alongside the value.
- Returns `null` for absent/identity-empty graphs. Deliberately distinct from `analysisAffectingHash` (whitelist projection; freshness/staleness) and from the topology-only telemetry hash — contract §2.2 forbids conflating them. `scenario_snapshots.graph_hash` (UI-computed `generateGraphHash(nodes, edges)`) is a **third, un-versioned hash** and must not be treated as compatible.
- `evaluateGraphIdentityCas(expected, currentGraph)` → pure CAS evaluator (`match | mismatch | no_expected | unavailable`), **zero live call sites** — the ready-made seam for restore/pointer-move safety.
- **Dependency reality:** CEE-local, not in `@talchain/schemas`, not merged to staging. Layer-2 Model Management therefore depends on merging Group A (or cherry-picking the module). Cross-repo consumers (UI) must treat the hash as **opaque**; compare/no-op detection is computed CEE-side, never UI-side (schema-version-skew hazard).

---

## 2. Options compared

Legend: ✓ good fit · △ workable with effort · ✗ structural misfit.

| Dimension | **A — extend `scenario_snapshots`** | **B — new `model_versions`** | **C — hybrid (B rows reference A payloads)** |
|---|---|---|---|
| **Version identity** | △ has `graph_hash`, but un-versioned UI hash; retrofitting the identity envelope means two hash regimes in one table | ✓ surrogate `id` + per-scenario `version_number` + `graph_identity_hash` **envelope columns** from day one | △ identity on B rows, payload identity on A rows — two ids per version |
| **Snapshot representation** | ✓ full `graph jsonb` already | ✓ full `graph jsonb` (see size note below) | ✗ payload FK into a table whose rows are written fire-and-forget by a different actor with different lifetime |
| **Current-version pointer** | ✗ none; would need `scenarios.current_snapshot_id` pointing at a table where most rows are *not* versions | ✓ `scenarios.current_model_version_id` (or head flag in-table); every referenced row *is* a version | △ pointer at B, payload at A — pointer integrity spans two tables |
| **History / ordering** | ✗ `created_at DESC` only; no monotonic number; existing analysis-run rows pollute the sequence ("version 3" is ambiguous) | ✓ `UNIQUE (scenario_id, version_number)`, monotonic, gap-free by RPC | △ ordering on B, but history queries join A |
| **Compare** | △ possible, but comparing "versions" requires filtering out non-version rows via a discriminator | ✓ two rows, hash short-circuit (equal `graph_identity_hash` under equal projection/normaliser versions ⇒ identical), else CEE-side diff of stored JSONB | △ same as B plus a join |
| **Restore semantics** | ✗ table is immutable-by-absence-of-policy, good — but restore-as-new-row mixes user-intent versions into an audit stream | ✓ restore = **INSERT new version** with `restored_from_version_id` provenance; history never rewritten; pointer moves under CAS | △ restore creates rows in both tables |
| **Journey/timeline events** | △ snapshot rows are not journey events; still need `append_scenario_event` | ✓ RPC appends `model_version_created` / `model_version_restored` events (with version id + hash in `hashes`) to the **existing** `scenarios.events` timeline the Journey tab already renders | △ same as B |
| **Guest / null-owner** | ✗ **structurally impossible**: `user_id uuid NOT NULL REFERENCES auth.users(id)`; relaxing it re-runs the guest-relaxation surgery of `20260422000000` on a DGAI-owned table | ✓ ownership designed explicitly (§4): owner nullable **only if** guest support is deliberately chosen, with claim/expiry/promotion | ✗ inherits A's NOT NULL on the payload half |
| **Service-role-written rows** | ✗ `insert_own_snapshots` + `create_snapshot` are authenticated/`auth.uid()`-based; the live graph writer is **CEE service-role with no `auth.uid()`** — either CEE can't write versions, or the table's grants get loosened (the A4 anti-pattern) | ✓ service-role INSERT only; RPC carries the ownership/linkage checks server-side; explicit `REVOKE anon, authenticated` per §1.4 | ✗ dual-writer (UI-JWT for A rows, service-role for B rows) — worst posture |
| **Tenant safety / RLS** | △ existing policies fine for authed users, silent for guests | ✓ fresh RLS with A4 lessons baked in (§4.3) | △ two policy sets to keep coherent |
| **Dependency on graphIdentityHash + CAS + contracts** | same for all three: needs Group A merged (or module cherry-picked); hash stays CEE-local/opaque-to-UI until `@talchain/schemas` promotion (contract §6.4/6.5) | same | same |
| **Blast radius / ownership** | ✗ mutates a DGAI-owned migration + live write path + a linked table (`conversation_turns.snapshot_id`) | ✓ purely additive; zero change to existing tables' semantics (one nullable pointer column on `scenarios` is the only touch) | ✗ touches both repos' tables |
| **Semantic honesty** | ✗ two concepts in one table: *audit snapshot of an analysis run* (machine-triggered, write-only, best-effort) vs *user-visible model version* (deliberate, pointer-referenced, restorable). A discriminator column is a polymorphism smell | ✓ one row = one version, invariantly | ✗ both concepts *and* a join |

**Why A fails, in one sentence:** `scenario_snapshots` is an authenticated-JWT, owner-NOT-NULL, write-only, per-analysis-run audit log — Model Management needs service-role-written, possibly-guest-owned, read-heavy, deliberately-ordered version rows; every one of those four properties requires surgery on a DGAI-owned table whose current writer would keep interleaving non-version rows into the history.

**Why C fails:** it buys A's ownership constraint (payload rows still can't be guest-owned) and pays B's cost anyway, plus dual-write consistency and pointer integrity across two tables.

**Size/retention note (why full JSONB, not deltas):** decision graphs here are small (tens of nodes/edges; `scenarios.graph` is a single JSONB column written whole on every turn today). At this scale delta storage is premature complexity that breaks the "any version is directly readable/restorable/comparable" property. Two cheap mitigations instead: (i) **no-op dedupe** — the write RPC skips creating a new version when `graph_identity_hash` equals the current head's (same projection/normaliser versions); (ii) a retention knob later (keep last N + labelled/pinned + restore-ancestors) — explicitly *not* v1.

---

## 3. Recommendation — Option B: new `model_versions` table

**One decision, three composed identities:**

- **Row identity:** surrogate `id uuid` — FK target, wire reference, pointer target.
- **Ordering identity:** `version_number` — per-scenario monotonic, assigned inside the RPC (`max+1` under row lock), unique per scenario. This is the user-facing "v7".
- **Content identity:** `graph_identity_hash` (64-hex) **plus** its `projection_version` / `normaliser_version` / `graph_schema_version` columns. Used for: no-op dedupe at write time, compare short-circuit, restore-safety CAS (via `evaluateGraphIdentityCas`), and cross-run "is this the same model?" questions. **Not unique** — restoring an older state legitimately re-creates an earlier hash at a later version_number; content-address equality is a query, not a constraint.

**Restore doctrine:** restore = append a new version whose graph is a byte-copy of the target version's graph, with `restored_from_version_id` provenance, then move the pointer — **history is never rewritten** (matches the repo-wide append-only doctrine: snapshots "immutable by design", turns "append-only", "history is immutable" in `supabase-store.ts` header). The restore RPC takes an `expected_current_version_id` (or expected head hash) and rejects on mismatch — write-time CAS at the pointer, the first real consumer of Group A's CAS seam.

**Journey:** the same RPC transaction appends `model_version_created` / `model_version_restored` into `scenarios.events` (reusing the exact event vocabulary/plumbing the Journey tab already renders), carrying `{version_id, version_number, graph_identity_hash}` in `hashes`/`details`. No new timeline substrate.

**Repo ownership:** CEE owns the migration (the writer is CEE service-role — matches every `v5_*` precedent). Before naming, introspect staging for collisions (the `v5_` prefix exists precisely because an orphan `conversation_turns` sketch was found live; same check applies to `model_versions`).

### Smallest viable schema sketch

```sql
-- NON-EXECUTABLE / ILLUSTRATIVE ONLY — no schema code ships in this layer.
-- Shape sketch for Decision A/B/C discussion; every line subject to the
-- normal migration review + staging introspection before anything real.

CREATE TABLE model_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id              uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  -- Ownership: denormalised from scenarios.user_id AT WRITE TIME.
  -- v1: writes REFUSED when scenarios.user_id IS NULL (no unowned durable
  -- rows by default — see §4; guest support is an explicit later decision).
  owner_user_id            uuid NOT NULL,
  version_number           integer NOT NULL,          -- per-scenario monotonic, RPC-assigned
  graph                    jsonb  NOT NULL,           -- full snapshot (no deltas at this scale)
  -- Content identity: Group A envelope, stored verbatim so hashes are only
  -- ever compared within matching projection/normaliser versions.
  graph_identity_hash      text   NOT NULL,           -- 64-hex sha256
  identity_projection_ver  text   NOT NULL,           -- e.g. 'identity.v1'
  identity_normaliser_ver  text   NOT NULL,           -- e.g. '1'
  graph_schema_version     text   NOT NULL,           -- e.g. 'graph_v3'
  label                    text,                      -- optional user label
  created_by               text   NOT NULL,           -- 'user_save' | 'restore' | ...
  restored_from_version_id uuid REFERENCES model_versions(id),
  created_at               timestamptz NOT NULL DEFAULT now()
  -- No updated_at: versions are immutable. Append-only; restore never rewrites.
);

ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions FORCE ROW LEVEL SECURITY;

-- Owner-only read; NO insert/update/delete policies for any JWT role:
-- writes go exclusively through the service-role RPC (which bypasses RLS).
CREATE POLICY select_own_model_versions ON model_versions
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

REVOKE ALL ON model_versions FROM anon, authenticated;  -- reads via policy'd SELECT grant only
GRANT SELECT ON model_versions TO authenticated;

CREATE UNIQUE INDEX model_versions_scenario_version_uq
  ON model_versions (scenario_id, version_number);
CREATE INDEX model_versions_scenario_created_idx
  ON model_versions (scenario_id, created_at DESC);
CREATE INDEX model_versions_scenario_hash_idx        -- compare / dedupe lookups
  ON model_versions (scenario_id, graph_identity_hash);

-- Current-version pointer: one nullable column on scenarios (only touch to
-- an existing table). Moved ONLY inside the version RPCs, under CAS.
ALTER TABLE scenarios
  ADD COLUMN current_model_version_id uuid REFERENCES model_versions(id);

-- Write RPC (service-role ONLY — the A4 lesson, applied):
--   create_model_version(p_scenario_id, p_graph, p_identity_hash, p_projection_ver,
--                        p_normaliser_ver, p_schema_ver, p_label, p_created_by,
--                        p_expected_current_version_id, p_restored_from DEFAULT NULL)
--   * locks the scenarios row; refuses if scenarios.user_id IS NULL (v1);
--   * CAS: refuses if current_model_version_id <> p_expected_current_version_id;
--   * no-op dedupe: returns head if p_identity_hash = head hash (same versions);
--   * INSERT version (version_number = head+1), UPDATE pointer,
--     append_scenario_event('model_version_created' | 'model_version_restored')
--     — all in ONE transaction.
REVOKE EXECUTE ON FUNCTION create_model_version(...) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_model_version(...) FROM anon;          -- default-priv
REVOKE EXECUTE ON FUNCTION create_model_version(...) FROM authenticated; -- gotcha (§1.4)
GRANT  EXECUTE ON FUNCTION create_model_version(...) TO service_role;
```

What v1 explicitly does **not** include: deltas, retention/GC, guest-owned versions (§4), branching/named lineages, `@talchain/schemas` promotion of the hash envelope (stays CEE-local + opaque on the wire), and any change to `scenario_snapshots` (it keeps doing its analysis-audit job untouched).

---

## 4. Ownership & protection (feeds Decision 3)

**Principle: no unowned durable rows by default.** The guest relaxation of `20260422000000` was a deliberate PoC trade ("Security posture: … PoC scope") for *conversation* state. Model versions are a different asset class: durable, restorable, user-facing product state. Defaulting them to `owner_user_id NULL` would create rows that (a) no RLS policy can ever scope (`auth.uid() = NULL` never matches — exactly why guest `v5_conversation_turns` rows are invisible to their own creators), (b) only service-role can touch, and (c) accumulate forever with no claimant. That is the A4 shape — service-role-written data whose only protection is "nothing else is granted" — as a *table default* instead of a one-off RPC bug.

**v1 posture (recommended):** `owner_user_id NOT NULL`; the RPC refuses to create versions for guest scenarios (`scenarios.user_id IS NULL` → typed, recoverable "sign in to save versions" error at the CEE boundary). Guests keep today's behaviour: a single live `scenarios.graph`, no history. This loses nothing that exists today (guests have no snapshots either — §1.2) and keeps the ownership story exact.

**If/when guest versions are required, the explicit model (not a default):**

1. **Session-scoped claim:** add nullable `guest_session_id text` + CHECK `(owner_user_id IS NOT NULL) OR (guest_session_id IS NOT NULL AND expires_at IS NOT NULL)` — every row has exactly one owner *kind*; never both null.
2. **Expiry:** guest rows carry `expires_at` (e.g. 30 days); a scheduled cleanup deletes expired unclaimed rows. Unowned-forever rows cannot exist by constraint.
3. **Promotion-on-signup:** one-shot service-role RPC `claim_guest_model_versions(p_guest_session_id, p_user_id)` sets `owner_user_id`, clears `guest_session_id`/`expires_at`, in one transaction with the matching `scenarios.user_id` promotion (which currently has no promotion path either — same decision, take them together).
4. **Access:** guest rows are **never** directly readable by `anon`/`authenticated` (no policy can scope them); all guest reads/writes are mediated by CEE service-role, which binds `guest_session_id` from its own validated session state — the trust boundary is CEE, and it must never accept a client-supplied session id for another scenario.

**RLS/grant rules for the whole feature (A4 applied as a checklist):**

- Table: `ENABLE` + `FORCE` RLS; owner-only SELECT policy; **no** INSERT/UPDATE/DELETE policies for JWT roles; `REVOKE ALL FROM anon`.
- Every RPC: `SECURITY DEFINER` + pinned `search_path` (repo convention), then **explicit** `REVOKE FROM PUBLIC, anon, authenticated; GRANT TO service_role` — remembering Supabase default privileges auto-grant `anon`+`authenticated` on new public functions (`20260609120000` lines 235–243), so the explicit revokes are load-bearing, not belt-and-braces.
- If a UI-JWT-callable read RPC is ever wanted, it must carry an `auth.uid()` ownership predicate *inside* the function (the `create_snapshot` pattern, lines 68–72 — the good precedent), never rely on grants alone.
- Verification of the grant layer happens against the **live database** (`pg_proc`/`proacl` introspection), not migration filenames — the Group A method that caught A4 in the first place.

---

## 5. One-page decision input

| | |
|---|---|
| **Recommendation** | **Option B** — new CEE-owned `model_versions` table (+ one nullable `scenarios.current_model_version_id` pointer column), service-role-written via a single transactional RPC (version insert + pointer CAS + journey event), full-JSONB snapshots, identity = surrogate id (rows) ∘ version_number (ordering) ∘ graphIdentityHash envelope (content). Restore = new version, never rewrite. **v1 auth-owned only; guest versions are a later explicit decision** (claim/expiry/promotion model pre-designed in §4). |
| **Rationale (3 facts)** | (1) The live graph writer is CEE **service-role**; `scenario_snapshots` is structurally authenticated-JWT + `user_id NOT NULL` — Option A means loosening a DGAI-owned table's grants toward the exact A4 anti-pattern. (2) `scenario_snapshots` rows are per-analysis-run, write-only audit artifacts with zero read sites — mixing deliberate user versions into that stream makes "version N" permanently ambiguous. (3) Everything Model Management needs that doesn't exist anywhere yet (version_number, pointer, CAS, identity envelope, restore provenance) is additive regardless of option — B gets it without surgery on live tables. |
| **Implementation consequence** | One CEE migration (table + pointer column + 2–3 RPCs, all service-role); CEE route/handler layer for save/list/compare/restore; Journey events ride the existing `scenarios.events` + `append_scenario_event` plumbing; UI consumes version list/pointer via CEE (hash opaque). **Hard dependency:** Group A's `graph-identity.ts` must land on staging (PR #343 draft, review-only) or be cherry-picked — it supplies the content identity and the CAS evaluator. `scenario_snapshots`, `conversation_turns`, and all existing write paths are untouched. |
| **Risk if wrong** | If B is over-engineering (product only ever needs "undo last change"), the cost is one small extra table — easily collapsed later. The inverse error is worse: building on A means retrofitting ownership, ordering, and pointer semantics onto a DGAI-owned audit table whose writer keeps firing, with grant-loosening pressure on the exact seam A4 just closed. Residual risks in B: version_number contention (mitigated: assigned under row lock in the RPC); hash-regime confusion with the legacy `graph_hash`/topology hashes (mitigated: envelope version columns stored per row, comparisons only within matching versions); Group A not merging (mitigated: module is additive and self-contained). |
| **What it unblocks** | Layer-2 Model Management implementation: save-version, history list, compare (hash short-circuit + CEE-side diff), restore-with-CAS, Journey "version created/restored" timeline entries — plus the first live consumer of Group A's identity hash + CAS seam, and a concrete, tenant-safe write-time CAS precedent for the deferred Track-1/Track-3 apply-wiring. Decision 3 (ownership) gets a default (auth-only v1) and a pre-designed guest model to approve or reject independently. |

---

### Evidence index (primary citations)

| Fact | Source |
|---|---|
| `scenario_snapshots` schema/RLS/RPC/grants | DGAI `supabase/migrations/20260309000000_scenario_snapshots.sql` (table 12–25; RLS 27–35; index 38–39; `create_snapshot` 51–85) |
| `scenarios` schema/RLS/events/RPCs | DGAI `supabase/migrations/20260226000000_scenario_schema_v2.sql` (table 8–43; events 22–23; `append_scenario_event` 84–146; grants 445–475) |
| Guest relaxation (nullable `user_id`, FK dropped, service-role RPCs) | CEE `supabase/migrations/20260422000000_v5_guest_mode_nullable_user_id.sql` |
| Snapshot writer (UI JWT, per-analysis, fire-and-forget) | DGAI `src/services/threadService.ts:96–131`; `src/canvas/conversation/useConversation.ts:2069–2091`; `src/canvas/conversation/hooks/useThreadPersistence.ts:196,237–238` |
| Zero snapshot read sites | grep of DGAI `src/` (no `.from('scenario_snapshots')`); CEE worktree `src/`+`tools/`: 0 refs |
| Guest = stubbed Supabase client | DGAI `src/lib/supabase.ts:9–17` |
| CEE service-role client + live graph writer | CEE `src/orchestrator-v5/session/index.ts:48,74`; `supabase/migrations/20260609120000_v5_conversation_content.sql:189–190, 235–248` |
| A4 security finding + fix + live-introspection method | `Docs/v5/group-a-canonical-state-foundation.md` §0, §2, §7 on `origin/claude/group-a-canonical-state-foundation` @ `b9d168e2`; grant hole originated in CEE `20260422120000_v5_store_draft_graph.sql` (final GRANT lines); REVOKE applied live (operational note — no repo migration file) |
| `graphIdentityHash` + envelope + CAS evaluator | `src/orchestrator-v5/context/graph-identity.ts` @ same branch (constants ~50–66; `computeGraphIdentityHash`; `evaluateGraphIdentityCas`) |
| Journey timeline substrate | DGAI `src/canvas/journey/` (`types.ts` TimelineEntry ← ScenarioEvent; `JourneyTabBody.tsx`, `renderTimeline.ts`) |
| CEE turn store append-only doctrine + RLS | CEE `supabase/migrations/20260417160000_v5_session_store.sql` (RLS 78–88; grants 164–165); `src/orchestrator-v5/session/supabase-store.ts` header |
