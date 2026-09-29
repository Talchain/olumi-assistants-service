# Lane 8 — Graph Management + Model Management live integration (evidence)

Branch: `claude-lane8/gm-mm-live-integration` (base `origin/staging` @ `e88344dba`, includes #361).
Mandate: make GM and MM live-integrated behind a safe activation ladder. Doctrine held: GM never
writes graph state (single durable writer stays `commitDirectAnswer`); no CAS enforcement change
(observe stays); structural honesty (never "applied" without a durable commit); M2 stays out —
this wires the `edit_graph` producer only.

All new user-facing wording in this lane is tagged `provisional_doctrine_v0`
(see `src/orchestrator-v5/handlers/edit-graph-referee-gate.ts`).

---

## Part 1 — pre-wiring test gates

### 1a — §6.6 golden-journey RED fixture (held + ack prose must FAIL A8)
- New fixture `tools/golden-journey-harness/fixtures/golden-journey-v1-gm-held-ack.json`:
  turn 2 carries a held GM projection (`apply_proposed_change` pending), an UNMOVED graph hash,
  and `"I've updated the Budget factor…"` ack prose → **A8 FAILS** (gating). Turn 3 is the honest
  counterpart built from the live wiring's held template + confirm chip + pending → **A8 passes**.
- Captured via the harness CLI (`--json-summary`): `exit_code=1`, `failing_invariants=["A8"]`;
  pinned in `replay-manifest.json` (consumed by both the required unit test and the CI replay gate).
- `hasProposedPendingAction` (observation.ts) extended to count `apply_proposed_change` as
  proposal-class (the GM held projection) alongside `proposed_*`. Safe direction: false RED only;
  a real mutation passes A8 via `hashMoved` first. No committed fixture used the kind before
  (verified by grep across fixtures), so no pinned verdict flipped.
- "Pass by construction": the live wiring REPLACES assistant text on every blocked verdict with
  fixed templates swept against `findSuccessClaimHit` + `findForbiddenPhraseHit`
  (edit-graph-referee-gate.test.ts), and the dispatch egress guard still backstops them.

### 1b — §6.7 supersession (module-local, no persistence)
- `graph-management/pending-projection.ts`: `mutationTargetKey`, `supersedesHeldCandidate`,
  `collapseSupersededHeld` — a newer candidate targeting the same entity supersedes the older
  held one. Pure, module-local.
- Live realisation: the held pending's public handle is `gmh_<sha256-12>` keyed on
  (scenario, target) — deterministic, so a newer same-target held offer carries the SAME
  `chip_id`/`proposal_ref` and the EXISTING commit carry-forward same-key rule ("newer wins")
  retires the older one. No new persistence mechanism.
- Tests: `graph-management/__tests__/live-wiring-adapters.test.ts` (supersession describe block)
  + `edit-graph-referee-gate.test.ts` (held-handle determinism).

### 1c — `v5.candidate_mutation.<verdict>` properly registered
- 5 concrete names added to the `TelemetryEvents` enum (`would_apply|held|stale|rejected|
  clarify_required`), plus the frozen-registry treatment: enum snapshot, sorted spec list,
  `debugOnlyEvents` (no Datadog metric yet), and the namespace regex (`candidate_mutation`,
  `model_versions` added to the `v5.` group). The emit seam routes through the enum members
  (`VERDICT_EVENT` map) — pinned by the gate test asserting names ∈ `VALID_EVENT_NAMES`.

---

## Part 2 — GM live wiring behind CEE_GRAPH_MANAGEMENT_MODE

### 2a — flag
- `createEnvEnforcedGraphManagementMode` in `src/config/index.ts` (mirrors the CAS
  `createEnvEnforcedMode` pattern): `off | shadow | live`, default `off`, invalid → default with
  warn (never boot-fails), **prod auto-downgrades live → shadow** with `[AUDIT]` +
  `production_lockdown` override event. Test: `tests/unit/config.graph-management-mode.test.ts`
  (17 cases, mirrors the CAS-mode pins).

### 2b — CanonicalContextFrame → MutationFrame adapter
- `graph-management/adapters/context-frame.ts` (pure, ~60 LOC): hash → readability, freshness
  vocabulary narrowing (unknown values → `'unknown'`, fail-closed), `canonicalReady` diagnostic.
  Import direction graph-management → `context/frame/types.js` (type-only), sanctioned by an
  explicit isolation-guards allowlist addition; the reverse direction stays impossible.
- Note: the edit seam itself builds its `MutationFrame` from the dispatch's own already-resolved
  authorities (no CanonicalContextFrame exists on the route-v2 edit path); the adapter is the
  sanctioned bridge for frame-bearing seams (turn-executor finalise seam / future M2 producer).

### 2c — edit_graph producer + wiring at the dispatch seam
- Producer `graph-management/adapters/edit-graph-producer.ts`: validated `PatchOperation[]` →
  raw envelopes; one envelope per reviewable unit (multi-field updates fan out);
  `update_node.label` → `rename_node` (the only would_apply-eligible kind); malformed input
  degrades to R1-rejectable envelopes (total, never throws/drops); local structural op mirror
  (no `src/orchestrator` import — module isolation preserved). Batch cap NOT truncated by the
  producer: `refereeMutationBatch` rejects over-cap batches whole with `BATCH_CAP_EXCEEDED`
  (contract behaviour; pinned).
- Seam `handlers/edit-graph-referee-gate.ts` + wiring in `handlers/edit-graph-dispatch.ts`
  (after the freshness derivation, before the false-success/no-op region — the two regions are
  mutually exclusive by predicate):
  - **off**: zero referee calls, byte-identical (pinned via module spy + metadata comparison).
  - **shadow**: referee evaluates every envelope, emits redacted telemetry; response AND commit
    metadata byte-identical to off (JSON-compare pin; the CAS-observe pattern).
  - **live**: batch-governing verdict, precedence `rejected > stale > held > clarify_required >
    proceed` (conservative: integrity failures outrank staleness outrank doctrine holds).
    - `proceed` (ALL would_apply) → existing apply path exactly as today (pinned: graph +
      receipt fact persist).
    - `held` → real `apply_proposed_change` pending (round-trips `parsePendingAction`) + confirm
      chip (`chip_id == proposal_ref` bridge) + held copy. **Resume semantics chosen: the
      sanctioned decline-with-clarify** — `inline_patch.handler_id='graph_management_held_v1'`
      is outside the synthesis allowlist, so a "yes" resolves through
      `decideProposedChangeSynthesis → 'invalid' → commitProposedChangeRecovery` (deterministic
      clarify), never a silent drop and never an un-reviewed apply. Pinned by an end-to-end
      synthesis assertion. Executing held mutations on confirm is the named follow-up.
    - `stale` → refresh recovery template + executable `run_analysis` chip.
    - `rejected` / `clarify_required` → recovery/clarify templates; the referee's redacted public
      reason (verdict, mutation_class, blocker code+readable, candidate_id, base_hash_match —
      NEVER `RefereeVerdict.candidate`) ships on a warn-severity wire details block. Blocker
      readables are deliberately NOT inlined into `assistant_text`: several fixed readables
      contain egress-banned tokens ("node id"), and the egress guard would erase the whole
      response.
  - Structural honesty on every blocked verdict (`effectiveAppliedMutation` gate): no graph
    commit, no edit receipt fact, no `analysis_ready` stamp, returned `graph: null`, no CAS
    observation, wire freshness re-derived against the UNCHANGED base, R7 turn event reports
    `outcome=proposal|clarify|rejected` + `branch=graph_management_<verdict>` (never `success`).

### 2d — fail-closed
- Referee/gate exceptions: shadow → log-only proceed; live → block-with-clarify (pinned with a
  hostile Proxy operations array). Unreadable graph (null hash) → held `CURRENT_GRAPH_UNREADABLE`
  WITHOUT a pending (a parse-valid pending requires a graph hash) using the held-no-pending
  clarify copy. Unknown freshness → frame gate fails closed to stale.

### Behavioural consequence Paul should know before flipping live
The landed referee doctrine (unchanged by this lane) means in LIVE mode on the edit path:
- only pure renames auto-apply (`rename_node` via EP2 parity);
- all other kinds hold (`TUNABLE_APPLY_HELD` / `STRUCTURAL_APPLY_HELD` / `REMOVE_UNCONFIRMED` /
  add_option splits) → confirm-first UX;
- pre-edit freshness `'stale'` (graph moved since the last analysis) governs STALE → consecutive
  edits after an analysis require a re-run between them. `'none'` (pre-analysis) and `'fresh'`
  proceed to the kind posture.
Shadow-mode telemetry (`v5.candidate_mutation.*` with `mode:'shadow'`) is exactly the evidence
to size this before the live flip.

---

## Part 3 — MM version hook at the commit seam

### 3a
- `commit.ts`: after `store.append` success, when `CEE_MODEL_VERSIONS_ENABLED` is true AND a
  graph was persisted this commit → fire-and-forget `saveVersion` with **the exact
  `graphForStore` object the store persisted** (so MM's Group A
  `computeGraphIdentityHash` matches the store's identity of `scenarios.graph`), content-free
  label `commit:<handler_id|turn_class>`, provenance `'commit'`, and
  `event_id = model_version_created_turn_<turn_id>` (deterministic → RPC-side idempotent
  re-drive; identical graphs additionally no-op-dedupe against the head in the RPC).
- Non-blocking contract pinned: flag off ⇒ zero service construction/env reads (byte-identical);
  throwing service / rejected RPC ⇒ warn log only, turn result untouched
  (`commit-model-version-hook.test.ts`, 7 cases).
- `event_id` threaded additively through `SaveVersionRequest` → `SaveVersionWrite` → `p_event_id`
  (TEXT in the executed migration; RPC still mints a row-keyed id when absent).
- Telemetry `v5.model_versions.version_created` (full registry treatment; content-free fields,
  16-hex identity-hash prefix only).

### 3b
- `CAS_CONFLICT_KIND` in MM types.ts is now
  `'analysis_affecting_conflict' as const satisfies GraphCasConflictCategory` — bound to the
  landed A3 vocabulary (type-only import); drift is a compile error. MM isolation-guards
  outbound allowlist extended with the sanctioned type-only seam.
- MM inbound "zero call sites" dark invariant deliberately CONVERTED: the sanctioned call-site
  set is now exactly `{ commit.ts }`, with a non-vacuousness check (commit.ts must actually
  import the module) and everything else still banned.

---

## Part 4 — ISSUE-9026 t4-contract repoint (parity verification)

Attempted verbatim; assertions DRIFTED on payload shapes. Reconciled assertion-by-assertion —
all six deltas are pre-ratification inline sketch vs the ratified module shape, and all move in
the fail-closed direction:

| # | Kind | Inline (pre-ratification) | Module (ratified) | Direction |
|---|------|---------------------------|-------------------|-----------|
| 1 | add_node | `{ node: record }` (permissive) | strict `{ node: { id, kind∈NodeKind, label } }` | stricter |
| 2 | add_option | `{ option: record }` | strict option; REQUIRED `edges: []` linkage array | stricter |
| 3 | update_edge_field | `{ edge_id, field, from, to }` | `{ from_node, to_node, field, from, to }` | renamed (edges have no standalone id in GraphV3) |
| 4 | remove_node | `{ id, reason }` | `{ node_id, reason }` | renamed |
| 5 | remove_edge | `{ id, reason }` | `{ from_node, to_node, reason }` | renamed |
| 6 | rename_node | `from_label` REQUIRED | `from_label` OPTIONAL (`to_label` still required) | relaxed metadata-only field; fixture still supplies it |

Every rejection assertion survived verbatim (unknown version / unknown kind / extra top-level /
extra payload fields on ALL 10 kinds / missing provenance / empty evidence_pointer / missing +
null base_graph_hash). The inline schema is retired (no `discriminatedUnion` in the spec —
enforced); the "no src imports" isolation guard is retired per the hook's conversion
instructions. HOOK 4 (future-hooks-registry) converted: schema DEFINITION ownership enforced
(only graph-management defines `CandidateMutationEnvelopeV1 =`), live wiring + default-off flag
enforced, the narrowed ISSUE-9026 case un-skipped and now ENFORCING.

---

## Test evidence (all run in this worktree at the branch tip)

- `scripts/validate-prepush.sh` — **all checks passed** (typecheck, smoke, state-write-invariant,
  handler-ownership, response-finaliser-contract, forbidden-boundary ratchet == baseline, etc.).
- `pnpm typecheck:src` — clean (also re-run in a FRESH verification worktree at the branch tip;
  see PR description).
- Focused vitest, all green:
  - GM module: 9 files / 144 tests → 10 files / 169 tests (incl. new
    `live-wiring-adapters.test.ts` 27, isolation-guards with the frame-types seam).
  - Gate: `edit-graph-referee-gate.test.ts` 24 tests.
  - Dispatch modes: `edit-graph-dispatch-graph-management-modes.test.ts` 5 tests
    (off zero-referee + shadow byte-identity + live proceed/held + honest R7).
  - Commit + MM: 14 files / 173 tests (incl. `commit-model-version-hook.test.ts` 7).
  - Telemetry frozen registry 11; config mode tests 17 + CAS-mode 16 unchanged.
  - Golden-journey harness suites: 6 files / 126 passed (new fixture pinned RED on A8).
  - ai-harness (incl. converted hooks + wording-honesty): 10 files / 146 passed, 4 deliberate
    skips (unchanged blocked-future hooks).
  - t4-contract: 27 tests.
- eslint on every changed file: clean.
- **Pre-existing failures (NOT this lane)**: `chip-click-dispatch.test.ts` +
  `chip-click-dispatch-analysis-ready.test.ts` fail 5 tests IDENTICALLY on pristine
  `origin/staging` @ `e88344dba` (verified in a detached pristine worktree before any lane
  changes were compared). Untouched by this lane.

## Known residuals / follow-ups
1. Held-confirm executes nothing yet: "yes" on a held pending resolves to the deterministic
   decline-with-clarify recovery (sanctioned tonight). Follow-up: a GM resume executor that
   routes the held envelope through the existing apply path on confirm.
2. Held UX copy invites "yes" but the confirm outcome asks the user to restate — cosmetic
   mismatch inherent to (1); wording is provisional_doctrine_v0.
3. Live-mode strictness (renames-only auto-apply; stale-between-edits) is the landed doctrine,
   not a lane choice — shadow telemetry should size it before the live flip; §6 doctrine
   sign-off may relax `TUNABLE_APPLY_HELD` later.
4. The GM pre-edit freshness re-projection skips the option-identity guard (hash divergence
   already covers option add/remove); documented conservative gap.
5. MM restore/compare remain dark; ISSUE-9022 (restore/version claim detection) unchanged.
