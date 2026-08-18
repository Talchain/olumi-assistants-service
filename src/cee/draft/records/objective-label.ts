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
 * an objective rather than inventing one. Measured on the frozen governed
 * corpus: 9 of 13 goal labels authored, 4 refused; 10 of 14 decision labels
 * authored, 4 refused. Both refusal sets are pinned BY NAME in
 * `__tests__/authored-node-labels.test.ts`, so neither can grow or shrink in
 * silence (the KNOWN-DROPPED discipline, trap 22f).
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
  /** No reduction reaches the bound without dropping one of two alternatives. */
  | "would_drop_an_alternative"
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
  "figuring out ",
  "figure out ",
  "working out ",
  "work out ",
  "considering ",
  "deciding ",
];

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
    closing: "close",
    cutting: "cut",
    delivering: "deliver",
    doubling: "double",
    entering: "enter",
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
 * Every token of `label` must be a token of `source` — case-folded, or the base
 * form of a gerund the source contains. Nothing else may appear. This is what
 * makes "authored" safe to badge over a `stated` provenance class: the wording
 * is rearranged and re-cased, never supplied.
 *
 * Callers treat `false` as a REFUSAL, not as a warning — if the derivation ever
 * produces a token the user did not write, the verbatim is kept instead.
 */
export function labelIsDerivedFrom(label: string, source: string): boolean {
  const haystack = source.toLowerCase();
  for (const token of words(label)) {
    const bare = bareToken(token).toLowerCase();
    if (bare.length === 0) continue;
    if (haystack.includes(bare)) continue;
    let viaGerund = false;
    for (const [gerund, base] of GERUND_TO_BASE) {
      if (base === bare && haystack.includes(gerund)) {
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

const dropParentheticals = (text: string): string =>
  text.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

/** Cuts that separate a PREAMBLE from its elaboration. The head is a summary. */
const PREAMBLE_CUTS: readonly string[] = [":", ";", " — ", "—"];
/** Cuts that begin a descriptive aside. The head is the thing being described. */
const RELATIVE_CUTS: readonly string[] = [" that ", " which ", " where ", " who "];
/** A top-level `or` — the marker of a second alternative. Hyphenated compounds
 *  ("feast-or-famine") are deliberately NOT matched: only a free-standing `or`. */
const NAMES_AN_ALTERNATIVE = /(^|\s)or(\s|$)/i;

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
 * both structural, with one safety veto:
 *
 *  1. drop a PREAMBLE (`:` `;` `—`) — the head is the sentence's own summary;
 *  2. drop a trailing RELATIVE clause (` that `, ` which `, ` where `, ` who `)
 *     — the head is the thing described.
 *
 * The veto: a relative cut is REFUSED when the discarded tail names a second
 * alternative, because there the head is one of two options and keeping only it
 * would state that the choice is already made. A preamble cut is not vetoed:
 * its head describes the whole set, not one member of it.
 *
 * Returns `undefined` when the veto fires — the caller must then refuse.
 */
function reduceToLabelBody(text: string): string | undefined {
  let body = text;
  const preamble = cutAt(body, PREAMBLE_CUTS);
  if (preamble && preamble.head.length > 0) body = preamble.head;
  const relative = cutAt(body, RELATIVE_CUTS);
  if (relative && relative.head.length > 0) {
    if (NAMES_AN_ALTERNATIVE.test(relative.tail)) return undefined;
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

  let body = stripPreamble(source);
  body = dropParentheticals(body).replace(/[.?!]+$/, "").trim();
  const reduced = reduceToLabelBody(body);
  if (reduced === undefined) {
    return { label: source, authored: false, reason: "would_drop_an_alternative" };
  }
  const normalised = normaliseHead(reduced);
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
function decisionLabelFromCandidate(candidate: string): string | undefined {
  const source = canonical(candidate);
  const frame = findDeliberationFrame(source);
  if (!frame) return undefined;

  const stated = source.slice(frame.index + frame.frame.length).replace(/[.?!]+$/, "").trim();
  const body = dropParentheticals(stated);
  const reduced = reduceToLabelBody(body);
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
  for (const quote of input.goalQuotes ?? []) {
    const label = decisionLabelFromCandidate(quote);
    if (label !== undefined) return { label, authored: true };
  }
  for (const sentence of splitSentences(input.brief)) {
    const label = decisionLabelFromCandidate(sentence);
    if (label !== undefined) return { label, authored: true };
  }
  return { label: "Decision", authored: false, reason: "no_derivable_decision_statement" };
}
