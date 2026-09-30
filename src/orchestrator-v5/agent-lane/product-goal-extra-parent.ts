/**
 * ⛔ A GOAL READ AS A TWO-PART PRODUCT GETS NO THIRD DIRECT PARENT (R3 #75 5902616543; DL 5902635867; MG successor
 * 5902710041).
 *
 * Signed-in `ec51a31b` (CEE `1f9d769`, the constructor brief): MRR = price × subscribers (Olumi's reading) AND a direct
 * `churn → MRR` link, Olumi's estimate of −£735/month per churn point (= 15 subscribers × £49). The card needs exactly two
 * parents, so it never came; and churn acts THROUGH subscribers in MRR = price × subscribers, so the direct link misplaces
 * it. It is not dropped (that would erase the price rise's churn penalty from MRR, an optimistic false figure):
 *   · an extra parent that already reaches an operand is a DOUBLE route: the direct link is taken out;
 *   · else, an Olumi-sized extra link is RE-POINTED to the volume operand (the operand not priced in money per unit),
 *     its size converted through the product at the rate operand's stated level (−735 ÷ £49 = −15 subscribers per
 *     point). Still Olumi's estimate, and said.
 * Anything else (a size the user stated, no size, no stated rate level, not exactly one money-rate operand) is left
 * exactly as drafted. Candidate-level and pure.
 */
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import { sayFigureRead } from './say-figure.js';
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';

interface Link {
  readonly from: string; readonly to: string; readonly direction?: string; readonly provenance?: string;
  readonly effect_amount?: number | null; readonly effect_per_source_change?: number | null; readonly effect_provenance?: string | null;
}
interface ModelShape {
  readonly goal: { readonly metric: string; readonly unit?: string | null };
  readonly factors: readonly { readonly label: string; readonly unit: string | null; readonly baseline_known: boolean; readonly baseline_value: number | null }[];
  readonly links: readonly Link[];
  readonly identities?: readonly { readonly outcome: string; readonly operation: string; readonly factors: readonly string[] }[];
}

export type ExtraParentOfProductGoal =
  | { readonly kind: 'double_route'; readonly from: string; readonly goal: string; readonly through: string }
  | { readonly kind: 'rerouted'; readonly from: string; readonly goal: string; readonly rate: string; readonly volume: string;
      readonly amount: number; readonly per: number; readonly converted: number; readonly rateLevel: number;
      readonly goalUnit: string; readonly fromUnit: string; readonly volumeUnit: string; readonly rateUnit: string };

const key = (s: string): string => s.trim().toLowerCase();
const CODES = new Set(Object.values(CURRENCY_SYMBOL_TO_CODE).map((c) => c.toUpperCase()));
/** A unit priced in money: its leading token is a currency code or symbol ("GBP per subscriber per month", "£/month"). */
const isMoney = (unit: string | null | undefined): boolean => {
  const head = typeof unit === 'string' ? (/^[^\s/]+/.exec(unit.trim())?.[0] ?? '') : '';
  return head !== '' && (CODES.has(head.toUpperCase()) || Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL_TO_CODE, head[0]!));
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A money unit written in whole units: its currency token without the magnitude ("£k/month" → "£/month"). */
const wholeUnit = (unit: string, display: string | undefined): string =>
  display === undefined ? unit : unit.replace(/[^\s/]+/, (t) => (t.toLowerCase().startsWith(display.toLowerCase()) ? display : t));

export function rerouteExtraParentsOfProductGoal<M extends ModelShape>(model: M): { model: M; found: ExtraParentOfProductGoal[] } {
  const goal = key(model.goal.metric);
  const ident = (model.identities ?? []).find((i) => i.operation === 'product' && key(i.outcome) === goal && i.factors.length === 2);
  if (ident === undefined) return { model, found: [] };
  const operands = new Set(ident.factors.map(key));
  const factor = (label: string) => model.factors.find((f) => key(f.label) === key(label));
  const rates = ident.factors.filter((f) => isMoney(factor(f)?.unit));
  const rate = rates.length === 1 ? factor(rates[0]!) : undefined;
  const volume = rate === undefined ? undefined : factor(ident.factors.find((f) => key(f) !== key(rate.label))!);
  const reaches = (from: string, skip: Link): string | undefined => {
    const seen = new Set<string>([key(from)]);
    const queue = [key(from)];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const l of model.links) {
        if (l === skip || key(l.from) !== at || key(l.to) === goal) continue;
        if (operands.has(key(l.to))) return l.to;
        if (!seen.has(key(l.to))) { seen.add(key(l.to)); queue.push(key(l.to)); }
      }
    }
    return undefined;
  };
  const found: ExtraParentOfProductGoal[] = [];
  const links: Link[] = [];
  for (const l of model.links) {
    if (key(l.to) !== goal || operands.has(key(l.from))) { links.push(l); continue; }
    // A link the user stated (or sized) is theirs: never dropped or re-pointed here (AIQ 5902792262).
    if (l.provenance === 'explicit' || l.effect_provenance === 'explicit') { links.push(l); continue; }
    const through = reaches(l.from, l);
    if (through !== undefined) {
      found.push({ kind: 'double_route', from: l.from, goal: model.goal.metric, through });
      continue;
    }
    const sized = l.effect_provenance != null && finite(l.effect_amount) && finite(l.effect_per_source_change) && l.effect_per_source_change !== 0;
    if (!sized || rate === undefined || volume === undefined || isMoney(volume.unit) || !rate.baseline_known || !finite(rate.baseline_value) || rate.baseline_value <= 0) {
      links.push(l);
      continue;
    }
    // ⛔ BOTH SIDES IN WHOLE UNITS OF ONE CURRENCY (MG CR 5902882621): an MRR goal drafted in "£k/month" carries −0.735
    // for −£735, and the rate is £49 per subscriber — unscaled, that is −0.015 subscribers a point, the churn penalty
    // erased. A goal or rate not read as money, or two currencies, is left exactly as drafted.
    const goalU = readCurrencyUnitWithQualifiers(model.goal.unit);
    const rateU = readCurrencyUnitWithQualifiers(rate.unit);
    if (goalU.kind !== 'currency' || rateU.kind !== 'currency' || goalU.currencyCode === undefined || goalU.currencyCode !== rateU.currencyCode) {
      links.push(l);
      continue;
    }
    const amount = (l.effect_amount as number) * goalU.multiplier;
    const rateLevel = rate.baseline_value * rateU.multiplier;
    const converted = amount / rateLevel;
    links.push({ ...l, to: volume.label, effect_amount: converted });
    found.push({ kind: 'rerouted', from: l.from, goal: model.goal.metric, rate: rate.label, volume: volume.label,
      amount, per: l.effect_per_source_change as number, converted, rateLevel,
      goalUnit: wholeUnit(model.goal.unit ?? '', goalU.currencyDisplay), fromUnit: factor(l.from)?.unit ?? '', volumeUnit: volume.unit ?? '',
      rateUnit: wholeUnit(rate.unit ?? '', rateU.currencyDisplay) });
  }
  return found.length === 0 ? { model, found } : { model: { ...model, links } as M, found };
}

/** The one sentence each finding is said with (`not_represented`). */
export function sayExtraParentOfProductGoal(f: ExtraParentOfProductGoal): string {
  if (f.kind === 'double_route') {
    return `"${f.from}" was linked straight to "${f.goal}" as well as through "${f.through}", which would count it twice, so the direct link was taken out.`;
  }
  return `"${f.from}" was linked straight to "${f.goal}", beside "${f.goal}" = "${f.rate}" × "${f.volume}", so it now acts through "${f.volume}": `
    + `${sayFigureRead(f.amount, f.goalUnit)} per ${sayFigureRead(f.per, f.fromUnit)} of "${f.from}" is ${sayFigureRead(f.converted, f.volumeUnit)} `
    + `at today's ${sayFigureRead(f.rateLevel, f.rateUnit)}. That size is still my estimate.`;
}
