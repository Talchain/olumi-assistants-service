/**
 * THE UNSET OPTION-EFFECT DISCLOSURE — the analyse turn tells the user which
 * of their option effects the run had no value for.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES (measured on CEE staging 2026-08-28, 15 fresh
 * authenticated draws).
 *
 * 7 of 9 first clicks returned `status: needs_user_input` carrying
 * `MISSING_OPTION_VALUE` blockers while `may_run: true` and the analysis
 * returned results anyway. The analyse turn's own sentence said NOTHING about
 * those unset option effects in all 7. In 3 of 15 it went further and named a
 * decisive driver that was ITSELF an unset factor:
 *
 *   "keep what we have came out ahead in 82% of runs … because Sales Rep
 *    Adoption Rate is the strongest driver"
 *
 * — where that factor's value for the challenger option was never set.
 *
 * ⚠ THE ANALYSIS IS NOT WRONG AND THIS IS NOT A GATE DEFECT. `may_run: true`
 * is correct: `analysis-ready-core.ts::isWaivableByComputeDiscard` deliberately
 * lets the run proceed, because a per-(option,factor) gap is a no-op at the
 * compute rather than a refusal. The product is honest INTERNALLY — it flags
 * the unset slot as a blocker — and silent in the one place the user reads.
 * The defect is the SILENCE, so the fix is a sentence, not a gate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY EACH CLAUSE IS THE WEAKEST TRUE ONE, AND WHAT LICENSES IT.
 *
 *   1. "ran without a value for how “X” affects “Y”" — the `MISSING_OPTION_VALUE`
 *      blocker's own fact, carried, not re-derived. The blocker is minted per
 *      option→factor edge and carries `option_label` + `factor_label`; 18/18
 *      observed blockers carried both. Nothing new is computed here.
 *
 *   2. "so that option was analysed as leaving it unchanged" — licensed at the
 *      PRODUCER's bytes, and it is the weakest statement that covers every case.
 *      PLoT strips every edge incident to an `option`/`decision`/`constraint`
 *      node before the graph reaches the engine (`plot-lite-service`
 *      `src/normalisation/option-filter.ts:93-97`), so `option.interventions` is
 *      the ONLY channel by which an option touches a factor. No intervention key
 *      ⇒ the option applies no change to that factor. Full stop.
 *
 *      ⚠ AND THE STRONGER SENTENCE THIS DELIBERATELY DOES NOT SAY. ISL does one
 *      of THREE things with such a factor (`Inference-Service-Layer`
 *      `src/services/robustness_analyzer_v2.py:1428-1452`): SAMPLES it every
 *      iteration when it carries `parameter_uncertainty`, HOLDS it at
 *      `observed_state.value` when it is a root, or RECOMPUTES it from its
 *      parents. Asserting which one occurred would be a claim this module cannot
 *      support, so it asserts only what is true of all three: the OPTION does not
 *      move it. Naming a value, a magnitude or a direction is out of scope by
 *      construction — there is no number in this copy at all beyond an integer
 *      count.
 *
 *      ⚠ IT ALSO DOES NOT SAY "that factor cannot tell the options apart",
 *      which was the first draft and is FALSE in the common case: if a SIBLING
 *      option does set the factor, the arms genuinely do differ on it. The true
 *      statement is about the one option, not about the comparison.
 *
 *   3. "Set that value and run the analysis again to see whether the comparison
 *      changes." — a repair, deliberately non-committal. It does not say the
 *      result is wrong (it is not), and does not promise the result will move.
 *
 * ⚠ IT MAY NOT TRIP THE LEADER OR STABILITY VOCABULARIES. This suffix ships on
 * withheld turns too, so copy reaching for "leads"/"ahead"/"best" would be
 * replaced wholesale by `leading-option-egress-guard.ts`; and copy reaching for
 * "stable"/"robust"/"little sensitivity" would be SUPPRESSED by
 * `compose/defaulted-value-egress.ts::findStabilityAssertion` on exactly the
 * runs it exists to serve. {@link UNSET_EFFECT_DISCLOSURE_SURVIVES_EGRESS} is
 * the build-time probe that fails the module rather than letting that ship
 * silently.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE PIECES OF PLUMBING ANY run_analysis SUFFIX NEEDS (the sibling
 * `intake-option-disclosure.ts` states this best, and it is stated again here
 * because a disclosure missing any one of them is INERT in production — it
 * composes correctly, fails the registry-side egress allowlist, and the user
 * silently receives the locked template instead):
 *
 *   - {@link UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC} — the grammar the allowlist
 *     admits, built by escaping THE VERY CONSTANTS the builder emits;
 *   - {@link UNSET_OPTION_EFFECT_DISCLOSURE_MAX_CHARS} — the length budget,
 *     DERIVED from the builder's own worst case, never hand-estimated;
 *   - {@link survivesEgress} — the per-call survival check, compiled from the
 *     same RE_SRC the allowlist compiles, which degrades a label-naming form to
 *     the count-only form rather than losing the whole disclosure.
 */

import { sanitiseLabel } from '../context/enrichment-graph-labels.js';
import { passesAssistantTextContentDefences } from './assistant-text-defences.js';
import type { CanonicalReadinessIssue } from '../../orchestrator/tools/analysis-ready-helper.js';

/**
 * Longest label this disclosure will quote. `sanitiseLabel` imposes no length
 * bound of its own, so an adversarially long label would blow the egress budget
 * and silently revert the summary to the locked template. Mirrors
 * {@link INTAKE_OPTION_LABEL_MAX_CHARS} in the sibling module.
 */
export const UNSET_EFFECT_LABEL_MAX_CHARS = 60;

/**
 * One (option, factor) pair the run had no value for.
 *
 * `factor_id` is OPTIONAL and its absence is not an error: the blocker type
 * declares it optional, and a pair without one simply cannot participate in the
 * named-driver cross-reference (it is still named in the sentence). Treating a
 * missing id as "no unset effect" would be the fail-OPEN direction and is
 * exactly what {@link unsetOptionEffectFactorIds} avoids by only ever ADDING
 * ids it actually holds.
 */
export interface UnsetOptionEffect {
  readonly option_id: string;
  readonly option_label?: string;
  readonly factor_id?: string;
  readonly factor_label?: string;
}

/**
 * Collect the unset option effects a run PROCEEDED PAST, from the readiness
 * assessment's own blockers.
 *
 * ⭐ CONSULTED, NOT RE-DERIVED (trap 12). Nothing here models which
 * option→factor pairs are unset — that is `assessCanonicalAnalysisReadiness`'s
 * job and it is the estate's single readiness authority. A rival predicate
 * beside it is this codebase's most expensive defect class. This function only
 * SELECTS and RESHAPES.
 *
 * Three filters, each answering a different question:
 *
 *   - `code === 'MISSING_OPTION_VALUE'` — the per-(option,factor) axis, and
 *     ONLY it. Every other blocker code means something else is wrong (an
 *     unreadable value, an unmapped option), and a sentence claiming "no value
 *     was set" about a user's £250,000 would be the exact falsehood
 *     `analysis-ready-core.ts` warns about at its `WAIVABLE_BY_EXCLUSION` set.
 *
 *   - `waived_by_exclusion !== true` — an option the run is DROPPING is already
 *     spoken for, correctly, by `scaffold-disclosure.ts`'s omission sentence.
 *     Disclosing it again here would put two sentences about one option on one
 *     turn, each true and together confusing.
 *
 *   - membership in `analysedOptionIds` — the option must actually have reached
 *     the returned comparison. This is the same positive-control shape as
 *     `partitionScaffoldedByAnalysisPresence`: an ABSENCE is only asserted when
 *     a PRESENCE was seen, so an EMPTY set means "not derivable" and does NOT
 *     filter. Disclosing is the fail-safe direction here — the sentence makes
 *     no claim about the result, only about what the user did not set.
 */
export function collectUnsetOptionEffects(
  blockingIssues: readonly CanonicalReadinessIssue[] | undefined,
  analysedOptionIds?: ReadonlySet<string>,
): readonly UnsetOptionEffect[] {
  if (!Array.isArray(blockingIssues)) return [];
  const canFilterByPresence =
    analysedOptionIds !== undefined && analysedOptionIds.size > 0;

  const seen = new Set<string>();
  const effects: UnsetOptionEffect[] = [];
  for (const issue of blockingIssues) {
    if (issue.code !== 'MISSING_OPTION_VALUE') continue;
    if (issue.waived_by_exclusion === true) continue;
    const optionId = issue.option_id;
    if (typeof optionId !== 'string' || optionId.length === 0) continue;
    if (canFilterByPresence && !analysedOptionIds.has(optionId)) continue;

    // Dedupe per (option, factor). The assessor suppresses its own duplicates
    // on the strict-encoder axis, but two issue ids over one pair would
    // otherwise inflate the count the user reads.
    const key = `${optionId} ${issue.factor_id ?? issue.factor_label ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    effects.push({
      option_id: optionId,
      ...(issue.option_label !== undefined ? { option_label: issue.option_label } : {}),
      ...(issue.factor_id !== undefined ? { factor_id: issue.factor_id } : {}),
      ...(issue.factor_label !== undefined ? { factor_label: issue.factor_label } : {}),
    });
  }
  return effects;
}

/**
 * The factor ids among the collected effects, for the NAMED-DRIVER suppression
 * in `analysis-result-headline.ts`.
 *
 * Derived from the SAME records the sentence is built from, so the disclosure
 * and the driver suppression can never disagree about which factors are unset —
 * two authorities over one fact is the defect class this estate pays for most
 * often (trap 21).
 */
export function unsetOptionEffectFactorIds(
  effects: readonly UnsetOptionEffect[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const effect of effects) {
    const id = effect.factor_id?.trim();
    if (id !== undefined && id.length > 0) ids.add(id);
  }
  return ids;
}

// ── THE COPY ────────────────────────────────────────────────────────────────
// Every constant below is consumed BOTH by the builder and by the grammar, so a
// copy edit that breaks the allowlist breaks this module's own build-time probe
// loudly instead of reverting the user-facing summary to the locked template.

const SINGULAR_LEAD = ' This analysis ran without a value for';
const NAMED_INFIX_OPEN = ' how ';
const NAMED_INFIX_MID = ' affects ';
const SINGULAR_GENERIC_SUBJECT = ' one option effect';
const SINGULAR_TAIL_NAMED = ', so that option was analysed as leaving it unchanged.';
const SINGULAR_TAIL_GENERIC =
  ', so that option was analysed as leaving that factor unchanged.';
const SINGULAR_REPAIR =
  ' Set that value and run the analysis again to see whether the comparison changes.';

const PLURAL_LEAD_PREFIX = ' This analysis ran without values for ';
const PLURAL_LEAD_SUFFIX = ' option effects';
const PLURAL_NAMED_PREFIX = ', including how ';
const PLURAL_TAIL =
  ', so those options were analysed as leaving those factors unchanged.';
const PLURAL_REPAIR =
  ' Set those values and run the analysis again to see whether the comparison changes.';

/** Quote style matches the sibling intake disclosure (curly, so the slot is `[^”]`). */
const quoted = (label: string): string => `“${label}”`;

interface NamedPair {
  readonly option: string;
  readonly factor: string;
}

function composeDisclosure(count: number, named: NamedPair | null): string {
  if (count === 1) {
    return named === null
      ? SINGULAR_LEAD + SINGULAR_GENERIC_SUBJECT + SINGULAR_TAIL_GENERIC + SINGULAR_REPAIR
      : SINGULAR_LEAD +
          NAMED_INFIX_OPEN +
          quoted(named.option) +
          NAMED_INFIX_MID +
          quoted(named.factor) +
          SINGULAR_TAIL_NAMED +
          SINGULAR_REPAIR;
  }
  const lead = `${PLURAL_LEAD_PREFIX}${count}${PLURAL_LEAD_SUFFIX}`;
  return named === null
    ? lead + PLURAL_TAIL + PLURAL_REPAIR
    : lead +
        PLURAL_NAMED_PREFIX +
        quoted(named.option) +
        NAMED_INFIX_MID +
        quoted(named.factor) +
        PLURAL_TAIL +
        PLURAL_REPAIR;
}

/**
 * A label safe to quote, or null to force the count-only form. Bounded by
 * {@link UNSET_EFFECT_LABEL_MAX_CHARS} and passed through the same
 * `sanitiseLabel` every other user-label surface uses.
 */
function safeLabel(label: string | undefined): string | null {
  if (typeof label !== 'string') return null;
  const clean = sanitiseLabel(label, '');
  if (clean === null) return null;
  const trimmed = clean.trim();
  if (trimmed.length === 0 || trimmed.length > UNSET_EFFECT_LABEL_MAX_CHARS) return null;
  return trimmed;
}

/**
 * ⭐ THE builder. Returns `''` for an empty list — the NO-DEFAULTS-⇒-NOT-ONE-BYTE
 * rule the sibling egress states: the product must never invent a caveat about a
 * run that left nothing unset, which is the mirror-image dishonesty of the
 * defect this closes (trap 22b — one predicate, two harms).
 *
 * Names the FIRST pair only. A disclosure that listed every pair stops being a
 * sentence and becomes a table; the count carries the magnitude, and one named
 * example gives the user somewhere concrete to start.
 */
export function buildUnsetOptionEffectDisclosure(
  effects: readonly UnsetOptionEffect[],
): string {
  if (effects.length === 0) return '';
  const count = Math.min(effects.length, 999);

  const first = effects[0] as UnsetOptionEffect;
  const option = safeLabel(first.option_label);
  const factor = safeLabel(first.factor_label);
  const named: NamedPair | null =
    option !== null && factor !== null ? { option, factor } : null;

  const composed = composeDisclosure(count, named);
  // Degrade to the count-only form rather than lose the whole disclosure: a
  // label that would trip the shared content defences (an internal id smuggled
  // into a label, say) must not cost the user the entire sentence.
  if (named !== null && !survivesEgress(composed)) {
    return composeDisclosure(count, null);
  }
  return composed;
}

/**
 * True when a composed suffix would SURVIVE the registry-side egress:
 * single-line, matches this module's own published grammar exactly, and passes
 * the shared content defences. Compiled from
 * {@link UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC} — the SAME source the allowlist
 * compiles — so builder/grammar drift fails loudly here instead of silently
 * downgrading every disclosure-bearing summary at the wire.
 */
function survivesEgress(suffix: string): boolean {
  if (suffix.includes('\n') || suffix.includes('\r')) return false;
  if (!SUFFIX_EXACT_REGEX().test(suffix)) return false;
  return passesAssistantTextContentDefences(suffix);
}

let suffixExactRegex: RegExp | null = null;
function SUFFIX_EXACT_REGEX(): RegExp {
  suffixExactRegex ??= new RegExp(`^(?:${UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC})$`);
  return suffixExactRegex;
}

/** Local regex-literal escape (kept local to avoid an import cycle). */
function escapeForRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LABEL_SLOT = `“[^”\\n]{1,${UNSET_EFFECT_LABEL_MAX_CHARS}}”`;
const NAMED_PAIR_RE =
  `${escapeForRegex(NAMED_INFIX_OPEN)}${LABEL_SLOT}` +
  `${escapeForRegex(NAMED_INFIX_MID)}${LABEL_SLOT}`;

/**
 * Grammar source for the disclosure suffix, consumed by the registry-side
 * egress allowlist (`isAllowedRunAnalysisAssistantText`) and by this module's
 * own survival probe. Mirrors the FOUR shapes the builder can emit: singular
 * named / singular count-only / plural named / plural count-only. Every fixed
 * sentence is escaped from the very constants the builder emits, and the label
 * slot interpolates {@link UNSET_EFFECT_LABEL_MAX_CHARS} rather than
 * hand-mirroring a `{1,N}`.
 *
 * IT CANNOT MATCH THE EMPTY STRING — every branch requires a lead-in — which the
 * anchored template branch of the allowlist depends on.
 */
export const UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC =
  '(?:' +
  // Singular: named pair, or count-only.
  escapeForRegex(SINGULAR_LEAD) +
  '(?:' +
  `${NAMED_PAIR_RE}${escapeForRegex(SINGULAR_TAIL_NAMED)}` +
  '|' +
  `${escapeForRegex(SINGULAR_GENERIC_SUBJECT)}${escapeForRegex(SINGULAR_TAIL_GENERIC)}` +
  ')' +
  escapeForRegex(SINGULAR_REPAIR) +
  '|' +
  // Plural: `\d{1,3} option effects`, optionally naming the first pair.
  escapeForRegex(PLURAL_LEAD_PREFIX) +
  '\\d{1,3}' +
  escapeForRegex(PLURAL_LEAD_SUFFIX) +
  `(?:${escapeForRegex(PLURAL_NAMED_PREFIX)}${LABEL_SLOT}` +
  `${escapeForRegex(NAMED_INFIX_MID)}${LABEL_SLOT})?` +
  escapeForRegex(PLURAL_TAIL) +
  escapeForRegex(PLURAL_REPAIR) +
  ')';

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * builder's own worst-case output (never hand-estimated), so an honest
 * disclosure cannot silently knock the summary back to the locked template on
 * length.
 *
 * Worst case: the plural NAMED form with both labels at the cap and a
 * three-digit count.
 */
export const UNSET_OPTION_EFFECT_DISCLOSURE_MAX_CHARS = composeDisclosure(999, {
  option: 'x'.repeat(UNSET_EFFECT_LABEL_MAX_CHARS),
  factor: 'y'.repeat(UNSET_EFFECT_LABEL_MAX_CHARS),
}).length;

/**
 * BUILD-TIME PROBE — this module's copy must survive its own egress.
 *
 * Evaluated at module load, so a copy edit that breaks the grammar or the
 * budget throws at import rather than degrading the wire. Without it the only
 * symptom of a broken disclosure is a telemetry rate nobody had a reason to
 * look at. Same construction as the sibling `intake-option-disclosure.ts`.
 *
 * The leader- and stability-vocabulary halves are checked in this module's test
 * rather than here, to avoid import cycles through the compose/ surfaces that
 * import this coaching layer.
 */
export const UNSET_EFFECT_DISCLOSURE_SURVIVES_EGRESS: true = (() => {
  const shapes: readonly string[] = [
    composeDisclosure(1, null),
    composeDisclosure(1, { option: 'Keep what we have', factor: 'Sales Rep Adoption Rate' }),
    composeDisclosure(2, null),
    composeDisclosure(3, { option: 'Keep what we have', factor: 'Sales Rep Adoption Rate' }),
    composeDisclosure(999, {
      option: 'x'.repeat(UNSET_EFFECT_LABEL_MAX_CHARS),
      factor: 'y'.repeat(UNSET_EFFECT_LABEL_MAX_CHARS),
    }),
  ];
  for (const shape of shapes) {
    if (!survivesEgress(shape)) {
      throw new Error(
        `unset-option-effect-disclosure: composed suffix does not survive its own ` +
          `published grammar — the allowlist would reject it and the user would ` +
          `silently receive the locked template. Offending shape: ${shape}`,
      );
    }
    if (shape.length > UNSET_OPTION_EFFECT_DISCLOSURE_MAX_CHARS) {
      throw new Error(
        `unset-option-effect-disclosure: composed suffix exceeds its own derived ` +
          `budget (${shape.length} > ${UNSET_OPTION_EFFECT_DISCLOSURE_MAX_CHARS}).`,
      );
    }
  }
  return true as const;
})();
