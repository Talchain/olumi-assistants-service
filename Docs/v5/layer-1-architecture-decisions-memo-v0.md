# Layer-1 architecture decisions memo — v0

**Date:** 2026-07-05 · **Status:** awaiting Paul's decisions · **Scope:** the three
architectural forks named in the layered-acceleration directive. One sitting, three
decisions. Supporting analysis lives in the three companion docs in this folder; each
decision below is self-contained enough to decide from.

| Decision | Recommendation (one line) | Supporting doc |
|---|---|---|
| 1. Model Management substrate | New `model_versions` table + `scenarios.current_model_version_id` pointer (Option B) | [model-management-substrate-decision-brief-v0.md](model-management-substrate-decision-brief-v0.md) |
| 2. Re-vendor timing | Keep primitives CEE-local until Group A + A3 freeze; **decouple**: re-vendor UI+PLoT to 0.13.1 now | [contract-drift-and-revendor-plan-v0.md](contract-drift-and-revendor-plan-v0.md) |
| 3. Ownership of version rows | `owner_user_id NOT NULL` in v1 (no unowned durable rows); guest support = pre-designed later decision | §4 of the substrate brief |

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

---

## Decision 3 — Ownership of model/version rows

**Recommendation: no unowned durable rows by default. v1 ships `owner_user_id NOT NULL`;
the RPC refuses version creation for guest scenarios with a typed, recoverable
"sign in to save versions" boundary error. Guests keep exactly today's behaviour (single
live graph, no history — they have no snapshots today either, so nothing regresses).**

**Rationale.** Rows with `owner_user_id NULL` can never be scoped by RLS
(`auth.uid() = NULL` never matches), are touchable only by service-role, and accumulate
with no claimant — that is the A4 shape (service-role-written data whose only protection is
"nothing else is granted") installed as a table default rather than a one-off RPC bug.

**If guest versions become a product requirement**, the brief pre-designs the explicit
model to approve then, not now: session-scoped claim (`guest_session_id` + CHECK constraint
so every row has exactly one owner kind), mandatory `expires_at` with scheduled cleanup,
one-shot promotion-on-signup RPC (transacted together with the matching `scenarios.user_id`
promotion, which also lacks a path today), and CEE-mediated access only — the trust
boundary is CEE binding the session id from its own validated state, never a
client-supplied id.

**Protection checklist (A4 applied, binding for the whole feature):** ENABLE + FORCE RLS;
owner-only SELECT policy; no JWT-role write policies; every RPC `SECURITY DEFINER` +
pinned search_path + **explicit** `REVOKE FROM PUBLIC, anon, authenticated` (Supabase
default privileges auto-grant on new public functions, so the revokes are load-bearing);
grant-layer verification against the **live database** (`pg_proc`/`proacl`), not migration
filenames — the method that caught A4.

**Risk if wrong.** Too strict → a sign-in prompt guests see when trying to save a version
(recoverable copy, no data loss). Too loose → unscopeable durable rows and a repeat of the
A4 remediation on a bigger surface. Strict is the reversible error.

**Unblocks.** Lets the Decision-1 migration be written with final ownership semantics (no
retrofit), and gives Apply/Reject's version-event hook a tenant-safe target.

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

## What a decision looks like

Three lines from Paul suffice, e.g.: "1: B approved. 2: keep-local + re-vendor now
approved. 3: NOT NULL v1 approved." Any modification names the section it changes; the
companion docs absorb the edit and Layer-2 planning starts from the amended memo.
