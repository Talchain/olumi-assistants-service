/**
 * O-3 — deterministic fixtures for the context-budget enforcement suite.
 *
 * Shared between `context-budget-enforcement.test.ts` and the one-off
 * base-capture script that pinned the under-budget byte-identity golden
 * (positive control): the SAME builder must produce the bytes on both
 * sides of the wiring, so the fixture lives in one module.
 *
 * Everything here is fixed-value — no Date.now(), no randomness — so the
 * assembled pack serialises to stable bytes run-over-run.
 */

import type {
  CompactEdge,
  CompactNode,
  GraphV3Compact,
} from '../../../orchestrator/context/graph-compact.js';
import type { AnalysisResponseSummary } from '../../../orchestrator/context/analysis-compact.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

/**
 * Small compact graph that sits comfortably under the graph budget while
 * carrying every trimmable field (`type`, `category`,
 * `intervention_summary`, `raw_value`, `cap`, `source`, edge
 * `plain_interpretation`, edge `exists`) — if enforcement ever trimmed
 * gratuitously, the serialised bytes would change and the golden pin
 * would catch it.
 */
export function underBudgetCompactGraph(): GraphV3Compact {
  const nodes: CompactNode[] = Array.from({ length: 6 }, (_, i) => ({
    id: `n${i}`,
    kind: i === 0 ? 'goal' : i === 1 ? 'option' : 'factor',
    label: `Fixture node ${i}`,
    type: 'some_type',
    category: i === 3 ? 'external' : 'controllable',
    value: i * 10,
    raw_value: i * 100,
    unit: '%',
    cap: 100,
    source: 'user',
    intervention_summary: i === 1 ? 'sets Fixture node 2=0.9' : undefined,
  }));
  const edges: CompactEdge[] = Array.from({ length: 5 }, (_, i) => ({
    from: `n${i}`,
    to: `n${i + 1}`,
    strength: 0.5,
    exists: 0.9,
    plain_interpretation: `node ${i} moderately increases node ${i + 1}`,
  }));
  return {
    nodes,
    edges,
    _node_count: nodes.length,
    _edge_count: edges.length,
  };
}

/**
 * Compact graph whose serialised size exceeds the budget module's graph
 * allocation (25% of the default 120k-token budget = 120,000 chars) even
 * after every trim pass — the bulk sits in node `label`s, which the
 * module's own contract preserves throughout. This forces the full trim
 * ladder (passes 1 → 4) to run, so the test can assert the pass-2 field
 * drops (`category` / `intervention_summary`) that are visible in the
 * LLM-facing display projection.
 */
export function overBudgetCompactGraph(nodeCount = 260): GraphV3Compact {
  const nodes: CompactNode[] = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    kind: 'factor',
    label: `Oversized fixture node ${i} ${'x'.repeat(600)}`,
    type: 'some_type',
    category: i % 7 === 0 ? 'external' : 'controllable',
    value: i,
    raw_value: i * 10,
    unit: '%',
    cap: 100,
    source: 'user',
    intervention_summary: `sets neighbouring factor ${i + 1}=0.9 ${'y'.repeat(80)}`,
  }));
  const edges: CompactEdge[] = Array.from({ length: nodeCount - 1 }, (_, i) => ({
    from: `n${i}`,
    to: `n${i + 1}`,
    strength: 0.5,
    exists: 0.9,
    plain_interpretation: `factor ${i} moderately increases factor ${i + 1}`,
  }));
  return {
    nodes,
    edges,
    _node_count: nodes.length,
    _edge_count: edges.length,
  };
}

/**
 * Five-driver analysis summary with `constraint_tensions` present. Under
 * budget as-is; `inflate` pads `constraint_tensions` far past the analysis
 * allocation (15% of the default budget = 72,000 chars) so the module's
 * analysis trim (drivers → 3, tensions dropped) fires.
 */
export function analysisSummaryFixture(opts?: {
  inflate?: boolean;
}): AnalysisResponseSummary {
  const inflate = opts?.inflate === true;
  return {
    winner: {
      option_id: 'opt-a',
      option_label: 'Expand EU',
      win_probability: 0.72,
    },
    options: [
      {
        option_id: 'opt-a',
        option_label: 'Expand EU',
        win_probability: 0.72,
        outcome_mean: 120000,
      },
      {
        option_id: 'opt-b',
        option_label: 'Stay domestic',
        win_probability: 0.28,
        outcome_mean: 80000,
      },
    ],
    top_drivers: Array.from({ length: 5 }, (_, i) => ({
      factor_id: `f${i}`,
      factor_label: `Driver ${i}`,
      sensitivity: 0.9 - i * 0.1,
      direction: i % 2 === 0 ? 'positive' : 'negative',
    })),
    robustness_level: 'moderate',
    fragile_edge_count: 2,
    top_fragile_edges: [{ from_label: 'Marketing Spend', to_label: 'New Leads' }],
    margin: 0.44,
    margin_pp: 44,
    analysis_status: 'complete',
    constraint_tensions: inflate
      ? Array.from({ length: 40 }, (_, i) => `tension_${i}_${'z'.repeat(2000)}`)
      : ['c1', 'c2'],
  };
}

/** Deterministic prior-turn rows (content-bearing superset shape). */
export function priorTurnsFixture(count: number): SessionTurnWithContent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row_${i}`,
    scenario_id: 'scen-abc',
    user_id: 'user-1',
    turn_id: `t-prev-${i}`,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `hash-${i}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 250,
    created_at: `2026-04-18T2${Math.min(i, 3)}:0${i % 10}:00.000Z`,
    user_message: `Prior user message ${i}`,
    assistant_message: `Prior assistant answer ${i}`,
  }));
}
