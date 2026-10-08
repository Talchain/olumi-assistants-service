/** RC5: ask about an order-of-magnitude scope/unit slip; never change the user's value. */
import type { Action } from '@talchain/schemas/boundary';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { statedGoalTargetOf } from '../goal-target/stated-goal-target.js';
import { identityConflictsWithScope } from './goal-scope.js';
import { proposeProductIdentity, todaysLevelFor } from './identity-proposal.js';
import { RECONCILIATION_TOLERANCE, unitsCompose } from './reconciling-product.js';
import { periodIn, readCount, readMoney, readMoneyTotal, sameUnit } from './same-unit.js';
import { sayFigure, sayFigureAsWritten } from './say-figure.js';

/** Science §(f): smaller gaps are plausible plans, so ask only at an order of magnitude. */
export const GOAL_COHERENCE_RATIO = 10;

export interface CoherenceAsk {
  readonly text: string;
  readonly controls: readonly [Action, Action];
  readonly ratio: number;
  readonly implied: number;
  readonly target: number;
}

type Rec = Record<string, unknown>;
interface Level { readonly node: Rec; readonly raw: number; readonly unit: string }
interface Product {
  readonly parts: readonly [Level, Level];
  readonly implied: number;
  readonly unconfirmed: boolean;
  readonly clause: string;
  /** Levelled definitional addends, said in order after the product ("+ £500", "− £1,000"). */
  readonly addendFigures: readonly string[];
}
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const words = (v: unknown): string | null => typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const twoFigures = (v: number): number => Number(v.toPrecision(2));

/** Native figures only. The existing today reader supplies its one-cause fallback, never a scale re-derivation. */
function levelFor(graph: unknown, node: Rec): Level | null {
  const today = typeof node.id === 'string' ? todaysLevelFor(graph, node.id) : null;
  if (today !== null) return { node, raw: today.raw, unit: today.unit };
  const os = isRec(node.observed_state) ? node.observed_state : undefined;
  if (os?.raw_value !== undefined) {
    const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
    const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
    // An outcome's Olumi projection is not today's count; preserve the today reader's refusal to copy it.
    if (node.kind === 'outcome' && classifyValueSource(os.source) !== 'user_stated'
      && edges.some((e) => e.to === node.id
        && nodes.some((n) => n.id === e.from && !['option', 'decision'].includes(String(n.kind))))) return null;
    const unit = words(os.unit);
    return finite(os.raw_value) && unit !== null ? { node, raw: os.raw_value, unit } : null;
  }
  return null;
}

/** Same native quantity, including money whose node label carries its period. */
function inUnit(unit: string, label: string, goalUnit: string, goalLabel: string): boolean {
  const a = readMoneyTotal(unit, label); const b = readMoneyTotal(goalUnit, goalLabel);
  if (a !== null || b !== null) return a !== null && b !== null && a.code === b.code && a.period === b.period;
  return sameUnit(unit, goalUnit);
}

/** §(e): a user's stated current level must reconcile; its absence is explicitly vacuous. */
function reconciles(graph: unknown, node: Rec, implied: number, unit: string): boolean {
  const os = isRec(node.observed_state) ? node.observed_state : undefined;
  if (classifyValueSource(os?.source) !== 'user_stated') return true;
  const level = levelFor(graph, node);
  const label = words(node.label) ?? '';
  return level !== null && inUnit(level.unit, label, unit, label)
    && Math.abs(level.raw - implied) <= RECONCILIATION_TOLERANCE * Math.abs(level.raw);
}

/** A single, coherent stored product over exactly its own parents. No new reading is guessed. */
function productFor(graph: unknown, node: Rec, parents: readonly string[], byId: Map<string, Rec>, unit: string): Product | null {
  const identity = isRec(node.nonlinear_identity) ? node.nonlinear_identity : undefined;
  if (identity?.operation !== 'product' || typeof identity.stated_in_brief !== 'boolean'
    || !Array.isArray(identity.factor_ids) || identity.factor_ids.length !== 2
    || new Set(identity.factor_ids).size !== 2
    || !identity.factor_ids.every((id) => typeof id === 'string' && parents.includes(id))
    || (identity.addends !== undefined && !Array.isArray(identity.addends)) || identityConflictsWithScope(node)) return null;
  // Science §(f) addendum 2 (8 Oct): today's level = A × B + every DEFINITIONAL addend with a stated level (signed).
  // Other parents are causal (they move the goal over the horizon, not define today) and are ignored. A levelless
  // addend is skipped. An addend outside the goal's parents or units fails closed.
  const addendIds = (Array.isArray(identity.addends) ? identity.addends : []) as unknown[];
  if (!addendIds.every((id) => typeof id === 'string' && parents.includes(id) && !(identity.factor_ids as unknown[]).includes(id))) return null;
  // Definitional contributions are also marked on EDGES (provenance.definitional, buddy r1 P1): they count with the edge's sign.
  const edgesIn = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec).filter((e) => e.to === node.id) : [];
  const edgeDefinitional = new Map<string, -1 | 1>();
  for (const e of edgesIn) {
    if (typeof e.from !== 'string' || (identity.factor_ids as unknown[]).includes(e.from) || addendIds.includes(e.from)) continue;
    if (!isRec(e.provenance) || e.provenance.definitional !== true) continue;
    const mean = isRec(e.strength) && finite(e.strength.mean) ? e.strength.mean : undefined;
    edgeDefinitional.set(e.from, e.effect_direction === 'negative' || (mean !== undefined && mean < 0) ? -1 : 1);
  }
  const [aId, bId] = identity.factor_ids as [string, string];
  const aNode = byId.get(aId); const bNode = byId.get(bId);
  if (aNode === undefined || bNode === undefined) return null;
  const a = levelFor(graph, aNode); const b = levelFor(graph, bNode);
  if (a === null || b === null) return null;
  const label = words(node.label);
  if (label === null || words(aNode.label) === null || words(bNode.label) === null) return null;
  // ⛔ A percentage is a rate of change or a share, never a count of the goal's units (buddy r2 P1): fail closed.
  if ([a.unit, b.unit].some((u) => /%|\bper\s*cent\b|\bpercent(age)?\b|\bpct\b/i.test(u))) return null;
  const c = unitsCompose(unit, label, { unit: a.unit, label: aId }, { unit: b.unit, label: bId });
  if (c.kind === 'no') return null;
  const [rate, count] = c.rate === aId ? [a, b] : [b, a];
  let addendSum = 0;
  const addendFigures: string[] = [];
  const contributions: Array<[string, -1 | 1 | 0]> = [...(addendIds as string[]).map((id) => [id, 0] as [string, 0]), ...edgeDefinitional];
  for (const [id, edgeSign] of contributions) {
    const addend = byId.get(id);
    if (addend === undefined) return null;
    const level = levelFor(graph, addend);
    if (level === null) {
      // Levelless = skipped (Science). A stated figure whose unit can't be read is NOT levelless: fail closed (buddy r1 P1).
      const os = isRec(addend.observed_state) ? addend.observed_state : undefined;
      if (os !== undefined && os.raw_value !== undefined && os.raw_value !== null) return null;
      continue;
    }
    if (!inUnit(level.unit, String(addend.label), unit, label)) return null;
    // A listed addend is added signed, as ISL adds it; an edge-marked one takes the edge's sign on its magnitude.
    const signed = edgeSign === 0 ? level.raw : edgeSign * Math.abs(level.raw);
    addendSum += signed;
    if (signed !== 0) addendFigures.push(`${signed < 0 ? '−' : '+'} ${sayFigureAsWritten(Math.abs(signed), readMoney(level.unit, String(addend.label))?.code ?? '')}`);
  }
  const implied = rate.raw * count.raw + addendSum;
  const unconfirmed = identity.stated_in_brief === false;
  if (!finite(implied) || implied < 0 || (unconfirmed && !reconciles(graph, node, implied, unit))) return null;
  return {
    parts: [rate, count], implied, unconfirmed, addendFigures,
    clause: `${label} = ${String(rate.node.label)} × ${String(count.node.label)} (Olumi's reading)`,
  };
}

export function goalCoherenceAsk(input: unknown, edited: { nodeId: string; previousRaw?: number }): CoherenceAsk | null {
  if (!isRec(input) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) return null;
  const nodes = input.nodes.filter(isRec).filter((n) => n.analysis_participation !== 'retained_excluded');
  const byId = new Map(nodes.flatMap((n) => typeof n.id === 'string' ? [[n.id, n] as const] : []));
  if (byId.size !== nodes.length) return null;
  const edges = input.edges.filter(isRec).filter((e) => byId.has(String(e.from)) && byId.has(String(e.to)));
  // ⛔ ONE VIEW (buddy r1 P1): every reader below, including the today-level fallback, sees only participating nodes.
  const graph: Rec = { ...input, nodes, edges };
  const parentsOf = (id: unknown): string[] => [...new Set(edges.filter((e) => e.to === id).map((e) => String(e.from)))]
    .filter((p) => !['option', 'decision'].includes(String(byId.get(p)?.kind)));
  const goals = nodes.filter((n) => n.kind === 'goal');
  if (goals.length !== 1) return null;
  // Older stored graphs may carry the card's one reading without a persisted identity. Read it without writing it.
  const proposed = proposeProductIdentity(graph);
  if (proposed !== null) {
    const outcome = byId.get(proposed.outcome_id);
    if (outcome !== undefined && outcome.nonlinear_identity == null) byId.set(proposed.outcome_id, {
      ...outcome, nonlinear_identity: { operation: 'product', factor_ids: [...proposed.factor_ids], stated_in_brief: false },
    });
  }
  const goal = byId.get(String(goals[0]!.id))!; const goalLabel = words(goal.label);
  const target = statedGoalTargetOf(graph, goal);
  if (goalLabel === null || target === null || target.value <= 0 || (target.frame !== undefined && target.frame !== 'level')) return null;
  const direction = target.held ?? (typeof goal.operator === 'string' ? goal.operator : undefined);
  const floor = direction === '>=' || direction === '>' || direction === 'at_least';
  const ceiling = direction === '<=' || direction === '<' || direction === 'at_most';
  if (!floor && !ceiling) return null;
  const os = isRec(goal.observed_state) ? goal.observed_state : undefined;
  const goalUnit = words(target.unit) ?? words(os?.unit);
  const editedNode = byId.get(edited.nodeId);
  const editedLevel = editedNode !== undefined ? levelFor(graph, editedNode) : null;
  const editedLabel = words(editedNode?.label);
  if (goalUnit === null || editedLevel === null || editedLabel === null) return null;
  // Asked once per value: re-entering the same figure (e.g. after answering Yes) asks nothing (Science §(f); buddy r1 P1).
  if (edited.previousRaw !== undefined && edited.previousRaw === editedLevel.raw) return null;
  const parents = parentsOf(goal.id);
  if (parents.length === 0) return null;
  const identity = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  let product: Product | null = null;
  let implied: number;
  let expression: string;
  const figure = (level: Level): string => sayFigureAsWritten(level.raw, readMoney(level.unit, String(level.node.label))?.code ?? '');

  if (identity?.operation === 'product') {
    product = productFor(graph, goal, parents, byId, goalUnit);
    if (product === null || !product.parts.some((p) => p.node.id === edited.nodeId)) return null;
    implied = product.implied;
    expression = [product.parts.map(figure).join(' × '), ...product.addendFigures].join(' ');
  } else {
    if (identity !== undefined && (identity.operation !== 'sum' || !Array.isArray(identity.factor_ids)
      || identity.factor_ids.length !== parents.length || !parents.every((id) => (identity.factor_ids as unknown[]).includes(id)))) return null;
    // A single product carrier may contribute to the goal's same-unit sum, including a sole carrier parent.
    const carriers = parents.filter((id) => isRec(byId.get(id)?.nonlinear_identity)
      && (byId.get(id)!.nonlinear_identity as Rec).operation === 'product');
    if (carriers.length > 1) return null;
    // ⛔ Same units are not a sum (buddy r1 P1): parents on ordinary causal links carry weighted effects. Add only under a
    // definitional `sum` identity, or read a sole product-carrier parent as the goal's own reading.
    // A product carrier on a causal link is not the goal's definition (buddy r2 P1): only a definitional `sum` adds.
    if (identity?.operation !== 'sum') return null;
    const levels: Level[] = [];
    const expressions: string[] = [];
    for (const id of parents) {
      const node = byId.get(id)!;
      let level: Level | null;
      if (carriers.includes(id)) {
        const carrierUnit = words(isRec(node.observed_state) ? node.observed_state.unit : undefined) ?? goalUnit;
        product = productFor(graph, node, parentsOf(id), byId, carrierUnit);
        if (product === null) return null;
        level = { node, raw: product.implied, unit: carrierUnit };
        expressions.push([product.parts.map(figure).join(' × '), ...product.addendFigures].join(' '));
      } else {
        level = levelFor(graph, node);
        if (level !== null) expressions.push(figure(level));
      }
      if (level === null || !inUnit(level.unit, String(node.label), goalUnit, goalLabel)) return null;
      levels.push(level);
    }
    if (!parents.includes(edited.nodeId) && !product?.parts.some((p) => p.node.id === edited.nodeId)) return null;
    if (product !== null && parents.length === 1 && identityConflictsWithScope({
      ...goal, nonlinear_identity: { operation: 'product', factor_ids: product.parts.map((p) => p.node.id) },
    })) return null;
    if (edges.some((e) => e.to === goal.id && parents.includes(String(e.from))
      && (e.effect_direction === 'negative' || (isRec(e.strength) && finite(e.strength.mean) && e.strength.mean < 0)))) return null;
    implied = levels.reduce((sum, level) => sum + level.raw, 0);
    expression = expressions.join(' + ');
    if (product?.unconfirmed && !reconciles(graph, goal, implied, goalUnit)) return null;
  }
  if (!finite(implied) || implied < 0) return null;
  if (product?.unconfirmed) {
    // §(e)'s exactly-one reading gate: two on-path products would be a guess.
    const onPath = new Set([String(goal.id)]);
    const queue = [String(goal.id)];
    for (let i = 0; i < queue.length; i += 1) for (const id of parentsOf(queue[i])) {
      if (!onPath.has(id)) { onPath.add(id); queue.push(id); }
    }
    if ([...byId.values()].filter((n) => onPath.has(String(n.id)) && isRec(n.nonlinear_identity)
      && n.nonlinear_identity.operation === 'product').length !== 1) return null;
  }
  const ratio = implied / target.value;
  if (!finite(ratio) || (floor ? ratio < GOAL_COHERENCE_RATIO : ratio > 1 / GOAL_COHERENCE_RATIO)) return null;
  const money = readMoney(goalUnit, goalLabel)?.code ?? goalUnit;
  // Two significant figures, never collapsed to "£0" by the two-decimal cap (buddy r1 P2).
  // Under a penny/cent the honest reading is "less than 0.01", never "£0" (buddy r2 P2).
  const sayTwo = (n: number): string => { const t = twoFigures(n); return t !== 0 && Math.abs(t) < 0.01 ? `less than ${sayFigure(0.01, money)}` : sayFigure(t, money); };
  const value = figure(editedLevel);
  const suffix = product?.unconfirmed ? `, if ${product.clause}` : '';
  // Science §(f) Q4 + addendum (8 Oct): a count asks about scope; money against a per-period goal may be a yearly figure;
  // any other figure asks plainly. Never guess one "real" value.
  const editedIsMoney = readMoney(editedLevel.unit, editedLabel) !== null || readMoney(editedLevel.unit, '') !== null;
  const scopeQuestion = readCount(editedLevel.unit) !== null ? 'or a different count, for example all users?'
    : editedIsMoney && periodIn(`${goalUnit} ${goalLabel}`) !== null ? 'or a different figure, for example a yearly figure?'
      : 'or a different figure?';
  // The at_most mirror says "less than a tenth" (always true at the trigger), never a fraction (addendum (1)).
  const comparison = floor
    ? `about ${ratio.toLocaleString('en-GB', { maximumSignificantDigits: 2 })} times your ${sayTwo(target.value)} target, so the goal would already be met${suffix}`
    : `less than a tenth of your ${sayTwo(target.value)} limit, so you'd already be well under it${suffix}`;
  return {
    text: `At ${expression}, ${goalLabel} today would be about ${sayTwo(implied)}, ${comparison}. `
      + `Is ${value} your ${editedLabel}, ${scopeQuestion}`,
    controls: [
      { id: `coherence-keep:${edited.nodeId}`, label: `Yes, ${value} ${editedLabel}`, message: `Yes, ${value} is right for '${editedLabel}'.` },
      { id: `coherence-change:${edited.nodeId}`, label: 'No, let me change it', message: `No, I'll change '${editedLabel}'.` },
    ],
    ratio, implied, target: target.value,
  };
}
