/**
 * V5 Coaching Context Pack v1 — deterministic output post-check.
 *
 * This is the HARD enforcement of the lane's core boundary: deterministic code
 * owns truth; the LLM only expresses it. The flag-gated prompt instruction
 * (route-with-tool-use.ts) is soft guidance — this module is the guarantee.
 *
 * It inspects LLM-authored coaching prose (the `coach` / `text_only`→converse
 * compose branches) against the SAME canonical `CoachingStatePack` the prompt
 * received, and reports a {@link CoachingViolation} when the prose crosses the
 * boundary. The caller degrades to a deterministic safe response
 * ({@link buildCoachingDegradeResponse}) — it never rewrites the model's prose
 * into something that merely pretends to be safe.
 *
 * ## The most important firing case
 *
 * Not the literal word "fresh". The dangerous output is confident DIRECTIONAL
 * or SUPERLATIVE advice issued while the deterministic state is stale / unknown
 * / absent / blocked / unusable — "you should choose X", "X is the best
 * option", "go with X", "X remains the winner" — even when the prose never
 * claims the analysis is fresh. {@link checkCoachingOutput} gates that case on
 * `stateUnsafe`, independent of any freshness wording. When the state IS fresh
 * and usable, directional advice is allowed — normal coaching is never degraded.
 *
 * ## Boundaries respected
 *
 *   - Value/unit: the pack carries NO values, and #296 owns value/unit
 *     resolution. This module only DETECTS unsafe raw value/unit narration
 *     (currency / explicit units — the #296 "£0.3" mutation-value shape) and
 *     degrades; it never formats, normalises or interprets a value.
 *   - Claim-safety (evidence / confidence / provenance / bias / science): no
 *     such field exists in the pack (Tier-3 claim-safety contract is future
 *     work), so any such claim in coaching prose is unsupported by construction.
 *
 * Pure: no I/O, no telemetry (the caller emits `v5.coaching.output_postcheck`),
 * no config read (the caller gates on the flag). Mirrors the
 * `applyEgressForbiddenPhraseGuard` shape.
 */

import type { CoachingStatePack } from '../context/canonical-analysis-state.js';
import {
  buildAnalysisAbsentTemplate,
  buildAnalysisDegradedTemplate,
  buildAnalysisStaleTemplate,
  buildAnalysisUnconfirmedTemplate,
} from '../tools/handlers/no-op-helpers.js';
import {
  RERUN_ACTION,
  type StaleRerunSuggestedAction,
} from '../routing/stale-rerun-guard.js';

/** Closed set of coaching-output boundary violations. Telemetry-safe enum. */
export type CoachingViolation =
  | 'internal_field_exposed'
  | 'invented_mutation_success'
  | 'value_change_narration'
  | 'unsupported_evidence_or_confidence_claim'
  | 'confident_advice_under_unsafe_state'
  | 'stale_presented_as_fresh';

export interface CoachingPostcheckResult {
  readonly safe: boolean;
  /** Present iff `safe === false`. The first matched rule, in severity order. */
  readonly violation?: CoachingViolation;
}

/**
 * Internal / debug field exposure — NARROW on purpose. The product's
 * `findEditInternalsHit` bars bare decision words ("graph", "node", "edge",
 * "path", "option") because its caller (the edit no-op preservation gate) pays
 * nothing for a false positive. Here a false positive degrades a whole coaching
 * answer, and legitimate coaching says "your decision model" / "the options" /
 * "this factor". So we detect only the genuinely-internal shapes: long hex
 * digests (graph hashes), snake_case identifiers (`fac_price`, `graph_hash`,
 * `fact_type`, `rerun_required`), dotted internal paths (`node.id`), raw edge
 * arrows (`a->b`), and hard pipeline jargon.
 */
const INTERNAL_EXPOSURE_PATTERNS: readonly RegExp[] = [
  // Long hex digest with at least one a–f letter (so pure decimal numbers — a
  // separate value concern — do not trip this leak rule).
  /\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/i,
  // snake_case internal identifier / field name (≥1 underscore, word-ish parts).
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/i,
  // Dotted internal path — ≥2 chars each side so "e.g."/"i.e."/sentence ends miss.
  /\b[a-z_]{2,}\.[a-z_]{2,}\b/i,
  // Raw ASCII edge arrow.
  /->/,
  // Hard pipeline / debug jargon.
  /\b(?:handler|schema|validator|dispatcher|orchestrator|zod|tool[_ ]?call|context[_ ]?pack|fact[_ ]?type|graph[_ ]?hash|analysis[_ ]?status|raw[_ ]?value|json)\b/i,
];

function hasInternalExposure(text: string): boolean {
  return INTERNAL_EXPOSURE_PATTERNS.some((re) => re.test(text));
}

/**
 * Graph / model mutation OBJECTS — the nouns a real mutation claim acts on.
 * Used (with a determiner) to disambiguate genuine mutation-success claims from
 * ordinary coaching that happens to use a completion verb on a non-graph noun
 * ("I've created a summary", "Created a comparison of your options").
 */
const GRAPH_MUTATION_OBJECT =
  '(?:graph|model|factor|option|constraint|edge|node|link|weight|driver|assumption|parameter|value|scenario)s?';

/** Past/perfective completion verbs that, on a non-execute coaching turn, would
 *  falsely assert a change. Shared by the mutation-claim + value-change rules. */
const MUTATION_VERB =
  '(?:updated?|chang(?:e|ed)|set|added?|remov(?:e|ed)|delet(?:e|ed)|edit(?:ed)?|adjust(?:ed)?|modif(?:y|ied)|appl(?:y|ied)|increas(?:e|ed)|decreas(?:e|ed)|rais(?:e|ed)|lower(?:ed)?|reduc(?:e|ed))';

/** First-person completed-action claim prefix ("I've", "I have", "I", "we…",
 *  "successfully"). Anchors the change to a CLAIM the model made, so
 *  hypotheticals ("I'd set X to Y", "if you increase X to Y") never match. */
const CLAIM_SUBJECT = "(?:i['’]ve|i\\s+have|i|we['’]ve|we\\s+have|we|successfully)";

/**
 * Genuine graph/model mutation-success claim — a first-person completion verb
 * acting (via a determiner) on a graph/model object: "I've updated the budget
 * factor", "I changed the option value", "Done — I changed the graph", "I
 * updated the model". A determiner is required so idioms with no object
 * determiner ("I've added value") and non-graph objects ("I've created a
 * summary") stay safe. Replaces the egress-tuned `findSuccessClaimHit`, whose
 * bare "All set" / "Done." / "Created X" patterns over-fire on coaching prose.
 */
const COACHING_MUTATION_CLAIM_ACTIVE = new RegExp(
  `\\b${CLAIM_SUBJECT}\\s+(?:just\\s+|now\\s+|already\\s+)?${MUTATION_VERB}\\b\\s+` +
    `(?:the|a|an|your|that|this|its|my|our|both|two|all)\\s+(?:\\w+\\s+){0,2}?${GRAPH_MUTATION_OBJECT}\\b`,
  'i',
);

/** Passive mutation claim — "the model has been updated", "your graph was
 *  changed". Object precedes the verb, so it needs its own pattern. */
const COACHING_MUTATION_CLAIM_PASSIVE = new RegExp(
  `\\b(?:the|your|that|this|its|my|our)\\s+(?:\\w+\\s+){0,2}?${GRAPH_MUTATION_OBJECT}\\b\\s+` +
    `(?:has\\s+been|have\\s+been|was|were|is\\s+now|are\\s+now)\\s+` +
    `(?:updated|chang(?:e|ed)|set|added|remov(?:e|ed)|delet(?:e|ed)|edit(?:ed)?|adjust(?:ed)?|modif(?:y|ied)|appl(?:y|ied)|saved|committed)\\b`,
  'i',
);

function isMutationSuccessClaim(text: string): boolean {
  return COACHING_MUTATION_CLAIM_ACTIVE.test(text) || COACHING_MUTATION_CLAIM_PASSIVE.test(text);
}

/**
 * Value-CHANGE narration — a first-person completion verb that asserts a value
 * was moved: "I set the budget to £50k", "I changed the timeline from 12 months
 * to 18 months", "I updated churn to 5%". Keyed on the claim subject + change
 * verb + a `to`/`from` + a number, so DESCRIPTIVE mentions of display-safe
 * values ("Your budget is £50k", "An 18 month timeline", "A 5% churn
 * assumption") — which the LLM legitimately receives via `display_graph`'s
 * `display_value` — are NOT degraded, and hypotheticals ("I'd set X to £50k",
 * "increasing churn to 5% would…") never match. DETECTION only; all value/unit
 * formatting / normalisation stays owned by #296 — this rule resolves nothing.
 */
const COACHING_VALUE_CHANGE = new RegExp(
  `\\b${CLAIM_SUBJECT}\\s+(?:just\\s+|now\\s+|already\\s+)?${MUTATION_VERB}\\b` +
    `[^.!?]{0,40}?\\b(?:to|from)\\b\\s+(?:about\\s+|around\\s+|roughly\\s+|approximately\\s+)?(?:[£$€]\\s?)?\\d`,
  'i',
);

/**
 * Evidence / provenance / scientific-confidence / cognitive-bias claims. None
 * of these is a pack field (Tier-3 claim-safety contract does not exist yet),
 * so any such claim in coaching prose is unsupported by construction. Scoped to
 * science-claim shapes — not the bare word "confident" (a coach may be
 * "confident this helps you think it through").
 */
const EVIDENCE_CONFIDENCE_PATTERN =
  /\b(?:peer[- ]reviewed|statistically\s+significant|p\s*[<=]\s*0?\.\d|confidence\s+interval|scientifically\s+(?:proven|valid|sound|rigorous)|the\s+evidence\s+(?:shows|suggests|strongly|clearly|supports|indicates)|strong\s+evidence|robust\s+evidence|provenance|cognitive\s+bias|confirmation\s+bias|anchoring\s+bias|availability\s+bias|with\s+high\s+confidence|high(?:ly)?\s+confiden(?:t|ce))\b/i;

/**
 * Confident DIRECTIONAL / SUPERLATIVE advice — recommend-an-option language.
 * Gated on `stateUnsafe` by the caller, NOT on freshness wording: this is the
 * brief's primary firing case ("go with X" under stale state, even with no
 * false "fresh" claim and even when paired with a caveat).
 */
const DIRECTIONAL_ADVICE_PATTERN =
  /\b(?:you\s+should\s+(?:choose|pick|go\s+with|select|opt\s+for|prefer)|i['’]?d\s+(?:recommend|suggest|go\s+with|pick|choose)|i\s+recommend|my\s+recommendation|go\s+with\s+\w+|opt\s+for\s+\w+|stick\s+with\s+\w+|the\s+(?:best|strongest|safest|optimal|right|winning|leading)\s+(?:option|choice|bet|move|pick)|is\s+(?:clearly\s+|by\s+far\s+)?the\s+(?:best|strongest|winner|front[- ]runner)|remains\s+the\s+(?:best|winner|front[- ]runner|leader)|clearly\s+the\s+winner|your\s+best\s+(?:option|bet|choice))\b/i;

/**
 * Presenting an analysis RESULT as current — probabilities, win/lead/ahead
 * claims. Under `stateUnsafe` AND with no staleness caveat, this is
 * stale-as-fresh. (A result presented WITH a caveat is the desired behaviour,
 * so the staleness-signal check exempts it.)
 */
const RESULT_PRESENTATION_PATTERN =
  /\b(?:\d{1,3}\s?%|wins?\b|leads?\b|ahead\b|out[- ]?performs?|comes?\s+out\s+ahead|highest\s+(?:chance|probability)|best\s+chance|most\s+likely\s+to\s+(?:win|succeed)|expected\s+(?:value|outcome))\b/i;

/** Staleness caveat / rerun nudge — text signal that the prose flagged currency. */
const STALENESS_SIGNAL_PATTERN =
  /\b(?:stale|out[- ]of[- ]date|re[- ]?run|refresh|since\s+(?:the\s+)?(?:last\s+|latest\s+)?analysis|may\s+be\s+out\s+of\s+date|model\s+has\s+changed|no\s+longer\s+reflects?|can(?:'|’)?t\s+confirm|cannot\s+confirm)\b/i;

/**
 * Is the deterministic state unsafe for confident current-result coaching?
 * Stale / unknown ("unconfirmed") / absent / blocked / not chip-usable, OR a
 * rerun is required. Mirrors the live `deriveAnalysisFreshness` verdict carried
 * in the pack — the harness A1 gate and this runtime check read one truth.
 */
function isStateUnsafe(pack: CoachingStatePack): boolean {
  return (
    pack.rerun_required ||
    !pack.usable_for_chips ||
    pack.freshness === 'stale' ||
    pack.freshness === 'unknown' ||
    pack.freshness === 'none' ||
    pack.blocked
  );
}

/**
 * Inspect coaching prose against the deterministic pack. Returns the first
 * violation in severity order, or `{ safe: true }`. Pure.
 */
export function checkCoachingOutput(
  prose: string,
  pack: CoachingStatePack,
): CoachingPostcheckResult {
  const text = prose ?? '';
  if (text.trim().length === 0) return { safe: true };

  // Always-unsafe rules (independent of freshness): the pack never supplies
  // internal fields, mutation outcomes, value-changes, or science claims.
  if (hasInternalExposure(text)) {
    return { safe: false, violation: 'internal_field_exposed' };
  }
  if (isMutationSuccessClaim(text)) {
    // Coaching turns dispatch no mutation — a claim that the graph/model was
    // changed is false by construction (no handler fact backs it). Descriptive
    // coaching ("I've created a summary") is NOT a mutation claim.
    return { safe: false, violation: 'invented_mutation_success' };
  }
  if (COACHING_VALUE_CHANGE.test(text)) {
    // A first-person value-change claim ("I set the budget to £50k") on a
    // non-execute turn is unsourced. Descriptive mentions of display-safe
    // values are allowed (they reach the LLM via display_graph.display_value).
    return { safe: false, violation: 'value_change_narration' };
  }
  if (EVIDENCE_CONFIDENCE_PATTERN.test(text)) {
    return { safe: false, violation: 'unsupported_evidence_or_confidence_claim' };
  }

  // State-conditional rules: only when the analysis is not safe to present as
  // current. When state IS fresh + usable, directional advice and result
  // presentation are allowed — ordinary coaching is never degraded.
  if (isStateUnsafe(pack)) {
    if (DIRECTIONAL_ADVICE_PATTERN.test(text)) {
      // Fires regardless of any caveat — confident directional advice under
      // unsafe state is the dangerous case, independent of freshness wording.
      return { safe: false, violation: 'confident_advice_under_unsafe_state' };
    }
    if (
      RESULT_PRESENTATION_PATTERN.test(text) &&
      !STALENESS_SIGNAL_PATTERN.test(text)
    ) {
      return { safe: false, violation: 'stale_presented_as_fresh' };
    }
  }

  return { safe: true };
}

export interface CoachingDegradeResponse {
  readonly assistant_text: string;
  readonly suggested_actions: readonly StaleRerunSuggestedAction[];
}

export interface BuildCoachingDegradeOptions {
  /** Graph option count, for the "no analysis yet" absent copy. Defaults to 0. */
  readonly optionCount?: number;
}

/**
 * Neutral safe copy for an always-on violation (internal field / mutation /
 * value-change / evidence claim) that fired while the analysis state is itself
 * FRESH and usable. Using a stale/missing/degraded trust template here would
 * MISSTATE a healthy analysis, so we say only that the response was withheld.
 * British English; carries no value, unit, hash, option label or freshness claim.
 */
export const NEUTRAL_DEGRADE_TEXT =
  'Something in that response was not safe to show as-is. ' +
  'Please ask me what you’d like to inspect or change next.';

/**
 * Deterministic degrade-to-safe response for a fired post-check. State-aware:
 *   - state UNSAFE → a #298 trust template (so the explanation path, this
 *     post-check and the harness speak ONE trust language) + the existing
 *     `chip_action_rerun_analysis` chip (no new chip behaviour):
 *       · no analysis / freshness 'none' → "no analysis run yet"  (absent);
 *       · blocked / trust-downgraded     → "no usable result"      (degraded);
 *       · stale                          → "results may be out of date" (stale);
 *       · unknown ("unconfirmed")        → "can't confirm currency" (unconfirmed).
 *   - state FRESH + usable (an always-on rule fired) → NEUTRAL copy, no rerun
 *     chip — the analysis is fine; only the prose was unsafe.
 * It never narrates a value, unit, freshness reason, hash or option label.
 */
export function buildCoachingDegradeResponse(
  pack: CoachingStatePack,
  opts: BuildCoachingDegradeOptions = {},
): CoachingDegradeResponse {
  // Fresh + usable: the violation was an always-on prose issue, NOT a state
  // problem. Do not claim the analysis is stale / missing / degraded.
  if (!isStateUnsafe(pack)) {
    return { assistant_text: NEUTRAL_DEGRADE_TEXT, suggested_actions: [] };
  }
  const optionCount = opts.optionCount ?? 0;
  let assistant_text: string;
  if (!pack.analysis_present || pack.freshness === 'none') {
    // No analysis fact at all → "no analysis run yet".
    assistant_text = buildAnalysisAbsentTemplate(
      optionCount,
      pack.readiness_status ?? undefined,
    );
  } else if (pack.blocked) {
    // A fact exists but is unusable (blocked / hard contradiction) → honest
    // "no usable result", never a fabricated current answer. Checked before
    // freshness so a blocked-and-stale fact does not claim "the model changed".
    assistant_text = buildAnalysisDegradedTemplate();
  } else if (pack.freshness === 'stale') {
    assistant_text = buildAnalysisStaleTemplate();
  } else if (pack.freshness === 'unknown') {
    assistant_text = buildAnalysisUnconfirmedTemplate();
  } else {
    // Fact present + fresh but trust-downgraded (e.g. ready-with-actionable-
    // blockers) → honest "no usable result".
    assistant_text = buildAnalysisDegradedTemplate();
  }
  return { assistant_text, suggested_actions: [RERUN_ACTION] };
}
