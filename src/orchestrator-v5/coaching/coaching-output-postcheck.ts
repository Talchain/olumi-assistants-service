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
  filterLivePendingActions,
  type PendingAction,
} from '../session/pending-action.js';
import {
  buildAnalysisAbsentTemplate,
  buildAnalysisDegradedTemplate,
  buildAnalysisStaleTemplate,
  buildAnalysisUnconfirmedTemplate,
} from '../tools/handlers/no-op-helpers.js';
import {
  RENDER_SAFE_LABEL_FALLBACK,
  sanitisePublicCopyOrFallback,
} from '../compose/proposed-change.js';
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
 *  falsely assert a change. Shared by the mutation-claim + value-change rules.
 *  `creat(e|ed)` is included: it is safe here because the mutation-claim rule
 *  additionally requires a GRAPH/MODEL object, so "created a summary" stays safe
 *  while "created a new option" / "the graph was created" degrade. */
const MUTATION_VERB =
  '(?:updated?|chang(?:e|ed)|set|added?|creat(?:e|ed)|remov(?:e|ed)|delet(?:e|ed)|edit(?:ed)?|adjust(?:ed)?|modif(?:y|ied)|appl(?:y|ied)|increas(?:e|ed)|decreas(?:e|ed)|rais(?:e|ed)|lower(?:ed)?|reduc(?:e|ed))';

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
    // `[\w-]+` (not `\w+`) so hyphenated modifiers ("the high-priority factor")
    // are tolerated between the determiner and the graph object.
    `(?:the|a|an|your|that|this|its|my|our|both|two|all)\\s+(?:[\\w-]+\\s+){0,2}?${GRAPH_MUTATION_OBJECT}\\b`,
  'i',
);

/** Passive mutation claim — "the model has been updated", "your high-priority
 *  factor was changed". Object precedes the verb, so it needs its own pattern. */
const COACHING_MUTATION_CLAIM_PASSIVE = new RegExp(
  `\\b(?:the|your|that|this|its|my|our)\\s+(?:[\\w-]+\\s+){0,2}?${GRAPH_MUTATION_OBJECT}\\b\\s+` +
    `(?:has\\s+been|have\\s+been|was|were|is\\s+now|are\\s+now)\\s+` +
    `(?:updated|chang(?:e|ed)|set|added|created|remov(?:e|ed)|delet(?:e|ed)|edit(?:ed)?|adjust(?:ed)?|modif(?:y|ied)|appl(?:y|ied)|saved|committed)\\b`,
  'i',
);

/**
 * Directly-named graph-entity mutation — "I created Option A", "We updated
 * Factor 3", "I removed Node X". A named entity (a Capitalised graph noun + a
 * Capital/number label) needs no determiner, so this complements the
 * determiner-gated active pattern. CASE-SENSITIVE (no `i` flag): the
 * capitalised noun + label is the named-entity signal, so ordinary lowercase
 * prose ("between option a and b", "I changed option settings") does NOT match.
 */
const COACHING_MUTATION_CLAIM_NAMED =
  /\b(?:[Ii]|[Ww]e)(?:['’]ve|\s+have)?\s+(?:just\s+|now\s+|already\s+)?(?:[Uu]pdated?|[Cc]hanged?|[Cc]reated?|[Ss]et|[Aa]dded?|[Rr]emoved?|[Dd]eleted?|[Aa]djusted?|[Mm]odified|[Aa]pplied)\s+(?:Option|Factor|Node|Edge|Constraint|Driver|Assumption|Parameter|Weight|Link|Goal|Scenario|Model|Graph)\s+["“]?[A-Z0-9]/;

function isMutationSuccessClaim(text: string): boolean {
  return (
    COACHING_MUTATION_CLAIM_ACTIVE.test(text) ||
    COACHING_MUTATION_CLAIM_PASSIVE.test(text) ||
    COACHING_MUTATION_CLAIM_NAMED.test(text)
  );
}

/**
 * Value-CHANGE narration — a first-person completion verb that asserts a value
 * was moved: "I set the budget to £50k", "I changed the timeline from 12 months
 * to 18 months", "I updated churn to 5%", "I increased the budget by £50k", "I
 * set the budget at £50k". Keyed on the claim subject + change verb + a
 * `to`/`from`/`by`/`at` + a number, so DESCRIPTIVE mentions of display-safe
 * values ("Your budget is £50k", "An 18 month timeline", "A 5% churn
 * assumption") — which the LLM legitimately receives via `display_graph`'s
 * `display_value` — are NOT degraded, and hypotheticals ("I'd set X to £50k",
 * "increasing churn to 5% would…") never match. Lexical DETECTION only; all
 * value/unit formatting / normalisation stays owned by #296 — resolves nothing.
 */
// A VALUE shape (not just any digit): currency, a number+unit, or a bare
// decimal ratio (the "£0.3" set-defect shape). This deliberately EXCLUDES
// clock times ("5pm", "5am") and unit-less integers ("at 5pm", "at 3 today")
// so the rule stays value-change-only, not "any number after a preposition".
const VALUE_SHAPE =
  '(?:[£$€]\\s?\\d|\\d+(?:[.,]\\d+)?\\s?%|\\d+(?:[.,]\\d+)?\\s?(?:percent|pp|bps|k|m|bn|gbp|usd|eur|dollars?|pounds?|euros?|months?|years?|weeks?|days?|hours?|hrs?|mins?|minutes?|kg|km|miles?|tonnes?|litres?|units?|x)\\b|\\d+\\.\\d+(?!\\s?[ap]m\\b))';
// A bare integer that is NOT a clock time ("5pm", "5:30", "5 o'clock"). Allowed
// after `to`/`from`/`by`, where "set headcount to 10" / "from 12 to 18" /
// "increased headcount by 5" are genuine value changes; NOT after `at` (which
// takes clock times, so "changed my mind at 5pm" stays safe).
const BARE_INT_NOT_TIME = "\\d+(?![:.]\\d)(?!\\s?[ap]m\\b)(?!\\s?o['’]?clock\\b)";
const COACHING_VALUE_CHANGE = new RegExp(
  `\\b${CLAIM_SUBJECT}\\s+(?:just\\s+|now\\s+|already\\s+)?${MUTATION_VERB}\\b[^.!?]{0,40}?` +
    `(?:\\b(?:to|from|by)\\b\\s+(?:about\\s+|around\\s+|roughly\\s+|approximately\\s+)?(?:${VALUE_SHAPE}|${BARE_INT_NOT_TIME})` +
    `|\\bat\\b\\s+(?:about\\s+|around\\s+|roughly\\s+|approximately\\s+)?${VALUE_SHAPE})`,
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
 * Confident DIRECTIONAL / SUPERLATIVE advice about an OPTION — the brief's
 * primary firing case under unsafe state (independent of freshness wording, and
 * even when paired with a caveat). See {@link isDirectionalOptionAdvice}; this
 * is split into two tiers so generic recommendation language is directional
 * ONLY when it points at an option, and recovery/rerun guidance — the DESIRED
 * unsafe-state behaviour — is never a violation.
 *
 * Tier 1 — unambiguous option judgement (fires on its own): a superlative + an
 * option NOUN ("the best/better/preferable… option/choice"), or a copula + an
 * inherently-option judgement ("is preferable/superior/the winner/better").
 * `(?!\s+to\b)` keeps process advice ("it is better TO wait") out; superlatives
 * with no option noun ("this is the best WAY") never reach here.
 */
const UNAMBIGUOUS_OPTION_ADVICE =
  /\b(?:the\s+(?:best|strongest|safest|optimal|right|winning|leading|preferable|better|superior|preferred)\s+(?:option|choice|bet|move|pick|call|one)|(?:is|are|remains?|stays?|seems?|looks?)\s+(?:clearly\s+|by\s+far\s+|obviously\s+|still\s+|the\s+)?(?:preferable|superior|winner|front[- ]runner|leader|better|stronger|safer)\b(?!\s+to\b)|clearly\s+the\s+winner|your\s+best\s+(?:option|bet|choice))\b/i;

/**
 * Tier 2 — recommendation / selection language ("I('d/ would) recommend/suggest/
 * advise/go with/choose/pick…", "you/we should choose…", "my advice…", "go with
 * X"). Directional ONLY when {@link OPTION_SELECTION_SIGNAL} is also present, so
 * "I recommend re-running the analysis" / "my advice is to re-run" / "I'd go
 * with re-running" are NOT classified as option-selection advice.
 */
const RECOMMENDATION_VERB =
  /\b(?:(?:i|we)(?:['’]d)?\s+(?:would\s+|really\s+|strongly\s+|definitely\s+)?(?:recommend|suggest|advise|favou?r|propose|go\s+with|choose|pick|opt\s+for|select|prefer|lean)|my\s+(?:recommendation|advice|suggestion|pick|choice)|(?:you|we)\s+(?:should|['’]d|ought\s+to|could|may\s+want\s+to|need\s+to|must)\s+(?:choose|pick|go\s+with|select|opt\s+for|prefer|favou?r)|go\s+with\s+\w+|opt\s+for\s+\w+|stick\s+with\s+\w+)\b/i;

/** Explicit option-selection signal — an option/choice noun or an enumerated
 *  pick. NOT the selection verbs themselves (those are recovery-agnostic). */
const OPTION_SELECTION_SIGNAL =
  /\b(?:options?|choices?|the\s+(?:first|second|third|former|latter)\b)/i;

/**
 * Is the prose confident directional advice about an OPTION? Tier-1 judgements
 * fire on their own; recommendation language (tier 2) fires only with an
 * option-selection signal — so recovery/rerun guidance ("I recommend re-running
 * the analysis") is never a violation.
 */
function isDirectionalOptionAdvice(text: string): boolean {
  if (UNAMBIGUOUS_OPTION_ADVICE.test(text)) return true;
  return RECOMMENDATION_VERB.test(text) && OPTION_SELECTION_SIGNAL.test(text);
}

// ---------------------------------------------------------------------------
// Label-aware detection — the type-noun patterns above know "option"/"factor",
// but not the graph's ACTUAL display labels ("Plan A", "Pricing"). The caller
// supplies the live option/factor/node labels so "I recommend Plan A" (option)
// and "I updated Pricing" (factor) degrade. Pure: the labels are deterministic
// graph state; no #296 resolver logic, no value formatting.
// ---------------------------------------------------------------------------

/**
 * CASE-SENSITIVE label detectors built from the supplied decision labels. Case
 * sensitivity is the disambiguator: a Title-Case label ("Value", "Pricing")
 * matches a named reference but NOT the lowercase idiom ("added value").
 * Trivial (<3 char) labels are skipped as too noisy. Returns null when nothing
 * usable remains. Three forms:
 *   - `verbObject`  — label as the direct object of a verb (tested against the
 *     post-verb slice; tolerates a leading quote, e.g. `recommend "Plan A"`);
 *   - `subjectMut`  — label as the subject of a PASSIVE mutation ("Pricing was
 *     updated", "Plan A has been changed");
 *   - `subjectJudge`— label as the subject of an option JUDGEMENT ("Plan A is
 *     the best", "Plan A is our top choice") — only superlatives that are
 *     option-shaped (followed by an option noun, or clause-final) so "Pricing
 *     is the best metric" stays safe.
 */
interface LabelDetectors {
  readonly verbObject: RegExp;
  readonly subjectMut: RegExp;
  readonly subjectJudge: RegExp;
}
function buildLabelDetectors(labels: readonly string[] | undefined): LabelDetectors | null {
  if (!labels || labels.length === 0) return null;
  const escaped = Array.from(
    new Set(
      labels
        .filter((l): l is string => typeof l === 'string')
        .map((l) => l.trim())
        .filter((l) => l.length >= 3),
    ),
  ).map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return null;
  escaped.sort((a, b) => b.length - a.length); // longest-first: specific wins
  const alt = escaped.join('|');
  const label = `(?:${alt})`;
  // All CASE-SENSITIVE (no `i` flag): the label casing is the named-reference signal.
  return {
    verbObject: new RegExp(`^["“”'‘’]?${label}(?![\\w])`),
    subjectMut: new RegExp(
      // Two subject forms: an ATTACHED contraction ("Pricing's been updated",
      // "Plans've been changed"), or a SPACED auxiliary ("Pricing was/got/has
      // been/is being updated"). Both then take a passive mutation verb.
      `(?:(?<![\\w])["“”'‘’]?${label}['’](?:s|ve)\\s+been` +
        `|(?<![\\w])["“”'‘’]?${label}["“”'‘’]?(?![\\w])\\s+(?:has\\s+been|have\\s+been|was|were|got|is\\s+now|are\\s+now|is\\s+being|are\\s+being))\\s+` +
        `(?:updated|chang(?:e|ed)|set|added|created|remov(?:e|ed)|delet(?:e|ed)|edit(?:ed)?|adjust(?:ed)?|modif(?:y|ied)|appl(?:y|ied)|saved|committed)\\b`,
    ),
    subjectJudge: new RegExp(
      `(?<![\\w])["“”'‘’]?${label}["“”'‘’]?(?![\\w])\\s+(?:is|are|['’]s|remains?|stays?|seems?|looks?|would\\s+be)\\s+` +
        `(?:clearly\\s+|by\\s+far\\s+|the\\s+|our\\s+|my\\s+|your\\s+|a\\s+)*` +
        `(?:(?:best|strongest|top|optimal|winning|leading|safest|preferred|ideal|right)\\s+(?:choice|option|pick|one|bet|move|call)` +
        `|(?:best|strongest|top|optimal|winning|leading|safest|preferred|ideal|winner)(?=[\\s]*[.,!?;:]|\\s*$))`,
    ),
  };
}

/** Claim-subject + mutation verb + optional determiner; global so we can scan
 *  the slice that follows each occurrence for a known label. */
const MUTATION_VERB_CONTEXT = new RegExp(
  `\\b${CLAIM_SUBJECT}\\s+(?:just\\s+|now\\s+|already\\s+)?${MUTATION_VERB}\\b\\s+` +
    `(?:the\\s+|a\\s+|an\\s+|your\\s+|its\\s+|my\\s+|our\\s+|that\\s+|this\\s+)?`,
  'ig',
);

/** Recommendation / selection verb (incl. "let's", bare imperative, "lean
 *  towards"), + optional "going with"/"the"; global so we can scan the
 *  following slice for a known option label. */
const RECOMMEND_VERB_CONTEXT = new RegExp(
  `\\b(?:(?:i|we)(?:['’]d)?\\s+(?:would\\s+|really\\s+|strongly\\s+|definitely\\s+)?` +
    `(?:recommend|suggest|advise|propose|go\\s+with|choose|pick|opt\\s+for|select|prefer|favou?r|lean\\s+towards?)` +
    `|(?:let['’]?s|let\\s+us)\\s+(?:go\\s+with|choose|pick|opt\\s+for|select)` +
    `|(?:you|we)\\s+(?:should|['’]d|ought\\s+to|could|may\\s+want\\s+to|need\\s+to|must)\\s+` +
    `(?:choose|pick|go\\s+with|select|opt\\s+for|prefer|favou?r)` +
    `|(?:go\\s+with|go\\s+for|opt\\s+for|stick\\s+with|choose|pick|select))\\b\\s+` +
    `(?:(?:going\\s+with|opting\\s+for|sticking\\s+with|the)\\s+)?`,
  'ig',
);

/** True when a known label is the direct object of a verb match (the label is
 *  matched case-sensitively at the start of the slice following the verb). */
function labelIsVerbObject(
  text: string,
  contextRegex: RegExp,
  labelMatcher: RegExp,
): boolean {
  contextRegex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = contextRegex.exec(text)) !== null) {
    if (labelMatcher.test(text.slice(m.index + m[0].length))) return true;
    if (m.index === contextRegex.lastIndex) contextRegex.lastIndex += 1; // guard
  }
  return false;
}

/** Label-aware mutation claim: a mutation verb whose object is a known label,
 *  OR a known label as the subject of a passive mutation ("Pricing was updated"). */
function isLabelMutationClaim(text: string, det: LabelDetectors): boolean {
  return (
    labelIsVerbObject(text, MUTATION_VERB_CONTEXT, det.verbObject) || det.subjectMut.test(text)
  );
}

/** Label-aware directional advice: a recommendation whose object is a known
 *  label, OR a known label as the subject of an option judgement. */
function isLabelDirectionalAdvice(text: string, det: LabelDetectors): boolean {
  return (
    labelIsVerbObject(text, RECOMMEND_VERB_CONTEXT, det.verbObject) || det.subjectJudge.test(text)
  );
}

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

/** Optional detection context for {@link checkCoachingOutput}. */
export interface CheckCoachingOutputOptions {
  /**
   * The turn's live decision labels (option / factor / node display labels),
   * supplied by the caller from deterministic graph state. Lets the post-check
   * recognise the graph's ACTUAL labels ("I recommend Plan A", "I updated
   * Pricing"), not just the type nouns ("option", "factor"). Omitted ⇒
   * type-noun / named-entity detection only.
   */
  readonly decisionLabels?: readonly string[];
}

/**
 * Inspect coaching prose against the deterministic pack. Returns the first
 * violation in severity order, or `{ safe: true }`. Pure.
 */
export function checkCoachingOutput(
  prose: string,
  pack: CoachingStatePack,
  opts: CheckCoachingOutputOptions = {},
): CoachingPostcheckResult {
  const text = prose ?? '';
  if (text.trim().length === 0) return { safe: true };
  const labelDet = buildLabelDetectors(opts.decisionLabels);

  // Always-unsafe rules (independent of freshness): the pack never supplies
  // internal fields, mutation outcomes, value-changes, or science claims.
  if (hasInternalExposure(text)) {
    return { safe: false, violation: 'internal_field_exposed' };
  }
  if (
    isMutationSuccessClaim(text) ||
    (labelDet !== null && isLabelMutationClaim(text, labelDet))
  ) {
    // Coaching turns dispatch no mutation — a claim that the graph/model was
    // changed is false by construction (no handler fact backs it). Descriptive
    // coaching ("I've created a summary") is NOT a mutation claim. A mutation
    // verb acting on a KNOWN label ("I updated Pricing") also degrades.
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
  //
  // These rules protect the integrity of an EXISTING analysis RESULT — they
  // stop the model presenting a stale / unknown / blocked / unusable result as
  // though it were current. They are meaningful ONLY when a successful analysis
  // actually exists. PRE-ANALYSIS (no successful run_analysis fact —
  // `!analysis_present` / freshness 'none') there is no result to misrepresent:
  // ordinary early-conversation coaching legitimately weighs the options, names
  // the risks, and echoes the user's own numbers ("your ~3% churn"). Degrading
  // that here produced the conversational dead-end where a genuine coaching
  // answer — the model WAS invoked (converse/coach path) — was clobbered by the
  // canned "No analysis has been run… run the analysis?" nudge
  // (behavioural-retest T1/T2). So gate the state-conditional rules on a result
  // actually existing. The always-unsafe rules above still fire pre-analysis,
  // so a fabricated evidence / confidence / mutation / value claim is still
  // caught by construction; a user who explicitly asks to explain a not-yet-run
  // analysis is still nudged by the explanation handler / no-analysis guard,
  // which is a different code path, not this post-check.
  const analysisResultExists = pack.analysis_present && pack.freshness !== 'none';
  if (analysisResultExists && isStateUnsafe(pack)) {
    if (
      isDirectionalOptionAdvice(text) ||
      (labelDet !== null && isLabelDirectionalAdvice(text, labelDet))
    ) {
      // Fires regardless of any caveat — confident directional advice under
      // unsafe state is the dangerous case, independent of freshness wording.
      // A recommendation pointing at a KNOWN option label ("I recommend Plan A")
      // also degrades. Recovery/rerun guidance is exempt (the desired behaviour).
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

/**
 * F-HELD fix 3b — the live held offer the degrade path must restate instead
 * of stomping it with a competing analysis offer. Copy fields are the
 * pending's persisted PUBLIC copy (emit-time safety-filtered); `chip_id` is
 * the proposal ref so the re-rendered chip replays exactly the offer the
 * bare-confirm resumer (consent-priority) resolves.
 */
export interface HeldOfferForDegrade {
  readonly chip_id: string;
  readonly label: string;
  readonly message: string;
}

/** Minimal chip shape for the held confirm re-offer (assignable to SuggestedAction). */
export interface HeldConfirmSuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  /**
   * Deliberately absent: the held confirm chip is a plain replay chip ("Yes")
   * that the bare-confirm resumer resolves via consent-priority — it must
   * NOT carry an executable action_type of its own. Declared (as undefined)
   * so the union with StaleRerunSuggestedAction stays discriminable by
   * property access.
   */
  readonly action_type?: undefined;
}

export interface CoachingDegradeResponse {
  readonly assistant_text: string;
  readonly suggested_actions: ReadonlyArray<
    StaleRerunSuggestedAction | HeldConfirmSuggestedAction
  >;
}

export interface BuildCoachingDegradeOptions {
  /** Graph option count, for the "no analysis yet" absent copy. Defaults to 0. */
  readonly optionCount?: number;
  /**
   * F-HELD fix 3b — when a live confirmation-expecting hold exists, the
   * state-unsafe degrade restates the held offer + its confirm chip instead
   * of the #298 trust template + rerun chip. Wire capture 13c is the RED
   * fixture: the absent template stomped a direct answer to the assistant's
   * own disambiguation question AND minted the competing run_analysis offer
   * that the next bare "yes" bound to — hijacking the consent flow. Omit for
   * the unchanged no-hold behaviour.
   */
  readonly liveHold?: HeldOfferForDegrade;
}

/**
 * F-HELD fix 3b — deterministic held-aware degrade copy. Mirrors the swept
 * GM_HELD_ASSISTANT_TEXT wording ("holding … Nothing in the model moves
 * until you confirm") so the copy family stays within the
 * provisional_doctrine_v0 language that edit-graph-referee-gate.test.ts
 * already sweeps against the egress guards. No values, hashes, labels or
 * internal tokens; no LLM text.
 */
export const HELD_AWARE_DEGRADE_TEXT =
  "I'm still holding a change to your model rather than applying it straight " +
  'away. Nothing in the model moves until you confirm. Reply yes to continue ' +
  'with it, or tell me what to adjust instead.';

/**
 * CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — doctrine (a): the degrade
 * RE-ASK names the hold it restates. The hold's persisted public label is
 * render-sanitised first; a label that sanitises away, or one of the
 * generic legacy/fallback labels (which would read "the change to continue
 * with this change"), falls back to the unnamed swept copy above.
 */
export function buildHeldAwareDegradeText(label: string | null | undefined): string {
  const safe = sanitisePublicCopyOrFallback(label ?? undefined, '');
  if (
    safe.length === 0 ||
    safe === RENDER_SAFE_LABEL_FALLBACK ||
    // Legacy GM hold chip label (edit-graph-referee-gate GM_HELD_CHIP_LABEL,
    // stated literally to keep this module referee-gate-free).
    safe === 'Continue with this change'
  ) {
    return HELD_AWARE_DEGRADE_TEXT;
  }
  const subject = safe.charAt(0).toLowerCase() + safe.slice(1);
  return (
    `I'm still holding the change to ${subject} rather than applying it straight ` +
    'away. Nothing in the model moves until you confirm. Reply yes to continue ' +
    'with it, or tell me what to adjust instead.'
  );
}

/**
 * F-HELD round 2 (FIXUP 3) — select the live hold the degrade may restate.
 *
 * Selection rules:
 *   - live per the shared read-time liveness predicate (wall TTL + turn TTL);
 *   - `expires_at_turn_count > 1` REQUIRED: a hold read at 1 lapses at THIS
 *     turn's commit (the carry-forward decrements 1 → 0), so restating it
 *     with a confirm chip in the SAME message that carries the lapse notice
 *     would contradict itself and ship a dead chip;
 *   - standard variant with persisted public copy only (a legacy no-copy
 *     hold has nothing safe to restate);
 *   - newest emitted wins when several qualify (the read side places the
 *     freshest offer first; the sort makes it order-independent).
 *
 * Pure; clock injected. Lives here (not in the TurnExecutor closure) so the
 * same-commit-lapse contradiction guard is unit-testable next to the
 * degrade template it feeds.
 */
export function selectLiveHoldForDegrade(
  pendings: readonly PendingAction[] | undefined,
  nowMs: number,
): HeldOfferForDegrade | undefined {
  const holds = filterLivePendingActions(pendings ?? [], nowMs).filter(
    (pa) =>
      pa.action.kind === 'apply_proposed_change' &&
      pa.expires_at_turn_count > 1 &&
      typeof pa.action.public_label === 'string' &&
      pa.action.public_label.length > 0 &&
      typeof pa.action.public_message === 'string' &&
      pa.action.public_message.length > 0,
  );
  if (holds.length === 0) return undefined;
  const newest = [...holds].sort(
    (a, b) => Date.parse(b.emitted_at_iso) - Date.parse(a.emitted_at_iso),
  )[0]!;
  const action = newest.action;
  // Redundant with the filter above, but keeps this branch cast-free and
  // fail-closed under future refactors.
  if (
    action.kind !== 'apply_proposed_change' ||
    typeof action.public_label !== 'string' ||
    typeof action.public_message !== 'string'
  ) {
    return undefined;
  }
  return {
    chip_id: newest.chip_id,
    label: action.public_label,
    message: action.public_message,
  };
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
  // problem. Do not claim the analysis is stale / missing / degraded. This
  // outranks the held-aware branch: with a fine analysis there is no
  // competing rerun offer to suppress, and neutral copy misstates nothing.
  if (!isStateUnsafe(pack)) {
    return { assistant_text: NEUTRAL_DEGRADE_TEXT, suggested_actions: [] };
  }
  // F-HELD fix 3b — a live hold outranks every state-unsafe trust template.
  // Rationale: each of those templates ships the rerun chip, which mints the
  // competing consent offer (13c). While the user has an unanswered hold, the
  // honest degrade is to restate that offer and its confirm chip; the trust
  // language returns as soon as the hold resolves or lapses.
  if (opts.liveHold !== undefined) {
    return {
      // CONSENT-CLARITY AMENDMENT — the re-ask names the hold it restates
      // (falls back to the unnamed swept copy for legacy/fallback labels).
      assistant_text: buildHeldAwareDegradeText(opts.liveHold.label),
      suggested_actions: [
        {
          id: opts.liveHold.chip_id,
          label: opts.liveHold.label,
          message: opts.liveHold.message,
        },
      ],
    };
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
