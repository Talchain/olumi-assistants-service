# Dual-model adversarial findings register

Findings from the quarantined production-system branch's adversarial pin suites
(`src/cee/dual-model/__tests__/adversarial-*.test.ts`,
`evidence-pointer.test.ts`). Each open finding is **pinned by a `FINDING:`-titled
test asserting today's behaviour** — a silent change trips CI. **F1 is now CLOSED**
(fixed on the live dual-draft path by #337, merged to staging); its pins were
inverted to assert the fix. The remaining findings are still open, each a separate
explicitly-approved lane. Severity is relative to the flag-ON path only (the MVP is
inert on staging/prod).

## F1 — Unbounded proposal text  ·  ✅ CLOSED by #337 (merged to staging)

WAS: `ProposalEnvelope` bounded nothing but `evidence_pointer >= 1` char and
`NodeV3` label/description were bare `z.string()`, so a **100KB node label
merged into the committed graph** and 100KB rationale/evidence_pointer /
10k-entry `uncertainty_drivers` were accepted.

FIX (#337, live dual-draft): `PROPOSAL_FIELD_CAPS` single source of truth in
`guards.ts` (node id 128, label 200, description 1000, uncertainty_drivers
12×120, evidence_pointer 300, rationale 500, question 500) enforced by
`findOversizedProposalField` in `mergeProposals` — run **before** the G14 scan
(so an unbounded `uncertainty_drivers` array is rejected in O(1) before the
`...spread`), new additive `proposal_field_too_large` code, **reject per
proposal, never truncate**, no whole-batch degrade; `MergeFailure`
reason/proposal_type length-bounded; JSON schema mirrors the caps as a first
fence. *Pin (this branch): the four inverted cases in `adversarial-proposals.test.ts`
now assert `proposal_field_too_large`. Authoritative coverage:
`src/cee/dual-draft/__tests__/proposal-size-caps.test.ts`.*

Residual follow-ups tracked as one "aggregate/serialized payload bounds" lane
(Codex-noted, non-blocking): no total serialized-graph byte cap; edge `from`/`to`
not length-capped (only matters if M1 emits an oversized node id); pre-truncation
allocation of a huge invalid `type` inside `safeParse` (live-path-mitigated by
M2 `maxTokens`).

## F2 — Envelope-level extra keys silently stripped (asymmetry)  ·  fix-with-F1

Unknown keys **inside** `delta.node`/`delta.edge` are rejected
(`forbidden_node_field`); unknown keys **on the envelope** (`priority`,
`apply_immediately`, `system_note`) are silently dropped and the proposal
applies. Hostile steering metadata is laundered rather than recorded as a
failure. *Pin: adversarial-proposals.test.ts.*
**Fix shape**: `.strict()` on `ProposalEnvelope` (→ `malformed_proposal`).

## F3 — G14 evasion set (claim scan misses)  ·  PMS/guards-lane decision

Pinned misses that merge end-to-end into canvas-visible labels: letter-spaced
`E V P I`; `60 percent likely` (no `%` symbol); `robust to assumptions` (only
`\brobustness\b`); `value of information` without "expected"; hyphenated
`sensitivity-analysis` in non-verb contexts; `the analysis suggests` (verb not
in shows|indicates|computed|will show); Cyrillic-Е homoglyph `ЕVPI`. Boundary
HITS also pinned (lowercase `evpi`, `flip-point`, `flippoints`, plural forms).
*Pin: adversarial-claims.test.ts.* Widening the live regex is a
guards-lane/prompt-doctrine decision — the M2 prompt should also instruct
against engine vocabulary so G14 stays the backstop, not the primary control.

## F4 — `serialise-graph-for-review` re-emits merged labels unescaped  ·  note for any 2nd-round design

One M2 call per turn today, so no live exposure. But a merged hostile label
appears **inline, unframed** in the serialisation (`- id | kind | label`); any
future second review round / LLM consumer of merged graphs would receive prior
injection text as prompt content. *Pin: adversarial-injection.test.ts.*
**Fix shape**: delimit/escape labels at serialisation time, or strip control
chars at merge time (see F5).

## F5 — Control/bidi/zero-width chars accepted in labels  ·  canvas + log hygiene

NUL, BEL, RTL-override and zero-width characters merge into committed labels
(bare `z.string()`), reaching the canvas and logs. RTL-override can visually
reverse rendered text. *Pin: adversarial-injection.test.ts.*
**Fix shape**: strip `\p{C}` (except \n\t) at the merge's text channels, or a
NodeV3-level refinement (broader blast radius — schema-owned decision).

## F6 — Whitespace/zero-width-only evidence pointers accepted  ·  HELD commit 12

`evidence_pointer: z.string().min(1)` — `' '`, `'\t\n'`, `'\u200B' (zero-width space)` all pass
and the proposal applies. *Pin: evidence-pointer.test.ts (FINDING cases).*
**Fix EXISTS on this branch but is NOT wired**: `isMeaningfulEvidencePointer`
(`src/cee/dual-model/evidence-pointer.ts`). Wiring = the held commit 12 —
separate Paul approval + its own Codex re-review (changes flag-ON behaviour;
maps to existing `malformed_proposal`).

## F7 — `router.ts` `getAdapter` docblock states a stale precedence order  ·  docs-only

The docblock lists providers.json config ABOVE `CEE_MODEL_*`; traced effective
order is per_call → store_model_config → env_var → task_default →
providers_json → llm_model_fallback (failover short-circuits as
`llm_model_fallback`). The m2 strict gate relies on env_var actually winning —
it does; only the comment is wrong. Not pinned by test (comment text); fix is
a one-line doc edit in a router-touching lane.

## Non-findings worth knowing (pinned as correct)

- Prototype-pollution-shaped keys (`__proto__`, `constructor` as own keys in
  `delta.node`) → `forbidden_node_field`; `Object.prototype` untouched.
- G14 runs BEFORE the D1 defer branch: claim-bearing option labels are
  rejected, never deferred into artifacts.
- In-batch duplicate/cycle checks run against the RUNNING graph (an edge
  applied earlier in the same batch participates) — no same-batch bypass.
- Injection strings are byte-preserved inert DATA through merge and artifact
  channels; template syntax is never interpolated.
- The review layer caps nothing (1000 proposals returned intact) and the merge
  caps exactly (8 applied max, 992× `proposal_cap_exceeded`, tally invariant
  holds) — accounting stays exact at scale.
- `enriched === false` ⇒ the returned graph is the input **by reference** for
  every runtime-reachable degrade reason (the dispatch byte-identity guarantee).
