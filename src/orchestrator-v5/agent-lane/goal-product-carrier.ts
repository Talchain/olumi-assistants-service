/**
 * ⛔ A GOAL WHOSE ONLY PARENT IS A PRODUCT OF THE USER'S TWO FIGURES IS THAT PRODUCT (R3 #72 5888379558 run 2; AIQ
 * 5888438944; DL 5888399097; MG 5888469185 class 1).
 *
 * On Paul's brief ("…1,500 paying subscribers and £75k MRR…") the drafter sometimes declares the product on an
 * INTERMEDIATE ("Pro plan MRR" = price × subscribers) and feeds the goal "MRR" through one plain, unsized link. The
 * analysis then reads the goal off that default strength: £59 centred at ≈ £76k where £59 × 1,500 is £88.5k, and the
 * reply said £85k is not reached. #2286's mint cannot fire, because the goal's parent is the carrier, not the two parts.
 *
 * This folds the carrier into the goal (its two parts feed the goal; the carrier and its plain link go) and keeps the
 * fold ONLY IF #2286's own proof then declares the goal's identity: the user's three figures, within ISL's 5%, units that
 * compose, exactly two parents. Anything else returns the candidate as it came. Nothing is estimated and no label is
 * read: the carrier is found by structure and cleared by the user's own numbers. Pure.
 *
 * CLASS 2 (AIQ 5888943993 (1), "drop, don't ask"): the drafter often adds an "Other-plan MRR" (£1,500 = £75,000 − £73,500)
 * beside the carrier. It is left out ONLY when (a) it carries nothing of the user's (Olumi's provenance, a level the
 * brief never writes, no user-stated link, nothing sets or feeds it, no limit on it, the goal its only child), is money
 * in the goal's currency, and (b) the carrier alone then passes #2286's proof. (c) Both lines are said where the user
 * sees them (`open_questions`). (d) An ordinary edit brings it back. Any part of it the user's → nothing changes (a
 * user-stated addend is the `addends` path CEE cannot carry yet, R3 5888498516).
 */
import type { CandidateModel } from './admit-model.js';
import { withReconcilingProductIdentity } from './reconciling-product.js';
import { figureTheUserWroteFor } from './stated-by-user.js';
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';

export interface FoldedCarrier {
  readonly carrier: string;
  /** Olumi-invented same-currency parents of the goal left out (AIQ 5888943993 (1)): their labels, never the user's. */
  readonly dropped: readonly string[];
  readonly goal: string;
  /** The two operands, each with its OWN unit (PR Review on 5b980ff7: never the goal's currency on the count). */
  readonly parts: readonly [Part, Part];
  readonly stated: number;
  readonly unit: string;
}

type Link = CandidateModel['links'][number];
interface Part { readonly label: string; readonly value: number; readonly unit: string }

/** The candidate with the carrier folded into the goal and #2286's mint applied, or the candidate unchanged. */
export function foldProductCarrierIntoGoal(candidate: CandidateModel, brief: string): { readonly model: CandidateModel; readonly folded: FoldedCarrier | null } {
  const unchanged = { model: candidate, folded: null };
  const goal = candidate.goal?.metric;
  if (typeof goal !== 'string' || goal === '') return unchanged;
  const identities = candidate.identities ?? [];
  if (identities.some((i) => i.outcome === goal)) return unchanged;
  const optionLabels = new Set((candidate.options ?? []).map((o) => o.label));
  const links = candidate.links ?? [];
  const intoGoal = links.filter((l) => l.to === goal && !optionLabels.has(l.from));
  if (new Set(intoGoal.map((l) => l.from)).size !== intoGoal.length) return unchanged;
  const carriers = intoGoal.filter((l) => identities.some((i) => i.outcome === l.from && i.operation === 'product'));
  if (carriers.length !== 1) return unchanged;
  const plain: Link = carriers[0]!;
  const carrier = plain.from;
  if (carrier === goal || plain.effect_provenance === 'explicit') return unchanged;
  const product = identities.filter((i) => i.outcome === carrier);
  if (product.length !== 1 || product[0]!.operation !== 'product') return unchanged;
  // Every other parent of the goal must be Olumi's own same-currency invention, or nothing changes.
  const others = intoGoal.filter((l) => l !== plain);
  const goalCurrency = readCurrencyUnitWithQualifiers(String(candidate.goal.unit ?? '')).currencyCode;
  const invented = (l: Link): boolean => {
    const label = l.from;
    const f = (candidate.factors ?? []).find((x) => x.label === label);
    const o = (candidate.outcomes ?? []).find((x) => x.label === label);
    const provenance = f?.provenance ?? o?.provenance;
    if (provenance === undefined || provenance === 'explicit' || l.provenance === 'explicit' || l.effect_provenance === 'explicit') return false;
    // Scoped to THIS quantity's own words (the door #2284 trusts): Paul's "1,500 paying subscribers" is not a £1,500 the
    // user wrote for "Other-plan MRR", and "Other plans bring in £1,500 a month" is.
    const rivals = [...(candidate.factors ?? []).map((x) => x.label), ...(candidate.outcomes ?? []).map((x) => x.label), goal].filter((x) => x !== label);
    if (f !== undefined && typeof f.baseline_value === 'number' && figureTheUserWroteFor(f.baseline_value, f.unit, brief, { target: [label], others: rivals })) return false;
    const r = readCurrencyUnitWithQualifiers(String(f?.unit ?? ''));
    if (goalCurrency === undefined || r.kind !== 'currency' || r.currencyCode !== goalCurrency) return false;
    if (links.some((x) => x.to === label) || links.some((x) => x.from === label && x.to !== goal)) return false;
    if ((candidate.options ?? []).some((opt) => (opt.interventions ?? []).some((i) => i.factor_label === label) || (opt.changes ?? []).includes(label))) return false;
    return !(candidate.constraints ?? []).some((c) => c.metric === label);
  };
  if (!others.every(invented)) return unchanged;
  const dropped = others.map((l) => l.from);
  const parts = [...new Set(product[0]!.factors)];
  if (parts.length !== 2 || parts.includes(carrier) || parts.includes(goal)) return unchanged;
  // The carrier is only a pass-through: its sole child is the goal, its only parents are its two parts, no option sets
  // or reaches it, and no limit sits on it. Otherwise it is a quantity in its own right and stays.
  if (links.some((l) => l.from === carrier && l.to !== goal)) return unchanged;
  const intoCarrier = links.filter((l) => l.to === carrier);
  if (intoCarrier.some((l) => !parts.includes(l.from)) || new Set(intoCarrier.map((l) => l.from)).size !== 2) return unchanged;
  if ((candidate.options ?? []).some((o) => (o.interventions ?? []).some((i) => i.factor_label === carrier) || (o.changes ?? []).includes(carrier))) return unchanged;
  if ((candidate.constraints ?? []).some((c) => c.metric === carrier)) return unchanged;
  if (links.some((l) => parts.includes(l.from) && l.to === goal)) return unchanged;

  const gone = new Set([carrier, ...dropped]);
  const folded: CandidateModel = {
    ...candidate,
    links: links.filter((l) => l !== plain && !others.includes(l)).map((l) => (l.to === carrier ? { ...l, to: goal } : l)),
    factors: (candidate.factors ?? []).filter((f) => !gone.has(f.label)),
    outcomes: (candidate.outcomes ?? []).filter((o) => !gone.has(o.label)),
    identities: identities.filter((i) => i.outcome !== carrier),
  };
  const minted = withReconcilingProductIdentity(folded, brief);
  const declared = (minted.identities ?? []).find((i) => i.outcome === goal && i.operation === 'product');
  if (declared === undefined || minted === folded) return unchanged;
  const part = (label: string): Part => {
    const f = (candidate.factors ?? []).find((x) => x.label === label);
    return { label, value: Number(f?.baseline_value), unit: String(f?.unit ?? '') };
  };
  return {
    model: minted,
    folded: {
      carrier, goal, dropped,
      parts: [part(parts[0]!), part(parts[1]!)],
      stated: Number(candidate.goal.baseline_value),
      unit: String(candidate.goal.unit ?? ''),
    },
  };
}

const figure = (v: number, unit = ''): string => {
  const n = v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return /£|\bGBP\b/i.test(unit) ? `£${n}` : /\$|\bUSD\b/i.test(unit) ? `$${n}` : /€|\bEUR\b/i.test(unit) ? `€${n}` : n;
};

/**
 * The lines the user sees (`open_questions`, AIQ 5888943993 (1)(c)), in AI Quality's words: the carrier ACCOUNTS FOR the
 * goal (the gap within 5% is real, so never "is your … itself"), and each Olumi addition left out is named.
 */
export function foldedCarrierLines(f: FoldedCarrier): string[] {
  // The money rate first, then the count, whatever order the drafter listed them in; each figure in its OWN unit.
  const money = (p: Part): boolean => readCurrencyUnitWithQualifiers(p.unit).kind === 'currency';
  const [a, b] = money(f.parts[1]) && !money(f.parts[0]) ? [f.parts[1], f.parts[0]] : f.parts;
  const sum = `${figure(a.value, a.unit)} × ${figure(b.value, b.unit)} = ${figure(a.value * b.value, f.unit)}, close to your ${figure(f.stated, f.unit)}`;
  return [
    `‘${f.carrier}’ accounts for your ${f.goal} (${sum}), so ${f.goal} is worked out as ${a.label} × ${b.label}.`,
    ...f.dropped.map((d) => `‘${d}’ was Olumi's addition, and your figures don't need it (${sum}), so it is left out.`),
  ];
}
