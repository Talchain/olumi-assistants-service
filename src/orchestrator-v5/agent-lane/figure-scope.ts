/**
 * WHOSE FIGURE — the add-factor / revise door's scope and the one "the user typed this figure" predicate, in a leaf module
 * so the chat node writers (`set_factor_value`, `edit_graph`'s stamp) read the SAME rule as the Agent's doors without
 * importing the Agent lane (AIQ #72 5882852814 on CEE #2273). `newFactorScopeIn` is moved here verbatim from
 * `runtime/agent-capabilities.ts`, which re-exports it.
 */
import { figureTheUserWroteFor, type EntityScope } from './stated-by-user.js';
import { factorUnitOf, unitPhraseFamily, unitsConflict } from './unit-conflict.js';

/**
 * ⛔ THE ADD-FACTOR DOOR'S SCOPE (PJ-E-FIG, DL CHANGES_REQUIRED on #2235): whose figure a NEW factor's value is. Target: the
 * new factor's own label. Others: every quantity in the model (`scopeIn`) PLUS the other new factors in this call — so on
 * "Senior engineers cost £120k a year each and juniors £65k a year each" a swap (senior 65000) or the £400k limit is never
 * this factor's. RIVALS (`EntityScope.rivals`): the others that could HOLD this figure. A factor measured in another kind
 * of unit ("New senior engineers hired", engineers, for a £ figure) and a risk (a likelihood, for any figure not a
 * percentage) cannot, so the words they share with the target ("senior") stay the target's; every word of their own
 * still marks a figure as not the target's. STRICT (`EntityScope.strict`): journey E's typed "£120,000 per senior engineer
 * and £65,000 per junior engineer" binds each figure to its owner, and a figure nobody's words own, among two or more, is refused.
 */
export function newFactorScopeIn(
  g: { readonly raw?: unknown; readonly nodes: readonly { readonly id?: unknown; readonly label?: unknown; readonly kind?: unknown; readonly observed_state?: unknown }[] },
  target: string,
  figureUnit: string,
  inCall: readonly { readonly label: string; readonly unit: string }[],
): EntityScope {
  const percentOrUnknown = ((f) => f === null || f === 'percent')(unitPhraseFamily(figureUnit));
  const quantities = g.nodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision' && typeof n.label === 'string' && n.label !== '' && n.label !== target);
  const siblings = inCall.filter((s) => s.label !== '' && s.label !== target);
  const couldHold = (n: (typeof quantities)[number]): boolean => (n.kind === 'risk' ? percentOrUnknown
    : n.kind !== 'factor' || unitsConflict(figureUnit, factorUnitOf(g.raw, n as { id?: unknown; observed_state?: unknown })) === null);
  return {
    target: [target],
    others: [...quantities.map((n) => n.label as string), ...siblings.map((s) => s.label)],
    rivals: [...quantities.filter(couldHold).map((n) => n.label as string), ...siblings.filter((s) => unitsConflict(figureUnit, s.unit) === null).map((s) => s.label)],
    // The strict reading (DL ruling on the #2235 re-review): this door alone; every other door reads as before.
    strict: true,
  };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * ⭐ A RESTATEMENT IS THE USER'S WHEN THEIR WORDS STATE IT (AIQ #72 5882852814, extending R11 5881277231: "authorship stays
 * one action away: the user TYPES the figure, even the same number"). A chat write that leaves the stored value unchanged
 * is authorship iff this turn's typed text grounds this figure for this factor ("set churn to 3.2%", "our churn is 3.2%"),
 * and review otherwise ("yes, keep it"). The figure is the one the user would type: `raw_value` where stored, else `value`.
 * Every miss under-claims (the figure stays whose it was, and the act is recorded as review).
 */
export function userTypedStoredFigure(
  graph: unknown,
  nodeId: string,
  figure: { readonly value?: unknown; readonly raw_value?: unknown; readonly unit?: unknown },
  userText: string | null | undefined,
): boolean {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const label = nodes.find((n) => n.id === nodeId)?.label;
  const said = typeof figure.raw_value === 'number' ? figure.raw_value : figure.value;
  if (typeof label !== 'string' || label === '' || typeof said !== 'number' || !Number.isFinite(said)) return false;
  const unit = typeof figure.unit === 'string' ? figure.unit : '';
  return figureTheUserWroteFor(said, unit, userText, newFactorScopeIn({ raw: graph, nodes }, label, unit, []));
}
