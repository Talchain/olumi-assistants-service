/**
 * ⭐ A LIMITED TOTAL OF SAME-UNIT LEVERS IS THEIR SUM — ONE shaping, for construction AND for the repair card of a graph
 * saved before it (DL 380e54 #85 5932495794 item 1; RCA item 2, DL ruling (ii) 5929790081; SEMANTIC MODEL SPEC §2).
 *
 * #2445 fixed CONSTRUCTION: `admitOnce` mints `nonlinear_identity: { operation: 'sum' }` on a limited total fed only by its
 * same-unit levers (`findSumTallies`, R3-2) and makes each part → total link its DEFINITION (A2). A graph SAVED BEFORE
 * #2445 has none of it: Paul's `96c6f5f4` total is a causal sink on guessed links at Olumi's 0%, while its parts hold his
 * 10% and 50%.
 *
 * ⛔ NEVER REPAIRED ON READ (the ruling, reversing the read-time instruction): "A read-time `repairSumTotals` silently
 * changes a VALUE, which makes a second hidden model. Instead: detect the broken total on read → ONE proposal card ('this
 * total should be the sum of its parts') → the user confirms → durable commit through the F1 write path → the Run goes
 * stale → rerun." So nothing here is called by a read path, and no reader is handed a graph other than the stored bytes.
 * {@link detectSumTotalRepair} is PURE: it reads the stored graph and returns the one repair a broken total needs, or
 * null. The Agent offers it as a card (`propose_sum_total_repair`, `agent-capabilities.ts`), and only the user's approval
 * writes it (`authorise_change` → `/graph/register`, CAS on the analysis hash the card was read on).
 *
 * The shaping lives HERE, once, and both callers use it, so the card proposes exactly what construction mints:
 *  · {@link sumTalliesToHold}: which totals are held as sums (`findSumTallies`, minus a node another declaration holds — a
 *    `product` wins — minus a total one of whose part links the USER sized);
 *  · {@link shapeSumParts}: each part → total link as its definition (+1 per 1, β = part frame ÷ total frame, certain, at
 *    the spread floor, `definitional`);
 *  · {@link detectSumTotalRepair} (the card only): the two above on a stored graph, plus the total's level = Σ its parts'
 *    levels (A3), and whether any of it CHANGES what a reader can see or compute. Shape-only differences stay silent.
 */
import { resolveMagnitudeFrame, type MagnitudeNode } from '../../cee/magnitude/link-effect.js';
import { LLM_STRENGTH_STD_FLOOR } from '../../cee/constants.js';
import { usersOwnLevel } from '../../orchestrator/context/placeholder-parts.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * ⭐ R3-2 — A LIMITED SPEND TALLY IS THE SUM OF ITS LEVERS (AIQ #72 5867700610 (a), on MG 5867674734).
 *
 * Served journey C: "…keep the extra spend under £30k over six months". The drafter holds a tally ("Total investment
 * spend") fed ONLY by the options' spend levers, each linked at the placeholder 0.5 × 0.8, so the model's total is a
 * guess that dilutes the real sum about 2.5×, and the limit is checked against that guess. The total IS the sum.
 *
 * A node is minted `nonlinear_identity: { operation: 'sum', factor_ids: <its levers>, stated_in_brief: false }` when
 * ALL of these hold (terminal or not):
 *  · a ≤ LEVEL limit names it (`operator` `<=`, `value_frame` `level`), and it is a quantity (factor or outcome) other
 *    than the goal;
 *  · it has ≥ 2 parents and EVERY parent is a lever (a controllable factor an option acts on). An option edge straight
 *    into it (R3-2b: the operands would be incomplete), an observable driver, or any other cause → no mint;
 *  · every parent's unit EQUALS the limit's unit (its own level's unit; trimmed, case and spacing folded). £ levers
 *    under a headcount limit, or hires under a £ limit (journey E: the sum of engineers is not the salary bill) → no
 *    mint;
 *  · no parent is drafted to LOWER it (a `negative` link): the sum would reverse that sign.
 * A node already carrying a declared product keeps it. Operands are in model order.
 *
 * Said ONCE, as Olumi's reading (`sumIdentityOpenQuestions`, in `open_questions`): "Olumi reads "<tally>" as "<a>" +
 * "<b>": Olumi's reading, not your figure; tell me if it includes other costs." ISL evaluates a declared identity
 * in place of its linear equation (MG code-read, `robustness_analyzer_v2.py`), so what the tally feeds reads the real
 * total; PLoT withdraws an inferred identity it cannot frame (variant (b)) — that is PLoT's, not construction's.
 */
export interface SumTally {
  readonly node_id: string;
  readonly label: string;
  readonly factor_ids: readonly string[];
}
const unitKey = (u: unknown): string | null =>
  typeof u === 'string' && u.trim() !== '' ? u.trim().toLowerCase().replace(/\s+/g, ' ') : null;
export function findSumTallies(
  nodes: readonly { id: string; kind?: string; label?: string; category?: string; observed_state?: unknown }[],
  edges: readonly { from: string; to: string; effect_direction?: string }[],
  goalConstraints: readonly { node_id?: string; operator?: string; value_frame?: string; unit?: string; provenance_unit_relabelled?: { pre_normalisation_unit?: unknown } }[],
): SumTally[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const optionSet = new Set(edges.filter((e) => byId.get(e.from)?.kind === 'option').map((e) => e.to));
  const out: SumTally[] = [];
  for (const q of nodes) {
    if (q.kind !== 'factor' && q.kind !== 'outcome') continue;
    const limits = goalConstraints.filter((c) => c.node_id === q.id && c.operator === '<=' && c.value_frame === 'level');
    if (limits.length === 0) continue;
    const into = edges.filter((e) => e.to === q.id);
    const parents = [...new Set(into.map((e) => e.from))];
    if (parents.length < 2) continue;
    // A lever drafted to LOWER the tally is not one of its addends: a sum would reverse that sign. No mint.
    if (into.some((e) => e.effect_direction === 'negative')) continue;
    if (!parents.every((p) => byId.get(p)?.kind === 'factor' && byId.get(p)?.category === 'controllable' && optionSet.has(p))) continue;
    const unitOf = (id: string): string | null => unitKey((byId.get(id)?.observed_state as { unit?: unknown } | undefined)?.unit);
    // ⛔ The sum is in the TALLY's own unit. Admission may relabel a percent limit's unit ("% of upcoming sprint" → "%",
    // `agent_lane_limit_pct_of_level_v1`), so the limit matches the tally by its stored unit OR the unit it was written in
    // (served 96c6f5f4: comparing the parts with the relabelled "%" minted nothing; joint RCA 5929651862 item 2).
    const tallyUnit = unitOf(q.id) ?? unitKey(limits[0]!.unit);
    const limitIsTallys = (c: (typeof limits)[number]): boolean => unitKey(c.unit) === tallyUnit
      || unitKey(c.provenance_unit_relabelled?.pre_normalisation_unit) === tallyUnit;
    if (tallyUnit === null || !limits.every(limitIsTallys) || !parents.every((p) => unitOf(p) === tallyUnit)) continue;
    out.push({ node_id: q.id, label: q.label ?? q.id, factor_ids: nodes.filter((n) => parents.includes(n.id)).map((n) => n.id) });
  }
  return out;
}

/**
 * A part → total link the USER sized: their own strength (`source: 'user_*'`, the link writer's `user_specified`) or a
 * size construction credits to them (`magnitude: 'user_stated'`, written only where the brief writes that link's figure).
 * ⛔ Such a total is NOT held as a sum, at construction or on the card: rewriting the user's stated size into "+1 per 1" would
 * overwrite their own figure with Olumi's reading of the structure, and minting the identity beside the user's link would
 * hold the total to a definition the user has contradicted. The total is left exactly as stored (its limit keeps the
 * honest withhold its parts earn), and the user can say whether it is the sum.
 */
function userSizedPartLink(e: { provenance?: unknown }): boolean {
  const p = isRec(e.provenance) ? e.provenance : undefined;
  return p !== undefined && (p.magnitude === 'user_stated' || (typeof p.source === 'string' && p.source.startsWith('user')));
}

/**
 * The totals to hold as sums on this structure: every `findSumTallies` tally that `declared` does not already hold (a
 * declared `product` wins), and none of whose part links the user sized ({@link userSizedPartLink}). Operands in model
 * order. Construction passes its own accepted products; the card passes the stored carrier.
 */
export function sumTalliesToHold(
  nodes: Parameters<typeof findSumTallies>[0],
  edges: readonly { from: string; to: string; effect_direction?: string; provenance?: unknown }[],
  goalConstraints: Parameters<typeof findSumTallies>[2],
  declared: (tally: SumTally) => boolean,
): SumTally[] {
  return findSumTallies(nodes, edges, goalConstraints).filter((t) => !declared(t)
    && !edges.some((e) => e.to === t.node_id && t.factor_ids.includes(e.from) && userSizedPartLink(e)));
}

/** A stable rendering for "is this edge already exactly its definition?" (key order is not meaning). */
const stableJson = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isRec(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/**
 * ⭐ RCA item 2 (DL ruling (ii) 5929790081; SEMANTIC MODEL SPEC A2): a held sum's parts are its DEFINITION, never causal
 * guesses. Each part → total link is +1 per 1 in the shared unit: β = the part's frame ÷ the total's frame (one unit of the
 * part is one unit of the total), certain (exists 1), at the spread floor and `definitional`. The sizer's domain judgement
 * is NOT applied: it assumes Olumi's spread (σ = β/2), and whether the parts can overrun the total is exactly what the
 * limit on the total checks. Even a Run that does not evaluate the identity then adds the parts up exactly, and the limit
 * is scored on the parts (`placeholder-parts.ts`). No frame on either end → the link is left as it was. A link already
 * exactly its definition is returned as it is (so a graph already in shape is detected as such).
 */
export function shapeSumParts<E extends { from: string; to: string }>(
  edges: readonly E[],
  sums: readonly SumTally[],
  magnitudeNodeOf: (id: string) => MagnitudeNode | undefined,
): E[] {
  const partsOf = new Map(sums.map((t) => [t.node_id, new Set(t.factor_ids)] as const));
  return edges.map((e) => {
    if (partsOf.get(e.to)?.has(e.from) !== true) return e;
    const source = magnitudeNodeOf(e.from);
    const target = magnitudeNodeOf(e.to);
    if (source === undefined || target === undefined) return e;
    const [partFrame, totalFrame] = [resolveMagnitudeFrame(source), resolveMagnitudeFrame(target)];
    const unit = target.unit ?? source.unit;
    if (typeof partFrame !== 'number' || typeof totalFrame !== 'number' || !(partFrame > 0) || !(totalFrame > 0) || typeof unit !== 'string') return e;
    const beta = partFrame / totalFrame;
    if (!(beta > 0 && beta <= 1)) return e;
    const { defaulted: _projection, ...edge } = e as E & { defaulted?: unknown; provenance?: Rec };
    // The identity is OLUMI'S reading (`stated_in_brief: false`), so the link's source is too: a drafter's `explicit`
    // (`brief_extraction`) would read, once `defaulted` is gone, as a user-stated material parameter (MG sweep N1).
    const { reasoning: _guess, source: _drafted, ...provenance } = (edge as { provenance?: Rec }).provenance ?? { source: 'cee_hypothesis' };
    const natural_effect = { amount: 1, amount_unit: unit, per_source_change: 1, per_source_change_unit: source.unit ?? unit,
      strength_mean: beta, strength_mean_frame: 'edge_strength' as const };
    const shaped = { ...edge, strength: { mean: beta, std: LLM_STRENGTH_STD_FLOOR }, exists_probability: 1, effect_direction: 'positive' as const,
      provenance: { ...provenance, source: 'cee_hypothesis', magnitude: 'olumi_estimate' as const, natural_effect, definitional: true as const } };
    return stableJson(shaped) === stableJson(e) ? e : (shaped as typeof shaped & E);
  });
}

/** A stored node as the frame rules read it (`MagnitudeNode`): its own fields, and the levels the options set on it. */
function storedMagnitudeNode(n: Rec, optionLevels: readonly number[]): MagnitudeNode {
  const os = isRec(n.observed_state) ? n.observed_state : undefined;
  const unit = typeof n.unit === 'string' && n.unit.trim() !== '' ? n.unit
    : typeof os?.unit === 'string' && os.unit.trim() !== '' ? os.unit : null;
  return {
    label: typeof n.label === 'string' ? n.label : String(n.id),
    kind: typeof n.kind === 'string' ? n.kind : undefined,
    scale_frame: n.scale_frame,
    observed_state: os as MagnitudeNode['observed_state'],
    goal_threshold_cap: n.goal_threshold_cap,
    goal_threshold_unit: n.goal_threshold_unit,
    unit,
    option_levels: optionLevels,
  };
}

/** Per node id, every level an option sets on it (normalised `value`, as `interventions` store it). */
function optionLevelsOf(nodes: readonly Rec[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const o of nodes) {
    if (o.kind !== 'option' || !isRec(o.interventions)) continue;
    for (const [id, v] of Object.entries(o.interventions)) {
      const level = finite(v) ? v : isRec(v) && finite(v.value) ? v.value : undefined;
      if (level !== undefined) out.set(id, [...(out.get(id) ?? []), level]);
    }
  }
  return out;
}

/** The stored `sum` carrier on a node, when it is one over exactly these operands. */
function holdsThisSum(n: Rec | undefined, operands: readonly string[]): boolean {
  const c = n?.nonlinear_identity;
  return isRec(c) && c.operation === 'sum' && Array.isArray(c.factor_ids) && c.factor_ids.length === operands.length
    && operands.every((id) => (c.factor_ids as unknown[]).includes(id));
}

/**
 * ONE repair of ONE total, as the card shows it and the approval writes it. `repaired_graph` is the stored graph with
 * exactly this total repaired (its identity, its part links, its level) and every other byte as stored.
 */
export interface SumTotalRepair {
  readonly total_id: string;
  readonly total_label: string;
  /** Operands in model order. */
  readonly part_ids: readonly string[];
  readonly part_labels: readonly string[];
  /** The total's own unit (the parts share it). */
  readonly unit: string;
  /** The total's stored level (its raw figure), or null when it holds none readable. */
  readonly level_before: number | null;
  /** Σ the parts' levels, in the total's unit: `raw_value` and the normalised `value` (÷ the total's frame). */
  readonly level_after: { readonly raw_value: number; readonly value: number; readonly unit: string };
  /** What the repair changes, each a reader-visible difference (never a shape-only one). */
  readonly changes: { readonly identity: boolean; readonly part_links: readonly string[]; readonly level: boolean };
  readonly repaired_graph: Rec;
}

/**
 * The fields of a part link a reader computes with or reads a verdict from, as one comparable string. Key order and
 * projection markers (`defaulted`, a drafted `reasoning`) are not among them. Shared with the card's read-back.
 */
export const sumPartLinkMeaning = (e: Rec): string => {
  const strength = isRec(e.strength) ? e.strength : {};
  const p = isRec(e.provenance) ? e.provenance : {};
  return stableJson({
    strength: { mean: strength.mean ?? null, std: strength.std ?? null },
    exists_probability: e.exists_probability ?? null,
    effect_direction: e.effect_direction ?? null,
    provenance: { source: p.source ?? null, magnitude: p.magnitude ?? null, definitional: p.definitional ?? null, natural_effect: p.natural_effect ?? null },
  });
};

/** Two levels are the same figure (a float's last bit is not a change anyone can see). */
const sameLevel = (a: unknown, b: number): boolean => finite(a) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

/**
 * ⭐ DETECT THE ONE REPAIR A BROKEN SUM TOTAL NEEDS (DL 380e54 #85 5932495794 item 1). Pure: reads the STORED graph,
 * writes nothing, returns null when no total needs one. A total is BROKEN when shaping it with the #2445 rule (the same
 * functions construction calls) would change what a reader can see or compute:
 *  · its `sum` identity over exactly its parts is missing;
 *  · a part link is not its definition — any of the fields a reader computes with or reads a verdict from
 *    ({@link sumPartLinkMeaning}: strength, existence, direction, source, magnitude, `definitional`, the natural effect) differs;
 *  · its stored level is not Σ its parts' levels (A3), in its own unit.
 * Shape-only differences — key order, a projection marker the shaping drops (`defaulted`, a drafted `reasoning`) — are
 * not a change anyone can see: they return null, and no card is offered (the ruling's "shape-only normalisation stays
 * silent" row).
 *
 * NOT offered (null), each leaving the total exactly as stored:
 *  · a total another declaration holds (a declared `product` wins; a `sum` over other operands is someone's statement);
 *  · a total one of whose part links the USER sized (`sumTalliesToHold`): their figure is never rewritten as "+1 per 1";
 *  · a total whose own level is the USER's figure and is not Σ its parts: the card would overwrite their number with
 *    Olumi's arithmetic. (Equal to Σ, their figure is kept and the identity and links may still be offered.)
 *  · a part with no frame or no level, or a total with no frame or no level: there is no "it becomes X" to show.
 * One total per card: the first broken one in model order. Once it is committed, the next read offers the next.
 */
export function detectSumTotalRepair(graph: unknown): SumTotalRepair | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  const nodes = graph.nodes as unknown[];
  const edges = graph.edges as unknown[];
  const nodeRecs = nodes.filter((n): n is Rec & { id: string } => isRec(n) && typeof n.id === 'string');
  const edgeRecs = edges.filter((e): e is Rec & { from: string; to: string } => isRec(e) && typeof e.from === 'string' && typeof e.to === 'string');
  const constraints = (Array.isArray(graph.goal_constraints) ? graph.goal_constraints : []).filter(isRec);
  if (constraints.length === 0) return null;
  const byId = new Map(nodeRecs.map((n) => [n.id, n] as const));
  const tallies = sumTalliesToHold(
    nodeRecs as Parameters<typeof findSumTallies>[0],
    edgeRecs as { from: string; to: string; effect_direction?: string; provenance?: unknown }[],
    constraints as Parameters<typeof findSumTallies>[2],
    (t) => byId.get(t.node_id)?.nonlinear_identity != null && !holdsThisSum(byId.get(t.node_id), t.factor_ids),
  );
  const levels = optionLevelsOf(nodeRecs);
  const frameNode = (id: string): MagnitudeNode | undefined => {
    const n = byId.get(id);
    return n === undefined ? undefined : storedMagnitudeNode(n, levels.get(id) ?? []);
  };
  for (const t of tallies) {
    const total = byId.get(t.node_id)!;
    const os = isRec(total.observed_state) ? total.observed_state : undefined;
    const totalNode = frameNode(t.node_id)!;
    const totalFrame = resolveMagnitudeFrame(totalNode);
    if (os === undefined || totalFrame === undefined || !(totalFrame > 0) || typeof totalNode.unit !== 'string') continue;
    // The parts' links as construction shapes them: each must come out as its definition, or there is no sum to offer.
    const partEdges = edgeRecs.filter((e) => e.to === t.node_id && t.factor_ids.includes(e.from));
    const shaped = shapeSumParts(partEdges, [t], frameNode);
    if (!shaped.every((e) => isRec(e.provenance) && e.provenance.definitional === true)) continue;
    // A3: Σ the parts' levels in the shared unit (raw, else normalised × the part's frame). A part with none → no figure.
    let sum = 0;
    let levelled = true;
    for (const id of t.factor_ids) {
      const p = isRec(byId.get(id)?.observed_state) ? byId.get(id)!.observed_state as Rec : undefined;
      const partFrame = resolveMagnitudeFrame(frameNode(id)!);
      const raw = finite(p?.raw_value) ? p!.raw_value : finite(p?.value) && partFrame !== undefined ? (p!.value as number) * partFrame : undefined;
      if (raw === undefined) { levelled = false; break; }
      sum += raw;
    }
    if (!levelled) continue;
    const value = sum / totalFrame;
    const storedRaw = finite(os.raw_value) ? os.raw_value : finite(os.value) ? os.value * totalFrame : null;
    const levelChanges = !(sameLevel(os.raw_value ?? storedRaw, sum) && sameLevel(os.value, value));
    if (levelChanges && usersOwnLevel(os)) continue;
    const identity = !holdsThisSum(total, t.factor_ids);
    const changedLinks = partEdges.filter((e, i) => sumPartLinkMeaning(e) !== sumPartLinkMeaning(shaped[i] as Rec)).map((e) => e.from);
    if (!identity && changedLinks.length === 0 && !levelChanges) continue;

    const shapedByEdge = new Map(partEdges.map((e, i) => [e, shaped[i]] as const));
    const { display_value: _stale, ...totalKept } = total;
    const repairedTotal: Rec = {
      ...(levelChanges ? totalKept : total),
      ...(identity ? { nonlinear_identity: { operation: 'sum', factor_ids: [...t.factor_ids], stated_in_brief: false } } : {}),
      ...(levelChanges
        ? { observed_state: { ...os, value, raw_value: sum, ...(finite(os.baseline) ? { baseline: value } : {}) } }
        : {}),
    };
    return {
      total_id: t.node_id,
      total_label: t.label,
      part_ids: [...t.factor_ids],
      part_labels: t.factor_ids.map((id) => (typeof byId.get(id)?.label === 'string' ? byId.get(id)!.label as string : id)),
      unit: totalNode.unit,
      level_before: storedRaw,
      level_after: { raw_value: sum, value, unit: totalNode.unit },
      changes: { identity, part_links: changedLinks, level: levelChanges },
      repaired_graph: {
        ...graph,
        nodes: nodes.map((n) => (n === total ? repairedTotal : n)),
        edges: edges.map((e) => (shapedByEdge.has(e as Rec & { from: string; to: string }) ? shapedByEdge.get(e as Rec & { from: string; to: string }) : e)),
      },
    };
  }
  return null;
}
