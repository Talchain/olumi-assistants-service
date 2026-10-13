import { bandTheUserWrote, clausesOf, factorTheUserNamed, linkEffectQuoteContextMiss } from '../agent-lane/stated-by-user.js';
import type { InfluenceBand } from '../format/influence-bands.js';

type Entity = { readonly id: string; readonly label: string };
type Link = { readonly from: string; readonly to: string };
const BANDS: readonly InfluenceBand[] = ['weak', 'moderate', 'strong', 'very strong'];

/**
 * ⛔ T2A3 (#2993 check, blocking 2): the user REPORTING Olumi's claim is not stating it. "Olumi says Price has a weak
 * effect on MRR. Is that right?" and "You suggested …; I disagree" were credited as the user's band. The attribution
 * covers its own clause; a framing clause that names nothing ("You suggested:", "Olumi supplied these estimates.")
 * covers the rest of that message. A clause attributing something else ("Olumi says Quality is weak;") never
 * reaches the user's own next clause.
 */
const OLUMI_SAID = new RegExp([
  String.raw`\b(?:olumi|you|the\s+(?:ai|assistant|model))\s+(?:(?:just|also|earlier|originally)\s+)?(?:says?|said|suggest(?:s|ed)?|supplied|gave|thinks?|thought|estimate[sd]?|propose[sd]?|recommend(?:s|ed)?|reckon(?:s|ed)?|claim(?:s|ed)?|mention(?:s|ed)?|wrote)\b`,
  String.raw`\baccording\s+to\s+(?:olumi|you|the\s+(?:ai|assistant|model))\b`,
  String.raw`\b(?:olumi['’]s|your|the\s+(?:ai|assistant|model)['’]s)\s+(?:estimate|suggestion|guess|view|reading|proposal|recommendation)s?\b`,
].join('|'), 'i');
/** A NEXT clause that names nothing and questions or disputes ("Is that right?", "I disagree") points back at this one. */
const DISPUTES_WHAT_CAME_BEFORE = /^(?:(?:but|hmm|well|honestly)[,\s]+)?(?:(?:is|was)\s+(?:that|this|it)\s+(?:right|true|correct|so|accurate)\b|I\s+(?:disagree|don['’]?t\s+agree|do\s+not\s+agree)\b|I(?:['’]m|\s+am)\s+not\s+(?:sure|convinced)(?:\s+(?:about\s+)?(?:that|this|it)\b|\s*[.!]?$))/i;

/**
 * The bands of the user's LATEST statement about this directed link, or null when they made none. `messages` are the
 * user's verified messages in order (or one text). A clause states a band for the link when the user asserts it (no
 * question, denial, report of Olumi's claim, or dispute in the next clause), it holds ONE band word (two, as in
 * "… weak effect on MRR, and our evidence is strong", say no band: nothing is credited), and EITHER its two resolved
 * ends are this link's from and to, in that order, OR (`bound`, the links this request's selection binds) it names ONE
 * end of this bound link, no other entity, and no other bound link has that end. Naming both ends is (i) only, so a
 * selection never licenses the reversed reading. Later statements supersede earlier ones ("weak", then "Actually …
 * strong" is strong).
 */
export function latestLinkBands(
  messages: string | readonly string[] | undefined, nodes: readonly Entity[], from: string, to: string,
  bound: readonly Link[] = [],
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
  // ⛔ T2A3 (#2993 check, blocking 1): the selection binds WHICH link; the user's words must still name an end of it.
  const namesBoundLink = (ends: readonly Entity[]): boolean => {
    if (ends.length !== 1 || !bound.some(link => link.from === from && link.to === to)) return false;
    const end = ends[0]!.id;
    return (end === from || end === to)
      && !bound.some(link => !(link.from === from && link.to === to) && (link.from === end || link.to === end));
  };
  let latest: readonly InfluenceBand[] | null = null;
  for (const text of typeof messages === 'string' ? [messages] : messages ?? []) {
    const clauses = clausesOf(text);
    let framedAsOlumis = false;
    for (const [i, clause] of clauses.entries()) {
      const ends = namedIn(clause);
      if (OLUMI_SAID.test(clause)) { framedAsOlumis ||= ends.length === 0; continue; }
      const next = clauses[i + 1];
      if (framedAsOlumis || linkEffectQuoteContextMiss(clause, text) !== null
        || (next !== undefined && DISPUTES_WHAT_CAME_BEFORE.test(next) && namedIn(next).length === 0)) continue;
      const bands = BANDS.filter(band => bandTheUserWrote(band, clause));
      if (bands.length === 0 || !(statesPair(clause, ends) || namesBoundLink(ends))) continue;
      latest = bands.length === 1 ? bands : [];
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
