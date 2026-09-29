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
 *  · ONE goal, carrying no identity of its own;
 *  · its level is the user's (`observed_state.source === 'brief_extraction'`), finite and non-zero;
 *  · EXACTLY TWO non-option parents, both factors whose levels are the user's, neither a product/sum carrier itself;
 *  · the parts reconcile with the goal within ISL's 5% (`RECONCILIATION_TOLERANCE`, one source with the mint);
 *  · the units compose as a money rate × a count into the goal's money per period (`unitsCompose`, one source with the
 *    mint): with the per-item denominator ('proof', a graph stored before the mint) or without it ('confirm').
 */
import { RECONCILIATION_TOLERANCE, unitsCompose } from './reconciling-product.js';
import { sayFigure } from './say-figure.js';

export interface IdentityProposal {
  readonly outcome_id: string;
  readonly operation: 'product';
  /** The rate's id, then the count's. */
  readonly factor_ids: readonly [string, string];
  /** The card's words: the reading, then the arithmetic on the user's stored figures. */
  readonly words: string;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** The node's level when the USER stated it: raw value and unit. */
function usersLevel(node: Rec): { value: number; unit: string } | null {
  const os = node.observed_state;
  if (!isRec(os) || os.source !== 'brief_extraction') return null;
  const value = os.raw_value;
  const unit = text(os.unit);
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0 || unit === undefined) return null;
  return { value, unit };
}

const carriesIdentity = (node: Rec): boolean => node.nonlinear_identity !== undefined && node.nonlinear_identity !== null;

export function proposeProductIdentity(graph: unknown): IdentityProposal | null {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const goals = nodes.filter((n) => n.kind === 'goal');
  if (goals.length !== 1) return null;
  const goal = goals[0]!;
  const goalId = text(goal.id);
  const goalLabel = text(goal.label);
  const o = usersLevel(goal);
  if (goalId === undefined || goalLabel === undefined || o === null || carriesIdentity(goal)) return null;

  const byId = new Map(nodes.flatMap((n) => (typeof n.id === 'string' ? [[n.id, n] as const] : [])));
  const parentIds = [...new Set(edges.filter((e) => e.to === goalId && typeof e.from === 'string').map((e) => e.from as string))]
    .filter((id) => { const k = byId.get(id)?.kind; return k !== 'option' && k !== 'decision'; });
  if (parentIds.length !== 2) return null;
  const parts = parentIds.map((id) => {
    const n = byId.get(id);
    const level = n !== undefined ? usersLevel(n) : null;
    return n !== undefined && n.kind === 'factor' && !carriesIdentity(n) && level !== null
      ? { id, label: text(n.label) ?? id, ...level }
      : null;
  });
  if (parts[0] == null || parts[1] == null) return null;
  const [p, q] = [parts[0], parts[1]];
  if (Math.abs(o.value - p.value * q.value) > RECONCILIATION_TOLERANCE * Math.abs(o.value)) return null;

  const goalUnit = text(goal.goal_threshold_unit) ?? o.unit;
  const c = unitsCompose(goalUnit, goalLabel, { unit: p.unit, label: p.id }, { unit: q.unit, label: q.id });
  if (c.kind === 'no') return null;
  const rate = c.rate === p.id ? p : q;
  const count = c.rate === p.id ? q : p;
  const money = (v: number): string => sayFigure(v, c.code);
  const words = `Is “${goalLabel}” your “${rate.label}” × “${count.label}”? `
    + `${money(rate.value)} × ${sayFigure(count.value, '')} = ${money(rate.value * count.value)}, close to your ${money(o.value)}.`;
  return { outcome_id: goalId, operation: 'product', factor_ids: [rate.id, count.id], words };
}
