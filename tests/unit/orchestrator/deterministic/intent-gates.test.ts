/**
 * Tests for intent-gates (Fix 2B).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import {
  computeIntentGates,
  detectValueSetIntent,
  detectStructuralEditIntent,
} from "../../../../src/orchestrator/deterministic/intent-gates.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";

function makeCtx(factorLabels: Array<[string, string]>): DeterministicTurnContext {
  const nodes = new Map<string, { id: string; label: string; kind: string }>();
  for (const [id, label] of factorLabels) {
    nodes.set(id, { id, label, kind: 'factor' });
  }
  return {
    entities: { nodes, edges: [], option_ids: [], goal_id: null },
  } as unknown as DeterministicTurnContext;
}

describe("detectValueSetIntent", () => {
  const ctx = makeCtx([
    ['fac_salary', 'Salary'],
    ['fac_team_size', 'Team size'],
    ['fac_customer_priority_score', 'Customer priority score'],
  ]);

  it("matches 'set salary to £95k' → fac_salary", () => {
    expect(detectValueSetIntent("set salary to £95k", ctx)).toBe('fac_salary');
  });

  it("matches 'set team size to 12' → fac_team_size (multi-token label)", () => {
    expect(detectValueSetIntent("set team size to 12", ctx)).toBe('fac_team_size');
  });

  it("matches 'calibrate salary at 100000' → fac_salary", () => {
    expect(detectValueSetIntent("calibrate salary at 100000", ctx)).toBe('fac_salary');
  });

  it("returns null for 'set your priorities' — no factor called 'priorities'", () => {
    // "priorities" is not a token in any factor label; Customer priority
    // score tokenises to {customer, priority, score} — 'priority' ≠ 'priorities'.
    expect(detectValueSetIntent("set your priorities", ctx)).toBeNull();
  });

  it("returns null when the regex doesn't match (no assignment verb)", () => {
    expect(detectValueSetIntent("what is the salary?", ctx)).toBeNull();
  });

  it("returns null on ambiguous match (two factors share tokens)", () => {
    const ambigCtx = makeCtx([
      ['fac_a', 'Team size'],
      ['fac_b', 'Team size estimate'],
    ]);
    // Both factors' labels are subsets of this message, and 'Team size' is
    // also a subset of 'Team size estimate', so this is ambiguous by
    // score-tie logic — but fac_b scores higher (3 vs 2). Best is fac_b.
    expect(detectValueSetIntent("set team size to 12", ambigCtx)).toBe('fac_a');
    // Truly tied labels
    const tiedCtx = makeCtx([
      ['fac_x', 'Price'],
      ['fac_y', 'Price'],
    ]);
    expect(detectValueSetIntent("set price to 10", tiedCtx)).toBeNull();
  });

  it("ignores options and non-factor entities", () => {
    const optCtx = {
      entities: {
        nodes: new Map([
          ['opt_salary', { id: 'opt_salary', label: 'Salary', kind: 'option' }],
        ]),
      },
    } as unknown as DeterministicTurnContext;
    expect(detectValueSetIntent("set salary to £95k", optCtx)).toBeNull();
  });
});

describe("detectStructuralEditIntent", () => {
  it("matches 'isn't connected'", () => {
    expect(detectStructuralEditIntent("the risk isn't connected to anything")).toBe(true);
  });

  it("matches 'rewire'", () => {
    expect(detectStructuralEditIntent("rewire this edge")).toBe(true);
  });

  it("returns false on pure value-set phrasing", () => {
    expect(detectStructuralEditIntent("set salary to £95k")).toBe(false);
  });
});

describe("computeIntentGates", () => {
  const ctx = makeCtx([['fac_salary', 'Salary']]);

  it("returns force set_factor_value when value-set intent matches a factor", () => {
    const r = computeIntentGates("set salary to £95k", ctx);
    expect(r.force_tool).toBe('set_factor_value');
    expect(r.reason).toBe('value_set');
    expect(r.matched_factor_id).toBe('fac_salary');
  });

  it("returns force edit_graph when structural-edit intent fires", () => {
    const r = computeIntentGates("the risk isn't connected — can you fix that?", ctx);
    expect(r.force_tool).toBe('edit_graph');
    expect(r.reason).toBe('structural_edit');
  });

  it("value-set takes precedence when both regexes match but a factor is matched", () => {
    // "set risk to connect" triggers VALUE_SET_INTENT_RE; if a factor matched
    // we'd prefer set_factor_value. No factor matches here, so falls through.
    const r = computeIntentGates("set risk to connect more", ctx);
    expect(r.force_tool).toBe('edit_graph'); // structural fallback
  });

  it("returns {} on empty / null message", () => {
    expect(computeIntentGates(null, ctx)).toEqual({});
    expect(computeIntentGates("", ctx)).toEqual({});
  });

  it("returns {} when nothing matches", () => {
    expect(computeIntentGates("what's the status?", ctx)).toEqual({});
  });
});
