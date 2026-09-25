/**
 * Graph fixtures for the Agent lane's automatic first analysis (PR-B).
 *
 * The admission verdicts these carry are asserted by the runner test's fixture control
 * (`resolveRunAdmission(READY_GRAPH).willProceed === true`, `BLOCKED_GRAPH` refused), so a
 * change in the readiness rules turns that control red rather than silently changing the
 * meaning of every test built on them.
 */
const e = (from: string, to: string, mean = 1) => ({
  from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const,
});

/** Admissible: both options set the one factor, which reaches the goal. */
export const READY_GRAPH = {
  nodes: [
    { id: 'dec_x', kind: 'decision', label: 'Choose an option' },
    { id: 'goal_x', kind: 'goal', label: 'Outcome', goal_threshold: 0.8 },
    { id: 'fac_delivery', kind: 'factor', label: 'Delivery reliability' },
    { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { fac_delivery: 1 } },
    { id: 'opt_b', kind: 'option', label: 'Option B', interventions: { fac_delivery: 0 } },
  ],
  edges: [e('dec_x', 'opt_a'), e('dec_x', 'opt_b'), e('opt_a', 'fac_delivery'), e('opt_b', 'fac_delivery', 0.01), e('fac_delivery', 'goal_x')],
  goal_node_id: 'goal_x',
};

/** The SAME model with one option that sets nothing: the admission refuses it. */
export const BLOCKED_GRAPH = {
  ...READY_GRAPH,
  nodes: READY_GRAPH.nodes.map((n) => (n.id === 'opt_b' ? { id: 'opt_b', kind: 'option', label: 'Option B' } : n)),
};
