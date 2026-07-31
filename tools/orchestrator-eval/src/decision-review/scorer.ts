/**
 * orchestrator-eval — decision_review deterministic scorer.
 *
 * ── Provenance discipline (the whole point of this file) ────────────────────
 *
 * Every dimension declares WHERE its rule comes from, and the three sources are
 * ranked by how hard they are to drift:
 *
 *   production-guard      the runtime's own exported function, imported. These
 *                         cannot disagree with staging because they ARE
 *                         staging's code.
 *   served-prompt-derived PARSED from the served prompt text at run time
 *                         (`served-contract.ts`), so the rule tracks a prompt
 *                         bump instead of mirroring one moment of it — which is
 *                         exactly what `tools/graph-evaluator`'s `BANNED_TERMS`
 *                         / `TONE_RULES` constants failed to do since
 *                         2026-03-06.
 *   eval-assertion        this pack's own worked logic, reasoning written down
 *                         at the definition site, each one stating what it can
 *                         and cannot see.
 *
 * Counts are deliberately NOT written here. A prose tally of "six of these and
 * five of those" is a hand-maintained mirror of the code beneath it and would
 * be wrong within one commit. The authoritative lists are
 * {@link DECISION_REVIEW_DIMENSIONS} and {@link ABSENCE_DIMENSIONS} at the foot
 * of this file, and `decision-review-scorer.test.ts` asserts the inventory
 * against a REAL score rather than trusting either.
 *
 * ── Anti-vacuity ────────────────────────────────────────────────────────────
 *
 * Most of these dimensions are ABSENCE checks (see {@link ABSENCE_DIMENSIONS}),
 * and an absence check passes trivially on an empty output. Two structural
 * defences:
 *
 *   1. `substance_present` is the FLOOR — a degenerate output fails it, so the
 *      pack can never rank emptiness as its cleanest candidate.
 *   2. Every absence dimension reports `scanned`, the size of the corpus it
 *      actually examined. `__tests__/decision-review-anti-vacuity.test.ts`
 *      asserts `scanned > 0` for every absence dimension on every good
 *      candidate in the pack — so a dimension that quietly stops seeing
 *      anything goes RED even while it reports "clean".
 */

// The R-CONT fabricated-callback rule is reached through
// `checkDecisionReviewContract`, NOT through the lower-level
// `findFabricatedContinuityHit`. Calling the gate means the eval inherits the
// runtime's own enforce-vs-telemetry classification (COUNT_CAP_RULES) instead
// of re-deciding which rules matter — one call, four dimensions, zero
// re-specified rules.
import {
  checkDecisionReviewContract,
  COUNT_CAP_RULES,
  type DecisionReviewContractRule,
} from '../../../../src/cee/decision-review/contract-gate.js';
import {
  checkNumberGrounding,
  collectStrings,
  performShapeCheck,
} from '../../../../src/cee/decision-review/shape-check.js';
import { findForbiddenMatches } from '../guards.js';
import { computeMargin } from './assemble.js';
import {
  finaliseScore,
  type DimensionResult,
  type ScannedUnit,
  type ScoreResult,
} from '../types.js';
import type { DecisionReviewEvalInput } from './types.js';
import {
  parseServedTerminologyContract,
  parseToneTable,
  readServedPromptText,
  resolveToneRow,
  type ServedTerminologyContract,
  type ToneRow,
} from './served-contract.js';

// ============================================================================
// The served contract, read ONCE per process
// ============================================================================

let cachedContract: ServedTerminologyContract | null = null;
let cachedToneRows: readonly ToneRow[] | null = null;

/** The parsed served contract (memoised; the prompt file does not change mid-run). */
export function servedContract(): ServedTerminologyContract {
  cachedContract ??= parseServedTerminologyContract(readServedPromptText());
  return cachedContract;
}

/** The parsed tone table (memoised). */
export function servedToneRows(): readonly ToneRow[] {
  cachedToneRows ??= parseToneTable(readServedPromptText());
  return cachedToneRows;
}

/** Test-only: drop the memo so a test can point the parser at a mutated prompt. */
export function resetServedContractCache(): void {
  cachedContract = null;
  cachedToneRows = null;
}

// ============================================================================
// Prose collection — WHICH strings are user-facing
// ============================================================================

/**
 * Value-keys whose STRING CONTENTS are ids by design, not user-facing prose.
 *
 * The served prompt names them itself (`decision_review.txt:119-121`): "Entity
 * ids … in any user-facing string. Ids appear ONLY as JSON keys and in
 * grounded_in / affected_elements / factor_id fields." Those three are the
 * prompt's own exemption list.
 *
 * The `/(^|_)id$/` rule generalises the structural intent (two of the prompt's
 * three exemptions are `*_id` fields) so `edge_id`, `option_id`, `dsk_claim_id`
 * do not read as prose either. It is a STRUCTURAL rule, not an invented word
 * list: a field whose name ends in `id` holds an identifier.
 *
 * Getting this wrong in the permissive direction would be the worse error — it
 * would make `no_entity_ids_in_prose` fire on every well-formed review that
 * grounds a bias finding, teaching operators to ignore the dimension (the
 * broken-alarm class). A negative control pins that: a good candidate whose
 * `affected_elements` carry real graph ids must NOT trip the dimension.
 */
const ID_BEARING_VALUE_KEYS: ReadonlySet<string> = new Set([
  'grounded_in',
  'affected_elements',
  'factor_id',
]);

function isIdBearingKey(key: string): boolean {
  return ID_BEARING_VALUE_KEYS.has(key) || /(^|_)id$/.test(key);
}

/**
 * Collect the USER-FACING string values of a decision_review output: every
 * string reachable from the object EXCEPT those under an id-bearing key.
 *
 * Object KEYS are never collected (the prompt permits ids as keys), which comes
 * free from walking values only — the same choice the runtime's `collectStrings`
 * makes, and this walker is deliberately its shape so the two agree on what a
 * "string in the output" is.
 */
export function collectProseStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectProseStrings);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      isIdBearingKey(k) ? [] : collectProseStrings(v),
    );
  }
  return [];
}

// ============================================================================
// Small readers
// ============================================================================

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Key count of a plain object value, or 0 when it is not one. */
function objectKeyCount(value: unknown): number {
  const record = readRecord(value);
  return record ? Object.keys(record).length : 0;
}

/**
 * Build a MEASURED dimension (pass or fail).
 *
 * INVARIANT, asserted pack-wide in decision-review-anti-vacuity.test.ts: a
 * measured dimension that reports a `scanned` count and PASSES must report a
 * NON-ZERO one. "I looked and found nothing" and "I could not look" must never
 * render identically — that identity is what let the first baseline report a
 * vacuous `tone_alignment` as one of nineteen passes. When a dimension cannot
 * look, it must return {@link na} instead of passing with a zero count.
 */
const dim = (
  name: string,
  pass: boolean,
  source: DimensionResult['source'],
  detail: string,
  scanned?: number,
  scannedUnit?: ScannedUnit,
): DimensionResult => ({
  name,
  pass,
  status: pass ? 'pass' : 'fail',
  source,
  detail,
  ...(scanned === undefined ? {} : { scanned }),
  ...(scannedUnit === undefined ? {} : { scannedUnit }),
});

/**
 * Build a NOT-APPLICABLE dimension: this run gave it nothing to evaluate.
 *
 * `pass` is true because NA must not fail a candidate, but `status` is what
 * every report reads — NA is excluded from the measured denominator and shown
 * out of band. The `reason` is mandatory and prefixed, so an NA row can never
 * be skim-read as a clean pass in CLI output.
 */
const na = (name: string, source: DimensionResult['source'], reason: string): DimensionResult => ({
  name,
  pass: true,
  status: 'not_applicable',
  source,
  detail: `NOT APPLICABLE — ${reason}`,
});

// ============================================================================
// Dimension helpers with their own reasoning
// ============================================================================

/**
 * A bare decimal in the probability band.
 *
 * The served prompt (`decision_review.txt:116-118`): write "62%", never "0.62";
 * "Any bare decimal like 0.4 in an output string gets that entire card
 * discarded downstream." The band matters — "£1.5m" and "7.5 percentage points"
 * are legitimate prose, so only decimals whose VALUE lies in [0, 1] are
 * probability-like. Percent-suffixed numbers are excluded (they are the
 * prescribed form).
 */
const BARE_DECIMAL_PATTERN = /(?<![\w.])(-?\d*\.\d+)(?![\w%])/g;

function findRawProbabilityDecimals(text: string): string[] {
  const hits: string[] = [];
  BARE_DECIMAL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_DECIMAL_PATTERN.exec(text)) !== null) {
    const n = Number.parseFloat(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 1) hits.push(m[1]);
  }
  return hits;
}

/**
 * Match one banned lexicon term in prose.
 *
 * Two boundary decisions, each chosen for the direction of its error:
 *   - LEADING `\b`, no trailing boundary, so inflections the prompt clearly
 *     means to catch are caught ("recommendations" for the banned
 *     "recommendation", "winners" for "winner"). A trailing `\b` would let a
 *     plural walk straight through the ban.
 *   - a negative lookahead on `_`, so a term embedded in a snake_case
 *     IDENTIFIER is NOT reported here. "recommendation_stability" contains
 *     "recommendation", but it is an internal-vocabulary leak, and
 *     `no_internal_vocabulary` owns it. Without the lookahead, one defect
 *     would be reported under two dimensions and neither report would be a
 *     clean attribution.
 */
function bannedTermRegex(term: string): RegExp {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!_)`, 'i');
}

/**
 * Match one FORBIDDEN TONE PHRASING in prose, on word boundaries.
 *
 * ⚠ THIS WAS A SUBSTRING MATCH AND IT WAS WRONG IN THE WORST DIRECTION. The
 * served table forbids the bare words "ready" and "clear" at its cautious rows,
 * and `proseBlobLower.includes('ready')` fires on "**alrea dy**" and
 * `includes('clear')` on "un**clear**" — so a review writing exactly the
 * hedged prose the cautious row DEMANDS ("the picture is unclear", "we have
 * already gathered…") scored as a tone breach. A dimension that fails compliant
 * output is worse than one that misses a defect: it trains operators to ignore
 * the alarm, and it would have made the rewrite look better than the incumbent
 * for doing the right thing.
 *
 * Both demonstrated strings are pinned as negative controls in
 * decision-review-scorer.test.ts.
 *
 * Boundaries on BOTH sides here (unlike the banned-lexicon matcher, which is
 * leading-only so inflections are caught): these are tone PHRASINGS quoted
 * verbatim from the table, not lexemes whose plural forms are also banned.
 */
function forbiddenPhraseRegex(phrase: string): RegExp {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

/** Em dash (U+2014) and en dash (U+2013) — both banned by the OUTPUT_SCHEMA. */
const DASH_PATTERN = /[–—]/;

/**
 * Raw entity-id shapes that must not appear inside user-facing prose.
 *
 * ⚠ HAND-MAINTAINED PREFIX LIST — derived 2026-07-31 from the id prefixes
 * observed across this pack's fixtures and the two deployed-pair captures
 * (`dec_`, `opt_`, `fac_`, `out_`, `goal_`, `risk_`) plus the two structural
 * kinds (`edge_`, `node_`). It is NOT derived from a runtime constant, because
 * none exists to derive from: the runtime's own detector
 * (`tools/v5-journey-replay/forbidden-terms.ts` `ID_PREFIX_REGEX`) carries its
 * own narrower list (`opt|fac|goal|risk|out`) and is itself hand-maintained.
 *
 * SO IT WILL GO STALE when a new entity kind ships, and it will go stale
 * SILENTLY — a new prefix simply stops being detected, which reads as clean.
 *
 * The backstop is that this dimension is NOT the only reader: the
 * `no_internal_term_leak` dimension applies the runtime's `findForbiddenMatches`
 * to the same prose, so an id from the runtime's five prefixes is caught twice
 * and an id from a NEW kind is caught by neither. Whoever adds an entity kind
 * must update BOTH lists. Both are named here so the search that finds one
 * finds the other.
 */
const ENTITY_ID_IN_PROSE_PATTERN = /\b(fac|opt|out|dec|risk|goal|edge|node)_[A-Za-z0-9_]+/;

/**
 * Content tokens of a phrase, for the coherence proxy: words of 4+ letters that
 * are not generic decision vocabulary. The stoplist is deliberately small and
 * generic — it removes words that appear in EVERY review regardless of topic,
 * which would make the overlap test pass for free.
 */
const COHERENCE_STOPWORDS: ReadonlySet<string> = new Set([
  'option', 'options', 'result', 'results', 'outcome', 'outcomes', 'decision',
  'analysis', 'leads', 'leading', 'about', 'could', 'would', 'which', 'their',
  'there', 'these', 'those', 'while', 'still', 'under', 'across', 'change',
  'changes', 'value', 'values', 'model', 'factor', 'factors', 'evidence',
  'current', 'currently', 'remains', 'suggests', 'points', 'percentage',
]);

function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !COHERENCE_STOPWORDS.has(w)),
  );
}

// ============================================================================
// The scorer
// ============================================================================

export interface DecisionReviewScoreOptions {
  /**
   * The parsed output object. When null (extraction failed) the caller applies
   * the extraction contract; this scorer is only ever handed a parsed object.
   */
  readonly output: Record<string, unknown>;
  readonly input: DecisionReviewEvalInput;
  readonly candidateLabel: string;
}

export function scoreDecisionReview(options: DecisionReviewScoreOptions): ScoreResult {
  const { output, input, candidateLabel } = options;
  const contract = servedContract();
  const dimensions: DimensionResult[] = [];

  // The corpora every absence dimension scans, computed once.
  const proseStrings = collectProseStrings(output).filter((s) => s.trim().length > 0);
  const allStrings = collectStrings(output).filter((s) => s.trim().length > 0);
  const proseBlob = proseStrings.join('\n');
  const proseBlobLower = proseBlob.toLowerCase();

  // ── PRODUCTION GUARD 1-4: the #645 runtime contract gate ────────────────
  // One call, four dimensions — the gate reports every violated rule, and the
  // eval splits them by the runtime's OWN enforce-vs-telemetry classification
  // (`COUNT_CAP_RULES`) rather than re-deciding which rules matter.
  const gate = checkDecisionReviewContract(output, { graph: input.graph });
  const rulesHit = new Set<DecisionReviewContractRule>(gate.violations.map((v) => v.rule));
  const observedFor = (rule: DecisionReviewContractRule): number | undefined =>
    gate.violations.find((v) => v.rule === rule)?.observed;

  dimensions.push(
    dim(
      'review_card_coverage',
      !rulesHit.has('missing_review_card'),
      'production-guard',
      rulesHit.has('missing_review_card')
        ? 'narrative_summary absent/empty — the composer emits NO review_card, so an analysed turn ships no review'
        : 'narrative_summary present; the primary review_card composes',
    ),
  );

  dimensions.push(
    dim(
      'no_fabricated_continuity',
      !rulesHit.has('fabricated_continuity_phrase'),
      'production-guard',
      rulesHit.has('fabricated_continuity_phrase')
        ? `R-CONT: ${observedFor('fabricated_continuity_phrase') ?? '?'} string(s) reference a prior exchange the input does not contain`
        : 'no invented conversational callbacks',
      allStrings.length,
      'output_strings',
    ),
  );

  // The runtime SKIPS this rule when the graph carries no id corpus
  // ("no corpus => cannot check", contract-gate.ts:206-208). The eval reports
  // that skip as NOT APPLICABLE rather than as a pass — a clean verdict from a
  // rule that never ran is the vacuity this pack exists to refuse.
  const graphIdCount = countGraphIds(input);
  // Corpus = the REFERENCES examined, not the ids available to check against.
  // A run with a rich graph and a review citing nothing examines nothing.
  const entityRefCount = countBiasEntityRefs(output);
  dimensions.push(
    graphIdCount === 0
      ? na(
          'entity_references_grounded',
          'production-guard',
          'the run graph carries no node/edge ids, so the runtime rule has no corpus and skips',
        )
      : dim(
          'entity_references_grounded',
          !rulesHit.has('ungrounded_entity_reference'),
          'production-guard',
          rulesHit.has('ungrounded_entity_reference')
            ? `${observedFor('ungrounded_entity_reference') ?? '?'} bias affected_elements reference ids absent from the graph`
            : `${entityRefCount} bias affected_element(s) checked against ${graphIdCount} graph id(s), all resolve`,
          entityRefCount,
          'entity_refs',
        ),
  );

  const capRulesHit = [...rulesHit].filter((r) => COUNT_CAP_RULES.has(r));
  // Corpus = the ITEMS the caps were applied to. Four rules applied to zero
  // items is not a check; `COUNT_CAP_RULES.size` would have reported 4 and
  // looked well-fed on an output carrying nothing.
  const cappedItemCount =
    (Array.isArray(output.bias_findings) ? output.bias_findings.length : 0) +
    (Array.isArray(output.decision_quality_prompts) ? output.decision_quality_prompts.length : 0) +
    (Array.isArray(output.key_assumptions) ? output.key_assumptions.length : 0) +
    objectKeyCount(output.scenario_contexts);
  dimensions.push(
    dim(
      'contract_caps_respected',
      capRulesHit.length === 0,
      'production-guard',
      capRulesHit.length === 0
        ? `${cappedItemCount} capped item(s) across bias_findings / decision_quality_prompts / key_assumptions / scenario_contexts, all within the tight prompt bound (${COUNT_CAP_RULES.size} rules applied)`
        : `tight-bound breach: ${capRulesHit.sort().join(', ')}`,
      cappedItemCount,
      'capped_items',
    ),
  );

  // ── PRODUCTION GUARD 5: schema completeness ─────────────────────────────
  const shape = performShapeCheck(output);
  dimensions.push(
    dim(
      'shape_valid',
      shape.valid,
      'production-guard',
      shape.valid ? 'passes the runtime block-parse shape check' : `shape errors: ${shape.errors.slice(0, 3).join('; ')}`,
    ),
  );

  // ── PRODUCTION GUARD 6: number grounding (±10% of an input value) ────────
  // The highest-weight dimension in the March graph-evaluator scorer (.15) and
  // the one it hand-wrote. This is the runtime function.
  //
  // `margin` is spliced in because `extractGroundedNumbers` reads it as a
  // legitimately-citable number (`shape-check.ts:151-152`) and fixtures do not
  // carry one — the margin is COMPUTED, exactly as `invokeDecisionReview`
  // computes it, so a fixture cannot hold a margin that disagrees with its own
  // winner/runner_up (the revived March pack did: 01-clear-winner recorded
  // 0.15 beside a 0.72/0.28 pair). Omitting it here would make every "leads by
  // N percentage points" sentence — the phrasing the prompt REQUIRES — read as
  // a fabricated number.
  const groundingWarnings = checkNumberGrounding(output, {
    ...input,
    margin: computeMargin(input),
  });
  const descriptiveNumbers = countDescriptiveNumbers(output);
  dimensions.push(
    descriptiveNumbers === 0
      ? na(
          'numbers_grounded',
          'production-guard',
          'the descriptive fields carry no numbers, so there is nothing to ground',
        )
      : dim(
          'numbers_grounded',
          groundingWarnings.length === 0,
          'production-guard',
          groundingWarnings.length === 0
            ? 'every number in a descriptive field is within ±10% of an input value'
            : `${groundingWarnings.length} ungrounded: ${groundingWarnings.slice(0, 2).join(' | ')}`,
          descriptiveNumbers,
          'descriptive_numbers',
        ),
  );

  // ── PRODUCTION GUARD 7: internal-term leak ──────────────────────────────
  // The same runtime-composed guard the routing pack uses, scoped to PROSE
  // fields so a grounded id in `affected_elements` is not read as a leak.
  const forbidden = findForbiddenMatches(proseBlob);
  dimensions.push(
    dim(
      'no_internal_term_leak',
      forbidden.length === 0,
      'production-guard',
      forbidden.length === 0 ? 'clean' : `hits: ${forbidden.slice(0, 4).join(', ')}`,
      proseStrings.length,
      'prose_strings',
    ),
  );

  // ── SERVED-PROMPT-DERIVED 1: banned lexicon ─────────────────────────────
  const lexiconHits = contract.bannedTerms.filter((t) => bannedTermRegex(t).test(proseBlob));
  dimensions.push(
    dim(
      'no_banned_lexicon',
      lexiconHits.length === 0,
      'served-prompt-derived',
      lexiconHits.length === 0
        ? `${proseStrings.length} prose string(s) clean against ${contract.bannedTerms.length} banned terms parsed from the served prompt`
        : `banned terms present: ${lexiconHits.join(', ')}`,
      proseStrings.length,
      'prose_strings',
    ),
  );

  // ── SERVED-PROMPT-DERIVED 2: internal vocabulary ────────────────────────
  const vocabHits = contract.internalVocabulary.filter((t) =>
    new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(proseBlob),
  );
  dimensions.push(
    dim(
      'no_internal_vocabulary',
      vocabHits.length === 0,
      'served-prompt-derived',
      vocabHits.length === 0
        ? `${proseStrings.length} prose string(s) clean against ${contract.internalVocabulary.length} internal terms parsed from the served prompt`
        : `internal vocabulary surfaced: ${vocabHits.join(', ')}`,
      proseStrings.length,
      'prose_strings',
    ),
  );

  // ── SERVED-PROMPT-DERIVED 3: raw probability decimals ───────────────────
  const decimalHits = proseStrings.flatMap(findRawProbabilityDecimals);
  dimensions.push(
    dim(
      'no_raw_probability_decimals',
      decimalHits.length === 0,
      'served-prompt-derived',
      decimalHits.length === 0
        ? 'no bare probability-band decimals in output strings'
        : `bare decimals: ${[...new Set(decimalHits)].slice(0, 4).join(', ')} (the prompt requires "62%", never "0.62")`,
      proseStrings.length,
      'prose_strings',
    ),
  );

  // ── SERVED-PROMPT-DERIVED 4: dashes ─────────────────────────────────────
  const dashHits = proseStrings.filter((s) => DASH_PATTERN.test(s));
  dimensions.push(
    !contract.bansEmDashes
      ? na('no_dashes', 'served-prompt-derived', 'the served prompt no longer bans em/en dashes')
      : dim(
          'no_dashes',
          dashHits.length === 0,
          'served-prompt-derived',
          dashHits.length === 0
            ? 'no em/en dashes in any output string'
            : `${dashHits.length} string(s) contain an em or en dash`,
          proseStrings.length,
          'prose_strings',
        ),
  );

  // ── SERVED-PROMPT-DERIVED 5: tone alignment ─────────────────────────────
  const coaching = readRecord(input.deterministic_coaching) ?? {};
  const toneRow = resolveToneRow(
    servedToneRows(),
    readString(coaching.readiness),
    readString(coaching.headline_type),
  );
  // TWO distinct vacuous cases, both NOT APPLICABLE rather than passes:
  //  (a) no row resolves — the run's readiness/headline_type is absent or
  //      unknown, so the served table says nothing about it. This is the case a
  //      response-only capture always lands in, and reporting it as a pass is
  //      what made the first baseline read 18/19.
  //  (b) a row resolves but its Forbidden-phrasing cell is literally `none`
  //      (the `ready | clear_winner` row). The tone IS known and the contract
  //      simply constrains nothing — the dimension cannot fail, so it must not
  //      claim a pass either.
  const toneHits = toneRow ? toneRow.forbidden.filter((p) => forbiddenPhraseRegex(p).test(proseBlob)) : [];
  dimensions.push(
    toneRow === null
      ? na(
          'tone_alignment',
          'served-prompt-derived',
          "no tone row matches this run's readiness/headline_type (deterministic_coaching absent or unknown vocabulary)",
        )
      : toneRow.forbidden.length === 0
        ? na(
            'tone_alignment',
            'served-prompt-derived',
            `the served table forbids no phrasing at tone "${toneRow.tone}"`,
          )
        : dim(
            'tone_alignment',
            toneHits.length === 0,
            'served-prompt-derived',
            toneHits.length === 0
              ? `${proseStrings.length} prose string(s) clean at tone "${toneRow.tone}" against ${toneRow.forbidden.length} forbidden phrasing(s)`
              : `forbidden at tone "${toneRow.tone}": ${toneHits.join(', ')}`,
            proseStrings.length,
            'prose_strings',
          ),
  );

  // ── EVAL-ASSERTION 1: entity ids in prose ───────────────────────────────
  const idHits = proseStrings.filter((s) => ENTITY_ID_IN_PROSE_PATTERN.test(s));
  dimensions.push(
    dim(
      'no_entity_ids_in_prose',
      idHits.length === 0,
      'eval-assertion',
      idHits.length === 0
        ? 'no raw entity ids in user-facing strings (id-bearing fields exempt per the prompt)'
        : `${idHits.length} user-facing string(s) carry a raw entity id`,
      proseStrings.length,
      'prose_strings',
    ),
  );

  // ── EVAL-ASSERTION 2: story_headlines key agreement ─────────────────────
  dimensions.push(scoreStoryHeadlineKeys(output, input));

  // ── EVAL-ASSERTION 3: story_headlines distinctiveness (ROADMAP 1.121) ───
  dimensions.push(scoreStoryHeadlineDistinctness(output));

  // ── EVAL-ASSERTION 4: scenario_contexts keyed on fragile edges ──────────
  dimensions.push(scoreScenarioContextKeys(output, input));

  // ── EVAL-ASSERTION 5: coherence of the primary risk ─────────────────────
  dimensions.push(scoreCoherence(output));

  // ── EVAL-ASSERTION 6: infeasible winner disclosed ───────────────────────
  dimensions.push(scoreInfeasibleWinnerDisclosure(output, input, proseBlobLower, proseStrings.length));

  // ── EVAL-ASSERTION 7: the anti-vacuity FLOOR ────────────────────────────
  const proseChars = proseBlob.trim().length;
  dimensions.push(
    dim(
      'substance_present',
      proseChars > 0,
      'eval-assertion',
      proseChars > 0
        ? `${proseStrings.length} user-facing string(s), ${proseChars} chars`
        : 'no user-facing prose at all — an empty review is a failed turn, not a clean one',
      proseStrings.length,
      'prose_strings',
    ),
  );

  return finaliseScore(candidateLabel, dimensions.map(demoteEmptyCorpusToNotApplicable));
}

/**
 * THE INVARIANT, ENFORCED IN ONE PLACE: a dimension that PASSED while examining
 * an EMPTY corpus did not pass — it could not look, and it must say so.
 *
 * Each dimension above already returns {@link na} for the inapplicability it can
 * see locally (no tone row, no graph ids, no numbers). This is the catch-all for
 * the case none of them can see individually: an output carrying NO user-facing
 * prose at all, where every prose-scanning dimension reports "clean" over
 * nothing. That is precisely the `degenerate_empty` control — structurally valid
 * keys, zero prose — and before this rule it produced FIVE vacuous passes that
 * the pack counted as measured.
 *
 * Applying it uniformly is deliberate: a per-dimension guard would have to be
 * remembered for each new dimension, which is the hand-maintained-mirror shape
 * this pack keeps finding. Here a new dimension inherits the rule by existing.
 * The reason string names the unit, so the NA row still explains itself.
 *
 * `substance_present` is exempt: it is the FLOOR, and an empty corpus is exactly
 * the condition it exists to FAIL on. Demoting it would delete the one
 * dimension that catches a degenerate output.
 */
function demoteEmptyCorpusToNotApplicable(d: DimensionResult): DimensionResult {
  if (d.name === 'substance_present') return d;
  if (d.status !== 'pass' || d.scanned === undefined || d.scanned > 0) return d;
  return {
    name: d.name,
    pass: true,
    status: 'not_applicable',
    source: d.source,
    detail: `NOT APPLICABLE — nothing to examine (0 ${d.scannedUnit ?? 'units'}); a clean verdict over an empty corpus is not a pass`,
  };
}

// ============================================================================
// Dimension implementations that need more than a line
// ============================================================================

/** How many bias `affected_elements` references the grounding rule inspected. */
function countBiasEntityRefs(output: Record<string, unknown>): number {
  let n = 0;
  for (const raw of Array.isArray(output.bias_findings) ? output.bias_findings : []) {
    const finding = readRecord(raw);
    if (!finding || !Array.isArray(finding.affected_elements)) continue;
    for (const ref of finding.affected_elements) {
      if (typeof ref === 'string' && ref.length > 0) n += 1;
    }
  }
  return n;
}

function countGraphIds(input: DecisionReviewEvalInput): number {
  let n = 0;
  for (const key of ['nodes', 'edges'] as const) {
    const arr = input.graph[key];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const r = readRecord(raw);
      if (r && typeof r.id === 'string' && r.id.length > 0) n += 1;
    }
  }
  return n;
}

/**
 * How many numbers the grounding rule actually inspected. The runtime's
 * `checkNumberGrounding` returns only WARNINGS, so a clean result is
 * indistinguishable from "there were no numbers to check" — precisely the
 * vacuity this instrument exists to expose. Recomputed here over the same
 * descriptive fields the runtime scans.
 */
/**
 * ⚠⚠ MIRROR OF UNEXPORTED RUNTIME STATE — GUARDED, NOT TRUSTED.
 *
 * `DESCRIPTIVE_FIELD_KEYS`, `NUMBER_PATTERN` and `PERCENTAGE_PATTERN` are
 * MODULE-PRIVATE in `src/cee/decision-review/shape-check.ts`
 * (:208, :212, :255-262). `checkNumberGrounding` returns only WARNINGS, so a
 * clean result is indistinguishable from "there were no numbers here" — and
 * that is exactly the vacuity `scanned` exists to expose. Counting what the
 * runtime WOULD have scanned therefore requires reproducing three private
 * constants.
 *
 * That is a hand-maintained mirror sitting INSIDE the anti-vacuity machinery —
 * trap 12 in the last place it should appear. If the runtime widened its
 * descriptive-field list or tightened its number regex, this counter would keep
 * returning a plausible non-zero number for a corpus the runtime no longer
 * scans, and the anti-vacuity assertion would pass while measuring the wrong
 * thing.
 *
 * It cannot be fixed properly from here: exporting the constants is a `src/`
 * change and this lane's file-set boundary forbids one. So the mirror is made
 * FAIL-LOUD instead — `decision-review-runtime-mirror.test.ts` reads
 * `shape-check.ts` as TEXT at test time and asserts these three literals match
 * the source bytes. Drift turns that test RED with the two versions printed.
 *
 * The clean fix (export the three constants and import them) belongs to the
 * next src-side decision_review lane.
 */
export const RUNTIME_DESCRIPTIVE_FIELDS = [
  'narrative_summary',
  'robustness_explanation',
  'readiness_rationale',
  'scenario_contexts',
  'flip_thresholds',
  'pre_mortem',
] as const;

/** MIRROR of shape-check.ts:208 `NUMBER_PATTERN`. Guarded — see above. */
export const RUNTIME_NUMBER_PATTERN_SOURCE =
  '(?<![a-zA-Z_\\-\\d])(-?\\d+(?:\\.\\d+)?)(?![a-zA-Z\\d])';
/** MIRROR of shape-check.ts:212 `PERCENTAGE_PATTERN`. Guarded — see above. */
export const RUNTIME_PERCENTAGE_PATTERN_SOURCE =
  '(?<![a-zA-Z_\\-\\d])(-?\\d+(?:\\.\\d+)?)%';

/**
 * How many numbers the runtime's grounding rule actually inspected.
 *
 * Reproduces the runtime's TWO-PASS scan (percentages first, then standalone
 * numbers not followed by `%`) with the runtime's own boundary-anchored
 * patterns. The first draft used a bare `/-?\d+(?:\.\d+)?/g`, which counts
 * numbers the runtime deliberately skips — digits inside ids like `opt_3`, and
 * every percentage twice — so the instrument overstated the corpus in exactly
 * the direction that makes a vacuous dimension look well-fed.
 */
function countDescriptiveNumbers(output: Record<string, unknown>): number {
  const numberRe = new RegExp(RUNTIME_NUMBER_PATTERN_SOURCE, 'g');
  const percentRe = new RegExp(RUNTIME_PERCENTAGE_PATTERN_SOURCE, 'g');
  const countIn = (text: string): number => {
    let n = 0;
    percentRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = percentRe.exec(text)) !== null) n += 1;
    numberRe.lastIndex = 0;
    while ((m = numberRe.exec(text)) !== null) {
      if (text[m.index + m[0].length] === '%') continue; // counted in pass 1
      n += 1;
    }
    return n;
  };

  let total = 0;
  for (const key of RUNTIME_DESCRIPTIVE_FIELDS) {
    if (!(key in output)) continue;
    for (const str of collectStrings(output[key])) total += countIn(str);
  }
  for (const raw of Array.isArray(output.bias_findings) ? output.bias_findings : []) {
    const bf = readRecord(raw);
    if (bf && typeof bf.description === 'string') total += countIn(bf.description);
  }
  return total;
}

/**
 * `story_headlines` keys must be EXACTLY the option ids of the run.
 *
 * Source: the served prompt's VALIDATION section — "story_headlines with
 * missing or extra option keys" is rejected downstream — and its keying rule
 * (`decision_review.txt:237-239`): key on `option_comparison`, falling back to
 * `winner.id` (and `runner_up.id`) when `option_comparison` is absent or empty.
 * The fallback is implemented because a single-option / degenerate run is a real
 * fixture case (`05-runner-up-null`), not a theoretical one.
 */
function scoreStoryHeadlineKeys(
  output: Record<string, unknown>,
  input: DecisionReviewEvalInput,
): DimensionResult {
  const comparison = input.isl_results.option_comparison ?? [];
  const expected = new Set<string>(
    comparison.length > 0
      ? comparison.map((o) => o.option_id).filter((id): id is string => typeof id === 'string')
      : [input.winner.id, ...(input.runner_up ? [input.runner_up.id] : [])],
  );
  const headlines = readRecord(output.story_headlines);
  if (headlines === null) {
    return dim(
      'story_headlines_match_options',
      false,
      'eval-assertion',
      'story_headlines is absent or not an object',
      expected.size,
      'option_keys',
    );
  }
  const actual = new Set(Object.keys(headlines));
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  const ok = missing.length === 0 && extra.length === 0;
  return dim(
    'story_headlines_match_options',
    ok,
    'eval-assertion',
    ok
      ? `all ${expected.size} option key(s) present, none extra`
      : `missing: [${missing.join(', ')}] extra: [${extra.join(', ')}]`,
    expected.size,
    'option_keys',
  );
}

/**
 * Distinct headlines per option.
 *
 * ROADMAP 1.121: the enricher once emitted four review_cards ALL titled "A
 * load-bearing assumption", which collided on dedupe and gave the canvas
 * nothing to focus. The composed card title derives from this field, so the
 * defect is measurable at its source. A single-option run cannot collide, so
 * the dimension passes trivially there — and says so, rather than pretending it
 * checked something.
 */
function scoreStoryHeadlineDistinctness(output: Record<string, unknown>): DimensionResult {
  const headlines = readRecord(output.story_headlines);
  const values = headlines
    ? Object.values(headlines).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  if (values.length < 2) {
    // A single-option run cannot collide. Reporting that as a PASS would let a
    // sparse fixture inflate the numerator with a check that could not fail.
    return na(
      'story_headlines_distinct',
      'eval-assertion',
      `only ${values.length} headline(s) — a collision is impossible, so nothing was tested`,
    );
  }
  const normalised = values.map((v) => v.trim().toLowerCase().replace(/\s+/g, ' '));
  const unique = new Set(normalised);
  const ok = unique.size === normalised.length;
  return dim(
    'story_headlines_distinct',
    ok,
    'eval-assertion',
    ok
      ? `${unique.size} distinct headline(s)`
      : `${normalised.length - unique.size} duplicate headline(s) — the 1.121 dedupe-collision defect`,
    values.length,
    'headlines',
  );
}

/**
 * `scenario_contexts` keys must be fragile-edge ids from the run.
 *
 * Source: the served prompt's VALIDATION section — "scenario_contexts keys not
 * present in fragile_edges" are rejected. Skipped (and SAID to be skipped) when
 * the run has no fragile edges to key on: there is no corpus, so there is
 * nothing to be wrong about.
 */
function scoreScenarioContextKeys(
  output: Record<string, unknown>,
  input: DecisionReviewEvalInput,
): DimensionResult {
  const fragileIds = new Set(
    (input.isl_results.fragile_edges ?? [])
      .map((e) => e.edge_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const contexts = readRecord(output.scenario_contexts);
  const keys = contexts ? Object.keys(contexts) : [];
  if (fragileIds.size === 0) {
    // Nothing to key ON and nothing keyed: there was nothing to be right about.
    if (keys.length === 0) {
      return na(
        'scenario_contexts_keyed_on_fragile_edges',
        'eval-assertion',
        'the run has no fragile edges and the review emitted no scenario_contexts — nothing to check',
      );
    }
    // Keys on a run with no fragile edges IS measurable, and every key is
    // ungrounded by construction. The corpus here is the keys themselves.
    return dim(
      'scenario_contexts_keyed_on_fragile_edges',
      false,
      'eval-assertion',
      `${keys.length} scenario_context(s) on a run with NO fragile edges — every key is ungrounded`,
      keys.length,
      'scenario_keys',
    );
  }
  const ungrounded = keys.filter((k) => !fragileIds.has(k));
  return dim(
    'scenario_contexts_keyed_on_fragile_edges',
    ungrounded.length === 0,
    'eval-assertion',
    ungrounded.length === 0
      ? `${keys.length} key(s) checked against ${fragileIds.size} fragile edge id(s), all present`
      : `keys absent from fragile_edges: ${ungrounded.join(', ')}`,
    keys.length,
    'scenario_keys',
  );
}

/**
 * COHERENCE — "one primary risk shared by narrative_summary, primary_risk,
 * readiness_rationale and pre_mortem. Vary wording across sections, not
 * substance." (`decision_review.txt:281-283`.)
 *
 * ⚠ THIS IS A LEXICAL PROXY FOR A SEMANTIC RULE, and says so in its detail
 * string. It asserts that each of the sibling fields shares at least one
 * CONTENT token with `primary_risk` (4+ letters, minus a small generic
 * stoplist). It CANNOT detect a review that repeats the risk's vocabulary while
 * changing its substance, and it CAN be satisfied by an unlucky coincidence.
 *
 * It is still worth having, in the direction that matters: the failure mode the
 * prompt is guarding against is a review whose sections talk about DIFFERENT
 * risks, and that failure has near-zero token overlap. Judging the semantic
 * version is the judge layer's job (`judge-seam.ts`), layered on top of this
 * floor — never replacing it.
 */
function scoreCoherence(output: Record<string, unknown>): DimensionResult {
  const robustness = readRecord(output.robustness_explanation);
  const primaryRisk = robustness ? readString(robustness.primary_risk) : null;
  if (primaryRisk === null || primaryRisk.trim().length === 0) {
    return dim(
      'primary_risk_coherent',
      false,
      'eval-assertion',
      'robustness_explanation.primary_risk is absent or empty — nothing for the other sections to cohere with',
    );
  }
  const riskTokens = contentTokens(primaryRisk);
  if (riskTokens.size === 0) {
    return dim(
      'primary_risk_coherent',
      false,
      'eval-assertion',
      'primary_risk carries no content tokens — coherence is unmeasurable, refused rather than passed',
    );
  }

  const siblings: Array<[string, string | null]> = [
    ['narrative_summary', readString(output.narrative_summary)],
    ['readiness_rationale', readString(output.readiness_rationale)],
  ];
  const preMortem = readRecord(output.pre_mortem);
  if (preMortem !== null) {
    // Optional field: only checked when the review chose to emit it.
    siblings.push(['pre_mortem', collectStrings(preMortem).join(' ')]);
  }

  const incoherent: string[] = [];
  let checked = 0;
  for (const [name, text] of siblings) {
    if (text === null || text.trim().length === 0) continue;
    checked += 1;
    const shared = [...contentTokens(text)].filter((t) => riskTokens.has(t));
    if (shared.length === 0) incoherent.push(name);
  }
  if (checked === 0) {
    return dim(
      'primary_risk_coherent',
      false,
      'eval-assertion',
      'no sibling section carried text to compare against primary_risk — refused rather than passed vacuously',
    );
  }
  return dim(
    'primary_risk_coherent',
    incoherent.length === 0,
    'eval-assertion',
    incoherent.length === 0
      ? `all ${checked} sibling section(s) share a content token with primary_risk (lexical proxy for the COHERENCE rule)`
      : `no shared content token with primary_risk in: ${incoherent.join(', ')}`,
    checked,
    'sibling_sections',
  );
}

/**
 * An infeasible leading option must be DISCLOSED, not narrated as a clean lead.
 *
 * Source: `DecisionReviewInvokeInput.winner.constraint_infeasible` /
 * `recommendation_suppressed` (`invoke.ts:107-115`) — "Set true when the leading
 * option violates a hard constraint … so the decision-review prompt does not
 * frame it as a clean recommendation."
 *
 * ⚠ HONEST SCOPE: unlike the lexicon and tone dimensions, this one is NOT
 * derived from the served prompt — v14 contains no disclosure vocabulary to
 * derive from (it predates the flag). The marker list below is therefore an
 * eval-assertion: a deliberately small set of words a disclosure must contain
 * SOMEWHERE in its prose. It can be satisfied by a review that uses the word
 * without meaning it, and it will miss a paraphrase outside the list. It fires
 * ONLY when the flag is set, so it can never affect a normal run — and it is the
 * flag's only measurable trace today. When the prompt learns the flag, this
 * dimension should be re-derived from the prompt and this note deleted.
 */
const INFEASIBILITY_MARKERS: readonly string[] = [
  'infeasible',
  'not feasible',
  'constraint',
  'violates',
  'rules out',
  'ruled out',
  'cannot be',
  'breaches',
];

function scoreInfeasibleWinnerDisclosure(
  _output: Record<string, unknown>,
  input: DecisionReviewEvalInput,
  proseBlobLower: string,
  proseCount: number,
): DimensionResult {
  const flagged =
    input.winner.constraint_infeasible === true || input.winner.recommendation_suppressed === true;
  if (!flagged) {
    return na(
      'infeasible_winner_disclosed',
      'eval-assertion',
      'the leading option is feasible, so there is no infeasibility to disclose',
    );
  }
  const hits = INFEASIBILITY_MARKERS.filter((m) => proseBlobLower.includes(m));
  return dim(
    'infeasible_winner_disclosed',
    hits.length > 0,
    'eval-assertion',
    hits.length > 0
      ? `infeasibility disclosed (marker: ${hits[0]})`
      : 'winner.constraint_infeasible is set but no output string discloses it — the review frames an infeasible option as a clean lead',
    proseCount,
    'prose_strings',
  );
}

// ============================================================================
// Dimension inventory — used by the anti-vacuity test and the report
// ============================================================================

/**
 * The dimensions that are ABSENCE checks: they pass when something is NOT
 * there, and therefore pass trivially when there is nothing to look at. Every
 * one of these must report a non-zero `scanned` on a good candidate — asserted
 * in `__tests__/decision-review-anti-vacuity.test.ts`.
 *
 * `infeasible_winner_disclosed` is deliberately ABSENT from this list: it is a
 * PRESENCE check (the disclosure must be there), and it is conditional, so a
 * zero corpus is its correct not-applicable state.
 */
export const ABSENCE_DIMENSIONS: readonly string[] = [
  'no_fabricated_continuity',
  'entity_references_grounded',
  'contract_caps_respected',
  'numbers_grounded',
  'no_internal_term_leak',
  'no_banned_lexicon',
  'no_internal_vocabulary',
  'no_raw_probability_decimals',
  'no_dashes',
  'tone_alignment',
  'no_entity_ids_in_prose',
];

/**
 * ONE NUMBER, ONE MEANING.
 *
 * An earlier draft let `scanned` mean two different things — sometimes the
 * CONTENT examined, sometimes the number of RULES applied — and exported a
 * `RULE_COUNT_DIMENSIONS` list so readers could tell which. That split was the
 * problem, not the fix: `no_banned_lexicon` reporting `scanned: 10` on an
 * output with no prose at all looked thoroughly measured, when what it had
 * actually examined was nothing. Ten rules times zero strings is zero checks.
 *
 * `scanned` is now ALWAYS the CONTENT the dimension inspected — prose strings,
 * capped items, entity references, headlines, numbers. Rule-set sizes live in
 * the `detail` string ("clean against 10 banned terms"), where they inform
 * without inflating. The anti-vacuity assertion therefore needs no per-dimension
 * exceptions and no reader-side interpretation.
 */

/**
 * The previous release carried a `PACK_LEVEL_ABSENCE_DIMENSIONS` escape hatch so
 * `tone_alignment` could report `scanned: 0` on confident-tone runs without
 * failing the anti-vacuity assertion. THAT ESCAPE HATCH WAS THE BUG: a
 * zero-corpus tone row was not a tolerable pass, it was an unmeasured dimension
 * being counted as a measured one. It is gone — such a row is now
 * `not_applicable`, so the rule below needs no exceptions at all:
 *
 *   EVERY MEASURED dimension that reports a `scanned` count reports a NON-ZERO
 *   one. No per-dimension carve-outs.
 */

/** Every dimension the scorer emits, in emission order. */
export const DECISION_REVIEW_DIMENSIONS: readonly string[] = [
  'review_card_coverage',
  'no_fabricated_continuity',
  'entity_references_grounded',
  'contract_caps_respected',
  'shape_valid',
  'numbers_grounded',
  'no_internal_term_leak',
  'no_banned_lexicon',
  'no_internal_vocabulary',
  'no_raw_probability_decimals',
  'no_dashes',
  'tone_alignment',
  'no_entity_ids_in_prose',
  'story_headlines_match_options',
  'story_headlines_distinct',
  'scenario_contexts_keyed_on_fragile_edges',
  'primary_risk_coherent',
  'infeasible_winner_disclosed',
  'substance_present',
];
