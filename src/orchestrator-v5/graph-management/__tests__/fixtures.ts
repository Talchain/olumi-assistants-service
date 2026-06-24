/**
 * Test fixtures for the V6 Graph Management spike. Pure GraphV3 builders — no
 * DB, no I/O. `buildReadyGraph` is structurally valid AND EP2 analysis-ready
 * (goal + decision + 2 options each wired to a factor, >=1 with a numeric
 * intervention, factors -> goal; acyclic, no orphans). `buildUnconfiguredGraph`
 * is the same structure with no option interventions -> EP2 blocked
 * (OPTIONS_NOT_CONFIGURED), for the parity biconditional.
 */
import type { GraphV3T } from '../../../schemas/cee-v3.js';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive' as const,
  };
}

const BASE_EDGES = [
  edge('d-choice', 'o-a'),
  edge('d-choice', 'o-b'),
  edge('o-a', 'f-spend'),
  edge('o-b', 'f-reach'),
  edge('f-spend', 'g-profit'),
  edge('f-reach', 'g-profit'),
];

/** Structurally valid + EP2 analysis-ready. */
export function buildReadyGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-profit', kind: 'goal', label: 'Profit' },
      { id: 'd-choice', kind: 'decision', label: 'Which plan' },
      { id: 'f-spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
      { id: 'f-reach', kind: 'factor', label: 'Audience reach', observed_state: { value: 0.5 } },
      { id: 'o-a', kind: 'option', label: 'Plan A', interventions: { 'f-spend': { value: 0.6 } } },
      { id: 'o-b', kind: 'option', label: 'Plan B', interventions: { 'f-reach': { value: 0.3 } } },
    ],
    edges: [...BASE_EDGES],
  } as unknown as GraphV3T;
}

/** Same structure, options carry NO interventions -> EP2 OPTIONS_NOT_CONFIGURED. */
export function buildUnconfiguredGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-profit', kind: 'goal', label: 'Profit' },
      { id: 'd-choice', kind: 'decision', label: 'Which plan' },
      { id: 'f-spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
      { id: 'f-reach', kind: 'factor', label: 'Audience reach', observed_state: { value: 0.5 } },
      { id: 'o-a', kind: 'option', label: 'Plan A' },
      { id: 'o-b', kind: 'option', label: 'Plan B' },
    ],
    edges: [...BASE_EDGES],
  } as unknown as GraphV3T;
}
