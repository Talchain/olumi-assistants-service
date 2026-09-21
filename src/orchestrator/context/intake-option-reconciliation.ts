/**
 * ROADMAP 2.579 — DID THE INTAKE KEEP EVERY OPTION THE USER ENUMERATED?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MEASURED DEFECT (Codex expert session, 5 Aug 2026, run3 of
 * `PHASE0-EVIDENCE-2026-07-28/expert-session-2026-08-05-raw/`, CEE `e82738b`).
 *
 * The user's brief enumerated FIVE options:
 *
 *   "The options are a second production oven line, an automated packing cell,
 *    refrigerated delivery vans, a new retail concession, or an
 *    energy-efficiency retrofit."
 *
 * The drafted graph carried FOUR — `a new retail concession` was not there. The
 * analysis then shipped "Energy-Efficiency Retrofit currently leads by 9
 * percentage points", with `may_name_leading_option: true` on 6/6 wire
 * occurrences.
 *
 * That headline is a claim about which option is BEST. It cannot be true over a
 * candidate set that is missing a candidate: the option that was dropped was
 * never given a chance to win. The per-option numbers computed on the four that
 * WERE captured are real and stay — what is false is the RANKING.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHY THIS MODULE EXISTS AND WHY NOTHING ALREADY IN THE TREE COULD BE REUSED.
 *
 * The row's first investigation concluded the product "diagnosed its own
 * omission and ranked anyway". IT DID NOT. The sentence that reads like a
 * diagnosis is a `bias_signal` block, `type: narrow_framing`, `target_refs: []`
 * — and `draft-bias-signal-blocks.ts` says in its own header that it projects
 * the draft LLM's already-emitted `coaching.bias_signals` verbatim and NEVER
 * synthesises. An LLM said "one option is missing" and happened to be right.
 * No field anywhere carried the fact.
 *
 * Every candidate carrier already in the tree is THE WRONG ORACLE (trap 13c):
 *
 *   - `narrow_framing` is a generic four-value code that also fires for binary
 *     framing, i.e. for briefs with no missing option at all;
 *   - `brief_completeness: partial` was measured TRUE in the failing run and
 *     means "the brief was light on detail" — it fires on most briefs;
 *   - `strengthen_items.action_type === 'add_option'` fires as WIDENING advice
 *     ("consider a further option"), which is the OPPOSITE claim.
 *
 * Gating a truth surface on any of them would trade a product that ranks on an
 * LLM's say-so for one that SUPPRESSES on an LLM's say-so. So this module reads
 * neither the LLM nor any coaching field. It compares TWO PIECES OF CANONICAL
 * PERSISTED STATE — the user's own brief text and the graph's own option labels
 * — and it is deterministic, pure, and identity-matched. Never a count
 * heuristic: "five nouns in, four options out" is not evidence about WHICH
 * option went missing, and the disclosure has to be able to name it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ NOT PERSISTED, DELIBERATELY — DERIVED AT THE POINT OF THE CLAIM.
 *
 * `run_analysis`'s `result.enrichment` is a byte-for-byte pass-through of the
 * PLoT envelope, enforced by `scripts/validate-handler-ownership.sh` §6, so
 * there is no CEE-owned enrichment slot to stamp. The alternative — a sixth
 * `ConstraintVerdictState` — is BLOCKED AT THE PIN, measured by execution
 * rather than read off a comment (see {@link INTAKE_IS_NOT_A_CONSTRAINT_VERDICT}).
 *
 * This is not a workaround; it is the estate's own pattern. `withheld-reason-
 * tail.ts` records the same decision for the ratified constraints it names:
 * they are re-read from persisted `goal_constraints` rather than copied onto
 * the fact, because "a second copy of a label is a second thing to drift"
 * (CLAUDE.md trap 12). The brief and the option labels are canonical persisted
 * state; a copy of them on the fact would be a mirror.
 */

/**
 * How the intake's option set compares with the graph's.
 *
 * THREE ANSWERS, NOT A BOOLEAN, for the same reason `ConstraintVerdictState`
 * has five: "we could not tell" is a distinct answer from "yes" and from "no",
 * and collapsing it either way states something false. Here the third answer is
 * `not_applicable`, and it is by far the most common — a brief that does not
 * enumerate its options in so many words gives this module NOTHING to reconcile,
 * and a module with nothing to reconcile must have no opinion, not a lenient one
 * and not a strict one.
 */
export type IntakeCompletenessState =
  /**
   * There is no enumeration to reconcile against. Reached when the brief is
   * absent or blank, when it carries no explicit options-enumeration cue, when
   * fewer than two candidates survive extraction, when the graph carries no
   * option labels, or when NOT ONE extracted candidate reconciles with an
   * option label (see {@link deriveIntakeOptionReconciliation}, rule 3).
   *
   * Byte-identical to the pre-2.579 product on this path, and it is the default
   * for every brief this module cannot read with confidence.
   */
  | 'not_applicable'
  /**
   * The brief enumerated options and EVERY one of them reconciles with an
   * option on the graph. The candidate set is as complete as the brief says it
   * should be, so nothing is withheld on intake grounds.
   *
   * ⚠ THIS IS NOT A COMPLETENESS CERTIFICATE. It says the options the user
   * SPELLED OUT all survived; it says nothing about an option the user held in
   * their head, mentioned in a later turn, or expressed some other way. No copy
   * built on this state may claim the model is complete.
   */
  | 'reconciled'
  /**
   * The brief enumerated options, at least one of them reconciles with the
   * graph (so the two vocabularies demonstrably line up), and at least one does
   * NOT. A candidate the user named is absent from the set being ranked.
   */
  | 'options_missing';

/**
 * May a leading option be NAMED as the answer, per intake state? Exhaustive by
 * construction — `Record<IntakeCompletenessState, boolean>` makes a new state
 * without a declared answer a compile error rather than a silent `undefined`.
 *
 * Same doctrine, same shape and deliberately the same NAME-STEM as
 * `MAY_NAME_LEADING_OPTION` in `constraint-feasibility.ts`, because the two
 * tables answer the same USER-FACING question ("may this run put an option
 * forward?") from two different bodies of evidence.
 */
export const INTAKE_MAY_NAME_LEADING_OPTION: Readonly<
  Record<IntakeCompletenessState, boolean>
> = Object.freeze({
  not_applicable: true,
  reconciled: true,
  options_missing: false,
});

/**
 * ⚠⚠ WHY THIS IS A SECOND AXIS AND NOT A SIXTH `ConstraintVerdictState` —
 * MEASURED, NOT ASSUMED, AND IT REFUTES THE ROW'S OWN BUILD ORDER.
 *
 * ROADMAP 2.579 and 2.611 both record the intended shape as "a sixth verdict
 * state (plus an olumi-schemas release)". At the pin this repo is on
 * (`@talchain/schemas` 0.38.0, `package.json:91`) that shape is NOT LANDABLE,
 * and the release is not optional plumbing — it is a hard precondition:
 *
 *   `ConstraintVerdictSchema.safeParse({ may_name_leading_option: false,
 *      constraint_verdict_state: 'intake_options_missing' })`  ⇒  **false**
 *   (control, same call with `'unevaluated'`                   ⇒  **true**)
 *
 * That schema is embedded in `RunAnalysisResultSchema`, which is embedded in
 * `RunAnalysisHandlerFactSchema` — `safeParse`d ON WRITE at
 * `tools/handlers/run-analysis.ts:1105` (throws `HandlerResultInvalidError`)
 * and again ON READ through `HandlerFactSchema` at
 * `orchestrator-v5/session/supabase-store.ts:1531`. A sixth state would fail
 * the write, and any row that reached the store would poison every subsequent
 * session read.
 *
 * AND THERE IS A SECOND, INDEPENDENT REASON TO KEEP THEM APART, which survives
 * the schemas release and is the more important of the two — CLAUDE.md trap 21,
 * the leader-claim permission seam that was closed by one PR and re-opened by
 * its neighbour a day later. The two axes ANSWER DIFFERENT QUESTIONS:
 *
 *   `ConstraintVerdictState`  — "was the hard condition the user RATIFIED
 *                               honoured by this result?"   (about the RUN)
 *   `IntakeCompletenessState` — "does the candidate set match what the user
 *                               ENUMERATED?"                (about the INTAKE)
 *
 * A run can be `evaluated_feasible` on every ratified constraint and still be
 * ranking four of five options. Folding intake into the constraint enum would
 * put a fact about the BRIEF inside a union whose every docstring, disclosure
 * and repair step is about CONSTRAINTS — and the copy would then offer "re-state
 * your condition in the same units" to a user whose actual problem is a missing
 * option. Trap 21's rule, applied before the fact rather than after it: when two
 * authorities seem to disagree, name the concepts apart; do not align the
 * defaults.
 *
 * THE DISCLOSED RESIDUAL, stated rather than left to be found. The persisted
 * `constraint_verdict_state` stays a statement about CONSTRAINTS ONLY, so on an
 * intake-withheld turn it can read `not_applicable` while the boolean beside it
 * reads `false`. Nothing downstream re-derives the boolean from the state — the
 * schema deliberately does not cross-validate them, and CEE's reader
 * (`readMayNameLeadingOptionFromResult`) reads the boolean — so no surface
 * un-withholds. One consumer, `withheldLeaderInputNoteForState`, DOES consult
 * the state, and on this path it returns `WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE`:
 * "The option ranking is not shown for this turn, and no option can be put
 * forward from it." That is TRUE and cause-free, never a false cause — the
 * weaker of the two honest notes, not a wrong one. The user still gets the cause
 * on the analysis turn itself, from the disclosure this module feeds. Routing
 * the intake cause into the model-facing note and into
 * `composeWithheldReasonTail` needs the sixth state, hence the schemas release,
 * and is NOT in this change.
 */
export const INTAKE_IS_NOT_A_CONSTRAINT_VERDICT = true as const;

import type { PersistedClaimSafety } from './constraint-feasibility.js';

/** One option the brief spelled out, as extracted and as normalised. */
export interface EnumeratedOption {
  /** The brief's own words, trimmed. Never re-worded; used to NAME the gap. */
  readonly text: string;
  /** Normalised content tokens, in first-seen order. The matching key. */
  readonly tokens: readonly string[];
}

/** The reconciliation for one analysis turn. */
export interface IntakeOptionReconciliation {
  readonly state: IntakeCompletenessState;
  /**
   * The state's declared leading-option answer, copied onto every result so
   * callers read it instead of re-deriving it from `state` (and disagreeing).
   * Always `INTAKE_MAY_NAME_LEADING_OPTION[state]`.
   */
  readonly mayNameLeadingOption: boolean;
  /** Every candidate extracted from the brief. `[]` on `not_applicable`. */
  readonly enumerated: readonly EnumeratedOption[];
  /**
   * The extracted candidates with no counterpart on the graph, in the brief's
   * own order. Non-empty EXACTLY on `options_missing` — the disclosure names
   * these, so it can never say "an option is missing" without saying which.
   */
  readonly missing: readonly EnumeratedOption[];
}

function reconciliation(
  state: IntakeCompletenessState,
  parts: {
    enumerated?: readonly EnumeratedOption[];
    missing?: readonly EnumeratedOption[];
  } = {},
): IntakeOptionReconciliation {
  return {
    state,
    mayNameLeadingOption: INTAKE_MAY_NAME_LEADING_OPTION[state],
    enumerated: parts.enumerated ?? [],
    missing: parts.missing ?? [],
  };
}

/**
 * The cues that mark an EXPLICIT options enumeration.
 *
 * ⚠ PRECISION IS THE WHOLE DESIGN HERE, AND THE DIRECTION OF THE ERROR IS NOT
 * SYMMETRIC. A false negative costs a withhold we should have made — the
 * pre-2.579 status quo. A false positive SUPPRESSES A TRUE RANKING on a brief
 * that was never incomplete, which is the failure mode 2.579's own investigation
 * warned about in as many words. So this list is deliberately short, anchored,
 * and requires the user to have said the word: a brief that merely MENTIONS
 * several nouns is not an enumeration and gets no opinion from this module.
 *
 * Derived from the real capture ("The options are …") plus the nearest
 * variations a person writing the same brief would reach for. It is a
 * hand-written list and therefore exactly the kind of thing CLAUDE.md trap 12
 * warns about — which is why a cue that is absent produces `not_applicable`
 * (no opinion) and never a withhold: the mirror can only ever be SHORT, and a
 * short mirror here fails toward today's behaviour.
 */
const ENUMERATION_CUES: readonly string[] = Object.freeze([
  'the options are',
  'my options are',
  'our options are',
  'the options i am considering are',
  "the options i'm considering are",
  'the choices are',
  'the candidates are',
  'the alternatives are',
  'options are',
  'choosing between',
  'deciding between',
  'the options:',
  'options:',
]);

/**
 * Tokens carrying no identity. Stripped before matching so "a second production
 * oven line" and "Second Production Oven Line" reconcile, and so a candidate
 * made only of these words is discarded rather than matched against everything.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'into',
  'option',
  'options',
  'choice',
  'choices',
  'alternative',
  'alternatives',
  'candidate',
  'candidates',
  'new',
  'our',
  'my',
  'we',
  'us',
]);

/** A candidate longer than this is a clause, not a label. Rejected. */
const MAX_CANDIDATE_WORDS = 10;

/**
 * More candidates than this from one enumeration means the split ran away
 * (a comma-heavy sentence mis-read as a list). The whole extraction is
 * discarded rather than half-trusted.
 */
const MAX_CANDIDATES = 12;

/** Fraction of shared tokens above which two labels are the same option. */
const MATCH_JACCARD_FLOOR = 0.5;

/**
 * Cut a raw enumeration tail at the end of its sentence.
 *
 * ⚠ NOT `split(/[.!?]/)` — CLAUDE.md trap 22 shipped six live defects behind
 * exactly that, because THE DECIMAL POINT IS ALSO A FULL STOP: a window cut at
 * the first `[.!?]` turned "£1.5 million" into "1" before the guard that was
 * supposed to read it ever looked, and the guard was correct and pointed at the
 * wrong bytes. An options list may contain "a 2.5 tonne mixer" or "e.g. a
 * concession", so a terminator is only honoured when it is NOT sitting between
 * two digits and NOT closing a known abbreviation.
 */
const ABBREVIATIONS: readonly string[] = Object.freeze([
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'approx.',
  'no.',
  'ltd.',
  'inc.',
  'plc.',
  'dept.',
]);

function cutAtSentenceEnd(tail: string): string {
  for (let i = 0; i < tail.length; i += 1) {
    const ch = tail[i];
    if (ch === '\n' || ch === ';') return tail.slice(0, i);
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    if (ch === '.') {
      const prev = tail[i - 1];
      const next = tail[i + 1];
      // A sentence-ending period is followed by whitespace or by nothing. A
      // period followed by a character is INSIDE a token: the decimal in
      // "2.5 tonne", the internal stops of "e.g." and "U.K.". This single rule
      // subsumes the decimal case, and the decimal case is asserted separately
      // anyway — it is the one trap 22 actually shipped, and a guard whose
      // motivating case is only implied is a guard nobody will keep.
      if (next !== undefined && !/\s/.test(next)) continue;
      if (prev !== undefined && next !== undefined && /\d/.test(prev) && /\d/.test(next)) {
        continue;
      }
      // A known abbreviation closing here ("e.g. ", "etc. "). Not a terminator.
      const upto = tail.slice(0, i + 1).toLowerCase();
      if (ABBREVIATIONS.some((abbr) => upto.endsWith(abbr))) continue;
    }
    return tail.slice(0, i);
  }
  return tail;
}

/**
 * Normalise one label to its identity tokens.
 *
 * Lowercases; treats hyphens, en-dashes, slashes and underscores as spaces (so
 * "Energy-Efficiency Retrofit" and "energy efficiency retrofit" agree); drops
 * every other non-alphanumeric; removes stopwords; and de-pluralises tokens
 * longer than three characters so "vans" reconciles with "van".
 */
export function normaliseOptionTokens(value: string): string[] {
  const words = value
    .toLowerCase()
    .replace(/[‐-―_/\\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const word of words) {
    const stem = word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
    if (seen.has(stem)) continue;
    seen.add(stem);
    tokens.push(stem);
  }
  return tokens;
}

/**
 * Do these two token sets designate the SAME option?
 *
 * Subset in either direction, or half the union shared. Subset matters more
 * than the ratio does: a drafter routinely shortens ("a second production oven
 * line" ⇒ "Second Production Oven Line" is exact, but "an automated packing
 * cell" ⇒ "Packing Cell" is a strict subset), and it also routinely lengthens
 * ("refrigerated delivery vans" ⇒ "Refrigerated Delivery Vans Fleet").
 */
function sameOption(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  if (shared === 0) return false;
  if (shared === setA.size || shared === setB.size) return true;
  const union = setA.size + setB.size - shared;
  return shared / union >= MATCH_JACCARD_FLOOR;
}

/**
 * Read the option LABELS off the graph-side options array.
 *
 * Accepts the PLoT-shape `options` array the run_analysis handler forwards
 * (each `{id, option_id, label, interventions}`) OR any object carrying a
 * root-level `options` (the persisted graph). Taking both means this never
 * depends on which mirror a given call site happens to hold — the same reason
 * `readRatifiedConstraints` takes both shapes (CLAUDE.md trap 12).
 *
 * Labels only. An option with no usable label contributes nothing rather than a
 * blank that would match everything.
 */
export function readGraphOptionLabels(source: unknown): string[] {
  const array = Array.isArray(source)
    ? source
    : source !== null && typeof source === 'object'
      ? (source as Record<string, unknown>).options
      : undefined;
  if (!Array.isArray(array)) return [];
  const labels: string[] = [];
  for (const entry of array) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = (entry as Record<string, unknown>).label;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) labels.push(trimmed);
  }
  return labels;
}

/**
 * Extract the options the brief SPELLS OUT, in the brief's own order.
 *
 * Exported for its own tests: the extractor and the reconciler fail in
 * different ways and a corpus that can only see them composed cannot say which
 * one was wrong.
 */
export function extractEnumeratedOptions(briefText: string | null | undefined): EnumeratedOption[] {
  if (typeof briefText !== 'string') return [];
  const lower = briefText.toLowerCase();

  let tail: string | null = null;
  for (const cue of ENUMERATION_CUES) {
    const at = lower.indexOf(cue);
    if (at < 0) continue;
    const after = briefText.slice(at + cue.length);
    // Anchored: the cue must end at a word boundary, so "the options aren't"
    // and "…the options are-so-called" do not open an enumeration.
    if (!cue.endsWith(':') && after.length > 0 && !/^[\s:]/.test(after)) continue;
    if (tail === null || at < lower.indexOf(cue)) tail = after;
    // First cue in the text wins; keep scanning only to prefer an earlier hit.
    const earliest = ENUMERATION_CUES.map((c) => lower.indexOf(c)).filter((i) => i >= 0);
    if (earliest.length > 0 && at === Math.min(...earliest)) break;
  }
  if (tail === null) return [];

  const sentence = cutAtSentenceEnd(tail);
  const parts = sentence
    .split(',')
    .flatMap((part) => part.split(/\bor\b|\band\b/i))
    .map((part) => part.replace(/^[\s:;–—-]+/, '').replace(/[\s:;–—-]+$/, '').trim())
    .filter((part) => part.length > 0);

  const out: EnumeratedOption[] = [];
  for (const part of parts) {
    if (part.split(/\s+/).length > MAX_CANDIDATE_WORDS) return [];
    const tokens = normaliseOptionTokens(part);
    if (tokens.length === 0) continue;
    out.push({ text: part, tokens });
  }
  if (out.length > MAX_CANDIDATES) return [];
  return out;
}

/**
 * ⭐ THE reconciliation — the single owner of "does the candidate set match what
 * the user enumerated?".
 *
 * PRECEDENCE, and every rule fails toward `not_applicable` (no opinion, today's
 * behaviour) rather than toward a withhold:
 *
 *   1. No brief, no enumeration cue, fewer than two candidates, or no graph
 *      option labels ⇒ `not_applicable`. There is nothing to compare.
 *   2. Match every candidate against every label by IDENTITY (normalised
 *      content tokens), never by count. Five-in / four-out is not evidence
 *      about WHICH option went missing, and a disclosure that cannot name the
 *      gap cannot offer a repair.
 *   3. ZERO candidates matched ⇒ `not_applicable`. This is the load-bearing
 *      precision guard and it is not an invention: it is the rule
 *      `deriveConstraintVerdict` already uses at its own unenforced seam —
 *      "a single match proves the id spaces DO line up, so any remaining
 *      unmatched item is genuinely unmatched". Zero overlap means the two
 *      vocabularies do not line up at all, which is a statement about this
 *      module's reading of the brief, NOT about the graph. Asserting a missing
 *      option from it would be the LLM-say-so failure mode wearing deterministic
 *      clothes.
 *   4. At least one matched and at least one did not ⇒ `options_missing`.
 *   5. Otherwise ⇒ `reconciled`.
 *
 * PURE. No I/O, no clock, no LLM, no coaching field.
 */
export function deriveIntakeOptionReconciliation(
  briefText: string | null | undefined,
  optionLabels: readonly string[],
): IntakeOptionReconciliation {
  const enumerated = extractEnumeratedOptions(briefText);
  if (enumerated.length < 2) return reconciliation('not_applicable');

  const labelTokens = optionLabels
    .map((label) => normaliseOptionTokens(label))
    .filter((tokens) => tokens.length > 0);
  if (labelTokens.length === 0) return reconciliation('not_applicable');

  const missing: EnumeratedOption[] = [];
  let matched = 0;
  for (const candidate of enumerated) {
    if (labelTokens.some((tokens) => sameOption(candidate.tokens, tokens))) {
      matched += 1;
    } else {
      missing.push(candidate);
    }
  }

  if (matched === 0) return reconciliation('not_applicable', { enumerated });
  if (missing.length > 0) return reconciliation('options_missing', { enumerated, missing });
  return reconciliation('reconciled', { enumerated });
}

/**
 * ⭐ THE GATE — fold the intake answer into the persisted leader permission.
 *
 * `mayNameLeadingOption` (ROADMAP 1.215) is the estate's RATIFIED seam for a
 * withheld-leader turn, and 2.579's ruling is explicit that incompleteness
 * becomes one more input to it rather than a second gate beside it. This is
 * that fold, and it is a CONJUNCTION on purpose: either authority may withhold,
 * neither may grant. The intake answer can only ever take the permission away
 * (`not_applicable` and `reconciled` both declare `true`, so they are
 * transparent), which is what makes this safe to apply unconditionally — a
 * brief this module cannot read leaves the persisted verdict byte-identical.
 *
 * ⚠ THE STATE FIELD IS NOT TOUCHED, AND THAT IS THE POINT.
 * `constraint_verdict_state` is a statement about the CONSTRAINT evidence; this
 * function has nothing true to say about that evidence and must not overwrite
 * it (CLAUDE.md trap 21 — a fix that "aligns" two authorities answering
 * different questions is how the leader-claim seam was re-opened one day after
 * it was closed). The consequence is stated in full on
 * {@link INTAKE_IS_NOT_A_CONSTRAINT_VERDICT}: the pair can read
 * `{may_name_leading_option: false, constraint_verdict_state: 'not_applicable'}`,
 * nothing downstream re-derives the boolean from the state, and the one
 * consumer that reads the state alone degrades to a TRUE cause-free note rather
 * than a false cause.
 *
 * Called at the SAME single site as `projectClaimSafety` — the one stamp in
 * `run_analysis` — so there is exactly one place where the two axes meet.
 *
 * Pure.
 */
export function applyIntakeToLeaderPermission(
  persisted: PersistedClaimSafety,
  intake: IntakeOptionReconciliation,
): PersistedClaimSafety {
  if (intake.mayNameLeadingOption) return persisted;
  return {
    may_name_leading_option: false,
    constraint_verdict_state: persisted.constraint_verdict_state,
  };
}
