/**
 * THE WITHHELD-SEPARABILITY DISCLOSURE — the run turn says WHY it put nothing
 * forward.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GAP, MEASURED AT `d536aae1` (CEE `staging`).
 *
 * `analysis-result-headline.ts:1389` computes a {@link SeparabilityVerdict}
 * carrying `separation` and `contenders`; `:1409-1413` withholds the headline
 * and DISCARDS both. The handler composes `headline ?? template`, so on a run
 * whose ranking CEE itself judged unsupportable the entire user-facing account
 * is the locked template — *"Ran analysis on your current scenario."*
 *
 * Six disclosure suffixes already ride that template. Every one is about INPUT
 * QUALITY (scaffolded values, constraint gaps, missing intake options, unset
 * option effects, node participation). **None speaks to the VERDICT.** So the
 * person is told what was done and never why nothing came of it — the shape
 * #1627 named on the neighbouring axis: *"True, causeless, actionless,
 * conversation over."*
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ WHY THIS IS A NEW FAMILY AND NOT A WIRING CHANGE — THE TWO SEPARATION
 * AUTHORITIES ANSWER DIFFERENT QUESTIONS ON DISJOINT POPULATIONS (trap 21).
 *
 * `compose/withheld-reason-tail.ts` already ships two separation voices
 * (`separation_not_evaluated`, `separation_near_tie`), landed by #1627. It
 * would be tidy to route this population into them. It is wrong:
 *
 *   THOSE   are driven by `separationWithholdFromRobustness` — ISL's
 *           `enrichment.robustness` — and answer *"did the engine establish,
 *           or report, a tie?"*. They are reached only from the EXPLANATION
 *           handlers (`turn-executor.ts`, `isExplanationHandler && …`).
 *   THIS    is driven by `isFieldUnseparable` — CEE's OWN field-shape verdict
 *           — and answers *"is the ordering supportable as a property of the
 *           model rather than of this draw?"*.
 *
 * And they cannot be merged, because #1254 placed this gate AFTER the near-tie
 * authority on purpose (`analysis-result-headline.ts:1367-1378`): it fires ONLY
 * where near-tie copy did not, i.e. where ISL's `near_tie.is_tie` is false. So
 * the existing near-tie voice would never fire on this population even if it
 * were wired to the run turn. Naming them apart is the design.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ FOUR THINGS THIS COPY MAY NOT SAY, EACH REFUSED FOR A MEASURED REASON.
 *
 *   1. THE SEPARATION FIGURE. `assistant-text-defences.ts` applies
 *      `RAW_DECIMAL_REGEX = /\d+\.\d+/` to the WHOLE assistant_text, so
 *      emitting `0.1158` would get the entire disclosure-bearing summary
 *      rejected at egress and silently replaced by the locked template. The
 *      integer `contenders` is the user-meaningful value that CAN ship — and it
 *      is the better one anyway: a threshold distance is jargon, "three options
 *      finished level" is a fact a person can act on.
 *
 *   2. A LEADING OPTION, named or implied — and no SHAPE that varies with any
 *      option's hidden position (the #743 oracle lesson, recorded in
 *      `withheld-reason-tail.ts`). The output varies with ONE number, the
 *      contender count, which is a property of the FIELD and of no option.
 *      There is nothing to probe for.
 *
 *   3. "RUN IT AGAIN" — or its opposite, "running it again will not separate
 *      them" (the sibling near-tie voice's prescription). Neither is measured
 *      on THIS population, and #1254's own evidence points away from the
 *      second: one brief, run 15 times on one build, named FOUR different
 *      winners. Borrowing a neighbouring population's prescription is how the
 *      estate ships copy that is true where its author was looking.
 *
 *   4. A NAMED UNQUANTIFIED NODE as the repair. ISL's `defaulted_root_node_ids`
 *      does not reach CEE at all (measured: 0 files, against a contrast control
 *      of `inference_warnings` at 32) — and it would be the wrong repair if it
 *      did. Supplying those values is measured to leave win probabilities and
 *      separation BIT-IDENTICAL across five real captured graphs
 *      (`WHY-NO-RECOMMENDATION-ROOT-CAUSE.md` §2): the delta is a constant
 *      offset shared by every option, and a constant offset cannot move an
 *      argmax. Copy prescribing it would promise a repair that provably does
 *      not work — manufactured confidence wearing a disclosure's clothes.
 *
 * WHAT IT SAYS INSTEAD is the one repair that is both true and available: the
 * person. What separates two options the model cannot tell apart is a
 * preference, and preferences are theirs. That is the same move
 * `SEPARATION_NEAR_TIE_TEXT` makes, and it is a coaching step rather than a
 * consolation prize for a failed computation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE PIECES OF PLUMBING ANY `run_analysis` SUFFIX NEEDS, stated by
 * `intake-option-disclosure.ts` and reproduced here rather than re-invented:
 * a published grammar ({@link SEPARABILITY_DISCLOSURE_RE_SRC}), a budget
 * derived from the builder's own worst case
 * ({@link SEPARABILITY_DISCLOSURE_MAX_CHARS}), and a per-call survival probe.
 * A disclosure missing any of them composes correctly, fails the registry-side
 * egress allowlist, and the user silently receives the locked template.
 *
 * PURE. Never throws at call time, never mutates its input.
 */

import { passesAssistantTextContentDefences } from './assistant-text-defences.js';

/**
 * The already-computed facts behind a separability withhold.
 *
 * ⚠ NAMED FOR THE WITHHOLD, NOT FOR THE RUN. This is NOT "the run's
 * separation": the gate is consulted on one path only, so a `null` here means
 * *the separability gate did not withhold*, never *the field was separable* and
 * never *nothing was measured*. Reading it as the latter would be trap 20 — an
 * honest scope generalised at the moment it is recorded.
 */
export interface SeparabilityWithhold {
  /** P1's statistic at the withhold. Carried for telemetry; NEVER rendered (see §1). */
  readonly separation: number;
  /** P2's count: options level with the leader, leader included. `>= 2` by the gate. */
  readonly contenders: number;
}

/**
 * The gate's own conjunction guarantees `contenders >= 2`
 * (`option-separability.ts`: `separation < MIN_FIELD_SEPARATION && contenders >= 2`).
 * Below it the sentence would be claiming a crowd of one, so the builder is
 * silent instead. Silence beats a hedge — the same posture as the sibling
 * module's empty-`missing` guard, and defensive rather than decorative.
 */
const MIN_CONTENDERS = 2;

// ── The copy. Held as constants so the grammar below can be escaped FROM them,
// ── and a copy edit therefore breaks this module's probe loudly instead of the
// ── wire silently.
/**
 * ⚠ THE FIRST DRAFT OF THIS CLAUSE READ *"{N} options scored highest in almost
 * the same share of runs"*, and `textNamesLeadingOption` REJECTED IT — measured,
 * not predicted. *"scored highest"* is this module's neighbourhood's own LEAD
 * CLAUSE anchor (`LEAD_CLAUSE_RE_SRC`: *"scored highest against your goal in N%
 * of runs of this model"*), so the sentence read as a leader claim to the very
 * guard that protects the withheld path. It would have been replaced wholesale
 * by `projectExplanationAnswerForWithheldClaim` on exactly the turns it exists
 * to serve.
 *
 * The replacement is the sibling voice's OWN opening — `SEPARATION_NEAR_TIE_TEXT`
 * in `compose/withheld-reason-tail.ts` reads *"These options came out too close
 * together on this run to tell apart"* — so the two separation surfaces open on
 * the same words, and this one is carried by copy the estate has already put
 * through its load-time probe. Copy is reused, not minted, wherever it exists.
 */
const LEAD_IN_TAIL = ' options came out too close together on this run to tell apart';
const CONSEQUENCE =
  ', so the order between them reflects this draw rather than your model, and no option can ' +
  'be put forward yet.';
const REPAIR = ' Tell me what matters most to you between them and I will work from that.';

/**
 * ⚠ THE CONSEQUENCE CLAUSE IS REUSED, NOT MINTED. *"no option can be put
 * forward yet"* is `NO_OPTION_YET` from `compose/withheld-reason-tail.ts`,
 * which chose those words over `recommend*` — banned outright by
 * `FORBIDDEN_HEADLINE_VOCABULARY_REGEX` — and over "recommendation", which
 * would assert the product had one. Two surfaces speak about one withholding
 * and a user can reach either, so they end on the same words by construction.
 */
function composeDisclosure(contenders: number): string {
  return ` ${contenders}${LEAD_IN_TAIL}${CONSEQUENCE}${REPAIR}`;
}

/**
 * ⭐ THE builder. Returns `''` whenever the separability gate is not the cause
 * of the withhold, so the pairing between evidence and sentence is made HERE,
 * in the module that owns the copy, rather than at a caller that will not be
 * re-read.
 *
 * @param withhold the verdict read off {@link HeadlineDescriptor}, i.e. off the
 *   SAME computation the withhold was made from. The handler must never re-run
 *   `isFieldUnseparable` to obtain it: that would be a second derivation of a
 *   meaning with exactly one owner (CLAUDE.md trap 12), and the sentence and
 *   the withhold could then describe different fields.
 */
export function buildSeparabilityDisclosure(
  withhold: SeparabilityWithhold | null | undefined,
): string {
  if (withhold === null || withhold === undefined) return '';
  const { contenders } = withhold;
  if (!Number.isInteger(contenders) || contenders < MIN_CONTENDERS) return '';
  const suffix = composeDisclosure(contenders);
  // A composed suffix that would not survive its own published grammar must
  // not ship: the allowlist would reject the WHOLE summary and the person would
  // receive the locked template — strictly worse than today. Unreachable while
  // the constants and the grammar agree, which is what the load probe pins.
  return survivesEgress(suffix) ? suffix : '';
}

/**
 * True when a composed suffix would SURVIVE the registry-side egress:
 * single-line, matches this module's own published grammar exactly, and passes
 * the shared content defences. Compiled from
 * {@link SEPARABILITY_DISCLOSURE_RE_SRC} — the SAME source the allowlist
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
  suffixExactRegex ??= new RegExp(`^(?:${SEPARABILITY_DISCLOSURE_RE_SRC})$`);
  return suffixExactRegex;
}

/** Local regex-literal escape (kept local to avoid an import cycle). */
function escapeForRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Grammar source for the disclosure suffix, consumed by the registry-side
 * egress allowlist (`isAllowedRunAnalysisAssistantText`, via
 * `TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS`) and by this module's own survival
 * probe. Every fixed sentence is escaped from THE VERY CONSTANTS the builder
 * emits, so a copy edit breaks the probe loudly instead of the wire silently.
 *
 * One shape only — the count is the single slot. `\d{1,3}` bounds it at the
 * same magnitude the sibling grammars use; a field of more than 999 contenders
 * is not a shape this product can produce.
 *
 * IT CANNOT MATCH THE EMPTY STRING — the leading space and the count are both
 * required — which the anchored template branch of the allowlist depends on.
 */
export const SEPARABILITY_DISCLOSURE_RE_SRC =
  ` \\d{1,3}${escapeForRegex(LEAD_IN_TAIL)}${escapeForRegex(CONSEQUENCE)}${escapeForRegex(REPAIR)}`;

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * builder's own worst-case output (never hand-estimated), so an honest
 * disclosure cannot silently knock the summary back to the locked template on
 * length.
 *
 * Worst case: a three-digit contender count.
 */
export const SEPARABILITY_DISCLOSURE_MAX_CHARS = composeDisclosure(999).length;

/**
 * BUILD-TIME PROBE — this module's copy must survive its own egress and its own
 * derived budget.
 *
 * Evaluated at module load, so a copy edit that breaks either invariant throws
 * at import rather than degrading the wire. `intake-option-disclosure.ts` and
 * `withheld-reason-tail.ts` carry the same construction, for the same stated
 * reason: without it, the only symptom of a broken disclosure is a telemetry
 * rate nobody had a reason to look at.
 *
 * The leader-vocabulary half is checked in this module's test rather than here,
 * to avoid an import cycle through `compose/leading-option-egress-guard.ts`.
 */
export const SEPARABILITY_DISCLOSURE_SURVIVES_EGRESS: true = (() => {
  for (const contenders of [MIN_CONTENDERS, 3, 10, 99, 999]) {
    const shape = composeDisclosure(contenders);
    if (!survivesEgress(shape)) {
      throw new Error(
        `separability-disclosure: composed suffix does not survive its own published ` +
          `grammar — the allowlist would reject it and the user would silently receive ` +
          `the locked template. Offending shape: ${shape}`,
      );
    }
    if (shape.length > SEPARABILITY_DISCLOSURE_MAX_CHARS) {
      throw new Error(
        `separability-disclosure: composed suffix exceeds its own derived budget ` +
          `(${shape.length} > ${SEPARABILITY_DISCLOSURE_MAX_CHARS}).`,
      );
    }
  }
  return true as const;
})();
