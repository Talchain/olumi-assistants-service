/**
 * Post-Analysis Guidance Generation Tests
 */

import { describe, it, expect } from "vitest";
import { generatePostAnalysisGuidance } from "../../../../src/orchestrator/guidance/post-analysis.js";
import { SIGNAL_CODES } from "../../../../src/orchestrator/types/guidance-item.js";
import type { V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeResponse(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
    results: [
      { option_label: 'Option A', win_probability: 0.65 },
      { option_label: 'Option B', win_probability: 0.35 },
    ],
    factor_sensitivity: [],
    fact_objects: [],
    review_cards: [],
    response_hash: 'test-hash-abc',
    ...overrides,
  } as V2RunResponseEnvelope;
}

// ============================================================================
// Tests
// ============================================================================

describe("generatePostAnalysisGuidance", () => {
  describe("ProposalCard conversion", () => {
    it("converts critical priority_band cards to PROPOSAL_CARD_CRITICAL must_fix", () => {
      const response = makeResponse({
        review_cards: [
          { priority_band: 'critical', title: 'Critical issue', description: 'Fix this now' },
        ] as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.PROPOSAL_CARD_CRITICAL);
      expect(item).toBeDefined();
      expect(item?.category).toBe('must_fix');
      expect(item?.priority).toBe(90);
    });

    it("converts high priority_band to PROPOSAL_CARD_HIGH must_fix", () => {
      const response = makeResponse({
        review_cards: [{ priority_band: 'high', title: 'High priority' }] as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.PROPOSAL_CARD_HIGH);
      expect(item).toBeDefined();
      expect(item?.category).toBe('must_fix');
    });

    it("converts medium priority_band to PROPOSAL_CARD_MEDIUM should_fix", () => {
      const response = makeResponse({
        review_cards: [{ priority_band: 'medium', title: 'Medium priority' }] as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.PROPOSAL_CARD_MEDIUM);
      expect(item).toBeDefined();
      expect(item?.category).toBe('should_fix');
    });

    it("converts low priority_band to PROPOSAL_CARD_LOW could_fix", () => {
      const response = makeResponse({
        review_cards: [{ priority_band: 'low', title: 'Low priority' }] as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.PROPOSAL_CARD_LOW);
      expect(item).toBeDefined();
      expect(item?.category).toBe('could_fix');
    });

    it("uses open_inspector action when card has node_id", () => {
      const response = makeResponse({
        review_cards: [{ priority_band: 'high', title: 'High', node_id: 'n1' }] as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.primary_action.type === 'open_inspector');
      expect(item).toBeDefined();
    });

    it("verifies fact_ids against fact_objects", () => {
      const response = makeResponse({
        fact_objects: [{ fact_id: 'f1', fact_type: 'win_probability' }] as any,
        review_cards: [{
          priority_band: 'high',
          title: 'High',
          citation_ids: ['f1', 'f_missing'],
        }] as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.PROPOSAL_CARD_HIGH);
      expect(item).toBeDefined();
      expect(item?.fact_ids).toContain('f1');
      // f_missing is not in fact_objects — goes to citations
      expect(item?.fact_ids).not.toContain('f_missing');
    });

    it("sets valid_while.analysis_hash from response_hash", () => {
      const response = makeResponse({ response_hash: 'abc123' });
      const items = generatePostAnalysisGuidance(response, null);
      for (const item of items) {
        if (item.valid_while?.analysis_hash) {
          expect(item.valid_while.analysis_hash).toBe('abc123');
        }
      }
    });
  });

  describe("factor_sensitivity", () => {
    it("includes HIGH_INFLUENCE_LOW_CONFIDENCE for factor influence > 0.3 with default confidence", () => {
      const response = makeResponse({
        factor_sensitivity: [
          { label: 'Cost', elasticity: 0.5, node_id: 'n1' },
        ] as any,
      });
      const graph = {
        schema_version: 'v3',
        nodes: [{ id: 'n1', kind: 'factor', label: 'Cost', exists_probability: 0.8 }],
        edges: [],
      } as any;
      const items = generatePostAnalysisGuidance(response, graph);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.HIGH_INFLUENCE_LOW_CONFIDENCE);
      expect(item).toBeDefined();
    });

    it("excludes factor with influence ≤ 0.3", () => {
      const response = makeResponse({
        factor_sensitivity: [
          { label: 'Minor', elasticity: 0.29, node_id: 'n1' },
        ] as any,
      });
      const graph = {
        schema_version: 'v3',
        nodes: [{ id: 'n1', kind: 'factor', label: 'Minor', exists_probability: 0.8 }],
        edges: [],
      } as any;
      const items = generatePostAnalysisGuidance(response, graph);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.HIGH_INFLUENCE_LOW_CONFIDENCE);
      expect(item).toBeUndefined();
    });

    it("excludes factor with high influence but non-default confidence", () => {
      const response = makeResponse({
        factor_sensitivity: [
          { label: 'Strong', elasticity: 0.8, node_id: 'n1' },
        ] as any,
      });
      const graph = {
        schema_version: 'v3',
        nodes: [{ id: 'n1', kind: 'factor', label: 'Strong', exists_probability: 0.95 }], // non-default
        edges: [],
      } as any;
      const items = generatePostAnalysisGuidance(response, graph);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.HIGH_INFLUENCE_LOW_CONFIDENCE);
      expect(item).toBeUndefined();
    });
  });

  describe("robustness", () => {
    it("emits FRAGILE_RESULT when level is 'fragile'", () => {
      const response = makeResponse({ robustness: { level: 'fragile', fragile_edges: [] } as any });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.FRAGILE_RESULT);
      expect(item).toBeDefined();
      expect(item?.category).toBe('must_fix');
      expect(item?.priority).toBe(85);
    });

    it("does NOT emit FRAGILE_RESULT when level is 'robust'", () => {
      const response = makeResponse({ robustness: { level: 'robust', fragile_edges: [] } as any });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.FRAGILE_RESULT);
      expect(item).toBeUndefined();
    });
  });

  describe("constraint violations", () => {
    it("emits CONSTRAINT_VIOLATION for prob < 0.5", () => {
      const response = makeResponse({
        constraint_analysis: {
          per_constraint: [
            { constraint_id: 'c1', label: 'Budget', probability: 0.3 },
          ],
          joint_probability: 0.3,
        } as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.CONSTRAINT_VIOLATION);
      expect(item).toBeDefined();
    });

    it("does NOT emit CONSTRAINT_VIOLATION for prob >= 0.5", () => {
      const response = makeResponse({
        constraint_analysis: {
          per_constraint: [
            { constraint_id: 'c1', label: 'Budget', probability: 0.6 },
          ],
          joint_probability: 0.6,
        } as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.CONSTRAINT_VIOLATION);
      expect(item).toBeUndefined();
    });
  });

  describe("technique offers", () => {
    it("offers TECHNIQUE_PRE_MORTEM when result is fragile", () => {
      const response = makeResponse({ robustness: { level: 'fragile', fragile_edges: [] } as any });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.TECHNIQUE_PRE_MORTEM);
      expect(item).toBeDefined();
      expect(item?.category).toBe('technique');
      expect(item?.primary_action.type).toBe('run_exercise');
    });

    it("offers TECHNIQUE_DISCONFIRMATION when top option win_prob > 0.7", () => {
      const response = makeResponse({
        results: [
          { option_label: 'A', win_probability: 0.80 },
          { option_label: 'B', win_probability: 0.20 },
        ] as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.TECHNIQUE_DISCONFIRMATION);
      expect(item).toBeDefined();
    });

    it("offers TECHNIQUE_DEVIL_ADVOCATE when top two are within 10%", () => {
      const response = makeResponse({
        results: [
          { option_label: 'A', win_probability: 0.52 },
          { option_label: 'B', win_probability: 0.48 },
        ] as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.TECHNIQUE_DEVIL_ADVOCATE);
      expect(item).toBeDefined();
    });
  });

  describe("capping and determinism", () => {
    it("returns at most 12 items", () => {
      const manyCards = Array.from({ length: 15 }, (_, i) => ({
        priority_band: 'high',
        title: `Card ${i}`,
        description: `Description ${i}`,
      }));
      const response = makeResponse({
        review_cards: manyCards as any,
        robustness: { level: 'fragile', fragile_edges: [] } as any,
      });
      const items = generatePostAnalysisGuidance(response, null);
      expect(items.length).toBeLessThanOrEqual(12);
    });

    it("is deterministic for identical input", () => {
      const response = makeResponse({
        review_cards: [{ priority_band: 'high', title: 'Issue' }] as any,
      });
      const a = generatePostAnalysisGuidance(response, null);
      const b = generatePostAnalysisGuidance(response, null);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});
