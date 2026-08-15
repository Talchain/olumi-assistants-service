/**
 * Unit tests for the S2-L1 typed readiness/coaching intake composer
 * (readiness-intake.ts).
 *
 * These pin the FOUR branches the typed `analysis_readiness` chip reaches by
 * TYPE (not the string mirror): fresh-canvas unification, goal-missing,
 * open-readiness-items, and ready. The composer is pure + total, so these run
 * without any route/LLM harness.
 *
 * Mutation-check target: reverting the arm's dispatch in route-v2 does NOT
 * affect these (they call the composer directly) — the RED-on-revert evidence
 * for the ROUTING lives in the route-level tests. These pin the composer's
 * BEHAVIOUR so a copy/branch regression here goes RED independently.
 */
import { describe, it, expect } from 'vitest';

import {
  composeReadinessIntakeResponse,
  READINESS_GOAL_MISSING_MARKER,
  READINESS_OPEN_MARKER,
  READINESS_READY_MARKER,
} from '../readiness-intake.js';
import { PROCESS_META_ANSWER_MARKER } from '../process-meta-intake.js';

// Minimal valid GraphV3 primitives (NodeV3 requires {id, kind, label};
// EdgeV3 requires {from, to, strength:{mean,std>0}, exists_probability,
// effect_direction}). Unknown fields are stripped by GraphV3 parse, so only
// declared NodeV3 fields (incl. `interventions`, `goal_threshold`) survive.
function goalNode(extra: Record<string, unknown> = {}) {
  return { id: 'goal_1', kind: 'goal', label: 'Grow revenue', ...extra };
}
function optionNode(id: string, label: string, extra: Record<string, unknown> = {}) {
  return { id, kind: 'option', label, ...extra };
}

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

const READY_INTERVENTIONS = { interventions: { f1: 0.5 } };

function readyGraph() {
  return {
    nodes: [
      goalNode({ goal_threshold: 0.8 }),
      optionNode('opt_1', 'Option A', READY_INTERVENTIONS),
      optionNode('opt_2', 'Option B', READY_INTERVENTIONS),
      { id: 'f1', kind: 'factor', label: 'Market response', category: 'controllable' },
    ],
    edges: [edge('opt_1', 'f1'), edge('opt_2', 'f1'), edge('f1', 'goal_1')],
  };
}

describe('composeReadinessIntakeResponse — fresh canvas (unification)', () => {
  it('null persisted graph → the honest process-meta fresh-canvas answer', () => {
    const { outcome, response } = composeReadinessIntakeResponse(null, 'frame');
    expect(outcome).toBe('fresh_canvas');
    // Reached BY THE TYPE: the SAME composer the string-mirror branch uses.
    expect(response.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
  });

  it('structurally empty graph ({nodes:[],edges:[]}) → fresh-canvas answer', () => {
    const { outcome, response } = composeReadinessIntakeResponse(
      { nodes: [], edges: [] },
      'frame',
    );
    expect(outcome).toBe('fresh_canvas');
    expect(response.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
  });

  it('unparseable persisted graph → degrades to the fresh-canvas answer', () => {
    const { outcome, response } = composeReadinessIntakeResponse(
      { not: 'a graph' },
      'frame',
    );
    expect(outcome).toBe('fresh_canvas');
    expect(response.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
  });
});

describe('composeReadinessIntakeResponse — populated canvas (NOT the fresh path)', () => {
  it('populated but NO goal node → names the missing goal (goal_missing)', () => {
    const graph = {
      nodes: [optionNode('opt_1', 'Option A'), optionNode('opt_2', 'Option B')],
      edges: [],
    };
    const { outcome, response } = composeReadinessIntakeResponse(graph, 'frame');
    expect(outcome).toBe('goal_missing');
    expect(response.assistant_text).toContain(READINESS_GOAL_MISSING_MARKER);
    // Must NOT claim the canvas is empty — it is populated.
    expect(response.assistant_text).not.toContain(PROCESS_META_ANSWER_MARKER);
  });

  it('goal + only one option → surfaces open readiness items (readiness_open)', () => {
    const graph = {
      nodes: [goalNode(), optionNode('opt_1', 'Option A')],
      edges: [],
    };
    const { outcome, response } = composeReadinessIntakeResponse(graph, 'analyse');
    expect(outcome).toBe('readiness_open');
    // The reviewed summariseReadiness prose lead.
    expect(response.assistant_text).toContain(READINESS_OPEN_MARKER);
    expect(response.assistant_text).not.toContain(PROCESS_META_ANSWER_MARKER);
    // stage_indicator flows through from the ingress stage on populated branches.
    expect(response.stage_indicator).toBe('analyse');
  });

  it('goal with threshold + two configured options → ready to analyse (readiness_ready)', () => {
    const graph = readyGraph();
    const { outcome, response } = composeReadinessIntakeResponse(graph, 'analyse');
    expect(outcome).toBe('readiness_ready');
    expect(response.assistant_text).toContain(READINESS_READY_MARKER);
    expect(response.assistant_text).not.toContain(READINESS_OPEN_MARKER);
    expect(response.assistant_text).not.toContain(PROCESS_META_ANSWER_MARKER);
  });
});

describe('composeReadinessIntakeResponse — envelope invariants', () => {
  it('every branch returns a well-formed response_version 2 envelope, no chips', () => {
    const graphs: Array<unknown | null> = [
      null,
      { nodes: [], edges: [] },
      { nodes: [optionNode('opt_1', 'A'), optionNode('opt_2', 'B')], edges: [] },
      { nodes: [goalNode(), optionNode('opt_1', 'A')], edges: [] },
      readyGraph(),
    ];
    for (const g of graphs) {
      const { response } = composeReadinessIntakeResponse(g, 'frame');
      expect(response.response_version).toBe(2);
      expect(Array.isArray(response.blocks)).toBe(true);
      // No suggested_actions: a chip here would need a brief seed / pending —
      // parity with the process-meta answer (no commit, scenario stays fresh).
      expect(response.suggested_actions).toEqual([]);
      expect(typeof response.assistant_text).toBe('string');
      expect(response.assistant_text.length).toBeGreaterThan(0);
    }
  });
});
