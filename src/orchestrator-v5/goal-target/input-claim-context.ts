import { bandTheUserWrote, clausesOf, factorTheUserNamed, linkEffectQuoteContextMiss, sameWord, wordsOf } from '../agent-lane/stated-by-user.js';
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
const FIRST_PERSON_CLAIM = /\b(?:I\s+(?:think|believe|reckon|estimate|expect|would\s+say)|in\s+my\s+view|my\s+(?:own\s+)?(?:estimate|view|reading|guess)\s+is)\b/i;
/** A NEXT clause that names nothing and questions or disputes ("Is that right?", "I disagree") points back at this one. */
const DISPUTES_WHAT_CAME_BEFORE = /^(?:(?:but|hmm|well|honestly)[,\s]+)?(?:(?:is|was)\s+(?:that|this|it)\s+(?:right|true|correct|so|accurate)\b|I\s+(?:disagree|don['’]?t\s+agree|do\s+not\s+agree)\b|I(?:['’]m|\s+am)\s+not\s+(?:sure|convinced)(?:\s+(?:about\s+)?(?:that|this|it)\b|\s*[.!]?$))/i;
/** ⭐ T2A3 (DL, Paul's 64c5eccc): "set human capacity, delegable workload, … effects to strong" sizes every listed source's links. */
const PLURAL_EFFECTS = /\b(?:effects|links|impacts|influences)\b/i;
const LIST_GLUE = /^(?:and|or|the|its|their|our|s)$/i;

/**
 * The bands of the user's LATEST statement about this directed link, or null when they made none. `messages` are the
 * user's verified messages in order (or one text). A clause states a band for the link when the user asserts it (no
 * question, denial, report of Olumi's claim, or dispute in the next clause), it holds ONE band word (two, as in
 * "… weak effect on MRR, and our evidence is strong", say no band: nothing is credited), and:
 *  (i) its two resolved ends are this link's from and to, in that order; or, in THIS message only (`current`):
 *  (ii) the selection binds exactly ONE directed link, this one, and the clause names ONE end of it and no other entity
 *       (both ends named is (i) only, so a selection never licenses the reversed reading); or
 *  (iii) "<sources> effects|links|impacts|influences" / "the effects of <sources>": the named entities form ONE list at
 *       the plural noun, none is named elsewhere in the clause, and this link LEAVES one of them.
 * Later statements supersede earlier ones ("weak", then "Actually … strong" is strong).
 */
export function latestLinkBands(
  messages: string | readonly string[] | undefined, nodes: readonly Entity[], from: string, to: string,
  current?: { readonly bound: readonly Link[] },
): readonly InfluenceBand[] | null {
  if (from === to) return null;
  const names = (node: Entity, words: string): boolean => factorTheUserNamed(node.label, words,
    { options: [], others: nodes.filter(other => other.id !== node.id).map(other => other.label) });
  const namedIn = (clause: string): readonly Entity[] => nodes.filter(node => names(node, clause));
  const statesPair = (clause: string, ends: readonly Entity[]): boolean => {
    if (ends.length !== 2 || !ends.some(node => node.id === from) || !ends.some(node => node.id === to)) return false;
    // Resolve each end at its first mention using the existing entity matcher. Reversed statements do not
    // license the proposed direction; ambiguous or passive readings can stay Olumi's estimate.
    const firstMention = (node: Entity): number => {
      for (const word of clause.matchAll(/[\p{L}\p{N}]+/gu)) {
        const end = word.index! + word[0].length;
        if (names(node, clause.slice(0, end))) return end;
      }
      return Infinity;
    };
    const sourceAt = firstMention(ends.find(node => node.id === from)!);
    const targetAt = firstMention(ends.find(node => node.id === to)!);
    if (sourceAt >= targetAt) return false;
    // Mention order is not causal order in "Price is affected by MRR" or "Price gets its effect from MRR".
    // Without an affirmative reading of this direction, keep the staging estimate fallback.
    return !/\b(?:by|from|due\s+to|because\s+of)\b/i.test(clause.slice(sourceAt, targetAt));
  };
  // ⛔ T2A3 (#2993 check, blocking 1; PL 22:07Z): the selection must bind ONE directed link, and the words name an end of it.
  const bound = current?.bound ?? [];
  const namesBoundLink = (ends: readonly Entity[]): boolean => bound.length === 1 && bound[0]!.from === from
    && bound[0]!.to === to && ends.length === 1 && (ends[0]!.id === from || ends[0]!.id === to);
  const listedSources = (clause: string, ends: readonly Entity[]): readonly Entity[] => {
    const noun = PLURAL_EFFECTS.exec(clause);
    if (noun === null || ends.length === 0) return [];
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
    if (whole(before.slice(start), before.slice(0, start) + after)) return ends;
    // "the effects of X and Y …": the run that starts right after "of".
    const of = /^\s+of\b/i.exec(after);
    if (of !== null) {
      const rest = after.slice(of[0].length);
      let end = 0;
      for (const w of wordsIn(rest)) { if (!inList(w[0])) break; end = w.index! + w[0].length; }
      if (whole(rest.slice(0, end), before + rest.slice(end))) return ends;
    }
    return [];
  };
  let latest: readonly InfluenceBand[] | null = null;
  for (const text of typeof messages === 'string' ? [messages] : messages ?? []) {
    const clauses = clausesOf(text);
    let framedAsOlumis = false;
    for (const [i, whole] of clauses.entries()) {
      let clause = whole;
      const said = OLUMI_SAID.exec(whole);
      if (said !== null) {
        const after = whole.slice(said.index + said[0].length);
        const own = FIRST_PERSON_CLAIM.exec(after);
        if (own === null) { framedAsOlumis ||= namedIn(whole).length === 0; continue; }
        clause = after.slice(own.index);
      }
      const next = clauses[i + 1];
      if (framedAsOlumis || linkEffectQuoteContextMiss(clause, text) !== null
        || (next !== undefined && DISPUTES_WHAT_CAME_BEFORE.test(next) && namedIn(next).length === 0)) continue;
      const bands = BANDS.filter(band => bandTheUserWrote(band, clause));
      if (bands.length === 0) continue;
      const ends = namedIn(clause);
      const aboutThisLink = statesPair(clause, ends) || (current !== undefined
        && (namesBoundLink(ends) || listedSources(clause, ends).some(node => node.id === from)));
      if (aboutThisLink) latest = bands.length === 1 ? bands : [];
    }
  }
  return latest;
}

/** Verified conversation evidence for this directed pair, never a band found elsewhere in history. */
export function linkBandTheUserStated(
  band: InfluenceBand, verifiedText: string | readonly string[] | undefined, nodes: readonly Entity[], from: string, to: string,
): boolean {
  return latestLinkBands(verifiedText, nodes, from, to)?.includes(band) ?? false;
}
