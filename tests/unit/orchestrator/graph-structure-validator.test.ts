import { describe, it, expect } from 'vitest';
import { validateGraphStructure, type StructuralViolationCode } from '../../../src/orchestrator/graph-structure-validator.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';

// ============================================================================
// Helper — valid minimal graph
// ============================================================================

function makeValidGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Choose pricing' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'opt_b', kind: 'option', label: 'Option B' },
      { id: 'fac_x', kind: 'factor', label: 'Market size' },
      { id: 'goal_1', kind: 'goal', label: 'Revenue' },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_x', strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_x', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
      { from: 'fac_x', to: 'goal_1', strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.95, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

function hasViolation(result: ReturnType<typeof validateGraphStructure>, code: StructuralViolationCode): boolean {
  return result.violations.some((v) => v.code === code);
}

describe('validateGraphStructure', () => {
  it('valid graph passes', () => {
    const result = validateGraphStructure(makeValidGraph());
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('NO_GOAL: detects missing goal node', () => {
    const graph = makeValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'goal');
    // Remove edges pointing to goal
    graph.edges = graph.edges.filter((e) => e.to !== 'goal_1');

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'NO_GOAL')).toBe(true);
  });

  it('NO_DECISION: detects missing decision node', () => {
    const graph = makeValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'decision');
    graph.edges = graph.edges.filter((e) => e.from !== 'dec_1');

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'NO_DECISION')).toBe(true);
  });

  it('FEWER_THAN_TWO_OPTIONS: detects fewer than 2 option nodes', () => {
    const graph = makeValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.id !== 'opt_b');
    graph.edges = graph.edges.filter((e) => e.from !== 'opt_b' && e.to !== 'opt_b');

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'FEWER_THAN_TWO_OPTIONS')).toBe(true);
  });

  // ⚠ The NODE_LIMIT_EXCEEDED / EDGE_LIMIT_EXCEEDED cases that stood here
  // pinned an absolute 20-node / 30-edge ceiling this validator no longer
  // owns (removed 2026-08-18 — see the file header of
  // `src/orchestrator/graph-structure-validator.ts` for the measurement).
  // Their INVERSE, plus the opposite-direction twins that guard against
  // over-admission, live in
  // `tests/unit/orchestrator/graph-structure-validator.size-authority.test.ts`.
  // Deleted rather than re-tuned on purpose: a second size pin here is how
  // this file came to out-rank `config/graphCaps.ts` in the first place.

  it('ORPHAN_NODE: detects node with no edges', () => {
    const graph = makeValidGraph();
    graph.nodes.push({ id: 'orphan_1', kind: 'factor', label: 'Orphan' } as GraphV3T['nodes'][number]);

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'ORPHAN_NODE')).toBe(true);
    expect(result.violations.find((v) => v.code === 'ORPHAN_NODE')!.detail).toContain('orphan_1');
  });

  it('NO_PATH_TO_GOAL: detects island subgraph that cannot reach the goal', () => {
    const graph = makeValidGraph();
    // Add a disconnected subgraph (connected to each other but with no path to the goal)
    graph.nodes.push({ id: 'island_a', kind: 'factor', label: 'Island A' } as GraphV3T['nodes'][number]);
    graph.nodes.push({ id: 'island_b', kind: 'factor', label: 'Island B' } as GraphV3T['nodes'][number]);
    graph.edges.push({
      from: 'island_a', to: 'island_b',
      strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
    } as GraphV3T['edges'][number]);

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'NO_PATH_TO_GOAL')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 1.16 diagnosis cluster item C — reachability predicate flip.
  //
  // The second checkPathToGoal loop previously required every edged node
  // to be reachable FROM the decision, which wrongly rejected legitimate
  // exogenous influences: a new node whose ONLY edge is an outbound edge
  // into a factor that reaches the goal (e.g. an external risk driving a
  // cost factor) has a perfectly valid forward path to the goal, yet was
  // rejected NO_PATH_TO_GOAL because nothing points at it from the
  // decision side. The correct predicate — matching the user-facing
  // message "cannot reach the goal" — is a reverse-BFS from the goal:
  // flag nodes that cannot REACH the goal via forward directed edges.
  // ──────────────────────────────────────────────────────────────────────

  describe('NO_PATH_TO_GOAL — reachability predicate (item C, 1.16)', () => {
    it('new node with only an outbound edge into a goal-reaching factor → ACCEPTED', () => {
      const graph = makeValidGraph();
      // Exogenous influence: risk_new → fac_x, and fac_x → goal_1 exists.
      // No inbound edge to risk_new from the decision side.
      graph.nodes.push({ id: 'risk_new', kind: 'risk', label: 'Supplier failure' } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'risk_new', to: 'fac_x',
        strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative',
      } as GraphV3T['edges'][number]);

      const result = validateGraphStructure(graph);
      expect(hasViolation(result, 'NO_PATH_TO_GOAL')).toBe(false);
      expect(result.valid).toBe(true);
    });

    it('true dead-end (edged node with no forward path to the goal) → still fails', () => {
      const graph = makeValidGraph();
      // Sink: opt_a → fac_sink, and fac_sink has no outbound edge — it
      // cannot reach the goal via forward edges.
      graph.nodes.push({ id: 'fac_sink', kind: 'factor', label: 'Dead-end factor' } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'opt_a', to: 'fac_sink',
        strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.7, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);

      const result = validateGraphStructure(graph);
      expect(result.valid).toBe(false);
      expect(hasViolation(result, 'NO_PATH_TO_GOAL')).toBe(true);
      const violation = result.violations.find((v) => v.code === 'NO_PATH_TO_GOAL')!;
      expect(violation.detail).toContain('fac_sink');
    });

    it('orphan option (no factor edge) reports OPTION_NO_FACTOR_EDGES only — no redundant NO_PATH_TO_GOAL', () => {
      // The edit repair loop gates on "ALL new violations repairable"
      // (STRUCTURAL_REPAIRABLE_CODES = {OPTION_NO_FACTOR_EDGES}). An option
      // with no outbound factor edge trivially cannot reach the goal, so
      // without suppression the SAME defect would also emit NO_PATH_TO_GOAL
      // and make the orphan-option repair path unreachable. The specific
      // violation subsumes the generic one for the same node.
      const graph = makeValidGraph();
      graph.nodes.push({ id: 'opt_orphan', kind: 'option', label: 'Orphan Option' } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'dec_1', to: 'opt_orphan',
        strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);

      const result = validateGraphStructure(graph);
      expect(hasViolation(result, 'OPTION_NO_FACTOR_EDGES')).toBe(true);
      expect(hasViolation(result, 'NO_PATH_TO_GOAL')).toBe(false);
    });

    // PR #413 review FIXUP 3 — the predicate flip opened a gap: a FLOATING
    // option (outbound option → factor edge, but NO inbound decision →
    // option edge) reaches the goal, so the new loop 2 passes it — yet the
    // old loop 2 caught it (not reachable FROM the decision). An option no
    // decision can select is structurally meaningless; an explicit check
    // (distinct code + message from NO_PATH_TO_GOAL) closes the gap.
    it('FIXUP 3: floating option (option→factor edge, no decision→option inbound) → violation', () => {
      const graph = makeValidGraph();
      graph.nodes.push({ id: 'opt_float', kind: 'option', label: 'Floating Option' } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'opt_float', to: 'fac_x',
        strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);

      const result = validateGraphStructure(graph);
      expect(result.valid).toBe(false);
      expect(hasViolation(result, 'OPTION_NOT_LINKED_TO_DECISION')).toBe(true);
      const violation = result.violations.find((v) => v.code === 'OPTION_NOT_LINKED_TO_DECISION')!;
      expect(violation.detail).toContain('opt_float');
      // Distinct from the reachability code — this option DOES reach the goal.
      expect(hasViolation(result, 'NO_PATH_TO_GOAL')).toBe(false);
    });

    it('FIXUP 3: normally-linked options (decision→option inbound) pass', () => {
      const result = validateGraphStructure(makeValidGraph());
      expect(hasViolation(result, 'OPTION_NOT_LINKED_TO_DECISION')).toBe(false);
      expect(result.valid).toBe(true);
    });

    it('FIXUP 3: no decision node at all → NO_DECISION owns it (no per-option noise)', () => {
      const graph = makeValidGraph();
      graph.nodes = graph.nodes.filter((n) => n.kind !== 'decision');
      graph.edges = graph.edges.filter((e) => e.from !== 'dec_1');

      const result = validateGraphStructure(graph);
      expect(hasViolation(result, 'NO_DECISION')).toBe(true);
      expect(hasViolation(result, 'OPTION_NOT_LINKED_TO_DECISION')).toBe(false);
    });

    it('goal unreachable from decision still fails via loop 1 (unchanged)', () => {
      const graph = makeValidGraph();
      // Sever the only path into the goal: fac_x → goal_1.
      graph.edges = graph.edges.filter((e) => !(e.from === 'fac_x' && e.to === 'goal_1'));
      // Keep goal edged (so the orphan check doesn't own it instead):
      // goal_1 → island (an outbound edge that does not restore decision→goal).
      graph.nodes.push({ id: 'fac_after_goal', kind: 'factor', label: 'Post-goal factor' } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'goal_1', to: 'fac_after_goal',
        strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);

      const result = validateGraphStructure(graph);
      expect(result.valid).toBe(false);
      expect(hasViolation(result, 'NO_PATH_TO_GOAL')).toBe(true);
      // Loop 1's violation names the goal node.
      expect(
        result.violations.some((v) => v.code === 'NO_PATH_TO_GOAL' && v.detail.includes('goal_1')),
      ).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // OPTION_NO_FACTOR_EDGES — pins the prompt's invariant that an option
  // with no outbound edge to a factor cannot be analysed. Before this rule
  // was added, an LLM that emitted only `add_node opt_*` plus the
  // decision→option structural edge would produce a non-functional option
  // that passed structural validation.
  // ──────────────────────────────────────────────────────────────────────

  describe('OPTION_NO_FACTOR_EDGES', () => {
    it('option with zero outbound edges → fails', () => {
      const graph = makeValidGraph();
      // Remove all outbound edges from opt_a (decision→opt_a stays, but no opt_a→fac_*).
      graph.edges = graph.edges.filter((e) => e.from !== 'opt_a');

      const result = validateGraphStructure(graph);
      expect(result.valid).toBe(false);
      expect(hasViolation(result, 'OPTION_NO_FACTOR_EDGES')).toBe(true);
      const violation = result.violations.find((v) => v.code === 'OPTION_NO_FACTOR_EDGES')!;
      expect(violation.detail).toContain('opt_a');
    });

    it('option with only inbound decision edge → fails (inbound ≠ outbound to factor)', () => {
      const graph = makeValidGraph();
      // Strip both outbound edges from opt_a — leaves only dec_1→opt_a (inbound).
      graph.edges = graph.edges.filter((e) => !(e.from === 'opt_a' && e.to === 'fac_x'));

      const result = validateGraphStructure(graph);
      expect(result.valid).toBe(false);
      expect(hasViolation(result, 'OPTION_NO_FACTOR_EDGES')).toBe(true);
    });

    it('option with outbound edge to outcome only → fails (must be option → factor)', () => {
      const graph: GraphV3T = {
        nodes: [
          { id: 'dec_1', kind: 'decision', label: 'Decide' },
          { id: 'opt_a', kind: 'option', label: 'Option A' },
          { id: 'opt_b', kind: 'option', label: 'Option B' },
          { id: 'fac_x', kind: 'factor', label: 'Cost' },
          { id: 'out_revenue', kind: 'outcome', label: 'Revenue' },
          { id: 'goal_1', kind: 'goal', label: 'Profit' },
        ],
        edges: [
          { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
          { from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
          // opt_a → outcome (NOT a factor) — should NOT satisfy the rule.
          { from: 'opt_a', to: 'out_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
          { from: 'opt_b', to: 'fac_x', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
          { from: 'fac_x', to: 'out_revenue', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
          { from: 'out_revenue', to: 'goal_1', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        ],
      } as unknown as GraphV3T;

      const result = validateGraphStructure(graph);
      expect(result.valid).toBe(false);
      expect(hasViolation(result, 'OPTION_NO_FACTOR_EDGES')).toBe(true);
      // Specifically: opt_a is the violator (its only outbound is to out_revenue).
      const violation = result.violations.find((v) => v.code === 'OPTION_NO_FACTOR_EDGES')!;
      expect(violation.detail).toContain('opt_a');
    });

    it('option with at least one option → factor edge → passes (alongside other valid edges)', () => {
      // The base valid graph already has opt_a → fac_x and opt_b → fac_x.
      const result = validateGraphStructure(makeValidGraph());
      expect(result.valid).toBe(true);
      expect(hasViolation(result, 'OPTION_NO_FACTOR_EDGES')).toBe(false);
    });

    it('repair-loop visibility: orphan-option violation appears in violations array (not just final)', () => {
      // A repair attempt sees the full violations[] from validateGraphStructure
      // — assert OPTION_NO_FACTOR_EDGES is among them so the repair prompt
      // can include it in its error context (caller-visible).
      const graph = makeValidGraph();
      graph.nodes.push({ id: 'opt_orphan', kind: 'option', label: 'Orphan Option' } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'dec_1', to: 'opt_orphan',
        strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);
      // No opt_orphan → fac_* edge.

      const result = validateGraphStructure(graph);
      expect(result.valid).toBe(false);
      const orphanViolations = result.violations.filter((v) => v.code === 'OPTION_NO_FACTOR_EDGES');
      expect(orphanViolations.length).toBe(1);
      expect(orphanViolations[0]!.detail).toContain('opt_orphan');
    });
  });

  it('CYCLE_DETECTED: detects directed cycle', () => {
    const graph = makeValidGraph();
    // Create cycle: goal_1 → fac_x (fac_x→goal_1 already exists)
    graph.edges.push({
      from: 'goal_1', to: 'fac_x',
      strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive',
    } as GraphV3T['edges'][number]);

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'CYCLE_DETECTED')).toBe(true);
  });

  it('reports multiple violations without short-circuiting', () => {
    const graph: GraphV3T = {
      nodes: [
        // No decision, no goal, only 1 option, plus an orphan
        { id: 'opt_a', kind: 'option', label: 'Option A' },
        { id: 'orphan_1', kind: 'factor', label: 'Orphan' },
      ],
      edges: [],
    } as unknown as GraphV3T;

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);

    // Should report at least: NO_GOAL, NO_DECISION, FEWER_THAN_TWO_OPTIONS, ORPHAN_NODE (×2)
    expect(hasViolation(result, 'NO_GOAL')).toBe(true);
    expect(hasViolation(result, 'NO_DECISION')).toBe(true);
    expect(hasViolation(result, 'FEWER_THAN_TWO_OPTIONS')).toBe(true);
    expect(hasViolation(result, 'ORPHAN_NODE')).toBe(true);
    expect(result.violations.length).toBeGreaterThanOrEqual(4);
  });

  // ⚠ Three further cases stood here and are gone with the clause they pinned:
  //   - 'defaults are 20 nodes / 30 edges'
  //   - 'env override: CEE_GRAPH_MAX_NODES and CEE_GRAPH_MAX_EDGES are respected'
  //   - 'NaN env values fall back to defaults (limits still enforced)'
  // `validateGraphStructure` no longer reads either env var, so those three
  // could only be kept by resurrecting the ceiling they tested. The
  // replacement pin is the opposite assertion — setting
  // CEE_GRAPH_MAX_NODES=4 must NOT reintroduce a refusal — and it lives in
  // `graph-structure-validator.size-authority.test.ts`.
});
