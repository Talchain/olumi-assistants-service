# T4 Spine Policy v1 — freshness sections FILLED (Paul-approved draft defaults, 2026-07-03)

**Status:** the freshness cluster (§1–§5 below) is filled from Paul-approved draft
defaults, each labelled with its provenance: **VERIFIED RESTATEMENT** (restates
shipped behaviour — source cited), **NEW PoC DECISION** (Paul-approved draft, no
shipped precedent), or **APPROVED FALLBACK** (the original vessel rule). Sections
§6–§8 remain **PENDING** — no defaults were supplied for them; they gate Slice 4+
surfaces, not Slice 3. This file remains docs-only: no loader, no consumer, no
flag reads it yet.

## The global rule (in force since the shell)

> **When freshness or authority is unknown, hold/refuse rather than apply or
> claim.** — APPROVED FALLBACK.

## §1 Stale taxonomy

**1a. What counts as stale — VERIFIED RESTATEMENT.** Analysis is stale exactly
when the current analysis-affecting graph hash differs from the hash the
analysis was computed against (`reason: graph_hash_diverged`). Any structural or
value edit that changes the hash makes the prior analysis stale. **No
materiality judgement**: the system never decides an edit is too small to
matter (that would itself be a sensitivity claim). No age thresholds: staleness
is hash-relative, not time-relative.
*Source:* `src/orchestrator-v5/context/freshness.ts` `deriveAnalysisFreshness`
decision tree (no fact → `none`; missing fact hash or missing current hash →
`unknown`; match → `fresh`; differ → `stale`), plus the option-identity guard's
fail-closed downgrade to `stale` (`analysed_options_diverged`,
`CEE_OPTION_IDENTITY_FRESHNESS_GUARD`, #307).

**1b. Unknown or missing freshness — APPROVED FALLBACK.** `unknown` gates like
"no trustworthy analysis exists": do not apply, do not claim, do not present
analysis as current; offer a re-run. `unknown` is never rounded up to `fresh`
and never narrated as merely `stale` (which would claim knowledge of what
diverged). *Source for the verdict itself:* the same decision tree (#298
`unconfirmed`/`unknown` lineage).

**1c. Failed / absent / stale are distinct states — VERIFIED RESTATEMENT.**
Never upgrade one into another:
- **Failed** — acknowledge failure, say what is still possible, offer retry, do
  not speculate about cause. *Source:* per-cause recovery branches in
  `src/orchestrator-v5/compose/handler-failure-responses.ts` — e.g.
  `analysis_blocked` ("engine cannot answer" coaching + scenario-status chip)
  is deliberately distinct from `analysis_failed` (retry chip); pinned in
  `turn-executor-handler.test.ts`.
- **Absent** — pre-analysis behaviour, no findings language. *Source:*
  freshness verdict `none`; #302's typed `analysis_not_ready` recoverable.
- **Stale** — stale framing + re-run offer (§5). *Source:*
  `src/orchestrator-v5/tools/handlers/no-op-helpers.ts` judges currency BEFORE
  emptiness so post-edit projections are "labelled stale, not 'no analysis'".

## §1-supplement: Authority parity mismatch — NEW PoC DECISION

*(No exact heading existed in the shell; added here as a taxonomy supplement
and reported as such in the #328 update packet.)*
If the canonical analysis state and the freshness authority disagree on graph
hash, **fail closed: treat analysis as unavailable**, not as safely stale. Do
not narrate findings; do not claim to know which state is current (even "these
results are stale" would overclaim). Offer a re-run or structure-only help.
*Alignment:* this is the doctrine for the planned Increment-2b live-seam
cross-input parity invariant (`frame/build-frame.ts` header: single-derivation
parity is "a live-seam invariant enforced in Increment 2b, not here").

## §2 Trust boundary for stale state — NEW PoC DECISION

Stale numbers may appear **only inside explicitly stale-framed narration**
(§5). They must never be blended with current-state confidence, readiness,
recommendation, or commit language. If the user asks what to do **now**, stale
numbers do not ground the answer — a re-run does. *Precedent extended:* the
shipped caveat-before-any-figure trust contract
(`src/orchestrator-v5/tools/handlers/staleness-prefix.ts`) already forbids
figure-first stale prose; this section extends it to forbid blending
downstream of the caveat.

## §3 Apply / execution semantics

**3a. Re-run behaviour — VERIFIED RESTATEMENT.** Offer, never auto-run.
Staleness produces a re-run **offer**; a user request to see stale results gets
stale framing plus the offer, not automatic execution. *Source:* the rerun
affordance is chip-based throughout (`chip-generator.ts` post-mutation
"Run analysis again" rule; rerun chip keyed on the projection's staleness), and
no code path invokes `run_analysis` except routed user intent or an explicit
chip click — references outside routing/dispatch are readers
(context/readiness modules), not invokers.

**3b. Mutation apply semantics — PENDING.** When Olumi may say a change is
safe to apply, confirmation requirements, and any auto-apply posture are
Slice-4 doctrine (typed mutation referee, #323 contract). Until filled, the
global rule governs: hold.

## §4 Confidence language — PENDING, except one rule

The general permitted-wording doctrine for certainty/uncertainty remains a
held decision. The one rule in force (from §2): stale figures never carry
current-state confidence language. Nothing else in this file authorises any
confidence wording.

## §5 Stale-state user-facing behaviour

**5a. What the assistant may say — VERIFIED RESTATEMENT (wording), with the
no-speculation clause consistent with shipped honesty guards.** When stale
analysis is relevant, acknowledge staleness BEFORE presenting anything. The
canonical shipped wording (single source of truth — do not mint variants):

> "These results may be out of date because the model has changed since the
> last analysis."

Stale findings may be summarised only under that framing; a re-run must be
offered; the assistant must not speculate on how the changes will shift the
outcome. *Sources:* `staleness-prefix.ts` (`STALENESS_PREFIX` + the
caveat-first, code-enforced, idempotent trust contract);
`buildAnalysisStaleTemplate` (`no-op-helpers.ts`); no-speculation is consistent
with the shipped never-implies-flip honesty rule (#235) and the stale-safe
fallback copy that "does NOT promise usable state".
*Neil note (informal, non-blocking, per Paul):* "When the model has changed
since the last analysis, we show previous results clearly labelled as previous
rather than hiding them entirely. Any concern?" — shipped behaviour already
shows-with-caveat, so this flags an existing posture, not a new one.

**5b. When to flag staleness — PoC UX DECISION (partially precedented).** Flag
staleness only when relevant to the user's current action (asking about
results, requesting a brief, asking why, accepting an analysis-referencing
suggestion). Do not interrupt ordinary chat/editing/browsing;
**at most one staleness acknowledgement per turn**. *Partial precedent:* the
prefix applies only on explanation paths that read a stale projection (not on
edit/state-query paths), and its approved-openings idempotency already
enforces at-most-one caveat per response; the broader relevance cadence is the
new PoC part.

## §6 Structural-versus-tunable doctrine — PENDING (Paul/Neil; Slice-4 gate)

## §7 EVPI / VOI naming — PENDING (Paul/Neil)

## §8 Gate Zero relaxations — PENDING (#305 R2 + Neil/Jinghui certification pathway; `DEFAULT_CLAIM_PERMISSIONS` stays all-held)

## Consumption contract (structural sketch — unchanged)

Slice 3 consumes §1–§5 at the mutation-referee/freshness verdict seam per the
T4.0 contract (`./dual-model-typed-mutation-handoff-contract.md`); prose
surfaces continue to be governed by the existing egress gates. The referee's
default verdict remains **held** regardless of policy-file presence — absence
of policy is "unknown authority" under the global rule. No loader exists yet;
its design (typed module vs file parse, plus tests proving unknown/missing
policy resolves to held) is a Slice-3-open task against these filled sections.
