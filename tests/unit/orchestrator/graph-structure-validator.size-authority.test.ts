/**
 * Graph SIZE is not this validator's authority.
 *
 * `graph-structure-validator.ts` carried `checkLimits`, which refused a graph
 * whose ABSOLUTE `nodes.length` / `edges.length` exceeded 20 / 30. Its own
 * header said the opposite of what it did: *"They constrain per-turn graph
 * mutations to keep patches reviewable. PLoT remains the canonical validation
 * authority for absolute graph size."* It was measured on `graph.nodes.length`
 * — the whole model — on the Run-admission path, including the FIRST draft,
 * before any mutation exists.
 *
 * Why the clause is gone rather than re-tuned (measured, not asserted; see
 * `olumi-docs/feedback-2026-08-16/GRAPH-SIZE-AUTHORITY-DERIVATION.md`):
 *   - ISL's own `compute_weighted_cost` prices a 24-node/46-edge draft at
 *     5,903,760 of 24,000,000 units — 24.6% of budget. The refusal copy
 *     ("too complex to analyse reliably") was false at the measured budget.
 *   - ISL deletes decision/option/constraint nodes on EVERY run
 *     (`filter_inference_graph`). 20 of 21 real refused drafts land inside
 *     20/30 post-filter — CEE was refusing a size nothing downstream sees.
 *   - CEE's own draft prompt asks the model for up to 50 nodes / 100 edges
 *     (`defaults-v22.ts` ← `graphCaps.ts`) and then refused the output.
 *
 * The surviving CEE size authority is `src/config/graphCaps.ts` (50/100),
 * which matches PLoT and the shared contract. Every assertion below binds to
 * `GRAPH_MAX_NODES` / `GRAPH_MAX_EDGES` BY IMPORT rather than to a literal, so
 * the pin follows the authority instead of mirroring it.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateGraphStructure,
  wouldExceedAddRiskLimits,
  VIOLATION_MESSAGES,
  type StructuralViolationCode,
} from '../../../src/orchestrator/graph-structure-validator.js';
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from '../../../src/config/graphCaps.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';

// ---------------------------------------------------------------------------
// Fixture: the composition of a REAL captured draft, not one invented here.
//
// `olumi-docs/PHASE0-EVIDENCE-2026-07-28/context-integrity-trace-2026-08-08/
//  raw/496a89d9-T1_DRAFT.json` — measured 2026-08-18:
//    24 nodes {decision:1, goal:1, option:4, factor:11, outcome:3, risk:4}
//    46 edges {option→factor:14, factor→risk:11, factor→outcome:10,
//              decision→option:4, risk→goal:4, outcome→goal:3}
// A fixture drawn from the author's head would encode the author's model of
// the drafting prompt rather than the prompt's actual output.
// ---------------------------------------------------------------------------

const OPTION_COUNT = 4;
const FACTOR_COUNT = 11;
const OUTCOME_COUNT = 3;
const RISK_COUNT = 4;

function node(id: string, kind: string, label: string): GraphV3T['nodes'][number] {
  return { id, kind, label } as unknown as GraphV3T['nodes'][number];
}

function edge(from: string, to: string): GraphV3T['edges'][number] {
  return {
    from,
    to,
    strength: { mean: 0.3, std: 0.1 },
    exists_probability: 0.8,
    effect_direction: 'positive',
  } as unknown as GraphV3T['edges'][number];
}

/** A structurally VALID model with the real capture's exact size and shape. */
function makeRealisticDraftGraph(): GraphV3T {
  const nodes: GraphV3T['nodes'][number][] = [
    node('dec_1', 'decision', 'Geographic Expansion Strategy'),
    node('goal_1', 'goal', 'Reach ARR target by End of FY28'),
  ];
  for (let i = 0; i < OPTION_COUNT; i++) nodes.push(node(`opt_${i}`, 'option', `Option ${i}`));
  for (let i = 0; i < FACTOR_COUNT; i++) nodes.push(node(`fac_${i}`, 'factor', `Factor ${i}`));
  for (let i = 0; i < OUTCOME_COUNT; i++) nodes.push(node(`out_${i}`, 'outcome', `Outcome ${i}`));
  for (let i = 0; i < RISK_COUNT; i++) nodes.push(node(`risk_${i}`, 'risk', `Risk ${i}`));

  const edges: GraphV3T['edges'][number][] = [];
  // decision → option × 4
  for (let i = 0; i < OPTION_COUNT; i++) edges.push(edge('dec_1', `opt_${i}`));
  // option → factor × 14 (every factor gets an inbound; every option an outbound)
  for (let j = 0; j < FACTOR_COUNT; j++) edges.push(edge(`opt_${j % OPTION_COUNT}`, `fac_${j}`));
  edges.push(edge('opt_0', 'fac_4'), edge('opt_1', 'fac_5'), edge('opt_2', 'fac_6'));
  // factor → outcome × 10 (every outcome gets an inbound)
  for (let j = 0; j < 10; j++) edges.push(edge(`fac_${j}`, `out_${j % OUTCOME_COUNT}`));
  // factor → risk × 11 (every factor gets a forward path; every risk an inbound)
  for (let j = 0; j < FACTOR_COUNT; j++) edges.push(edge(`fac_${j}`, `risk_${j % RISK_COUNT}`));
  // outcome → goal × 3, risk → goal × 4
  for (let i = 0; i < OUTCOME_COUNT; i++) edges.push(edge(`out_${i}`, 'goal_1'));
  for (let i = 0; i < RISK_COUNT; i++) edges.push(edge(`risk_${i}`, 'goal_1'));

  return { nodes, edges } as unknown as GraphV3T;
}

function codes(graph: GraphV3T): StructuralViolationCode[] {
  return validateGraphStructure(graph).violations.map((v) => v.code);
}

describe('graph-structure-validator — absolute size is NOT this gate\'s authority', () => {
  // -------------------------------------------------------------------------
  // PRECONDITION PIN. Without this the admission test could pass because the
  // fixture is small, not because the clause is gone (trap 13b: a guard whose
  // discrimination depends on a fixture that nothing pins).
  // -------------------------------------------------------------------------
  it('PRECONDITION: the fixture is the real capture\'s size and sits in the band the removal opens', () => {
    const g = makeRealisticDraftGraph();
    expect(g.nodes).toHaveLength(24);
    expect(g.edges).toHaveLength(46);
    // Above the deleted 20/30 clause — so it EXERCISES the removed code path…
    expect(g.nodes.length).toBeGreaterThan(20);
    expect(g.edges.length).toBeGreaterThan(30);
    // …and inside the surviving authority, so admitting it is not over-admission.
    expect(g.nodes.length).toBeLessThanOrEqual(GRAPH_MAX_NODES);
    expect(g.edges.length).toBeLessThanOrEqual(GRAPH_MAX_EDGES);
  });

  // -------------------------------------------------------------------------
  // THE RED. Refused before the change; admitted after.
  // -------------------------------------------------------------------------
  it('ADMITS a realistic 24-node / 46-edge draft — no size violation of any kind', () => {
    const result = validateGraphStructure(makeRealisticDraftGraph());
    expect(result.violations.map((v) => v.code)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('emits neither NODE_LIMIT_EXCEEDED nor EDGE_LIMIT_EXCEEDED at any size within the surviving authority', () => {
    // Bound to the authority by import: 50 nodes / 100 edges is the last
    // admissible size, so this is the strongest in-band case that exists.
    const g = makeRealisticDraftGraph();
    while (g.nodes.length < GRAPH_MAX_NODES) {
      const id = `pad_${g.nodes.length}`;
      g.nodes.push(node(id, 'factor', `Padding factor ${g.nodes.length}`));
      g.edges.push(edge('opt_0', id), edge(id, 'risk_0'));
    }
    expect(g.nodes).toHaveLength(GRAPH_MAX_NODES);
    expect(g.edges.length).toBeLessThanOrEqual(GRAPH_MAX_EDGES);
    expect(codes(g)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // OPPOSITE-DIRECTION TWINS. The whole risk of this change is OVER-admission,
  // so every case above needs a partner that must STILL be refused.
  // -------------------------------------------------------------------------
  it('TWIN — still REFUSES a same-size (24/46) model that contains a cycle', () => {
    const g = makeRealisticDraftGraph();
    // Swap one factor→outcome edge for a back-edge: identical 24/46 size,
    // so only the structural defect can explain the refusal.
    const removed = g.edges.findIndex((e) => e.from === 'fac_9' && e.to === 'out_0');
    expect(removed).toBeGreaterThanOrEqual(0);
    g.edges.splice(removed, 1);
    g.edges.push(edge('risk_0', 'fac_0')); // fac_0 → risk_0 → fac_0
    expect(g.nodes).toHaveLength(24);
    expect(g.edges).toHaveLength(46);

    expect(codes(g)).toContain('CYCLE_DETECTED');
    expect(validateGraphStructure(g).valid).toBe(false);
  });

  it('TWIN — still REFUSES a same-size (24/46) model with an unreachable orphan', () => {
    const g = makeRealisticDraftGraph();
    // Detach fac_10 completely, then restore the edge count with edges that
    // deliberately never touch fac_10 — so the size stays 24/46 and the ONLY
    // thing that can explain a refusal is the orphan.
    const before = g.edges.length;
    g.edges = g.edges.filter((e) => e.from !== 'fac_10' && e.to !== 'fac_10');
    const detached = before - g.edges.length;
    expect(detached).toBeGreaterThan(0);
    for (let i = 0; i < detached; i++) g.edges.push(edge('opt_3', 'fac_0'));
    expect(g.nodes).toHaveLength(24);
    expect(g.edges).toHaveLength(46);
    expect(g.edges.some((e) => e.from === 'fac_10' || e.to === 'fac_10')).toBe(false);

    const violations = validateGraphStructure(g).violations;
    expect(violations.map((v) => v.code)).toContain('ORPHAN_NODE');
    // Bind by IDENTITY: the orphan reported is fac_10, not merely "some node".
    expect(
      violations.some((v) => v.code === 'ORPHAN_NODE' && v.detail.includes('"fac_10"')),
    ).toBe(true);
  });

  it('TWIN — still REFUSES a same-size (24/46) model whose options are unlinked from the decision', () => {
    const g = makeRealisticDraftGraph();
    const idx = g.edges.findIndex((e) => e.from === 'dec_1' && e.to === 'opt_2');
    expect(idx).toBeGreaterThanOrEqual(0);
    g.edges.splice(idx, 1);
    g.edges.push(edge('fac_0', 'out_1')); // keep the edge count at 46
    expect(g.edges).toHaveLength(46);

    const violations = validateGraphStructure(g).violations;
    expect(
      violations.some(
        (v) => v.code === 'OPTION_NOT_LINKED_TO_DECISION' && v.detail.includes('"opt_2"'),
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The env gate is GONE, not merely widened. This is the anti-resurrection
  // pin: re-adding a `CEE_GRAPH_MAX_*`-driven clause turns this RED.
  // -------------------------------------------------------------------------
  // ⭐ POSITIVE CONTROL for the anti-resurrection test below, and it is not
  // optional. That test asserts an ABSENCE (no refusal) after re-importing with
  // a stubbed env — and an absence probe whose instrument is dead passes by
  // testing nothing. Review proved the point: the test would have passed
  // IDENTICALLY had `vi.resetModules()` been a no-op, because the module under
  // test no longer reads any env var at all.
  //
  // So prove the mechanism against a module that DOES read env at module scope.
  // `graphCaps.ts` resolves `GRAPH_MAX_NODES` from `process.env` on first
  // evaluation, and it is the sibling the validator itself imports — if
  // `resetModules` + `stubEnv` can move THIS value, it could equally have
  // observed a resurrected `CEE_GRAPH_MAX_*` clause in the validator.
  it('POSITIVE CONTROL: vi.resetModules() + vi.stubEnv genuinely re-evaluate module-level env reads', async () => {
    expect(GRAPH_MAX_NODES).toBe(50); // the un-stubbed default, for contrast
    vi.resetModules();
    vi.stubEnv('LIMIT_MAX_NODES', '7');
    try {
      const freshCaps = await import('../../../src/config/graphCaps.js');
      // If this reads 50, the instrument is blind and the absence test below
      // proves nothing.
      expect(freshCaps.GRAPH_MAX_NODES).toBe(7);
      expect(freshCaps.GRAPH_MAX_NODES).not.toBe(GRAPH_MAX_NODES);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('CEE_GRAPH_MAX_NODES / CEE_GRAPH_MAX_EDGES no longer reintroduce a size refusal', async () => {
    // `vi.resetModules()` + a PLAIN dynamic import, deliberately not the
    // `?query-string` cache-buster the deleted env tests used: that pattern is
    // unresolvable to `tsc` and is why this file's predecessor sat in
    // `scripts/ci/typecheck-baseline.txt`. Resetting the registry re-evaluates
    // module-level constants against the stubbed env just as well, and adds no
    // type error to baseline.
    vi.resetModules();
    vi.stubEnv('CEE_GRAPH_MAX_NODES', '4');
    vi.stubEnv('CEE_GRAPH_MAX_EDGES', '3');
    try {
      const fresh = await import('../../../src/orchestrator/graph-structure-validator.js');
      const result = fresh.validateGraphStructure(makeRealisticDraftGraph());
      expect(result.violations.map((v) => v.code)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('wouldExceedAddRiskLimits — anticipates the SURVIVING authority', () => {
  it('does NOT refuse an add on a 24-node model that the validator now admits', () => {
    // The preflight exists to skip a 16–18s LLM call that would fail anyway.
    // If it refuses what the rest of CEE accepts, the product declines an
    // action it could honour — the same defect class as asking a question it
    // cannot accept an answer to.
    const preflight = wouldExceedAddRiskLimits(makeRealisticDraftGraph());
    expect(preflight.current_nodes).toBe(24);
    expect(preflight.over_node_limit).toBe(false);
    expect(preflight.over_edge_limit).toBe(false);
  });

  it('TWIN — STILL refuses an add that would breach the surviving authority', () => {
    const g = makeRealisticDraftGraph();
    while (g.nodes.length < GRAPH_MAX_NODES) {
      g.nodes.push(node(`pad_${g.nodes.length}`, 'factor', `Padding ${g.nodes.length}`));
    }
    expect(g.nodes).toHaveLength(GRAPH_MAX_NODES);
    const preflight = wouldExceedAddRiskLimits(g);
    expect(preflight.projected_nodes).toBe(GRAPH_MAX_NODES + 1);
    expect(preflight.over_node_limit).toBe(true);
  });

  it('reports the limits it enforced, and they ARE the surviving authority', () => {
    const preflight = wouldExceedAddRiskLimits(makeRealisticDraftGraph());
    expect(preflight.node_limit).toBe(GRAPH_MAX_NODES);
    expect(preflight.edge_limit).toBe(GRAPH_MAX_EDGES);
  });
});

describe('VIOLATION_MESSAGES — the surviving limit copy must be true', () => {
  it('EDGE_LIMIT_EXCEEDED no longer asserts the refuted compute claim', () => {
    // Measured 24.6% of ISL's 24,000,000-unit budget at 24 nodes / 46 edges,
    // and 63.1% at the 50-node platform wall. "Too complex to analyse
    // reliably" was never true at any size CEE can hold.
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).not.toContain('too complex to analyse reliably');
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).not.toContain('too complex to analyse reliably');
  });

  it('both limit messages name the real number a refused user has to work to', () => {
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).toContain(String(GRAPH_MAX_NODES));
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).toContain(String(GRAPH_MAX_EDGES));
  });
});
