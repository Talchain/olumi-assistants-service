/**
 * Tests for the pure buildAnalysisBlocksAndGuidance transformer.
 *
 * Verifies: no side effects, correct block types/order, guidance generation.
 */

import { describe, it, expect, vi } from "vitest";
import { buildAnalysisBlocksAndGuidance } from "../../../../src/orchestrator/tools/analysis-blocks.js";
import type { V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";

// Mock telemetry to avoid log output in tests
vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeAnalysisResponse(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
    meta: {
      seed_used: 42,
      n_samples: 100,
      response_hash: 'rh-test',
    },
    results: [
      {
        option_label: 'Option A',
        win_probability: 0.7,
      },
    ],
    fact_objects: [
      { fact_type: 'option_comparison', option_label: 'Option A', win_probability: 0.7 },
    ],
    review_cards: [
      { card_type: 'proposal', content: 'Consider this proposal' },
    ],
    response_hash: 'rh-test',
    ...overrides,
  } as unknown as V2RunResponseEnvelope;
}

describe('buildAnalysisBlocksAndGuidance', () => {
  it('returns blocks array and guidanceItems array', () => {
    const response = makeAnalysisResponse();
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');

    expect(Array.isArray(result.blocks)).toBe(true);
    expect(Array.isArray(result.guidanceItems)).toBe(true);
  });

  it('builds FactBlock from fact_objects', () => {
    const response = makeAnalysisResponse();
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');

    const factBlocks = result.blocks.filter((b) => b.block_type === 'fact');
    expect(factBlocks.length).toBeGreaterThanOrEqual(1);
    const factData = factBlocks[0].data as unknown as Record<string, unknown>;
    expect(factData.fact_type).toBe('option_comparison');
  });

  it('builds ReviewCardBlock from review_cards', () => {
    const response = makeAnalysisResponse();
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');

    const reviewBlocks = result.blocks.filter((b) => b.block_type === 'review_card');
    expect(reviewBlocks.length).toBe(1);
  });

  it('returns responseHash from top-level response_hash', () => {
    const response = makeAnalysisResponse({ response_hash: 'top-level-hash' });
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');
    expect(result.responseHash).toBe('top-level-hash');
  });

  it('returns responseHash from meta when top-level absent', () => {
    const response = makeAnalysisResponse();
    delete (response as Record<string, unknown>).response_hash;
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');
    expect(result.responseHash).toBe('rh-test'); // from meta
  });

  it('skips FactBlocks when fact_objects is empty', () => {
    const response = makeAnalysisResponse({ fact_objects: [] });
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');

    const factBlocks = result.blocks.filter((b) => b.block_type === 'fact');
    expect(factBlocks).toHaveLength(0);
  });

  it('skips ReviewCardBlocks when review_cards is empty', () => {
    const response = makeAnalysisResponse({ review_cards: [] });
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');

    const reviewBlocks = result.blocks.filter((b) => b.block_type === 'review_card');
    expect(reviewBlocks).toHaveLength(0);
  });

  it('skips FactBlocks when fact_objects is absent', () => {
    const response = makeAnalysisResponse();
    delete (response as Record<string, unknown>).fact_objects;
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');

    const factBlocks = result.blocks.filter((b) => b.block_type === 'fact');
    expect(factBlocks).toHaveLength(0);
  });

  it('preserves block order: FactBlocks before ReviewCardBlocks', () => {
    const response = makeAnalysisResponse({
      fact_objects: [
        { fact_type: 'option_comparison', option_label: 'A', win_probability: 0.6 },
      ],
      review_cards: [
        { card_type: 'proposal', content: 'test' },
      ],
    });
    const result = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');

    const blockTypes = result.blocks.map((b) => b.block_type);
    const factIdx = blockTypes.indexOf('fact');
    const reviewIdx = blockTypes.indexOf('review_card');
    expect(factIdx).toBeLessThan(reviewIdx);
  });

  it('has no side effects — calling twice returns same structure', () => {
    const response = makeAnalysisResponse();
    const r1 = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');
    const r2 = buildAnalysisBlocksAndGuidance(response, null, 'turn-1');

    expect(r1.blocks.length).toBe(r2.blocks.length);
    expect(r1.responseHash).toBe(r2.responseHash);
  });
});
