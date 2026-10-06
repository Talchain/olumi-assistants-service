/**
 * ⭐ OLUMI'S OWN HYPOTHESIS NEVER SILENTLY CHANGES THE USER'S RESULT (G1b; Science d5 #87 6011168471, DL ruling 6 Oct; MC 21
 * ceiling #87 6011155077). On e7's #2644 witness, 2 of the 3 failed T1b drafts put a mechanism on the goal path that the
 * brief neither sizes nor says ("Starter-tier service degradation", "MRR lost to starter cannibalisation"). Their links
 * could only be Olumi's guess, so the first Run withheld every option's chance and asked the user to size Olumi's own idea.
 * Measured 0 LLM on the served graphs: an Olumi estimate on the same links is withheld 0/3 by P5 (by rule); left undrafted, 3/3.
 *
 *   · Rule 1: such a MECHANISM is not drafted onto the goal path. It is SAID, with d5's challenge, where the user sees it
 *     (`open_questions`) and where the Agent reads it (`not_represented`): surfacing it keeps the challenge without making
 *     the user size Olumi's guess. Kept: anything the drafter marks as the brief's ('explicit', the only citation the
 *     candidate contract carries), anything a brief sentence names by every content word of its label, anything sized by
 *     a brief figure, set by an option, holding a level or an identity.
 *   · Rule 3: a COST never feeds a REVENUE goal ("£6 a month in support" moves no revenue); it does feed a profit, margin or
 *     net goal. Its link into the revenue is dropped, and that is said (`not_represented`: a statement, not a question).
 *
 * Construction only, on the candidate (labels), before admission. Pure.
 */
import { canonicalLabel, type CandidateModel } from './admit-model.js';
import { sameWord, wordsOf } from './stated-by-user.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';

const k = canonicalLabel;

/** A mechanism Olumi drafted that the brief gives nothing to size or say: not modelled, and challenged. */
export interface UnmodelledMechanism {
  readonly label: string;
  readonly goal: string;
  /** Which way it moves the goal along the drafted path; null when the paths disagree or a sign is unknown. */
  readonly direction: 'raise' | 'lower' | null;
}

/** A cost the drafter drew into a revenue goal, taken out. */
export interface CostOffRevenue { readonly cost: string; readonly goal: string }

/** Words that name no mechanism ("MRR lost TO price rise"): too short or too common to carry a label's meaning. */
const FILLER = new Set(['the', 'and', 'from', 'for', 'per', 'with', 'into', 'onto', 'that', 'this', 'than', 'via', 'due', 'its', 'our']);
const REVENUE = ['revenue', 'mrr', 'arr', 'sales', 'income', 'turnover'];
const NET = ['profit', 'profits', 'margin', 'margins', 'net', 'earnings', 'ebitda'];
/** A COST QUANTITY's words. Never "spend" or "budget": a spend LEVER drives revenue causally (Desk 6b: "Ad spend → MRR"). */
const COST = ['cost', 'costs', 'expense', 'expenses'];
const LEVER = ['spend', 'spending', 'budget', 'budgets', 'investment', 'invest'];

const has = (label: string, set: readonly string[]): boolean => wordsOf(label).some((w) => set.some((s) => sameWord(w, s)))
  || set.some((s) => s.length < 4 && new RegExp(`\\b${s}\\b`, 'iu').test(label));
/** A revenue goal: a revenue word and no profit, margin or net word (d5: keyed to the GOAL's kind). */
export const isRevenueGoal = (metric: string): boolean => has(metric, REVENUE) && !has(metric, NET);
const isCostQuantity = (label: string): boolean => has(label, COST) && !has(label, LEVER);

/** The brief's sentences, as written. */
const sentencesOf = (brief: string): string[] => brief.split(/(?<=[.!?])\s+|\n/u).map((s) => s.trim()).filter(Boolean);

/**
 * How much ONE brief sentence names the label: the largest share of its content words any single sentence holds. The brief
 * names it when that is MORE than half (MC 21 corpus measure: "Higher-than-expected price-rise churn" 3/5 against "each 1%
 * price rise adds … before churn"; "Starter-tier service degradation" 2/4 is not named).
 */
function briefSupport(label: string, brief: string): number {
  const content = wordsOf(label).filter((w) => !FILLER.has(w) && !TIME.has(w)).map(base);
  if (content.length === 0) return 1;
  return Math.max(0, ...sentencesOf(brief).map((s) => { const said = wordsOf(s).map(base); return content.filter((w) => said.some((x) => sameWord(x, w))).length / content.length; }));
}
/** An irregular past form read as its verb ("deals WON" names a "win rate"), local to this reading; never `sameWord` itself. */
const IRREGULAR: Record<string, string> = { won: 'win', lost: 'lose', paid: 'pay', sold: 'sell', bought: 'buy', grew: 'grow', grown: 'grow',
  spent: 'spend', kept: 'keep', held: 'hold', made: 'make', gave: 'give', given: 'give', brought: 'bring', left: 'leave', taken: 'take', took: 'take' };
const base = (w: string): string => IRREGULAR[w] ?? w;
const TIME = new Set(['day', 'days', 'week', 'weeks', 'month', 'months', 'quarter', 'quarters', 'year', 'years', 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'yearly']);

/** The sign a drafted path from `from` to the goal carries: +1, −1, or null when paths disagree or one is unknown. */
function pathSign(c: CandidateModel, from: string): 1 | -1 | null {
  const goal = k(c.goal.metric);
  const signs = new Set<number>();
  const walk = (at: string, sign: number, seen: Set<string>): void => {
    if (k(at) === goal) { signs.add(sign); return; }
    for (const l of c.links.filter((x) => k(x.from) === k(at) && !seen.has(k(x.to)))) {
      const s = l.direction === 'positive' ? 1 : l.direction === 'negative' ? -1 : 0;
      walk(l.to, sign * s, new Set([...seen, k(l.to)]));
    }
  };
  walk(from, 1, new Set([k(from)]));
  return signs.size === 1 && !signs.has(0) ? ([...signs][0] as 1 | -1) : null;
}

/**
 * ⛔ d4 (Science d5 (2)): an Olumi-sized link whose size per one is the PRODUCT of two figures the brief writes (£600 per 1%
 * = "loses about 2 customers" × "removes £300") is the user's own chain collapsed into one quantity, never Olumi's
 * invention: it is not dropped (dropping it overstates the option, 66.5 vs 50.8 measured). A coincidental product only
 * keeps the drafted model, the fail-safe way.
 */
export function collapsesUserFigures(l: CandidateModel['links'][number], brief: string): boolean {
  if (typeof l.effect_amount !== 'number' || typeof l.effect_per_source_change !== 'number' || l.effect_per_source_change === 0) return false;
  return perOnePairs(Math.abs(l.effect_amount / l.effect_per_source_change), brief).length > 0;
}

const PER_ONE = /\b(?:each|every|per)\b/iu;

/**
 * Every pair of figures written in two DIFFERENT per-one sentences of the brief ("Each 1% price rise loses about 2
 * customers", "Each lost customer removes £300") whose product is `size`, with those sentences, in brief order. A level
 * that happens to share a figure ("400 customers paying £300 a month") is no size per one.
 */
function perOnePairs(size: number, brief: string): Array<readonly [string, string]> {
  // A size the brief WRITES is that figure, never a coincidental product of two others (served T1b drafts: Olumi's £1,200
  // per 1% IS "adds £1,200", not "between 1 and 4" × £300; MC 21 corpus measure).
  if (findStatedAmounts(brief).some((a) => Math.abs(a.magnitude - size) < 1e-9 * Math.max(1, size))) return [];
  const sentences = sentencesOf(brief);
  let from = 0;
  const spans = sentences.map((s) => { const at = brief.indexOf(s, from); from = at + s.length; return { s, at, end: at + s.length }; });
  const sentenceAt = (index: number): string | undefined => spans.find((x) => index >= x.at && index < x.end)?.s;
  const figures = findStatedAmounts(brief).filter((a) => Number.isFinite(a.magnitude) && a.magnitude > 1);
  const out: Array<readonly [string, string]> = [];
  for (let i = 0; i < figures.length; i += 1) for (let j = i + 1; j < figures.length; j += 1) {
    if (Math.abs(figures[i]!.magnitude * figures[j]!.magnitude - size) >= 1e-9 * Math.max(1, size)) continue;
    const a = sentenceAt(figures[i]!.index); const b = sentenceAt(figures[j]!.index);
    if (a !== undefined && b !== undefined && a !== b && PER_ONE.test(a) && PER_ONE.test(b)) out.push([a, b]);
  }
  return out;
}

const reachesGoal = (c: CandidateModel, from: string): boolean => {
  const goal = k(c.goal.metric);
  const seen = new Set<string>([k(from)]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (k(at) === goal) return true;
    for (const l of c.links) if (k(l.from) === k(at) && !seen.has(k(l.to))) { seen.add(k(l.to)); queue.push(l.to); }
  }
  return false;
};

export function withoutUnsupportedMechanisms(candidate: CandidateModel, brief: string, keep: (label: string) => boolean = () => false): {
  readonly model: CandidateModel; readonly mechanisms: readonly UnmodelledMechanism[]; readonly costs: readonly CostOffRevenue[];
} {
  const goal = candidate.goal.metric;
  const setByOption = new Set(candidate.options.flatMap((o) => [...(o.interventions ?? []).map((i) => k(i.factor_label)), ...(o.changes ?? []).map(k)]));
  const inIdentity = new Set((candidate.identities ?? []).flatMap((i) => [k(i.outcome), ...i.factors.map(k)]));
  // "No brief figure" (d5): no link at M sized by a figure the brief writes, credited to the user or not (served T1b drafts
  // size ‘Starter-tier MRR’ by the brief's £49 as Olumi's estimate), or by the product of two of its per-one figures.
  // A definition's ±1 and a "1%" are never a size the brief gives (served d2: cannibalisation → MRR is −1 per 1): only
  // figures above 1 count.
  const written = findStatedAmounts(brief).map((a) => a.magnitude).filter((m) => Number.isFinite(m) && m > 1);
  const isWritten = (x: number): boolean => x > 1 && written.some((m) => Math.abs(m - x) < 1e-9 * Math.max(1, x));
  const briefFigureAt = (label: string): boolean => candidate.links.some((l) => (k(l.from) === k(label) || k(l.to) === k(label))
    && typeof l.effect_amount === 'number'
    && ((l.effect_provenance ?? null) === 'explicit' || isWritten(Math.abs(l.effect_amount))
      || (typeof l.effect_per_source_change === 'number' && l.effect_per_source_change !== 0 && isWritten(Math.abs(l.effect_amount / l.effect_per_source_change)))
      || collapsesUserFigures(l, brief)));
  const quantities: { label: string; provenance: string; level: boolean }[] = [
    ...candidate.factors.map((f) => ({ label: f.label, provenance: f.provenance, level: f.baseline_known === true })),
    ...candidate.risks.map((r) => ({ label: r.label, provenance: r.provenance, level: false })),
    ...candidate.outcomes.map((o) => ({ label: o.label, provenance: o.provenance, level: false })),
  ];
  const candidates = quantities.filter((q) => k(q.label) !== k(goal) && q.provenance !== 'explicit' && !q.level
    && !setByOption.has(k(q.label)) && !inIdentity.has(k(q.label)) && !briefFigureAt(q.label) && briefSupport(q.label, brief) <= 0.5
    && !keep(q.label) && reachesGoal(candidate, q.label));
  // ⛔ An OPTION's own way to the goal is never cut (MC 21 corpus measure, 6 Oct: dental ‘Appointment awareness’, the
  // investor brief's ‘Enterprise deals won’ for "lift our enterprise win rate"): a node the option needs to reach the goal
  // is how the user's option works, said in other words. Where an option reaches the goal only through candidates, the
  // best-named of them are kept, one at a time, until it does; only side paths (a second, invented consequence) go.
  const levers = candidate.options.map((o) => [...(o.interventions ?? []).map((i) => i.factor_label), ...(o.changes ?? [])]);
  const keptForOptions = new Set<string>();
  const withoutCandidates = (): CandidateModel => {
    const out = new Set(candidates.map((q) => k(q.label)).filter((x) => !keptForOptions.has(x)));
    return { ...candidate, links: candidate.links.filter((l) => !out.has(k(l.from)) && !out.has(k(l.to))) };
  };
  const bySupport = [...candidates].sort((a, b) => briefSupport(b.label, brief) - briefSupport(a.label, brief));
  for (const ls of levers) {
    if (!ls.some((f) => reachesGoal(candidate, f))) continue;
    for (const q of bySupport) {
      if (ls.some((f) => reachesGoal(withoutCandidates(), f))) break;
      keptForOptions.add(k(q.label));
    }
  }
  // Only those added that the option actually runs through stay kept (a candidate added and not on its path is released).
  for (const x of [...keptForOptions]) {
    keptForOptions.delete(x);
    const stillConnected = levers.every((ls) => !ls.some((f) => reachesGoal(candidate, f)) || ls.some((f) => reachesGoal(withoutCandidates(), f)));
    if (!stillConnected) keptForOptions.add(x);
  }
  const unsupported = candidates.filter((q) => !keptForOptions.has(k(q.label)));
  // (`keep`: the caller's identities still to be minted, `rate-count-product.ts` and the reconciling product: an operand
  // a mint will multiply is never a mechanism to drop, Desk 6b.)
  const mechanisms: UnmodelledMechanism[] = unsupported.map((q) => {
    const sign = pathSign(candidate, q.label);
    return { label: q.label, goal, direction: sign === 1 ? 'raise' : sign === -1 ? 'lower' : null };
  });
  const gone = new Set(unsupported.map((q) => k(q.label)));
  let links = candidate.links.filter((l) => !gone.has(k(l.from)) && !gone.has(k(l.to)));
  // Rule 3 (d5 (3)): on a revenue goal, a cost QUANTITY's link into the goal is dropped and said. A lever is never one: a
  // quantity an option sets or a controllable factor is something the user spends to move revenue (Desk 6b).
  const costs: CostOffRevenue[] = [];
  const controllable = new Set(candidate.factors.filter((f) => f.role === 'controllable').map((f) => k(f.label)));
  if (isRevenueGoal(goal)) {
    // A cost quantity that reached the revenue only through a mechanism taken out (d1: ‘Starter support cost’ fed ‘service
    // degradation’) is kept, and said the same way: the user's figure stays in the model, and why it moves no revenue.
    const after = { ...candidate, links };
    for (const q of quantities) {
      if (gone.has(k(q.label)) || !isCostQuantity(q.label) || setByOption.has(k(q.label)) || controllable.has(k(q.label))) continue;
      if (reachesGoal(candidate, q.label) && !reachesGoal(after, q.label)) costs.push({ cost: q.label, goal });
    }
    // ACCOUNTING only (DL ruling on Desk 6b (3)): the cost subtracted £-for-£ from the revenue, drawn negative and unsized
    // or ±1 per 1. A cost link with any other size is a causal claim and is kept.
    const accounting = (l: CandidateModel['links'][number]): boolean => l.direction === 'negative'
      && (typeof l.effect_amount !== 'number' || (typeof l.effect_per_source_change === 'number' && l.effect_per_source_change !== 0
        && Math.abs(l.effect_amount / l.effect_per_source_change) === 1));
    const costLinks = links.filter((l) => k(l.to) === k(goal) && isCostQuantity(l.from) && !setByOption.has(k(l.from))
      && !controllable.has(k(l.from)) && accounting(l));
    for (const l of costLinks) if (!costs.some((c) => k(c.cost) === k(l.from))) costs.push({ cost: l.from, goal });
    links = links.filter((l) => !costLinks.includes(l));
  }
  if (gone.size === 0 && costs.length === 0) return { model: candidate, mechanisms, costs };
  return {
    model: {
      ...candidate,
      factors: candidate.factors.filter((f) => !gone.has(k(f.label))),
      risks: candidate.risks.filter((r) => !gone.has(k(r.label))),
      outcomes: candidate.outcomes.filter((o) => !gone.has(k(o.label))),
      links,
    },
    mechanisms, costs,
  };
}

/** d5's challenge, said where the user sees it (`open_questions`) and where the Agent reads it (`not_represented`). */
export function unmodelledMechanismChallenge(m: UnmodelledMechanism): string {
  const moves = m.direction === null ? 'change' : m.direction;
  return `Olumi hasn’t modelled ‘${m.label}’; it could ${moves} ‘${m.goal}’. Add it and say roughly how much if you think it matters.`;
}

/** Rule 3's statement (`not_represented` only: a statement, never one of the two visible question slots). */
export function costOffRevenueLine(c: CostOffRevenue): string {
  return `‘${c.cost}’ is a cost, so it doesn’t change ‘${c.goal}’; it would matter for profit.`;
}

/** One collapsed user chain the repair retry is asked to draw as the user wrote it (d4; Science d5 (2), DL ruling 6 Oct). */
export interface CollapsedChain {
  /** The drafted quantity that carries the product ("MRR lost to price-driven churn"). */
  readonly through: string;
  readonly from: string;
  /** |size| per one of `from`: the product of the two figures. */
  readonly product: number;
  /** The two brief sentences whose figures multiply to it, in brief order. */
  readonly sentences: readonly [string, string];
}

/**
 * Every link whose Olumi size is the product of two figures written in two DIFFERENT brief sentences (`collapsesUserFigures`),
 * with the sentences: the repair retry is asked to draw each as its own link, sized by its own figure, and never the
 * product as well (a double count).
 */
export function collapsedChains(candidate: CandidateModel, brief: string): CollapsedChain[] {
  const out: CollapsedChain[] = [];
  for (const l of candidate.links) {
    // A chain runs THROUGH a quantity of Olumi's, never straight into the goal.
    if ((l.effect_provenance ?? null) === 'explicit' || typeof l.effect_amount !== 'number' || typeof l.effect_per_source_change !== 'number'
      || l.effect_per_source_change === 0 || k(l.to) === k(candidate.goal.metric) || out.some((c) => k(c.through) === k(l.to))) continue;
    const size = Math.abs(l.effect_amount / l.effect_per_source_change);
    const pair = perOnePairs(size, brief)[0];
    if (pair !== undefined) out.push({ through: l.to, from: l.from, product: size, sentences: pair });
  }
  return out;
}

/** The construction issue for one collapsed chain (the repair retry's words). */
export function collapsedChainIssue(c: CollapsedChain): string {
  return `The link from "${c.from}" to "${c.through}" multiplies two of the user's own statements into one figure: `
    + `"${c.sentences[0]}" and "${c.sentences[1]}". Draw them as the user wrote them: keep what the first one counts as its own `
    + `quantity, with one link for each statement, each sized by its own figure (effect_provenance "explicit"), and remove `
    + `"${c.through}" and its links, so the product is never drawn as well.`;
}

/**
 * Whether a retry draws a collapsed chain as the user's (DL: adopt ONLY then): both sentences are bound as the user's on
 * some registered link (`source_quote`), and no drafted link still carries the product (a double count).
 */
export function drawsChainAsTheUsers(c: CollapsedChain, retry: CandidateModel, registeredEdges: readonly { readonly provenance?: unknown }[]): boolean {
  const quotes = new Set(registeredEdges.map((e) => (typeof e.provenance === 'object' && e.provenance !== null ? (e.provenance as Record<string, unknown>).source_quote : undefined))
    .filter((q): q is string => typeof q === 'string'));
  const carriesProduct = retry.links.some((l) => typeof l.effect_amount === 'number' && typeof l.effect_per_source_change === 'number'
    && l.effect_per_source_change !== 0 && Math.abs(Math.abs(l.effect_amount / l.effect_per_source_change) - c.product) < 1e-9 * Math.max(1, c.product));
  return c.sentences.every((s) => quotes.has(s)) && !carriesProduct;
}
