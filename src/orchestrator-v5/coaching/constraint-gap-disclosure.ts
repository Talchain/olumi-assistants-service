/**
 * T1 — deterministic disclosure for the constraint verdict's two speakable
 * states: a hard constraint that was APPLIED and then never evaluated, and one
 * whose identity the producer's results could not be reconciled with.
 *
 * ONE ENTRY POINT, {@link buildConstraintDisclosure}, taking the whole
 * {@link ConstraintVerdict}. Which sentence is true depends entirely on which
 * state the evidence selected, and pairing the wrong sentence with the state is
 * the mistake both earlier revisions of this fix made — so the pairing is made
 * here, in the module that owns the copy, over an exhaustive switch.
 *
 * DEFECT THIS CLOSES (reported 1/1 on live staging): the user asked for total
 * three-year cost below £2,500; CEE replied "Added constraint: Total
 * three-year cost must be at most £2,500."; PLoT returned
 * `CONSTRAINT_OUT_OF_DOMAIN` and withheld goal-fit under
 * `CONSTRAINT_TARGET_UNRELIABLE`; CEE then led with "MacBook Pro currently
 * leads by 18 percentage points" and disclosed nothing in the primary message.
 * The condition was accepted, silently discarded by the engine, and a
 * recommendation was asserted over the top of it.
 *
 * Required behaviour (three parts, all deterministic):
 *   (a) the leading-option claim is withheld — done by the headline builder
 *       via `constraint_unevaluated` / `constraint_identity_unresolved`
 *       (analysis-result-headline.ts), from the verdict's own
 *       `mayNameLeadingOption` declaration;
 *   (b) THIS module states exactly which user condition is affected, and in
 *       WHAT WAY — "not checked" only in the state where that is true;
 *   (c) THIS module offers a repair step the user can act on, chosen to match
 *       the state's actual diagnosis rather than assuming the units one.
 *
 * ⚠ (b) AND (c) ONLY EXIST IF THIS COPY SURVIVES THE EGRESS ALLOWLIST.
 * The composed summary passes through `renderConfirmation` (turn-executor.ts)
 * → `runAnalysisConfirmationTemplate` (routing/validation-registry.ts) →
 * `isAllowedRunAnalysisAssistantText` (analysis-result-headline.ts), which
 * replaces anything not on the allowlist with a locked literal. As first
 * shipped, this disclosure was rejected there and the user received only
 * "Ran analysis on your current scenario." — (a) survived, (b) and (c) never
 * reached the wire. Two independent causes, both fixed here:
 *   1. the copy said "no option can be recommended yet", and
 *      FORBIDDEN_HEADLINE_VOCABULARY_REGEX bans /recommend(s|ed|ation)?/i —
 *      so it failed the content defences even after a structural match;
 *   2. there was no published grammar for the suffix, so the locked-template
 *      branch of the allowlist (which admitted the scaffold disclosure only)
 *      rejected it structurally.
 * Hence {@link CONSTRAINT_GAP_DISCLOSURE_RE_SRC} and
 * {@link CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS} below, and the build-time
 * survival probe in {@link buildConstraintDisclosure} — the same three
 * pieces of plumbing the sibling scaffold disclosure already has
 * (scaffold-disclosure.ts). Anything appended to a run_analysis summary needs
 * all three; a disclosure without them is inert in production.
 *
 * Claim-safety posture: this copy is composed from CEE's OWN persisted
 * `goal_constraints` labels (user-ratified text CEE already echoed back at
 * ratification time), never from PLoT enrichment content. The producer's
 * warning CODES decide only WHETHER to speak — no message, wording or value
 * from a PLoT warning entry is read or interpolated, so no Tier-3 field
 * reaches user-facing prose. Labels pass through the same `sanitiseLabel`
 * the headline grammar uses; a label that fails sanitisation, exceeds
 * {@link CONSTRAINT_GAP_LABEL_MAX_CHARS}, or would not survive the egress
 * degrades to a count-only phrasing rather than leaking an id or losing the
 * whole disclosure.
 */

import { sanitiseLabel } from '../context/enrichment-graph-labels.js';
import { passesAssistantTextContentDefences } from './assistant-text-defences.js';
import type {
  ConstraintVerdict,
  RatifiedConstraint,
} from '../../orchestrator/context/constraint-feasibility.js';

/**
 * How many constraint labels to name before collapsing to a count. Keeps the
 * primary message readable when a brief ratified many conditions.
 */
const MAX_NAMED_CONSTRAINTS = 3;

/**
 * Longest label this disclosure will quote. `sanitiseLabel` imposes NO length
 * bound, so without this a single long user label could push the composed
 * summary past the egress length cap and silently knock the whole message back
 * to the locked template. Mirrors the role of `SCAFFOLD_LABEL_MAX_CHARS`, and
 * is the bound {@link CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS} is computed from —
 * the grammar slot interpolates it rather than hand-mirroring a `{1,N}`.
 */
export const CONSTRAINT_GAP_LABEL_MAX_CHARS = 60;

/**
 * The two disclosure voices this module can speak, keyed to the constraint
 * verdict states that have something to disclose.
 *
 * They are SEPARATE COPY, not one sentence with a variable, because they make
 * different statements and only one of them is ever true:
 *
 *   unevaluated         "your condition was not checked" — a claim about the
 *                       ENGINE, assertable only when the producer said so or
 *                       the id spaces demonstrably line up elsewhere.
 *   identity_unresolved "we could not match the engine's condition results to
 *                       yours" — a claim about the SEAM. It must not say the
 *                       condition went unchecked (it may well have been
 *                       checked), and it must not certify constraint-safety
 *                       (we cannot tell which condition was checked).
 *
 * Writing one and reusing it for the other is exactly the conflation that made
 * both earlier revisions of this fix state something false.
 */
type DisclosureVoice = 'unevaluated' | 'identity_unresolved';

/**
 * The repair step for the UNEVALUATED voice. Deterministic and constant — it
 * never interpolates a value, unit, or engine message. The out-of-domain class
 * is always the same shape of mistake: a threshold in real units bound to a
 * target that does not carry those units.
 */
const UNEVALUATED_REPAIR_STEP =
  ' Re-state that limit against a measure recorded in the same units as the limit, then run the analysis again.';

/**
 * The repair step for the IDENTITY_UNRESOLVED voice. Deliberately NOT the
 * units advice above: the observable is an id/keying divergence, and telling
 * the user to fix their units would assert a diagnosis this state exists
 * precisely because CEE cannot make. Re-stating the condition re-ratifies it
 * and re-issues its identity, which is the one action available to the user
 * that can plausibly clear the divergence.
 */
function unresolvedRepairStep(total: number): string {
  return total === 1
    ? ' Re-state the condition and run the analysis again.'
    : ' Re-state the conditions and run the analysis again.';
}

function quoted(label: string): string {
  return `“${label}”`;
}

/** Join labels as "A", "A and B", "A, B and C". */
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) return quoted(labels[0]!);
  const quotedLabels = labels.map(quoted);
  const last = quotedLabels[quotedLabels.length - 1]!;
  return `${quotedLabels.slice(0, -1).join(', ')} and ${last}`;
}

/** Constant lead-in for the identity voice; escaped into the grammar below. */
const UNRESOLVED_LEAD_IN =
  'The analysis engine returned condition results that could not be matched to ';

/**
 * The sentence that states WHAT the disclosure is about, optionally naming the
 * conditions. Split out from the body so the published grammar and the
 * worst-case budget are both derived from the same shapes the builder can
 * actually emit.
 */
function subjectSentence(
  voice: DisclosureVoice,
  total: number,
  named: readonly string[],
): string {
  if (voice === 'unevaluated') {
    if (named.length === 0) {
      return total === 1
        ? 'One of the conditions you set was not checked.'
        : `${total} of the conditions you set were not checked.`;
    }
    return total === 1
      ? `One of the conditions you set was not checked: ${joinLabels(named)}.`
      : `${total} of the conditions you set were not checked, including ${joinLabels(named)}.`;
  }
  const subject = total === 1 ? 'the condition you set' : `the ${total} conditions you set`;
  if (named.length === 0) return `${UNRESOLVED_LEAD_IN}${subject}.`;
  return total === 1
    ? `${UNRESOLVED_LEAD_IN}${subject}: ${joinLabels(named)}.`
    : `${UNRESOLVED_LEAD_IN}${subject}, including ${joinLabels(named)}.`;
}

/**
 * The consequence sentence. NOTE the wording in BOTH voices: "put forward",
 * never "recommended" — `FORBIDDEN_HEADLINE_VOCABULARY_REGEX` bans the whole
 * `recommend*` family, and the egress applies it to the COMPOSED text. The ban
 * is blunt by design (it cannot tell a negation from an assertion), so the
 * disclosure works within it rather than around it. Changing either back to
 * "recommended" makes the entire message revert to the locked template with no
 * error anywhere — the build-time probe below is what turns that into a loud
 * failure instead of a silent one.
 *
 * The identity voice says "cannot be confirmed whether … was checked", which is
 * the precise statement: not that it went unchecked, and not that it held.
 */
function consequenceSentence(voice: DisclosureVoice, total: number): string {
  if (voice === 'unevaluated') {
    return ` The analysis engine could not evaluate ${total === 1 ? 'it' : 'them'} against this model, so no option can be put forward yet.`;
  }
  return total === 1
    ? ' So it cannot be confirmed whether it was checked, and no option can be put forward yet.'
    : ' So it cannot be confirmed whether they were checked, and no option can be put forward yet.';
}

function repairStep(voice: DisclosureVoice, total: number): string {
  return voice === 'unevaluated' ? UNEVALUATED_REPAIR_STEP : unresolvedRepairStep(total);
}

function composeDisclosure(
  voice: DisclosureVoice,
  total: number,
  named: readonly string[],
): string {
  return ` ${subjectSentence(voice, total, named)}${consequenceSentence(voice, total)}${repairStep(voice, total)}`;
}

/**
 * Build the disclosure for a constraint verdict, or the empty string when the
 * state has nothing to disclose.
 *
 * TAKES THE WHOLE VERDICT, not a state and a list. The pairing of voice to
 * evidence is the part that was wrong twice, so it is made here — once, in the
 * module that owns the copy — rather than at a call site that could pair the
 * "not checked" sentence with the identity state. The switch is exhaustive
 * over {@link ConstraintVerdictState}: a sixth state is a compile error, not a
 * silently silent disclosure.
 *
 * Returns a leading-space-prefixed fragment so it appends to the summary the
 * same way the scaffold and reduced-samples disclosures do.
 */
export function buildConstraintDisclosure(verdict: ConstraintVerdict): string {
  switch (verdict.state) {
    case 'unevaluated':
    case 'identity_unresolved':
      return buildVoice(verdict.state, verdict.constraints);
    case 'not_applicable':
    case 'evaluated_feasible':
      // Nothing happened to the user's conditions that needs saying.
      return '';
    case 'evaluated_infeasible':
      // The leader breaks a limit we DID check. That copy is NOT this module's:
      // it lives in the coach's compact-summary note and the decision-review
      // winner flag (see constraint-feasibility.ts), which can name the
      // constraint and the margin. Emitting a second, blunter sentence here
      // would put two different accounts of the same fact on one screen.
      return '';
  }
}

function buildVoice(
  voice: DisclosureVoice,
  constraints: readonly RatifiedConstraint[],
): string {
  if (constraints.length === 0) return '';

  const named = constraints
    .map((c) => (c.label === null ? null : sanitiseLabel(c.label, c.constraint_id)))
    .filter(
      (clean): clean is string =>
        clean !== null && clean.length <= CONSTRAINT_GAP_LABEL_MAX_CHARS,
    )
    .slice(0, MAX_NAMED_CONSTRAINTS);

  // Build-time survival probe (the pattern scaffold-disclosure.ts established
  // and this module originally lacked): a labelled form whose label would be
  // rejected at the egress degrades to the count-only form HERE, so the worst
  // case is a less specific disclosure rather than no disclosure at all. The
  // count-only form is constant text plus an integer and is pinned as
  // always-surviving by this module's egress test.
  const labelled = composeDisclosure(voice, constraints.length, named);
  if (named.length > 0 && !survivesEgress(labelled)) {
    return composeDisclosure(voice, constraints.length, []);
  }
  return labelled;
}

/**
 * True when a composed suffix would SURVIVE the registry-side egress:
 * single-line, matches this module's own published grammar exactly, and passes
 * the shared content defences. Deliberately compiled from
 * {@link CONSTRAINT_GAP_DISCLOSURE_RE_SRC} — the SAME source the allowlist
 * compiles — so builder/grammar drift fails loudly here instead of silently
 * downgrading every disclosure-bearing summary at the wire.
 */
function survivesEgress(suffix: string): boolean {
  if (suffix.includes('\n') || suffix.includes('\r')) return false;
  if (!GAP_SUFFIX_EXACT_REGEX().test(suffix)) return false;
  return passesAssistantTextContentDefences(suffix);
}

let gapSuffixExactRegex: RegExp | null = null;
function GAP_SUFFIX_EXACT_REGEX(): RegExp {
  gapSuffixExactRegex ??= new RegExp(`^(?:${CONSTRAINT_GAP_DISCLOSURE_RE_SRC})$`);
  return gapSuffixExactRegex;
}

/** Local regex-literal escape (kept local to avoid an import cycle). */
function escapeForRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LABEL_SLOT = `“[^”\\n]{1,${CONSTRAINT_GAP_LABEL_MAX_CHARS}}”`;
/** `A` · `A and B` · `A, B and C` — mirrors {@link joinLabels} exactly. */
const JOINED_LABELS = `${LABEL_SLOT}(?:(?:, ${LABEL_SLOT})* and ${LABEL_SLOT})?`;

/** Grammar branch for the UNEVALUATED voice. */
const UNEVALUATED_RE_SRC =
  ' ' +
  '(?:' +
  `One of the conditions you set was not checked(?:: ${JOINED_LABELS})?\\.` +
  '|' +
  `\\d{1,3} of the conditions you set were not checked(?:, including ${JOINED_LABELS})?\\.` +
  ')' +
  // Both consequence variants ("it" / "them"), derived from the builder.
  `(?:${escapeForRegex(consequenceSentence('unevaluated', 1))}|${escapeForRegex(consequenceSentence('unevaluated', 2))})` +
  escapeForRegex(UNEVALUATED_REPAIR_STEP);

/** Grammar branch for the IDENTITY_UNRESOLVED voice. */
const UNRESOLVED_RE_SRC =
  ' ' +
  escapeForRegex(UNRESOLVED_LEAD_IN) +
  '(?:' +
  `the condition you set(?:: ${JOINED_LABELS})?\\.` +
  '|' +
  `the \\d{1,3} conditions you set(?:, including ${JOINED_LABELS})?\\.` +
  ')' +
  `(?:${escapeForRegex(consequenceSentence('identity_unresolved', 1))}|${escapeForRegex(consequenceSentence('identity_unresolved', 2))})` +
  `(?:${escapeForRegex(unresolvedRepairStep(1))}|${escapeForRegex(unresolvedRepairStep(2))})`;

/**
 * Grammar source for the disclosure suffix, consumed by the registry-side
 * egress allowlist (`isAllowedRunAnalysisAssistantText`) and by this module's
 * own build-time survival probe. One alternation over BOTH voices, each
 * mirroring the four shapes its builder can emit:
 *   - singular count-only / singular naming one label
 *   - plural count-only / plural naming up to {@link MAX_NAMED_CONSTRAINTS}
 * The label slots interpolate {@link CONSTRAINT_GAP_LABEL_MAX_CHARS} rather
 * than hand-mirroring a `{1,N}`, and every fixed sentence is escaped from the
 * very constants the builder emits — so a copy edit that breaks the allowlist
 * breaks the probe and this module's tests loudly, instead of silently
 * reverting the user-facing message to the locked template.
 */
export const CONSTRAINT_GAP_DISCLOSURE_RE_SRC = `(?:${UNEVALUATED_RE_SRC})|(?:${UNRESOLVED_RE_SRC})`;

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * worst-case builder output across BOTH voices (never hand-estimated), so an
 * honest disclosure cannot silently knock the summary back to the locked
 * template on length.
 *
 * Worst case per voice: the plural, three-label form with every label at the
 * cap and a three-digit count.
 */
export const CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS = Math.max(
  ...(['unevaluated', 'identity_unresolved'] as const).map(
    (voice) =>
      composeDisclosure(
        voice,
        999,
        Array.from({ length: MAX_NAMED_CONSTRAINTS }, () =>
          'x'.repeat(CONSTRAINT_GAP_LABEL_MAX_CHARS),
        ),
      ).length,
  ),
);
