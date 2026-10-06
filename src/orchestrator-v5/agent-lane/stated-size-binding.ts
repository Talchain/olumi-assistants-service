import { nonEffectQuantitySpans } from '../../cee/factor-extraction/goal-label-target.js';
import { statedEffectQuoteMatches, statedSwitchEffectQuoteMatches, type StatedEffectDetail } from '../../cee/provenance/stated-effect.js';
import { moneyUnitScale, sameWord, sentenceNamesOtherQuantity } from './stated-by-user.js';
import { sameUnit } from './same-unit.js';
import { unitPhraseFamily } from './unit-conflict.js';
import { extractStatedLikelyRange } from '../../cee/context-integrity/not-modelled-manifest.js';
import type { StatedRangeEnd } from '../../cee/magnitude/link-effect.js';

export interface StatedSizeBindingLink {
  readonly from: string;
  readonly to: string;
  readonly effect_direction?: string;
  readonly natural_effect?: StatedEffectDetail | null;
}
export interface StatedSizeBindingNode {
  readonly id: string;
  readonly unit?: unknown;
  readonly effect_unit?: string;
  readonly change_unit?: string;
  readonly label?: string;
  readonly kind?: string;
  readonly goal_threshold_raw?: number;
  readonly goal_threshold_unit?: string;
}

/**
 * ⭐ A STATED SIZE THROUGH OLUMI'S PASS-THROUGH (Science d5 #87 6008551439 (B) + 6008581742; MC G1b ceiling on Acceptance's
 * 14 served T1b drafts, CEE 231affbe). "Each lost customer removes £300 a month of monthly recurring revenue" sizes ‘Customers
 * lost’ → ‘MRR lost to churn’ → ‘monthly recurring revenue’: the drafter put Olumi's mediator between the user's two
 * quantities, so the direct bind refused it (the sentence names the goal, another quantity) and the £300 was credited by a
 * door with no sentence binding. The sentence names the SOURCE and the quantity Q the mediator passes into, so it is bound
 * to the source's link WITH its quote, and the mediator's ONE onward link is the definition: ±1 per 1, its typed sign.
 * Only when every direct condition holds except the name, and:
 *  · the only other quantity the sentence names is Q, the mediator's one causal link onward, which carries no size of its own;
 *  · the stated amount is in Q's own unit (`sameUnit`), so a unit of the mediator is a unit of Q;
 *  · the onward link's direction is TYPED (positive/negative): the sign is never inferred from a unit (Science (B)).
 */
export interface PassThroughBinding {
  /** The source's link the sentence sizes (index into `links`), bound WITH the sentence. */
  readonly link: number;
  /** The mediator's one onward link (index into `links`), typed as the definition ±1 per 1. */
  readonly onward: number;
  readonly sign: 1 | -1;
  readonly sentence: string;
}

/**
 * Science Fi (5 Oct 2026): validate typed sizes, never extract or change a value.
 * All links participate in W3, including those the existing label door credits.
 * A sentence matching two links, or a link matching two sentences, credits none.
 * Returns the exact sentence by link index, so admission can carry its receipt.
 */
export function bindStatedLinkSizes(
  links: readonly StatedSizeBindingLink[],
  nodes: readonly StatedSizeBindingNode[],
  brief: string | undefined,
  claimedLevelSpans: readonly { start: number; end: number }[] = [],
  extras: {
    /** Filled with every bind made THROUGH a pass-through (above); each such link is also in the returned map. */
    readonly passThroughs?: PassThroughBinding[];
    /** The labels of the options that SET each node, by id: a switch is also named by its setting option's words. */
    readonly settersOf?: ReadonlyMap<string, readonly string[]>;
    /** Filled with the range the bound sentence writes AROUND its figure (`centreRangeAt`), by link index. */
    readonly centreRanges?: Map<number, StatedRangeEnd>;
    /**
     * Filled with every pass-through refused on its sign (`signTheSentenceSays`): `said` is the way the sentence moves Q,
     * or null when it says no way Olumi can read (then the path is NOT said to run the other way: that would be false).
     */
    readonly signRefused?: { readonly through: PassThroughBinding; readonly said: 1 | -1 | null }[];
    /** Filled with every DIRECT bind refused because its drawn sign is the other way from the sentence (`directSignTheSentenceSays`). */
    readonly directSignRefused?: { readonly link: number; readonly sentence: string }[];
  } = {},
): Map<number, string> {
  const { passThroughs, settersOf = new Map<string, readonly string[]>(), centreRanges, signRefused, directSignRefused } = extras;
  const sentences = (brief ?? '').split(/(?<=[.!?])\s+|\n/u).map(s => s.trim()).filter(Boolean);
  const excluded = [...claimedLevelSpans, ...nonEffectQuantitySpans(brief ?? '', nodes.flatMap(n => n.label === undefined ? [] : [n.label]),
    nodes.flatMap(n => n.kind === 'goal' && typeof n.goal_threshold_raw === 'number' && typeof n.goal_threshold_unit === 'string'
      ? [{ label: n.label ?? '', value: n.goal_threshold_raw, unit: n.goal_threshold_unit }] : []))];
  let searchedFrom = 0;
  const offsets = sentences.map(sentence => {
    const at = (brief ?? '').indexOf(sentence, searchedFrom);
    searchedFrom = at + sentence.length;
    return at;
  });
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  type Spans = { amount: { start: number; end: number }; per: { start: number; end: number } };
  const pairs: { link: number; sentence: number; spans: Spans }[] = [];
  links.forEach((l, link) => {
    const d = l.natural_effect;
    if (d == null) return;
    // A switch's effect is never written per a source figure (Science 6008844683): its target figure alone, for a
    // source TYPED binary that the sentence names, and a target the sentence names too.
    // Typed binary by the SIZER (`sourceUnitWords`: a frame of 1 and every level 0 or 1), never by a word: a continuous
    // source is never said per 'switch', so it never binds as one (Science 6008844683 (a)).
    const isSwitch = d.per_source_change_unit === 'switch';
    sentences.forEach((sentence, index) => {
      let spans: Spans | undefined;
      if (statedEffectQuoteMatches(sentence, d, located => { spans = located; })
        || (isSwitch && statedSwitchEffectQuoteMatches(sentence, d, located => { spans = located; }) && namesSwitchAndTarget(l, sentence))) {
        pairs.push({ link, sentence: index, spans: spans! });
      }
    });
  });
  const byLink = new Map<number, number>();
  const bySentence = new Map<number, number>();
  for (const p of pairs) {
    byLink.set(p.link, (byLink.get(p.link) ?? 0) + 1);
    bySentence.set(p.sentence, (bySentence.get(p.sentence) ?? 0) + 1);
  }
  return new Map(pairs.filter(p => {
    if (byLink.get(p.link) !== 1 || bySentence.get(p.sentence) !== 1) return false;
    const l = links[p.link]!;
    const spans = p.spans;
    if ([spans.amount, spans.per].some(span => excluded.some(e =>
      span.start + offsets[p.sentence]! < e.end && span.end + offsets[p.sentence]! > e.start))) return false;
    const d = l.natural_effect!;
    if (!sameUnit(d.amount_unit, nodeById.get(l.to)?.effect_unit ?? nodeById.get(l.to)?.unit)
      || (d.per_source_change_unit !== 'switch' && !sameUnit(d.per_source_change_unit, nodeById.get(l.from)?.change_unit ?? nodeById.get(l.from)?.unit))) return false;
    const target = [nodeById.get(l.from)?.label, nodeById.get(l.to)?.label].filter((s): s is string => typeof s === 'string');
    const others = nodes.filter(n => n.id !== l.from && n.id !== l.to && n.kind !== 'option' && n.kind !== 'decision')
      .flatMap(n => typeof n.label === 'string' ? [n.label] : []);
    let through: PassThroughBinding | undefined;
    if (sentenceNamesOtherQuantity(sentences[p.sentence]!, d.amount_unit, { target, others })) {
      through = passThroughOf(p.link, sentences[p.sentence]!);
      if (through === undefined) return false;
    }
    const sign = Math.sign(d.amount * d.per_source_change);
    if ((l.effect_direction !== 'positive' || sign !== 1) && (l.effect_direction !== 'negative' || sign !== -1)) return false;
    if (d.amount < 0 && d.per_source_change < 0) return false;
    // SIGN-1 S2: a counting determiner cannot attest a negative source change.
    if (d.per_source_change < 0 && /\b(?:each|every|per)\s+[A-Za-z0-9]/iu.test(sentences[p.sentence]!)) return false;
    // ⛔ A direct bind carries the user's quote, so its drawn sign must not be the other way from the sentence (DL #2644 pilot).
    // Against the TARGET's change for the stated source change (its signed amount), never the coefficient (Codex r1 F5).
    const saysOnTarget = through === undefined ? directSignTheSentenceSays(sentences[p.sentence]!, nodeById.get(l.to)?.label) : null;
    if (saysOnTarget !== null && saysOnTarget !== Math.sign(d.amount)) {
      directSignRefused?.push({ link: p.link, sentence: sentences[p.sentence]! });
      return false;
    }
    if (through !== undefined) {
      // One definition per onward link: a second source binding through the same mediator must type it the same way.
      const typed = passThroughs?.find(t => t.onward === through!.onward);
      if (typed !== undefined && typed.sign !== through.sign) return false;
      passThroughs?.push(through);
    }
    const centre = centreRangeAt(sentences[p.sentence]!, spans.amount, d.amount, d.amount_unit);
    if (centre !== undefined) centreRanges?.set(p.link, centre);
    return true;
  }).map(p => [p.link, sentences[p.sentence]! as string]));

  function passThroughOf(link: number, sentence: string): PassThroughBinding | undefined {
    const l = links[link]!;
    const d = l.natural_effect!;
    const causal = (id: string): boolean => { const k = nodeById.get(id)?.kind; return k !== 'option' && k !== 'decision'; };
    const onward = links.flatMap((x, i) => (x.from === l.to && x.to !== l.from && causal(x.to) ? [i] : []));
    if (onward.length !== 1) return undefined;
    const o = links[onward[0]!]!;
    if (o.natural_effect != null || (o.effect_direction !== 'positive' && o.effect_direction !== 'negative')) return undefined;
    const q = nodeById.get(o.to);
    if (q === undefined || !sameUnit(d.amount_unit, q.effect_unit ?? q.unit)) return undefined;
    // The ONLY other quantity named is Q: with Q among the sentence's own quantities, nothing else is named.
    const target = [nodeById.get(l.from)?.label, nodeById.get(l.to)?.label, q.label].filter((s): s is string => typeof s === 'string');
    const others = nodes.filter(n => n.id !== l.from && n.id !== l.to && n.id !== o.to && n.kind !== 'option' && n.kind !== 'decision')
      .flatMap(n => typeof n.label === 'string' ? [n.label] : []);
    if (sentenceNamesOtherQuantity(sentence, d.amount_unit, { target, others })) return undefined;
    const through: PassThroughBinding = { link, onward: onward[0]!, sign: o.effect_direction === 'negative' ? -1 : 1, sentence };
    // ⛔ The PATH carries the user's figure, so its sign is the sentence's (Desk 6b #2644 Q3): the source link's sign × the
    // onward link's must be the way the sentence says the figure moves Q. Read neither way, or the other way: refused.
    // The verb says how Q moves for the source change the sentence states: the target's own change (its amount, signed),
    // never the coefficient, so "a £1 price REDUCTION increases …" reads + (Codex buddy r1 F5).
    const said = signTheSentenceSays(sentence);
    if (said !== Math.sign(d.amount) * through.sign) {
      signRefused?.push({ through, said });
      return undefined;
    }
    return through;
  }

  /**
   * (c) "Names the source": a word of its label that is not a switch word, a filler, or a word of the target ("starter
   * tier" in "the starter tier would win…"), or every such word of an option that sets it. The target is named whole.
   */
  function namesSwitchAndTarget(l: StatedSizeBindingLink, sentence: string): boolean {
    const said = tokens(sentence);
    const targetLabel = nodeById.get(l.to)?.label;
    if (typeof targetLabel !== 'string' || !sentenceNamesOtherQuantity(sentence, undefined, { target: [], others: [targetLabel] })) return false;
    const targetWords = tokens(targetLabel);
    const decisive = (label: string): string[] => tokens(label).filter(w => !SWITCH_WORDS.has(w) && !targetWords.some(t => sameWord(t, w)));
    const has = (w: string): boolean => said.some(s => s === w || sameWord(s, w));
    const own = decisive(nodeById.get(l.from)?.label ?? '');
    if (own.some(has)) return true;
    return (settersOf.get(l.from) ?? []).some(option => { const words = decisive(option); return words.length > 0 && words.every(has); });
  }
}

/** Science 6008844683 (c): the words that only say a switch is on. */
const SWITCH_WORDS = new Set(['availability', 'available', 'launched', 'launch', 'launches', 'release', 'released', 'introduced', 'introduce', 'enabled', 'enable']);
const FILLER = new Set(['the', 'and', 'of', 'to', 'for', 'in', 'on', 'with', 'at', 'by', 'per', 'a', 'an']);
/** Words of two letters or more ("AI"), lower-cased, fillers dropped. */
const tokens = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2 && !FILLER.has(w));

/**
 * ⭐ THE RANGE THE USER WROTE AROUND THEIR FIGURE (Science d5 #87 6009282279; a8's shape ruling). "Each 1% price rise
 * loses about 2 customers, between 1 and 4" and "the starter tier would win about 150 new subscribers, between 80 and
 * 250" write the size as a point INSIDE a range: `{ low, high, text, end: 'centre' }`, the amount kept as the stated point.
 * Read only from the sentence that bound the link, at the bound amount:
 *  · the sentence's ONE "between a and b", written AFTER the amount, with no other figure between the two;
 *  · low < |amount| < high, strictly: an amount that IS an end is A4's (`writtenRangeFor`), never a centre;
 *  · both ends bare, or in pounds when the amount is money (read in the amount's own scale), and no other kind of unit
 *    written after the range ("between 1 and 4 months" is a time);
 * Nothing else writes a spread: no range written, none carried (never a default ±k around the point).
 */
export function centreRangeAt(sentence: string, amountSpan: { readonly end: number }, amount: number, amountUnit: string): StatedRangeEnd | undefined {
  if ((sentence.match(/\bbetween\b/giu) ?? []).length !== 1) return undefined;
  const tail = sentence.slice(amountSpan.end);
  const range = extractStatedLikelyRange(tail);
  if (range === undefined) return undefined;
  const at = tail.indexOf(range.text);
  if (at < 0 || /\d/u.test(tail.slice(0, at))) return undefined;
  // A range in ANOTHER kind of unit is not the size's ("between 1 and 4 months after launch": a time, never a count of
  // customers; Codex buddy r1 F3): the word after its high end must not name a different family.
  const after = tail.slice(at + range.text.length).match(/^\s*([A-Za-z%]+)/u)?.[1];
  const afterFamily = after === undefined ? null : unitPhraseFamily(after);
  if (afterFamily !== null && afterFamily !== unitPhraseFamily(amountUnit)) return undefined;
  const pounds = range.text.includes('£');
  if (pounds && unitPhraseFamily(amountUnit) !== 'currency') return undefined;
  const scale = pounds ? moneyUnitScale(amountUnit) : 1;
  const low = range.low / scale;
  const high = range.high / scale;
  const point = Math.abs(amount);
  if (!(low < point && point < high)) return undefined;
  return { low, high, text: range.text, end: 'centre' };
}

/**
 * ⛔ WHICH WAY A PASS-THROUGH SENTENCE SAYS ITS FIGURE MOVES THE QUANTITY IT NAMES (Desk 6b #2644 Q3): "removes £300 a month
 * of monthly recurring revenue" takes it away (−1); "adds £49 a month to monthly recurring revenue" adds it (+1). A verb in
 * the present ("removes") or after "would"/"will" ("would raise"), never a noun ("a 1% price rise", "each 1 percentage
 * point increase in …"). Denied ("does not remove"), both ways, or neither: null, and the pass-through is refused.
 *
 * The lexicon is MEASURED, not authored (Desk 6b): the served effect sentences of Acceptance successor-20261005
 * (@dd1d8d3f) and red team github-87 (@0b005aee), 36 sentences, weighted by how often each was served: adds 55, loses 21,
 * removes 21, increases 10, raises 2 + "would raise" 2, reduces 2, lowers 1, cuts 1, and T1b's "would win" (21 drafts).
 * "costs" (25) is served BOTH ways — "costs about £6 a month in support" raises a support cost, "costs us about 1
 * percentage point of gross margin" lowers the margin — so it says no way at all: unread, refused, never guessed.
 */
const SAYS_ADDS = /\b(?:adds|increases|raises|wins|(?:would|will)\s+(?:add|increase|raise|win))\b/iu;
const SAYS_REMOVES = /\b(?:removes|loses|reduces|lowers|cuts|(?:would|will)\s+(?:remove|lose|reduce|lower|cut))\b/iu;
const SAYS_NOT = /\b(?:not|never|no\s+longer|\w+n['\u2019]t|doesnt|dont|wont|wouldnt|cannot)\b/iu;
export function signTheSentenceSays(sentence: string): 1 | -1 | null {
  if (SAYS_NOT.test(sentence)) return null;
  const adds = SAYS_ADDS.test(sentence);
  const removes = SAYS_REMOVES.test(sentence);
  return adds === removes ? null : adds ? 1 : -1;
}

/**
 * ⛔ WHICH WAY A DIRECTLY BOUND SENTENCE MOVES THE LINK'S TARGET (DL #2644 hold + (A) pilot, ablated). Served draft 7 bound
 * "Each 1% price rise loses about 2 customers, between 1 and 4" WITH the user's quote as −2 into ‘Customers lost from price
 * rise’: under the user's name, a price rise LOWERED the customers lost, and Raise read 82% (sign corrected: 45.7%). Drafts
 * 8–13 drew the same sentence +2 into a target that counts the loss (‘… lost’, ‘… losses’). So:
 *  · "loses N X" into a target that names a loss (lost / loss / losses) counts what is lost: +1;
 *  · any other loss-named target says no way here (null): "reduces customers lost" and "removes £300" into ‘MRR lost’
 *    read differently, and a guess would be the defect this guards;
 *  · otherwise the sentence's own verb (`signTheSentenceSays`, the measured lexicon); unread (null) keeps today's bind.
 * A readable sign the drawn link contradicts is refused and said.
 */
const NAMES_A_LOSS = /\b(?:lost|loss|losses)\b/iu;
export function directSignTheSentenceSays(sentence: string, targetLabel: string | undefined): 1 | -1 | null {
  if (typeof targetLabel === 'string' && NAMES_A_LOSS.test(targetLabel)) {
    return /\b(?:loses|(?:would|will)\s+lose)\b/iu.test(sentence) && !SAYS_NOT.test(sentence) ? 1 : null;
  }
  return signTheSentenceSays(sentence);
}
