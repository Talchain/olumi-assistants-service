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
 *   2. A remainder carrying a further edit verb ("… and set price to 40",
 *      "… and remove the old one") is a multi-part edit; the edit lane's
 *      part accounting owns those. Not claimed.
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
 * purpose: every entry widens the match. Deliberative openers ("should we",
 * "would it be worth", "what if") are absent by design — those are questions
 * for the coach, not commands.
 */
const COURTESY_PREFIX =
  /^(?:(?:please|ok|okay|yes|sure|also|now|next|then|and)[,\s]+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:can|could)\s+we\s+(?:please\s+)?|i(?:'d|\s+would|\s+want|\s+need)\s+(?:like\s+)?to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+|let'?s\s+|we\s+(?:should|need\s+to|want\s+to)\s+|go\s+ahead\s+and\s+)+/i;

const QUESTION_LEAD =
  /^(?:what|how|why|when|where|who|which|should|does|do|is|are|will|would|could|can|might|shall|may)\b/;

const ADD_VERB = '(?:add|create|include|introduce|insert)';
const DETERMINER =
  "(?:(?:a|an|another|one\\s+more|the|a\\s+new|a\\s+further|a\\s+possible|a\\s+second|a\\s+third|a\\s+fourth|a\\s+fifth)\\s+)?";
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
const P_OPTION_CALLED = new RegExp(
  `^${ADD_VERB}\\s+${DETERMINER}${ADJ}${OPTION_NOUN}\\s*(?:called|named|titled|labelled|labeled|:|-|–|—)\\s*(.+)$`,
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
 * The discriminator is that a legitimate option name after this preposition is
 * a VERB ("partner", "expand"), never a determiner. So a remainder that opens
 * with a determiner, demonstrative or possessive is a TARGET, and the option
 * label is ABSENT — decline, and let the generic lane ask. Never mint X.
 *
 * ⚠ NOT SHARED WITH THE OTHER TRIGGERS, deliberately. `option_called`
 * ("an option called The Big Bet") has an explicit naming word in front of the
 * label, so a determiner there is part of a name the user actually wrote.
 * Two harms, two thresholds: dropping a real add is a gap, minting a name the
 * user never said is a lie, and they must not share one rule.
 */
const TARGET_LEAD = /^(?:the|this|that|these|those|my|our|your|its|their|his|her)\s+/i;
/** A bare frame noun is the container, never the option ("add an option to model"). */
const FRAME_NOUN_LEAD =
  /^(?:model|decision|canvas|graph|scenario|analysis|board|map|diagram|list|set|page|project|plan|mix)\b/i;

const PLURAL_OPTION_WORD = /\b(?:options|alternatives|choices)\b/;
const OPTION_WORD_IN_LABEL = /\b(?:options?|alternatives?|choices?)\b/i;
const GENERIC_LABELS = new Set([
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

  // ⭐ Applied to the RAW capture, before `tidyLabel` strips the leading
  // article — "the model" must still look like "the model" here, or the very
  // determiner that identifies it as a target has already been removed.
  if (candidate.trigger === 'option_to') {
    const raw = candidate.label.trim();
    if (TARGET_LEAD.test(raw) || FRAME_NOUN_LEAD.test(raw)) {
      return NO_MATCH('target_not_a_label');
    }
  }

  const label = tidyLabel(
    candidate.label,
    candidate.labelWasQuoted || candidate.trigger === 'option_called',
  );
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
