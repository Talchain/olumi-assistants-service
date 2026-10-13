import { bandTheUserWrote, clausesOf, factorTheUserNamed, linkEffectQuoteContextMiss } from '../agent-lane/stated-by-user.js';
import type { InfluenceBand } from '../format/influence-bands.js';

type Entity = { readonly id: string; readonly label: string };
type Link = { readonly from: string; readonly to: string };
const BANDS: readonly InfluenceBand[] = ['weak', 'moderate', 'strong', 'very strong'];

/**
 * ⛔ T2A3 (#2993 check, blocking 2): the user REPORTING Olumi's claim is not stating it. "Olumi says Price has a weak
 * effect on MRR. Is that right?" and "You suggested …; I disagree" were credited as the user's band. Read over the
 * clause and the earlier clauses of its sentence, so "You suggested: …" covers what follows the colon.
 */
const OLUMI_SAID = new RegExp([
  String.raw`\b(?:olumi|you|the\s+(?:ai|assistant|model))\s+(?:(?:just|also|earlier|originally)\s+)?(?:says?|said|suggest(?:s|ed)?|thinks?|thought|estimate[sd]?|propose[sd]?|recommend(?:s|ed)?|reckon(?:s|ed)?|claim(?:s|ed)?|mention(?:s|ed)?|wrote)\b`,
  String.raw`\baccording\s+to\s+(?:olumi|you|the\s+(?:ai|assistant|model))\b`,
  String.raw`\b(?:olumi['’]s|your|the\s+(?:ai|assistant|model)['’]s)\s+(?:estimate|suggestion|guess|view|reading|proposal|recommendation)s?\b`,
].join('|'), 'i');
/** The NEXT clause questions or disputes this one ("Is that right?", "I disagree"): it was quoted, not stated. */
const DISPUTES_WHAT_CAME_BEFORE = /^(?:(?:but|hmm|well|honestly)[,\s]+)?(?:(?:is|was)\s+(?:that|this|it)\s+(?:right|true|correct|so|accurate)\b|I\s+(?:disagree|don['’]?t\s+agree|do\s+not\s+agree)\b|I(?:['’]m|\s+am)\s+not\s+(?:sure|convinced)(?:\s+(?:about\s+)?(?:that|this|it)\b|\s*[.!]?$))/i;

/** Each clause with the earlier clauses of its sentence (".", "!", "?" and line breaks end one; ";" and ":" do not). */
function clausesWithSentence(text: string): { readonly clause: string; readonly sentence: string }[] {
  const out: { clause: string; sentence: string }[] = [];
  let sentence = '';
  for (const clause of clausesOf(text)) {
    sentence = sentence === '' ? clause : `${sentence} ${clause}`;
    out.push({ clause, sentence });
    if (!/[;:]$/.test(clause)) sentence = '';
  }
  return out;
}

/**
 * The bands of the user's LATEST statement about this directed link, or null when they made none. A clause states a
 * band for it when the user asserts it (no question, denial, report of Olumi's claim, or dispute in the next clause)
 * and EITHER its two resolved ends are this link's from and to, in that order, OR (`bound`, the links this request's
 * selection binds) it names an end of this bound link, no other entity, and no other bound link fits those names.
 * Later statements supersede earlier ones ("weak", then "Actually … strong" is strong).
 */
export function latestLinkBands(
  text: string | undefined, nodes: readonly Entity[], from: string, to: string, bound: readonly Link[] = [],
): readonly InfluenceBand[] | null {
  if (!text || from === to) return null;
  const names = (node: Entity, words: string): boolean => factorTheUserNamed(node.label, words,
    { options: [], others: nodes.filter(other => other.id !== node.id).map(other => other.label) });
  const statesPair = (clause: string): boolean => {
    const ends = nodes.filter(node => names(node, clause));
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
  const namesBoundLink = (clause: string): boolean => {
    if (!bound.some(link => link.from === from && link.to === to)) return false;
    const named = nodes.filter(node => names(node, clause)).map(node => node.id);
    const fits = (link: Link): boolean => named.every(id => id === link.from || id === link.to);
    return named.length > 0 && fits({ from, to })
      && !bound.some(link => !(link.from === from && link.to === to) && fits(link));
  };
  const clauses = clausesWithSentence(text);
  let latest: readonly InfluenceBand[] | null = null;
  for (const [i, { clause, sentence }] of clauses.entries()) {
    const bands = BANDS.filter(band => bandTheUserWrote(band, clause));
    if (bands.length === 0 || linkEffectQuoteContextMiss(clause, text) !== null || OLUMI_SAID.test(sentence)
      || DISPUTES_WHAT_CAME_BEFORE.test(clauses[i + 1]?.clause ?? '')) continue;
    if (statesPair(clause) || namesBoundLink(clause)) latest = bands;
  }
  return latest;
}

/** Verified conversation evidence for this directed pair, never a band found elsewhere in history. */
export function linkBandTheUserStated(
  band: InfluenceBand, verifiedText: string | undefined, nodes: readonly Entity[], from: string, to: string,
): boolean {
  return latestLinkBands(verifiedText, nodes, from, to)?.includes(band) ?? false;
}
