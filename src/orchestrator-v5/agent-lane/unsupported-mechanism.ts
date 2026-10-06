/**
 * ⭐ OLUMI'S OWN HYPOTHESIS NEVER SILENTLY CHANGES THE USER'S RESULT (G1b; Science d5 #87 6011168471, DL ruling 6 Oct; MC 21
 * ceiling #87 6011155077). On e7's #2644 witness, 2 of the 3 failed T1b drafts put a mechanism on the goal path that the
 * brief neither sizes nor says ("Starter-tier service degradation", "MRR lost to starter cannibalisation"). Their links
 * could only be Olumi's guess, so the first Run withheld every option's chance and asked the user to size Olumi's own idea.
 * Measured 0 LLM on the served graphs: an Olumi estimate on the same links is withheld 0/3 by P5 (by rule); left undrafted, 3/3.
 *
 *   · Rule 1: such a MECHANISM is not drafted onto the goal path. It is SAID, with d5's challenge, where the user sees it
 *     (`open_questions`) and where the Agent reads it (`not_represented`): surfacing it keeps the challenge without making
 *     the user size Olumi's guess. Only a RISK whose links out all go straight into the goal (the measured class); kept:
 *     anything the drafter marks as the brief's ('explicit', the only citation the candidate contract carries), anything a
 *     brief sentence names by more than half its content words, anything sized by a brief figure, set by an option,
 *     limited, or part of an identity, and anything whose removal would strand what the user can see.
 *   · Rule 3: a COST never feeds a REVENUE goal ("£6 a month in support" moves no revenue); it does feed a profit, margin or
 *     net goal. Its accounting link into the revenue is dropped; the cost side the cut leaves with no way to the goal goes
 *     with it, and that is said (`not_represented`: a statement, not a question).
 *   · Applied only where it unlocks per-option chances (`build-model.ts`, the trial admission).
 *
 * Construction only, on the candidate (labels), before admission. Pure.
 */
import { canonicalLabel, type CandidateModel } from './admit-model.js';
import { sameWord, wordsOf } from './stated-by-user.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { PERIOD_ADVERB_SPELLINGS, PERIOD_NOUN_SPELLINGS } from '../../utils/unit-alphabet.js';

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
/** A period word names no mechanism ("MONTHLY support cost"): the one unit alphabet's periods (PR-U1), never its metric words. */
const TIME = new Set([...Object.values(PERIOD_NOUN_SPELLINGS), ...Object.values(PERIOD_ADVERB_SPELLINGS)].flat()
  .filter((w) => !REVENUE.includes(w)));

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

/**
 * The cut, PROPOSED (the caller applies it only where it is what stands between the user and per-option chances:
 * `build-model.ts`, the trial admission). Pure.
 *
 * ⛔ SCOPED TO THE MEASURED CLASS (stand-in for MC 21, 6 Oct; CI on #2662 d6470c9a: 49 Required files red; corpus: every one
 * of the 29 true drops in 60 stored Acceptance/red-team drafts is a RISK whose only links out go straight into the goal).
 * A factor or outcome is structure (an operand, an addend, a count: ‘Pro subscribers’, ‘Other MRR’), never a mechanism this
 * rule takes; a risk with a link into anything but the goal is part of a chain the user's model reads (‘Price sensitivity’ →
 * ‘Monthly churn’, the user's own limit). Taking either stranded the user's quantities and blocked the Run.
 *
 * ⛔ NOTHING THE USER CAN SEE IS LEFT STRANDED (readiness refuses any node with no way to the goal, `NO_PATH_TO_GOAL`; on
 * #2662 d6470c9a the served d2 draft could no longer Run at all). A node the cut leaves with no way to the goal is taken
 * out WITH the cut only when it is the cost side of a revenue goal (a cost quantity, and what feeds only it), and that is
 * said (rule 3's line); anything else stranded (an option's lever, a limit, any other quantity) keeps the mechanism, as drafted.
 */
export function withoutUnsupportedMechanisms(candidate: CandidateModel, brief: string, keep: (label: string) => boolean = () => false): {
  readonly model: CandidateModel; readonly mechanisms: readonly UnmodelledMechanism[]; readonly costs: readonly CostOffRevenue[];
} {
  const goal = candidate.goal.metric;
  const setByOption = new Set(candidate.options.flatMap((o) => [...(o.interventions ?? []).map((i) => k(i.factor_label)), ...(o.changes ?? []).map(k)]));
  const inIdentity = new Set((candidate.identities ?? []).flatMap((i) => [k(i.outcome), ...i.factors.map(k)]));
  const limited = new Set((candidate.constraints ?? []).map((c) => k(c.metric)));
  const controllable = new Set(candidate.factors.filter((f) => f.role === 'controllable').map((f) => k(f.label)));
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
  // A side consequence: every link out of it goes straight into the goal (and there is one).
  const intoGoalOnly = (label: string): boolean => {
    const out = candidate.links.filter((l) => k(l.from) === k(label));
    return out.length > 0 && out.every((l) => k(l.to) === k(goal));
  };
  // On an option's way to the goal: only there is an unsized link one the user must size before the options' chances show
  // (P5 reads the links options reach). A risk no option reaches moves no option's chance and stays as drafted.
  const reached = new Set<string>(setByOption);
  for (const queue = [...setByOption]; queue.length > 0;) {
    const at = queue.shift()!;
    for (const l of candidate.links) if (k(l.from) === at && !reached.has(k(l.to))) { reached.add(k(l.to)); queue.push(k(l.to)); }
  }
  const risks = candidate.risks.filter((r) => k(r.label) !== k(goal) && r.provenance !== 'explicit' && r.analysis_participation !== 'retained_excluded'
    && !setByOption.has(k(r.label)) && !inIdentity.has(k(r.label)) && !limited.has(k(r.label)) && !briefFigureAt(r.label)
    && briefSupport(r.label, brief) <= 0.5 && !keep(r.label) && intoGoalOnly(r.label) && reached.has(k(r.label)));
  const revenue = isRevenueGoal(goal);
  const labels = [...candidate.factors, ...candidate.risks, ...candidate.outcomes].map((q) => q.label);
  const reachedBefore = new Set(labels.filter((l) => reachesGoal(candidate, l)).map(k));
  // A cost QUANTITY (rule 3): cost words, no spend-lever words, not set by an option, not a controllable lever.
  const costQuantity = (label: string): boolean => isCostQuantity(label) && !setByOption.has(k(label)) && !controllable.has(k(label));
  /**
   * The nodes a cut strands (reached the goal before, not after), or null when one of them must not be taken: anything
   * but the cost side of a revenue goal. The cost side is a cost quantity and whatever feeds only stranded nodes (d1's
   * ‘Support cost per starter subscriber’ into ‘Starter support cost’), never an option's lever, a controllable factor, a
   * limited quantity or an identity part outside the cost side.
   */
  const strands = (gone: ReadonlySet<string>, links: CandidateModel['links']): Set<string> | null => {
    const after = { ...candidate, links };
    const stranded = new Set(labels.filter((l) => !gone.has(k(l)) && reachedBefore.has(k(l)) && !reachesGoal(after, l)).map(k));
    if (stranded.size === 0) return stranded;
    if (!revenue) return null;
    for (const x of stranded) {
      if (setByOption.has(x) || controllable.has(x) || limited.has(x)) return null;
      if (costQuantity(labels.find((l) => k(l) === x)!)) continue;
      // A feeder of the cost side only: every link out of it ends in a stranded node.
      const out = links.filter((l) => k(l.from) === x);
      if (out.length === 0 || !out.every((l) => stranded.has(k(l.to)))) return null;
    }
    // At least one cost quantity heads what is stranded (a lone feeder chain is not a cost).
    return [...stranded].some((x) => costQuantity(labels.find((l) => k(l) === x)!)) ? stranded : null;
  };
  // Rule 1, one mechanism at a time, in drafted order: each is taken only if what it strands may go with it.
  const gone = new Set<string>();
  let links = [...candidate.links];
  for (const r of risks) {
    const tryGone = new Set([...gone, k(r.label)]);
    const tryLinks = links.filter((l) => !tryGone.has(k(l.from)) && !tryGone.has(k(l.to)));
    if (strands(tryGone, tryLinks) === null) continue;
    gone.add(k(r.label));
    links = tryLinks;
  }
  const mechanisms: UnmodelledMechanism[] = candidate.risks.filter((r) => gone.has(k(r.label))).map((r) => {
    const sign = pathSign(candidate, r.label);
    return { label: r.label, goal, direction: sign === 1 ? 'raise' : sign === -1 ? 'lower' : null };
  });
  // Rule 3 (d5 (3)), on a revenue goal: a cost QUANTITY's ACCOUNTING link into the goal (DL ruling on Desk 6b (3): the cost
  // subtracted £-for-£, drawn negative and unsized or ±1 per 1) is taken off. A cost link with any other size is a causal
  // claim and is kept; so is a spend LEVER (Desk 6b: "Ad spend → MRR").
  if (revenue) {
    const accounting = (l: CandidateModel['links'][number]): boolean => l.direction === 'negative'
      && (typeof l.effect_amount !== 'number' || (typeof l.effect_per_source_change === 'number' && l.effect_per_source_change !== 0
        && Math.abs(l.effect_amount / l.effect_per_source_change) === 1));
    for (const l of links.filter((x) => k(x.to) === k(goal) && costQuantity(x.from) && accounting(x) && reached.has(k(x.from)))) {
      const tryLinks = links.filter((x) => x !== l);
      if (strands(gone, tryLinks) === null) continue;
      links = tryLinks;
    }
  }
  const stranded = strands(gone, links) ?? new Set<string>();
  // Every cost quantity the cut takes off the revenue is said (d1's, which reached it only through a mechanism taken out,
  // and d2's, drawn straight into it).
  const costs: CostOffRevenue[] = labels.filter((l) => stranded.has(k(l)) && costQuantity(l)).map((cost) => ({ cost, goal }));
  if (gone.size === 0 && links.length === candidate.links.length) return { model: candidate, mechanisms: [], costs: [] };
  const out = new Set([...gone, ...stranded]);
  return {
    model: {
      ...candidate,
      factors: candidate.factors.filter((f) => !out.has(k(f.label))),
      risks: candidate.risks.filter((r) => !out.has(k(r.label))),
      outcomes: candidate.outcomes.filter((o) => !out.has(k(o.label))),
      links: links.filter((l) => !out.has(k(l.from)) && !out.has(k(l.to))),
      ...(candidate.identities !== undefined
        ? { identities: candidate.identities.filter((i) => !out.has(k(i.outcome)) && !i.factors.some((f) => out.has(k(f)))) } : {}),
    },
    mechanisms, costs,
  };
}

/** d5's challenge, said where the user sees it (`open_questions`) and where the Agent reads it (`not_represented`). */
export function unmodelledMechanismChallenge(m: UnmodelledMechanism): string {
  const moves = m.direction === null ? 'change' : m.direction;
  return `Olumi hasn’t modelled ‘${m.label}’; it could ${moves} ‘${m.goal}’. Add it and say roughly how much if you think it matters.`;
}

/**
 * Rule 3's statement (`not_represented` only: a statement, never one of the two visible question slots). Every cost the cut
 * takes off the revenue goal in ONE sentence (d5 6011168471: "Support costs … don't change monthly recurring revenue; they
 * would matter for profit"): d1 takes the per-subscriber cost and its total together.
 */
export function costOffRevenueLine(costs: readonly CostOffRevenue[]): string {
  const names = costs.map((c) => `‘${c.cost}’`);
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const goal = costs[0]?.goal ?? '';
  return names.length <= 1
    ? `${list} is a cost, so it doesn’t change ‘${goal}’; it would matter for profit.`
    : `${list} are costs, so they don’t change ‘${goal}’; they would matter for profit.`;
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
