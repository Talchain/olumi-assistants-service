# Codex review pack — proposal size-guard fix (F1, MVP-path)

**Review required before merge.** This diff changes live MVP-activation-path
validation (the flag-ON dual-draft merge). Do not merge without Codex clearance.

## Exact diff under review
- Branch: `claude/v6-dual-draft-proposal-size-guards`
- Base: `origin/staging` @ `f2998df02` (#329)
- Range: `git diff f2998df02..HEAD` (branch head SHA in
  `proposal-size-guards-proof.md`)
- Scope: **3 live source files** (`guards.ts`, `merge.ts`,
  `proposal-json-schema.ts`) + 3 test files + these docs. No schema (`cee-v3.ts`),
  config, env, flag, migration, or cross-service change.

## Changes since the first review (v2 — Codex round 1 addressed)
- **BLOCKER fixed**: `findOversizedProposalField` now runs **before** the G14
  claim scan (`merge.ts`). G14 spreads `uncertainty_drivers` as call args
  (`...rawDrivers`); on an unbounded array that is O(n) / can throw RangeError on
  the spread, and a throw collapses the whole batch to M1 (`internal_error`). The
  size guard's item-count cap short-circuits in O(1) before any iteration, so a
  huge array is now rejected per-proposal — pinned by a 1,000,000-element test
  (no throw, ~40ms, valid sibling still applies).
- **Point 5**: `MergeFailure.reason` AND `.proposal_type` are bounded at the
  single `fail()` chokepoint (`MERGE_REASON_MAX_CHARS=300`) so an unbounded
  invalid `type` / edge `from→to` cannot enter failure metadata. Pinned.
- **Point 4**: guard docstring documents the UTF-16 `String.length` semantics and
  states this is not a total-serialised-graph byte cap (a separate PLoT-boundary
  concern — explicit non-goal).
- **Point 3**: the committed `.diff` artifact (which tripped `git diff --check` on
  trailing whitespace) was removed; obtain the diff from the range above.

## What changed and why
F1: the dual-draft merge applied **unbounded** proposal text — proven against the
live path, a 100KB `added_risk` node label merged into the committed, persisted,
canvas-rendered graph (100KB rationale/evidence_pointer into DeferArtifacts; 10k
`uncertainty_drivers` accepted). Now an MVP activation blocker.

| File | Change |
|---|---|
| `src/cee/dual-draft/guards.ts` | NEW `PROPOSAL_FIELD_CAPS` (single source of truth) + `findOversizedProposalField` (pure; reads raw fields defensively). |
| `src/cee/dual-draft/merge.ts` | NEW `MergeFailureCode` member `proposal_field_too_large`; call the guard **before** the G14 claim scan (so an unbounded `uncertainty_drivers` array is rejected in O(1) before G14 spreads it), reject per-proposal. |
| `src/cee/dual-draft/proposal-json-schema.ts` | Mirror the caps as `maxLength`/`maxItems` **from the const** (model-facing first fence only). |
| tests (3) | guard unit block; size-caps proof suite; schema↔const lockstep. |

## Caps (Paul-approved starting defaults, one SSOT — `PROPOSAL_FIELD_CAPS`)
node id 128 · label 200 · description 1000 · uncertainty_drivers 12 items × 120
chars · evidence_pointer 300 · rationale 500 · artifact question 500. Edges carry
no free text (from/to are ids already bound by the endpoint-existence guard).

## Design decisions to scrutinise
1. **Enforcement point = the merge, not the schema.** The JSON schema `maxLength`
   is a *first fence* the model may ignore; `findOversizedProposalField` in the
   deterministic merge is authoritative. Both read `PROPOSAL_FIELD_CAPS`; the
   lockstep test fails if they drift. (Verify: could any path reach node
   commitment without passing the guard? The guard runs before G14 and before the
   artifact/option/node branches, covering every text channel; edges have no text.)
2. **Reject, never truncate** — consistent with G10/G14 ("proposals are advisory,
   rejected not clamped"). A truncated label would silently alter M2's committed
   content.
3. **Per-proposal reject via a new additive `MergeFailureCode`**, NOT whole-M2→M1
   degrade. One oversized proposal cannot collapse valid siblings; whole-batch
   degrade stays reserved for post-merge safety trips
   (`post_merge_invalid`/`option_surface_changed`/`readiness_downgrade`). (Verify:
   the exact-one-bucket tally invariant still holds — pinned by the suite.)
4. **NOT touching `src/schemas/cee-v3.ts` `NodeV3`.** Capping shared `NodeV3.label`
   would hit M1 draft / edit_graph / the PLoT boundary (large blast radius). The
   cap is proposal-specific and lives in the dual-draft layer, like the existing
   allowlist/numeric guards that are already stricter than NodeV3. (Confirm this is
   the right layering call.)
5. **NOT adding `.max()` to the zod `ProposalEnvelope`** — keeps the envelope
   shape-only so every oversized field funnels through ONE guard and ONE code
   rather than splitting evidence_pointer/rationale into `malformed_proposal`.
6. **Ordering vs G14**: the size guard now runs **before** G14 (safety: bound
   before scan/spread — see "Changes since first review"). Consequence: a field
   that is both oversized and claim-bearing rejects as `proposal_field_too_large`
   rather than `engine_boundary_violation`. Acceptable (both correct; the cheap
   bounded check first also avoids regex over oversized text) — flag if you
   disagree. Note edge `from`/`to` are intentionally NOT length-capped (they must
   match an existing node id to have any effect; a huge non-matching endpoint is
   rejected `edge_endpoint_missing` with a now-bounded reason).

## Test evidence
- `proposal-size-caps.test.ts` (20): 100KB label rejected + absent from committed
  graph + valid sibling still applies + post-merge scan finds no over-cap label;
  every channel rejects; boundary at-cap applies / +1 rejects; oversized artifact
  never becomes a DeferArtifact; mixed batch not collapsed (tally invariant);
  **1,000,000-element uncertainty_drivers rejected without throwing while a valid
  sibling applies (ordering fix)**; bounded reason for a huge edge endpoint;
  bounded reason + proposal_type for a huge invalid type.
- `guards.test.ts` (+9): `findOversizedProposalField` unit matrix incl. defensive
  raw-field reads and an injectable cap object.
- `serialise-and-schema.test.ts` (+1): schema `maxLength`/`maxItems` == `PROPOSAL_FIELD_CAPS`.
- Gates at tip: `typecheck` + `typecheck:src` clean; zero new full-tsc drift in
  changed files; `pnpm test:required` 885 files / 17,975 green; flag-OFF proof
  (`dispatch-flag-off` + `phase4-dispatch-compat`) 20/20 identical to baseline;
  full advisory suite failing-set identical to base (see
  `proposal-size-guards-proof.md`).

## Known residuals — tracked follow-up: aggregate / serialized payload bounds
Out of scope for this per-field fix (Codex round 2 rated all as non-blocking); a
single future lane per the reviewer's framing. None affects normal M2 output,
which is `maxTokens`-bounded (~4k tokens):
1. **No total serialized-graph byte cap.** Per-field caps + `PROPOSAL_CAP` + graph
   node/edge caps bound aggregate growth within a constant factor, but there is no
   single graph-level byte ceiling. That belongs at the PLoT boundary, not here.
2. **Edge `from`/`to` are intentionally not length-capped.** They must match an
   existing node id to have effect, so a huge non-matching endpoint is rejected
   `edge_endpoint_missing` (with a now-bounded reason). Residual: if M1 ever
   emitted an oversized node id, M2 could add an edge duplicating that id. Low
   likelihood (our own M1 pipeline does not emit oversized ids); a node-id byte
   bound at graph production would close it.
3. **Pre-truncation allocation in `ProposalEnvelope.safeParse`.** A malformed
   huge `type` makes zod's enum error embed the value before `fail()` truncates
   it — one transient, bounded-by-input, freed-per-turn allocation (≤ `PROPOSAL_CAP`
   of them). Mitigated on the live path by `maxTokens`; a cheap pre-parse
   type-length reject would eliminate it if this lane is taken.

## Rollback
Revert the feat/fix commits on the branch (`5e222a5fa`, `7484c38bb`, `2960fb106`).
No env/flag/migration to undo — the change is code-only and flag-ON-path.

## Downstream coupling (must sequence after merge)
Once this lands on staging and PR #330 (the quarantined dual-model branch)
rebases, #330's F1 "FINDING: 100KB node label … APPLIED" pins
(`adversarial-proposals.test.ts`) will fail — they assert the now-fixed buggy
behaviour. #330's rebase must invert those pins to assert
`proposal_field_too_large` and update the F1 entry in
`dual-model-adversarial-findings.md`.
