/**
 * draft_graph timeout configuration and error copy tests
 */

import { describe, it, expect } from "vitest";
import { ORCHESTRATOR_TURN_BUDGET_MS, DRAFT_GRAPH_TURN_BUDGET_MS } from "../../../../src/config/timeouts.js";

describe('draft_graph timeout configuration', () => {
  it('DRAFT_GRAPH_TURN_BUDGET_MS is longer than standard turn budget', () => {
    expect(DRAFT_GRAPH_TURN_BUDGET_MS).toBeGreaterThan(ORCHESTRATOR_TURN_BUDGET_MS);
  });

  it('DRAFT_GRAPH_TURN_BUDGET_MS is at least 90s', () => {
    // Env var may increase the default; assert minimum floor
    expect(DRAFT_GRAPH_TURN_BUDGET_MS).toBeGreaterThanOrEqual(90_000);
  });

  it('standard turn budget is at most DRAFT_GRAPH_TURN_BUDGET_MS', () => {
    expect(ORCHESTRATOR_TURN_BUDGET_MS).toBeLessThanOrEqual(DRAFT_GRAPH_TURN_BUDGET_MS);
  });

  it('both budgets are within clamped range (5s–5min)', () => {
    expect(ORCHESTRATOR_TURN_BUDGET_MS).toBeGreaterThanOrEqual(5_000);
    expect(ORCHESTRATOR_TURN_BUDGET_MS).toBeLessThanOrEqual(300_000);
    expect(DRAFT_GRAPH_TURN_BUDGET_MS).toBeGreaterThanOrEqual(5_000);
    expect(DRAFT_GRAPH_TURN_BUDGET_MS).toBeLessThanOrEqual(300_000);
  });
});
