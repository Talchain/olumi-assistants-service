/**
 * Capability 2A — rejection-render integration (envelope level).
 *
 * Exercises the SAME composition the flag-gated branch in edit-graph.ts runs:
 *   classifyAddRiskToOptionRejection(...) → (optional) ctx.structural_guidance →
 *   buildPatchRejectionEnvelope(...).
 *
 * Proves: flag-OFF/non-targeted rejection output is BYTE-IDENTICAL to the
 * pre-change generic copy; the targeted add-risk case is enriched with the
 * structural next step; chips are unchanged; budget rejections are unaffected;
 * the enriched copy carries no held-science / no invented mechanism.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPatchRejectionEnvelope, type PatchRejectionContext } from '../../../src/orchestrator/patch-rejection-helper.js';
import type { ConversationContext } from '../../../src/orchestrator/types.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';
import { validateGraphStructure, VIOLATION_MESSAGES } from '../../../src/orchestrator/graph-structure-validator.js';
import {
  classifyAddRiskToOptionRejection,
  ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER,
} from '../../../src/orchestrator/add-risk-rejection-guidance.js';

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

const ctx: ConversationContext = { messages: [], framing: null, graph: null, analysis_response: null, scenario_id: 'test' };

// The exact pre-change generic structural-violation copy — the byte-identical baseline.
const GENERIC =
  "I wasn't able to apply that change — it would create an inconsistency in the model structure. You could try describing the change differently, or I can rebuild the model from an updated brief.";

const STRUCT_CHIPS = [
  { role: 'facilitator' as const, label: 'Simplify the change', prompt: 'Try a simpler version of this change.' },
  { role: 'challenger' as const, label: 'Rebuild from updated brief', prompt: 'Would you like to rebuild the model from an updated brief instead?' },
];

const n = (id: string, kind: string, label: string) => ({ id, kind, label });
const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
const BASE_NODES = [
  n('dec_1', 'decision', 'Hiring decision'), n('goal_q3', 'goal', 'Q3 launch'),
  n('fac_capacity', 'factor', 'Technical Leadership Capacity'), n('fac_velocity', 'factor', 'Feature Delivery Velocity'),
  n('opt_hire', 'option', 'Hire One Tech Lead'), n('opt_hold', 'option', 'Hold'),
];
const BASE_EDGES = [
  e('dec_1', 'opt_hire'), e('dec_1', 'opt_hold'), e('opt_hire', 'fac_capacity'), e('opt_hold', 'fac_capacity'),
  e('fac_capacity', 'fac_velocity'), e('fac_velocity', 'goal_q3'),
];
const g = (nodes: ReturnType<typeof n>[], edges: ReturnType<typeof e>[]): GraphV3T => ({ nodes, edges } as unknown as GraphV3T);

// Simulate the edit-graph.ts structural-reject construction for a given graph,
// at a given flag state. Returns the rendered assistant_text + chips.
function renderRejection(graph: GraphV3T, flagOn: boolean) {
  const violations = validateGraphStructure(graph).violations;
  const translated = violations.map((v) => VIOLATION_MESSAGES[v.code] ?? v.detail);
  const rejectionCtx: PatchRejectionContext = {
    reason: 'structural_violation',
    detail: 'Consider simplifying the change or approaching it differently.',
    violations: translated,
    suggested_actions: [...STRUCT_CHIPS],
  };
  if (flagOn) {
    const match = classifyAddRiskToOptionRejection(graph, violations);
    if (match) rejectionCtx.structural_guidance = ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER;
  }
  const env = buildPatchRejectionEnvelope(rejectionCtx, 'turn', ctx);
  return { text: env.assistant_text ?? '', chips: env.suggested_actions };
}

const RISK = n('risk_resent', 'risk', 'Team resents new tech lead');
const TARGETED = g([...BASE_NODES, RISK], [...BASE_EDGES, e('risk_resent', 'opt_hire')]); // risk→option → NO_PATH_TO_GOAL
const CYCLE = g([...BASE_NODES], [...BASE_EDGES, e('goal_q3', 'fac_capacity')]); // CYCLE_DETECTED
const ORPHAN_FACTOR = g([...BASE_NODES, n('fac_orphan', 'factor', 'Unconnected factor')], [...BASE_EDGES]); // ORPHAN on a factor

describe('2A rejection render — flag parity + targeted enrichment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flag OFF: targeted add-risk rejection is BYTE-IDENTICAL to the generic copy', () => {
    expect(renderRejection(TARGETED, false).text).toBe(GENERIC);
  });

  it('flag ON + non-targeted (cycle): BYTE-IDENTICAL to the generic copy', () => {
    expect(renderRejection(CYCLE, true).text).toBe(GENERIC);
  });

  it('flag ON + non-targeted (orphan factor): BYTE-IDENTICAL to the generic copy', () => {
    expect(renderRejection(ORPHAN_FACTOR, true).text).toBe(GENERIC);
  });

  it('flag ON + targeted add-risk-to-option: enriched with the structural next step', () => {
    const out = renderRejection(TARGETED, true);
    expect(out.text).toBe(ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER);
    expect(out.text).not.toBe(GENERIC);
  });

  it('chips are unchanged between generic and enriched renders', () => {
    const off = renderRejection(TARGETED, false);
    const on = renderRejection(TARGETED, true);
    expect(on.chips).toEqual(off.chips);
  });

  it('budget_exceeded is unaffected even if structural_guidance is set', () => {
    const env = buildPatchRejectionEnvelope(
      { reason: 'budget_exceeded', detail: 'x', node_ops: 5, edge_ops: 2, structural_guidance: 'SHOULD NOT APPEAR', suggested_actions: [...STRUCT_CHIPS] },
      'turn', ctx,
    );
    expect(env.assistant_text).toContain('5 node operations');
    expect(env.assistant_text).not.toContain('SHOULD NOT APPEAR');
  });

  it('enriched copy: no held-science, no invented mechanism, no internal vocab', () => {
    const out = renderRejection(TARGETED, true);
    expect(out.text).not.toMatch(/\b(sensitiv\w*|fragile|fragility|flip|robustness|vulnerable|influence|elasticity)\b/i);
    expect(out.text.toLowerCase()).not.toContain('must flow through');
    expect(out.text).not.toMatch(/\b(validator|schema|patch|node|edge|graph|recommend)\b/i);
  });

  // NOTE: existing SUCCESSFUL edits never reach this structural-rejection branch
  // (it is in the reject path only), and the flag is default-OFF — so successful
  // edits are unaffected by construction. The e2e add-risk success suites cover
  // the success path separately (inherited env-dependent reds aside).
});
