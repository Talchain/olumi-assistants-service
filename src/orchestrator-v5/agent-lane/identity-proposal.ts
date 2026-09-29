/**
 * ⛔ THE CARD FOR A PRODUCT THE MINT COULD NOT PROVE (DL 5888399097; AIQ 5886967509 step (2); R3 served witness 5888379558).
 *
 * Served `ed49d44`, Paul's MRR brief ×5: 3/5 stored graphs had MRR's two parents as the user's own figures (£49, 1,500,
 * £75,000 reconciling within 5%) but the price written "£/month" / "GBP/month", with no per-item denominator. The silent
 * mint (`withReconcilingProductIdentity`) rightly refused: a product is the likely reading, not the only one. Each reply then
 * said £59 does not reach £85k.
 *
 * This reads the STORED graph and, where the same conditions hold, returns the reading for the user to confirm: the goal,
 * its rate and its count, and the arithmetic on the user's own stored figures. It is never a write. Runtime issues the
 * card from it (`propose_identity`); Canonical's approved-card door (#2292) writes the identity only when the user
 * presses exactly this reading. PURE: no model call, no store, no brief text (authorship is the stored `source`).
 *
 * Null (no card) unless ALL hold:
 *  · ONE goal, carrying no identity of its own, or only OLUMI's product reading over its two parents (`stated_in_brief:
 *    false`: FORK (iii), R3 5891486222 — every goal product Olumi derives, minted or drafter-declared, waits for this Yes);
 *  · its level is the user's (`classifyValueSource(observed_state.source) === 'user_stated'`), finite and non-zero;
 *  · EXACTLY TWO non-option parents, both factors whose levels are the user's, neither a product/sum carrier itself;
 *  · the parts reconcile with the goal within ISL's 5% (`RECONCILIATION_TOLERANCE`, one source with the mint);
 *  · the units compose as a money rate × a count into the goal's money per period (`unitsCompose`, one source with the
 *    mint), with or without the per-item denominator: the drafter's typed unit licenses nothing (AIQ 5891286280).
 */
import { RECONCILIATION_TOLERANCE, readMoneyTotal, unitsCompose } from './reconciling-product.js';
import { sayFigure } from './say-figure.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';

export interface IdentityProposal {
  readonly outcome_id: string;
  readonly operation: 'product';
  /** The rate's id, then the count's. */
  readonly factor_ids: readonly [string, string];
  /** The card's words: the reading, then the arithmetic on the user's stored figures. */
  readonly words: string;
}

/** The approved-card door's limit on the displayed words (Canonical #2292). */
export const CARD_WORDS_MAX = 400;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/**
 * The node's level when the USER stated it (AIQ 5888571809 (1)): in the brief or since (an edit, an override), by the
 * estate's ONE authorship reading (`classifyValueSource` → `user_stated`). Ratifying Olumi's figure is not stating one.
 */
function usersLevel(node: Rec): { value: number; unit: string } | null {
  const os = node.observed_state;
  if (!isRec(os) || classifyValueSource(os.source) !== 'user_stated') return null;
  const value = os.raw_value;
  const unit = text(os.unit);
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0 || unit === undefined) return null;
  return { value, unit };
}

/**
 * A node's stored figure and whose it is, or null when it holds none. `value` is the figure only where it reads as money
 * in the GOAL'S OWN currency AND period (`readMoneyTotal`); otherwise null, and the card neither says it nor sums it.
 * ⛔ PR Review 5894085840: "£1,500 per year" beside a monthly MRR is the same £ and a different quantity.
 */
function goalTermsLevel(node: Rec | undefined, goal: { code: string; period: 'month' | 'year' } | null): { value: number | null; users: boolean } | null {
  const os = node?.observed_state;
  if (!isRec(os) || typeof os.raw_value !== 'number' || !Number.isFinite(os.raw_value)) return null;
  const m = goal === null ? null : readMoneyTotal(os.unit, text(node?.label) ?? '');
  const inGoalTerms = m !== null && m.code === goal!.code && m.period === goal!.period;
  return { value: inGoalTerms ? os.raw_value : null, users: classifyValueSource(os.source) === 'user_stated' };
}

const carriesIdentity = (node: Rec): boolean => node.nonlinear_identity !== undefined && node.nonlinear_identity !== null;

/** Olumi's own product reading on the goal, awaiting the user's Yes (`stated_in_brief: false`): its factor ids, else null. */
function unconfirmedProduct(node: Rec): readonly string[] | null {
  const i = node.nonlinear_identity;
  if (!isRec(i) || i.operation !== 'product' || i.stated_in_brief !== false || !Array.isArray(i.factor_ids)) return null;
  return i.factor_ids.every((f) => typeof f === 'string') ? (i.factor_ids as string[]) : null;
}

export function proposeProductIdentity(graph: unknown): IdentityProposal | null {
  return proposeOnGoal(graph) ?? proposeOnCarrier(graph);
}

type Rec2 = Rec;
interface Level { readonly id: string; readonly label: string; readonly value: number; readonly unit: string }

/** The goal's level and its non-option parents, or null when there is not exactly one goal with the user's level. */
function goalAndParents(graph: unknown): { goal: Rec2; goalId: string; goalLabel: string; o: { value: number; unit: string }; byId: Map<string, Rec2>; parentIds: string[]; edges: Rec2[] } | null {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const goals = nodes.filter((n) => n.kind === 'goal');
  if (goals.length !== 1) return null;
  const goal = goals[0]!;
  const goalId = text(goal.id);
  const goalLabel = text(goal.label);
  const o = usersLevel(goal);
  if (goalId === undefined || goalLabel === undefined || o === null) return null;
  const byId = new Map(nodes.flatMap((n) => (typeof n.id === 'string' ? [[n.id, n] as const] : [])));
  const parentIds = [...new Set(edges.filter((e) => e.to === goalId && typeof e.from === 'string').map((e) => e.from as string))]
    .filter((id) => { const k = byId.get(id)?.kind; return k !== 'option' && k !== 'decision'; });
  return { goal, goalId, goalLabel, o, byId, parentIds, edges };
}

/** The user's two stated factors among `ids` (each a factor with the user's level and no identity of its own), or null. */
function usersFactors(ids: readonly string[], byId: Map<string, Rec2>): [Level, Level] | null {
  if (ids.length !== 2) return null;
  const parts = ids.map((id) => {
    const n = byId.get(id);
    const level = n !== undefined ? usersLevel(n) : null;
    return n !== undefined && n.kind === 'factor' && !carriesIdentity(n) && level !== null ? { id, label: text(n.label) ?? id, ...level } : null;
  });
  return parts[0] != null && parts[1] != null ? [parts[0], parts[1]] : null;
}

/** The card's reading of `p` × `q` as the goal's money per period, or null when the parts do not reconcile or compose. */
function reading(goal: Rec2, goalLabel: string, o: { value: number; unit: string }, p: Level, q: Level) {
  if (Math.abs(o.value - p.value * q.value) > RECONCILIATION_TOLERANCE * Math.abs(o.value)) return null;
  const goalUnit = text(goal.goal_threshold_unit) ?? o.unit;
  const c = unitsCompose(goalUnit, goalLabel, { unit: p.unit, label: p.id }, { unit: q.unit, label: q.id });
  // FORK (iii): composing units make the card, with or without the denominator; nothing is silent.
  if (c.kind === 'no') return null;
  return { rate: c.rate === p.id ? p : q, count: c.rate === p.id ? q : p, code: c.code };
}

/** The goal itself: its own two user-stated parents, bare or carrying only Olumi's reading over exactly them. */
function proposeOnGoal(graph: unknown): IdentityProposal | null {
  const g = goalAndParents(graph);
  if (g === null) return null;
  const { goal, goalId, goalLabel, o, byId, parentIds } = g;
  const own = unconfirmedProduct(goal);
  if (carriesIdentity(goal) && own === null) return null;
  if (parentIds.length !== 2) return null;
  // Olumi's reading must be over exactly these two parents: any other product is not this card's to confirm.
  if (own !== null && (own.length !== 2 || !own.every((f) => parentIds.includes(f)))) return null;
  const parts = usersFactors(parentIds, byId);
  if (parts === null) return null;
  const r = reading(goal, goalLabel, o, parts[0], parts[1]);
  if (r === null) return null;
  const money = (v: number): string => sayFigure(v, r.code);
  const words = `Is “${goalLabel}” your “${r.rate.label}” × “${r.count.label}”? `
    + `${money(r.rate.value)} × ${sayFigure(r.count.value, '')} = ${money(r.rate.value * r.count.value)}, close to your ${money(o.value)}. `
    // AIQ 5888571809: the card says what "Yes" does. It does NOT run anything: an approval runs nothing (Paul's ruling,
    // #63 5812069638; enforced server-side), so the Run stays the user's own press (Runtime 5888628288 option (b)).
    + `If yes, Olumi will calculate “${goalLabel}” that way, and you can run the analysis again.`;
  // Canonical #2292's door takes at most 400 characters of card words (5888513620): a card it would refuse is not issued.
  if (words.length > CARD_WORDS_MAX) return null;
  return { outcome_id: goalId, operation: 'product', factor_ids: [r.rate.id, r.count.id], words };
}

/**
 * ⛔ AIQ 5892754930 (3): a Yes makes the goal this carrier PLUS the goal's other parents, so the card names the first of
 * them (and how many more) and whose figure it is, from the graph. "That gives your £75,000" only where the figures add
 * up to the goal within ISL's 5%; otherwise the card says the goal also adds them, and claims no sum.
 * ⛔ PR Review 5894085840: a figure is said, and summed, only as money in the goal's own currency AND period. Any other
 * figure (another period, a per-item price, £k, another currency, a count or a %) is named by whose it is alone, and
 * no sum is claimed.
 */
function besideTheCarrier(others: readonly string[], byId: Map<string, Rec>, goalMoney: { code: string; period: 'month' | 'year' } | null, code: string, product: number, goal: number, goalLabel: string): string {
  const money = (v: number): string => sayFigure(v, code);
  const first = others[0];
  if (first === undefined) return `, close to your ${money(goal)} “${goalLabel}”.`;
  const levels = others.map((id) => goalTermsLevel(byId.get(id), goalMoney));
  const l = levels[0]!;
  const who = l === null ? 'no figure yet' : l.users ? 'your figure' : 'Olumi\'s estimate';
  const whose = l === null || l.value === null ? who : `${who}, ${money(l.value)}`;
  const named = `“${text(byId.get(first)?.label) ?? first}” (${whose})${others.length > 1 ? ` (and ${others.length - 1} more)` : ''}`;
  const sum = levels.every((x) => x !== null && x.value !== null) ? product + levels.reduce((t, x) => t + x!.value!, 0) : null;
  return sum !== null && Math.abs(sum - goal) <= RECONCILIATION_TOLERANCE * Math.abs(goal)
    ? `; with ${named} that gives your ${money(goal)} “${goalLabel}”.`
    : `, close to your ${money(goal)} “${goalLabel}”, which also adds ${named}.`;
}

/**
 * ⛔ AN ANSWERABLE WITHHOLD FOR A CARRIER BESIDE ANOTHER GOAL PARENT (DL owner call 5892120941; AIQ 5892069497's
 * measured dead end, 1/19 served Paul-brief goals: `pro_plan_mrr` = £49 × 1,500 beside a second parent of MRR).
 *
 * PLoT #420 (d) withholds the goal's chance when a goal parent carries Olumi's product in the card domain, but the goal
 * card above needs the goal's OWN two parents, so the user saw "…hasn't been confirmed…" with nothing to press. This
 * offers the same reading on that carrier: Olumi's stored product (`stated_in_brief: false`) over the carrier's own two
 * parents, both the user's stated factors, their product within ISL's 5% of the GOAL's stated level, the units composing
 * into the goal's money per period. Exactly ONE such carrier, or no card (two would be a guess). Nothing is folded and no
 * other parent is dropped: the Yes (Canonical's door) sets only the carrier's `stated_in_brief`. The goal card wins when
 * both could apply.
 */
function proposeOnCarrier(graph: unknown): IdentityProposal | null {
  const g = goalAndParents(graph);
  if (g === null || carriesIdentity(g.goal)) return null;
  const { goal, goalLabel, o, byId, parentIds, edges } = g;
  // The goal's own money per period, read as `reading` reads it: the terms another parent's figure must be in to be added.
  const goalMoney = readMoneyTotal(text(goal.goal_threshold_unit) ?? o.unit, goalLabel);
  const found: IdentityProposal[] = [];
  for (const id of parentIds) {
    const carrier = byId.get(id);
    // Any node kind PLoT #420's `goalCarrierIds` reads (served run 2's carrier is a FACTOR holding Olumi's £73,500).
    if (carrier === undefined) continue;
    const product = unconfirmedProduct(carrier);
    if (product === null || product.length !== 2) continue;
    const carrierParents = [...new Set(edges.filter((e) => e.to === id && typeof e.from === 'string').map((e) => e.from as string))]
      .filter((pid) => { const k = byId.get(pid)?.kind; return k !== 'option' && k !== 'decision'; });
    if (carrierParents.length !== 2 || !product.every((f) => carrierParents.includes(f))) continue;
    const parts = usersFactors(carrierParents, byId);
    if (parts === null) continue;
    const r = reading(goal, goalLabel, o, parts[0], parts[1]);
    if (r === null) continue;
    const carrierLabel = text(carrier.label) ?? id;
    const money = (v: number): string => sayFigure(v, r.code);
    const made = r.rate.value * r.count.value;
    const words = `Is “${carrierLabel}” your “${r.rate.label}” × “${r.count.label}”? `
      + `${money(r.rate.value)} × ${sayFigure(r.count.value, '')} = ${money(made)}${besideTheCarrier(parentIds.filter((p) => p !== id), byId, goalMoney, r.code, made, o.value, goalLabel)} `
      + `If yes, Olumi will calculate “${carrierLabel}” that way, and you can run the analysis again.`;
    if (words.length > CARD_WORDS_MAX) continue;
    found.push({ outcome_id: id, operation: 'product', factor_ids: [r.rate.id, r.count.id], words });
  }
  return found.length === 1 ? found[0]! : null;
}
