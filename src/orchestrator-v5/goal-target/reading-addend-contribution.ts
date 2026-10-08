/**
 * GR2, Science §(e) addendum 4 / DL condition 3. ISL's identity_evaluations does
 * not expose an executed contribution. Read the central configuration from the
 * actual outbound PLoT graph instead. This is one executed central configuration,
 * not a claim about every Monte Carlo draw or the mean of nonlinear draws.
 *
 * Bound to ISL staging 82842bb80ed669224fe892dba7f03471b3b8ed70:
 * robustness_analyzer_v2.py :2483–2510 (_propagate), :2578–2581 (effective
 * mean × existence), :2631–2657 (_identity_value). LISTED A uses the signed
 * participant value in its frame; its outgoing edge is ignored. Non-listed L
 * uses the propagated parent × effective edge × GOAL frame. A stated goal
 * executes A−A_sq and L−L_sq. Unsupported input paths fail closed.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const CAUSAL = new Set(['factor', 'risk', 'outcome', 'goal']);
const observed = (n: Rec): Rec => isRec(n.observed_state) ? n.observed_state : {};
// ISL status_quo_level :1126: baseline first, then value; raw_value is not an operand level.
const heldLevel = (n: Rec): number | undefined => {
  const o = observed(n);
  const v = o.baseline ?? o.value;
  return finite(v) ? v : undefined;
};

/** PLoT resolveNodeFrame: observed cap → scale_frame → positive raw/value pair.
 * A goal with none uses goal_threshold_cap (translator-v3 carryGoalIdentityCapFrames).
 */
function frameOf(n: Rec): number | undefined {
  const o = observed(n);
  for (const f of [o.cap, n.scale_frame]) if (finite(f) && f > 0) return f;
  if (finite(o.raw_value) && finite(o.value) && o.value > 0 && o.raw_value > o.value) {
    const pair = o.raw_value / o.value;
    if (finite(pair) && pair > 1) {
      // resolveNodeFrame's legacy percent tolerance keeps 7/.07 exactly 100.
      const magnitude = Math.max(Math.abs(o.raw_value / 100), Math.abs(o.value));
      return Math.abs(o.value - o.raw_value / 100) / magnitude <= 1e-9 ? 100 : pair;
    }
  }
  if (n.kind === 'goal' && finite(n.goal_threshold_cap) && n.goal_threshold_cap > 0) return n.goal_threshold_cap;
  return undefined;
}

/** The subset of PLoT deriveRange whose source is fully present on this wire.
 * Explicit cap outranks state_space.range; own scale/pair is used only for
 * nonnegative-domain intervened factors. Inferred/spread fallback needs more
 * of PLoT's request contract, so refuse it here rather than guess a range.
 */
function interventionRangeOf(n: Rec): { min: number; max: number } | undefined {
  const o = observed(n);
  if (finite(o.cap) && o.cap > 0) return { min: 0, max: o.cap };
  const state = isRec(n.state_space) ? n.state_space : {};
  const r = isRec(state.range) ? state.range : {};
  if (finite(r.min) && finite(r.max) && finite(r.max - r.min) && r.max > r.min) return { min: r.min, max: r.max };
  if ((finite(o.value) && o.value < 0) || (finite(o.baseline) && o.baseline < 0)) return undefined;
  const frame = frameOf(n);
  return frame === undefined ? undefined : { min: 0, max: frame };
}

/** Finite explicit coefficient only. PLoT normaliseEdge flips a positive mean
 * for explicit negative direction, then clamps mean and existence before ISL.
 * Missing coefficients would require PLoT defaults, so they are withheld here.
 */
function effectiveEdge(e: Rec): number | undefined {
  const strength = isRec(e.strength) ? e.strength : {};
  const rawMean = strength.mean ?? e.strength_mean;
  const p = e.exists_probability;
  if (!finite(rawMean) || !finite(p)) return undefined;
  const mean = (e.effect_direction ?? e.direction) === 'negative' && rawMean > 0 ? -rawMean : rawMean;
  return Math.max(-1, Math.min(1, mean)) * Math.max(0, Math.min(1, p));
}

/** The contribution by this addend id on this option's actual Run-input graph. */
export function executedReadingAddendOf(
  wireGraph: unknown, options: unknown, optionId: string, goalId: string, addendId: string,
): { readonly value: number; readonly sized: boolean } | null {
  if (!isRec(wireGraph) || !Array.isArray(wireGraph.nodes) || !Array.isArray(wireGraph.edges) || !Array.isArray(options)) return null;
  // The CEE input does not expose PLoT's post-fit correlated distributions. Do
  // not reconstruct an operand central value through that contract.
  if (['factor_correlations', 'correlations', 'parameter_uncertainties'].some(k =>
    wireGraph[k] !== undefined && !(Array.isArray(wireGraph[k]) && wireGraph[k].length === 0))) return null;
  const allNodes = wireGraph.nodes.filter(isRec);
  const nodes = new Map<string, Rec>();
  for (const n of allNodes) {
    if (typeof n.id !== 'string' || nodes.has(n.id)) return null;
    if (typeof n.kind === 'string' && CAUSAL.has(n.kind)) nodes.set(n.id, n);
  }
  const goal = nodes.get(goalId); const addend = nodes.get(addendId);
  if (goal?.kind !== 'goal' || addend === undefined || !isRec(goal.nonlinear_identity)) return null;
  const identity = goal.nonlinear_identity;
  if (identity.operation !== 'product' || !Array.isArray(identity.factor_ids) || identity.factor_ids.includes(addendId)) return null;
  const listedIds = identity.addends ?? [];
  if (!Array.isArray(listedIds) || !listedIds.every(id => typeof id === 'string')) return null;
  const listed = listedIds.includes(addendId);
  const goalFrame = frameOf(goal);
  const addendFrame = listed ? frameOf(addend) : undefined;
  const held = heldLevel(addend);
  if (goalFrame === undefined || (listed && (addendFrame === undefined || held === undefined))) return null;

  // PLoT excludes decision/option nodes and their edges before ISL. A remaining
  // missing endpoint, duplicate coefficient or bidirected path is unresolved.
  const edges: Rec[] = [];
  const seenEdges = new Set<string>();
  for (const e of wireGraph.edges.filter(isRec)) {
    if (typeof e.from !== 'string' || typeof e.to !== 'string') return null;
    if (!nodes.has(e.from) || !nodes.has(e.to)) {
      const from = allNodes.find(n => n.id === e.from); const to = allNodes.find(n => n.id === e.to);
      if ((from !== undefined && !CAUSAL.has(String(from.kind))) || (to !== undefined && !CAUSAL.has(String(to.kind)))) continue;
      return null;
    }
    const key = `${e.from}\u0000${e.to}`;
    if (seenEdges.has(key)) return null;
    seenEdges.add(key); edges.push(e);
  }
  const outgoing = edges.filter(e => e.from === addendId && e.to === goalId);
  if (outgoing.length !== 1) return null;
  const coefficient = listed ? 1 : effectiveEdge(outgoing[0]!);
  if (coefficient === undefined) return null;
  // CEE's final options can contain RAW user figures (49/59), not the stored
  // .245/.295. PLoT needsNormalisation :1079 opens ONCE for the entire request
  // when ANY intervention is outside [0,1], then deriveRange/normaliseValue
  // normalizes EVERY setting. A per-value >1 heuristic would be wrong.
  const optionRecords = options.filter(isRec);
  if (optionRecords.length !== options.length) return null;
  let normalisationOpen = false;
  for (const o of optionRecords) {
    if (!isRec(o.interventions) || (o.intervention_ranges !== undefined
      && (!isRec(o.intervention_ranges) || Object.keys(o.intervention_ranges).length > 0))) return null;
    for (const setting of Object.values(o.interventions)) {
      if (!finite(setting)) return null;
      if (setting < 0 || setting > 1) normalisationOpen = true;
    }
  }
  const selected = optionRecords.filter(o => (o.id ?? o.option_id) === optionId);
  if (selected.length !== 1 || !isRec(selected[0]!.interventions)) return null;
  const settings: Record<string, number> = {};
  for (const [id, setting] of Object.entries(selected[0]!.interventions)) {
    const n = nodes.get(id);
    if (n === undefined || !finite(setting)) return null;
    if (!normalisationOpen) { settings[id] = setting; continue; }
    // PLoT buildNormalisationContext builds ranges only for factor + goal.
    if (n.kind !== 'factor' && n.kind !== 'goal') return null;
    const range = interventionRangeOf(n);
    if (range === undefined) return null;
    settings[id] = Math.max(0, Math.min(1, (setting - range.min) / (range.max - range.min)));
  }

  const incoming = new Map<string, Rec[]>();
  for (const e of edges) incoming.set(String(e.to), [...(incoming.get(String(e.to)) ?? []), e]);
  const reference = new Map<string, number>(); const actual = new Map<string, number>();
  const active = new Set<string>();
  const propagate = (id: string, useOption: boolean): number | undefined => {
    const cache = useOption ? actual : reference;
    if (cache.has(id)) return cache.get(id)!;
    const visit = `${useOption ? 'option' : 'reference'}:${id}`;
    if (active.has(visit)) return undefined;
    active.add(visit);
    const n = nodes.get(id);
    if (n === undefined || n.nonlinear_identity !== undefined || n.event_risk !== undefined
      || (n.epsilon_std !== undefined && n.epsilon_std !== 0)) { active.delete(visit); return undefined; }
    const parents = incoming.get(id) ?? [];
    if (parents.some(e => e.edge_type === 'bidirected')) { active.delete(visit); return undefined; }
    const o = observed(n); const level = heldLevel(n);
    let value: number | undefined;
    if (useOption && finite(settings[id])) {
      // ISL _in_model_frame :2700–2716: a non-root level setting is the
      // reference structural value plus its change from the held level.
      if (parents.length > 0 && level !== undefined) {
        const ref = propagate(id, false);
        if (ref !== undefined) value = ref + settings[id] - level;
      } else if (parents.length === 0 && level !== undefined
        && Math.abs(settings[id] - level) <= 1e-9 * Math.max(1, Math.abs(level))
        && ((n.intercept !== undefined && n.intercept !== 0) || (finite(o.value) && o.value !== level))) {
        // ISL :2709–2713 root no-change attestation preserves its reference,
        // including an intercept or a value different from the held baseline.
        // Without reconstructing attestation, those ambiguous cases withhold.
        value = undefined;
      } else value = settings[id];
    } else {
      let base = 0;
      if (n.kind === 'factor' && finite(o.value)) base = o.value; // PLoT samples factor values, including non-roots.
      else if (n.kind === 'factor' && n.prior !== undefined) {
        // PLoT's prior-only pass forwards uniform; unsupported distributions
        // would need the post-fit ISL request, which this Run does not expose.
        const p = isRec(n.prior) ? n.prior : {};
        if (p.distribution !== 'uniform' || !finite(p.range_min) || !finite(p.range_max) || p.range_min >= p.range_max) {
          active.delete(visit); return undefined;
        }
        base = (p.range_min + p.range_max) / 2;
      } else if (parents.length === 0 && finite(o.value)) base = o.value;
      const intercept = n.intercept ?? 0;
      if (!finite(intercept)) { active.delete(visit); return undefined; }
      value = base + intercept;
      for (const edge of parents) {
        const effect = effectiveEdge(edge); const parent = propagate(String(edge.from), useOption);
        if (effect === undefined || parent === undefined) { value = undefined; break; }
        value += effect * parent;
      }
    }
    active.delete(visit);
    if (value === undefined || !finite(value)) return undefined;
    cache.set(id, value); return value;
  };
  const at = propagate(addendId, true); const sq = propagate(addendId, false);
  if (at === undefined || sq === undefined) return null;
  // _identity_value's level() anchors a non-root listed participant at its
  // held level. The signed listed value is never multiplied by its edge.
  const listedValue = listed ? (incoming.has(addendId) ? held! + at - sq : at) * addendFrame! : undefined;
  const listedSq = listed ? (incoming.has(addendId) ? held! : sq) * addendFrame! : undefined;
  const full = listed ? listedValue! : goalFrame * coefficient * at;
  const previous = listed ? listedSq! : goalFrame * coefficient * sq;
  const value = heldLevel(goal) === undefined ? full : full - previous;
  return finite(value) ? { value, sized: held !== undefined } : null;
}
