/** A SYNTHETIC saved scenario and its graph-route read, shared by the PATH-B adapter specs. */
export type Rec = Record<string, unknown>;
export const STAFF = { value: 1 / 10, raw_value: 1, unit: 'people', source: 'brief_extraction', extractionType: 'explicit' };
export const QUEUE = { value: 0.3, raw_value: 30, unit: 'minutes' };
export const PRICE = { value: 0.5, raw_value: 5, unit: 'GBP', source: 'cee_inference' };
export const ADD_CELL = { value: 2 / 10, source: 'brief_extraction', extractionType: 'explicit' };
export const QUOTE = 'Walk-ins swing a lot from week to week.';

export function graph(): Rec {
  const options = [
    { id: 'add_staff', option_id: 'add_staff', kind: 'option', label: 'Add a second assistant', interventions: { staff: ADD_CELL } },
    { id: 'carry_on', option_id: 'carry_on', kind: 'option', label: 'Carry on as now', interventions: { staff: { value: 1 / 10, source: 'cee_inference' } }, is_baseline: true },
  ];
  return {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Staffing' },
      { id: 'goal', kind: 'goal', label: 'Serve every visitor on the day' },
      { id: 'staff', kind: 'factor', label: 'Assistants on shift', category: 'controllable', observed_state: STAFF },
      { id: 'queue', kind: 'factor', label: 'Queue time', category: 'observable', observed_state: QUEUE },
      { id: 'price', kind: 'factor', label: 'Ticket price', category: 'observable', observed_state: PRICE, proposed_by: 'olumi' },
      { id: 'visits', kind: 'factor', label: 'Walk-in visits next week', category: 'observable', user_statements: [{
        subject_key: 'factor|visits|||level', field: 'level', recorded_at: '2026-10-19T09:00:00.000Z', attest: { recorded_by: 'construction' },
        statements: [{ speaker: 'unknown', quote: QUOTE, source: QUOTE, subject: { quantity: 'factor|visits|||level', node_id: 'visits' },
          form: 'describes', reading: 'olumi' }] }] },
      ...options,
    ],
    edges: [
      ...options.map((o) => ({ from: 'decision', to: o.id, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      ...options.map((o) => ({ from: o.id, to: 'staff', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      { from: 'staff', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'queue', to: 'goal', strength: { mean: -0.2, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
      { from: 'price', to: 'goal', strength: { mean: 0.1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'visits', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'goal',
  };
}

export function read(extra: Rec = {}): Rec {
  return {
    graph: graph(), graph_hash: 'h_one', graph_identity_hash: { kind: 'graph_identity', value: 'id_one', algorithm: 'sha256' },
    canonical_analysis_view: { staleness: { revision: 7, stale: false }, run: { run_id: 'run_1', graph_hash_at_run: 'h_one' } },
    analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-19T10:00:00.000Z' }, leader_claim: { permitted: false } },
    ...extra,
  };
}

