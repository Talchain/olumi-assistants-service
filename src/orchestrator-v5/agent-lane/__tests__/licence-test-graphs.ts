type Rec = Record<string, any>;

/** Preserve another claim's legacy test class while pinning the unchanged served graph in a separate row. */
export function legacyDoorGraph<G>(graph: G): G {
  const out = structuredClone(graph) as G & Rec;
  for (const edge of out.edges ?? []) {
    const p = edge.provenance ?? {};
    if (p.source !== 'user_specified' && p.magnitude === undefined && p.natural_effect === undefined && edge.defaulted === true
      && Math.abs(edge.strength?.mean) === 0.5 && edge.strength?.std === 0.125) edge.strength.std = 0.1;
  }
  return out;
}

/** Fidelity subtraction: only the producer's new whole-default tag, never an estimate or scaled effect. */
export function beforeDoorTag<G>(graph: G): G {
  const out = structuredClone(graph) as G & Rec;
  for (const edge of out.edges ?? []) {
    const p = edge.provenance;
    if (p?.magnitude === 'olumi_placeholder' && p.mean_projected === true && p.natural_effect === undefined
      && Math.abs(edge.strength?.mean) === 0.5 && edge.strength?.std === 0.125) delete p.magnitude;
  }
  return out;
}

/** Builder operations and committed graphs share the same edge value; subtract that exact tag at either carrier. */
export function beforeDoorTagsDeep<T>(value: T, previous: unknown): T {
  const out = structuredClone(value);
  const walk = (v: unknown, old: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((child, i) => walk(child, Array.isArray(old) ? old[i] : undefined)); return; }
    const e = v as Rec;
    const prior = old !== null && typeof old === 'object' ? old as Rec : {};
    if (typeof e.from === 'string' && typeof e.to === 'string' && prior.from === e.from && prior.to === e.to
      && prior.provenance?.magnitude === undefined && e.defaulted === true
      && e.provenance?.magnitude === 'olumi_placeholder' && e.provenance.natural_effect === undefined
      && Math.abs(e.strength?.mean) === 0.5 && e.strength?.std === 0.125) delete e.provenance.magnitude;
    for (const [key, child] of Object.entries(e)) walk(child, prior[key]);
  };
  walk(out, previous);
  return out;
}

/** Only C's two newly unsized, reached links are inserted into its recorded whole-turn expectation. */
export function reclassifiedCTurn<T>(turn: T): T {
  const out = structuredClone(turn) as T & Rec;
  const added = [
    { id: 'price_rise->price_rise_churn', kind: 'link', labels: ['Price rise', 'Price-rise churn'], card: null },
    { id: 'starter_tier_support_cost->support_capacity_strain', kind: 'link', labels: ['Starter tier support cost', 'Support capacity strain'], card: null },
  ];
  const items = out.context.supplied_items as Rec[];
  const index = items.findIndex(i => i.id === 'support_capacity_strain->monthly_recurring_revenue') + 1;
  items.splice(index, 0, ...added);
  const checks = out.check_inputs.supplied_items as Rec[];
  checks.splice(index, 0, ...added.map(({ id, labels }) => ({ id, labels })));
  const anchor = '- how ‘Support capacity strain’ affects ‘monthly recurring revenue’ (nobody has sized this yet)';
  out.directive = out.directive.replace(anchor, anchor + '\n- how ‘Price rise’ affects ‘Price-rise churn’ (nobody has sized this yet)\n- how ‘Starter tier support cost’ affects ‘Support capacity strain’ (nobody has sized this yet)');
  return out;
}

/** C's option-scoped turns gain the same reached link, with their existing card shape. */
export function reclassifiedCPlan<T>(turn: T, option: string): T {
  const out = structuredClone(turn) as T & Rec;
  if (out.kind !== 'run') return out;
  const added = option === 'raise_prices_10'
    ? { id: 'price_rise->price_rise_churn', kind: 'link', labels: ['Price rise', 'Price-rise churn'], card: 'propose_link_strengths' }
    : option === 'launch_starter_tier'
      ? { id: 'starter_tier_support_cost->support_capacity_strain', kind: 'link', labels: ['Starter tier support cost', 'Support capacity strain'], card: 'propose_link_strengths' } : undefined;
  if (added === undefined) return out;
  const index = option === 'raise_prices_10' ? 0 : 1;
  out.context.supplied_items.splice(index, 0, added);
  out.check_inputs.supplied_items.splice(index, 0, { id: added.id, labels: added.labels });
  const bullet = `- how ‘${added.labels[0]}’ affects ‘${added.labels[1]}’ (nobody has sized this yet)`;
  const anchor = option === 'raise_prices_10' ? '- ‘Price-rise churn’ (a risk on this plan’s path)'
    : '- how ‘Starter tier subscribers’ affects ‘Starter tier support cost’ (nobody has sized this yet)';
  out.directive = out.directive.replace(anchor, bullet + '\n' + anchor);
  return out;
}
