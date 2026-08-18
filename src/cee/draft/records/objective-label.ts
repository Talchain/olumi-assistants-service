/**
 * ⭐⭐ THE DISPLAY LABEL — AN AUTHORED OBJECTIVE, DERIVED FROM THE USER'S OWN
 * WORDS AND INCAPABLE OF INVENTING NEW ONES.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * A goal node reading
 *   `Compound Goal: we'd like to spend less + increase productivity, while
 *    maintaining code quality`
 * and, beside it, a decision node reading `Decision`.
 *
 * ── THE PRODUCER, READ RATHER THAN INFERRED (P7) ───────────────────────────
 * `instruction.ts:132-189` is the producer of every stated record, and it
 * declares what `source_quote` is FOR:
 *
 *   "`source_quote` is REQUIRED and must be copied VERBATIM from the brief:
 *    do not paraphrase, tidy, translate or summarise it."
 *
 * A `stated_item` has **no `label` field at all** — only `source_quote`. So the
 * projector's `label: quote` was never the producer asking for a display label;
 * it was a display surface borrowing a field whose declared purpose is
 * PROVENANCE. `claims`, by contrast, DO carry a model-authored `label` — which
 * is exactly why every inferred node already reads "Monthly Recurring Revenue"
 * while the user's own goal read like a pasted sentence fragment.
 * `DRAFT_RECORD_STATED_KINDS` carries no `decision` member either, so the
 * decision node is minted by the projector and its label was a literal.
 *
 * ── THE RULING IMPLEMENTED (quality bar §8, answered 18 Aug) ───────────────
 * A1 — the displayed label is an AUTHORED, concise, faithful objective; the
 *      exact user language is retained as PROVENANCE (inspector/hover), NOT as
 *      a permanent second line under every node. `provenance_class` stays
 *      `stated` and `label_authored` is added beside it. No new provenance
 *      class: three live readers key on `stated` (`projector.ts:1077`, `:2046`,
 *      `transforms/schema-v3.ts:1124`).
 * A2 — conservation is asserted across `label ∪ source_quote ∪ goal_threshold
 *      ∪ goal_constraints[]`, never within the label alone. Because A1 keeps
 *      the verbatim, a shorter label loses nothing from the record.
 * A3 — OPEN, and untouched here: no label is ever produced by string-joining
 *      two objectives. Removing the visible defect does not require answering
 *      it, which is exactly why this ships first.
 *
 * ⚠⚠ AND THE FIRST VERSION OF THIS PARAGRAPH WAS THE DEFECT IT DESCRIBES. It
 * rested the faithfulness claim entirely on `labelIsDerivedFrom` — no token may
 * appear that the user did not write. True, and **the wrong claim**: that guard
 * detects ADDITION and every harm this module can do is DELETION. An
 * adversarial corpus written outside the author's head produced a
 * misrepresenting label on **28 of 61** ordinary business quotes, none of which
 * the guard could ever have caught, because every word on screen was the
 * user's own. The vetoes below — stated over what is THROWN AWAY — are what
 * carries the claim now; the token guard is the smaller half.
 *
 * ── THE PROJECTOR'S ARGUMENT, ANSWERED RATHER THAN IGNORED ─────────────────
 * `projector.ts:1342-1344` said: *"The label IS the user's own words. Nothing
 * is paraphrased: a paraphrase badged `stated` would be a misrepresentation of
 * the user to themselves."* That is not a weak argument and it is why this
 * module **cannot paraphrase**. Nothing here generates text. Every token of
 * every label it returns is a token of the user's own quote, modulo case and a
 * closed gerund→base verb map — enforced at runtime by
 * {@link labelIsDerivedFrom}, which REJECTS the derivation if it ever fails.
 * The badge is then made honest in the other direction: `label_authored` says
 * out loud that the display string is ours, and the verbatim rides alongside.
 *
 * ── WHY DETERMINISTIC, NOT GENERATED ───────────────────────────────────────
 * A generated restatement would need a change to the SERVED prompt (v195, in
 * PMS/Supabase, not in this repo) and could not carry the no-invention
 * guarantee above. Structural derivation can, and it is testable at rest.
 *
 * ── WHERE IT REFUSES, AND WHY REFUSAL IS THE FEATURE ───────────────────────
 * Some briefs state a DECISION where a goal is expected ("evaluating whether to
 * invest £800k … or to hire 15 staff"). There is no objective in that sentence
 * to derive; the promises inside it belong to ONE option, and promoting one to
 * "the team's goal" would be a fabrication of exactly the class the quality bar
 * forbids for numbers. So the derivation REFUSES, the verbatim stays as the
 * label, and `label_authored` is absent — the product says it has not authored
 * an objective rather than inventing one.
 *
 * ⭐ REFUSAL IS ALSO WHY THE VETOES ARE SAFE TO ADD FREELY: falling back to the
 * verbatim IS the pre-existing shipped behaviour, so a veto can close a harm
 * and cannot regress a label. Measured on the frozen governed corpus after the
 * vetoes landed: **9 of 13 goal labels authored** (unchanged — no win lost) and
 * **9 of 14 decision labels**, one fewer than before, the single cost being a
 * decision sentence whose trailing clause carries a `but`. Both refusal sets
 * are pinned BY NAME in `__tests__/authored-node-labels.test.ts`, so neither
 * can grow or shrink in silence (the KNOWN-DROPPED discipline, trap 22f).
 */

/** The outcome of one derivation. `authored` holds iff the label changed. */
export interface AuthoredLabel {
  readonly label: string;
  readonly authored: boolean;
  readonly reason?: AuthoredLabelRefusal;
}

export type AuthoredLabelRefusal =
  | "empty"
  /** The quote states a DECISION, not an objective. Nothing to author. */
  | "deliberation_frame"
  /** The quote offers a free-standing alternative — a choice, not an objective. */
  | "states_alternatives"
  /** A reduction would have thrown away a negation, exception, hedge or alternative. */
  | "would_drop_a_qualification"
  /** The surviving head says what the objective is NOT. A disclaimer is not a goal. */
  | "head_disclaims"
  /** Still over the bound after every permitted reduction. */
  | "no_concise_form"
  | "too_few_tokens"
  /** The head names the decision APPARATUS, not its subject ("three changes"). */
  | "names_no_subject"
  /** A token appeared that the user did not write. Never expected; fail closed. */
  | "not_derivable"
  /** Normalisation was a no-op — the quote already IS the objective, verbatim. */
  | "identical_to_quote"
  | "no_derivable_decision_statement";

/**
 * ⭐ DELIBERATION FRAMES — the closed list of constructions in which a sentence
 * describes a CHOICE BEING MADE rather than an objective being pursued.
 *
 * Two jobs, opposite directions, one list:
 *  · on a GOAL it is a REFUSAL signal — the user stated a decision, not a goal;
 *  · on the DECISION node it is the EXTRACTION anchor — what follows the frame
 *    is the user's own statement of what they are deciding.
 *
 * ⚠ CLOSED AND EXPLICIT, never a regex over "decide-ish" language. Every member
 * is unambiguous deliberation English, so a match is evidence and not a guess
 * (P7: the meaning comes from the construction, not from a corpus census).
 * Longest match at the earliest position wins, so `deciding whether to` is not
 * shadowed by `deciding `.
 */
const DELIBERATION_FRAMES: readonly string[] = [
  "should we ",
  "do we ",
  "trying to decide whether to ",
  "trying to decide ",
  "deciding whether to ",
  "deciding how to ",
  "deciding between ",
  "deciding on ",
  "evaluating whether to ",
  "considering whether to ",
  "weighing whether to ",
  "debating whether to ",
  "choosing whether to ",
  "choosing between ",
  "choosing a ",
  "choosing an ",
  "must choose between ",
  "need to choose between ",
  "torn between ",
  "the question is whether to ",
  "the question is whether ",
  "whether to ",
  "we could ",
  "we can either ",
  "our options are ",
  "the options are ",
  "figuring out ",
  "figure out ",
  "working out ",
  "work out ",
  "considering ",
  "deciding ",
];

/**
 * ⭐ THE SUBSET THAT INTRODUCES ALTERNATIVES.
 *
 * Only these may speak for the DECISION node from a goal quote. A bare
 * `considering ` or `figure out ` marks deliberation about a subject; it does
 * not say the sentence is the decision, and treating it as one let a goal from
 * an unrelated sentence become the decision node's name.
 */
const CHOICE_FRAMES: ReadonlySet<string> = new Set([
  "should we ",
  "do we ",
  "trying to decide whether to ",
  "deciding whether to ",
  "deciding between ",
  "evaluating whether to ",
  "considering whether to ",
  "weighing whether to ",
  "debating whether to ",
  "choosing whether to ",
  "choosing between ",
  "must choose between ",
  "need to choose between ",
  "torn between ",
  "the question is whether to ",
  "the question is whether ",
  "whether to ",
  "we could ",
  "we can either ",
  "our options are ",
  "the options are ",
]);

/** Frames whose own verb carries the choice and must NOT be stripped. */
const BETWEEN_FRAMES: ReadonlySet<string> = new Set([
  "deciding between ",
  "choosing between ",
  "must choose between ",
  "need to choose between ",
  "torn between ",
]);

/** Leading modals left behind when a `between` frame keeps its verb. */
const CHOICE_MODALS: readonly string[] = ["must ", "need to ", "have to ", "will "];

function stripChoiceModal(text: string): string {
  const lower = text.toLowerCase();
  for (const modal of CHOICE_MODALS) {
    if (lower.startsWith(modal)) return text.slice(modal.length).trim();
  }
  return text;
}

/**
 * Gerund → base form. A CLOSED MAP, not a `-ing` rule: a general rule turns
 * "marketing" into "market" and "engineering" into "engineer", inventing a verb
 * the user never used. Membership is the whole safety property, so the map is
 * also what {@link labelIsDerivedFrom} consults when it checks that a token was
 * derived rather than introduced.
 */
const GERUND_TO_BASE: ReadonlyMap<string, string> = new Map(
  Object.entries({
    achieving: "achieve",
    adding: "add",
    building: "build",
    choosing: "choose",
    closing: "close",
    cutting: "cut",
    debating: "debate",
    deciding: "decide",
    delivering: "deliver",
    doubling: "double",
    entering: "enter",
    evaluating: "evaluate",
    exiting: "exit",
    expanding: "expand",
    growing: "grow",
    halving: "halve",
    hiring: "hire",
    improving: "improve",
    increasing: "increase",
    investing: "invest",
    keeping: "keep",
    launching: "launch",
    lowering: "lower",
    maintaining: "maintain",
    migrating: "migrate",
    moving: "move",
    opening: "open",
    outsourcing: "outsource",
    partnering: "partner",
    providing: "provide",
    raising: "raise",
    reaching: "reach",
    reducing: "reduce",
    removing: "remove",
    replacing: "replace",
    scaling: "scale",
    shifting: "shift",
    switching: "switch",
  }),
);

/**
 * First-person intent preambles. "We'd like to spend less" states the objective
 * "spend less"; the preamble is the speaker announcing that they are speaking.
 */
const INTENT_PREAMBLES: readonly string[] = [
  "we would like to ",
  "we'd like to ",
  "i would like to ",
  "i'd like to ",
  "we're aiming to ",
  "we are aiming to ",
  "our aim is to ",
  "our goal is to ",
  "the goal is to ",
  "we intend to ",
  "we want to ",
  "we need to ",
  "we plan to ",
  "we hope to ",
  "we aim to ",
  "we must ",
  "i want to ",
  "i need to ",
  "aiming to ",
  "trying to ",
];

/** Lower-cased in a title unless they lead. Calibrated against the four gold
 *  pre-cutover labels (`Reach £20m ARR by End of FY28`,
 *  `Achieve EBITDA Breakeven by Q3 2027`,
 *  `Achieve 15% ARR Growth Without Worsening Attrition`,
 *  `Deliver 4-Day Week Within Budget and CSAT Floor`) — note `Within` and
 *  `Without` are NOT minor there, and `by`/`of`/`and` are. */
const MINOR_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "nor", "but", "of", "in", "on", "at", "to",
  "by", "for", "from", "as", "per", "vs",
]);

/**
 * Nouns that name the decision APPARATUS rather than its subject. A label built
 * on one of these is the same defect as labelling the decision node "Decision":
 * it tells the reader the node's category and nothing about their situation.
 */
const APPARATUS_NOUNS: ReadonlySet<string> = new Set([
  "change", "changes", "option", "options", "alternative", "alternatives",
  "choice", "choices", "thing", "things", "decision", "decisions",
]);

/** A goal label renders in the node body; the four gold labels are 6-8 words. */
const GOAL_WORD_BOUND = 9;
/** The decision node is the graph's root and carries the widest label. */
const DECISION_WORD_BOUND = 12;

const canonical = (text: string): string => String(text ?? "").replace(/\s+/g, " ").trim();
const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Strip surrounding punctuation for comparison, keeping `%` and currency. */
const bareToken = (token: string): string =>
  token.replace(/^[^\p{L}\p{N}£$€]+/u, "").replace(/[^\p{L}\p{N}%]+$/u, "");

/**
 * ⭐⭐ THE NO-INVENTION GUARANTEE, AS AN EXECUTABLE PREDICATE.
 *
 * Every token of `label` must be a TOKEN of `source` — case-folded, or the base
 * form of a gerund the source contains. Nothing else may appear.
 *
 * ⚠ IT WAS A SUBSTRING TEST AND THAT WAS FAR WEAKER THAN THIS DOCSTRING CLAIMED
 * — an adversarial review measured it. `Or` passed against `for the quarter`
 * (`or` sits inside `for`), and `Exceed £250,000` passed against `we must not
 * exceed £250,000`. The first is a genuine hole; the second is the deeper point
 * and is why this guard alone was never enough: **a substring test detects
 * ADDITION, and every harm in this module is DELETION.** Tokenising closes the
 * first. The second is closed by the discard vetoes below, not here.
 *
 * Callers treat `false` as a REFUSAL, not a warning — if the derivation ever
 * produces a token the user did not write, the verbatim is kept instead.
 */
export function labelIsDerivedFrom(label: string, source: string): boolean {
  const sourceTokens = new Set(
    words(source.toLowerCase()).map((t) => bareToken(t)).filter((t) => t.length > 0),
  );
  // Hyphenated compounds are also compared piecewise, so `cost-per-delivery`
  // admits `cost`, `per` and `delivery` — the split is the user's own text.
  for (const token of [...sourceTokens]) {
    for (const piece of token.split("-")) if (piece.length > 0) sourceTokens.add(piece);
  }
  for (const token of words(label)) {
    const bare = bareToken(token).toLowerCase();
    if (bare.length === 0) continue;
    if (sourceTokens.has(bare)) continue;
    if (bare.split("-").every((piece) => piece.length === 0 || sourceTokens.has(piece))) continue;
    let viaGerund = false;
    for (const [gerund, base] of GERUND_TO_BASE) {
      if (base === bare && sourceTokens.has(gerund)) {
        viaGerund = true;
        break;
      }
    }
    if (!viaGerund) return false;
  }
  return true;
}

/** The earliest deliberation frame, preferring the longest at that position. */
function findDeliberationFrame(text: string): { index: number; frame: string } | undefined {
  const lower = text.toLowerCase();
  let best: { index: number; frame: string } | undefined;
  for (const frame of DELIBERATION_FRAMES) {
    const index = lower.indexOf(frame);
    if (index < 0) continue;
    if (
      best === undefined ||
      index < best.index ||
      (index === best.index && frame.length > best.frame.length)
    ) {
      best = { index, frame };
    }
  }
  return best;
}

function stripPreamble(text: string): string {
  const lower = text.toLowerCase();
  for (const preamble of INTENT_PREAMBLES) {
    if (lower.startsWith(preamble)) return text.slice(preamble.length).trim();
  }
  return text;
}

/** Removes `(…)` asides AND reports them, because what was removed is the
 *  thing the veto below has to look at. */
function dropParentheticals(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out = text
    .replace(/\s*\(([^)]*)\)\s*/g, (_m, inner: string) => {
      removed.push(inner);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text: out, removed };
}

/** Cuts that separate a PREAMBLE from its elaboration. The head is a summary. */
const PREAMBLE_CUTS: readonly string[] = [":", ";", " — ", "—"];
/** Cuts that begin a descriptive aside. The head is the thing being described. */
const RELATIVE_CUTS: readonly string[] = [" that ", " which ", " where ", " who "];
/** A top-level `or` — the marker of a second alternative. Hyphenated compounds
 *  ("feast-or-famine") are deliberately NOT matched: only a free-standing `or`. */
const NAMES_AN_ALTERNATIVE = /(^|\s)or(\s|$)/i;

/**
 * ⭐⭐⭐ THE VETOES — AND WHY THEY ARE THE LOAD-BEARING PART OF THIS MODULE.
 *
 * The first version of this file rested its faithfulness claim on
 * {@link labelIsDerivedFrom}: no token may appear that the user did not write.
 * That claim was true and it was **the wrong claim**, because it detects
 * ADDITION and every harm this module can do is DELETION. An adversarial
 * corpus written outside the author's head found 28 of 61 ordinary British
 * business quotes producing a misrepresenting label — and not one of them
 * could ever have been caught by an add-only guard, because every word on
 * screen was genuinely the user's. Trap 13d: the invariant had been written
 * with the same asymmetry as the code it guarded.
 *
 * So the rule is now stated over what is THROWN AWAY. Three vetoes, all
 * FAIL-CLOSED — a veto means "keep the verbatim", which is exactly today's
 * shipped behaviour, so a veto can never make any label worse than it is now.
 */

/**
 * V1 · A DISCARDED SPAN CARRYING A QUALIFICATION. Dropping "but not the
 * payments platform" from a scope, or "but only for new customers" from a
 * price rise, leaves a label that CONTRADICTS its own quote while consisting
 * entirely of the user's words.
 */
const DISCARD_CARRIES_A_QUALIFICATION =
  /(^|[\s,;:—(])(not|never|without|except|unless|only|but|provided|assuming|no|nor|rather|instead)([\s,;:—).]|$)/i;
const CONTRACTED_NEGATION = /\p{L}n['’]t\b/iu;

/**
 * V2 · A SURVIVING HEAD THAT DISCLAIMS. "This is not about cutting costs",
 * "We are not trying to grow headcount", "Cost is not the problem" — each is
 * the user saying what the objective is NOT, immediately before saying what it
 * IS. Displaying the disclaimer as the team's goal inverts them, and it is the
 * worst class the review found because the label reads fluently and wrongly.
 */
const HEAD_DISCLAIMS = /(^|\s)(not|never|no|nor)(\s|$)/i;

/**
 * V3 · A RESTRICTIVE RELATIVE CLAUSE. "any change that degrades latency" is one
 * noun phrase; cutting at ` that ` leaves "without any change", widening a
 * latency guard into a freeze on all change. A relative clause after a
 * quantifier or an exception is restricting it, not describing it.
 */
const HEAD_TAKES_A_RESTRICTIVE_CLAUSE =
  /(^|\s)(without|except|unless|only|any|all|every)(\s|$)/i;

/** V1 proper: a negation, exception or hedge was thrown away. Never exempt. */
const discardCarriesAQualification = (span: string): boolean =>
  DISCARD_CARRIES_A_QUALIFICATION.test(span) || CONTRACTED_NEGATION.test(span);

/**
 * The whole discard veto, for spans with no surviving head to consider
 * (parentheticals). Alternatives count as qualifications here because a
 * parenthetical is removed from INSIDE a clause, never from beside it.
 */
const discardIsUnsafe = (span: string): boolean =>
  discardCarriesAQualification(span) || NAMES_AN_ALTERNATIVE.test(span);

/**
 * ⚠ ONE EXEMPTION, AND IT IS MEASURED RATHER THAN ARGUED.
 *
 * Vetoing every `or`-bearing tail cost two governed decision labels, and the
 * reason is the distinction the original (false) comment was reaching for. When
 * the surviving head is ITSELF a choice construction — "decide between two
 * major feature investments for Q3" — the enumeration that follows the colon is
 * the list of alternatives, and dropping it asserts none of them. When the head
 * is a bare action — "build our own last-mile fleet" — dropping the `or` clause
 * settles a choice the user has not made. The head is what tells the two apart,
 * which is why the veto reads it.
 */
const headNamesTheChoiceItself = (head: string): boolean => /(^|\s)between(\s|$)/i.test(head);

const discardEndsAChoice = (head: string, tail: string): boolean =>
  NAMES_AN_ALTERNATIVE.test(tail) && !headNamesTheChoiceItself(head);

function cutAt(text: string, cuts: readonly string[]): { head: string; tail: string } | undefined {
  const lower = text.toLowerCase();
  let earliest = -1;
  let width = 0;
  for (const cut of cuts) {
    const index = lower.indexOf(cut);
    if (index >= 0 && (earliest === -1 || index < earliest)) {
      earliest = index;
      width = cut.length;
    }
  }
  if (earliest < 0) return undefined;
  return {
    head: text.slice(0, earliest).replace(/[,\s]+$/, "").trim(),
    tail: text.slice(earliest + width),
  };
}

/**
 * Reduce a sentence to its label body with TWO reductions and no more.
 *
 * ⚠ THE COUNT IS DELIBERATE. Each additional reduction rule over natural
 * language buys one direction and reopens another — this estate has watched
 * four consecutive rounds of that on one predicate (trap 22f). Two reductions,
 * both structural:
 *
 *  1. drop a PREAMBLE (`:` `;` `—`) — the head is the sentence's own summary;
 *  2. drop a trailing RELATIVE clause (` that `, ` which `, ` where `, ` who `)
 *     — the head is the thing described.
 *
 * ⚠⚠ THE PREAMBLE CUT USED TO BE UNVETOED, ON THE GROUND THAT *"its head
 * describes the whole set, not one member of it"*. **That sentence was false**
 * and a review measured it: `Build our own last-mile fleet — or partner with a
 * third-party courier` reduced to `Build Our Own Last-Mile Fleet`, promoting an
 * unmade choice to a settled objective. Every cut is now vetoed on the same
 * terms; a reduction that throws away a qualification, an exception or an
 * alternative refuses instead.
 *
 * Returns `undefined` when a veto fires — the caller then keeps the verbatim,
 * which is the pre-existing behaviour, so a veto cannot regress a label.
 */
function reduceToLabelBody(text: string): string | undefined {
  let body = text;
  const preamble = cutAt(body, PREAMBLE_CUTS);
  if (preamble && preamble.head.length > 0) {
    if (discardCarriesAQualification(preamble.tail)) return undefined;
    if (discardEndsAChoice(preamble.head, preamble.tail)) return undefined;
    body = preamble.head;
  }
  const relative = cutAt(body, RELATIVE_CUTS);
  if (relative && relative.head.length > 0) {
    if (discardCarriesAQualification(relative.tail)) return undefined;
    if (discardEndsAChoice(relative.head, relative.tail)) return undefined;
    // V3: the clause is RESTRICTING the head, not describing it.
    if (HEAD_TAKES_A_RESTRICTIVE_CLAUSE.test(relative.head)) return undefined;
    body = relative.head;
  }
  return body.replace(/[,\s]+$/, "").trim();
}

function capitaliseSegment(segment: string, leads: boolean): string {
  if (!leads && MINOR_WORDS.has(segment.toLowerCase())) return segment.toLowerCase();
  return segment.replace(/^(\p{L})/u, (c) => c.toUpperCase());
}

/**
 * Title case in the register of the four gold pre-cutover labels. Tokens the
 * user already cased distinctively (`ARR`, `GMV`, `AI-powered`, `£25M`) and any
 * numeric or currency token are returned BYTE-IDENTICAL — re-casing them would
 * be editing the user's own notation.
 */
function titleCase(text: string): string {
  return words(text)
    .map((token, position) => {
      const bare = bareToken(token);
      if (/\p{Lu}/u.test(bare.slice(1))) return token;
      if (bare.length === 1 && /\p{Lu}/u.test(bare)) return token;
      if (/^[\d£$€]/.test(token)) return token;
      const lower = token.toLowerCase();
      if (position > 0 && MINOR_WORDS.has(lower.replace(/[^\p{L}]/gu, ""))) return lower;
      return lower
        .split("-")
        .map((segment, segmentIndex) =>
          capitaliseSegment(segment, position === 0 && segmentIndex === 0 ? true : segmentIndex === 0),
        )
        .join("-");
    })
    .join(" ");
}

/**
 * Put the leading verb in its base form and drop a bare possessive.
 *
 * ⚠ `our own` is NEVER stripped: "build our own fleet" → "build own fleet" is
 * not a tidier label, it is a broken sentence. The possessive is removed only
 * when it is followed by the thing possessed.
 */
function normaliseHead(text: string): string {
  const tokens = words(text);
  if (tokens.length === 0) return text;
  const base = GERUND_TO_BASE.get(tokens[0].toLowerCase().replace(/[^a-z]/g, ""));
  if (base) tokens[0] = base;
  for (const position of [0, 1]) {
    if (
      tokens.length > position + 1 &&
      /^(our|my)$/i.test(tokens[position]) &&
      !/^own$/i.test(tokens[position + 1])
    ) {
      tokens.splice(position, 1);
      break;
    }
  }
  return tokens.join(" ");
}

/**
 * ⭐ THE GOAL NODE'S DISPLAY LABEL.
 *
 * Returns the authored objective, or the quote unchanged with the reason it
 * could not be authored. IDEMPOTENT: feeding an already-authored label back in
 * returns it unchanged (`identical_to_quote`), so a second pass anywhere in the
 * pipeline cannot compound the transform.
 */
export function deriveGoalObjectiveLabel(quote: string): AuthoredLabel {
  const source = canonical(quote);
  if (source.length === 0) return { label: source, authored: false, reason: "empty" };

  // A decision stated where a goal was expected. There is no objective in the
  // sentence to derive, and one of its options' promises is not the team's goal.
  if (findDeliberationFrame(source)) {
    return { label: source, authored: false, reason: "deliberation_frame" };
  }

  // ⭐ AND THE STRUCTURAL FORM OF THE SAME THING, which the frame list cannot
  // reach. A review found every short deliberation phrasing outside the closed
  // list being authored as a goal — "Torn between rebuilding and buying",
  // "Whether to enter the German market", "Do we rebuild or buy". Some were
  // refused in the first round, but by WORD COUNT, which is the right answer
  // for the wrong reason: shorten the phrasing and they authored. A quote
  // offering a free-standing alternative is a choice, and a choice is not an
  // objective however it is worded. New frames are still added, but this is
  // what stops the list being the only defence.
  if (NAMES_AN_ALTERNATIVE.test(source)) {
    return { label: source, authored: false, reason: "states_alternatives" };
  }

  const stripped = stripPreamble(source);
  const withoutAsides = dropParentheticals(stripped);
  // A parenthetical is a discard like any other — `Move the whole estate to
  // Azure (but not the payments platform)` produced a label contradicting its
  // own quote, entirely in the user's words.
  if (withoutAsides.removed.some(discardIsUnsafe)) {
    return { label: source, authored: false, reason: "would_drop_a_qualification" };
  }
  const body = withoutAsides.text.replace(/[.?!]+$/, "").trim();
  const reduced = reduceToLabelBody(body);
  if (reduced === undefined) {
    return { label: source, authored: false, reason: "would_drop_a_qualification" };
  }
  const normalised = normaliseHead(reduced);
  // ⭐ THE WORST CLASS THE REVIEW FOUND: a disclaimer displayed as the goal.
  // "This is not about cutting costs: we want to double our delivery speed"
  // reduced to `This Is Not About Cutting Costs` — the user's exact words, the
  // exact inverse of their objective, and fluent enough that nobody reading the
  // canvas would query it. A head that says what the objective is NOT is not an
  // objective, whatever survives the cut.
  if (HEAD_DISCLAIMS.test(normalised) || CONTRACTED_NEGATION.test(normalised)) {
    return { label: source, authored: false, reason: "head_disclaims" };
  }
  const tokenCount = words(normalised).length;
  if (tokenCount > GOAL_WORD_BOUND) {
    return { label: source, authored: false, reason: "no_concise_form" };
  }
  if (tokenCount < 2) return { label: source, authored: false, reason: "too_few_tokens" };

  const label = titleCase(normalised);
  if (!labelIsDerivedFrom(label, source)) {
    return { label: source, authored: false, reason: "not_derivable" };
  }
  if (canonical(label) === source) {
    return { label: source, authored: false, reason: "identical_to_quote" };
  }
  return { label, authored: true };
}

/** Sentence split for scanning a brief. Abbreviation-naive by design: a wrong
 *  split can only produce a candidate that fails the bound and is refused. */
const splitSentences = (text: string | undefined): string[] =>
  String(text ?? "")
    .split(/(?<=[.?!])\s+/)
    .map(canonical)
    .filter(Boolean);

/** One candidate sentence → a decision label, or `undefined` to keep looking. */
function decisionLabelFromCandidate(
  candidate: string,
  requireChoiceFrame = false,
): string | undefined {
  const source = canonical(candidate);
  const frame = findDeliberationFrame(source);
  if (!frame) return undefined;
  if (requireChoiceFrame && !CHOICE_FRAMES.has(frame.frame)) return undefined;

  // ⭐ A `between` FRAME IS NOT A PREAMBLE — THE FRAME WORD *IS* THE SEMANTICS.
  // Stripping it turned "We must choose between closing Leeds and closing
  // Bristol" into `Close Leeds and Closing Bristol`, which reads as an
  // instruction to do BOTH. The verb is kept (it is the user's own word), so
  // the label states the choice instead of collapsing it.
  const startsAt = BETWEEN_FRAMES.has(frame.frame)
    ? frame.index
    : frame.index + frame.frame.length;
  const stated = stripChoiceModal(source.slice(startsAt).replace(/[.?!]+$/, "").trim());
  const withoutAsides = dropParentheticals(stated);
  if (withoutAsides.removed.some(discardIsUnsafe)) return undefined;
  const reduced = reduceToLabelBody(withoutAsides.text);
  if (reduced === undefined) return undefined;

  const normalised = normaliseHead(reduced);
  const tokens = words(normalised);
  if (tokens.length < 2 || tokens.length > DECISION_WORD_BOUND) return undefined;

  const head = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (APPARATUS_NOUNS.has(head)) return undefined;

  const label = titleCase(normalised);
  return labelIsDerivedFrom(label, stated) ? label : undefined;
}

/**
 * ⭐ THE DECISION NODE'S LABEL — the user's own statement of what they are
 * deciding, never a join of the option labels.
 *
 * Q3's TWIN forbids programmatic string-joining of option labels and permits an
 * authored contrastive framing. This does neither: it takes the sentence in
 * which the user framed the decision, strips the deliberation frame, and bounds
 * it. The user's own `A or B` phrasing survives when they wrote one; nothing
 * concatenates two node labels.
 *
 * Stated goal quotes are searched FIRST because the model already judged those
 * sentences decision-bearing; the brief is the fallback. When neither yields a
 * short, faithful, subject-naming statement the literal `Decision` is kept and
 * `authored` is false — an honest generic in preference to a confident wrong
 * one, which is the same rule the quality bar applies to numbers.
 */
export function deriveDecisionLabel(input: {
  readonly brief?: string;
  readonly goalQuotes?: readonly string[];
}): AuthoredLabel {
  // ⚠ THE GOAL-QUOTE PATH REQUIRES A *CHOICE* FRAME, NOT ANY FRAME. It accepted
  // any of them, and `considering ` is one — so a brief reading "We are
  // deciding whether to acquire Northgate or build in-house", carrying a goal
  // quote "We are considering hiring 15 more engineers", labelled the decision
  // node `Hire 15 More Engineers`: the decision node naming a goal from a
  // different sentence while the real decision sat unread. Only a frame that
  // introduces alternatives may speak for the decision; everything else falls
  // through to the brief, which is where the decision sentence actually is.
  for (const quote of input.goalQuotes ?? []) {
    const label = decisionLabelFromCandidate(quote, true);
    if (label !== undefined) return { label, authored: true };
  }
  for (const sentence of splitSentences(input.brief)) {
    const label = decisionLabelFromCandidate(sentence);
    if (label !== undefined) return { label, authored: true };
  }
  return { label: "Decision", authored: false, reason: "no_derivable_decision_statement" };
}
