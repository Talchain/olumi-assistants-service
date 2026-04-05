/**
 * draft_graph timeout configuration and error copy tests
 */

import { describe, it, expect } from "vitest";
import { ORCHESTRATOR_TURN_BUDGET_MS, DRAFT_GRAPH_TURN_BUDGET_MS } from "../../../../src/config/timeouts.js";

describe('draft_graph timeout configuration', () => {
  it('DRAFT_GRAPH_TURN_BUDGET_MS is longer than standard turn budget', () => {
    expect(DRAFT_GRAPH_TURN_BUDGET_MS).toBeGreaterThan(ORCHESTRATOR_TURN_BUDGET_MS);
  });

  it('DRAFT_GRAPH_TURN_BUDGET_MS defaults to 90s', () => {
    // Env var may override, but default should be 90_000
    expect(DRAFT_GRAPH_TURN_BUDGET_MS).toBe(90_000);
  });

  it('standard turn budget remains at 60s', () => {
    expect(ORCHESTRATOR_TURN_BUDGET_MS).toBe(60_000);
  });
});
