/**
 * Test fixtures for the V6 Graph Management spike. Pure GraphV3 builders — no
 * DB, no I/O, and no `as unknown as` casts (typed so fixture drift is caught by
 * the compiler). `buildReadyGraph` is structurally valid AND EP2 analysis-ready
 * (goal + decision + 2 options each wired to a factor, >=1 with a numeric
 * intervention, factors -> goal; acyclic, no orphans). `buildUnconfiguredGraph`
 * is the same structure with no option interventions -> EP2 blocked
 * (OPTIONS_NOT_CONFIGURED). `buildReadyGraphWithTopLevelOptions` adds a canonical
 * top-level options[] so the add-option divergence is observable.
 */
import type { GraphV3T, EdgeV3T, OptionV3T } from '../../../schemas/cee-v3.js';

function edge(from: string, to: string): EdgeV3T {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  };
}

const BASE_EDGES: EdgeV3T[] = [
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
  };
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
  };
}

/**
 * Ready graph PLUS a canonical top-level options[] (OptionV3), mirroring a
 * production graph after run-analysis persists enriched options. This is where
 * the add-option divergence shows: run-analysis reads node-derived options while
 * the context-pack assembler prefers this top-level array.
 */
export function buildReadyGraphWithTopLevelOptions(): GraphV3T & { options: OptionV3T[] } {
  const oa: OptionV3T = { id: 'o-a', label: 'Plan A', status: 'ready', interventions: {} };
  const ob: OptionV3T = { id: 'o-b', label: 'Plan B', status: 'ready', interventions: {} };
  return { ...buildReadyGraph(), options: [oa, ob] };
}
