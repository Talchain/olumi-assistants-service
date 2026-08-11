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
  ConstraintVerdictState,
  RatifiedConstraint,
} from '../../orchestrator/context/constraint-feasibility.js';

/**
 * How many constraint labels to name before collapsing to a count. Keeps the
 * primary message readable when a brief ratified many conditions.
 */
const MAX_NAMED_CONSTRAINTS = 3;

/** Test-only re-export, so the budget spec asserts the value it was derived from. */
export const MAX_NAMED_CONSTRAINTS_FOR_TEST = MAX_NAMED_CONSTRAINTS;

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
 * WS-A ITEM 2(a) — longest VERBATIM BRIEF SPAN this disclosure will quote back.
 *
 * A constraint's `source_quote` is a sentence the user wrote, not a label CEE
 * minted, so it is meaningfully longer than a label and meaningfully more
 * valuable: it is the only thing on the message a user can RECOGNISE. 120
 * characters is the bound the grammar slot and the egress budget are both
 * derived from — a longer quote degrades to the label-only form rather than
 * pushing the composed summary past the length cap and silently reverting the
 * whole message to the locked template.
 */
export const CONSTRAINT_GAP_QUOTE_MAX_CHARS = 120;

/**
 * The lead-in for the quoted span. Note the claim it makes and the one it does
 * NOT: *"in your brief"* asserts only that the span is present in the text the
 * user submitted, which is exactly what `source_quote` records. It does not
 * say the user AUTHORED the constraint row — the authorship claim this module
 * has already withdrawn twice (ROADMAP 2.653, 2.675) because
 * `goal_constraints[]` rows are minted by the drafter as well as by the user's
 * own `add_constraint` turn. The distinction is the same one
 * `cee/provenance/stated-amounts.ts` is built on: *present in the submitted
 * text* and *asserted by the user* are different claims, and only the first is
 * observable here.
 */
const QUOTE_LEAD_IN = ' From your brief: ';

/**
 * The three disclosure voices this module can speak.
 *
 * They are SEPARATE COPY, not one sentence with a variable, because they make
 * different statements about different subjects:
 *
 *   unevaluated         "your condition was not checked" — a claim about the
 *                       ENGINE, assertable only when the producer said so or
 *                       the id spaces demonstrably line up elsewhere.
 *   identity_unresolved "we could not match the engine's condition results to
 *                       yours" — a claim about the SEAM. It must not say the
 *                       condition went unchecked (it may well have been
 *                       checked), and it must not certify constraint-safety
 *                       (we cannot tell which condition was checked).
 *   out_of_scope        "this analysis does not test that" — a claim about the
 *                       MODEL's declared scope (ROADMAP 2.349), assertable
 *                       only when the producer itself disclosed that it
 *                       removed the constraint before computing
 *                       (`_meta.filtered_constraints`).
 *
 * Writing one and reusing it for another is exactly the conflation that made
 * both earlier revisions of this fix state something false — and it is what
 * gap 5 was: the `unevaluated` voice was spoken about a constraint PLoT had
 * announced it deleted, so the user was told the engine failed to check a
 * condition and was handed a units repair step that cannot ever apply.
 *
 * The FIRST TWO are STATE voices: at most one is ever true on a turn, chosen
 * by the exhaustive switch in {@link buildConstraintDisclosureFromState}.
 * `out_of_scope` is INDEPENDENT of the state and may accompany either of them
 * (a turn can carry both a removed constraint and a genuinely unscored one) —
 * see {@link buildConstraintDisclosure} for the composition order and
 * {@link CONSTRAINT_GAP_DISCLOSURE_RE_SRC} for the grammar that admits it.
 */
type DisclosureVoice = 'unevaluated' | 'identity_unresolved' | 'out_of_scope';

/**
 * The STATE voices, in one place, so the grammar and the worst-case budget are
 * both derived from the same tuple rather than each hand-listing them.
 */
const STATE_VOICES = ['unevaluated', 'identity_unresolved'] as const;

/** Every voice, derived — the budget below must cover all of them. */
const ALL_VOICES = [...STATE_VOICES, 'out_of_scope'] as const;

/**
 * The repair step for the UNEVALUATED voice. Deterministic and constant — it
 * never interpolates a value, unit, or engine message.
 *
 * ⚠ ROADMAP 2.653 (I-C) — REWRITTEN. It used to read:
 *
 *   "Re-state that limit against a measure recorded in the same units as the
 *    limit, then run the analysis again."
 *
 * with the justification that "the out-of-domain class is always the same shape
 * of mistake: a threshold in real units bound to a target that does not carry
 * those units." THE WALK DISPROVED THAT PREMISE. On the witnessed session the
 * limit was unevaluable because its OPERATOR WAS INVERTED — a floor minted from
 * "churn could rise above 3%" — and no restatement in any units, however
 * faithfully followed, could have fixed it. The user was handed a units
 * diagnosis for a sign defect, about a constraint THIS SERVICE authored from
 * their brief, and the exercise had to tell them the truth on the third prompt.
 *
 * That is the same mistake this module already refuses to make one voice over:
 * `unresolvedRepairStep` is documented as "deliberately NOT the units advice
 * above… telling the user to fix their units would assert a diagnosis this
 * state exists precisely because CEE cannot make". The rule was right; it had
 * simply never been applied to the `unevaluated` voice, whose docstring
 * asserted a certainty about the cause that the producer's warning code does
 * not carry.
 *
 * WHAT REPLACES IT, and why each clause is defensible:
 *   - it asks for the limit IN THE USER'S OWN WORDS, which is an action they
 *     can always perform, rather than a units correction they may have no
 *     mistake to make;
 *   - "I will record it" is a live capability, not a hope — `add_constraint` is
 *     a registered V5 handler (witnessed applying on staging in
 *     `consent-witness-findings-2026-08-07.md` §4 control (a)) and is pinned
 *     against the registry in this module's tests, so the claim cannot ship
 *     dark if the handler is ever removed;
 *   - it DISCLOSES THE RESIDUAL. There is no conversational remove/replace
 *     constraint operation (ROADMAP 2.659), so a correction appends beside the
 *     bad row rather than replacing it. The walk watched the product silently
 *     append and turn one unevaluable constraint into two. Saying so is the
 *     INV-2 discipline the consent fix (#836) established: a repair that cannot
 *     touch the defective row must disclose that the row remains.
 */
const UNEVALUATED_REPAIR_STEP =
  ' Tell me the limit you meant in your own words and I will record it; this one stays on the model. Then run the analysis again.';

/**
 * The repair step for the IDENTITY_UNRESOLVED voice. Deliberately NOT the
 * units advice above: the observable is an id/keying divergence, and telling
 * the user to fix their units would assert a diagnosis this state exists
 * precisely because CEE cannot make. Stating the condition re-ratifies it and
 * re-issues its identity, which is the one action available to the user that
 * can plausibly clear the divergence.
 *
 * ⚠ ROADMAP 2.675 — "RE-state" WITHDRAWN. The mechanism above is unchanged and
 * still correct; the word was not. "Re-state X" can only be addressed to
 * someone who stated X, so on a drafter-authored row it instructs the user to
 * repeat something they never said — the same authorship falsehood the subject
 * sentence carried, one grammatical step back, and the same reading the walk's
 * tester gave the whole message. "State … in your own words" asks for exactly
 * the same action, re-ratifies identically, and presupposes nothing about who
 * put the row there. It also matches the phrasing #840 chose for the
 * `unevaluated` voice's offer, so the two repair steps no longer disagree about
 * whether the user is presumed to have authored anything.
 */
function unresolvedRepairStep(total: number): string {
  return total === 1
    ? ' State the condition in your own words and run the analysis again.'
    : ' State the conditions in your own words and run the analysis again.';
}

/**
 * The closer for the OUT_OF_SCOPE voice (ROADMAP 2.349). It is deliberately
 * NOT a repair step, because there is no repair: the producer removed the
 * constraint because the dimension it names is not modelled, and no
 * restatement in any units, under any id, on any rerun can change that. The
 * defect this replaces shipped {@link UNEVALUATED_REPAIR_STEP} for exactly
 * this class — an instruction whose own docstring says it was written for the
 * units mistake, handed to users who had made no units mistake, and which
 * could never alter the outcome however faithfully they followed it.
 *
 * What it says instead is the true and useful thing: the condition is still
 * recorded, so nothing the user stated has been thrown away by CEE.
 */
function outOfScopeCloser(total: number): string {
  return total === 1
    ? ' It stays recorded on your scenario.'
    : ' They stay recorded on your scenario.';
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
 * Constant lead-in for the OUT_OF_SCOPE voice (2.349); escaped into the
 * grammar below. Note what it does NOT say: not "was not checked" (which
 * frames a deliberate exclusion as an engine anomaly), and not "could not be
 * evaluated" (which invites the units repair). It states the scope of the
 * model, which is the only true statement available.
 */
const OUT_OF_SCOPE_LEAD_IN = 'This analysis does not test ';

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
    // ⚠ ROADMAP 2.653 (I-C) — "the conditions you set" WITHDRAWN from this
    // voice. It is an attribution claim, and on the witnessed session it was
    // false: the limit was minted by THIS SERVICE's own brief extractor from
    // the sentence "customer churn could rise above 3%", shown to the user for
    // the first time inside this very message, under a name they had never
    // seen ("churn could rise floor"). The tester's note, verbatim: *"the
    // constraint was AUTHORED BY THE DRAFTER, not by me."* Telling a user they
    // set something they did not is the trust defect underneath the whole arc,
    // and it is the reason the message reads as blame.
    //
    // "on your model" is the claim that survives every authorship case: the row
    // IS on their model, whoever put it there. It asserts nothing about who,
    // which is exactly right, because at this point in the pipeline nothing
    // knows — `RatifiedConstraint` carries only an id and a label.
    if (named.length === 0) {
      return total === 1
        ? 'One limit on your model could not be checked.'
        : `${total} limits on your model could not be checked.`;
    }
    return total === 1
      ? `One limit on your model could not be checked: ${joinLabels(named)}.`
      : `${total} limits on your model could not be checked, including ${joinLabels(named)}.`;
  }
  if (voice === 'out_of_scope') {
    // ⚠ ROADMAP 2.675 — "the conditions you set" WITHDRAWN here too, for the
    // reason #840 withdrew it from `unevaluated`: `goal_constraints[]` rows are
    // minted by the DRAFTER as well as by the user's own `add_constraint` turn,
    // and `RatifiedConstraint` carries only an id and a label, so nothing at
    // this point in the pipeline knows who authored the row. This voice is the
    // one gap 5 was witnessed on — a time-phrase constraint CEE INFERRED, whose
    // disclosure then blamed the user for setting it.
    //
    // The truth condition is about the MODEL's scope, not about the row's
    // author, so nothing this voice needs to say depends on authorship at all.
    const what =
      total === 1
        ? 'one of the conditions on your model'
        : `${total} of the conditions on your model`;
    if (named.length === 0) return `${OUT_OF_SCOPE_LEAD_IN}${what}.`;
    return total === 1
      ? `${OUT_OF_SCOPE_LEAD_IN}${what}: ${joinLabels(named)}.`
      : `${OUT_OF_SCOPE_LEAD_IN}${what}, including ${joinLabels(named)}.`;
  }
  // ⚠ ROADMAP 2.675 — same withdrawal, same reason. Note what this voice may
  // NOT retreat to: it cannot drop the subject entirely, because the whole
  // sentence is about a FAILURE TO MATCH two things and the reader has to know
  // which two. "the condition(s) on your model" names the second one without
  // asserting who put it there — and it keeps the noun the lead-in already
  // uses ("condition results"), so the pairing stays legible.
  const subject =
    total === 1 ? 'the condition on your model' : `the ${total} conditions on your model`;
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
    // ROADMAP 2.653 (I-C): "we could not line it up" — OURS, stated as ours.
    // The old sentence named "the analysis engine" as the party that failed,
    // which reads to a user as a third party they cannot reach and reinforces
    // the "your condition, their engine, your problem" framing this whole voice
    // was rewritten to remove. It also says less than it seems: the observable
    // is that the limit was not scored, not that any particular component was
    // unable to evaluate it.
    return ` We could not line ${total === 1 ? 'it' : 'them'} up with anything this analysis measures, so no option can be put forward yet.`;
  }
  if (voice === 'out_of_scope') {
    // NOT "so no option can be put forward" — that consequence is FALSE here.
    // The comparison ran on every dimension the model does carry; the only
    // true consequence is the narrower one, that this condition did not take
    // part in it. Stating the withholding consequence here is precisely the
    // untruth gap 5 put on screen.
    return total === 1
      ? ' It was not part of the comparison.'
      : ' They were not part of the comparison.';
  }
  return total === 1
    ? ' So it cannot be confirmed whether it was checked, and no option can be put forward yet.'
    : ' So it cannot be confirmed whether they were checked, and no option can be put forward yet.';
}

function repairStep(voice: DisclosureVoice, total: number): string {
  if (voice === 'unevaluated') return UNEVALUATED_REPAIR_STEP;
  if (voice === 'out_of_scope') return outOfScopeCloser(total);
  return unresolvedRepairStep(total);
}

/**
 * WS-A ITEM 2(a) — the user's own words, when we have them and only then.
 *
 * NARROW BY DESIGN, and the narrowing is the safety argument:
 *   - SINGULAR ONLY. With one constraint under discussion there is exactly one
 *     quote and no ambiguity about which limit it belongs to. With several,
 *     naming three labels and one quote invites the reader to bind the quote
 *     to the wrong label — a false statement about the user's own sentence,
 *     which is worse than saying less.
 *   - It rides only where a quote genuinely exists; `null`/absent yields the
 *     empty string and today's message byte-for-byte.
 *   - The span passes through `sanitiseLabel`, the same treatment a label
 *     gets, and is dropped entirely rather than truncated when it exceeds
 *     {@link CONSTRAINT_GAP_QUOTE_MAX_CHARS} or would collide with the quote
 *     marks the grammar slot uses. A half-sentence attributed to the user is
 *     not a smaller version of their sentence; it is a different one.
 */
function quoteSentence(constraints: readonly RatifiedConstraint[]): string {
  if (constraints.length !== 1) return '';
  const only = constraints[0]!;
  const raw = only.source_quote ?? null;
  if (raw === null) return '';
  // `sanitiseLabel` returns null for an empty span, for a raw id, and for a
  // UUID — every "this is not human text" answer. Absence is the honest
  // outcome for all of them: this rung may lose the quote and nothing else.
  const clean = sanitiseLabel(raw, only.constraint_id);
  if (clean === null || clean.length === 0 || clean.length > CONSTRAINT_GAP_QUOTE_MAX_CHARS) {
    return '';
  }
  // The grammar slot is `“[^”\n]{1,N}”`; a span carrying either mark or a line
  // break cannot be rendered inside it, and a disclosure that fails the
  // allowlist reverts the WHOLE summary to the locked template.
  if (/[“”\n\r]/.test(clean)) return '';
  return `${QUOTE_LEAD_IN}${quoted(clean)}.`;
}

function composeDisclosure(
  voice: DisclosureVoice,
  total: number,
  named: readonly string[],
  quote = '',
): string {
  return ` ${subjectSentence(voice, total, named)}${quote}${consequenceSentence(voice, total)}${repairStep(voice, total)}`;
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
  // STATE VOICE FIRST, OUT-OF-SCOPE SECOND, and both may be present.
  //
  // Order matters twice over. For the reader, the state voice is the more
  // serious statement (a condition the engine was asked about and did not
  // answer) and leads. For the machine, this is the order
  // `CONSTRAINT_GAP_DISCLOSURE_RE_SRC` publishes, and the egress allowlist
  // admits exactly one gap-disclosure slot — so composing them the other way
  // round would fail the grammar and silently revert the whole summary to the
  // locked template, which is the #703 failure this module exists to prevent.
  const stateVoice = buildConstraintDisclosureFromState(verdict.state, verdict.constraints);
  const outOfScope = buildVoice('out_of_scope', verdict.outOfScopeConstraints);
  if (stateVoice.length === 0 || outOfScope.length === 0) return `${stateVoice}${outOfScope}`;
  // COMBINED survival probe. Each half already proved it survives ALONE
  // (`buildVoice`), but the allowlist sees the CONCATENATION, and only a check
  // of the actual composed bytes can prove that shape passes. If it does not,
  // keep the state voice — never let the additive 2.349 sentence cost the user
  // the more serious disclosure.
  const combined = `${stateVoice}${outOfScope}`;
  return survivesEgress(combined) ? combined : stateVoice;
}

/**
 * The same disclosure, built from a state + constraint list that were READ
 * back rather than derived on this turn.
 *
 * WHY THIS EXISTS. {@link buildConstraintDisclosure} takes the whole verdict
 * because the run_analysis turn HAS one — it just derived it. A later turn that
 * merely NARRATES that analysis (the rerun no-op / explanation path) does not:
 * only `may_name_leading_option` + `constraint_verdict_state` are persisted on
 * the fact (`PersistedClaimSafety` — `constraints` is deliberately not stored,
 * "a second copy of a label is a second thing to drift"). So the caller reads
 * the STATE off the fact and the LABELS off the same persisted `goal_constraints`
 * the original derivation read, and hands both here.
 *
 * That is a read-back, not a second derivation: the state — the part that
 * decides WHICH sentence is true, and the part #703 got wrong twice — is never
 * recomputed. Only the labels are re-resolved, from the one array that is their
 * sole record (`readRatifiedConstraints`).
 *
 * The switch stays HERE, exhaustive, and is now the ONLY one: both entry points
 * share it, so a sixth state is a compile error on one line rather than a
 * silently-silent disclosure on two paths.
 */
export function buildConstraintDisclosureFromState(
  state: ConstraintVerdictState,
  constraints: readonly RatifiedConstraint[],
): string {
  switch (state) {
    case 'unevaluated':
    case 'identity_unresolved':
      return buildVoice(state, constraints);
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
  //
  // ⚠ WS-A ITEM 2(a) — NOW THREE RUNGS, MOST SPECIFIC FIRST: quoted → labelled
  // → count-only. The quote is USER PROSE, i.e. the one part of this message
  // whose content nothing in this repo controls, so it gets its own rung: a
  // span that would fail the allowlist costs the QUOTE and nothing else,
  // rather than costing the labels too. The ladder is ordered so each fall
  // gives up exactly one thing.
  const quote = quoteSentence(constraints);
  if (quote.length > 0) {
    const quotedForm = composeDisclosure(voice, constraints.length, named, quote);
    if (survivesEgress(quotedForm)) return quotedForm;
  }
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

/**
 * WS-A item 2(a) — the OPTIONAL quoted-span slot, interpolating
 * {@link CONSTRAINT_GAP_QUOTE_MAX_CHARS} rather than hand-mirroring a `{1,N}`,
 * and escaping the lead-in from the very constant {@link quoteSentence} emits.
 * Optional because the quote rides only the singular, quote-bearing case.
 */
const QUOTE_SLOT =
  `(?:${escapeForRegex(QUOTE_LEAD_IN)}“[^”\\n]{1,${CONSTRAINT_GAP_QUOTE_MAX_CHARS}}”\\.)?`;

/** Grammar branch for the UNEVALUATED voice. */
const UNEVALUATED_RE_SRC =
  ' ' +
  '(?:' +
  `One limit on your model could not be checked(?:: ${JOINED_LABELS})?\\.` +
  '|' +
  `\\d{1,3} limits on your model could not be checked(?:, including ${JOINED_LABELS})?\\.` +
  ')' +
  QUOTE_SLOT +
  // Both consequence variants ("it" / "them"), derived from the builder.
  `(?:${escapeForRegex(consequenceSentence('unevaluated', 1))}|${escapeForRegex(consequenceSentence('unevaluated', 2))})` +
  escapeForRegex(UNEVALUATED_REPAIR_STEP);

/** Grammar branch for the IDENTITY_UNRESOLVED voice. */
const UNRESOLVED_RE_SRC =
  ' ' +
  escapeForRegex(UNRESOLVED_LEAD_IN) +
  '(?:' +
  `the condition on your model(?:: ${JOINED_LABELS})?\\.` +
  '|' +
  `the \\d{1,3} conditions on your model(?:, including ${JOINED_LABELS})?\\.` +
  ')' +
  QUOTE_SLOT +
  `(?:${escapeForRegex(consequenceSentence('identity_unresolved', 1))}|${escapeForRegex(consequenceSentence('identity_unresolved', 2))})` +
  `(?:${escapeForRegex(unresolvedRepairStep(1))}|${escapeForRegex(unresolvedRepairStep(2))})`;

/**
 * Grammar branch for the OUT_OF_SCOPE voice (ROADMAP 2.349). Same construction
 * as its siblings — every fixed sentence escaped from the very constant the
 * builder emits, the label slot interpolated from
 * {@link CONSTRAINT_GAP_LABEL_MAX_CHARS} — so a copy edit here breaks the
 * probe and the tests loudly rather than silently reverting the user-facing
 * message to the locked template.
 */
const OUT_OF_SCOPE_RE_SRC =
  ' ' +
  escapeForRegex(OUT_OF_SCOPE_LEAD_IN) +
  '(?:' +
  `one of the conditions on your model(?:: ${JOINED_LABELS})?\\.` +
  '|' +
  `\\d{1,3} of the conditions on your model(?:, including ${JOINED_LABELS})?\\.` +
  ')' +
  `(?:${escapeForRegex(consequenceSentence('out_of_scope', 1))}|${escapeForRegex(consequenceSentence('out_of_scope', 2))})` +
  `(?:${escapeForRegex(outOfScopeCloser(1))}|${escapeForRegex(outOfScopeCloser(2))})`;

/**
 * Grammar source for the disclosure suffix, consumed by the registry-side
 * egress allowlist (`isAllowedRunAnalysisAssistantText`) and by this module's
 * own build-time survival probe. Each voice mirrors the four shapes its
 * builder can emit:
 *   - singular count-only / singular naming one label
 *   - plural count-only / plural naming up to {@link MAX_NAMED_CONSTRAINTS}
 * The label slots interpolate {@link CONSTRAINT_GAP_LABEL_MAX_CHARS} rather
 * than hand-mirroring a `{1,N}`, and every fixed sentence is escaped from the
 * very constants the builder emits — so a copy edit that breaks the allowlist
 * breaks the probe and this module's tests loudly, instead of silently
 * reverting the user-facing message to the locked template.
 *
 * ⚠ NOT A FLAT ALTERNATION any more (ROADMAP 2.349). The out-of-scope voice is
 * ADDITIVE — a turn may carry a state voice AND it — and the allowlist gives
 * this module exactly ONE optional slot in `TAIL_PATTERN`, so the slot itself
 * has to admit the pair. Hence the two branches:
 *
 *     (?: STATE_VOICE (?: OUT_OF_SCOPE )? )   — a state voice, optionally
 *                                               followed by the 2.349 sentence
 *     | OUT_OF_SCOPE                          — the 2.349 sentence alone
 *
 * The alternation is ordered so the longer, combined shape is tried first (JS
 * alternation is leftmost-first, and `validation-registry.ts`'s unanchored
 * salvage match would otherwise capture only the trailing half).
 *
 * IT STILL CANNOT MATCH THE EMPTY STRING — every branch requires at least one
 * voice — which the anchored template branch of the allowlist depends on.
 */
export const CONSTRAINT_GAP_DISCLOSURE_RE_SRC =
  `(?:(?:(?:${UNEVALUATED_RE_SRC})|(?:${UNRESOLVED_RE_SRC}))(?:${OUT_OF_SCOPE_RE_SRC})?)` +
  `|(?:${OUT_OF_SCOPE_RE_SRC})`;

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * worst-case builder output (never hand-estimated), so an honest disclosure
 * cannot silently knock the summary back to the locked template on length.
 *
 * Worst case per voice: the plural, three-label form with every label at the
 * cap and a three-digit count. The budget is the worst STATE voice PLUS the
 * out-of-scope voice, because 2.349 lets those two ride together — deriving it
 * as a plain max over all three would under-budget the combined shape by the
 * whole length of the second sentence, and the summary would revert to the
 * locked template with no error anywhere.
 */
function worstCaseFor(voice: DisclosureVoice): number {
  // ⚠ WS-A item 2(a): the quote slot is included at ITS OWN worst case, not at
  // the case the builder can actually reach. `quoteSentence` emits only on the
  // SINGULAR branch while the labels here are the PLURAL three-at-the-cap
  // form, so this over-counts on purpose — a budget that is too generous costs
  // nothing, and a budget that is one character short silently reverts the
  // whole summary to the locked template with no error anywhere (which is the
  // failure this derivation exists to prevent).
  const worstQuote = `${QUOTE_LEAD_IN}${quoted('x'.repeat(CONSTRAINT_GAP_QUOTE_MAX_CHARS))}.`;
  return composeDisclosure(
    voice,
    999,
    Array.from({ length: MAX_NAMED_CONSTRAINTS }, () =>
      'x'.repeat(CONSTRAINT_GAP_LABEL_MAX_CHARS),
    ),
    voice === 'out_of_scope' ? '' : worstQuote,
  ).length;
}

export const CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS =
  Math.max(...STATE_VOICES.map(worstCaseFor)) + worstCaseFor('out_of_scope');

/**
 * Derivation guard for the budget above (CLAUDE.md trap 12d, second face): the
 * `Math.max` is over {@link STATE_VOICES}, and a fourth voice added to
 * {@link ALL_VOICES} without a decision about how it composes would not be
 * counted. This makes that a compile-time-visible, test-visible fact rather
 * than a silent shortfall.
 */
export const DISCLOSURE_VOICES_FOR_BUDGET: readonly DisclosureVoice[] = ALL_VOICES;
