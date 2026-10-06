import { nonEffectQuantitySpans } from '../../cee/factor-extraction/goal-label-target.js';
import { statedEffectQuoteMatches, type StatedEffectDetail } from '../../cee/provenance/stated-effect.js';
import { sentenceNamesOtherQuantity } from './stated-by-user.js';
import { sameUnit } from './same-unit.js';

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
  /** Filled with every bind made THROUGH a pass-through (above); each such link is also in the returned map. */
  passThroughs?: PassThroughBinding[],
): Map<number, string> {
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
    sentences.forEach((sentence, index) => {
      let spans: Spans | undefined;
      if (statedEffectQuoteMatches(sentence, d, located => { spans = located; })) {
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
      || !sameUnit(d.per_source_change_unit, nodeById.get(l.from)?.change_unit ?? nodeById.get(l.from)?.unit)) return false;
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
    if (through !== undefined) {
      // One definition per onward link: a second source binding through the same mediator must type it the same way.
      const typed = passThroughs?.find(t => t.onward === through!.onward);
      if (typed !== undefined && typed.sign !== through.sign) return false;
      passThroughs?.push(through);
    }
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
    return { link, onward: onward[0]!, sign: o.effect_direction === 'negative' ? -1 : 1, sentence };
  }
}
