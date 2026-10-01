/**
 * ⭐ A4u — A COUNT TIMES A CONSTANT MONEY-PER-ONE IS A PER-ONE LINK (DL #75 5924354666; R3 5924359227: "deals × £/deal ≡ a
 * £1,000,000-per-deal link"; MG diagnosis 5924092611).
 *
 * MEASURED: served dry runs `train-0258Z` and `train-0341Z` (2 of 2 drafts tonight) drew Paul's deal size as a FACTOR
 * ("Typical investment-firm funding per deal", £1,000,000) multiplied with the deals count in a drafted product identity.
 * Olumi's product is unconfirmed, so PLoT withholds the goal's figures (`GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED`) and
 * Paul's size is stored but never used. Both came through the SIZE retry, where the A4 range retry is never asked.
 *
 * A product of a count and a CONSTANT per-one money amount is linear in the count: the target moves by exactly that amount
 * per one. So the drafted product is read as what it is, on the drafter's own candidate (first draft and retry alike),
 * before admission: the link from the count to the target, sized at that amount per one, and the constant factor gone.
 * The provenance travels with the figure ("explicit" stays the user's claim, anything else is Olumi's), so the existing
 * doors decide whose size it is (#2389 written size, #2409 written range) and #2416/#2421 fit it.
 *
 * Only when the factor IS a constant: not a lever (`controllable`), a finite non-zero level, a money unit, no option
 * sets or changes it, no link points into it, and it is used by nothing but that one product; the product is exactly
 * TWO quantities, the other one not money; the target is money and is NOT the goal (the goal's own product is C46's). Anything else (a price lever, a rate, three factors) is left exactly as drafted.
 * PURE: the candidate itself when nothing applies.
 */
import { canonicalLabel, type CandidateModel } from './admit-model.js';
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';

type Rec = Record<string, any>;
const money = (unit: unknown): boolean => typeof unit === 'string' && readCurrencyUnitWithQualifiers(unit).kind === 'currency';

export function perOneLinksForConstantProducts(c: CandidateModel): CandidateModel {
  const identities = c.identities ?? [];
  if (identities.length === 0) return c;
  const is = (a: string) => (b: string) => canonicalLabel(a) === canonicalLabel(b);
  const unitOf = (label: string): unknown => [...c.factors, ...c.outcomes, ...c.risks].find((q) => is(label)(q.label))?.unit
    ?? (is(label)(c.goal.metric) ? c.goal.unit : undefined);
  const setByOption = (label: string): boolean => c.options.some((o) => (o.interventions ?? []).some((i) => is(label)(i.factor_label))
    || (o.changes ?? []).some(is(label)));
  let next: Rec | undefined;
  for (const id of identities) {
    if (id.operation !== 'product' || id.factors.length !== 2) continue;
    const cur = (next ?? c) as CandidateModel;
    // ⛔ Never the GOAL's own product (C46: the user's identity, its confirm card and its withholds), and never a lever the
    // user controls (`controllable`: an option may set it later, so the product is not linear in what the user can do).
    if (is(id.outcome)(c.goal.metric)) continue;
    const k = cur.factors.find((f) => id.factors.some(is(f.label)) && f.role !== 'controllable' && typeof f.baseline_value === 'number'
      && Number.isFinite(f.baseline_value) && f.baseline_value !== 0 && money(f.unit));
    if (k === undefined) continue;
    const count = id.factors.find((l) => !is(k.label)(l))!;
    const touchesK = cur.links.filter((l) => is(k.label)(l.from) || is(k.label)(l.to));
    if (!money(unitOf(id.outcome)) || money(unitOf(count)) || setByOption(k.label)
      || cur.identities!.some((x) => x !== id && x.factors.some(is(k.label)))
      || touchesK.some((l) => !(is(k.label)(l.from) && is(id.outcome)(l.to)))) continue;
    const amount = k.baseline_value as number;
    const sized = {
      direction: amount < 0 ? 'negative' : 'positive', effect_amount: amount, effect_per_source_change: 1,
      effect_provenance: k.provenance === 'explicit' ? 'explicit' : 'ai_proposed', definitional: null,
    };
    const hasLink = cur.links.some((l) => is(count)(l.from) && is(id.outcome)(l.to));
    next = {
      ...cur,
      factors: cur.factors.filter((f) => f !== k),
      identities: cur.identities!.filter((x) => x !== id),
      links: [
        ...cur.links.filter((l) => !touchesK.includes(l)).map((l) => (is(count)(l.from) && is(id.outcome)(l.to) ? { ...l, ...sized } : l)),
        ...(hasLink ? [] : [{ from: count, to: id.outcome, provenance: 'inferred', ...sized }]),
      ],
    };
  }
  return (next ?? c) as CandidateModel;
}
