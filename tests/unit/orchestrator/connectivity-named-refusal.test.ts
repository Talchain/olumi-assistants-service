/**
 * POC-BOARD #5c — connectivity/orphan NAMED refusal (pure helper unit tests).
 *
 * Proves the pure helper in isolation:
 *   - a genuine final-state connectivity failure (orphan / no-path) yields a
 *     refusal that NAMES the specific offending node label(s);
 *   - a mixed / non-connectivity failure defers (returns null → caller keeps the
 *     generic copy) — no over-broadening;
 *   - the rendered copy carries no held-science vocabulary, no internal
 *     identifiers, and no forbidden user-facing phrase (egress-guard safe);
 *   - PRINCIPLE (a) PIN: validation is of the FINAL post-batch state — a batch
 *     whose end state IS connected (add item + edge connecting it) passes with
 *     zero new violations, while the same add WITHOUT the connecting edge is the
 *     one that legitimately fails. This locks final-state (not per-op /
 *     intermediate-state) validation against a future regression.
 */

import { describe, it, expect } from 'vitest';
import {
  buildConnectivityNamedRefusal,
  renderConnectivityNamedRefusal,
} from '../../../src/orchestrator/connectivity-named-refusal.js';
import type { StructuralViolation } from '../../../src/orchestrator/graph-structure-validator.js';
import { validateGraphStructure } from '../../../src/orchestrator/graph-structure-validator.js';
import { applyPatchOperations } from '../../../src/orchestrator/patch-applier.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';
import type { PatchOperation } from '../../../src/orchestrator/types.js';
import {
  findForbiddenPhraseHit,
  HELD_SCIENCE_VOCABULARY_PATTERN,
} from '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';

// ────────────────────────────────────────────────────────────────────
// Fixtures — a minimal, structurally-valid base graph (mirrors PRICING_GRAPH).
// ────────────────────────────────────────────────────────────────────

const n = (id: string, kind: string, label: string) => ({ id, kind, label });
const e = (from: string, to: string) => ({
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const BASE: GraphV3T = {
  nodes: [
    n('goal_growth', 'goal', 'Reach 1000 customers'),
    n('dec_pricing', 'decision', 'Pricing model'),
    n('opt_subscription', 'option', 'Subscription'),
    n('opt_oneoff', 'option', 'One-off'),
    n('fac_price', 'factor', 'Price'),
  ],
  edges: [
    e('dec_pricing', 'opt_subscription'),
    e('dec_pricing', 'opt_oneoff'),
    e('opt_subscription', 'fac_price'),
    e('opt_oneoff', 'fac_price'),
    e('fac_price', 'goal_growth'),
  ],
} as unknown as GraphV3T;

const g = (graph: GraphV3T): GraphV3T => graph;

// Compute the NEW violations for a candidate graph (BASE has none).
function newViolations(candidate: GraphV3T): StructuralViolation[] {
  return validateGraphStructure(candidate).violations;
}

describe('buildConnectivityNamedRefusal — names the specific offending item', () => {
  it('single orphan (no edges) → refusal names that node label', () => {
    const candidate = g({
      nodes: [...BASE.nodes, n('risk_competitor', 'risk', 'Competitor Response')],
      edges: [...BASE.edges], // risk has NO edge → ORPHAN_NODE
    } as unknown as GraphV3T);

    const violations = newViolations(candidate);
    expect(violations.map((v) => v.code)).toContain('ORPHAN_NODE');

    const copy = buildConnectivityNamedRefusal(candidate, violations);
    expect(copy).not.toBeNull();
    expect(copy).toContain('"Competitor Response"');
    // Honest all-or-nothing framing — nothing partially applied.
    expect(copy).toContain('left everything as it was');
    // Exactly the single-source-of-truth render (no drift).
    expect(copy).toBe(renderConnectivityNamedRefusal(['Competitor Response']));
  });

  it('single dead-end (inbound only, no path to goal) → refusal names that node label', () => {
    const candidate = g({
      nodes: [...BASE.nodes, n('risk_team', 'risk', 'Team dynamics')],
      edges: [...BASE.edges, e('opt_subscription', 'risk_team')], // sink → NO_PATH_TO_GOAL
    } as unknown as GraphV3T);

    const violations = newViolations(candidate);
    expect(violations.map((v) => v.code)).toContain('NO_PATH_TO_GOAL');

    const copy = buildConnectivityNamedRefusal(candidate, violations);
    expect(copy).not.toBeNull();
    expect(copy).toContain('"Team dynamics"');
  });

  it('two offending items → refusal names both labels', () => {
    const copy = renderConnectivityNamedRefusal(['Competitor Response', 'Team dynamics']);
    expect(copy).toContain('"Competitor Response"');
    expect(copy).toContain('"Team dynamics"');
    expect(copy).toContain('and');
  });

  it('mixed failure (connectivity + cycle) → defers to the generic copy (null)', () => {
    // A candidate that both orphans a node AND creates a cycle is not a pure
    // connectivity failure — the helper must not over-claim.
    const mixed: StructuralViolation[] = [
      { code: 'ORPHAN_NODE', detail: 'Node "risk_x" (Some risk) has no edges' },
      { code: 'CYCLE_DETECTED', detail: 'Directed cycle detected in graph' },
    ];
    const candidate = g({
      nodes: [...BASE.nodes, n('risk_x', 'risk', 'Some risk')],
      edges: [...BASE.edges],
    } as unknown as GraphV3T);
    expect(buildConnectivityNamedRefusal(candidate, mixed)).toBeNull();
  });

  it('non-connectivity failure (cycle only) → defers to the generic copy (null)', () => {
    const cycleOnly: StructuralViolation[] = [
      { code: 'CYCLE_DETECTED', detail: 'Directed cycle detected in graph' },
    ];
    expect(buildConnectivityNamedRefusal(BASE, cycleOnly)).toBeNull();
  });

  it('empty violations → null', () => {
    expect(buildConnectivityNamedRefusal(BASE, [])).toBeNull();
  });

  it('goal-level-only reachability (no per-node id) → null (fail-safe)', () => {
    const goalOnly: StructuralViolation[] = [
      { code: 'NO_PATH_TO_GOAL', detail: 'Goal node "goal_growth" (Reach 1000 customers) not reachable from decision node' },
    ];
    expect(buildConnectivityNamedRefusal(BASE, goalOnly)).toBeNull();
  });
});

describe('connectivity named-refusal copy is claim-safe / egress-guard clean', () => {
  const samples = [
    renderConnectivityNamedRefusal(['Competitor Response']),
    renderConnectivityNamedRefusal(['Team dynamics', 'Competitor Response']),
    renderConnectivityNamedRefusal(['A', 'B', 'C']),
  ];

  it('no forbidden user-facing phrase (survives the runtime egress guard)', () => {
    for (const copy of samples) {
      expect(findForbiddenPhraseHit(copy)).toBeNull();
    }
  });

  it('no held-science vocabulary', () => {
    for (const copy of samples) {
      expect(copy).not.toMatch(HELD_SCIENCE_VOCABULARY_PATTERN);
    }
  });

  it('no internal implementation vocabulary (node/edge/graph/validator/schema/patch/recommend)', () => {
    for (const copy of samples) {
      expect(copy).not.toMatch(/\b(validator|schema|patch|node|edge|graph|recommend)\b/i);
    }
  });
});

describe('PRINCIPLE (a) PIN — validation is of the FINAL post-batch state', () => {
  it('add item + edge connecting it to the goal → zero new violations (the batch PASSES)', () => {
    const ops = [
      { op: 'add_node', path: 'risk_supply', value: { id: 'risk_supply', kind: 'risk', label: 'Supply shock' } },
      {
        op: 'add_edge',
        path: 'risk_supply->goal_growth',
        value: { from: 'risk_supply', to: 'goal_growth', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
      },
    ] as unknown as PatchOperation[];

    const candidate = applyPatchOperations(BASE, ops);
    // Final state is connected: the risk reaches the goal via its own edge.
    expect(validateGraphStructure(candidate).valid).toBe(true);
    // And the helper produces no refusal (nothing to refuse).
    expect(buildConnectivityNamedRefusal(candidate, validateGraphStructure(candidate).violations)).toBeNull();
  });

  it('same add WITHOUT the connecting edge → ORPHAN_NODE naming that item (the batch FAILS honestly)', () => {
    const ops = [
      { op: 'add_node', path: 'risk_supply', value: { id: 'risk_supply', kind: 'risk', label: 'Supply shock' } },
    ] as unknown as PatchOperation[];

    const candidate = applyPatchOperations(BASE, ops);
    const violations = validateGraphStructure(candidate).violations;
    expect(violations.some((v) => v.code === 'ORPHAN_NODE')).toBe(true);

    const copy = buildConnectivityNamedRefusal(candidate, violations);
    expect(copy).toContain('"Supply shock"');
  });
});
