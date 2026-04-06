/**
 * Response Normaliser Tests
 */

import { describe, it, expect, vi } from "vitest";
import { normaliseDeterministicResponse, scanBannedTerms } from "../../../../src/orchestrator/deterministic/response-normaliser.js";
import type { OrchestratorResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { LLMJsonResponse } from "../../../../src/orchestrator/deterministic/types.js";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  emit: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeEnvelope(overrides: Partial<OrchestratorResponseEnvelope> = {}): OrchestratorResponseEnvelope {
  return {
    turn_id: 'test-turn',
    assistant_text: overrides.assistant_text ?? 'Hello',
    blocks: overrides.blocks ?? [],
    lineage: { context_hash: 'abc123' },
    ...overrides,
  };
}

describe('normaliseDeterministicResponse', () => {
  it('provides default text when empty', () => {
    const envelope = makeEnvelope({ assistant_text: '' });
    const result = normaliseDeterministicResponse(envelope);
    expect(result.assistant_text).toBeTruthy();
    expect(result.assistant_text!.length).toBeGreaterThan(0);
  });

  it('provides default text when null', () => {
    const envelope = makeEnvelope({ assistant_text: null });
    const result = normaliseDeterministicResponse(envelope);
    expect(result.assistant_text).toBeTruthy();
  });

  it('strips XML tags', () => {
    const envelope = makeEnvelope({ assistant_text: 'Hello <response>world</response>' });
    const result = normaliseDeterministicResponse(envelope);
    expect(result.assistant_text).toBe('Hello world');
    expect(result.assistant_text).not.toContain('<');
  });

  it('caps chips at 3', () => {
    const envelope = makeEnvelope({
      suggested_actions: [
        { label: 'A', prompt: 'a', role: 'facilitator' },
        { label: 'B', prompt: 'b', role: 'facilitator' },
        { label: 'C', prompt: 'c', role: 'facilitator' },
        { label: 'D', prompt: 'd', role: 'facilitator' },
        { label: 'E', prompt: 'e', role: 'facilitator' },
      ],
    });
    const result = normaliseDeterministicResponse(envelope);
    expect(result.suggested_actions!.length).toBe(3);
  });

  it('deduplicates blocks by type (except commentary)', () => {
    const envelope = makeEnvelope({
      blocks: [
        { block_type: 'fact', data: { fact_type: 'a', facts: [1] }, block_id: '1', provenance: { trigger: 't', turn_id: 'x', timestamp: 'now' } },
        { block_type: 'fact', data: { fact_type: 'b', facts: [2] }, block_id: '2', provenance: { trigger: 't', turn_id: 'x', timestamp: 'now' } },
      ] as any,
    });
    const result = normaliseDeterministicResponse(envelope);
    expect(result.blocks.length).toBe(1);
  });

  it('allows multiple commentary blocks', () => {
    const envelope = makeEnvelope({
      blocks: [
        { block_type: 'commentary', data: { narrative: 'First', supporting_refs: [] }, block_id: '1', provenance: { trigger: 't', turn_id: 'x', timestamp: 'now' } },
        { block_type: 'commentary', data: { narrative: 'Second', supporting_refs: [] }, block_id: '2', provenance: { trigger: 't', turn_id: 'x', timestamp: 'now' } },
      ] as any,
    });
    const result = normaliseDeterministicResponse(envelope);
    expect(result.blocks.length).toBe(2);
  });

  it('rejects empty blocks', () => {
    const envelope = makeEnvelope({
      blocks: [
        { block_type: 'commentary', data: { narrative: '', supporting_refs: [] }, block_id: '1', provenance: { trigger: 't', turn_id: 'x', timestamp: 'now' } },
        { block_type: 'commentary', data: { narrative: 'Valid', supporting_refs: [] }, block_id: '2', provenance: { trigger: 't', turn_id: 'x', timestamp: 'now' } },
      ] as any,
    });
    const result = normaliseDeterministicResponse(envelope);
    expect(result.blocks.length).toBe(1);
    expect((result.blocks[0].data as any).narrative).toBe('Valid');
  });

  // Regression: Fix 3 has explain_result emit commentary blocks with
  // `narrative: ''` and content living in `sections`. Before this normaliser
  // update, isEmptyBlock only checked narrative — the block was silently
  // dropped before reaching the UI, nuking Fix 3's entire output.
  it('keeps commentary blocks that have sections even when narrative is empty', () => {
    const envelope = makeEnvelope({
      blocks: [
        {
          block_type: 'commentary',
          data: {
            narrative: '',
            supporting_refs: [],
            sections: [
              { heading: 'Stability', content: 'Robustness: moderate.' },
              { heading: 'Key drivers', items: ['Ramp time — influence 45%'] },
            ],
          },
          block_id: '1',
          provenance: { trigger: 'deterministic:explain_result', turn_id: 'x', timestamp: 'now' },
        },
      ] as any,
    });
    const result = normaliseDeterministicResponse(envelope);
    expect(result.blocks.length).toBe(1);
    expect((result.blocks[0].data as any).sections.length).toBe(2);
  });

  it('rejects commentary blocks with empty narrative AND empty sections', () => {
    const envelope = makeEnvelope({
      blocks: [
        {
          block_type: 'commentary',
          data: { narrative: '   ', supporting_refs: [], sections: [] },
          block_id: '1',
          provenance: { trigger: 't', turn_id: 'x', timestamp: 'now' },
        },
        {
          block_type: 'commentary',
          data: {
            narrative: '',
            supporting_refs: [],
            sections: [{ heading: 'Empty', content: '  ' }],
          },
          block_id: '2',
          provenance: { trigger: 't', turn_id: 'x', timestamp: 'now' },
        },
      ] as any,
    });
    const result = normaliseDeterministicResponse(envelope);
    // Both blocks are effectively empty — neither has substantive content
    expect(result.blocks.length).toBe(0);
  });
});

describe('scanBannedTerms', () => {
  it('detects banned terms in assistant text', () => {
    const envelope = makeEnvelope({ assistant_text: 'The TurnContext shows your factors' });
    const found = scanBannedTerms(null, envelope, 'sc-1', 't-1');
    expect(found).toContain('TurnContext');
  });

  it('detects banned terms in insight descriptions', () => {
    const llm: LLMJsonResponse = {
      text: 'Normal text',
      insights: [{ type: 'observation', description: 'The ISL module flagged this', severity: 'info' }],
      recommended_actions: [],
    };
    const envelope = makeEnvelope({ assistant_text: 'Normal text' });
    const found = scanBannedTerms(llm, envelope, 'sc-1', 't-1');
    expect(found).toContain('ISL');
  });

  it('detects banned terms in action rationale', () => {
    const llm: LLMJsonResponse = {
      text: 'Normal text',
      insights: [],
      recommended_actions: [
        { action_type: 'explain_result', priority: 'high', rationale: 'Check the factor_sensitivity data' },
      ],
    };
    const envelope = makeEnvelope({ assistant_text: 'Normal text' });
    const found = scanBannedTerms(llm, envelope, 'sc-1', 't-1');
    expect(found).toContain('factor_sensitivity');
  });

  it('uses word boundaries to avoid false positives', () => {
    const envelope = makeEnvelope({ assistant_text: 'She avoids the invoice problem' });
    const found = scanBannedTerms(null, envelope, 'sc-1', 't-1');
    // "voi" should NOT match inside "avoids" or "invoice"
    expect(found).not.toContain('voi');
  });

  it('returns empty array when no banned terms found', () => {
    const envelope = makeEnvelope({ assistant_text: 'A perfectly normal response about your decision.' });
    const found = scanBannedTerms(null, envelope, 'sc-1', 't-1');
    expect(found).toHaveLength(0);
  });

  it('does not scan science_concept or target_id', () => {
    const llm: LLMJsonResponse = {
      text: 'Normal text',
      insights: [{ type: 'observation', description: 'Clean', severity: 'info', science_concept: 'CEE analysis', target_id: 'ISL_node' }],
      recommended_actions: [],
    };
    const envelope = makeEnvelope({ assistant_text: 'Normal text' });
    const found = scanBannedTerms(llm, envelope, 'sc-1', 't-1');
    // CEE and ISL are only in science_concept/target_id — not scanned
    expect(found).not.toContain('CEE');
    expect(found).not.toContain('ISL');
  });
});
