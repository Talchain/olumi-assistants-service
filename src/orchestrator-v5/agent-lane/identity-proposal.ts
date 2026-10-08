import { identityConflictsWithScope, scopeOf } from './goal-scope.js';
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
import { GAP_ROUNDING, RECONCILIATION_TOLERANCE, readMoneyTotal, sameUnit, unitsCompose } from './reconciling-product.js';
import { sayFigure } from './say-figure.js';
import { readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';

export interface IdentityProposal {
  readonly outcome_id: string;
  readonly operation: 'product';
  /** The existing cards put the rate first; a stored reading keeps its declared order. */
  readonly factor_ids: readonly [string, string];
  /** The card's exact reading; legacy cards also show the user's stored arithmetic. */
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
 * Another goal parent as the carrier card reads it: its UNIT first, then its figure (AIQ 5894530998 condition 1: a
 * figure-less "£/year" parent must refuse the card as a figured one does). `money`: the unit is money (any currency,
 * scale or period). `inGoalTerms`: a money TOTAL in the GOAL'S OWN currency AND period (`readMoneyTotal`). `figure`: the
 * stored level, or null when there is none. `users`: the figure is the user's own.
 * ⛔ PR Review 5894085840 / AIQ 5894306110 (B): "£1,500 per year" beside a monthly MRR is the same £ and a different
 * quantity. Money NOT in the goal's terms refuses the card (`proposeOnCarrier`), with a figure or without one.
 */
function otherParent(node: Rec | undefined, goal: { code: string; period: 'month' | 'year' } | null): { figure: number | null; money: boolean; inGoalTerms: boolean; users: boolean } {
  const os = isRec(node?.observed_state) ? node!.observed_state as Rec : undefined;
  const unit = text(os?.unit);
  const money = unit !== undefined && readCurrencyUnitWithQualifiers(unit).kind === 'currency';
  const m = money && goal !== null ? readMoneyTotal(unit, text(node?.label) ?? '') : null;
  const inGoalTerms = m !== null && m.code === goal!.code && m.period === goal!.period;
  const figure = typeof os?.raw_value === 'number' && Number.isFinite(os.raw_value) ? os.raw_value : null;
  return { figure, money, inGoalTerms, users: figure !== null && classifyValueSource(os?.source) === 'user_stated' };
}

const carriesIdentity = (node: Rec): boolean => node.nonlinear_identity !== undefined && node.nonlinear_identity !== null;

/** Olumi's own product reading on the goal, awaiting the user's Yes (`stated_in_brief: false`): its factor ids, else null. */
function unconfirmedProduct(node: Rec): readonly string[] | null {
  const i = node.nonlinear_identity;
  if (!isRec(i) || i.operation !== 'product' || i.stated_in_brief !== false || !Array.isArray(i.factor_ids)) return null;
  return i.factor_ids.every((f) => typeof f === 'string') ? (i.factor_ids as string[]) : null;
}

export function proposeProductIdentity(graph: unknown): IdentityProposal | null {
  return proposeOnGoal(graph) ?? proposeOnCarrier(graph) ?? proposeOnStoredReading(graph);
}

/**
 * GOAL-REACH build 1: the stored lock carries its own confirmation reading. Unlike the
 * legacy cards, this checks the definition without requiring a stated current goal level.
 * Science §(e) Q1.2 binds the goal's own parents, so a path through another node alone
 * cannot qualify. Callers check writability and dry-run the existing confirmation door.
 */
function proposeOnStoredReading(graph: unknown): IdentityProposal | null {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const goals = nodes.filter(n => n.kind === 'goal');
  if (goals.length !== 1) return null;
  const goal = goals[0]!;
  const goalId = text(goal.id);
  const goalLabel = text(goal.label);
  const ids = unconfirmedProduct(goal);
  // Condition 1: exactly one valid stored reading over two distinct existing factors.
  if (goalId === undefined || goalLabel === undefined || ids === null || ids.length !== 2 || ids[0] === ids[1]
    || goal.analysis_participation === 'retained_excluded' || identityConflictsWithScope(goal)) return null;
  const byId = new Map(nodes.flatMap(n => typeof n.id === 'string' ? [[n.id, n] as const] : []));
  const parts = ids.map(id => byId.get(id));
  if (parts.some(n => n === undefined || n.kind !== 'factor' || n.analysis_participation === 'retained_excluded')) return null;
  // Condition 2: the reading's factors are both direct parents (and therefore on the goal path).
  if (!ids.every(id => edges.some(e => e.edge_type !== 'bidirected' && e.from === id && e.to === goalId))) return null;
  const reachesGoal = (from: string): boolean => {
    const seen = new Set([from]); const queue = [from];
    for (let i = 0; i < queue.length; i += 1) {
      for (const e of edges) {
        if (e.edge_type === 'bidirected' || e.from !== queue[i] || typeof e.to !== 'string') continue;
        if (e.to === goalId) return true;
        const next = byId.get(e.to);
        if (next === undefined || next.analysis_participation === 'retained_excluded' || seen.has(e.to)) continue;
        seen.add(e.to); queue.push(e.to);
      }
    }
    return false;
  };
  // Codex r2 P2: a carrier kept out of the calculation (retained_excluded) is not a competing reading the Run sees.
  if (nodes.some(n => n !== goal && n.analysis_participation !== 'retained_excluded' && isRec(n.nonlinear_identity) && n.nonlinear_identity.operation === 'product'
    && typeof n.id === 'string' && reachesGoal(n.id))) return null;
  const [a, b] = parts as [Rec, Rec];
  const level = (n: Rec) => ({ unit: isRec(n.observed_state) ? text(n.observed_state.unit) : undefined, label: String(n.id) });
  const goalUnit = text(goal.goal_threshold_unit);
  // Condition 3: use the existing unit reader, including Science's £/month × count confirmation form.
  if (readMoneyTotal(goalUnit, goalLabel) === null || unitsCompose(goalUnit, goalLabel, level(a), level(b)).kind === 'no') return null;
  const current = usersLevel(goal);
  const currentState = isRec(goal.observed_state) ? goal.observed_state : undefined;
  // Science §(e) Q1.3 also covers a stated zero or unreadable current level; usersLevel's
  // legacy null for those must not turn a contradictory statement into an absent one.
  if (current === null && currentState !== undefined && classifyValueSource(currentState.source) === 'user_stated') return null;
  // Condition 4: a stated CURRENT level must reconcile at the factors' current raw values within the existing 5%.
  if (current !== null) {
    // Codex r1 P2: currency AND period read in the goal's own context ("Monthly recurring revenue" + GBP = £/month).
    const cm = readMoneyTotal(current.unit, goalLabel); const gm = readMoneyTotal(goalUnit, goalLabel);
    if (cm === null || gm === null || cm.code !== gm.code || cm.period !== gm.period) return null;
    const operands = [a, b].map(n => {
      const os = isRec(n.observed_state) ? n.observed_state : undefined;
      return typeof os?.raw_value === 'number' && Number.isFinite(os.raw_value) && text(os.unit) !== undefined
        ? { id: String(n.id), label: text(n.label) ?? String(n.id), value: os.raw_value, unit: text(os.unit)! } : null;
    });
    if (operands[0] === null || operands[1] === null || !Number.isFinite(operands[0]!.value * operands[1]!.value)
      || reading(goal, goalLabel, current, operands[0]!, operands[1]!) === null) return null;
  }
  const words = `Olumi reads ‘${goalLabel}’ as ‘${text(a.label) ?? ids[0]}’ × ‘${text(b.label) ?? ids[1]}’. Is that how you work it out?`;
  if (words.length > CARD_WORDS_MAX) return null;
  return { outcome_id: goalId, operation: 'product', factor_ids: [ids[0]!, ids[1]!], words };
}

type Rec2 = Rec;
interface Level {
  readonly id: string; readonly label: string; readonly value: number; readonly unit: string;
  /** Read at TODAY's level through the user's own figure on this node's one levelled cause (`todaysOperand`): its label. */
  readonly today?: string;
}

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
  const scope = scopeOf(goal.goal_scope);
  if (scope?.extent === 'total' && scope.component && identityConflictsWithScope({ ...goal, nonlinear_identity: { operation: 'product', factor_ids: [scope.component.rate_id, scope.component.count_id] } })) return null;
  const byId = new Map(nodes.flatMap((n) => (typeof n.id === 'string' ? [[n.id, n] as const] : [])));
  const parentIds = [...new Set(edges.filter((e) => e.to === goalId && typeof e.from === 'string').map((e) => e.from as string))]
    // A node kept out of the calculation (`retained_excluded`) is not a parent the analysis sees: the run guard hands PLoT
    // the model without it and its links (DL 5916217417), so the card reads the same parents the analysis does.
    .filter((id) => { const n = byId.get(id); return n?.kind !== 'option' && n?.kind !== 'decision' && n?.analysis_participation !== 'retained_excluded'; });
  return { goal, goalId, goalLabel, o, byId, parentIds, edges };
}

/** The user's two stated factors among `ids` (each a factor with the user's level and no identity of its own), or null. */
function usersFactors(ids: readonly string[], byId: Map<string, Rec2>): [Level, Level] | null {
  if (ids.length !== 2) return null;
  const parts = ids.map((id) => usersFactor(id, byId));
  return parts[0] != null && parts[1] != null ? [parts[0], parts[1]] : null;
}

/** One user-stated factor (the user's level, no identity of its own), or null. */
function usersFactor(id: string, byId: Map<string, Rec2>): Level | null {
  const n = byId.get(id);
  const level = n !== undefined ? usersLevel(n) : null;
  return n !== undefined && n.kind === 'factor' && !carriesIdentity(n) && level !== null ? { id, label: text(n.label) ?? id, ...level } : null;
}

/**
 * ⛔ AN OPERAND WITH NO LEVEL IS READ AT TODAY'S LEVEL THROUGH THE USER'S OWN FIGURE (R3 5904253749 served `ef042ce` m1;
 * AIQ 5904406904: "the card must name the user's TODAY 1,500, not the month-12 outcome"; DL 5904403673).
 *
 * m1: the drafter read MRR as ‘Pro plan price’ × ‘Paying subscribers at 12 months’, an outcome with no level whose causes
 * are the user's 1,500 ‘Current paying subscribers’ and Olumi's churn and new-subscriber guesses. The card needs the
 * user's levels, so there was none, and #416 withheld with nothing to press. Today that outcome IS the user's count, so
 * the reading is checked, and said, on £49 × 1,500. Only where Olumi's own product over exactly these parents is stored
 * (never a new reading), and only for a node with no level of its own and EXACTLY ONE cause carrying the user's level: a
 * plain factor with no identity. Two such causes (which is today's?) or an Olumi level on the node: no card, as before.
 */
function todaysOperand(id: string, byId: Map<string, Rec2>, edges: readonly Rec2[]): Level | null {
  const t = todaysCause(id, byId, edges);
  return t === null ? null : { id, label: text(t.n.label) ?? id, ...t.level, today: text(t.f.label) ?? String(t.f.id) };
}

/** The ONE user-levelled cause `todaysOperand` reads an operand through (the node, the cause, its level), or null. */
function todaysCause(id: string, byId: Map<string, Rec2>, edges: readonly Rec2[]): { n: Rec2; f: Rec2; level: { value: number; unit: string } } | null {
  const n = byId.get(id);
  if (n === undefined || (n.kind !== 'outcome' && n.kind !== 'factor') || carriesIdentity(n)) return null;
  const os = isRec(n.observed_state) ? n.observed_state : undefined;
  const causes = [...new Set(edges.filter((e) => e.to === id && typeof e.from === 'string').map((e) => e.from as string))]
    .filter((c) => { const k = byId.get(c)?.kind; return k !== 'option' && k !== 'decision'; });
  const levelled = causes.flatMap((c) => {
    const f = byId.get(c);
    const level = f !== undefined ? usersLevel(f) : null;
    return f !== undefined && level !== null ? [{ f, level }] : [];
  });
  if (levelled.length !== 1) return null;
  const { f, level } = levelled[0]!;
  if (f.kind !== 'factor' || carriesIdentity(f)) return null;
  // ⛔ AIQ 5906371639 (R3 share-build `bdc4ff54`): a level of its OWN is Olumi's projection, so no card — EXCEPT an Olumi
  // level that is an EXACT copy of that one user-levelled cause (1,500 = the user's "Current paying subscribers"). The card
  // still credits the user's cause, never this node; its own level stays Olumi's and a Yes does not re-author it.
  // ⛔ AIQ 5906521706 (P0 PARTNER row E): an exact copy is the same figure in the SAME UNIT. 1,500 "customers" beside the
  // user's 1,500 "subscribers" may count another population (free or non-Pro), so the value match proves nothing: no card.
  if (typeof os?.raw_value === 'number' && (classifyValueSource(os.source) === 'user_stated' || os.raw_value !== level.value
    || !sameUnit(os.unit, level.unit))) return null;
  return { n, f, level };
}

/**
 * ⛔ THE FRAME OF AN OPERAND READ AT TODAY'S LEVEL (R3 5907594976, served CEE `de6c642`; DL 5907621115; AIQ 5907618307).
 * m1: after the Yes on "MRR = ‘Pro plan price’ × ‘Paying subscribers at 12 months’", the Run was BLOCKED
 * (`IDENTITY_FRAME_MISSING`): the month-12 count is an OUTCOME with no cap, `scale_frame` or value/raw pair, and ISL
 * refuses an identity part with no `execution_frame`. The card read it through its ONE user cause ("Current paying
 * subscribers", 1,500 of 10,000); that cause's RANGE is the operand's, the same quantity at another time. A range only,
 * never a level: 1,500 stays today's figure and the month-12 count is the Run's. Null unless `todaysOperand` would read
 * the node (exactly one user-levelled cause) and that cause carries a frame (cap → `scale_frame` → the value/raw pair).
 */
export function todaysFrameFor(graph: unknown, id: string): number | null {
  return todaysLevelFor(graph, id)?.frame ?? null;
}

/**
 * ⛔ AND ITS TODAY LEVEL: the figure the pressed card showed (R3 CR 5908327529: ISL's structural rule 2 needs every identity
 * part to have a status-quo level, so a range alone still left the Run blocked, `identity_operand_missing`; AIQ ruling
 * 5908364515 revises "never a level" for exactly this case). The card said "Today that is £49 × 1,500 (your ‘Current
 * paying subscribers’)", so writing that 1,500 as the part's TODAY level makes the consent text the value consumed. Exactly
 * the ONE user cause's level and unit, stamped with the cause's OWN user source (never `user_confirmed`, never Olumi's);
 * null when the cause is not the user's, or no safe range exists (the no-clip guard below). The month-12 count stays the
 * Run's.
 */
export function todaysLevelFor(graph: unknown, id: string): { raw: number; unit: string; source: string; frame: number } | null {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const byId = new Map(nodes.flatMap((n) => (typeof n.id === 'string' ? [[n.id, n] as const] : [])));
  const t = todaysCause(id, byId, edges);
  if (t === null) return null;
  const os = isRec(t.f.observed_state) ? t.f.observed_state : undefined;
  const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  // ⛔ R3 5907677185: a copied frame is a RANGE the engine normalises by, so it must not CLIP the later count (MRR would be
  // silently UNDER-stated). Only a frame at least TWICE today's level, never one derived as headroom over a target; else
  // no frame, and today's ask stays.
  if ([os?.cap_origin, os?.frame_origin, t.f.frame_origin].includes('target_derived_headroom')) return null;
  const [value, raw] = [os?.value, os?.raw_value];
  const frame = pos(os?.cap) ? os.cap : pos(t.f.scale_frame) ? t.f.scale_frame : pos(value) && pos(raw) && raw > value ? raw / value : null;
  const source = text(os?.source);
  if (frame === null || frame < 2 * Math.abs(t.level.value) || source === undefined) return null;
  return { raw: t.level.value, unit: t.level.unit, source, frame };
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

/**
 * "£49 × 1,500", with "(your “<figure>”)" after the operand read at today's level — the rate's or the count's, whichever
 * carries it (AIQ 5905014617: never the price's label on the subscribers' 1,500).
 */
function todaysFigures(r: { readonly rate: Level; readonly count: Level }, money: (v: number) => string): string {
  const yours = (l: Level): string => (l.today !== undefined ? ` (your “${l.today}”)` : '');
  return `${money(r.rate.value)}${yours(r.rate)} × ${sayFigure(r.count.value, '')}${yours(r.count)}`;
}

/** One of the two parents is the user's stated factor, the other an operand read at today's level (`todaysOperand`). */
function usersFactorBesideTodaysOperand(ids: readonly string[], byId: Map<string, Rec2>, edges: readonly Rec2[]): [Level, Level] | null {
  if (ids.length !== 2) return null;
  for (const [a, b] of [[ids[0]!, ids[1]!], [ids[1]!, ids[0]!]] as const) {
    const users = usersFactor(a, byId);
    const today = todaysOperand(b, byId, edges);
    if (users !== null && today !== null) return [users, today];
  }
  return null;
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
  const parts = usersFactors(parentIds, byId) ?? (own !== null ? usersFactorBesideTodaysOperand(parentIds, byId, g.edges) : null);
  if (parts === null) return null;
  const r = reading(goal, goalLabel, o, parts[0], parts[1]);
  if (r === null) return null;
  const money = (v: number): string => sayFigure(v, r.code);
  const today = r.count.today ?? r.rate.today;
  const figures = todaysFigures(r, money);
  // AIQ 5904696715: an operand read at today's level is Olumi's outcome, not the user's, so the reading is not "your" one.
  const words = `Is “${goalLabel}” ${today !== undefined ? '' : 'your '}“${r.rate.label}” × “${r.count.label}”? `
    + `${today !== undefined ? 'Today that is ' : ''}${figures} = ${money(r.rate.value * r.count.value)}, close to your ${money(o.value)}. `
    // AIQ 5888571809: the card says what "Yes" does. It does NOT run anything: an approval runs nothing (Paul's ruling,
    // #63 5812069638; enforced server-side), so the Run stays the user's own press (Runtime 5888628288 option (b)).
    + `If yes, Olumi will calculate “${goalLabel}” that way, and you can run the analysis again.`;
  // Canonical #2292's door takes at most 400 characters of card words (5888513620): a card it would refuse is not issued.
  if (words.length > CARD_WORDS_MAX) return null;
  return { outcome_id: goalId, operation: 'product', factor_ids: [r.rate.id, r.count.id], words };
}

/**
 * Olumi's gap plug beside a carrier, read on the stored graph exactly as `withoutGapResidual` reads it on a draft: money in
 * the goal's own terms that is NOT the user's, sized to the gap within 0.5% of the goal's level, with no cause of its own
 * and its only link into the goal.
 */
function gapPlugBeside(id: string, byId: Map<string, Rec>, edges: readonly Rec[], goalMoney: { code: string; period: 'month' | 'year' } | null, gap: number, o: number): boolean {
  const p = otherParent(byId.get(id), goalMoney);
  if (!p.inGoalTerms || p.users || p.figure === null) return false;
  if (Math.abs(p.figure - gap) > GAP_ROUNDING * Math.abs(o)) return false;
  return !edges.some((e) => e.to === id) && edges.filter((e) => e.from === id).length === 1;
}

/**
 * ⛔ AIQ 5892754930 (3): a Yes makes the goal this carrier PLUS the goal's other parents, so the card names the first of
 * them (and how many more) and whose figure it is, from the graph. "That gives your £75,000" only where the figures add
 * up to the goal within ISL's 5%; otherwise the card says the goal also adds them, and claims no sum.
 * ⛔ PR Review 5894085840: a figure is said, and summed, only as money in the goal's own currency AND period. Money in
 * any other terms never reaches here (the card is refused, AIQ 5894306110 (B)); a non-money parent (a count, a %, no
 * unit) is named by whose it is alone, as something the goal depends on, and no sum is claimed.
 */
function besideTheCarrier(others: readonly string[], byId: Map<string, Rec>, goalMoney: { code: string; period: 'month' | 'year' } | null, code: string, product: number, goal: number, goalLabel: string): string {
  const money = (v: number): string => sayFigure(v, code);
  const first = others[0];
  if (first === undefined) return `, close to your ${money(goal)} “${goalLabel}”.`;
  const parents = others.map((id) => otherParent(byId.get(id), goalMoney));
  const l = parents[0]!;
  const who = l.figure === null ? 'no figure yet' : l.users ? 'your figure' : 'Olumi\'s estimate';
  const whose = l.figure !== null && l.inGoalTerms ? `${who}, ${money(l.figure)}` : who;
  const named = `“${text(byId.get(first)?.label) ?? first}” (${whose})${others.length > 1 ? ` (and ${others.length - 1} more)` : ''}`;
  const sum = parents.every((x) => x.inGoalTerms && x.figure !== null) ? product + parents.reduce((t, x) => t + x.figure!, 0) : null;
  // ⛔ AIQ 5894530998 condition 2: only money in the goal's own terms is ADDED to it; anything else (a count, a %, a
  // node with no unit) is something the goal DEPENDS ON — a count is never said to be added to money.
  return sum !== null && Math.abs(sum - goal) <= RECONCILIATION_TOLERANCE * Math.abs(goal)
    ? `; with ${named} that gives your ${money(goal)} “${goalLabel}”.`
    : `, close to your ${money(goal)} “${goalLabel}”, which also ${l.inGoalTerms ? 'adds' : 'depends on'} ${named}.`;
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
    // The carrier always holds Olumi's stored reading here, so an unlevelled operand may be read at today's level (m8).
    const parts = usersFactors(carrierParents, byId) ?? usersFactorBesideTodaysOperand(carrierParents, byId, edges);
    if (parts === null) continue;
    const r = reading(goal, goalLabel, o, parts[0], parts[1]);
    if (r === null) continue;
    // ⛔ AIQ 5894306110 (B): REFUSE, not reword. A Yes makes the goal this carrier plus its other parents; money in another
    // period, an unreadable period, a per-item price, a scale or another currency would make that sum dimensionally
    // wrong, so the card would endorse a wrong structure. The carrier stays withheld (PLoT #420's no-card words).
    const others = parentIds.filter((p) => p !== id);
    if (others.some((pid) => { const p = otherParent(byId.get(pid), goalMoney); return p.money && !p.inGoalTerms; })) continue;
    const made = r.rate.value * r.count.value;
    // ⛔ AIQ 5905919190 (rule 5904836575): NO CARD BESIDE OLUMI'S GAP PLUG. On a graph built before #2343's construction
    // drop, Olumi's money parent sized to close the gap (o − a·b, as `withoutGapResidual` reads it) would be said to
    // "give your £75,000", which is circular, and a Yes would build the plug into the goal. The user's own figure of that
    // size, or an Olumi addend of any other size, keeps today's card (P0 PARTNER 5905933422 R2/R3).
    if (others.some((pid) => gapPlugBeside(pid, byId, edges, goalMoney, o.value - made, o.value))) continue;
    const carrierLabel = text(carrier.label) ?? id;
    const money = (v: number): string => sayFigure(v, r.code);
    const today = r.count.today ?? r.rate.today;
    const figures = todaysFigures(r, money);
    const words = `Is “${carrierLabel}” ${today !== undefined ? '' : 'your '}“${r.rate.label}” × “${r.count.label}”? `
      + `${today !== undefined ? 'Today that is ' : ''}${figures} = ${money(made)}${besideTheCarrier(others, byId, goalMoney, r.code, made, o.value, goalLabel)} `
      + `If yes, Olumi will calculate “${carrierLabel}” that way, and you can run the analysis again.`;
    if (words.length > CARD_WORDS_MAX) continue;
    found.push({ outcome_id: id, operation: 'product', factor_ids: [r.rate.id, r.count.id], words });
  }
  return found.length === 1 ? found[0]! : null;
}
