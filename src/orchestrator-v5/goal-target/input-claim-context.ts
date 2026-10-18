import { bandTheUserWrote, clausesOf, factorTheUserNamed, figuresWrittenIn, linkEffectQuoteContextMiss, quoteSpansIn, sameWord, wordsOf } from '../agent-lane/stated-by-user.js';
import type { InfluenceBand } from '../format/influence-bands.js';

type Entity = { readonly id: string; readonly label: string };
type Link = { readonly from: string; readonly to: string };
const BANDS: readonly InfluenceBand[] = ['weak', 'moderate', 'strong', 'very strong'];

/**
 * ⛔ T2A3 (#2993 check, blocking 2; PL 22:07Z): the user REPORTING Olumi's claim is not stating it. "Olumi says Price has
 * a weak effect on MRR. Is that right?" and "You suggested …; I disagree" were credited as the user's band. Rejected HERE,
 * at the source; affirmative human words still count, whatever the model's own flag says. The attribution covers its own
 * clause up to a first-person claim ("Olumi says Quality is weak, but I think …"); a framing clause that names nothing
 * ("You suggested:", "Olumi supplied these estimates.") covers the rest of that message.
 */
const OLUMI_SAID = new RegExp([
  String.raw`\b(?:olumi|you|the\s+(?:ai|assistant|model))\s+(?:(?:just|also|earlier|originally)\s+)?(?:says?|said|suggest(?:s|ed)?|supplied|gave|thinks?|thought|estimate[sd]?|propose[sd]?|recommend(?:s|ed)?|reckon(?:s|ed)?|claim(?:s|ed)?|mention(?:s|ed)?|wrote)\b`,
  String.raw`\baccording\s+to\s+(?:olumi|you|the\s+(?:ai|assistant|model))\b`,
  String.raw`\b(?:olumi['’]s|your|the\s+(?:ai|assistant|model)['’]s)\s+(?:estimate|suggestion|guess|view|reading|proposal|recommendation)s?\b`,
].join('|'), 'i');
const FIRST_PERSON_CLAIM = String.raw`(?:I\s+(?:think|believe|reckon|estimate|expect|would\s+say)|in\s+my\s+view|my\s+(?:own\s+)?(?:estimate|view|reading|guess)\s+is)\b`;
/** The user's own claim after a CONTRAST ("…, but I think …"); a quoted "I think" inside Olumi's words is not one. */
const CONTRAST_THEN_OWN = new RegExp(String.raw`\b(?:but|while|whereas|however|although|though|yet)\b[,\s]+${FIRST_PERSON_CLAIM}`, 'i');
/** A clause that STARTS with the user's own claim ends an "Olumi supplied these:" frame. */
const OWN_AT_START = new RegExp(String.raw`^(?:(?:but|however|still|actually)[,\s]+)?${FIRST_PERSON_CLAIM}`, 'i');
/**
 * ⛔ A message that disowns or withdraws estimates as a whole ("None of these are my estimates.", "I disagree with all these
 * estimates.", "I withdraw all my earlier estimates.") credits NO link: the withhold reaches every target, and it supersedes
 * every earlier statement.
 */
const WITHDRAWS = new RegExp([
  String.raw`\b(?:withdraw|retract|take\s+back|scrap|disregard|ignore)\s+(?:all\s+(?:of\s+)?|every\s+one\s+of\s+)?(?:my|those|these|the)\s+(?:earlier\s+|previous\s+|other\s+)?(?:estimates|figures|numbers|bands|strengths)\b`,
  String.raw`\bI\s+(?:disagree|don['\u2019]?t\s+agree|do\s+not\s+agree)\s+with\s+(?:all|any|both|each)\b`,
].join('|'), 'i');
const DISCLAIMS = new RegExp([
  String.raw`\b(?:none|neither)\s+of\s+(?:these|those|them|the\s+\w+)\s+(?:are|is|were|was)\s+(?:my|mine)\b`,
  String.raw`\b(?:these|those|they)\s+(?:are|were)\s+not\s+my\s+(?:estimates|figures|numbers|bands|views?)\b`,
].join('|'), 'i');
/** "I do not withdraw my estimates." keeps them: a negator before the withdrawing verb cancels it. */
const disowns = (clause: string): boolean => {
  if (DISCLAIMS.test(clause)) return true;
  const m = WITHDRAWS.exec(clause);
  return m !== null && !/\b(?:not|never|no\s+longer)\b|n['\u2019]t\b/i.test(clause.slice(0, m.index + (m[0].match(/^I\s+/i)?.[0].length ?? 0)));
};
/** A band that names the link's own effect just before its source: "a weak effect of Price", "a strong link from Price". */
const LEAD_BAND = /\b(very\s+strong|strong|moderate|weak|slight)\s+(?:effect|influence|impact|link|relationship|connection)\s+(?:of|from)\s+$/i;
/** A word that joins a second statement on ("Price is £49 AND strong MRR growth continues"). */
const JOINING_WORD = /\b(?:and|but|while|whereas|or|although|though|yet)\b/i;
/** Where a phrase stops being about what it started on: a comma, a semicolon, or a joining word. */
const CONJUNCTION = /[,;]|\b(?:and|but|while|whereas|or|although|though|yet)\b/i;
const upToConjunction = (text: string): string => { const m = CONJUNCTION.exec(text); return m === null ? text : text.slice(0, m.index); };
/**
 * The bands written in a SLICE of the user's clause. The whole clause has already passed the question and denial reading;
 * the slice is read behind a neutral subject, so its own first word ("has a weak effect…", "are weak") is never taken for
 * a question-opening auxiliary (`AUXILIARY_FIRST`).
 */
const bandsIn = (text: string): readonly InfluenceBand[] => BANDS.filter(band => bandTheUserWrote(band, `It${text}`));
/** A NEXT clause that names nothing and questions or disputes ("Is that right?", "I disagree") points back at this one. */
const DISPUTES_WHAT_CAME_BEFORE = /^(?:(?:but|hmm|well|honestly)[,\s]+)?(?:(?:is|was)\s+(?:that|this|it)\s+(?:right|true|correct|so|accurate)\b|I\s+(?:disagree|don['’]?t\s+agree|do\s+not\s+agree)\b|I(?:['’]m|\s+am)\s+not\s+(?:sure|convinced)(?:\s+(?:about\s+)?(?:that|this|it)\b|\s*[.!]?$))/i;
/** ⭐ T2A3 (DL, Paul's 64c5eccc): "set human capacity, delegable workload, … effects to strong" sizes every listed source's links. */
const PLURAL_EFFECTS = /\b(?:effects|links|impacts|influences)\b/i;
const LIST_GLUE = /^(?:and|or|the|its|their|our|s)$/i;

/**
 * The bands of the user's LATEST statement about this directed link, or null when they made none. `messages` are the
 * user's verified messages in order (or one text). A clause (or the user's part of it, beside an attribution) states a
 * band for the link when the user asserts it (no question, denial, report of Olumi's claim, or dispute in the next clause)
 * and the band belongs to the link's own phrase:
 *  (i) its two resolved ends are this link's from and to, in that order, and the band sits between them ("Price has a weak
 *      effect on MRR") or right after the target with nothing joined in between ("Price → MRR is strong"); or, in THIS
 *      message only (`current`):
 *  (ii) the selection binds exactly ONE directed link, this one, and the clause names ONE end of it, no other entity and no
 *      plural, with the band in the phrase after that end ("Monthly churn is strong."); or
 *  (iii) "<sources> effects|links|impacts|influences … <band>" / "the effects of <sources> …": the named entities form ONE
 *      list at the plural noun, none is named elsewhere in the clause, and this link LEAVES one of them.
 * Two bands in that phrase say no band. A disowning message credits nothing and supersedes everything before it. Later
 * statements supersede earlier ones ("weak", then "Actually … strong" is strong).
 */
export function latestLinkBands(
  messages: string | readonly string[] | undefined, nodes: readonly Entity[], from: string, to: string,
  current?: { readonly bound: readonly Link[] },
): readonly InfluenceBand[] | null {
  if (from === to) return null;
  const names = (node: Entity, words: string): boolean => factorTheUserNamed(node.label, words,
    { options: [], others: nodes.filter(other => other.id !== node.id).map(other => other.label) });
  const namedIn = (clause: string): readonly Entity[] => nodes.filter(node => names(node, clause));
  // Resolve an entity at its first mention using the existing entity matcher: the index just past that word.
  const firstMention = (clause: string, node: Entity): number => {
    for (const word of clause.matchAll(/[\p{L}\p{N}]+/gu)) {
      const end = word.index! + word[0].length;
      if (names(node, clause.slice(0, end))) return end;
    }
    return Infinity;
  };
  /** (i) The bands the pair's own phrase holds, or null when the clause is not about this directed pair. */
  const pairBands = (clause: string, ends: readonly Entity[]): readonly InfluenceBand[] | null => {
    if (ends.length !== 2 || !ends.some(node => node.id === from) || !ends.some(node => node.id === to)) return null;
    const sourceAt = firstMention(clause, ends.find(node => node.id === from)!);
    const targetAt = firstMention(clause, ends.find(node => node.id === to)!);
    // Reversed statements do not license the proposed direction; ambiguous or passive readings stay Olumi's estimate.
    // Mention order is not causal order in "Price is affected by MRR" or "Price gets its effect from MRR".
    if (sourceAt >= targetAt) return null;
    const between = clause.slice(sourceAt, targetAt);
    if (/\b(?:by|from|due\s+to|because\s+of)\b/i.test(between)) return null;
    // ⛔ T2A3 buddy review: "Price is £49 and MRR growth is strong" names no link strength; a band after the target
    // counts only when nothing joins another statement between the ends or before the band.
    const joined = JOINING_WORD.exec(between);
    // "I estimate a weak effect of Price on MRR": the band names the link's own effect, right before its source.
    const source = ends.find(node => node.id === from)!;
    const sourceStart = [...clause.matchAll(/[\p{L}\p{N}]+/gu)]
      .find(w => wordsOf(source.label).some(x => sameWord(x, w[0].toLowerCase())))?.index ?? 0;
    const lead = LEAD_BAND.exec(clause.slice(0, sourceStart));
    return [...new Set([
      ...bandsIn(joined === null ? between : between.slice(0, joined.index)),
      ...(joined !== null || CONJUNCTION.test(between) ? [] : bandsIn(upToConjunction(clause.slice(targetAt)))),
      ...(lead !== null ? bandsIn(` ${lead[1]}`) : []),
    ])];
  };
  // ⛔ T2A3 (#2993 check, blocking 1; PL 22:07Z): the selection must bind ONE directed link, and the words name an end of it.
  const bound = current?.bound ?? [];
  const boundBands = (clause: string, ends: readonly Entity[]): readonly InfluenceBand[] | null => {
    if (bound.length !== 1 || bound[0]!.from !== from || bound[0]!.to !== to || ends.length !== 1
      || (ends[0]!.id !== from && ends[0]!.id !== to) || PLURAL_EFFECTS.test(clause)) return null;
    return bandsIn(upToConjunction(clause.slice(firstMention(clause, ends[0]!))));
  };
  /** (iii) The phrase after the plural noun when the named entities are its listed sources and this link leaves one. */
  const pluralBands = (clause: string, ends: readonly Entity[]): readonly InfluenceBand[] | null => {
    const noun = PLURAL_EFFECTS.exec(clause);
    if (noun === null || ends.length === 0 || !ends.some(node => node.id === from)) return null;
    const inList = (word: string): boolean => LIST_GLUE.test(word)
      || ends.some(node => wordsOf(node.label).some(w => sameWord(w, word.toLowerCase())));
    const wordsIn = (text: string) => [...text.matchAll(/[\p{L}\p{N}]+/gu)];
    const whole = (list: string, rest: string): boolean => list.trim() !== ''
      && ends.every(node => names(node, list)) && !ends.some(node => names(node, rest));
    const before = clause.slice(0, noun.index);
    const after = clause.slice(noun.index + noun[0].length);
    // "X, Y and Z effects …": the run of end words and glue that ends AT the noun; nothing named outside it ("on W").
    let start = before.length;
    const lead = wordsIn(before);
    for (let k = lead.length - 1; k >= 0 && inList(lead[k]![0]); k -= 1) start = lead[k]!.index!;
    if (whole(before.slice(start), before.slice(0, start) + after)) return bandsIn(upToConjunction(after));
    // "the effects of X and Y …": the run that starts right after "of".
    const of = /^\s+of\b/i.exec(after);
    if (of !== null) {
      const rest = after.slice(of[0].length);
      let end = 0;
      for (const w of wordsIn(rest)) { if (!inList(w[0])) break; end = w.index! + w[0].length; }
      if (whole(rest.slice(0, end), before + rest.slice(end))) return bandsIn(upToConjunction(rest.slice(end)));
    }
    return null;
  };
  let latest: readonly InfluenceBand[] | null = null;
  for (const text of typeof messages === 'string' ? [messages] : messages ?? []) {
    const clauses = clausesOf(text);
    if (clauses.some(disowns)) { latest = []; continue; }
    let framedAsOlumis = false;
    for (const [i, whole] of clauses.entries()) {
      if (OWN_AT_START.test(whole)) framedAsOlumis = false;
      if (framedAsOlumis) continue;
      // The user's parts of the clause: all of it, or beside an attribution, the words before it and a contrasted own claim.
      const said = OLUMI_SAID.exec(whole);
      let parts = [whole];
      if (said !== null) {
        const after = whole.slice(said.index + said[0].length);
        const own = CONTRAST_THEN_OWN.exec(after);
        if (own === null && namedIn(whole).length === 0) framedAsOlumis = true;
        // (5) A contrast still inside Olumi's own quotation is Olumi's: an odd count of quote marks before it.
        const quoted = own !== null && ((after.slice(0, own.index).match(/["\u201C\u201D]/g) ?? []).length % 2 === 1);
        const before = whole.slice(0, said.index);
        // "Price has a weak effect on MRR, according to Olumi." is Olumi's claim; "…, while Olumi says …" sets Olumi's beside it.
        parts = [...(/\b(?:while|whereas|but|although|though|however)\s*$/i.test(before) ? [before] : []),
          ...(own === null || quoted ? [] : [after.slice(own.index)])];
      }
      const next = clauses[i + 1];
      if (next !== undefined && DISPUTES_WHAT_CAME_BEFORE.test(next) && namedIn(next).length === 0) continue;
      for (const part of parts) {
        if (part.trim() === '' || linkEffectQuoteContextMiss(part.trim(), text) !== null) continue;
        const ends = namedIn(part);
        const bands = pairBands(part, ends)
          ?? (current === undefined ? null : boundBands(part, ends) ?? pluralBands(part, ends));
        if (bands === null || bands.length === 0) continue;
        latest = bands.length === 1 ? bands : [];
      }
    }
  }
  return latest;
}

/**
 * ⛔ T2A3's reading for a FIGURE the Agent quotes from the user's message (link effects; served hiring 14 Oct: "Olumi
 * suggested that hiring a Tech lead would raise productivity by about 8%" was recorded as the user's figure). True when the
 * quote is not the user's own claim: the message disowns its estimates; the quote sits inside a report of Olumi's claim
 * (`OLUMI_SAID`, its own clause, unless the user contrasts their own claim after it) or under a frame that names Olumi's
 * claim ("You suggested:"), until a clause opens with the user's own claim; or it is disputed ("I disagree that …", or a
 * next clause "Is that right?" / "I disagree"). The same rules `latestLinkBands` applies to a band.
 */
export function quoteIsNotTheUsersClaim(message: string, quote: string): boolean {
  const text = plainQuote(message), said = plainQuote(quote);
  const at = said === '' ? -1 : text.indexOf(said);
  if (at < 0) return false;
  const clauses = clausesOf(text);
  if (clauses.some(disowns)) return true;
  let from = 0, framed = false;
  for (const [i, clause] of clauses.entries()) {
    const start = text.indexOf(clause, from); from = start + clause.length;
    const whole = clause.trim(), offset = start + clause.indexOf(whole);
    if (OWN_AT_START.test(whole)) framed = false;
    const covers = offset < at + said.length && at < offset + whole.length;
    const report = OLUMI_SAID.exec(whole);
    if (covers) {
      if (framed) return true;
      const inClause = Math.max(0, at - offset);
      // "I disagree that …": a clause that opens with the user's dispute disputes what it holds.
      if (DISPUTES_WHAT_CAME_BEFORE.test(whole)) return true;
      if (report !== null) {
        const after = whole.slice(report.index + report[0].length);
        const own = CONTRAST_THEN_OWN.exec(after);
        const ownFrom = own === null ? Infinity : report.index + report[0].length + own.index;
        const before = whole.slice(0, report.index);
        const userBefore = /\b(?:while|whereas|but|although|though|however)\s*$/i.test(before) && inClause + said.length <= report.index;
        if (!userBefore && inClause < ownFrom) return true;
      }
      const next = clauses[i + 1];
      if (next !== undefined && at + said.length <= offset + whole.length && DISPUTES_WHAT_CAME_BEFORE.test(next.trim())) return true;
    } else if (report !== null && CONTRAST_THEN_OWN.exec(whole.slice(report.index + report[0].length)) === null
      && figuresWrittenIn(whole.slice(report.index + report[0].length)) === 0) {
      framed = true;
    }
  }
  return false;
}

/** Verified conversation evidence for this directed pair, never a band found elsewhere in history. */
export function linkBandTheUserStated(
  band: InfluenceBand, verifiedText: string | readonly string[] | undefined, nodes: readonly Entity[], from: string, to: string,
): boolean {
  return latestLinkBands(verifiedText, nodes, from, to)?.includes(band) ?? false;
}

/** One spelling for a quote and the message it is checked against: typographic quotes plain, runs of space single. */
const plainQuote = (text: string): string => text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[ \t]+/g, ' ').trim();

/**
 * T2A5 check (b), exported for every quote check (HIRING's relation and level checks reuse it): `quote` is a WHOLE statement
 * of `message`, verbatim in one spelling (`plainQuote`). It starts at the message's start or after . ! ? ; or a line, and
 * ends at the message's end or before one. A colon does not end a statement ("Alice says: …" keeps its speaker), so a
 * substring that drops "Alice says …", "Olumi suggested …" or "I disagree" is not whole.
 * ⛔ T1 HOST P07 (pilot 17 Oct): a full stop may be followed by the double quotation mark that closes a person's words
 * ("Sam, site lead: “Crews start early.”"), at either end of a statement. Without it, every quoted speech was refused as
 * "not a whole statement" and its attribution was lost.
 * ⛔ #3363 B1 (BUDDY-A R1–R3; DL-3 16:14Z ruling, fail-safe core): a statement never starts or ends inside someone's quoted words,
 * since none of their sentences is whole without the speaker and the rest of what they said. Only PAIRED double marks (straight,
 * typographic, « ») bound speech: one opens after the start, a space or punctuation and before a non-space; it closes after a
 * non-space and before the end, a space or punctuation. A closing-shaped mark with nothing open is text (a 12" rack). A single
 * mark never bounds anything, being also an apostrophe; but speech it may open (after the start, a space or the attribution's
 * colon, before a letter: never "'27", "don't" or "the users' pilot") cannot be bounded, so nothing from there to the paragraph's
 * end is whole. Those words stay the brief's, unverified, with no speaker asserted.
 */
const ENDS = /[.!?;]["»']*$/;
export function wholeStatementIn(message: string, quote: unknown): boolean {
  const said = typeof quote === 'string' ? plainQuote(quote) : '';
  const text = plainQuote(message);
  return said !== '' && quoteSpansIn(text, said).some((at) =>
    /(?:^|[.!?;\n]["»']*)\s*$/.test(text.slice(0, at)) && (ENDS.test(said) || /^\s*(?:$|[.!?;\n])/.test(text.slice(at + said.length)))
    && !insideSpeech(text, at) && !insideSpeech(text, at + said.length)
    && !insideSingleSpeech(text, at) && !insideSingleSpeech(text, at + said.length));
}
/**
 * The existing paired-speech reader; no attribution or write permission is granted. Authorship reads paired single marks too
 * (`insideSingleSpeech`); the source-review DISPLAY keeps its double-mark reading (`single: false`), so its words are unchanged.
 */
export function speechReading(quote: string, single = true): { readonly text: string; readonly inSpeech: (at: number) => boolean } {
  const text = plainQuote(quote);
  return { text, inSpeech: (at) => insideSpeech(text, at) || (single && insideSingleSpeech(text, at)) };
}

/**
 * ⭐ LEAN CORE, THE ONE AUTHORSHIP RULE's span check (DL-3 18 Oct; `userStated`, user-statements.ts): `quote` occurs literally, as
 * whole words, in `message`, and is the user's own words there: neither end sits inside paired quotation marks (another speaker's
 * words), and no speech a single mark may open precedes its end in its paragraph (#3363's fail-safe, kept). A whole statement
 * (`wholeStatementIn`) is the case where the span is its own sentence. The first such span's index in `plainQuote(message)`, or -1.
 */
export function usersSpanIn(message: string, quote: unknown): number {
  const said = typeof quote === 'string' ? plainQuote(quote) : '';
  const text = plainQuote(message);
  if (said === '') return -1;
  return quoteSpansIn(text, said).find((at) => !insideSpeech(text, at) && !insideSpeech(text, at + said.length)
    && !insideSingleSpeech(text, at) && !insideSingleSpeech(text, at + said.length)) ?? -1;
}

/**
 * ⭐ LEAN CORE: the sentence of `message` that holds the user's span `quote` (`usersSpanIn`), in the one spelling: from the last . ! ? ;
 * or line break before it to the first at or after its end. Undefined when the span is not theirs there.
 */
export function sentenceAroundSpan(message: string, quote: unknown): string | undefined {
  const at = usersSpanIn(message, quote);
  if (at < 0 || typeof quote !== 'string') return undefined;
  const text = plainQuote(message), end = at + plainQuote(quote).length;
  const start = Math.max(...['.', '!', '?', ';', '\n'].map((m) => text.lastIndexOf(m, at - 1))) + 1;
  const stop = text.slice(Math.max(at, end - 1)).search(/[.!?;\n]/u);
  return text.slice(start, stop < 0 ? text.length : Math.max(at, end - 1) + stop + 1).trim();
}

/** ⭐ LEAN CORE: the user's own words `later` (each a later message) withdraw or disown their estimates, so an earlier span is not current. */
export function withdrawnLater(later: readonly string[]): boolean {
  return later.some((m) => clausesOf(plainQuote(m)).some(disowns));
}
/** The text of `at`'s paragraph up to `at`. */
/**
 * ⭐ LEAN CORE (dev P01/P11, DL-3 05:0xZ): a SINGLE mark bounds another speaker's words only when PAIRED in its paragraph, as double
 * marks do. It opens after the start, a space or punctuation (the attribution's colon included) and before a letter; it closes after a
 * non-space and before the end, a space or punctuation, and the LAST such mark in the paragraph closes it, so an apostrophe inside the
 * speech ("don't", "the users' pilot") never ends it early. An unpaired opening mark, an in-word apostrophe or a year ("'27") opens
 * nothing, so the user's whole message stays theirs (was: any opening-shaped single mark made the rest of its paragraph unverifiable).
 */
function insideSingleSpeech(text: string, at: number): boolean {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const endAt = text.indexOf('\n', at);
  const end = endAt < 0 ? text.length : endAt;
  const opens = (i: number): boolean => text[i] === "'" && (i === start || /[\s:([\u2014\u2013-]/u.test(text[i - 1]!)) && /\p{L}/u.test(text[i + 1] ?? '');
  const closes = (i: number): boolean => text[i] === "'" && i > start && /\S/u.test(text[i - 1]!) && (i + 1 === end || /[\s.,;:!?)\]]/u.test(text[i + 1]!));
  for (let o = start; o < end; o += 1) {
    if (!opens(o)) continue;
    let c = -1;
    for (let i = end - 1; i > o; i -= 1) if (closes(i)) { c = i; break; }
    if (c < 0) return false;
    if (o < at && at <= c) return true;
    o = c;
  }
  return false;
}
/** `at` lies inside paired double-marked speech that opened before it in its paragraph. */
function insideSpeech(text: string, at: number): boolean {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  let open: string | null = null;
  for (let i = start; i < at; i += 1) {
    const mark = text[i]!, prev = i === start ? ' ' : text[i - 1]!, next = text[i + 1] ?? '';
    if (open === null && (mark === '"' || mark === '«') && /[\s([:;,\u2014\u2013-]/u.test(prev) && /\S/u.test(next)) open = mark === '«' ? '»' : '"';
    else if (open !== null && mark === open && /\S/u.test(prev) && /^(?:$|[\s.,;:!?)\]])/u.test(next)) open = null;
  }
  return open !== null;
}

/** T2A5 check (c)'s binding, exported: `text` names BOTH ends of the directed link `from` → `to` (one named end never binds). */
export function namesBothEnds(text: string, nodes: readonly Entity[], from: string, to: string): boolean {
  const labelOf = (id: string): string => nodes.find((n) => n.id === id)?.label ?? id;
  return [labelOf(from), labelOf(to)].every((end) =>
    factorTheUserNamed(end, text, { options: [], others: nodes.map((n) => n.label).filter((x) => x !== end) }));
}

/**
 * ⭐ T2A5 (AIE rulings on 6157593360, 14 Oct): whose band a link set's `strength` is. The AI reads the meaning and quotes the
 * user's complete, still-operative statement as `from_words`; the host only VERIFIES it, mechanically:
 * - verbatim in a VERIFIED user message, this one or an earlier one (the latest that holds it);
 * - a whole statement of that message: a substring that drops "Alice says …", "Olumi suggested …" or "I disagree" is not;
 * - bound to THIS directed link by the quote's own words (both ends, or in THIS message "<X> effects" or the one bound
 *   selection), so one named end never binds;
 * - agreed by its whole message's reading (attribution, framing, dispute and disowning still reject it), and not superseded
 *   by a later verified message.
 * `copied`: no verified quote, yet the conversation (verified or not) reads THIS band for THIS link, so the band is copied
 * or unknown material, never Olumi's own new estimate (`statementOrigin` makes it unknown).
 */
export function linkBandSource(quote: unknown, band: InfluenceBand, conversation: {
  readonly messages: readonly string[]; readonly thisMessage?: string; readonly unverified?: string;
}, nodes: readonly Entity[], from: string, to: string, bound: readonly Link[]): { readonly verified: boolean; readonly copied: boolean } {
  const messages = conversation.messages.map(plainQuote);
  const now = conversation.thisMessage === undefined ? -1 : messages.lastIndexOf(plainQuote(conversation.thisMessage));
  const reading = (i: number, text: string) => latestLinkBands(text, nodes, from, to, i === now ? { bound } : undefined);
  // Copying is read more widely than credit: "<X> effects" in an earlier or unverified message also holds the band.
  const copyReading = (i: number, text: string) => latestLinkBands(text, nodes, from, to, { bound: i === now ? bound : [] });
  const namesTheLink = (text: string): boolean => namesBothEnds(text, nodes, from, to);
  const said = typeof quote === 'string' ? plainQuote(quote) : '';
  const whole = (message: string): boolean => wholeStatementIn(message, said);
  let k = -1;
  for (let i = messages.length - 1; i >= 0 && k < 0; i -= 1) if (whole(messages[i]!)) k = i;
  const verified = k >= 0 && (reading(k, said)?.includes(band) ?? false) && (reading(k, messages[k]!)?.includes(band) ?? false)
    // A later verified message that names this link without affirming THIS band (another band, a denial, a withdrawal)
    // supersedes the quote.
    && messages.slice(k + 1).every((m, j) => { const later = reading(k + 1 + j, m); return later === null ? !namesTheLink(m) : later.includes(band); });
  // ANY verified message holding this band for this link, superseded or not (conflicting origin stays unknown, AIE), or
  // unverified words holding it: copied or unknown material, never Olumi's own new estimate.
  const copied = !verified && (messages.some((m, i) => copyReading(i, m)?.includes(band) ?? false)
    || (latestLinkBands(conversation.unverified, nodes, from, to, { bound: [] })?.includes(band) ?? false));
  return { verified, copied };
}
