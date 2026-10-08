/**
 * ⛔ A GOAL READ AS A TWO-PART PRODUCT GETS NO THIRD DIRECT PARENT (R3 #75 5902616543; DL 5902635867; MG successor
 * 5902710041).
 *
 * Signed-in `ec51a31b` (CEE `1f9d769`, the constructor brief): MRR = price × subscribers (Olumi's reading) AND a direct
 * `churn → MRR` link, Olumi's estimate of −£735/month per churn point (= 15 subscribers × £49). The card needs exactly two
 * parents, so it never came; and churn acts THROUGH subscribers in MRR = price × subscribers, so the direct link misplaces
 * it. It is not dropped (that would erase the price rise's churn penalty from MRR, an optimistic false figure):
 *   · an extra parent that already reaches an operand is an ADDEND (C46 rule 7: a discount cuts revenue directly AND
 *     adds subscribers), a money parent is an addend in the goal's own terms, and a risk is not a factor: all are left
 *     exactly as drafted;
 *   · else, an Olumi-sized extra link from a non-money factor is RE-POINTED to the volume operand (the operand not priced in money per unit),
 *     its size converted through the product at the rate operand's stated level (−735 ÷ £49 = −15 subscribers per
 *     point). Still Olumi's estimate, and said.
 * Anything else (a size the user stated, no size, no stated rate level, not exactly one money-rate operand) is left
 * exactly as drafted. Candidate-level and pure.
 */
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import { sayFigureRead } from './say-figure.js';
import { isPercentScaledUnit } from '../../cee/draft/records/unit-scale-class.js';
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';

interface Link {
  readonly from: string; readonly to: string; readonly direction?: string; readonly provenance?: string;
  readonly effect_amount?: number | null; readonly effect_per_source_change?: number | null; readonly effect_provenance?: string | null;
  readonly definitional?: boolean | null;
}
interface ModelShape {
  readonly goal: { readonly metric: string; readonly unit?: string | null };
  readonly factors: readonly { readonly label: string; readonly unit: string | null; readonly baseline_known: boolean; readonly baseline_value: number | null }[];
  readonly links: readonly Link[];
  readonly risks?: readonly { readonly label: string; readonly provenance?: string; readonly analysis_participation?: 'retained_excluded' }[];
  readonly outcomes?: readonly { readonly label: string; readonly unit?: string | null }[];
  readonly constraints?: readonly { readonly metric: string; readonly operator?: string | null; readonly value?: number | null; readonly unit?: string | null }[];
  readonly identities?: readonly { readonly outcome: string; readonly operation: string; readonly factors: readonly string[] }[];
}

export type ExtraParentOfProductGoal =
  | { readonly kind: 'rerouted'; readonly from: string; readonly goal: string; readonly rate: string; readonly volume: string;
      readonly amount: number; readonly per: number; readonly converted: number; readonly rateLevel: number;
      readonly goalUnit: string; readonly fromUnit: string; readonly volumeUnit: string; readonly rateUnit: string }
  | { readonly kind: 'rerouted_unsized'; readonly from: string; readonly goal: string; readonly rate: string; readonly volume: string }
  | { readonly kind: 'kept_out_cause_carried'; readonly from: string; readonly goal: string; readonly volume: string; readonly causes: readonly string[]; readonly limit?: string }
  | { readonly kind: 'kept_out_already_carried'; readonly from: string; readonly goal: string; readonly rate: string; readonly volume: string;
      readonly via: readonly string[] };

const key = (s: string): string => s.trim().toLowerCase();
const CODES = new Set(Object.values(CURRENCY_SYMBOL_TO_CODE).map((c) => c.toUpperCase()));
/** A unit priced in money: its leading token is a currency code or symbol ("GBP per subscriber per month", "£/month"). */
const isMoney = (unit: string | null | undefined): boolean => {
  const head = typeof unit === 'string' ? (/^[^\s/]+/.exec(unit.trim())?.[0] ?? '') : '';
  return head !== '' && (CODES.has(head.toUpperCase()) || Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL_TO_CODE, head[0]!));
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/**
 * A risk the USER named (AIQ 5906624217 row 2, R3 5906615257): stated (`explicit` → `from_brief`), or every word of its
 * label is written in the brief ("we're worried about backlash from our customers"). Deliberately BROAD: it decides what
 * is never removed, so any doubt (no brief, no word to check) reads as the user's.
 */
const usersRisk = (r: { readonly label: string; readonly provenance?: string }, brief: string | undefined): boolean => {
  if (r.provenance === 'explicit' || typeof brief !== 'string') return true;
  const words = r.label.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const text = brief.toLowerCase();
  return words.length === 0 || words.every((w) => text.includes(w));
};
/** A money unit written in whole units: its currency token without the magnitude ("£k/month" → "£/month"). */
const wholeUnit = (unit: string, display: string | undefined): string =>
  display === undefined ? unit : unit.replace(/[^\s/]+/, (t) => (t.toLowerCase().startsWith(display.toLowerCase()) ? display : t));

export function rerouteExtraParentsOfProductGoal<M extends ModelShape>(model: M, brief?: string): { model: M; found: ExtraParentOfProductGoal[] } {
  const goal = key(model.goal.metric);
  const ident = (model.identities ?? []).find((i) => i.operation === 'product' && key(i.outcome) === goal && i.factors.length === 2);
  if (ident === undefined) return { model, found: [] };
  const operands = new Set(ident.factors.map(key));
  const factor = (label: string) => model.factors.find((f) => key(f.label) === key(label));
  const rates = ident.factors.filter((f) => isMoney(factor(f)?.unit));
  const rate = rates.length === 1 ? factor(rates[0]!) : undefined;
  // Science goals §(e) addendum 6 (8 Oct, P48 552acb7d): a DECLARED product's operand the drafter typed as an OUTCOME is
  // still its volume (the identity says so); only its label and unit are read here. The rate stays a factor (its level).
  const outcome = (label: string) => (model.outcomes ?? []).find((o) => key(o.label) === key(label));
  const volumeLabel = rate === undefined ? undefined : ident.factors.find((f) => key(f) !== key(rate.label));
  const volume: { readonly label: string; readonly unit?: string | null } | undefined = volumeLabel === undefined ? undefined
    : factor(volumeLabel) ?? outcome(volumeLabel);
  // Codex r1 P1-2 (#2826): an OUTCOME volume serves the UNSIZED re-point / keep-out only; the sized conversion below writes a
  // figure in the volume's unit, so it still needs a factor volume (an outcome may carry no unit).
  const volumeIsFactor = volumeLabel !== undefined && factor(volumeLabel) !== undefined;
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
  /** The price's own routes to the count that do not pass through `risk` or the goal: each first step's label. */
  const rateRoutesToVolume = (risk: string): string[] => {
    if (rate === undefined || volume === undefined) return [];
    const to = (at: string) => model.links.filter((c) => key(c.from) === at && key(c.to) !== key(risk) && key(c.to) !== goal);
    const reachesVolume = (start: string): boolean => {
      const seen = new Set<string>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const at = queue.shift()!;
        if (at === key(volume.label)) return true;
        for (const c of to(at)) if (!seen.has(key(c.to))) { seen.add(key(c.to)); queue.push(key(c.to)); }
      }
      return false;
    };
    return [...new Set(to(key(rate.label)).filter((c) => reachesVolume(key(c.to))).map((c) => c.to))];
  };
  /** Does `start` reach `target` without passing through `avoid` or the goal? */
  const reachesAvoiding = (start: string, target: string, avoid: string): boolean => {
    const seen = new Set<string>([start]); const queue = [start];
    while (queue.length > 0) {
      const at = queue.shift()!;
      if (at === target) return true;
      for (const c of model.links) {
        if (key(c.from) !== at || key(c.to) === avoid || key(c.to) === goal || seen.has(key(c.to))) continue;
        seen.add(key(c.to)); queue.push(key(c.to));
      }
    }
    return false;
  };
  const found: ExtraParentOfProductGoal[] = [];
  const links: Link[] = [];
  const keptOut = new Set<string>();
  for (const l of model.links) {
    if (key(l.to) !== goal || operands.has(key(l.from))) { links.push(l); continue; }
    // A link the user stated (or sized) is theirs: never dropped or re-pointed here (AIQ 5902792262).
    if (l.provenance === 'explicit' || l.effect_provenance === 'explicit') { links.push(l); continue; }
    // Codex r1 P2 (#2826): a drafter-made DEFINITIONAL link into the goal is an addend of the reading (§(e) addendum 2), kept.
    if (l.definitional === true) { links.push(l); continue; }
    // ⛔ C46 RULE 7 (CI on #2328 e216097c: construction-product-identity + c46-leader-withheld-on-a-product): a direct cause
    // of the goal that ALSO feeds an operand is an ADDEND — a discount cuts revenue directly AND adds subscribers. Two
    // mechanisms, not one counted twice, so it is left exactly as drafted. So is a money parent (an addend in the goal's
    // own terms) and anything that is not a factor (a risk): only a non-money factor's link is re-pointed.
    const from = factor(l.from);
    // ⛔ AIQ 5906413249 (amending 5906371639 to R3's science 5906397501; share-build `b3d11a92`): Olumi's RISK straight into a
    // goal read as rate × count ("Customer backlash" → MRR, beside MRR = price × subscribers) contradicts the identity. The
    // price is the user's lever, so a risk that is a REACTION to it (every cause of the risk is the rate operand) can only
    // move MRR through the count. (a) If the price ALREADY reaches the count by another route (churn, new subscribers), that
    // route IS the risk's mechanism: its direct link is DROPPED and said; re-pointing would count it a third time. (b) Only
    // with no such route is its UNSIZED link re-pointed to the count, still Olumi's and unsized, and said. A risk with any
    // other cause (served journey C's "Budget overrun risk" ← "Total initiative spend": no demand channel), a sized link,
    // one that already reaches an operand, or one the user stated is left exactly as drafted.
    const risk = from === undefined && (model.risks ?? []).some((r) => key(r.label) === key(l.from));
    const causes = model.links.filter((c) => key(c.to) === key(l.from)).map((c) => key(c.from));
    const reactsToRate = rate !== undefined && causes.length > 0 && causes.every((c) => c === key(rate.label));
    if (risk && reactsToRate && reaches(l.from, l) === undefined && l.effect_provenance == null && !finite(l.effect_amount)
      && rate !== undefined && volume !== undefined && !isMoney(volume.unit)) {
      // Codex r1 P1-3 (#2826) / §(e) add. 6 correction: never a user-authored risk, re-pointed OR kept out (it was guarded
      // only on the keep-out branch). Without the brief to tell, it is treated as the user's (no move).
      if ((model.risks ?? []).some((r) => key(r.label) === key(l.from) && usersRisk(r, brief))) { links.push(l); continue; }
      const via = rateRoutesToVolume(l.from);
      // ⛔ R3 5906615257 / AIQ 5906624217 row 2: only OLUMI'S risk is kept out of the calculation. A risk the user named is their concern:
      // never removed, even with no link out, so it is left exactly as drafted (no card), a conservative under-claim.
      if (via.length > 0 && (model.risks ?? []).some((r) => key(r.label) === key(l.from) && usersRisk(r, brief))) { links.push(l); continue; }
      // ⛔ A FIGURE RULE NEVER REMOVES STRUCTURE (DL #75 5916217417; supersedes "the risk goes WITH its link", R3 5906615257 /
      // AIQ 5906624217). Served 30 Sep: drafted models with no risk rose to 81%, and this rule took the one risk the
      // £85k MRR draft carried. The risk KEEPS its node, its words and this link, and is kept OUT OF THE CALCULATION
      // (`analysis_participation: 'retained_excluded'`): the run guard hands PLoT the model without it, so the price's
      // effect is counted once, through the named route; the card reads the analysed parents (`identity-proposal.ts`).
      // A risk with another link out is left exactly as drafted (no card), as before.
      const onlyLinkOut = !model.links.some((c) => c !== l && key(c.from) === key(l.from));
      if (via.length > 0 && !onlyLinkOut) { links.push(l); continue; }
      if (via.length > 0) {
        links.push(l);
        keptOut.add(key(l.from));
        found.push({ kind: 'kept_out_already_carried', from: l.from, goal: model.goal.metric, rate: rate.label, volume: volume.label, via });
        continue;
      }
      links.push({ ...l, to: volume.label });
      found.push({ kind: 'rerouted_unsized', from: l.from, goal: model.goal.metric, rate: rate.label, volume: volume.label });
      continue;
    }
    // ⭐ Science goals §(e) addendum 7 NARROWED (8 Oct, P48 d8c01a8f; 605-scenario census): Olumi's UNSIZED risk straight into
    // the goal that RESTATES ITS ONE CAUSE crossing a threshold ("Pro churn exceeds 4%" ← Monthly churn (%), and churn →
    // subscribers exists) counts that cause a second time: it is kept in the model but OUT of the calculation, and said.
    // Exactly ONE cause, a %-unit rate FACTOR reaching the volume without the risk. A competitor's response (causes: price,
    // release) is a separate event and stays. Never a user-authored risk, a sized link, a risk with another link out, or
    // one already reaching an operand.
    const soleCause = new Set(causes).size === 1 ? factor(causes[0]!) : undefined;
    if (risk && !reactsToRate && volume !== undefined && soleCause !== undefined && isPercentScaledUnit(soleCause.unit ?? undefined)
      && reaches(l.from, l) === undefined
      && l.effect_provenance == null && !finite(l.effect_amount)
      && !model.links.some((c) => c !== l && key(c.from) === key(l.from))
      && !(model.risks ?? []).some((r) => key(r.label) === key(l.from) && usersRisk(r, brief))
      && causes.every((c) => c === key(volume.label) || reachesAvoiding(c, key(volume.label), key(l.from)))) {
      links.push(l);
      keptOut.add(key(l.from));
      const causeLabels = model.links.filter((c) => key(c.to) === key(l.from)).map((c) => c.from);
      const limit = (model.constraints ?? []).find((k) => causes.includes(key(k.metric)));
      found.push({ kind: 'kept_out_cause_carried', from: l.from, goal: model.goal.metric, volume: volume.label, causes: [...new Set(causeLabels)],
        ...(limit !== undefined && limitWords(limit) !== undefined ? { limit: limitWords(limit)! } : {}) });
      continue;
    }
    if (reaches(l.from, l) !== undefined || from === undefined || isMoney(from.unit)) { links.push(l); continue; }
    const sized = l.effect_provenance != null && finite(l.effect_amount) && finite(l.effect_per_source_change) && l.effect_per_source_change !== 0;
    if (!sized || rate === undefined || volume === undefined || !volumeIsFactor || isMoney(volume.unit) || !rate.baseline_known || !finite(rate.baseline_value) || rate.baseline_value <= 0) {
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
  if (found.length === 0) return { model, found };
  if (keptOut.size === 0) return { model: { ...model, links } as M, found };
  return { model: { ...model, links,
    risks: (model.risks ?? []).map((r) => (keptOut.has(key(r.label)) ? { ...r, analysis_participation: 'retained_excluded' as const } : r)) } as M, found };
}

/** A limit the brief stated, in its own words ("Monthly churn under 4%"); undefined when it cannot be said plainly. */
function limitWords(k: { readonly metric: string; readonly operator?: string | null; readonly value?: number | null; readonly unit?: string | null }): string | undefined {
  const dir = k.operator === '<' || k.operator === '<=' ? 'under' : k.operator === '>' || k.operator === '>=' ? 'over' : undefined;
  if (dir === undefined || typeof k.value !== 'number' || !Number.isFinite(k.value)) return undefined;
  const unit = (k.unit ?? '').trim();
  return `${k.metric} ${dir} ${k.value}${unit === '%' ? '%' : unit === '' ? '' : ` ${unit}`}`;
}

/** The one sentence each finding is said with (`not_represented`). */
export function sayExtraParentOfProductGoal(f: ExtraParentOfProductGoal): string {
  // AIQ 5906371639's words: the move is said; nothing is sized.
  if (f.kind === 'kept_out_cause_carried') {
    // Science §(e) addendum 7 words: the limit, when the brief stated one, is checked as a limit.
    const list = f.causes.map((c) => `‘${c}’`).join(' and ');
    return `‘${f.from}’ is left out of the calculation: ${list} already ${f.causes.length === 1 ? 'affects' : 'affect'} ‘${f.goal}’ through ‘${f.volume}’`
      + (f.limit !== undefined ? `, and your ‘${f.limit}’ is checked as a limit.` : '.');
  }
  if (f.kind === 'kept_out_already_carried') {
    const list = f.via.map((v) => `‘${v}’`).join(' and ');
    // AIQ 5906624217: the rate by its own name (never "the price"). The risk stays on the model, so where it went is said.
    return `I had ‘${f.from}’ moving ‘${f.goal}’ directly; with ‘${f.goal}’ read as ‘${f.rate}’ × ‘${f.volume}’, the effect of ‘${f.rate}’ on `
      + `‘${f.volume}’ is already in the model through ${list}, so I've kept ‘${f.from}’ in the model but out of the calculation, so it isn't counted twice.`;
  }
  if (f.kind === 'rerouted_unsized') {
    return `I had ‘${f.from}’ moving ‘${f.goal}’ directly; with ‘${f.goal}’ read as ‘${f.rate}’ × ‘${f.volume}’ it now moves ‘${f.volume}’.`;
  }
  return `"${f.from}" was linked straight to "${f.goal}", beside "${f.goal}" = "${f.rate}" × "${f.volume}", so it now acts through "${f.volume}": `
    + `${sayFigureRead(f.amount, f.goalUnit)} per ${sayFigureRead(f.per, f.fromUnit)} of "${f.from}" is ${sayFigureRead(f.converted, f.volumeUnit)} `
    + `at today's ${sayFigureRead(f.rateLevel, f.rateUnit)}. That size is still my estimate.`;
}
