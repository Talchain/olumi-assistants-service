/**
 * Minimal valid GraphV3 fixture for orchestrator staging tests.
 *
 * 6 nodes: 1 goal, 2 options, 2 factors, 1 outcome.
 * 7 edges connecting options → factors → outcome → goal.
 * Passes PLoT structural validation (1 goal node, no cycles).
 */
export const MINIMAL_GRAPH = {
  nodes: [
    { id: "goal_main",       kind: "goal",    label: "Hire best team for startup" },
    { id: "opt_senior",      kind: "option",  label: "Hire senior developer" },
    { id: "opt_junior",      kind: "option",  label: "Hire two junior developers" },
    {
      id: "fac_cost",
      kind: "factor",
      label: "Salary cost",
      observed_state: { value: 120000, unit: "GBP", factor_type: "cost", uncertainty_drivers: ["market rates"] },
    },
    {
      id: "fac_productivity",
      kind: "factor",
      label: "Team productivity",
      observed_state: { value: 0.8, factor_type: "other", uncertainty_drivers: ["ramp-up time"] },
    },
    { id: "outcome_team",    kind: "outcome", label: "Team effectiveness" },
  ],
  edges: [
    { from: "opt_senior",       to: "fac_cost",         strength: { mean: 0.7,  std: 0.10 }, exists_probability: 0.95, effect_direction: "negative" },
    { from: "opt_junior",       to: "fac_cost",         strength: { mean: 0.4,  std: 0.15 }, exists_probability: 0.90, effect_direction: "negative" },
    { from: "opt_senior",       to: "fac_productivity", strength: { mean: 0.8,  std: 0.10 }, exists_probability: 0.90, effect_direction: "positive" },
    { from: "opt_junior",       to: "fac_productivity", strength: { mean: 0.6,  std: 0.20 }, exists_probability: 0.85, effect_direction: "positive" },
    { from: "fac_cost",         to: "outcome_team",     strength: { mean: 0.6,  std: 0.10 }, exists_probability: 0.90, effect_direction: "negative" },
    { from: "fac_productivity", to: "outcome_team",     strength: { mean: 0.9,  std: 0.05 }, exists_probability: 0.95, effect_direction: "positive" },
    { from: "outcome_team",     to: "goal_main",        strength: { mean: 0.9,  std: 0.05 }, exists_probability: 1.00, effect_direction: "positive" },
  ],
} as const;
