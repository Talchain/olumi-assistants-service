# Graph Management — durable Apply/Reject service contract v0

**Status:** DESIGN ONLY — no implementation, no wiring, no migration, no schema-package change.
**Date:** 2026-07-05 · **Author:** contract-design session (doc-only task)
**Scope:** the CEE-internal service contract for durably applying or rejecting a PROPOSED
structural graph change. Layer-3 work builds against this; nothing here is built now.

**Source material read (verbatim refs, all verified this session):**

| Input | Where | What was taken |
|---|---|---|
| Track 3 typed-mutation referee (PR #341, branch `claude/track-3-graph-management-core` @ `ecab7050f`) | `src/orchestrator-v5/graph-management/{types,reason-codes,referee,pending-projection}.ts` | `CandidateMutationEnvelopeV1` (10 kinds, `.strict()`), `MutationVerdict`, `MutationReasonCode` closed set, `MutationFrame` (frame-provided authority, never re-derived), `PROPOSAL_CAP = 8`, held→pending projection, `AppliedLedger` idempotency |
| Group A `graphIdentityHash` (branch `claude/group-a-canonical-state-foundation` @ `b9d168e2`) | `src/orchestrator-v5/context/graph-identity.ts`, `Docs/v5/group-a-canonical-state-foundation.md` | 64-hex SHA-256, projection `identity.v1`, versioned hash envelopes, `evaluateGraphIdentityCas` (dark), A3 live-writer plan (D0 observe / D1 migration), A5 handoff instructions to #341 |
| pending_confirmation truth (#340, MERGED, staging `d60bffb32`) | `origin/staging:src/orchestrator-v5/session/pending-action.ts`, `context/frame/types.ts` | `CONFIRMATION_EXPECTING_ACTION_TYPES = {apply_proposed_change, proposed_concept}`, `isPendingActionExpired` (wall + turn TTL, fail-closed), `derivePendingActivity`, kill-switch `CEE_PENDING_CONFIRMATION_TRUTH_ENABLED` |
| Existing propose-then-confirm path (live today) | `src/orchestrator-v5/{types/proposed-change.ts, session/pending-action.ts, routing/proposed-change-synthesis.ts, routing/proposal-dismissal.ts, commit.ts}` | `proposal_ref == chip_id` invariant, `inline_patch` carriage, emit-time `preconditions.graph_hash` (analysis-affecting, 16-hex), `decideProposedChangeSynthesis` statuses (`execute/superseded/already_applied/invalid`), carry-forward consume/supersede rules, TTL defaults |
| A3 CAS conflict vocabulary (being implemented in parallel — **treated as given**) | task brief | `unavailable`, `first_write`, `no_expected`, `match`, `self_noop`, `cosmetic_concurrent_edit`, `analysis_affecting_conflict`; first-match-wins in that spirit; `self_noop` always precedes conflict categories and is never blocked |
| Wire boundary today | `src/orchestrator-v5/compose/types.ts` (`SuggestedAction = boundary Action {id,label,message,action_type?}`), `compose.ts`, `supabase-store.ts` (`append_turn_atomic_v2`) | Proposals reach the UI as chips in `response.suggested_actions[]`; executable truth is server-persisted `pending_actions` JSONB; the sole durable graph writer on the live path is `append_turn_atomic_v2` |

**Where this doc deliberately does NOT follow a reference:** each deviation is called out
inline with a `Δ` marker and a reason. Reference material was not silently promoted where it
conflicts with Group A / A3 direction (per task instruction).

**Hard rules honoured throughout:** no CAS bypass; no UI-local graph truth; no second
mutation envelope; no second conflict vocabulary; honest narration follows persisted state.

---

## 0. Definitions and system position

- **Proposal** — a server-authored, user-visible offer of a structural graph change,
  surfaced on turn N as a chip and persisted server-side. The user Applies or Rejects it on
  a later turn (conversationally or by chip click; both arrive through
  `/orchestrate/v2/turn` — no new UI surface is proposed here).
- **Apply** — the user's explicit confirmation. On success it produces exactly one durable
  commit through the CAS-guarded writer and one Model-Management version event.
- **Reject** — the user's explicit discard. It consumes the proposal and writes **no**
  graph change. Forward-only recovery posture (Track 3 §Slice-4): there is **no rollback
  store**; Reject never undoes an Apply.
- **Two hashes, two jobs** (Group A two-projection doctrine, preserved verbatim):
  - `analysis_affecting_hash` — 16-hex prefix SHA-256, projection `analysis_affecting.v1`
    (`computeAnalysisAffectingGraphHash`). Owns *referee stale gating* and the existing
    pending-action stale gate. Unchanged by this contract.
  - `graph_identity_hash` — 64-hex SHA-256, projection `identity.v1`
    (`computeGraphIdentityHash`). Owns *strict CAS at the durable writer* and version
    identity. This contract is its first consumer with user-visible semantics.
- **Single writer:** all durable commits go through the A3 CAS interface on
  `append_turn_atomic_v2` (and its future v3/D1 form). This contract never introduces a
  second writer and never calls `store_draft_graph` (A4: fail-closed then retire).

---

## 1. Proposal / referee envelope

### 1.1 Typed mutation ops — reuse Track 3's envelope verbatim

The **only** mutation shape in this contract is Track 3's `CandidateMutationEnvelopeV1`
(discriminated union on `kind`, all branches `.strict()`, model-invented fields REJECTED):

- Kinds (closed set, reused unchanged): `add_node`, `add_edge`, `update_node_field`,
  `update_edge_field`, `rename_node`, `add_option`, `remove_node`, `remove_edge`,
  `flag_uncertainty`, `clarification`.
- Per-kind payloads, `Provenance {source, evidence_pointer, rationale?, model_id?}`,
  `Identity {scenario_id, turn_id}`, `candidate_id` (UUID), and `PROPOSAL_CAP = 8` are
  reused unchanged.
- The referee's verdict vocabulary (`would_apply | held | stale | rejected |
  clarify_required`) and the `MutationReasonCode` closed set are reused unchanged, with the
  small named additions in §1.5.

**Reused vs changed (explicit):**

| Element | Disposition | Why |
|---|---|---|
| 10-kind op union + `.strict()` payloads | **Reused verbatim** | One envelope = one reviewable unit; no second mutation envelope (hard rule) |
| `base_graph_hash` (per-op, analysis-affecting) | **Reused**, semantics pinned: it is the analysis-affecting hash, feeding the referee's R2 stale gate | Track 3's frame gate compares against `MutationFrame.currentGraphHash`; that authority is analysis-affecting today |
| Δ `base_graph_identity_hash` (per-proposal, 64-hex) | **Added at the proposal level** (not per-op) | Group A §9 (A5 handoff) instructs #341 to adopt an optional identity hash *alongside* the analysis hash. Placing it on the proposal record (once) rather than each op avoids intra-proposal drift; an invariant (§1.3-I3) ties ops to it |
| Δ Proposal = ordered batch of 1..`PROPOSAL_CAP` ops | **Added wrapper** | A user-visible structural change frequently needs paired ops (`add_node` + `add_edge`). Track 3 already contemplates producer batches (`PROPOSAL_CAP = 8`). The wrapper *references* envelopes; it does not re-shape them — so this is not a second mutation envelope |
| Δ `provenance.ui_safe?: boolean` (default **false**) | **Added optional field** | Group A §9 verbatim: "keep provenance `ui_safe: false` by default; never treat raw model rationale as UI-safe" |
| Track 3 `pending-projection` rule `proposal_ref = candidate_id` | **Changed**: `proposal_ref == chip_id == proposal_id` | The merged #340/G7 parser (`parsePendingAction`) *rejects* entries where `proposal_ref !== chip_id`. Track 3's projection explicitly deferred real emission to the integration slice; this contract resolves the seam in favour of the merged parser rule. Each op keeps its own `candidate_id` |
| Referee anti-rederivation pin (frame-provided hash, never re-derived in the referee) | **Reused verbatim** | Paul pin #1 on Track 3; the Apply pipeline (§3.4) supplies the frame from the persisted-first read, exactly once per attempt |

### 1.2 The proposal record (`GraphProposalRecord v0` — CEE-local)

```ts
/** CEE-local. NOT promoted to @talchain/schemas in v0 (see §7.2 / §8-D2). */
interface GraphProposalRecord {
  readonly record_version: 'graph_proposal.v0';

  /** Public handle. INVARIANT I1: proposal_id === chip.id === pending.proposal_ref
   *  (format today: `prop_<sha256-12hex>`, per compose/proposed-change.ts). */
  readonly proposal_id: string;
  readonly scenario_id: string;

  /** What class of offer this is. Closed set, v0. */
  readonly proposal_kind:
    | 'structural_change'       // ops mutate topology (add/remove node/edge, add_option)
    | 'field_update'            // ops mutate allowed fields (update_*_field, rename_node)
    | 'mixed';                  // batch spans both classes

  /** Ordered, atomic batch: 1..PROPOSAL_CAP CandidateMutationEnvelopeV1 items.
   *  Apply is ALL-OR-NOTHING across the batch (§2.3). */
  readonly ops: readonly CandidateMutationEnvelopeV1[];

  /** Captured base state at proposal time — both projections, as Group A's
   *  versioned hash envelopes (value + algorithm + projection/normaliser/schema
   *  versions). REQUIRED; a proposal without a computable base is not emitted
   *  (fail closed at emit, mirroring emitProposedChange's refusal posture). */
  readonly base: {
    readonly graph_identity_hash: GraphIdentityHash;        // 64-hex, identity.v1
    readonly analysis_affecting_hash: AnalysisAffectingHash; // 16-hex, analysis_affecting.v1
  };

  /** Proposal-level provenance (op-level Provenance also present per envelope). */
  readonly provenance: {
    readonly source: 'dual_model_m2' | 'edit_graph_llm' | 'flip_proposal' | 'user_direct';
    readonly evidence_pointer: string;
    readonly rationale?: string;   // NEVER UI-surfaced unless ui_safe
    readonly model_id?: string;
    readonly ui_safe?: boolean;    // default false (Group A §9)
  };

  /** User-facing copy, captured at emit time; MUST pass the existing proposal
   *  safety filter (no handler ids, no 'apply_proposed_change', no raw JSON). */
  readonly public_label: string;
  readonly public_message: string;

  /** Lifecycle (see §1.4). */
  readonly emitted_at_iso: string;
  readonly emitted_turn_id: string;
  readonly expires_at_iso: string;        // wall TTL
  readonly expires_at_turn_count: number; // turn TTL (decrement-at-carry-forward)
}
```

**Carriage:** the record rides the **existing** `apply_proposed_change` pending-action
variant — `proposal_ref = proposal_id`, `public_label`/`public_message` as today, and
`inline_patch = { handler_id: 'graph_management_apply', record: GraphProposalRecord }`.
`preconditions.graph_hash` stays the **analysis-affecting** hash (parser-required today;
the existing carry-forward stale gate keeps working unchanged — Group A pinned that gate as
analysis-affecting-owned, and this contract does not move it). The identity hash lives
inside the record, not in `preconditions`.

Because the kind is `apply_proposed_change`, the proposal is automatically
confirmation-expecting under #340 (`CONFIRMATION_EXPECTING_ACTION_TYPES`), so
`pending_confirmation` truth holds with **zero** changes to #340.

### 1.3 Invariants

- **I1** `proposal_id === chip_id === pending.proposal_ref` (existing parse rule; violations are unparsable and dropped at read).
- **I2** `ops.length ∈ [1, PROPOSAL_CAP]`; every op's `identity.scenario_id === proposal.scenario_id`.
- **I3** every op's `base_graph_hash === base.analysis_affecting_hash.value` (single captured base; no per-op drift). Violation at emit → refuse to emit; at read → proposal invalid → Apply returns `unsafe` (§5).
- **I4** `base.graph_identity_hash` is a full 64-hex `identity.v1` value; `base.analysis_affecting_hash` is 16-hex `analysis_affecting.v1`. Projection-version fields are checked, not assumed — a future normaliser bump makes an old proposal `stale` (§3.5), never silently comparable.
- **I5** The record is immutable after emit. Any "amended proposal" is a NEW proposal (new id) superseding the old via the existing carry-forward supersession rules.

### 1.4 Expiry / turn-count semantics

Reused verbatim from the merged pending-action lifecycle (single liveness authority,
`isPendingActionExpired`, fail-closed):

- Wall TTL: `expires_at_iso`; malformed → expired (never treat unverifiable freshness as live).
- Turn TTL: `expires_at_turn_count`, decremented at carry-forward persistence; `<= 0` → expired. The route resolver mirrors turn-count expiry (staging fix `0b50b84fa`).
- Defaults: `PENDING_ACTION_DEFAULT_TURN_TTL = 2`, `PENDING_ACTION_DEFAULT_WALL_TTL_MS = 10min`. Durable structural proposals MAY set longer TTLs via the existing emit-context overrides (`wall_ttl_ms`, `turn_ttl`); this contract does not change the defaults.
- An **expired** proposal is not Apply-able: Apply → response state `stale`, reason `PROPOSAL_EXPIRED` (§2.4). Reject of an expired proposal → idempotent `rejected` success (discarding something already dead is safe and honest).

### 1.5 Reason-code additions (closed-set discipline)

Track 3's `MUTATION_REASON_CODES` set is reused; this contract mints exactly **five**
additions (same closed-set + freeze + `isMutationReasonCode` discipline; no ad-hoc codes):

| New code | Meaning |
|---|---|
| `PROPOSAL_NOT_FOUND` | id resolves to no live or historical proposal in scenario scope |
| `PROPOSAL_EXPIRED` | wall/turn TTL elapsed (maps to state `stale`) |
| `PROPOSAL_ALREADY_REJECTED` | lifecycle conflict: Apply (or re-anything mutating) after Reject |
| `PROPOSAL_BASE_MISMATCH` | request's echoed base hash ≠ persisted record's base (fail closed; likely cross-proposal confusion) |
| `COMMIT_WRITE_FAILED` | referee passed, CAS passed, but the durable RPC write failed |

`PROPOSAL_ALREADY_APPLIED` already exists in Track 3's set and is reused for idempotent
re-apply and reject-after-apply. **CAS conflicts mint NO mirror codes** — the A3 category
string itself is carried (§4), keeping one vocabulary.

---

## 2. Apply / Reject request–response contract

Service-level operations, invoked today by the turn executor's deterministic pre-routes
(short-confirm "yes" / ordinal-select / dismissal / chip click replayed as a message).
Defining them as typed service operations is what makes a future direct endpoint
(e.g. `POST /orchestrate/v2/proposals/:id/apply`) buildable without rework; **no endpoint
or UI change is proposed in v0.**

### 2.1 Requests

```ts
interface ApplyProposalRequest {
  readonly scenario_id: string;
  readonly proposal_id: string;
  /** Echo of the captured base identity hash (64-hex). REQUIRED.
   *  Server verifies echo === persisted record's base.graph_identity_hash.value;
   *  mismatch → unsafe / PROPOSAL_BASE_MISMATCH (no write). The echo is a
   *  confusion guard, NOT the CAS input — CAS always compares against the
   *  CURRENT persisted graph server-side (never client-supplied truth). */
  readonly base_graph_identity_hash: string;
  /** Attribution for the version event (§7.3). */
  readonly actor: { readonly kind: 'user' | 'system'; readonly id?: string };
  /** Idempotency key IS the proposal_id — one proposal commits at most once. */
}

interface RejectProposalRequest {
  readonly scenario_id: string;
  readonly proposal_id: string;
  readonly actor: { readonly kind: 'user' | 'system'; readonly id?: string };
  // No hash needed: Reject writes no graph change and never needs CAS.
}
```

### 2.2 Response envelope

```ts
interface ProposalActionResult {
  readonly result_version: 'proposal_action_result.v0';
  readonly proposal_id: string;

  /** The SIX narration states (§6) — the only user-facing outcome vocabulary. */
  readonly state:
    | 'committed' | 'rejected' | 'stale'
    | 'clarify_required' | 'unsafe' | 'commit_failed';

  /** True when this call performed no new write because the outcome already
   *  held (re-apply of applied; re-reject of rejected; self_noop). */
  readonly idempotent_replay: boolean;

  /** Present iff state === 'committed' (including idempotent replays, which
   *  reference the ORIGINAL durable commit). */
  readonly commit?: {
    readonly turn_id: string;                      // append_turn_atomic_v2 row
    readonly resulting_graph_identity_hash: string; // 64-hex, identity.v1
    readonly resulting_analysis_affecting_hash: string | null;
    readonly version_event_id: string;             // §7.3 hook
    readonly committed_at_iso: string;
  };

  /** Present on every non-committed state. `reason` is a MutationReasonCode
   *  (incl. §1.5 additions); `cas` carries the A3 category VERBATIM when the
   *  outcome was CAS-decided (§4). Never both absent on failure. */
  readonly failure?: {
    readonly reason: MutationReasonCode;
    readonly cas?: A3CasCategory;   // §4 — the single conflict vocabulary
    readonly referee?: {            // present when the referee decided it
      readonly verdict: MutationVerdict;
      readonly blocker_code: MutationReasonCode | null;
    };
  };

  /** Redacted, user-safe narration inputs (§6). Copy is composed downstream at
   *  the egress chokepoint; this block never carries raw values or internal ids. */
  readonly narration: { readonly headline: string; readonly detail?: string };
}
```

**Wire note (schema-skew hazard, system map §hazard-1):** the turn response continues to
carry outcome as `assistant_text` + `suggested_actions[]` chips. `ProposalActionResult`
may additionally be surfaced as an **additive** response field later, but because the UI
pins `@talchain/schemas` 0.8.1 and silently drops unknown fields, **no correctness-load-
bearing information may ride only on the new field** — text + chips must always be
sufficient. This is a standing constraint, not a TODO.

### 2.3 Apply semantics

1. Atomic batch: all ops in `ops[]` referee-pass and apply into **one** candidate graph, or
   nothing commits. No partial application, ever.
2. Exactly one durable write per successful Apply: one `append_turn_atomic_v2` call
   carrying the post-apply graph, CAS-guarded per A3 (§7.1). The referee itself NEVER
   writes (Track 3 pin preserved: application is the wired handler path's exclusive right).
3. Exactly one version event per durable commit (§7.3), emitted with at-least-once
   delivery and idempotent by `proposal_id`.
4. On success the proposal is **consumed** via the existing `consumedPendingRefs`
   carry-forward mechanism (it must never reappear as a live chip — merged signature-loop
   rule, reused unchanged).

### 2.4 Outcome matrix (normative)

| # | Situation | State | `idempotent_replay` | Reason / cas | Write? |
|---|---|---|---|---|---|
| A1 | First Apply; CAS `match`; referee passes; RPC succeeds | `committed` | false | — | YES (1 commit + 1 version event) |
| A2 | **Re-apply of an applied proposal** | `committed` | **true** | `PROPOSAL_ALREADY_APPLIED` in `failure`? **No** — success path: `commit` block references the ORIGINAL durable commit; no `failure` block | NO |
| A3 | Apply; CAS `self_noop` (effect already present in persisted graph) | `committed` | true | — (cas: `self_noop` recorded in telemetry, not `failure`) | NO new write; `commit` references current persisted state (see §3.3) |
| A4 | Apply; CAS `cosmetic_concurrent_edit`; re-referee passes; write CAS passes | `committed` | false | — | YES |
| A5 | Apply; CAS `analysis_affecting_conflict` | `stale` | false | cas: `analysis_affecting_conflict` | NO — re-proposal required |
| A6 | Apply; proposal expired (wall or turn) | `stale` | false | `PROPOSAL_EXPIRED` | NO |
| A7 | Apply; referee → `clarify_required` | `clarify_required` | false | referee blocker | NO; proposal stays live (§5.2) |
| A8 | Apply; referee → `rejected`, or graph unreadable, or CAS `unavailable`, or I3/I4 violation, or base-echo mismatch | `unsafe` | false | referee blocker / `CURRENT_GRAPH_UNREADABLE` / `PROPOSAL_BASE_MISMATCH` | NO; proposal invalidated (§5.3) |
| A9 | Apply; referee + CAS passed; RPC write failed or write-time CAS lost the race | `commit_failed` | false | `COMMIT_WRITE_FAILED`, or cas category from the write-time check | NO durable change (verified, not assumed — §6.3) |
| A10 | **Reject after Apply** | **typed conflict** → `unsafe` | false | `PROPOSAL_ALREADY_APPLIED` | NO. Narration: the change is already applied and Reject does not undo it (forward-only; §6.2) |
| A11 | Reject of a live proposal | `rejected` | false | — | NO graph write; proposal consumed via `consumedPendingRefs` |
| A12 | Re-reject of a rejected proposal | `rejected` | true | `PROPOSAL_ALREADY_REJECTED` (informational) | NO |
| A13 | Apply after Reject | `unsafe` | false | `PROPOSAL_ALREADY_REJECTED` | NO. Re-proposal required |
| A14 | Apply/Reject; unknown `proposal_id` | `unsafe` | false | `PROPOSAL_NOT_FOUND` | NO |

Precedence when several could match: **lifecycle first** (found → applied? → rejected? →
expired?), then CAS pre-check, then referee, then commit. Within CAS, the A3 first-match-
wins order (§4). `self_noop` always precedes conflict categories and is never blocked
(A3 given, honoured at both the pre-check and the write-time check).

### 2.5 Idempotency (normative statement)

- `proposal_id` is the idempotency key for the whole lifecycle. At most one durable commit
  per proposal, ever (enforced by the applied-ledger check *and* by write-time CAS — belt
  and braces; the ledger is Track 3's `AppliedLedger` seam, its durable substrate is
  decision D3, §8).
- Re-apply → A2: no-op success **referencing the durable commit** (its `turn_id`,
  `resulting_graph_identity_hash`, `version_event_id`). Never re-runs handlers, never
  re-emits a version event.
- Reject-after-apply → A10: typed conflict. Never narrated as "cancelled".
- Concurrent double-Apply race (two turns in flight): both pass the ledger pre-check; the
  write-time CAS serialises them — the first commits, the second sees its own effect via
  `self_noop`/`PROPOSAL_ALREADY_APPLIED` on retry-read → A2/A3, or a conflict → A9. In no
  interleaving do two commits result from one proposal.

---

## 3. Stale-proposal handling

### 3.1 What "stale" is keyed off

Staleness for Apply is keyed off **captured `base.graph_identity_hash` vs the current
persisted graph's identity hash**, evaluated server-side against the persisted-first read
(the Track 2 seam hashing rule; never the request-supplied graph, never UI-local truth).
The analysis-affecting hash keeps its existing narrower job: the referee's R2 gate and the
carry-forward pending stale gate (both unchanged).

### 3.2 Category → behaviour mapping (A3 vocabulary, verbatim)

Evaluated first-match-wins in the A3 order:

| A3 category | Meaning here | Apply behaviour | Resulting state |
|---|---|---|---|
| `unavailable` | current persisted graph has no computable identity hash (absent/empty) | fail closed; a structural proposal presupposes a readable base | `unsafe` (`CURRENT_GRAPH_UNREADABLE`) |
| `first_write` | no persisted graph exists to compare against, write would be the first | the graph the user was shown no longer exists → the proposal's base is gone; fail closed, do NOT create-as-first-write from a stale offer | `stale` (re-proposal required) |
| `no_expected` | caller supplied no expected hash | **unreachable by construction** on this path — proposals always capture a base (§1.2 REQUIRED) and the request echoes it. If reached (corrupt/legacy record), fail closed | `unsafe` (`BASE_HASH_MISSING`) |
| `match` | captured base identity hash === current identity hash | proceed: referee re-run → commit | → §2.4 A1/A7/A8/A9 |
| `self_noop` | applying would change nothing — the proposal's effect already holds in the persisted graph | **already-applied success path**; never blocked, precedes all conflict categories (A3 given) | `committed` with `idempotent_replay: true` (§3.3) |
| `cosmetic_concurrent_edit` | identity hash moved but the divergence is cosmetic-only (analysis-affecting hash of the base still equals the current graph's analysis-affecting hash) | apply MAY proceed **with mandatory re-referee** against the *current* graph (fresh frame, fail-closed); commit still CAS-guarded on the *current* identity hash | `committed` on pass; `unsafe`/`clarify_required` if re-referee blocks |
| `analysis_affecting_conflict` | the graph has materially moved since proposal time | stale; the user must see a fresh proposal against the current graph. Never auto-merge, never apply-anyway | `stale` |

**Note on `no_expected` leniency:** A3's `no_expected` exists so legacy writers that thread
no hash are never rejected. Apply/Reject explicitly **opts out** of that leniency — this
path always has an expected hash, so absence is evidence of corruption, not a legacy
caller. This keeps A3's observe-mode guarantees for existing callers intact while making
the proposal path strictly CAS'd from day one.

### 3.3 `self_noop` — the already-applied success path

Two ways a proposal's effect can already hold: (a) this proposal already committed
(ledger hit → A2), (b) the user (or another flow) made the same change independently and
the candidate graph equals the current graph (→ A3). Both narrate honestly as success
without claiming this call did the work:

- (a) references the original commit block verbatim.
- (b) sets `commit` to the *current* persisted state's identifiers with
  `idempotent_replay: true` and **no new version event** (nothing changed; a no-change
  version event would be a false history entry). Narration: "That change is already in
  your model — nothing needed applying." The proposal is consumed either way.

### 3.4 Pipeline order (normative)

```
Apply(proposal_id, echo_hash)
  1. Lifecycle gate: exists? → rejected? → applied (ledger)? → expired?      (§2.4 A14/A13/A2/A6)
  2. Echo guard: echo_hash === record.base.graph_identity_hash.value        (else unsafe/PROPOSAL_BASE_MISMATCH)
  3. Persisted-first read of current graph (single read; sole frame source)
  4. CAS pre-check: A3 evaluator(base identity hash, current graph)         (§3.2 mapping)
  5. On match | cosmetic_concurrent_edit: referee re-run, ALL ops, fresh
     MutationFrame from step 3 (anti-rederivation pin: referee consumes,
     never computes)                                                        (§5 on non-pass)
  6. Durable commit via A3 CAS interface: expected = CURRENT identity hash
     observed at step 3/4 (not the proposal base — the base was validated in
     step 4; the write-time CAS closes the step-3→commit race window)
  7. Post-commit (only on RPC success): version event emit (§7.3), consume
     proposal (consumedPendingRefs), compose narration from PERSISTED outcome
```

Step 6 is where "no CAS bypass" is enforced mechanically: there is no code path from
referee-pass to the RPC that omits the expected hash.

### 3.5 Version-skew staleness

If the persisted record's `projection_version`/`normaliser_version` (I4) don't match the
running normaliser's versions, hashes are not comparable → treat as
`analysis_affecting_conflict`-equivalent: `stale`, re-proposal required. Never compare
across projection versions; never fall back to the 16-hex hash for CAS.

---

## 4. Conflict states — single vocabulary

The A3 CAS vocabulary is used **verbatim** and is the only concurrency-conflict
vocabulary in this contract:

```
A3CasCategory = 'unavailable' | 'first_write' | 'no_expected' | 'match'
              | 'self_noop' | 'cosmetic_concurrent_edit' | 'analysis_affecting_conflict'
```

- First-match-wins in the A3 order (in that spirit); `self_noop` always precedes conflict
  categories and is never blocked.
- The category string is carried **unmapped** in `failure.cas` and in telemetry. No mirror
  reason codes, no renames, no CEE-local synonyms ("superseded", "diverged", "mismatch"
  are prose, not states — the legacy `decideProposedChangeSynthesis` status `superseded`
  is subsumed by `analysis_affecting_conflict` when this path replaces it for typed
  proposals).
- Proposal **lifecycle** conflicts (reject-after-apply, apply-after-reject, expiry) are
  NOT concurrency conflicts and deliberately do not reuse or extend the A3 set — they use
  `MutationReasonCode`s (`PROPOSAL_ALREADY_APPLIED`, `PROPOSAL_ALREADY_REJECTED`,
  `PROPOSAL_EXPIRED`). Two orthogonal axes, each with exactly one vocabulary.

---

## 5. Clarify-required and unsafe states

### 5.1 Where they come from

Both are referee-decided (plus the pre-referee fail-closed conditions listed in §2.4 A8).
The referee is re-run at Apply time against the **current** graph — the emit-time verdict
is advisory history, never trusted for the commit decision.

### 5.2 `clarify_required`

- Referee verdict `clarify_required` (ambiguous target, or `flag_uncertainty` /
  `clarification` kinds, which never mutate).
- Surfaces as a clarification turn: narration asks the specific question; chips offer the
  disambiguation options where derivable.
- The proposal **stays live** (not consumed) until answered or expired — clarify is a
  pause, not a verdict on the change itself.
- A proposal whose ops are ALL non-mutating (`mutation_class: 'non_mutating'`) can never
  reach `committed`; Apply on it is always `clarify_required`. Emit SHOULD not offer
  Apply/Reject chips for such records.

### 5.3 `unsafe` (fail-closed)

Triggers (all "the referee cannot validate ops against the current graph" or worse):

- referee `rejected`: schema/integrity failure (`SCHEMA_INVALID`, `ENTITY_NOT_FOUND`,
  `ENTITY_ID_COLLISION`, …), field-safety (`FIELD_NOT_ALLOWED`, `PIPELINE_OWNED_FIELD`,
  `ENGINE_CLAIM_IN_TEXT`), candidate build failure, readiness downgrade;
- frame/graph unreadable (`FRAME_UNAVAILABLE`, `CURRENT_GRAPH_UNREADABLE`, CAS
  `unavailable`);
- record integrity violations (I3/I4), echo mismatch (`PROPOSAL_BASE_MISMATCH`),
  lifecycle conflicts routed here (A10, A13, A14).

Behaviour: **no write; the proposal is invalidated** (consumed with an invalidation
reason, reusing the existing `pending_action.invalidated` telemetry channel) so a poisoned
record cannot loop. The user is told no change was made and offered a fresh path
(re-propose / rephrase). `blocker.readable` strings follow Track 3's redaction contract —
fixed, redacted copy; never raw payload values, field names with user data, or engine
claims.

### 5.4 Held-posture blockers at Apply time (doctrine seam)

Track 3 holds kinds pending spine-policy §3b/§6 doctrine (`STRUCTURAL_APPLY_HELD`,
`TUNABLE_APPLY_HELD`, `REMOVE_UNCONFIRMED`). This contract splits blockers into two
classes — **the split is the contract; the class assignments below record today's
fail-closed posture and move only with doctrine sign-off (§8-D4):**

- **Confirmation-satisfiable:** `REMOVE_UNCONFIRMED` (its literal meaning is "destructive
  change needs explicit confirmation" — the user's Apply IS that confirmation), and
  `STRUCTURAL_APPLY_HELD` / `TUNABLE_APPLY_HELD` **once and only if** §3b/§6 doctrine
  ratifies confirm-to-apply for those classes. Until ratified they sit in the blocking
  class and Apply on them returns `unsafe` with honest "this change type can't be applied
  yet" narration — the contract is buildable and truthful in the interim.
- **System-blocking (never user-satisfiable):** everything else — integrity, field-safety,
  readiness, `ADD_OPTION_APPLY_UNWIRED` / `OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE` (a
  persist-contract gap no user click can fix), `GRAPH_OPTIONS_MALFORMED`,
  `CLASSIFY_FAILED`.

---

## 6. Durable-commit success/failure narration

### 6.1 The honest-narration rule (binding)

> Never say "applied / added / updated / changed / done" unless the durable commit
> succeeded — meaning `append_turn_atomic_v2` returned success AND the resulting graph is
> the persisted truth. Failure copy follows **persisted state**, not intent, not the
> candidate graph, not the request.

(Continuity with the standing memory rules: narration-follows-persisted-state and the
success-claim regex instructional set apply to every string this path emits.)

### 6.2 The six narration states (exact, closed set)

| State | Success-verb allowed? | Copy posture (composed at egress; examples indicative, not final strings) |
|---|---|---|
| `committed` | YES (past tense) | "Added the risk node and linked it to Launch delay." Idempotent replay variant must attribute correctly: "That's already been applied." — referencing the original commit, never implying this turn did it |
| `rejected` | NO | "OK — no change made. The suggestion is discarded." (mirrors today's dismissal copy) |
| `stale` | NO | "Your model has changed since I suggested this, so I haven't applied it. Want me to re-check against the current model?" + re-propose chip |
| `clarify_required` | NO | Ask the specific question; offer disambiguation chips; state explicitly that nothing was changed |
| `unsafe` | NO | "I couldn't safely make that change — nothing was modified." + redacted blocker readable + fresh-path chip |
| `commit_failed` | NO | "That change didn't save — your model is unchanged." Only after §6.3 verification; see the unknown-outcome rule below |

### 6.3 `commit_failed` verification rule

`commit_failed` is a claim about persisted state and must be **verified, not assumed**:

- RPC returned a typed failure (incl. write-time CAS conflict) → the writer is atomic, so
  "unchanged" is safe to assert → `commit_failed` (or `stale` when the failure is a CAS
  conflict category, per §3.2).
- RPC outcome **unknown** (timeout, transport loss): the narration must be
  uncertainty-honest — "I can't confirm whether that change saved; I'll check." — and MUST
  NOT claim either success or failure. The next turn re-derives from persisted state:
  ledger/`self_noop` resolves a silently-succeeded write into A2/A3 (idempotent success);
  a genuinely-failed write re-offers Apply. This is the no-op-paths-drop-nothing rule
  applied to writes: unknown ≠ failed ≠ succeeded.

### 6.4 Telemetry (non-user surface)

Every Apply/Reject emits one structured event carrying: `proposal_id`, state,
`idempotent_replay`, `cas` category (verbatim), referee verdict + blocker code, and on
commit the version_event_id + both resulting hashes. Redaction contract as Track 3
(codes and hashes, never payload values).

---

## 7. Dependencies

### 7.1 A3 CAS interface (expected-hash threading + future RPC v3) — HARD dependency

- This contract **consumes** the A3 seam exactly as planned in Group A §6: optional
  `expected_graph_identity_hash` threaded through `SessionTurnWrite` → `.rpc()`; CEE is
  the **sole hash authority** (SQL never computes hashes); comparison is persisted-first;
  CAS sits **outside** the `ON CONFLICT` idempotent-replay guard.
- D0 (observe, no migration) suffices to *build* this contract dark. **Enforce mode (or
  the D1/RPC-v3 form with `p_expected_graph_identity_hash` /
  `p_resulting_graph_identity_hash` + `scenarios.graph_identity_hash`) is required before
  Apply's guarantees are honest in production** — in observe mode a conflicted write would
  proceed, which this contract's semantics forbid. Gate: Apply's live enablement is
  therefore coupled to `CEE_GRAPH_IDENTITY_CAS_MODE = enforce` (or a per-path equivalent);
  shipping Apply against observe-mode CAS would be a silent CAS bypass and is prohibited.
- This contract adds NO new writer, no RPC change of its own, and never touches
  `store_draft_graph` (A4 posture: revoke then retire).

### 7.2 The shared envelope — stays CEE-local until the re-vendor decision

- `CandidateMutationEnvelopeV1`, `GraphProposalRecord v0`, `ProposalActionResult v0`, and
  the reason-code additions are **CEE-local** (`src/orchestrator-v5/graph-management/` +
  siblings). Promotion to `@talchain/schemas` is gated exactly as Group A §8: shape
  ratified → consumer skew resolved (UI 0.8.1 / PLoT 0.2.1 re-vendored) → fixture parity →
  owning lane authorised. No aliases, no hidden skew.
- Until then the UI-visible surface is chips + narration only (schema-skew hazard rule,
  §2.2 wire note). Typed-ops rendering in the UI (diff previews, per-op accept) is
  explicitly out of v0 scope and blocked on re-vendor.

### 7.3 Model Management version hook — seam defined, substrate open

Every durable Apply produces exactly one **version event**. The hook is a seam, not a
storage decision:

```ts
interface GraphVersionEvent {
  readonly event_version: 'graph_version_event.v0';
  readonly version_event_id: string;        // minted at commit time, ULID/UUID
  readonly scenario_id: string;
  readonly proposal_id: string;             // idempotency key: at most one event per proposal
  readonly turn_id: string;                 // the committing turn row
  readonly base_graph_identity_hash: string;      // 64-hex before
  readonly resulting_graph_identity_hash: string; // 64-hex after
  readonly ops_digest: string;              // sha256 over stableStringify(ops) — attributable without payload
  readonly op_kinds: readonly CandidateKind[];
  readonly actor: { readonly kind: 'user' | 'system'; readonly id?: string };
  readonly provenance_source: GraphProposalRecord['provenance']['source'];
  readonly committed_at_iso: string;
}

interface VersionEventSink {                 // the seam
  /** At-least-once; MUST be idempotent on proposal_id. MUST NOT block or fail
   *  the user-facing commit response (emit-after-commit; failures are
   *  telemetered and re-driven, never dropped silently). */
  emit(event: GraphVersionEvent): Promise<void>;
}
```

- **Deliberately NOT assumed:** whether the sink writes a dedicated versions table, derives
  versions from turn rows, or forwards to an external substrate (decision D3, §8). The
  event shape carries everything any of those substrates needs, so the substrate choice
  requires no contract rework.
- `self_noop` and idempotent replays emit **no** event (§3.3) — version history records
  changes, not confirmations.
- Ordering guarantee: events for one scenario are causally ordered by commit order
  (base→resulting hash chaining makes gaps/forks detectable by the consumer).

### 7.4 Existing-mechanism dependencies (reused, unchanged)

#340 pending-truth (liveness authority + `CONFIRMATION_EXPECTING_ACTION_TYPES`), the
carry-forward consume/supersede/stale rules in `commit.ts`, the proposal safety filter,
and the deterministic pre-route order (state-query → short-confirm → ordinal-select →
dismissal → LLM). The legacy `decideProposedChangeSynthesis` inline_patch path keeps
working for the three existing intents until typed proposals subsume it (migration is
Layer-3 sequencing, not contract).

---

## 8. One-page decision input (what forks on Paul's decisions)

Everything above is stable EXCEPT the following, which fork on the three standing
decisions (plus one named doctrine hold). Each fork is contained — no rework outside the
named seam.

**D1 — A3 CAS: approve enforce mode / D1 migration / RPC v3?**
- *If enforce (or RPC v3) approved:* Apply ships with honest strict-CAS semantics; §2.4
  A9's write-time conflict states become mechanically guaranteed; `commit.
  resulting_graph_identity_hash` is persisted (D1 column) rather than recomputed.
- *If held at observe:* the contract is still buildable **dark** (referee + lifecycle +
  narration testable end-to-end), but Apply MUST NOT go live — live Apply on observe-mode
  CAS = silent-overwrite risk = prohibited by this contract's own §7.1 gate. There is no
  degraded-mode variant on offer; that would be a CAS bypass.
- *Also forks:* whether `first_write` can ever be a permitted Apply outcome (v0 says no,
  §3.2) is an A3-interface question if A3's enforce semantics later allow expected-null
  first writes.

**D2 — Envelope promotion / re-vendor of `@talchain/schemas` (UI 0.8.1, PLoT 0.2.1):**
- *If re-vendor proceeds:* `ProposalActionResult` (and optionally the ops union) get
  promoted; the UI can render typed outcomes/diffs; the §2.2 "text+chips must suffice"
  constraint relaxes to "text+chips must remain correct".
- *If deferred:* everything stays CEE-local and chip-mediated — v0 is designed to be fully
  functional in this mode indefinitely. No contract change either way; only the wire
  surfacing widens.

**D3 — Model Management version substrate (dedicated table vs turn-derived vs external):**
- Forks only the `VersionEventSink` implementation and where `version_event_id` resolves
  for reads (restore/compare/timeline are downstream consumers, out of v0 scope).
- v0 requires one commitment regardless of substrate: the sink interface's at-least-once +
  idempotent-by-`proposal_id` semantics, and that a committed Apply is never narrated as
  committed while its event is knowingly unpersistable (telemetered re-drive, not silent
  drop). If Paul wants version events strictly-atomic with the commit (same transaction),
  that pushes toward the D1 migration/RPC-v3 shape and should be decided together with D1.

**D4 (named hold, not one of the three, but it gates scope) — spine-policy §3b/§6
doctrine (structural/tunable apply posture):**
- Until ratified, `STRUCTURAL_APPLY_HELD` / `TUNABLE_APPLY_HELD` remain system-blocking
  (§5.4): Apply can only ever commit kinds the doctrine has cleared (today, effectively
  the confirm-to-apply set proven on the legacy path, plus `rename_node` per Track 3's
  would-apply posture, plus `remove_*` via `REMOVE_UNCONFIRMED`-satisfied-by-Apply).
- Ratification moves codes between the two §5.4 classes — **zero envelope, response, or
  vocabulary changes**; that containment is deliberate and is the reason the class split
  exists.

**Explicitly NOT decisions (fixed by this contract):** single mutation envelope
(`CandidateMutationEnvelopeV1`); single conflict vocabulary (A3, verbatim); CAS is never
bypassed and never client-evaluated; Reject never rolls back; the six narration states;
honest-narration rule; `no_expected` leniency opt-out on this path.

---

*End of contract v0. Nothing in this document has been implemented; no repo file was
modified. Supersession note: if A3's landed vocabulary or Track 3's merged envelope drift
from what is cited here, this doc must be re-derived against the landed truth before
Layer-3 build starts (re-derive-dependent-claims rule).*
