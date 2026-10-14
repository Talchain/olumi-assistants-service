/** Identity-bound model and licence used by the pure and real-route S2b rows. */
type FixtureNode = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; scale_frame?: number; [key: string]: unknown };
/** Loosely typed on purpose: rows mutate a node's observed_state to other shapes. */
export const estimateGraph = (): { nodes: FixtureNode[]; edges: { from: string; to: string }[] } => ({ nodes: [
  { id: 'goal', kind: 'goal', label: 'Launch on time', observed_state: { unit: '% likelihood of on-time launch' }, goal_horizon: { deadline: '2027-04-07' } },
  { id: 'a', kind: 'option', label: 'Hire', interventions: { far: 0.5, user: 0.5, unknown: 0.5, znear: 0.5 } },
  { id: 'b', kind: 'option', label: 'Train', interventions: { far: 0.75 } },
  { id: 'far', kind: 'factor', label: 'Far', observed_state: { value: 0.25, raw_value: 25, cap: 100, unit: '%', extractionType: 'inferred' } },
  { id: 'mid', kind: 'factor', label: 'Accepted', observed_state: { value: 0.2, raw_value: 20, cap: 100, unit: '%', source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } } },
  { id: 'near', kind: 'factor', label: 'Near', observed_state: { value: 0.15, raw_value: 15, cap: 100, unit: '%', extractionType: 'inferred' } },
  { id: 'znear', kind: 'factor', label: 'Extra', observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '%', extractionType: 'inferred' } },
  { id: 'user', kind: 'factor', label: 'User', observed_state: { value: 0.3, raw_value: 30, cap: 100, unit: '%', source: 'user_edited' } },
  { id: 'unknown', kind: 'factor', label: 'Unknown', observed_state: { value: 0.4, raw_value: 40, cap: 100, unit: '%' } },
  { id: 'off', kind: 'factor', label: 'Off path', observed_state: { value: 0.5, raw_value: 50, cap: 100, unit: '%', extractionType: 'inferred' } },
], edges: [
  { from: 'far', to: 'mid' }, { from: 'mid', to: 'near' }, { from: 'near', to: 'goal' },
  { from: 'znear', to: 'goal' }, { from: 'user', to: 'goal' }, { from: 'unknown', to: 'goal' },
] });

export const estimateLicence = (drivers: Record<string, string> = { b: 'far', a: 'far' }) => ({
  code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['b', 'a'], pct_by_option: { b: 45, a: 40 },
  driver_by_option: Object.fromEntries(Object.entries(drivers).map(([option, factor]) => [option, {
    kind: 'factor_value', quantity_id: factor, factor_id: factor, authored_by: 'olumi',
    side: 'low', cut_value: 10, cut_unit: '%', pct_if_side: 20,
  }])),
});
