/**
 * ⭐ THE CHAT NEVER DENIES THE DRIVER THE SCREEN SHOWS (Science 393023, PR-S2 r5; DL GO #87, 7 Oct).
 *
 * Prod cut-6 smoke (7 Oct 00:34Z, guest T1b, CEE 0f2c3b2): the screen said "It rests most on Olumi’s own estimate of how
 * strongly ‘Starter tier MRR’ affects …" while the Run narration said "…; sensitivity has not established which
 * assumption matters most." The base prompt already forbade that claim (none_measurable → "make no claim about which
 * assumption matters most") and the model said it anyway, so a prompt rule alone is not a guarantee.
 *
 * At the final egress, while the Run's ruled driver display (`goalChanceDriverDisplayForAgent`, the screen's own
 * sentences) is non-empty, ONLY the clause that claims no assumption/factor is established, measured or most worth
 * investigating is removed; the rest of its sentence stays and stays grammatical. Nothing else is touched: a claim about
 * an option, a link's existence, a deadline or timing shares words but is a different claim. One log line per edit
 * (code + turn id + counts, never prose) measures how often the prompt rule misses.
 */
import { log } from '../../utils/telemetry.js';
import { goalChanceDriverDisplayForAgent, goalChanceFactsForAgent, goalChanceRangeBarredForAgent, goalChanceRangeDisplayForAgent } from '../goal-target/goal-chance-range-agent.js';

export const GOAL_CHANCE_DRIVER_ABSENCE_REMOVED = 'GOAL_CHANCE_DRIVER_ABSENCE_REMOVED';
export const GOAL_CHANCE_DRIVER_ABSENCE_KEPT_UNSAFE = 'GOAL_CHANCE_DRIVER_ABSENCE_KEPT_UNSAFE';
export const SENSITIVITY_ABSENCE_REMOVED = 'SENSITIVITY_ABSENCE_REMOVED';
export const SENSITIVITY_ABSENCE_KEPT_UNSAFE = 'SENSITIVITY_ABSENCE_KEPT_UNSAFE';
export const GOAL_CHANCE_ALL_WITHHELD_REMOVED = 'GOAL_CHANCE_ALL_WITHHELD_REMOVED';
export const GOAL_CHANCE_ALL_WITHHELD_KEPT_UNSAFE = 'GOAL_CHANCE_ALL_WITHHELD_KEPT_UNSAFE';

const R = String.raw;
const ITEM = R`(?:assumption|factor|input|driver)s?`;
const WHICH = R`(?:which|what)`;
/** "which assumption in this model matters most": at most four words between the noun and its "most". */
const GAP = R`(?:\s+[\w’'-]+){0,4}?`;
const MOST = R`\s+(?:(?:matters?|mattered)\s+(?:the\s+)?most|(?:is|was|are|were)\s+(?:the\s+)?most\s+(?:worth\s+investigating|important|sensitive|influential|consequential|decisive)|(?:is|are|was|were)\s+the\s+(?:biggest|main|key|largest|strongest)\s+(?:driver|factor|assumption)|(?:deserves?|merits?|needs?)\s+(?:investigation|attention|checking|testing)\s+first|(?:to\s+)?(?:investigate|check|test|examine)\s+first|drives?\s+(?:the\s+)?(?:result|outcome|chance|comparison)\s+most|most\s+(?:affects?|influences?|drives?|moves?|shapes?|changes?)\b|(?:changes?|moves?|shifts?|affects?|drives?|influences?|swings?)\s+(?:(?:the|its|your)\s+)?(?:chances?|results?|outcomes?|comparison|figures?|answer)\s+(?:the\s+)?most\b)`;
const NEG = R`(?:\b(?:does|do|did|has|have|had|could|can|ca|was|were|will|wo|is|would)\s*(?:not|n[’']t)|\bcannot|\bnever)(?:\s+(?:yet|also|itself|still))*`;
const VERB = R`\s+(?:been\s+)?(?:able\s+to\s+)?(?:establish|identif|determin|measur|show|tell|say|know|pin\w*\s+down|single\w*\s+out|isolat|find|found|reveal|indicat|clarif|settl)\w*`;
const ABSENT = R`(?:\s*(?:not|n[’']t)\s*(?:yet\s+)?(?:been\s+)?(?:established|measurable|measured|identified|determined|clear|known|settled|found)|\s+(?:still\s+)?(?:unclear|unknown|undetermined|unmeasured|unestablished))`;
/** "which assumption" · "which of the assumptions" · "what of these factors". */
const WHICH_ITEM = R`${WHICH}\s+(?:of\s+(?:the|these|those|your)\s+)?${ITEM}`;
const MOST_ADJ = R`most[-\s](?:sensitive|important|influential|consequential|decisive)`;
/** ⭐ Wave B8: a superlative noun phrase ("the biggest driver"); "key" was already the predicative form's. */
const SUPERLATIVE = R`(?:biggest|main|key|largest|strongest|dominant|primary)`;
/** Never "the biggest driver for you / of churn / behind costs": unless what follows is the chances, the result or the comparison. */
const NOT_ANOTHER_QUANTITY = R`(?![ \t]{1,3}(?:of|for|behind)[ \t]{1,3}(?!(?:the|these|its|your|each|every)[ \t]{1,3}(?:options?['’]?[ \t]{1,3})?(?:chances?|results?|comparison|outcomes?|goal|options?)\b))`;

/** S2d: 1–6 plain words, none a person who would own a preference (bounded: no `.*`, linear time). */
const GEN_GAP = R`(?:\s+(?!(?:you|we|they|i|team|users?|people|customers?)\b)[\w’'-]+){1,6}?`;
/** The clause ends here: , ; : . ! ) or the end, never "?" and never a closing quote straight after. */
const CLAUSE_END = R`(?=[ \t]{0,4}(?:[.,;:!)](?![”"’'])|$))`;

/** S2e: NEG with BOUNDED runs, for use inside a lookbehind (an unbounded run there is quadratic, DL #2712 r1). */
const NEG_B = R`(?:\b(?:does|do|did|has|have|had|could|can|ca|was|were|will|wo|is|would)[ \t]{0,2}(?:not|n[’']t)|\bcannot|\bnever)`;
/** S2e: a coordinated tail, cut from its "or" so the first, true half stays ("…has not tested the deadline"). */
const COORDINATED_TAIL = /^[ \t]+(?:or|nor)[ \t]/i;

/** The ONE claim class: "no assumption/factor is established as mattering most". Every form is a row in the tests. */
export const DRIVER_ABSENCE_CLAIM = new RegExp([
  // "this run does not establish which assumption matters most" · "sensitivity has not established which …"
  R`${NEG}${VERB}\s+${WHICH_ITEM}${GAP}${MOST}`,
  // "the run does not establish the most important assumption"
  R`${NEG}${VERB}\s+(?:the\s+)?${MOST_ADJ}\s+${ITEM}`,
  // "this run doesn't tell us what matters most" (never "what matters most to you")
  R`${NEG}${VERB}(?:\s+(?:us|you))?\s+what\s+matters\s+most(?!\s+to\s+(?:you|your|them|the\s+team))`,
  // fronted: "Which assumption matters most has not been established"
  // ⭐ Wave B7 (T1b Explain): "Which assumption most affects the comparison has not been measured." (an object after MOST)
  // ⭐ Cut 9 PROD (7 Oct, CEE 7e3f8fb, Explain): "Which assumption matters most to the comparison has not been measured."
  // (a preposition before that object; "to you / your team" is never an object here, so a person's preference stays)
  R`\b${WHICH_ITEM}${GAP}${MOST}(?:\s+(?:(?:to|for|in|on|across)\s+)?(?:the|its|your|this)\s+(?:comparison|result|outcome|chances?|figures?|answer|ranking))?\s+(?:has|have|is|was|remains?)${ABSENT}`,
  // impersonal: "it is unclear which assumption matters most"
  R`\b(?:it\s+is|it[’']s|it\s+remains|it\s+was)\s+(?:still\s+)?(?:unclear|not\s+(?:yet\s+)?(?:clear|known|established)|unknown|uncertain|undetermined)\s+${WHICH_ITEM}${GAP}${MOST}`,
  // "nothing in this run shows which assumption matters most"
  R`\bnothing\b(?:\s+[\w’'-]+){0,4}?\s+(?:shows?|establish(?:es)?|identifies|indicates|tells?\s+us)\s+${WHICH_ITEM}${GAP}${MOST}`,
  // "no most-sensitive assumption was measurable / has been established"
  // ⭐ Wave B6 (7 Oct, CEE 4ce3583, Explain): "No most-sensitive assumption or tipping point was established." (a coordinated noun)
  R`\bno\s+(?:single\s+)?${MOST_ADJ}\s+${ITEM}(?:[ \t]{1,3}or[ \t]{1,3}[\w’'-]{1,40}(?:[ \t]{1,3}[\w’'-]{1,40}){0,2})?\s+(?:was|is|has\s+been|could\s+be|were|are)\s+(?:established|measurable|measured|identified|found|determined)`,
  // ⭐ Wave B6 (Challenge): "No recorded sensitivity result establishes which matters most across options."
  R`\bno\s+(?:(?:recorded|measured|computed)\s+)?(?:(?:sensitivity|robustness)\s+)?(?:results?|analys[ie]s|findings?|evidence|checks?|tests?)\s+(?:yet\s+)?(?:establish|show|identif|determin|indicat|tell|reveal)\w*\s+(?:us\s+)?(?:which|what)(?:\s+(?:of\s+(?:the|these|those)\s+)?${ITEM})?\s+(?:matters?|counts?)\s+(?:the\s+)?most\b(?![ \t]{1,3}to[ \t]{1,3}(?:you|your|them|the[ \t]{1,3}team))`,
  // "no assumption has been identified as the most important"
  R`\bno\s+(?:single\s+)?${ITEM}\s+(?:has\s+been|was|is|could\s+be)\s+(?:identified|established|shown|found|singled\s+out)\s+as\s+(?:the\s+)?(?:most\s+(?:important|influential|sensitive)|(?:main|key|biggest)\s+driver)`,
  // ⭐ Wave B2 (7 Oct 03:3xZ, CEE 044faef): paraphrases keep coming ("…has not established which assumption deserves
  // investigation priority", "…does not establish which assumption would change these chances most"). ONE general,
  // bounded limb: a DENIAL (NEG + VERB) of "which assumption/factor/input/driver", at most 6 words, then "most",
  // "priority" or "most sensitive to" ENDING the clause. Never a question ("?"), never inside a quote (no closing quote
  // after the end), never a person's preference ("which assumption you/we/they/the team … most").
  R`${NEG}${VERB}\s+${WHICH_ITEM}${GEN_GAP}\s+(?:the\s+)?(?:most(?:\s+(?:sensitive\s+to|weight))?|priority)${CLAUSE_END}`,
  // ⭐ Wave B3 (7 Oct, CEE 7addf05, Challenge): "This result does not establish what changes chances most." /
  // "It hasn't established what changes the chances most: …" (a "what" with no assumption noun).
  // ⭐ Wave B5 (7 Oct, CEE 5a260e3, Challenge): "This run doesn’t establish what would change the chances most: …" (a modal).
  // ⭐ Wave B7 (7 Oct, CEE 7e3f8fb, Challenge): "The model hasn’t established which change would shift the chances most."
  R`${NEG}${VERB}(?:\s+(?:us|you))?\s+(?:what|which\s+(?:changes?|levers?|links?|${ITEM}))\s+(?:(?:would|could|might|will|can|does|do)\s+)?(?:changes?|moves?|shifts?|drives?|affects?|influences?|swings?)\s+(?:(?:the|its|your|these|those)\s+)?(?:chances?|results?|outcomes?|comparison|figures?|answer)\s+(?:the\s+)?most${CLAUSE_END}`,
  // ⭐ Wave B3 (T1b provisional view): "…the analysis has not tested the deadline or established investigation priority."
  // Only the "or …" tail is the claim (bounded lookbehind to its negation); `cutOnce` cuts from the "or".
  // ⛔ S2f: the "or" is checked FIRST (lookahead), and each word is bounded: tried at every position, the lookbehind
  // rescanned a long word (base 01a2b27: 380 ms on one 20,000-character word, near-quadratic).
  R`(?=[ \t]{1,3}(?:or|nor)[ \t])(?<=${NEG_B}(?:[ \t]{1,3}[\w’'-]{1,40}){1,6})[ \t]{1,3}(?:or|nor)[ \t]{1,3}(?:yet[ \t]{1,3})?(?:established?|identified|set|determined)[ \t]{1,3}(?:(?:an?|the|any)[ \t]{1,3})?(?:clear[ \t]{1,3})?investigation[ \t]{1,3}priorit(?:y|ies)\b`,
  // ⭐ Wave B4 (7 Oct, CEE 01a2b27, Challenge): "This result doesn’t identify an overall “most influential” assumption."
  // ⭐ Cut 9 PROD (7 Oct, CEE 7e3f8fb, Challenge, beside 2 drivers): "…the supplied analysis does not establish a single most
  // consequential change across options." (a change or lever, as the what-form's "which change"). Never a question.
  R`${NEG}${VERB}\s+(?:(?:an?|the|any)\s+)?(?:(?:overall|single|clear)\s+)?[“"‘']?${MOST_ADJ}[”"’']?\s+(?:${ITEM}|changes?|levers?)\b(?![^.!?\n]{0,120}\?)`,
  // ⭐ Wave B8 (7 Oct, CEE f2c8477, Challenge, beside a range driver): "That does not establish the biggest driver across all
  // options." A superlative NOUN phrase ("the biggest / main / key … driver"). Never a question; never "… for you / of churn"
  // (a person's preference or another quantity's cause), unless it is the chances, the result or the comparison.
  R`${NEG}${VERB}\s+(?:(?:an?|the|any)\s+)?(?:(?:overall|single|clear)\s+)?[“"‘']?${SUPERLATIVE}[”"’']?\s+(?:${ITEM}|changes?|levers?)\b${NOT_ANOTHER_QUANTITY}(?![^.!?\n]{0,120}\?)`,
  // Wave B (7 Oct, unseen-2 provisional view): "it has not established an investigation priority"
  R`${NEG}${VERB}\s+(?:(?:an?|the|any)\s+)?(?:clear\s+)?investigation\s+priorit(?:y|ies)\b`,
  // "there is no investigation priority yet"
  R`\bno\s+(?:clear\s+)?investigation\s+priorit(?:y|ies)\b`,
  // "no single assumption stands out" · "none of the assumptions stands out"
  R`\b(?:no\s+(?:single\s+)?|none\s+of\s+the\s+)${ITEM}\s+(?:stands?|stood)\s+out`,
  // predicative: "investigation priority is not established" · "the most important assumption is unknown"
  // ⭐ Wave B8: the superlative nouns ("the biggest driver is not established"; fronted "Across all options, the biggest
  // driver isn't established"), as the B4 "key" form already was.
  R`\b(?:investigation\s+priority|(?:the\s+)?${MOST_ADJ}\s+${ITEM}|(?:the\s+)?${ITEM}\s+(?:that|which)\s+matters?\s+most|(?:the\s+)?${SUPERLATIVE}\s+(?:${ITEM}|changes?|levers?)${NOT_ANOTHER_QUANTITY})\s+(?:is|was|has|remains?)${ABSENT}`,
].join('|'), 'i');

/**
 * ⭐ Wave B pilot (7 Oct 02:26Z, T1b, CEE 86ccaf3): the Run narration said "Sensitivity of the option comparison has not
 * been measured." while the same Run's robustness check had measured it (a critical fragile link, switch 0.86) and the
 * screen showed "Tipping point: …". DL ruling: the claim is FALSE whenever the Run's robustness was computed, including
 * computed with no fragile link. Its own gate (`robustnessComputed`), the same clause cutter and kept-unsafe rules.
 * The subject must open its clause ("Customers' price sensitivity has not been measured" is a fact about the data).
 */
/** Bounded runs only (DL #2712 r1): an unbounded run inside a lookbehind is rescanned at every position (quadratic). */
const SENS_OPEN = R`(?<=^|\n[ \t]{0,8}(?:(?:[-*•]|\d{1,3}[.)])[ \t]{1,4})?|[.;:!?,—–(*_“"‘][ \t\n]{0,4}|\b(?:and|but|so|yet|while|though|although|because|also|that|as)[ \t\n]{1,4})`;
const SENS_SUBJECT = R`(?:(?:the|overall|decision|factor|option[-\s]comparison|comparison)\s+)*sensitivity(?:\s+(?:analysis|check|checks|testing|tests?))?(?:\s+of\s+(?:the\s+)?(?:option\s+)?(?:comparison|options|results?|ranking|decision))?`;
/** ⭐ Wave B7 (Explain): "Sensitivity and tipping points were not measured." beside a tipping point and a computed check. */
const SENS_ROBUST_SUBJECT = R`(?:the\s+)?(?:robustness(?:\s+and\s+sensitivity)?|sensitivity\s+and\s+(?:robustness|tipping\s+points?)|tipping\s+points?\s+and\s+sensitivity)(?:\s+(?:analysis|check|checks))?`;
const SENS_NOT_DONE = R`\s+(?:has|have|was|were|is|are|had)\s*(?:not|n[’']t)\s+(?:yet\s+)?(?:been\s+)?(?:measured|assessed|tested|run|computed|checked|analysed|analyzed|done|carried\s+out|performed|quantified)`;
export const SENSITIVITY_ABSENCE_CLAIM = new RegExp([
  // "Sensitivity of the option comparison has not been measured" · "decision sensitivity was not measured"
  R`${SENS_OPEN}${SENS_SUBJECT}${SENS_NOT_DONE}`,
  // "robustness and sensitivity were not assessed"
  R`${SENS_OPEN}${SENS_ROBUST_SUBJECT}${SENS_NOT_DONE}`,
  // headline form: "sensitivity not measured"
  R`${SENS_OPEN}${SENS_SUBJECT}\s+not\s+(?:yet\s+)?(?:measured|assessed|tested|computed|quantified)`,
  // "sensitivity is unmeasured / remains untested"
  R`${SENS_OPEN}${SENS_SUBJECT}\s+(?:is|was|remains?)\s+(?:still\s+)?(?:unmeasured|untested|unassessed|unquantified)`,
  // "the run has not measured sensitivity" · "Olumi didn't run a sensitivity analysis"
  R`${NEG}\s+(?:measured?|assess(?:ed)?|test(?:ed)?|check(?:ed)?|run|ran|done|did|quantif(?:y|ied)|comput(?:e|ed))\s+(?:the\s+|a\s+|any\s+)?(?:(?:overall|decision|factor)\s+)?sensitivity\b`,
  // "there was no sensitivity analysis" · "no sensitivity check was run"
  R`\bno\s+(?:(?:overall|decision|factor)\s+)?sensitivity\s+(?:analysis|check|checks|testing|test)\b(?:\s+(?:was|has\s+been|is|were)\s+(?:run|done|carried\s+out|performed|measured))?`,
].join('|'), 'i');

/**
 * ⭐ Wave B4 (7 Oct, CEE 01a2b27 = the 7b tuple, UI efbb0eef): beside range lines the Run narration said "In fact, goal
 * chances are withheld for every option." / "No option’s target chance or profit outcome is established yet." Each is
 * FALSE while the screen shows any option's chance (a range or a point line); it stays TRUE when nothing is shown (the
 * founder brief), so the class has its own gate (`screenShowsAChance`). Never the deadline sentence ("doesn't yet say
 * whether any option gets there"), never "No option can be put forward" (a leader statement).
 */
const OPT = R`(?:every|each|all|all\s+the|any)\s+options?`;
/** A sentence adverb before the subject ("In fact, …") goes with the claim; the shared subject rule refuses a comma. */
const ADV = R`(?:\b(?:in[ \t]{1,4}fact|right[ \t]{1,4}now|for[ \t]{1,4}now|so[ \t]{1,4}far|at[ \t]{1,4}(?:the[ \t]{1,4}moment|present)|currently)[ \t]{0,4},[ \t]{1,4})?`;
/**
 * A noun-subject limb starts its noun phrase: never mid-phrase, so "point / exact chances are withheld for every option"
 * (TRUE beside a range-only screen) never matches from "chances". A plain connector may precede it.
 */
const NP_START = R`(?:(?<![\w’'-][ \t]{0,3})|(?<=\b(?:and|but|so|yet|while|because|that|as|also|now|then)[ \t]{1,3}))`;
/** Precision words: a sentence about the point figure only is true beside a range line. */
const PRECISE = R`(?:point|exact|precise|single|numeric(?:al)?|headline)\b`;
export const ALL_WITHHELD_CLAIM = new RegExp([
  // "(In fact,) goal chances are withheld for every option"
  R`${NP_START}${ADV}\b(?:the\s+)?(?:(?:goal|target)\s+)?chances?\s+(?:are|is|were|was|remains?)\s+(?:(?:being|still)\s+)?withheld\s+(?:for|from)\s+${OPT}\b`,
  // "No option’s target chance (or profit outcome) is established yet"
  R`${ADV}\bno\s+option(?:['’]s)?\s+(?:(?:goal|target)\s+)?chances?(?:\s+or\s+[\w’'-]+(?:\s+[\w’'-]+){0,2})?\s+(?:is|are|has\s+been|have\s+been)\s+(?:yet\s+)?(?:established|known|available|shown|computed)\b`,
  // "none of the options has a chance (shown) yet"
  R`${ADV}\b(?:none|not\s+one)\s+of\s+the\s+options\s+(?:has|have)\s+(?:an?\s+)?(?:(?:goal|target)\s+)?chances?\b`,
  // "I can't yet say how likely any option is …" (never the producer's own "This run doesn’t yet show each option’s
  // chance of …" opening: the producer owns its target/no-target words, and S4b swaps it for the range opening)
  R`${NEG}${VERB}\s+how\s+likely\s+${OPT}\b`,
  // "chances for every option are not shown / withheld"
  R`${NP_START}${ADV}\bchances?\s+(?:for|of)\s+${OPT}\s+(?:are|is)\s+(?:not\s+(?:yet\s+)?(?:shown|established|available)|withheld|unavailable)\b`,
  // ⭐ Wave B7 (Explain, beside 3 ranges): "This result supplies no confirmed goal chances." (never "no point chances")
  R`\b(?:supplies|gives|provides|offers|carries|contains|yields)\s+no\s+(?:(?:confirmed|usable|reliable|valid)\s+)?(?:(?:goal|target)\s+)?chances?\b`,
  // served (corpus): "its unsized links prevent reporting goal chances for every option" · "this run withholds goal chances
  // for every option" · "prevents this run from reporting target chances for any option" · "prevent goal-chance claims for every option"
  // Never negated ("does not withhold … for every option" is the opposite claim), asked about, or a question.
  // The verb is checked first (lookahead), so the lookbehinds run only where it is: linear on any input.
  R`\b(?=withh|prevent)(?<!(?:\b(?:not|never|nothing|no)|n[’']t)[ \t]{1,3})(?<!\b(?:why|whether|asked|asks|ask)\b[^.!?\n]{0,60})(?:withh(?:old|eld)s?|withholding|prevent(?:s|ing|ed)?)(?:\s+(?!${PRECISE})[\w’'-]+){0,6}?\s+(?:(?:goal|target)-)?chances?(?:\s+[\w’'-]+){0,2}?\s+(?:for|of)\s+${OPT}\b(?![^.!?\n]{0,160}\?)`,
].join('|'), 'i');

const CONNECTOR = /^\s*(?:and|but|so|yet|while|though|although|because|which\s+means)\b\s*/i;
/** Clause starts: ";", ":" (not a time), a dash, ", connector", or a comma-less connector with text before it. */
const STRONG_LEFT = /;|:(?!\d)|—|\s[–-]\s/g;
const COMMA_CONNECTOR_LEFT = /,\s*(?:and|but|so|yet|while|though|although|because|which\s+means)\b/gi;
const BARE_CONNECTOR_LEFT = /\s(?:and|but|while|so|yet)\s/gi;
const RIGHT_STOP = /;|:(?!\d)|\s*—|\s[–-]\s|,\s*(?:and|but|so|yet|while|though|although|because|which)\b/i;
/**
 * ⛔ DL ruling (S2 review r1 #2): the edit NEVER removes a figure, a percentage, the deadline or horizon, an option
 * label or a lead-in's content. Such a span is kept and logged (`kept_unsafe`): a missed removal is the old behaviour.
 */
const PROTECTED = /\d|%|\b(?:deadline|horizon|within|months?|weeks?|years?|quarters?)\b/i;
/** S2 review r2 #3: a month named in the span is a date. Case-sensitive, so the modal "may" is never one. */
const MONTH = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/;

const capitalised = (s: string): string => s.replace(/^([^A-Za-z]*)([a-z])/, (_m, lead: string, c: string) => `${lead}${c.toUpperCase()}`);
const words = (s: string): number => s.trim() === '' ? 0 : s.trim().split(/\s+/).length;
function lastMatch(re: RegExp, text: string): { index: number; end: number } | null {
  let last: { index: number; end: number } | null = null;
  for (const m of text.matchAll(re)) last = { index: m.index!, end: m.index! + m[0].length };
  return last;
}

type Cut = { kind: 'cut'; body: string } | { kind: 'lead_in_empty' } | { kind: 'unsafe' };

/** One claim out of one sentence body (no terminal punctuation), or why it must stay. */
function cutOnce(body: string, m: RegExpExecArray, labels: readonly string[]): Cut {
  // S2e: a coordinated tail is its own clause: cut from its "or" to the next clause stop; the same kept-unsafe rules hold.
  if (COORDINATED_TAIL.test(m[0])) {
    const after = body.slice(m.index + m[0].length);
    const stop = RIGHT_STOP.exec(after);
    const end = m.index + m[0].length + (stop === null ? after.length : stop.index);
    const span = body.slice(m.index, end);
    if (PROTECTED.test(span) || MONTH.test(span) || labels.some((l) => l !== '' && span.toLowerCase().includes(l.toLowerCase()))) return { kind: 'unsafe' };
    return { kind: 'cut', body: `${body.slice(0, m.index)}${body.slice(end)}` };
  }
  const pre = body.slice(0, m.index);
  const strong = lastMatch(STRONG_LEFT, pre);
  const comma = lastMatch(COMMA_CONNECTOR_LEFT, pre);
  const bareAll = [...pre.matchAll(BARE_CONNECTOR_LEFT)].map((b) => ({ index: b.index!, end: b.index! + b[0].length }));
  const floor = Math.max(strong?.index ?? -1, comma?.index ?? -1);
  // A comma-less connector opens the clause only with a real clause before it (≥ 3 words since the last boundary).
  const bare = bareAll.filter((b) => b.index > floor && words(pre.slice(Math.max(strong?.end ?? 0, comma?.end ?? 0), b.index)) >= 3).pop() ?? null;
  const left = [strong, comma, bare].filter((b): b is { index: number; end: number } => b !== null)
    .sort((a, b) => b.index - a.index)[0] ?? null;
  // The claim's subject ("the run also", "sensitivity", "it") must be short and plain; a comma or figure in it is unsafe.
  const subject = pre.slice(left?.end ?? 0);
  if (/[,\d%]/.test(subject) || words(subject.replace(/\*+/g, ' ')) > 6) return { kind: 'unsafe' };
  const post = body.slice(m.index + m[0].length);
  const stop = RIGHT_STOP.exec(post);
  const tailStart = m.index + m[0].length + (stop === null ? post.length : stop.index);
  const removeStart = left?.index ?? 0;
  const removed = body.slice(removeStart, tailStart);
  const hasLabel = (t: string): boolean => labels.some((l) => l !== '' && t.toLowerCase().includes(l.toLowerCase()));
  if (PROTECTED.test(removed) || MONTH.test(removed) || hasLabel(removed)) return { kind: 'unsafe' };
  // ⛔ S2 review r2 #4: a comma-less and/while is a clause start only when a NEW subject follows it ("…not tested and the
  // run does not …"); "because price and churn do not …" is one noun phrase, so the sentence is kept.
  if (left !== null && left === bare && subject.trim() !== '' && !/^\s*(?:the|this|that|it|we|i|sensitivity|olumi|there|nothing|no|none)\b/i.test(subject)) return { kind: 'unsafe' };
  const head = body.slice(0, removeStart).replace(/[\s,;:—–-]+$/, '');
  const tail = body.slice(tailStart);
  const colon = left !== null && strong !== null && left.index === strong.index && body[left.index] === ':';
  // "**Sensitivity:** …" / "In short: …": a lead-in left with nothing after it goes with its line.
  // ⛔ S2 review r2 #1: a lead-in holding a figure, a deadline/month or an option label is content, never dropped.
  if (colon && tail.trim() === '' && words(head.replace(/\*+/g, ' ')) <= 3) return PROTECTED.test(head) || MONTH.test(head) || hasLabel(head) ? { kind: 'unsafe' } : { kind: 'lead_in_empty' };
  // S2 review r2 #5: with nothing before the claim, a ", which …" tail would dangle ("Which limits …"): keep it.
  if (head.trim() === '' && /^\s*,\s*which\b/i.test(tail)) return { kind: 'unsafe' };
  // ⛔ S2i: a consequence of the removed clause (", so …", ", which means …") would become a consequence of the text
  // before it ("Three values are Olumi's assumptions, so investigation priority is not established"): an invented cause.
  // The consequence goes WITH its cause, to its own clause stop; the same kept-unsafe rules hold for what that removes.
  const consequence = head.trim() !== '' ? /^\s*,\s*(?:so|which\s+means|therefore|hence|thus)\b/i.exec(tail) : null;
  if (consequence !== null) {
    const rest = tail.slice(consequence[0].length);
    const stop2 = RIGHT_STOP.exec(rest);
    const end2 = tailStart + consequence[0].length + (stop2 === null ? rest.length : stop2.index);
    const removed2 = body.slice(removeStart, end2);
    if (PROTECTED.test(removed2) || MONTH.test(removed2) || hasLabel(removed2)) return { kind: 'unsafe' };
    return { kind: 'cut', body: `${head}${body.slice(end2)}` };
  }
  if (head.trim() === '') return { kind: 'cut', body: capitalised(tail.replace(/^[\s,;:—–-]+/, '').replace(CONNECTOR, '')) };
  return { kind: 'cut', body: `${head}${tail}` };
}

type SentenceCut = { body: string; removed: number; kept: number; leadInEmpty: boolean };

function bodyWithoutClaim(body: string, labels: readonly string[], claim: RegExp): SentenceCut {
  let out = body;
  let removed = 0;
  for (let guard = 0; guard < 4; guard += 1) {
    const m = claim.exec(out);
    if (m === null) break;
    const cut = cutOnce(out, m, labels);
    if (cut.kind === 'unsafe') return { body, removed: 0, kept: 1, leadInEmpty: false };
    if (cut.kind === 'lead_in_empty') return { body, removed: 0, kept: 0, leadInEmpty: true };
    removed += 1;
    out = cut.body;
  }
  return { body: out.trim(), removed, kept: 0, leadInEmpty: false };
}

/**
 * The text without every absence clause; lines and paragraphs keep their shape; a line left empty is dropped. A lead-in
 * whose whole content was the claim drops its line only when that sentence is the whole line; otherwise it is kept.
 */
export function removeDriverAbsenceClaims(text: string, labels: readonly string[] = []): { text: string; removed: number; keptUnsafe: number } {
  return removeClaims(text, labels, DRIVER_ABSENCE_CLAIM);
}

/** S2f: the same edit for the all-withheld class (its own gate at the egress: `screenShowsAChance`). */
export function removeAllWithheldClaims(text: string, labels: readonly string[] = []): { text: string; removed: number; keptUnsafe: number } {
  return removeClaims(text, labels, ALL_WITHHELD_CLAIM);
}

/** The same edit for the sensitivity-absence class (its own gate at the egress: `robustnessComputed`). */
export function removeSensitivityAbsenceClaims(text: string, labels: readonly string[] = []): { text: string; removed: number; keptUnsafe: number } {
  return removeClaims(text, labels, SENSITIVITY_ABSENCE_CLAIM);
}

function removeClaims(text: string, labels: readonly string[], claim: RegExp): { text: string; removed: number; keptUnsafe: number } {
  let removed = 0;
  let keptUnsafe = 0;
  const lines = text.split('\n').map((line) => {
    const prefix = /^(\s*(?:[-*•]|\d+[.)])\s+|\s*)/.exec(line)![0];
    const content = line.slice(prefix.length);
    if (!claim.test(content)) return line;
    // Sentences end at . ! ? (plus any closing markdown or quote) followed by space or end ("4.1%" is not an end).
    const parts = content.split(/(?<=[.!?][*_”’"')\]]*)(?=\s+)/);
    let dropLine = false;
    const kept = parts.map((part) => {
      const lead = /^\s*/.exec(part)![0];
      const sentence = part.slice(lead.length);
      if (!claim.test(sentence)) return part;
      const end = /[.!?]+[*_”’"')\]]*$/.exec(sentence)?.[0] ?? '';
      const cut = bodyWithoutClaim(sentence.slice(0, sentence.length - end.length), labels, claim);
      if (cut.leadInEmpty) {
        if (parts.length === 1) { dropLine = true; removed += 1; return ''; }
        keptUnsafe += 1;
        return part;
      }
      removed += cut.removed;
      keptUnsafe += cut.kept;
      if (cut.removed === 0) return part;
      return cut.body === '' ? '' : `${lead}${cut.body}${end || '.'}`;
    }).filter((p) => p !== '').join('').trim();
    return dropLine || kept === '' ? null : `${prefix}${kept}`;
  });
  if (removed === 0) return { text, removed, keptUnsafe };
  const joined = lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: joined, removed, keptUnsafe };
}

export interface DriverAbsenceEgressOpts {
  readonly analysisResult: unknown;
  readonly graph: unknown;
  readonly requestId: string;
  readonly exitPath: string;
  readonly turnId?: string;
}

/**
 * Final-egress edit: the body by reference unless the Run shows a driver AND the reply (or the provisional view's
 * reasoning shown beneath it) denied one. Never throws. Measured 7 Oct: 8 of 93 distinct served provisional-view
 * reasonings carry the same claim, each with a clean clause boundary.
 */
/**
 * The screen names what a chance rests or depends on most: a licensed driver ("It rests most on …") OR, Wave B (7 Oct,
 * unseen brief, CEE b568cc9), a shown range line ("It depends most on how strongly 'A' affects 'B' …"; the same options
 * the screen draws, unbarred). Either makes "no assumption is established as mattering most" false.
 */
export function screenNamesADriver(analysisResult: unknown, graph: unknown): boolean {
  if (Object.keys(goalChanceDriverDisplayForAgent(analysisResult, graph)).length > 0) return true;
  const ranges = goalChanceRangeDisplayForAgent(analysisResult, graph);
  return Object.keys(ranges ?? {}).some((optionId) => !goalChanceRangeBarredForAgent(analysisResult, optionId));
}

/** S2f: the screen shows at least one option's chance, as a range or a point line (the Agent's own display entitlement). */
export function screenShowsAChance(analysisResult: unknown, graph: unknown): boolean {
  const facts = goalChanceFactsForAgent(analysisResult, graph, true);
  return Object.keys(facts.goal_chance_display ?? {}).length > 0 || Object.keys(facts.goal_chance_range_display ?? {}).length > 0;
}

/**
 * The Run's robustness check RAN: a robustness record with a `fragile_edges` array (empty counts: computed, nothing
 * fragile) and its verdict. Absent, `{}` or no array = not computed, and "sensitivity was not measured" may be true.
 */
export function robustnessComputed(analysisResult: unknown): boolean {
  const ar = analysisResult as { robustness?: unknown; enrichment?: { robustness?: unknown } } | null | undefined;
  const r = (ar?.enrichment?.robustness ?? ar?.robustness) as
    { fragile_edges?: unknown; is_robust?: unknown; display_verdict?: unknown; level?: unknown } | null | undefined;
  if (r === null || typeof r !== 'object' || !Array.isArray(r.fragile_edges)) return false;
  return typeof r.is_robust === 'boolean' || typeof r.display_verdict === 'string' || typeof r.level === 'string';
}

type EgressClass = { readonly remove: (text: string, labels: readonly string[]) => { text: string; removed: number; keptUnsafe: number };
  readonly removedCode: string; readonly keptCode: string; readonly event: string; readonly what: string };
const DRIVER_CLASS: EgressClass = { remove: removeDriverAbsenceClaims, removedCode: GOAL_CHANCE_DRIVER_ABSENCE_REMOVED,
  keptCode: GOAL_CHANCE_DRIVER_ABSENCE_KEPT_UNSAFE, event: 'goal_chance_driver_absence', what: 'denied a goal-chance driver the screen shows' };
const ALL_WITHHELD_CLASS: EgressClass = { remove: removeAllWithheldClaims, removedCode: GOAL_CHANCE_ALL_WITHHELD_REMOVED,
  keptCode: GOAL_CHANCE_ALL_WITHHELD_KEPT_UNSAFE, event: 'goal_chance_all_withheld', what: 'said no option has a chance while the screen shows one' };
const SENSITIVITY_CLASS: EgressClass = { remove: removeSensitivityAbsenceClaims, removedCode: SENSITIVITY_ABSENCE_REMOVED,
  keptCode: SENSITIVITY_ABSENCE_KEPT_UNSAFE, event: 'sensitivity_absence', what: 'said sensitivity was not measured on a Run whose robustness check ran' };

/**
 * Final-egress edit: the body by reference unless the Run shows a driver (or ran its robustness check) AND the reply (or
 * the provisional view's reasoning shown beneath it) denied it. Never throws. Measured 7 Oct: 8 of 93 distinct served
 * provisional-view reasonings carry the driver claim, each with a clean clause boundary.
 */
export function withoutDriverAbsenceClaimsAtEgress<T extends { assistant_text?: unknown }>(body: T, opts: DriverAbsenceEgressOpts): T {
  try {
    const agent = (body as { _agent?: { provisional_view?: { reasoning?: unknown } } })._agent;
    const reasoning = agent?.provisional_view?.reasoning;
    const reply = typeof body.assistant_text === 'string' && body.assistant_text !== '' ? body.assistant_text : undefined;
    const view = typeof reasoning === 'string' && reasoning !== '' ? reasoning : undefined;
    if (reply === undefined && view === undefined) return body;
    const classes = [
      ...(screenNamesADriver(opts.analysisResult, opts.graph) ? [DRIVER_CLASS] : []),
      ...(robustnessComputed(opts.analysisResult) ? [SENSITIVITY_CLASS] : []),
      ...(screenShowsAChance(opts.analysisResult, opts.graph) ? [ALL_WITHHELD_CLASS] : []),
    ];
    if (classes.length === 0) return body;
    const nodes = (opts.graph as { nodes?: unknown } | null | undefined)?.nodes;
    const labels = (Array.isArray(nodes) ? nodes : []).flatMap((n) => {
      const node = n as { kind?: unknown; label?: unknown } | null;
      return node?.kind === 'option' && typeof node.label === 'string' && node.label.trim() !== '' ? [node.label.trim()] : [];
    });
    const removed = new Map<EgressClass, number>();
    const keptUnsafe = new Map<EgressClass, number>();
    const add = (m: Map<EgressClass, number>, c: EgressClass, n: number): void => { if (n > 0) m.set(c, (m.get(c) ?? 0) + n); };
    // A text that would be left empty is kept whole: nothing true would remain to send (logged, never silent).
    const edited = (text: string | undefined): string | undefined => {
      if (text === undefined) return undefined;
      let out = text;
      const counts: Array<[EgressClass, number]> = [];
      for (const c of classes) {
        const edit = c.remove(out, labels);
        add(keptUnsafe, c, edit.keptUnsafe);
        if (edit.removed === 0) continue;
        counts.push([c, edit.removed]);
        out = edit.text;
      }
      if (counts.length === 0) return undefined;
      if (out === '') { for (const [c, n] of counts) add(keptUnsafe, c, n); return undefined; }
      for (const [c, n] of counts) add(removed, c, n);
      return out;
    };
    const newReply = edited(reply);
    const newView = edited(view);
    for (const [c, n] of keptUnsafe) {
      log.warn(
        { event: `agent_lane.${c.event}_kept_unsafe`, code: c.keptCode, turn_id: opts.turnId ?? null,
          request_id: opts.requestId, exit_path: opts.exitPath, kept_count: n },
        `agent-lane: a reply ${c.what}, but no clean clause boundary exists; the sentence was kept`,
      );
    }
    if (newReply === undefined && newView === undefined) return body;
    for (const [c, n] of removed) {
      log.warn(
        { event: `agent_lane.${c.event}_removed`, code: c.removedCode, turn_id: opts.turnId ?? null,
          request_id: opts.requestId, exit_path: opts.exitPath, removed_count: n },
        `agent-lane: the reply ${c.what}; the clause was removed (prompt rule missed)`,
      );
    }
    return {
      ...body,
      ...(newReply !== undefined ? { assistant_text: newReply } : {}),
      ...(newView !== undefined ? { _agent: { ...agent, provisional_view: { ...agent!.provisional_view, reasoning: newView } } } : {}),
    };
  } catch {
    return body;
  }
}
