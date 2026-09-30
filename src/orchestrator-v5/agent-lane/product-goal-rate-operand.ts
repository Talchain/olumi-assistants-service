/**
 * ⛔ A PRODUCT GOAL'S RATE IS THE USER'S OWN PRICE WHEN OLUMI'S RATE ONLY PASSES IT ON (R3 #75 5902925902 / 5902892629;
 * AIQ 5902905975; DL 5902949807, "shape 2").
 *
 * Guest `afa332b2` (CEE `f074916`, the constructor brief): MRR = "Effective monthly revenue per subscriber" × subscribers,
 * where that rate is Olumi's £50 (sized so that £50 × 1,500 = £75k) and the user's £49 "Pro plan price" feeds it at
 * exactly 1 per 1 — the price passed straight on. The card needs the user's own figures on both parts, so it was never
 * offered: no Yes, and no goal chance on journey 1. AIQ: the rate operand must be the user's £49; Olumi's £50 is a
 * reading and is said as one.
 *
 * Folded ONLY when every one of these holds; anything else is left exactly as drafted:
 *   · the goal is a two-part product (candidate `identities`) and the rate is one of its parts, NOT the user's level;
 *   · exactly one link feeds the rate, from a factor whose level the USER stated, Olumi-sized at exactly 1 per 1;
 *   · both are money per unit in ONE currency and scale (`readCurrencyUnitWithQualifiers`);
 *   · nothing else names the rate: no option level, no limit, no other identity, no other field of the candidate.
 * The rate's other links go out from the price instead (one that already exists is not doubled). Candidate-level, pure.
 */
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { sayFigureRead } from './say-figure.js';

interface Link {
  readonly from: string; readonly to: string; readonly provenance?: string;
  readonly effect_amount?: number | null; readonly effect_per_source_change?: number | null; readonly effect_provenance?: string | null;
}
interface Factor {
  readonly label: string; readonly unit: string | null; readonly baseline_known: boolean; readonly baseline_value: number | null;
  readonly provenance?: string;
}
interface ModelShape {
  readonly goal: { readonly metric: string };
  readonly factors: readonly Factor[];
  readonly links: readonly Link[];
  readonly identities?: readonly { readonly outcome: string; readonly operation: string; readonly factors: readonly string[] }[];
}

export interface RateOperandIsUsersPrice {
  readonly goal: string; readonly rate: string; readonly rateLevel: number | null; readonly price: string; readonly priceLevel: number;
  readonly other: string; readonly unit: string;
}

const key = (s: string): string => s.trim().toLowerCase();
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** How many times `label` appears as a whole JSON string value anywhere in `value`. */
const mentions = (value: unknown, label: string): number =>
  typeof value === 'string' ? (key(value) === key(label) ? 1 : 0)
    : Array.isArray(value) ? value.reduce((n: number, v) => n + mentions(v, label), 0)
      : value !== null && typeof value === 'object' ? Object.values(value).reduce((n: number, v) => n + mentions(v, label), 0) : 0;

export function foldPassThroughRateOntoUsersPrice<M extends ModelShape>(model: M): { model: M; found: RateOperandIsUsersPrice[] } {
  const goal = key(model.goal.metric);
  const identities = model.identities ?? [];
  const ident = identities.find((i) => i.operation === 'product' && key(i.outcome) === goal && i.factors.length === 2);
  if (ident === undefined) return { model, found: [] };
  const factor = (label: string): Factor | undefined => model.factors.find((f) => key(f.label) === key(label));
  for (const rateLabel of ident.factors) {
    const rate = factor(rateLabel);
    if (rate === undefined || rate.provenance === 'explicit') continue;
    const feeds = model.links.filter((l) => key(l.to) === key(rate.label));
    if (feeds.length !== 1) continue;
    const feed = feeds[0]!;
    const price = factor(feed.from);
    const other = ident.factors.find((f) => key(f) !== key(rateLabel))!;
    if (price === undefined || key(price.label) === key(other) || key(price.label) === goal) continue;
    if (price.provenance !== 'explicit' || !price.baseline_known || !finite(price.baseline_value) || price.baseline_value <= 0) continue;
    if (feed.provenance === 'explicit' || feed.effect_provenance == null || feed.effect_provenance === 'explicit') continue;
    if (!finite(feed.effect_amount) || !finite(feed.effect_per_source_change) || feed.effect_per_source_change <= 0
      || feed.effect_amount !== feed.effect_per_source_change) continue;
    const ru = readCurrencyUnitWithQualifiers(rate.unit);
    const pu = readCurrencyUnitWithQualifiers(price.unit);
    if (ru.kind !== 'currency' || pu.kind !== 'currency' || ru.currencyCode === undefined || ru.currencyCode !== pu.currencyCode
      || ru.multiplier !== pu.multiplier) continue;
    // Nothing else may name the rate: its own entry, the one feed, its links out, and this identity's one mention.
    const outs = model.links.filter((l) => key(l.from) === key(rate.label));
    if (mentions(model, rate.label) !== 1 + 1 + outs.length + 1) continue;
    const links: Link[] = [];
    for (const l of model.links) {
      if (l === feed) continue;
      if (key(l.from) !== key(rate.label)) { links.push(l); continue; }
      if (model.links.some((x) => key(x.from) === key(price.label) && key(x.to) === key(l.to))) continue;
      links.push({ ...l, from: price.label });
    }
    const folded = {
      ...model,
      factors: model.factors.filter((f) => f !== rate),
      links,
      identities: identities.map((i) => (i !== ident ? i : { ...i, factors: i.factors.map((f) => (key(f) === key(rateLabel) ? price.label : f)) })),
    } as M;
    return { model: folded, found: [{ goal: model.goal.metric, rate: rate.label, rateLevel: finite(rate.baseline_value) ? rate.baseline_value : null,
      price: price.label, priceLevel: price.baseline_value, other, unit: price.unit ?? '' }] };
  }
  return { model, found: [] };
}

/** The one sentence the fold is said with (`not_represented`): Olumi's figure as a reading, the user's as theirs. */
export function sayRateOperandIsUsersPrice(f: RateOperandIsUsersPrice): string {
  const olumis = f.rateLevel === null ? '' : ` (${sayFigureRead(f.rateLevel, f.unit)}, my reading)`;
  return `I had read "${f.goal}" as "${f.rate}"${olumis} × "${f.other}", but "${f.rate}" only passed on your "${f.price}", `
    + `so "${f.goal}" now reads your ${sayFigureRead(f.priceLevel, f.unit)} directly: "${f.goal}" = "${f.price}" × "${f.other}".`;
}
