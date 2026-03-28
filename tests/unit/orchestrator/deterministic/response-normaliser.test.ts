/**
 * Response Normaliser Tests
 */

import { describe, it, expect } from "vitest";
import { normaliseDeterministicResponse } from "../../../../src/orchestrator/deterministic/response-normaliser.js";
import type { OrchestratorResponseEnvelope } from "../../../../src/orchestrator/types.js";

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
});
