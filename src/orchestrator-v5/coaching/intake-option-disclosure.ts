/**
 * ROADMAP 2.579 — THE WITHHELD-RANKING DISCLOSURE FOR AN INCOMPLETE INTAKE.
 *
 * ONE ENTRY POINT, {@link buildIntakeOptionDisclosure}, taking the whole
 * {@link IntakeOptionReconciliation}. Speaks on exactly one state
 * (`options_missing`) and returns `''` on every other, so the pairing between
 * evidence and sentence is made HERE, in the module that owns the copy, rather
 * than at a caller that will not be re-read.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE COPY MUST DO, AND WHY EACH CLAUSE IS THE WEAKEST TRUE ONE.
 *
 * The ruling on 2.579 is BLOCK THE RANKING, NOT THE ANALYSIS: the per-option
 * numbers computed on the options that WERE captured are real and stay on
 * screen; what is withheld is the claim about which one is best. So the copy has
 * three jobs and no more:
 *
 *   1. NAME THE GAP. "One option from your brief is missing" without saying
 *      which one is a hedge, and a hedge is what the user cannot act on. The
 *      producer guarantees `missing` is non-empty on this state precisely so
 *      this sentence can never be written without its subject.
 *   2. STATE THE CONSEQUENCE, scoped to the ranking. "No option can be put
 *      forward from this result" — NOT "this analysis is invalid", which would
 *      be false about numbers that were computed correctly.
 *   3. OFFER THE REPAIR, and offer BOTH halves of it. "Add it" is one valid
 *      resolution; "confirm you meant to leave it out" is the other, and it is
 *      the one a user who deliberately dropped an option needs. A repair step
 *      that admits only the first would tell half of all affected users to undo
 *      a decision they made on purpose.
 *
 * ⚠ THE COPY MAY NOT ASSERT THE PRODUCT KNOWS WHY THE OPTION IS ABSENT. It
 * does not. `deriveIntakeOptionReconciliation` compares two pieces of persisted
 * state; it cannot distinguish "the drafter dropped it" from "the user removed
 * it afterwards" from "the drafter folded it into another option under a name
 * this module could not reconcile". Every sentence below is therefore about the
 * OBSERVATION ("is not in the model") and never about the CAUSE.
 *
 * ⚠ AND IT MAY NOT TRIP THE LEADER VOCABULARY. This suffix ships on turns whose
 * leading-option claim is withheld, so copy reaching for the natural word ("…so
 * the option that leads cannot be named") would be replaced wholesale by
 * `projectExplanationAnswerForWithheldClaim` on exactly the turns it exists to
 * serve. {@link INTAKE_DISCLOSURE_SURVIVES_LEADER_VOCABULARY} is the build-time
 * probe that fails the module rather than letting that ship silently — the same
 * plumbing `withheld-reason-tail.ts` carries, for the same reason.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE PIECES OF PLUMBING ANY run_analysis SUFFIX NEEDS. A disclosure
 * without all three is inert in production — it composes correctly, fails the
 * registry-side egress allowlist, and the user silently receives the locked
 * template instead. They are:
 *
 *   - {@link INTAKE_OPTION_DISCLOSURE_RE_SRC} — the grammar the allowlist
 *     admits, built by escaping THE VERY CONSTANTS the builder emits, so a copy
 *     edit breaks the probe loudly instead of the wire silently;
 *   - {@link INTAKE_OPTION_DISCLOSURE_MAX_CHARS} — the length budget, DERIVED
 *     from the builder's own worst case, never hand-estimated;
 *   - {@link survivesEgress} — the per-call survival check, compiled from the
 *     same RE_SRC the allowlist compiles, which degrades a label-naming form to
 *     the count-only form rather than losing the whole disclosure.
 */

import { sanitiseLabel } from '../context/enrichment-graph-labels.js';
import { passesAssistantTextContentDefences } from './assistant-text-defences.js';
import type {
  EnumeratedOption,
  IntakeOptionReconciliation,
} from '../../orchestrator/context/intake-option-reconciliation.js';

/**
 * Most missing options this disclosure will quote. Beyond it the sentence stops
 * being readable and starts being a list, and the count carries the magnitude
 * perfectly well. Mirrors `MAX_NAMED_CONSTRAINTS` in the sibling module.
 */
const MAX_NAMED_OPTIONS = 3;

/**
 * Longest option label this disclosure will quote. `sanitiseLabel` imposes NO
 * length bound of its own, so an adversarially long brief fragment would blow
 * the egress budget and silently revert the summary to the locked template.
 * Mirrors `CONSTRAINT_GAP_LABEL_MAX_CHARS`.
 */
export const INTAKE_OPTION_LABEL_MAX_CHARS = 60;

const LEAD_IN = ' Your brief lists an option that is not in the model';
const LEAD_IN_PLURAL = ' Your brief lists options that are not in the model';

const CONSEQUENCE_SINGULAR =
  ' Because a candidate is missing, no option can be put forward from this result.';
const CONSEQUENCE_PLURAL =
  ' Because candidates are missing, no option can be put forward from this result.';

const REPAIR_SINGULAR =
  ' Add it to the model, or confirm you meant to leave it out, and run the analysis again.';
const REPAIR_PLURAL =
  ' Add them to the model, or confirm you meant to leave them out, and run the analysis again.';

/** `A` · `A and B` · `A, B and C`. Mirrored EXACTLY by {@link JOINED_LABELS}. */
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0] as string;
  const head = labels.slice(0, -1).join(', ');
  return `${head} and ${labels[labels.length - 1] as string}`;
}

function composeDisclosure(count: number, named: readonly string[]): string {
  const plural = count !== 1;
  const leadIn = plural ? LEAD_IN_PLURAL : LEAD_IN;
  const subject =
    named.length === 0
      ? plural
        ? `${leadIn} (${count} of them).`
        : `${leadIn}.`
      : plural
        ? `${leadIn}, including ${joinLabels(named.map((l) => `“${l}”`))}.`
        : `${leadIn}: ${joinLabels(named.map((l) => `“${l}”`))}.`;
  return (
    subject +
    (plural ? CONSEQUENCE_PLURAL : CONSEQUENCE_SINGULAR) +
    (plural ? REPAIR_PLURAL : REPAIR_SINGULAR)
  );
}

/**
 * ⭐ THE builder. Returns `''` on every state but `options_missing`.
 *
 * Claim-safety posture: the quoted text is the USER'S OWN BRIEF WORDS, passed
 * through the same `sanitiseLabel` every other user-label surface uses and
 * capped at {@link INTAKE_OPTION_LABEL_MAX_CHARS}. Nothing from the PLoT
 * envelope, and nothing from any LLM-authored coaching field, is read or
 * interpolated — the whole point of 2.579's producer is that the claim rests on
 * canonical persisted state, and the copy must not quietly re-open a channel the
 * derivation closed.
 */
export function buildIntakeOptionDisclosure(
  reconciliation: IntakeOptionReconciliation,
): string {
  if (reconciliation.state !== 'options_missing') return '';
  const missing = reconciliation.missing;
  // Defensive, not decorative: the producer guarantees this is non-empty on
  // this state, and a disclosure that announced a gap it could not name would
  // be exactly the generic hedge the ruling forbids. Silence beats a hedge.
  if (missing.length === 0) return '';

  const named = missing
    .slice(0, MAX_NAMED_OPTIONS)
    .map((option: EnumeratedOption) => sanitiseLabel(option.text, ''))
    .filter((label): label is string => label !== null && label.length > 0)
    .map((label) => label.trim())
    .filter((label) => label.length > 0 && label.length <= INTAKE_OPTION_LABEL_MAX_CHARS);

  const labelled = composeDisclosure(missing.length, named);
  if (named.length > 0 && !survivesEgress(labelled)) {
    return composeDisclosure(missing.length, []);
  }
  return labelled;
}

/**
 * True when a composed suffix would SURVIVE the registry-side egress:
 * single-line, matches this module's own published grammar exactly, and passes
 * the shared content defences. Compiled from
 * {@link INTAKE_OPTION_DISCLOSURE_RE_SRC} — the SAME source the allowlist
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
  suffixExactRegex ??= new RegExp(`^(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})$`);
  return suffixExactRegex;
}

/** Local regex-literal escape (kept local to avoid an import cycle). */
function escapeForRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LABEL_SLOT = `“[^”\\n]{1,${INTAKE_OPTION_LABEL_MAX_CHARS}}”`;
/** `A` · `A and B` · `A, B and C` — mirrors {@link joinLabels} exactly. */
const JOINED_LABELS = `${LABEL_SLOT}(?:(?:, ${LABEL_SLOT})* and ${LABEL_SLOT})?`;

/**
 * Grammar source for the disclosure suffix, consumed by the registry-side
 * egress allowlist (`isAllowedRunAnalysisAssistantText`) and by this module's
 * own survival probe. Mirrors the four shapes the builder can emit:
 * singular count-only / singular naming one label / plural count-only / plural
 * naming up to {@link MAX_NAMED_OPTIONS}. Every fixed sentence is escaped from
 * the very constants the builder emits, and the label slot interpolates
 * {@link INTAKE_OPTION_LABEL_MAX_CHARS} rather than hand-mirroring a `{1,N}` —
 * so a copy edit that breaks the allowlist breaks this module's tests loudly,
 * instead of silently reverting the user-facing message to the locked template.
 *
 * IT CANNOT MATCH THE EMPTY STRING — every branch requires a lead-in — which the
 * anchored template branch of the allowlist depends on.
 */
export const INTAKE_OPTION_DISCLOSURE_RE_SRC =
  '(?:' +
  // Singular: count-only, or naming exactly one label.
  `${escapeForRegex(LEAD_IN)}(?::\\u0020${LABEL_SLOT})?\\.` +
  escapeForRegex(CONSEQUENCE_SINGULAR) +
  escapeForRegex(REPAIR_SINGULAR) +
  '|' +
  // Plural: count-only `(N of them)`, or naming up to MAX_NAMED_OPTIONS.
  `${escapeForRegex(LEAD_IN_PLURAL)}(?:\\u0020\\(\\d{1,3} of them\\)|, including ${JOINED_LABELS})\\.` +
  escapeForRegex(CONSEQUENCE_PLURAL) +
  escapeForRegex(REPAIR_PLURAL) +
  ')';

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * builder's own worst-case output (never hand-estimated), so an honest
 * disclosure cannot silently knock the summary back to the locked template on
 * length.
 *
 * Worst case: the plural, three-label form with every label at the cap and a
 * three-digit count.
 */
export const INTAKE_OPTION_DISCLOSURE_MAX_CHARS = composeDisclosure(
  999,
  Array.from({ length: MAX_NAMED_OPTIONS }, () => 'x'.repeat(INTAKE_OPTION_LABEL_MAX_CHARS)),
).length;

/**
 * BUILD-TIME PROBE — this module's copy must survive its own egress AND the
 * shared leader vocabulary.
 *
 * Evaluated at module load, so a copy edit that breaks either invariant throws
 * at import rather than degrading the wire. `withheld-reason-tail.ts` carries
 * the same construction and states the reason: without it, the only symptom of
 * a broken disclosure is a telemetry rate nobody had a reason to look at.
 *
 * The leader-vocabulary half is checked in this module's test rather than here,
 * to avoid an import cycle through `compose/leading-option-egress-guard.ts`
 * (which imports the coaching surface this file feeds).
 */
export const INTAKE_DISCLOSURE_SURVIVES_LEADER_VOCABULARY: true = (() => {
  const shapes: readonly string[] = [
    composeDisclosure(1, []),
    composeDisclosure(1, ['a new retail concession']),
    composeDisclosure(2, []),
    composeDisclosure(3, ['a', 'b', 'c']),
    composeDisclosure(999, [
      'x'.repeat(INTAKE_OPTION_LABEL_MAX_CHARS),
      'y'.repeat(INTAKE_OPTION_LABEL_MAX_CHARS),
      'z'.repeat(INTAKE_OPTION_LABEL_MAX_CHARS),
    ]),
  ];
  for (const shape of shapes) {
    if (!survivesEgress(shape)) {
      throw new Error(
        `intake-option-disclosure: composed suffix does not survive its own ` +
          `published grammar — the allowlist would reject it and the user would ` +
          `silently receive the locked template. Offending shape: ${shape}`,
      );
    }
    if (shape.length > INTAKE_OPTION_DISCLOSURE_MAX_CHARS) {
      throw new Error(
        `intake-option-disclosure: composed suffix exceeds its own derived ` +
          `budget (${shape.length} > ${INTAKE_OPTION_DISCLOSURE_MAX_CHARS}).`,
      );
    }
  }
  return true as const;
})();
