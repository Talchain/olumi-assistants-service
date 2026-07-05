# Layer-1 architecture decisions memo — v0

**Date:** 2026-07-05 · **Status:** ALL THREE DECISIONS RESOLVED. D3 answered **A — login
first** (Model Management does not need durable guest-mode version history before the
required-login gate lands): **Branch A locked**. Layer 2 is OPEN in draft/do-not-merge
lanes; migrations are code-only until separately approved · **Scope:** the three
architectural forks named in the layered-acceleration directive.

*v0.1 (2026-07-05): ownership fork made explicit; D2 accepted with tolerance-retirement
caveat; backlog A/B added.*
*v0.2 (2026-07-05): D1 accepted; D3 direction recorded.*
*v0.3 (2026-07-05): D3 corrected to conditional decision with login-gate dependency and
two-branch rule; Layer-2 plan recorded.*
*v0.4 (2026-07-05): **D3 RESOLVED — Branch A** (login first). Layer 2 opened in
draft/do-not-merge lanes.*

| Decision | State (one line) | Supporting doc |
|---|---|---|
| 1. Model Management substrate | **ACCEPTED 2026-07-05**: new `model_versions` table + `scenarios.current_model_version_id` pointer; `scenario_snapshots` NOT extended | [model-management-substrate-decision-brief-v0.md](model-management-substrate-decision-brief-v0.md) |
| 2. Re-vendor timing | **ACCEPTED 2026-07-05**: keep primitives CEE-local; UI+PLoT → 0.13.1 as Layer 2; promote nothing this layer. Caveat: tolerance retirement = separate follow-up PR | [contract-drift-and-revendor-plan-v0.md](contract-drift-and-revendor-plan-v0.md) |
| 3. Ownership of version rows | **RESOLVED 2026-07-05 — Branch A (login first)**: `owner_user_id NOT NULL`, authenticated-owned durable `model_versions`; no guest sentinel / unguarded nullable owner / unowned service-role rows / A4-style exposure. Guest paths pre-login: lightest safe interim posture (no durable history · non-durable preview · "requires sign-in" messaging) | §4 of the substrate brief + resolution below |

The Apply/Reject service contract ([graph-management-apply-reject-contract-v0.md](graph-management-apply-reject-contract-v0.md))
is not itself a decision — it is the Layer-3 contract that consumes whatever is decided
here; its §8 enumerates exactly what forks on each decision.

---

## Decision 1 — Model Management substrate

**Recommendation: Option B — a new, CEE-owned, service-role-written `model_versions` table
plus one nullable `scenarios.current_model_version_id` pointer column.** Full-JSONB
snapshots; version identity = surrogate uuid (rows) ∘ per-scenario `version_number`
(ordering, RPC-assigned under row lock) ∘ Group A `graphIdentityHash` envelope
(content-address, stored with projection/normaliser version columns, deliberately not
unique — restores legitimately repeat hashes). Restore = new version, never rewrite
history. Journey/timeline rides the existing `scenarios.events` + `append_scenario_event`
plumbing the UI already renders.

**Rationale.** (1) The live graph writer is CEE **service-role**; `scenario_snapshots` is
structurally authenticated-JWT with `user_id NOT NULL REFERENCES auth.users` — extending it
(Option A) means loosening a DGAI-owned table's grants toward the exact shape A4 just
closed. (2) `scenario_snapshots` rows are per-analysis-run, write-only audit artifacts with
**zero read sites** in either repo — mixing deliberate user versions into that stream makes
"version N" permanently ambiguous. (3) Everything Model Management needs that exists
nowhere today (version_number, pointer, CAS, identity envelope, restore provenance) is
additive under any option — B gets it without surgery on live tables. Hybrid (C) inherits
A's problems for no saving.

**Implementation consequence.** One CEE migration (table + pointer column + 2–3
service-role RPCs — approval-gated as ever), CEE handlers for save/list/compare/restore, UI
consumes via CEE with the hash opaque (schema-skew hazard). Hard dependency: Group A's
`graph-identity.ts` lands (PR #343) — it supplies both the content identity and the CAS
evaluator; restore-with-CAS becomes Group A's first live consumer.

**Risk if wrong.** If B is over-engineering, the cost is one small extra table, easily
collapsed. The inverse error is worse: retrofitting ownership/ordering/pointer semantics
onto a DGAI-owned audit table whose writer keeps firing, with grant-loosening pressure on
the A4 seam. Residual B risks (version_number contention, hash-regime confusion, Group A
not merging) each have a named mitigation in the brief.

**Unblocks.** Layer-2 Model Management build; the first live Group-A consumer; a concrete
tenant-safe write-time-CAS precedent for the deferred Track-1/Track-3 apply-wiring; and the
`VersionEventSink` hook the Apply/Reject contract needs (its interface is
substrate-independent, so this decision does not block Layer-3 contract work).

**Status: ACCEPTED (Paul, 2026-07-05)** — new `model_versions` table +
`scenarios.current_model_version_id` pointer; `scenario_snapshots` is not extended.
Ownership semantics: Decision 3 **resolved as Branch A** (below). Both signed 2026-07-05;
the Layer-2 lane may **author the migration as code**, but **execution requires separate
Paul approval**.

---

## Decision 2 — Re-vendor timing

**Recommendation: keep all five CEE-local primitives CEE-local until Group A merges and the
A3 CAS interface freezes — and decouple the consumer re-vendor from that gate: re-vendor UI
and PLoT to 0.13.1 now (UI first, PLoT in parallel; olumi-schemas tags v0.13.1 first).
Promote nothing in this layer; promotion wave at 0.14.x after the freeze.**

**Rationale.** Promotion now would burn a published schemas version on unfrozen semantics
(the identity envelopes carry `projection_version`/`normaliser_version` fields A3 review
can still move) for types **no consumer imports today** (verified: zero references in UI or
PLoT source). Re-vendor, by contrast, is measured-cheap: PLoT's entire consumed module
surface is **byte-identical between 0.2.1 and 0.13.0** (empty git diff — its 11-version
drift lives wholly in subpaths it never touches), and the UI's 0.8.1→0.13.0 delta is
behaviour-preserving because its Phase-3 block tolerance splits by type-string before
validation.

**Implementation consequence.** Tag v0.13.1 (currently untagged — release-hygiene gap);
UI + PLoT re-vendor with mandatory runtime `safeParse` fixture gates at every hop (Zod
refinements are invisible to tsc); CEE optionally bumps 0.13.0→0.13.1; the quarantine
comment in `routing/types.ts` and graph-identity's "NOT promoted this slice" header remain
the authoritative promotion backlog. Rollback = one-line vendored-pin revert per repo.

**Risk if wrong.** Promote-too-early is the expensive failure (published-contract revision,
three-consumer coordination). Keep-local-too-long is cheap: the envelopes are already
contract-shaped (a lift, not a redesign) and post-re-vendor every consumer sits ≤1 minor
from head. The asymmetry strongly favours keep-local. Watch-item found during analysis:
the UI's `generateGraphHash` **includes labels** while CEE's analysis hash excludes them —
a real semantic freshness divergence the compatibility test plan pins with a fixture.

**Unblocks.** UI: typed Phase-3 blocks, generate flags, coaching types. PLoT: eligibility
for a typed enrichment contract closing the `z.record` seam. Platform: a clean 0.14.x
promotion wave with no silent-drop hazard; A3/A4 freeze the CAS interface without a
published-contract deadline.

**Status: ACCEPTED (Paul, 2026-07-05).** Keep new graph/data primitives CEE-local for now;
UI and PLoT re-vendor to 0.13.1 executes as **Layer 2** under full ceremony; promote nothing
in this layer. **Hard caveat, binding on the Layer-2 re-vendor brief:** the re-vendor PRs
stay package/lockfile/adoption-test focused — the UI Phase-3 tolerance layer is **not**
retired in the same PR as the re-vendor. Tolerance retirement is a separate follow-up, only
after runtime behaviour on 0.13.1 is proven.

---

## Decision 3 — Ownership of model/version rows (RESOLVED 2026-07-05 — Branch A)

**Resolution (Paul, 2026-07-05): A — login first.** Model Management does not need durable
guest-mode version history before the required-login gate lands. **Branch A is locked:**
- `owner_user_id NOT NULL`;
- authenticated-owned durable `model_versions`;
- no global guest sentinel;
- no unguarded nullable durable owner;
- no unowned service-role-written durable rows;
- no A4-style write exposure.

**Guest-mode paths before login lands — lightest safe interim posture:** no durable version
history; or non-durable preview-only behaviour; or clear "version history requires sign-in"
messaging if surfaced. (Implementation picks the lightest that fits each surface; none
create durable rows.)

D1+D3 are now both signed; the migration may be **authored as code** in the Layer-2 lane
but is **not executed** until separately approved.

The conditional framing that led here is kept below for the record.

### The conditional decision as recorded pre-resolution (for the record)

**The decision as recorded (Paul, 2026-07-05):**
- Durable Model Management v1 should use **authenticated ownership where possible**.
- Required login is expected soon, so we do not want to overbuild a permanent
  guest-version ownership system unnecessarily.
- **However, current scenarios are mostly guest/null-owner, so auth-only versioning would
  not support the current demo path.**
- **Before writing any migration or Layer-2 implementation, confirm whether Model
  Management needs to work before the login gate lands.** ← this confirmation is the single
  open input; D3 is not treated as resolved until it is answered.

**Implementation rule (two branches, binding):**

*Branch A — required login lands before Model Management v1 is demoed:*
- `owner_user_id NOT NULL`;
- authenticated durable model versions only;
- no global guest sentinel;
- no nullable unguarded owner;
- no unowned service-role-written durable rows.

*Branch B — Model Management must work before required login lands:*
- **stop and present one concrete guest-compatible model before implementation** (a
  proposal for approval, not a build);
- preferred temporary direction: **session-scoped and tenant-safe**;
- no global guest owner;
- no unguarded nullable owner;
- no A4-style unowned service-role-write exposure;
- must include cleanup/expiry and query-safety rules.

**D1 and D3 sign together. No migration is written until D3 is explicit** (i.e. the
login-gate question is answered and, if Branch B, the concrete guest-compatible model is
approved).

The analysis that produced the original fork is kept below for the record; Branch B's
starting material is Option 2 (session claim + expiry + promotion) and Option 3
(non-durable preview) below.

### The fork as analysed (for the record)

**One principle is fixed across all options: no unowned durable rows.** Rows with
`owner_user_id NULL` can never be scoped by RLS (`auth.uid() = NULL` never matches), are
touchable only by service-role, and accumulate with no claimant — that is the A4 shape
(service-role-written data whose only protection is "nothing else is granted") installed as
a table default rather than a one-off RPC bug. Every option below preserves this principle;
they differ in what guests get.

**Why this cannot be defaulted: current guest/null-owner scenario volume is high.** A
silent `owner_user_id NOT NULL` v1 means version history does not work on the current
guest-mode demo paths. That is a product trade-off, so the sign-off picks one of three
explicit postures — each stated with its guest outcome, demo-path expectation, tenant
safety, and A4 avoidance:

**Option 1 — authenticated-only v1, guest versions deferred.**
- *Guest/null-owner scenarios:* keep exactly today's behaviour — single live graph, no
  history; version-creation RPC returns a typed, recoverable "sign in to save versions"
  error.
- *Demo path:* version history does **not** work for guest demos until a later guest model
  ships. This is the cost being accepted, explicitly.
- *Tenant safety:* maximal — `NOT NULL` + owner-scoped RLS; nothing new to protect.
- *A4 avoidance:* no unowned rows can exist; no JWT-role write grants.

**Option 2 — guest-compatible ownership model now.**
- *Guest/null-owner scenarios:* durable version history from day one via the pre-designed
  protected mechanism (§4 of the brief): `guest_session_id` claim + CHECK constraint
  (exactly one owner kind, never both null), mandatory `expires_at` + scheduled cleanup,
  one-shot promotion-on-signup RPC (transacted with the matching `scenarios.user_id`
  promotion, which also lacks a path today).
- *Demo path:* version history works everywhere, including guest demos.
- *Tenant safety:* guest rows are never directly readable by `anon`/`authenticated` (no
  policy can scope them); all guest access is CEE-mediated, with CEE binding the session id
  from its own validated state — never a client-supplied id.
- *A4 avoidance:* rows can never be unowned-forever by constraint (expiry + exactly-one-
  owner-kind); the cost is carrying the session-claim machinery from v1.

**Option 3 — hybrid: durable authenticated versions + non-durable guest preview.**
- *Guest/null-owner scenarios:* guests get session-scoped, non-durable preview versions
  (ephemeral, never written to `model_versions`) — the version UX exists, persistence does
  not; sign-in prompt to keep history.
- *Demo path:* version history *appears* to work in guest demos within a session; it does
  not survive the session.
- *Tenant safety / A4 avoidance:* identical to Option 1 for durable rows (no durable guest
  rows exist at all); preview state needs no DB protection.
- *Cost:* two version code paths (durable + preview) and honest-copy care so preview is
  never narrated as saved.

**Protection checklist (A4 applied, binding for the whole feature):** ENABLE + FORCE RLS;
owner-only SELECT policy; no JWT-role write policies; every RPC `SECURITY DEFINER` +
pinned search_path + **explicit** `REVOKE FROM PUBLIC, anon, authenticated` (Supabase
default privileges auto-grant on new public functions, so the revokes are load-bearing);
grant-layer verification against the **live database** (`pg_proc`/`proacl`), not migration
filenames — the method that caught A4.

**Risk if wrong.** Too strict (Option 1 chosen when guest demos matter) → the demo path
visibly lacks version history — recoverable, but a product regression against expectations,
which is exactly why this is not defaulted. Too loose → unscopeable durable rows and a
repeat of the A4 remediation on a bigger surface. Option 2 carries machinery cost; Option 3
carries dual-path cost. All three are reversible at different prices; unowned-forever rows
are the only unrecoverable shape, and no option permits them.

**Unblocks.** Lets the Decision-1 migration be written with final ownership semantics (no
retrofit), and gives Apply/Reject's version-event hook a tenant-safe target.

---

## Tracked backlog items (from the drift analysis — NOT for #343/#344/#345/#346)

Follow-ups logged here so they are owned, not implemented in any current lane without
separate authorisation.

**A. Server-authoritative freshness (correctness issue).** The UI and CEE disagree on
freshness semantics today: UI-local `generateGraphHash` **includes** labels; CEE
`computeAnalysisAffectingGraphHash` **excludes** them — a label-only edit can read stale in
the UI and fresh in CEE. Direction: server-authoritative freshness; retire or replace the
UI-local freshness hash. Until that lands, the compatibility-plan canary test pinning the
current divergence stays in place.

**B. Complete `__proto__` canonicaliser hardening.** Group A hardened CEE
`stableStringify` with null-prototype accumulators; the same hardening should later be
applied to CEE `src/utils/response-hash.ts` and the UI canonical hash implementation. Small
follow-up hardening task; not bundled into #343/#344/#345/#346 unless explicitly
authorised.

---

## Interactions & sequencing (read once before deciding)

- **1 → Group A:** the substrate build consumes `graphIdentityHash` + CAS evaluator; PR
  #343 merging (or a cherry-pick) precedes the Layer-2 migration.
- **1 ↔ 3:** the ownership decision sets columns/constraints in the same migration —
  decide together, write once.
- **Apply/Reject gate:** the contract prohibits live Apply while CAS is observe-only
  (silent-overwrite risk); everything except go-live is buildable dark. If Paul wants
  version events strictly atomic with the Apply commit, that pushes toward the RPC-v3
  shape and should be weighed alongside CAS-enforcement approval (contract §8 D1/D3).
- **2 is independent:** nothing in 0.13.1 relates to Group A; the UI/PLoT re-vendor can
  start any time (it is Layer-2 execution work, separately approved).

## Current decision state (v0.4)

- **Decision 1: ACCEPTED** — `model_versions` + pointer; `scenario_snapshots` untouched.
- **Decision 2: ACCEPTED** — keep-local; UI+PLoT → 0.13.1 in Layer 2; tolerance retirement
  is a separate follow-up PR.
- **Decision 3: RESOLVED — Branch A (login first).** `owner_user_id NOT NULL`,
  authenticated-owned durable versions; lightest safe interim guest posture pre-login.
- **All three decisions signed. Layer 2 is OPEN** in draft/do-not-merge lanes; migrations
  are authored as code only and are not executed until separately approved.

## Layer-2 parallel plan (OPEN as of 2026-07-05, draft/do-not-merge lanes)

1. Model Management v1 implementation (D1 substrate + D3 Branch A; **migrations as code
   only until approved**).
2. UI re-vendor to `@talchain/schemas` 0.13.1 (full review — consumer-facing; tolerance
   layer untouched per the D2 caveat).
3. PLoT re-vendor to `@talchain/schemas` 0.13.1 (full review).
4. Assurance extension from #345 (harness remains the sole fixture/test owner).
5. Small hardening follow-up: `__proto__` canonicaliser fix for CEE `response-hash.ts` and
   the UI canonical hash (backlog item B).
6. Server-authoritative freshness follow-up, scoped separately (backlog item A).

**Apply/Reject stays Layer 3:** no durable Apply/Reject work until CAS observe-mode and the
Model Management/version hooks are stable.

**Standing gates:** #346 review/merge is separate; staging `CEE_V5_GRAPH_CAS_MODE=observe`
flip requires Paul approval; any Model Management migration requires Paul approval; no
deploy, live SQL, migration execution, schema promotion, prompt upload, CAS enforcement, or
production flag flip without Paul approval.
