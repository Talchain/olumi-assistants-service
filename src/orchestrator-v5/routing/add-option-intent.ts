/**
 * add_option TEXT intent — the deterministic recogniser for the FOCUSED
 * add-option path (the text leg of S3 §5 / Lane C3, 1 Sep 2026).
 *
 * WHY THIS EXISTS. CEE has carried a complete, zero-LLM typed `add_option`
 * transaction since July (`add-option-transaction.ts` → the referee hold →
 * confirm → atomic apply), but only a CHIP could reach it. A user who TYPES
 * "Add 'Partner with a local distributor' as an option" — or clicks CEE's own
 * widening card, whose `action_prompt` is sent as ordinary free text — was
 * claimed by `EDIT_GRAPH_POSITIVE_REGEX` (it contains "add") and authored by
 * the ~29k-character generic `edit_graph` prompt. This detector is the
 * deterministic gate that hands such a turn to the focused add-option path
 * instead (a small typed proposer → the SAME transaction), with the generic
 * edit lane kept as the fallback for everything it declines.
 *
 * PRECISION FIRST, like its siblings (`configure-option-intent.ts`,
 * `structural-restructure-intent.ts`, and the UI's `addOptionRequest.ts`). A
 * false positive costs the user a held proposal they can decline; a false
 * negative costs nothing — the message takes today's edit lane exactly as
 * before. So the rules require ALL of: an imperative add-verb, a SINGULAR
 * option noun governed by that verb, an extractable label, and no question
 * shape. Deliberation ("should I add an option?"), plural widening ("add more
 * options"), other nouns ("add a factor"), removals and value edits never
 * match.
 *
 * TWO DELIBERATE SCOPE BOUNDARIES (ruling 8, 1 Sep 2026 — narrow the
 * richness, never the end-to-end path):
 *   1. A message whose REMAINDER (the text outside the label) carries a
 *      number, a currency or a percent is NOT claimed: stated effect values
 *      are written by the existing edit lane, whose encoders own scale and
 *      unit resolution. The focused path never writes a number, so it must
 *      not claim a message that states one — that would be the
 *      "typed value silently discarded" class.
 *   2. A REMAINDER carrying a further edit verb ("… and set price to 40") is a
 *      multi-part edit; the edit lane's part accounting owns those. Not
 *      claimed.
 *      ⚠ CORRECTED 2 Sep 2026, MEASURED — this bullet used to offer "… and
 *      remove the old one" as a second example and that example is FALSE for
 *      the prepositional trigger. An INFERRED label runs to the end of the
 *      sentence, so a coordinated second instruction lands INSIDE THE LABEL,
 *      never in the remainder, and the screen above never sees it:
 *        `Add "Partner with a distributor" as an option and remove the old one`
 *            -> DECLINED `compound_edit`   (quoted: the label is bounded)
 *        `Add an option to partner with a distributor and remove the old one`
 *            -> CLAIMED, label "Partner with a distributor and remove the old one"
 *      The obvious fix — run the edit-verb screen over the label too — was
 *      written and REVERTED the same hour: `set` is both an edit verb and an
 *      ordinary verb, so it declined "add an option to SET UP a joint venture",
 *      re-opening the verb-collision class closed one commit earlier. That is
 *      the same oscillation as every other round, and a coordination-boundary
 *      predicate over `", and"` is the one this estate has already proved
 *      unwinnable. So the example is corrected rather than the code, and the
 *      class is CLOSED at 051c964d+ by `COORDINATED_EDIT_INSTRUCTION`; the sets
 *      `CLOSED_COORDINATED_INSTRUCTION` and `KNOWN_OPEN_COORDINATED_NAME`
 *      below pin the fix and the gaps it costs.
 *
 * PURE + TOTAL: no I/O, never throws, never reads the graph. The label is
 * taken from the ORIGINAL message (casing preserved); detection runs on a
 * lower-cased, whitespace-collapsed copy.
 */

import { EDIT_GRAPH_POSITIVE_REGEX } from '../../orchestrator/routing/edit-graph-intent-regex.js';

export type AddOptionIntentTrigger =
  | 'quoted_as_option'
  | 'unquoted_as_option'
  | 'option_called'
  | 'option_to'
  | 'quoted_option_noun';

/**
 * Every trigger, exhaustively — so "all five triggers" is a claim the toolchain
 * checks rather than a number in a sentence.
 *
 * ⚠ THIS IS THE OTHER HALF OF THE PROSE-COUNT RULE. A count that RESTATES A
 * LIST THE READER CAN SEE is a mirror and gets deleted; a count of a CLOSED SET
 * DECLARED ELSEWHERE carries information the reader cannot recover from the
 * line, so it stays — and then it has to be pinned. `all five triggers` is the
 * second kind, and deleting it was a mistake corrected here.
 *
 * `satisfies` catches a typo; the `_Exhaustive` alias catches an OMISSION —
 * add a sixth member to the union without adding it here and the BUILD fails,
 * which no test could do.
 */
export const ALL_ADD_OPTION_TRIGGERS = [
  'quoted_as_option',
  'unquoted_as_option',
  'option_called',
  'option_to',
  'quoted_option_noun',
] as const satisfies readonly AddOptionIntentTrigger[];

type _TriggersExhaustive =
  Exclude<AddOptionIntentTrigger, (typeof ALL_ADD_OPTION_TRIGGERS)[number]> extends never
    ? true
    : ['MISSING TRIGGER in ALL_ADD_OPTION_TRIGGERS'];
const _triggersExhaustive: _TriggersExhaustive = true;
void _triggersExhaustive;

export type AddOptionIntentNoMatchReason =
  | 'empty'
  | 'question'
  | 'not_add_option_shape'
  | 'plural_or_deliberative'
  | 'label_unsafe'
  | 'compound_edit'
  | 'carries_values'
  | 'target_not_a_label';

export type AddOptionIntentDetection =
  | {
      readonly matched: true;
      readonly trigger: AddOptionIntentTrigger;
      /** The option name as the user wrote it (trimmed, quotes stripped, first letter capitalised). */
      readonly label: string;
      /** The user's words OUTSIDE the label and the add-option frame (may be empty). */
      readonly remainder: string;
    }
  | { readonly matched: false; readonly reason: AddOptionIntentNoMatchReason };

const NO_MATCH = (reason: AddOptionIntentNoMatchReason): AddOptionIntentDetection => ({
  matched: false,
  reason,
});

/**
 * Courtesy / framing prefixes stripped before the imperative test. SMALL on
 * purpose: every entry widens the match.
 *
 * ⚠ WHAT IS AND IS NOT EXCLUDED — corrected 3 Sep 2026, because the previous
 * wording overclaimed and a reviewer measured the gap. INTERROGATIVE
 * deliberation is excluded ("should we…", "would it be worth…", "what if…"),
 * but by `QUESTION_LEAD` and the `?` test, not by this list. DIRECTIVE
 * first-person openers — "we should", "we need to", "we want to" — are
 * DELIBERATELY ACCEPTED here: "we should add an option called Outsource" is a
 * decision, not a question.
 *
 * The consequence, measured and pinned rather than papered over: a directive
 * opener carrying a DEFERRAL as its label is claimed —
 * `We should add an option to think about this later` -> "Think about this
 * later". The opener is fine; the LABEL is the problem, and hedge/deferral
 * phrases are an OPEN class ("later", "TBD", "we'll see", "park this",
 * "circle back"), so by this module's standing ruling they are pinned rather
 * than chased. See `KNOWN_OPEN_DEFERRAL_LABEL`.
 */
const COURTESY_PREFIX =
  /^(?:(?:please|ok|okay|yes|sure|also|now|next|then|and)[,\s]+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:can|could)\s+we\s+(?:please\s+)?|i(?:'d|\s+would|\s+want|\s+need)\s+(?:like\s+)?to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+|let'?s\s+|we\s+(?:should|need\s+to|want\s+to)\s+|go\s+ahead\s+and\s+)+/i;

const QUESTION_LEAD =
  /^(?:what|how|why|when|where|who|which|should|does|do|is|are|will|would|could|can|might|shall|may)\b/;

const ADD_VERB = '(?:add|create|include|introduce|insert)';
/**
 * The determiners that may introduce the OPTION NOUN ("add A new option").
 *
 * ⭐ A LIST, NOT A REGEX LITERAL, because this is the enumeration the target
 * screen must agree with — `another` sat here for a whole review cycle while
 * the target screen, which needed it, hand-listed twelve words of its own. The
 * test file asserts every lead word here is known to the target alphabets, so
 * the next addition cannot go missing the same way. Order is load-bearing
 * (regex alternation is first-match-wins), and `DETERMINER_FRAGMENT` is
 * exported so the spec can pin it byte-for-byte against the literal it
 * replaced.
 *
 * ⚠ THIS COMMENT PREVIOUSLY CLAIMED THAT ASSERTION WHILE NO SUCH ASSERTION
 * EXISTED — caught by an independent review. The measurement had been run
 * once, by hand, and never written down. A comment claiming a guard that is
 * not there is worse than no comment: it is the hand-maintained mirror one
 * level up, and it tells every later reader to stop looking.
 */
export const OPTION_NOUN_DETERMINERS: readonly string[] = [
  'a',
  'an',
  'another',
  'one more',
  'the',
  'a new',
  'a further',
  'a possible',
  'a second',
  'a third',
  'a fourth',
  'a fifth',
];

export const DETERMINER_FRAGMENT = `(?:(?:${OPTION_NOUN_DETERMINERS.map((d) => d.replace(/ /g, '\\s+')).join('|')})\\s+)?`;
const DETERMINER = DETERMINER_FRAGMENT;
const ADJ = '(?:(?:new|strategic|further|possible|additional|extra|alternative)\\s+)?';
const OPTION_NOUN = '(?:option|alternative|choice)\\b(?!s)';
const QUOTE = `["'‘’“”]`;
const QUOTED = `${QUOTE}([^"'‘’“”]{2,160})${QUOTE}`;

/** Pattern 1 — `add "X" as an option …` (the widening card's own shape). */
const P_QUOTED_AS_OPTION = new RegExp(
  `^${ADD_VERB}\\s+${QUOTED}\\s+as\\s+${DETERMINER}${ADJ}${OPTION_NOUN}(.*)$`,
  'i',
);
/** Pattern 2 — `add X as an option …` (unquoted). */
const P_UNQUOTED_AS_OPTION = new RegExp(
  `^${ADD_VERB}\\s+(.{2,160}?)\\s+as\\s+${DETERMINER}${ADJ}${OPTION_NOUN}(.*)$`,
  'i',
);
/** Pattern 3 — `add an option called/named/: X …`. */
/**
 * ⭐ THE NAMING WORDS — WORDS ONLY, NEVER PUNCTUATION.
 *
 * A naming word is what makes a label EXPLICITLY NAMED, and `explicitlyNamed`
 * switches the whole target screen off. So this alternation is a permission
 * list, and punctuation marks were sitting in it: `:` `-` `–` `—`.
 *
 * Anything after a colon or a dash was therefore treated as a name the user
 * had chosen, and walked past every screen in this module:
 *   `Add an option: the model`             -> "The model"
 *   `Add an option - the pricing decision` -> "The pricing decision"
 *   `Add an option: each decision`         -> "Each decision"
 *   `Add an option - Paul's model`         -> "Paul's model"
 *   `Add an option — the canvas`           -> "The canvas"   (em dash too)
 * and the hedges are worse, because the product mints them as option names:
 *   `Add an option: TBD`                        -> "TBD"
 *   `Add an option - not sure which yet`        -> "Not sure which yet"
 *   `Add an option: can we brainstorm together` -> "Can we brainstorm together"
 *   `Add an option - your call`                 -> "Your call"
 * and the hyphen matched INSIDE a word:
 *   `Add an option-level breakdown of the risks` -> "Level breakdown of the risks"
 *
 * REMOVING ENTRIES FROM AN ENUMERATION, not a new predicate — the same
 * safe class as the `plan` head noun. Punctuation is a SEPARATOR; only a word
 * is evidence that the user is naming something. `called`/`named`/`titled`/
 * `labelled` keep working unchanged.
 *
 * ⚠ THE PRICE, ACCEPTED: `Add an option: Outsource to Poland` is now a GAP —
 * the generic edit lane serves it, and by this module's standing asymmetry a
 * gap costs less than minting "TBD" as the name of a strategic option. Pinned
 * in `KNOWN_OPEN_SEPARATOR_NAMING`.
 */
export const NAMING_WORDS = ['called', 'named', 'titled', 'labelled', 'labeled'] as const;

const P_OPTION_CALLED = new RegExp(
  `^${ADD_VERB}\\s+${DETERMINER}${ADJ}${OPTION_NOUN}\\s+(?:${NAMING_WORDS.join('|')})\\s+(.+)$`,
  'i',
);
/** Pattern 4 — `add an option to/of/for/where X`. */
const P_OPTION_TO = new RegExp(
  `^${ADD_VERB}\\s+${DETERMINER}${ADJ}${OPTION_NOUN}\\s+(to|of|for|where|in\\s+which|whereby)\\s+(.{2,160})$`,
  'i',
);
/** Pattern 5 — `add a "X" option`. */
const P_QUOTED_OPTION_NOUN = new RegExp(
  `^${ADD_VERB}\\s+${DETERMINER}${ADJ}${QUOTED}\\s+${OPTION_NOUN}(.*)$`,
  'i',
);

/**
 * ⭐ THE TARGET/LABEL BOUNDARY — the defect this exists to close (2 Sep 2026).
 *
 * "Add an option TO <X>" is two different sentences wearing one shape:
 *   · X is a VERB PHRASE  → X names the option ("to partner with a distributor")
 *   · X is a NOUN PHRASE  → X names the thing the option is added TO
 *                           ("to the model", "for the pricing decision")
 * The second was being claimed and X MINTED AS THE LABEL, so the product
 * proposed an option called "Model", or one called after its own parent
 * decision. That is worse than the generic lane, which handles those turns
 * correctly — a regression dressed as a capability.
 *
 * ⭐⭐ WHY THIS IS BUILT FROM AN ENUMERATION AND NOT A LIST OF EXAMPLES.
 * The first version of this screen hand-listed TWELVE determiners — the ones
 * reproduction had found. English determiners are a CLOSED CLASS of ~45, so
 * THE CLASS SURVIVED ONE WORD SHORTER: `to each decision`, `to every
 * decision`, `to another decision`, `to a new decision`, `to both decisions`
 * and `to Paul's model` all still minted the user's own container as an
 * option name. Measured over an adversarial corpus at that commit: 117 of 196
 * probes minted a target as a label. And `another` was ALREADY in this file's
 * own `DETERMINER` alphabet, fifty lines up — the list to close against was
 * already in the file, unused by the screen that needed it.
 *
 * So the alphabet is ENUMERATED ONCE, exported, and every rule below is
 * derived from it. `add-option-intent.test.ts` asserts the UNION with
 * `DETERMINER`: a determiner added for the OPTION noun phrase can no longer go
 * silently missing from the TARGET screen. (A derived guard proves agreement
 * and never completeness, so the same test also carries a hand-written corpus
 * of the closed class — the two guards are not redundant.)
 *
 * ⭐ TWO SUB-CLASSES, BECAUSE THEY CARRY DIFFERENT EVIDENCE — not one list
 * split for tidiness. They answer different questions and must not share a
 * threshold:
 *
 *   · DEFINITE / DEMONSTRATIVE / POSSESSIVE — `the`, `this`, `my`, `Paul's`.
 *     These PRESUPPOSE AN EXISTING REFERENT: the phrase points at something
 *     the model already has. Whatever its head noun, it is a target.
 *     ("add an option to the big bet" declines — pinned.)
 *
 *   · INDEFINITE / QUANTIFIER / WH / NUMERAL — `a`, `each`, `every`,
 *     `another`, `both`. These presuppose NOTHING, so "a joint venture with
 *     Siemens" is a perfectly good option NAME. They are a target only when
 *     the phrase ALSO names the container ("a new decision", "each decision",
 *     "both decisions"). Widening this half to "any determiner" would close
 *     the lie at the cost of every indefinite option name — a gap the PR's own
 *     asymmetry says is cheap, but a needless one, and this half is where the
 *     legitimate names live.
 *
 * ⚠ NOT SHARED WITH THE OTHER TRIGGERS, deliberately. `option_called`
 * ("an option called The Big Bet") has an explicit naming word in front of the
 * label, so a determiner there is part of a name the user actually wrote.
 * Two harms, two thresholds: dropping a real add is a gap, minting a name the
 * user never said is a lie, and they must not share one rule.
 *
 * ⚠ AND THIS SCREEN IS THE SOLE DEFENCE FOR THIS CLASS. The validator's
 * `LABEL_COLLIDES_WITH_EXISTING_NODE` fires only on an EXACT match with a node
 * label that happens to exist, so "Each decision" and "Paul's model" are
 * accepted by it on any graph without those names. Do not weaken this rule on
 * the belief that a second layer will catch it.
 */

/**
 * Determiners that PRESUPPOSE an existing referent. A phrase they lead points
 * at something already on the model, whatever its head noun.
 */
export const TARGET_DEFINITE_DETERMINERS: readonly string[] = [
  // articles (definite) + demonstratives
  'the',
  'this',
  'that',
  'these',
  'those',
  // possessive determiners
  'my',
  'our',
  'your',
  'its',
  'their',
  'his',
  'her',
  'whose',
];

/**
 * The rest of the closed class: indefinite articles, quantifiers, distributives,
 * wh-determiners and numerals/ordinals. These presuppose nothing, so they mark
 * a target only in company with a container noun (see `CONTAINER_NOUNS`).
 */
export const TARGET_QUANTIFIER_DETERMINERS: readonly string[] = [
  // indefinite articles
  'a',
  'an',
  // additive / identity
  'another',
  'other',
  'such',
  'same',
  // existential, negative, distributive, universal
  'some',
  'any',
  'no',
  'none',
  'each',
  'every',
  'either',
  'neither',
  'all',
  'both',
  'half',
  // degree
  'much',
  'many',
  'more',
  'most',
  'less',
  'least',
  'few',
  'fewer',
  'little',
  'several',
  'enough',
  'plenty',
  // wh-determiners
  'which',
  'what',
  'whichever',
  'whatever',
  // numerals and ordinals
  'one',
  'two',
  'three',
  'four',
  'five',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'next',
  'last',
  'final',
];

/**
 * The CONTAINER the option would be added TO — never the option itself.
 *
 * ⚠ MANY OF THESE ARE ALSO COMMON ENGLISH VERBS (`plan`, `map`, `list`, `set`,
 * `mix`, `project`, `model`, `graph`, `board`, `page`), so this alphabet may
 * only ever be matched where a NOUN is grammatically required: as the WHOLE
 * remainder (`BARE_CONTAINER`), or inside a determiner-led noun phrase
 * (`quantifier + container`). The version of this rule that matched on a bare
 * word boundary declined "add an option to plan a phased rollout", "to set up
 * a joint venture", "to map the supply chain" and their kin — 10 of 10
 * verb-collision probes lost, in the direction this module claims to have
 * parameterised separately.
 *
 * ⭐⭐ AND THIS LIST IS AN OPEN CLASS THAT CANNOT BE CLOSED — see
 * `KNOWN_OPEN_CONTAINER_GAP` at the foot of this file. Determiners are a
 * CLOSED class and are now genuinely closed against it. English common nouns
 * are not. `node`, `key question`, `element`, `driver`, `lever` and `outcome`
 * all name the container in this product's own vocabulary and none of them can
 * be enumerated in advance. Do not start a fifth round of adding words: the
 * exit is the `clarify` arm, rowed as successor work.
 */
export const CONTAINER_NOUNS: readonly string[] = [
  'model',
  'decision',
  'canvas',
  'graph',
  'scenario',
  'analysis',
  'board',
  'map',
  'diagram',
  'list',
  'set',
  'page',
  'project',
  'plan',
  'mix',
];

const alt = (words: readonly string[]): string =>
  words
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

/** `the model`, `this scenario`, `my big bet` — definite, so a target outright. */
const TARGET_DEFINITE_LEAD = new RegExp(`^(?:${alt(TARGET_DEFINITE_DETERMINERS)})\\s+`, 'i');
/**
 * The productive possessive: `Paul's model`, `the team's decision`, `Acme's
 * plan`. A genitive IS a possessive determiner — it simply cannot be listed,
 * so it is matched by its form.
 */
const TARGET_GENITIVE_LEAD = /^[A-Za-z][A-Za-z0-9-]*['’]s\s+/;
/** `each …`, `every …`, `a new …`, `both …` — a target only WITH a container. */
const TARGET_QUANTIFIER_LEAD = new RegExp(`^(?:${alt(TARGET_QUANTIFIER_DETERMINERS)})\\s+`, 'i');
/** The container named anywhere inside that determiner-led phrase. */
const CONTAINER_MENTION = new RegExp(`\\b(?:${alt(CONTAINER_NOUNS)})s?\\b`, 'i');
/**
 * A bare container noun IS the container ("add an option to model"), and the
 * comment above has always said so — this is anchored to the END of the
 * remainder, which is what "bare" means, so the verb readings survive.
 */
const BARE_CONTAINER = new RegExp(`^(?:${alt(CONTAINER_NOUNS)})s?[\\s.,;:!?-]*$`, 'i');

/**
 * Is this remainder a reference to the CONTAINER rather than an option name?
 * Exported so the corpus can bind to the rule itself, not only to its effect.
 */
export function mentionsContainer(raw: string): boolean {
  return CONTAINER_MENTION.test(raw.trim());
}

export function isTargetReference(rawRemainder: string): boolean {
  const raw = rawRemainder.trim();
  if (raw.length === 0) return false;
  if (TARGET_DEFINITE_LEAD.test(raw) || TARGET_GENITIVE_LEAD.test(raw)) return true;
  if (BARE_CONTAINER.test(raw)) return true;
  if (TARGET_QUANTIFIER_LEAD.test(raw) && CONTAINER_MENTION.test(raw)) return true;
  return false;
}

/**
 * ⭐ A SECOND INSTRUCTION COORDINATED ONTO THE FIRST, INSIDE AN INFERRED LABEL.
 *
 * An inferred label runs to the end of the sentence, so "… and remove the old
 * one" lands INSIDE THE LABEL and never reaches `screenRemainder`. The quoted
 * form declines correctly because the quotes bound the label; the unquoted
 * forms were claimed with the dropped instruction swallowed into the option's
 * name. That is a LIE, not a gap: the user asked for two things and silently
 * got one, wearing a nonsense name.
 *
 * ⚠ WHY THIS SHAPE AND NOT THE OBVIOUS ONE. Screening on the EDIT VERB ALONE
 * was written and reverted in this PR: `set` is both an edit verb and an
 * ordinary verb, so it declined "add an option to SET UP a joint venture" and
 * re-opened the verb-collision class closed one commit earlier. This screen
 * requires the CONJUNCTION BEFORE the verb and excludes `set` and `add`, so a
 * label that merely BEGINS with an edit verb ("Remove the middleman", "Change
 * supplier", "Merge with a rival") is untouched. Proposed and measured by an
 * independent reviewer, 8 of 8 coordinated phrasings declining and 19 of 19 of
 * their legitimate names surviving; reproduced here.
 *
 * ⚠⚠ AND THE COST, MEASURED RATHER THAN ASSUMED — it is NOT free, and the
 * reviewer's corpus could not see this because none of its nineteen rows
 * coordinates a SECOND VERB drawn from this list. A single option whose NAME
 * coordinates two actions now declines: 11 of 12 such names, pinned by name in
 * `KNOWN_OPEN_COORDINATED_NAME`. Those are GAPS — the generic edit lane serves
 * them unchanged — and by this module's standing asymmetry a gap is the lesser
 * harm than a dropped instruction. That is the trade, made deliberately and
 * recorded rather than discovered later.
 */
export const COORDINATED_EDIT_INSTRUCTION_SOURCE =
  '(?:,\\s*)?(?:and|then|and then)\\s+(?:remove|delete|drop|rename|replace|update|change|increase|decrease|raise|lower|configure|split|merge|reset|edit|adjust)';
const COORDINATED_EDIT_INSTRUCTION =
  /\b(?:,\s*)?(?:and|then|and then)\s+(?:remove|delete|drop|rename|replace|update|change|increase|decrease|raise|lower|configure|split|merge|reset|edit|adjust)\b/i;

const PLURAL_OPTION_WORD = /\b(?:options|alternatives|choices)\b/;
const OPTION_WORD_IN_LABEL = /\b(?:options?|alternatives?|choices?)\b/i;
/**
 * ⚠ THE ONLY DEFENCE FOR THE ANAPHORA CLASS — and it had no shrink pin until
 * 3 Sep 2026, in the PR that exists to say hand-maintained lists shrink
 * silently.
 *
 * This module's own header calls it "the only defence" against a pointer being
 * minted as an option name, and the anaphora class is one this module
 * DELIBERATELY SHIPS OPEN. Leaving the single guard on a deliberately-open
 * class unpinned is closing instances rather than the class — for the sixth
 * time in one PR. Measured before pinning: deleting an entry left all 353
 * tests GREEN, while the contrast (deleting a `CONTAINER_NOUNS` entry) REDs two
 * named tests, so the suite could see shrinkage in general and simply could not
 * see it here. Repo-wide, it had ONE spec occurrence and that was inside a
 * comment, against twelve real hits for `CONTAINER_NOUNS`.
 *
 * Exported solely so the spec can pin it. ⚠ THE PIN GUARDS MEMBERSHIP DRIFT,
 * NOT MEMBERSHIP: whether these are the RIGHT members is a separate question that
 * this PR does not answer and did not ask. Do not widen it here — the anaphora
 * class is open and no list closes it (see `KNOWN_OPEN_ANAPHORA`).
 */
export const GENERIC_LABELS = new Set([
  'it',
  'this',
  'that',
  'one',
  'something',
  'another one',
  'a new one',
  'the new one',
  'here',
  'there',
]);
/** A number, currency or percent — the sign that the message states a value. */
const VALUE_TOKEN = /(?:\d|[£$€]|\bpercent\b|\bper\s*cent\b|%)/;
const LEADING_ARTICLE = /^(?:the|a|an)\s+/i;
const TRAILING_PUNCT = /[\s.!,;:]+$/;
/** The edit-verb set the generic lane keys on, minus `add` (already consumed). */
const OTHER_EDIT_VERB = new RegExp(
  EDIT_GRAPH_POSITIVE_REGEX.source.replace(/\|?\badd\b\|?/, (m) =>
    m.startsWith('|') && m.endsWith('|') ? '|' : '',
  ),
  'i',
);
/** Frame words that may legitimately follow the label ("on the model", "to the decision"). */
const FRAME_REMAINDER =
  /^(?:[\s.!,;:]*)(?:(?:on|to|in|into|for|under|against)\s+(?:the\s+|this\s+|my\s+|our\s+)?(?:model|decision|canvas|graph|scenario|analysis|list|set)\b)?/i;

function stripQuotedSpans(text: string): string {
  return text.replace(/["'‘’“”][^"'‘’“”]*["'‘’“”]/g, ' ');
}

/**
 * Tidy a captured label WITHOUT rewriting the user's own name.
 *
 * The leading article is scaffolding in "Add THE Berlin office as an option"
 * and part of the NAME in `Add an option called "The Big Bet"`. So it is
 * stripped only where the grammar put it there, never where the user did:
 * `explicitlyNamed` is true for a quoted label and for the `called`/`named`
 * forms, and those keep every word the user typed. A product that quietly
 * renames what someone just told it is the small version of the defect this
 * module exists to prevent.
 */
function tidyLabel(raw: string, explicitlyNamed: boolean): string {
  let trimmed = raw.replace(/\s+/g, ' ').trim().replace(TRAILING_PUNCT, '');
  if (!explicitlyNamed) trimmed = trimmed.replace(LEADING_ARTICLE, '');
  if (trimmed.length === 0) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function labelIsSafe(label: string): boolean {
  if (label.length < 2 || label.length > 120) return false;
  if (!/[a-z]/i.test(label)) return false;
  if (OPTION_WORD_IN_LABEL.test(label)) return false;
  if (GENERIC_LABELS.has(label.toLowerCase())) return false;
  return true;
}

/**
 * Classify the remainder: anything OUTSIDE the label and the add-option frame.
 * Returns null when the remainder is acceptable, else the no-match reason.
 */
function screenRemainder(remainderRaw: string): AddOptionIntentNoMatchReason | null {
  const remainder = remainderRaw.replace(FRAME_REMAINDER, '').replace(/\s+/g, ' ').trim();
  if (remainder.length === 0) return null;
  const unquoted = stripQuotedSpans(remainder);
  if (OTHER_EDIT_VERB.test(unquoted)) return 'compound_edit';
  if (VALUE_TOKEN.test(unquoted)) return 'carries_values';
  return null;
}

interface Candidate {
  readonly trigger: AddOptionIntentTrigger;
  readonly label: string;
  readonly labelWasQuoted: boolean;
  readonly remainder: string;
}

function extractCandidate(text: string): Candidate | null {
  let m = P_QUOTED_AS_OPTION.exec(text);
  if (m) return { trigger: 'quoted_as_option', label: m[1]!, labelWasQuoted: true, remainder: m[2] ?? '' };
  m = P_QUOTED_OPTION_NOUN.exec(text);
  if (m) return { trigger: 'quoted_option_noun', label: m[1]!, labelWasQuoted: true, remainder: m[2] ?? '' };
  m = P_OPTION_CALLED.exec(text);
  if (m) {
    const rest = m[1]!.trim();
    const q = new RegExp(`^${QUOTED}(.*)$`).exec(rest);
    if (q) return { trigger: 'option_called', label: q[1]!, labelWasQuoted: true, remainder: q[2] ?? '' };
    // Unquoted: the label runs to the end of the sentence; a following
    // sentence is the remainder.
    const sentence = /^([^.!;]+)([.!;].*)?$/.exec(rest);
    return {
      trigger: 'option_called',
      label: sentence ? sentence[1]! : rest,
      labelWasQuoted: false,
      remainder: sentence?.[2] ?? '',
    };
  }
  m = P_OPTION_TO.exec(text);
  if (m) {
    const rest = m[2]!.trim();
    const sentence = /^([^.!;]+)([.!;].*)?$/.exec(rest);
    return {
      trigger: 'option_to',
      label: sentence ? sentence[1]! : rest,
      labelWasQuoted: false,
      remainder: sentence?.[2] ?? '',
    };
  }
  m = P_UNQUOTED_AS_OPTION.exec(text);
  if (m) return { trigger: 'unquoted_as_option', label: m[1]!, labelWasQuoted: false, remainder: m[2] ?? '' };
  return null;
}

/**
 * Detect a confirmed "add this option" request and extract the option label.
 * Pure; never throws.
 */
export function detectAddOptionIntent(message: unknown): AddOptionIntentDetection {
  if (typeof message !== 'string') return NO_MATCH('empty');
  const collapsed = message.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return NO_MATCH('empty');
  const stripped = collapsed.replace(COURTESY_PREFIX, '');
  const lower = stripped.toLowerCase();
  if (lower.length === 0) return NO_MATCH('empty');

  // Question shapes never claim the focused path.
  if (lower.endsWith('?') || QUESTION_LEAD.test(lower)) return NO_MATCH('question');

  const candidate = extractCandidate(stripped);
  if (candidate === null) {
    return NO_MATCH(PLURAL_OPTION_WORD.test(lower) ? 'plural_or_deliberative' : 'not_add_option_shape');
  }

  // ⭐ WHETHER THE USER NAMED THE LABEL IS ONE QUESTION, ASKED ONCE.
  //
  // It decides two things that were previously decided separately: whether
  // `tidyLabel` may strip a grammatical article, and whether the target screen
  // applies. They are the same question — "are these the user's own words for
  // the option, or the grammar's words for its container?" — and splitting it
  // is what left the screen on ONE of the five triggers while
  // `Add the model as an option` went straight through `unquoted_as_option`
  // and minted "Model". The flagship defect, alive through a sibling door.
  //
  // ⚠ AND IT IS NOT "SCREEN ALL FIVE TRIGGERS". Measured: that declines
  // `Add an option called The Big Bet`, `Add "The Berlin office" as an option`
  // and `Add a "The Big Bet" option` — explicitly-named labels, one of them
  // this module's own pinned discriminator. A quoted or `called` label is
  // a name the user actually wrote, determiner and all. Deriving the scope
  // from THIS predicate screens exactly the triggers that infer a label and
  // exactly none of the triggers that are handed one.
  const explicitlyNamed = candidate.labelWasQuoted || candidate.trigger === 'option_called';

  // ⚠ AND THE TWO INFERRING TRIGGERS STILL ASK DIFFERENT QUESTIONS — measured,
  // after the first attempt at one shared rule broke this module's own
  // article-strip pin.
  //
  //   · `add an option TO/FOR X`  — X is genuinely ambiguous. A verb phrase
  //     names the option, a noun phrase names the container. A DETERMINER is
  //     the discriminator, whatever the head noun: "the big bet" declines.
  //
  //   · `add X AS AN OPTION`      — the construction ALREADY says X is the
  //     option, so a determiner proves nothing: "add the Berlin office as an
  //     option" is a perfectly good add and its article is scaffolding. Only a
  //     reference to the CONTAINER is a target here — "add the model as an
  //     option", "add each decision as an option".
  //
  // So this trigger takes the INTERSECTION of the two existing predicates
  // rather than a third rule. Screening it with the prepositional rule
  // declines "the Berlin office"; not screening it at all is how "Model" was
  // still being minted at 2d935680.
  //
  // Applied to the RAW capture, before `tidyLabel` strips the leading article —
  // "the model" must still look like "the model" here, or the very determiner
  // that identifies it as a target has already been removed.
  if (!explicitlyNamed) {
    const raw = candidate.label;
    const isTarget =
      candidate.trigger === 'option_to'
        ? isTargetReference(raw)
        : isTargetReference(raw) && mentionsContainer(raw);
    if (isTarget) return NO_MATCH('target_not_a_label');
  }

  // Scoped by QUOTING, not by `explicitlyNamed`: an unquoted `called` label is
  // explicitly named AND runs to the end of the sentence, so it carries the
  // same swallowed instruction. A quoted label is already bounded.
  if (!candidate.labelWasQuoted && COORDINATED_EDIT_INSTRUCTION.test(candidate.label)) {
    return NO_MATCH('compound_edit');
  }

  const label = tidyLabel(candidate.label, explicitlyNamed);
  if (!labelIsSafe(label)) return NO_MATCH('label_unsafe');
  // An UNQUOTED label that carries a number is a value statement swallowed
  // into a name ("… called Outsource that cuts support cost to 30") — the
  // edit lane owns that write. A QUOTED label with a digit is a deliberate
  // name ("'Cut headcount by 10%'") and is accepted.
  if (!candidate.labelWasQuoted && VALUE_TOKEN.test(label)) return NO_MATCH('carries_values');

  const remainderReason = screenRemainder(candidate.remainder);
  if (remainderReason !== null) return NO_MATCH(remainderReason);

  return {
    matched: true,
    trigger: candidate.trigger,
    label,
    remainder: candidate.remainder.replace(/\s+/g, ' ').trim(),
  };
}

/**
 * The clarify chip message for "which decision?" — authored HERE so the chip
 * round-trips through THIS detector by construction (a chip is replayed as
 * user text). Pattern 1 shape with the decision named in the remainder.
 */
export function buildAddOptionClarifyChipMessage(label: string, decisionLabel: string): string {
  const safeLabel = label.replace(/["'‘’“”]/g, '');
  const safeDecision = decisionLabel.replace(/["'‘’“”]/g, '');
  return `Add "${safeLabel}" as an option under "${safeDecision}".`;
}

/**
 * ⭐⭐ THE GAP THIS MODULE SHIPS OPEN, ON PURPOSE AND BY NAME.
 *
 * `isTargetReference`'s quantifier arm is a CONJUNCTION: a closed determiner
 * class AND `CONTAINER_NOUNS`. The determiner half is genuinely closed. The
 * noun half is an OPEN CLASS of English common nouns and no list will close
 * it — an independent corpus found 48 of 52 container-shaped probes minting
 * the user's own container as an option label, on nouns this product uses
 * daily (`node`, `key question`, `element`, `driver`, `lever`, `outcome`).
 * Cardinal number words beyond `five` are open in the same way (`six
 * decisions`); digits are not, because a digit trips the value screen first.
 *
 * ⚠ AND THE REASON THE GENERATED CORPUS CANNOT SEE ANY OF IT: the corpus is
 * generated FROM these lists, so it proves the copies agree and can never
 * prove the list is right. The determiner class was closed against an
 * enumeration correctly and the container class was certified against itself.
 * A derived guard and a hand-written one are not redundant — this is what it
 * costs to ship only the first.
 *
 * So the gap is PINNED rather than hidden. The spec asserts this set EXACTLY:
 * it REDs if a case starts declining (someone closed one — move it out) and
 * REDs if a new case is added (the set grew — say so). A gap recorded in the
 * suite is honest; a gap invisible to it is how four rounds happened.
 *
 * ⭐ THE EXIT IS NOT A FIFTH ROUND. Where the label is a determiner-led phrase
 * whose head noun this list does not carry, the honest answer is neither
 * refuse nor accept but ASK. `AddOptionValidation`'s `kind: 'clarify'` arm
 * (`propose-add-option.ts`) already exists as a TYPE and as a VALIDATOR
 * OUTCOME. ⚠ THE ROUTE DOES NOT RENDER IT: `route-v2.ts:6385` branches only on
 * `composed.status === 'composed'`, and every other status — `clarify`
 * included — falls through to the generic edit lane, emitting
 * `fell_through:text_clarify` (`route-v2.ts:6509`). The clarify arm that IS
 * wired asks WHICH DECISION the option belongs under; it does not ask WHAT THE
 * LABEL SHOULD BE, which is the question this successor needs.
 *
 * ⚠⚠ THIS SENTENCE PREVIOUSLY SAID THE ROUTE "already renders it" — false, and
 * it is the second time in this PR that a comment claimed a mechanism that did
 * not exist (the first was an "asserted byte-identical" check with no
 * assertion). Landing on the one sentence describing the named successor work
 * is the worst place for it: it tells whoever picks this up that the hard half
 * is done. The successor has to WIRE the arm as well as call it.
 * Rowed as successor work; deliberately not built here.
 *
 * Severity, stated exactly: a survivor here reaches the VALIDATOR as a hint,
 * not as the final label — `route-v2.ts` passes `detectedLabel` to the
 * composer and the label that ships is `composed.proposal.label`. So this
 * requires the composer to echo the fragment back. Plausible, one step
 * removed, and NOT WIRE-WITNESSED in either direction.
 */
export const KNOWN_OPEN_CONTAINER_GAP: readonly string[] = [
  // Reported by the independent re-review at 2d935680, by name.
  'Add an option to each node',
  'Add an option to every key question',
  'Add an option to node',
  'Add an option to six decisions',
  // The same class, in this product's own vocabulary.
  'Add an option to each element',
  'Add an option to every driver',
  'Add an option to any lever',
  'Add an option to each outcome',
  // Added by the independent reviewer at 0e703c71 — declared scope must match
  // what is actually measured, not what was first imagined.
  'Add an option to said decision',
  'Add an option to each workspace',
];

/**
 * ⭐ CLOSED at 051c964d+ by `COORDINATED_EDIT_INSTRUCTION`. Kept as a
 * REGRESSION set, not a known-open one: these must now DECLINE, and the spec
 * asserts that. Retiring the constant would delete the evidence that the class
 * was ever open.
 */
export const CLOSED_COORDINATED_INSTRUCTION: readonly string[] = [
  'Add an option to partner with a distributor and remove the old one',
  'Add an option to open a Berlin office and delete the Munich one',
  'Add an option to partner with Siemens, and remove the old one',
  'Add an option called Launch the pilot and then rename the product line',
];

/**
 * ⚠ THE PRICE OF THE SCREEN ABOVE, PINNED BY NAME. A single option whose NAME
 * coordinates two actions, where the second verb happens to sit in the closed
 * edit-verb list, now declines. These are GAPS — the generic edit lane serves
 * them unchanged — and the asymmetry says a gap costs less than a dropped
 * instruction. Recorded so the trade is visible rather than discovered.
 *
 * The reviewer's own 19-row corpus contained no row of this shape, and neither
 * did mine before the screen was proposed: `buy and build`,
 * `acquire and integrate a competitor` and `partner with Siemens and Bosch`
 * all coordinate a noun or a verb OUTSIDE the list. A corpus assembled to
 * defend a predicate tends to share its blind spot.
 */
export const KNOWN_OPEN_COORDINATED_NAME: readonly string[] = [
  'Add an option to rebrand and update the website',
  'Add an option to automate and replace manual QA',
  'Add an option to restructure and merge the two teams',
  'Add an option to relaunch and rename the product',
  'Add an option to modernise and replace the ERP',
  'Add an option to simplify and split the portfolio',
  'Add an option to refinance and lower the debt cost',
  'Add an option to insource and drop the vendor contract',
  'Add an option to downsize and change the operating model',
  'Add an option to digitise and replace paper records',
  'Add an option to renegotiate and lower the lease',
];

/**
 * ⚠ ANAPHORA — A POINTER IS NOT A NAME, AND POINTERS ARE AN OPEN CLASS.
 *
 * The `as an option` frame screens on `isTargetReference(raw) &&
 * mentionsContainer(raw)`, so a determiner-led POINTER carrying no container
 * noun is minted as the option's name: "All of the above", "Last one",
 * "Either of them". `GENERIC_LABELS` is the only defence, and
 * it is a hand-maintained list of an OPEN class.
 *
 * ⭐ BY THE RULING THIS PR ESTABLISHED, THIS IS NOT CHASED. Closed classes
 * close; open classes do not. Determiners closed because English has ~45 of
 * them and no more. Pointers, like container nouns, compose freely ("that last
 * one", "the two we discussed", "whichever you prefer") and no list reaches
 * them. Adding strings would close those rows and nothing else, while reading
 * as though the class were handled — which is how four rounds happened.
 *
 * ⭐⭐ THIS SET IS A SAMPLED FLOOR, NOT AN INVENTORY — and the sentence that
 * used to sit here said the opposite.
 *
 * It briefly claimed the set "tracks measured scope", i.e. that growing it to
 * match what reviewers found was the discipline. That is a TRACKING MIRROR,
 * and it contradicted the paragraph directly above it: the header says
 * enumerating an open class is futile, and the replacement sentence adopted a
 * policy that mandates exactly that enumeration. An independent 43-item sweep
 * of pointer expressions then measured **41 minting outside this set** (123 of
 * 129 across three frames, contrast controls firing both ways in the same
 * run) — so the tracking framing understated the class by roughly 4.5x, on a
 * number the decision to ship it open was justified against.
 *
 * What is true: the members below are a SAMPLE of a class that cannot be
 * enumerated. The set exists to keep the class VISIBLE and NON-SHRINKING —
 * `toBe(9)` stops it being quietly emptied — never to say how large the class
 * is. Do not read its length as a cost estimate, and do not grow it toward the
 * 41: that is the fifth round this module has already ruled out.
 *
 * The exit is the same `clarify` arm named above, and the discriminating
 * control is that `Add the Berlin office as an option` must keep yielding
 * "Berlin office": a determiner-led phrase with a real referent is a NAME.
 */
export const KNOWN_OPEN_ANAPHORA: readonly string[] = [
  'Add all of the above as an option',
  'Add the last one as an option',
  'Add either of them as an option',
  'Add both of those as an option',
  'Add the first one as an option',
  // Sampled 3 Sep 2026 from a reviewer's rows at 17196fdb. These are examples,
  // not an inventory — a later sweep found ~41 more. See the SAMPLED FLOOR note
  // above before adding to this list.
  'Add the same thing as an option',
  'Add the one we discussed as an option',
  'Add whatever the consultants recommended as an option',
  'Add the rest of the shortlist as an option',
];

/**
 * ⚠ THE PRICE OF REMOVING THE PUNCTUATION SEPARATORS, PINNED BY NAME. A real
 * option name introduced by a colon or a dash is now a GAP the generic edit
 * lane serves. Deliberate: the same alternation was minting "TBD" and "your
 * call" as strategic options, and a gap costs less than a lie.
 */
export const KNOWN_OPEN_SEPARATOR_NAMING: readonly string[] = [
  'Add an option: Outsource to Poland',
  'Add an option: Remote-first German team',
  "Let's add another option: Licence the technology",
  'Add a third option: partner with a local distributor',
];

/**
 * ⚠ A DEFERRAL IS NOT AN OPTION, and deferral phrases are an OPEN class.
 *
 * `GENERIC_LABELS` already refuses a handful of pointer-ish strings; these are the same
 * shape one step out. Extending that list would close exactly these rows and
 * read as though the class were handled — the pattern this PR has now measured
 * to fail four times. Pinned, with the `clarify` arm as the exit.
 *
 * ⭐ NOTE THE OVERLAP THAT IS ALREADY CLOSED: the colon/dash forms of the same
 * hedges (`Add an option: TBD`, `Add an option - not sure which yet`) DO now
 * decline, because punctuation no longer confers `explicitlyNamed`. What
 * remains open is the hedge arriving through a real preposition.
 */
export const KNOWN_OPEN_DEFERRAL_LABEL: readonly string[] = [
  'We should add an option to think about this later',
  'We need to add an option to decide later',
];
