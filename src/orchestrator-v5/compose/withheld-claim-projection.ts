/**
 * T1 claim safety — the STRUCTURED half. ROADMAP 1.218.
 *
 * WHAT THIS CLOSES. #708/#709/#710 gated the PROSE. The POST-#710 live walk
 * (staging `227e0aa`, `acceptance-evidence/g-cee-1-constraint-verdict/
 * WALK-2026-07-26-POST-710.md`) then measured what remained: on **5/5** withheld
 * bodies the same HTTP response that said *"no option can be put forward yet"*
 * still shipped, on the `analysis_result` block —
 *
 *   `enrichment.decision_brief.headline`         "… (Status Quo) currently leads, …"
 *   `enrichment.decision_brief.headline_banded`  `{ band: 'slightly_ahead',
 *                                                  leader_option_id: 'opt_status_quo' }`
 *   `enrichment.decision_review.*`               leader prose on 7+ sub-paths
 *   `leading_option_id`                          the leader's id, verbatim
 *
 * The claim was withheld in words and asserted in structure.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS IS NOT WIRE HYGIENE. IT IS RENDERED. The orchestrator's render probe
 * (UI `6d3f4611` / CEE `227e0aa`) photographed a withheld `unevaluated` turn
 * showing **"Standardise on MacBook Pro is slightly ahead."** as the hero
 * headline DIRECTLY BELOW the withheld disclosure, plus a "Leading option"
 * canvas badge — nine distinct leader surfaces, at counts identical to a
 * permitted run.
 *
 * `decision_brief.headline_banded` is the sharpest of the five: its `.text`
 * renders VERBATIM as that hero, and `normalizeHeadlineBanded()` consumes
 * `band` + `leader_option_id` + `robustness_gated` to set
 * `DecisionVerdict.hasLeadingOption` — the single boolean that module's own
 * docstring says every surface must gate on before asserting a leading option.
 * (`robustness_gated` is recorded and gates nothing.) CEE handed the UI the
 * producer-band licence to make the claim CEE had just declined to make.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT DROPPING `headline_banded` DOES AND DOES NOT DO — derived at the
 * deployed UI tip's bytes (`src/lib/decisionVerdict.ts@6d3f4611`), because
 * "it degrades gracefully" is a claim that has to be checked, not assumed:
 *
 *   DOES: `normalizeHeadlineBanded(undefined)` returns `null` at its FIRST
 *     guard (`typeof raw !== 'object'`), so `bandApplies` is false and the
 *     band authority never fires. No crash, no partial read — the same
 *     no-leader shape the panel's own unused `noClearLeader` copy exists for.
 *     And the verbatim hero string is gone with the field that carried it.
 *   DOES NOT: make `hasLeadingOption` false. With no band and no producer
 *     near-tie, the ladder falls to **Authority 3**, which DERIVES separation
 *     from `win_probabilities` alone (`source: 'win_probability'`). On the live
 *     `case1.run` body the gap is 0.567 − 0.221 = 0.346 ⇒ `clear` ⇒
 *     `hasLeadingOption: true`.
 *
 * So this module stops CEE ASSERTING a leader. It does not stop the UI
 * DERIVING one from the simulation's own numbers, and it was never going to:
 * those numbers are computed facts the disclosure explicitly invites the user
 * to act on, and they ship on `win_probabilities` / `option_comparison`
 * regardless. "The UI renders, never derives" is the next slice and belongs in
 * the UI repo. Stating it here so nobody reads a green CEE gate as a quiet
 * screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY DROP AND NOT REWRITE — and why that is *mirroring* #707, not departing
 * from it.
 *
 * The honest withheld copy for this turn ALREADY EXISTS and already reaches the
 * user: `coaching/constraint-gap-disclosure.ts` composes it into the summary,
 * which rides BOTH `assistant_text` AND `blocks[].summary` — the very same
 * block that carries `decision_brief`. Synthesising a second CEE-authored
 * withheld sentence into `decision_brief.headline` would put two different
 * accounts of one fact on one screen, which is precisely the reason
 * `buildConstraintDisclosure` returns `''` on `evaluated_infeasible`
 * ("Emitting a second, blunter sentence here would put two different accounts
 * of the same fact on one screen"). So the #707 convention, applied honestly
 * here, says: say it ONCE, in the slot that owns it, and remove the
 * contradicting artefacts.
 *
 * And a synthesised `headline_banded` would have to invent a band literal
 * (`'withheld'`) that no verified UI reader handles. ABSENCE, by contrast, is a
 * shape this exact field is PROVEN to tolerate on this exact wire: the key was
 * stripped by the safe-transport keep-list for the whole of its life until
 * @talchain/schemas 0.19.0 (see the `decision_brief` entry in
 * `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` — "the UI consumer shipped
 * contract-pinned and has been dark ever since because this one key was
 * stripped"). Dropping returns the field to a shape the consumer already
 * survived; inventing a literal does not.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY `decision_review` GOES WHOLE AND `decision_brief` DOES NOT — derived from
 * the bytes, not chosen. Walking every string in both blobs across all TEN
 * scored bodies of the POST-#710 archive with the egress guard's own pattern
 * set, the leader claims land at:
 *
 *   decision_review . narrative_summary                                (5/5 W)
 *                   . story_headlines.<option_id>                      (2/5 W)
 *                   . robustness_explanation.summary                   (3/5 W)
 *                   . robustness_explanation.fragility_factors[]       (2/5 W)
 *                   . decision_quality_prompts[].applies_because       (3/5 W)
 *                   . evidence_enhancements.<factor_id>.specific_action(1/5 W)
 *                   . scenario_contexts.<edge>.trigger_description     (P only)
 *   decision_brief  . headline                                         (5/5 W)
 *                   . headline_banded.text                             (5/5 W)
 *                   . robustness_caveat.text                           (5/5 W)
 *
 * `decision_review` is LLM-authored prose, end to end, under DYNAMIC keys
 * (option ids, factor ids, edge ids). A field allow-list over it is exactly the
 * hand-maintained mirror CLAUDE.md trap #12 is about — it would drift the first
 * time the prompt grew a field. compose.ts already drops the Phase-3 CARDS
 * built from this blob WHOLE on a withheld turn, for the stated reason that
 * "there is no template to gate and no substitution that can make that prose
 * honest". This is the same decision applied to the same content one layer
 * down.
 *
 * `decision_brief` is PLoT-computed STRUCTURE with three prose members. Its
 * remaining twelve members (`top_drivers`, `key_assumptions`,
 * `what_would_change`, `warnings`, `analysis_summary`, `defaulted_assumptions`,
 * `options`, …) carry no comparative claim and are exactly the content a user
 * needs MOST on the turn where a recommendation is being withheld. Dropping it
 * whole would be over-suppression — the failure the acceptance criteria weight
 * equally with the leak.
 *
 * THE THREE-MEMBER SET IS A MIRROR, AND IT IS GUARDED. Per trap #12 a mirror
 * must fail loud on drift rather than assume-good: a NEW leader-claiming member
 * of `decision_brief` is caught by the egress guard, which (same PR) deep-scans
 * both blobs on withheld turns and raises `v5.invariant_violation` naming the
 * exact path. The alarm is the drift detector; this list is not trusted to stay
 * complete on its own.
 *
 * NOT IN SCOPE, stated rather than silently decided: `decision_brief.options[]`
 * keeps its `rank: 1|2|3`. Suppressing an ordering while the same block ships
 * `win_probabilities` and `option_comparison` (neither flagged by the walk, both
 * carrying the identical ordering) would be theatre, not a gate. The verdict
 * withholds NAMING a leading option as the answer; it does not withhold the
 * simulation's numbers, which the disclosure explicitly invites the user to act
 * on.
 *
 * PURE. Never throws, never mutates its input, and returns a new record.
 */

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { readMayNameLeadingOptionFromResult } from '../../orchestrator/context/constraint-feasibility.js';

/**
 * Enrichment blobs dropped WHOLE from the wire on a withheld turn: prose
 * authored end-to-end on the premise that a leader may be named, under dynamic
 * keys no allow-list can track. See the module docstring for the derivation.
 */
export const WITHHELD_DROPPED_ENRICHMENT_BLOBS: readonly string[] = Object.freeze([
  'decision_review',
]);

/**
 * The leader-ranking members of `decision_brief`, dropped on a withheld turn
 * while the rest of the brief ships. Derived from a complete walk of all ten
 * POST-#710 bodies (module docstring); drift is caught by the egress guard, not
 * by this list.
 */
export const WITHHELD_DROPPED_DECISION_BRIEF_MEMBERS: readonly string[] = Object.freeze([
  // "Defer and Keep Current Machines (Status Quo) currently leads, …"
  'headline',
  // { band: 'slightly_ahead', leader_option_id, leader_label, runner_up_* } —
  // the UI's leader-entitlement grant.
  'headline_banded',
  // "…small changes to assumptions could change which option leads."
  'robustness_caveat',
]);

/**
 * May THIS analysis fact's turn name a leading option?
 *
 * Reads the ONE persisted verdict the run_analysis handler wrote, never
 * re-derives it — two derivations over different inputs are how one HTTP
 * response ends up contradicting itself (CLAUDE.md trap #12). Typed
 * `result.constraint_verdict` first (schemas 0.25.0), the interim
 * `enrichment.__cee_claim_safety` stamp second (facts persisted between #710
 * and that release), FAILS CLOSED on neither — see
 * `readMayNameLeadingOptionFromResult` for why "unknown" must not read as
 * "verified".
 */
export function mayNameLeadingOptionForFact(fact: RunAnalysisHandlerFact): boolean {
  return readMayNameLeadingOptionFromResult(fact.result);
}

/**
 * Project the ALREADY safe-transport-projected enrichment for a turn whose
 * verdict withholds the leading-option claim.
 *
 * Composed with `toSafeTransportEnrichment` rather than folded into it: that
 * function is the transport keep-list (a cross-repo contract pinned
 * element-for-element against `@talchain/schemas`' `CEE_UI_ENRICHMENT_KEEP_LIST`
 * by `tests/contract/cee-to-ui.contract.test.ts`), and claim-permission is a
 * different axis from transport-cleanliness (`compose/claim-safety-cage.ts`
 * §"Two orthogonal axes"). Keeping them separate means this gate cannot silently
 * shrink the keep-list.
 *
 * Returns `undefined` when nothing survives, so the block omits `enrichment`
 * entirely — the shape it already has on chip-click / autofire-off turns.
 */
export function projectTransportEnrichmentForWithheldClaim(
  transport: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (transport === undefined) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(transport)) {
    if (WITHHELD_DROPPED_ENRICHMENT_BLOBS.includes(key)) continue;
    if (key === 'decision_brief') {
      const brief = projectDecisionBriefForWithheldClaim(value);
      if (brief !== undefined) out[key] = brief;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Drop the leader-ranking members of one `decision_brief`, keeping everything
 * else verbatim. A non-object brief (never seen on the live wire, but this is
 * an untyped `z.record` passthrough — parent CLAUDE.md hazard 2) is dropped
 * whole rather than trusted: we cannot show what we cannot inspect.
 */
function projectDecisionBriefForWithheldClaim(brief: unknown): Record<string, unknown> | undefined {
  if (brief === null || typeof brief !== 'object' || Array.isArray(brief)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(brief as Record<string, unknown>)) {
    if (WITHHELD_DROPPED_DECISION_BRIEF_MEMBERS.includes(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
