import { describe, it, expect } from "vitest";
import {
  buildEditRejectionResponse,
  type EditRejectionReason,
} from "../../../../src/orchestrator-v5/handlers/edit-rejection-text.js";

const BANNED_TOKENS = [
  /\boperation(s)?\b/i,
  /\bpatch\b/i,
  /\bSchema:/,
  /\bzod\b/i,
  /\b\d+\.\w+\b/, // "0.path" style
  /\bmax(?:imum)?\s+(?:of\s+)?\d+/i,
  /\b\d+\s+(?:operation|edge|node)/i,
];

const REASONS: EditRejectionReason[] = [
  'too_many_operations',
  'structural_validation',
  'parse_failure',
  'entity_not_found',
];

describe('buildEditRejectionResponse', () => {
  for (const reason of REASONS) {
    it(`emits friendly text and >=1 chip for ${reason}`, () => {
      const ctx = reason === 'entity_not_found' ? { label: 'churn rate' } : undefined;
      const result = buildEditRejectionResponse(reason, ctx);
      expect(result.assistantText.length).toBeGreaterThan(20);
      expect(result.suggestedActions.length).toBeGreaterThanOrEqual(1);
    });

    it(`assistantText contains no banned tokens for ${reason}`, () => {
      const ctx = reason === 'entity_not_found' ? { label: 'churn rate' } : undefined;
      const text = buildEditRejectionResponse(reason, ctx).assistantText;
      for (const re of BANNED_TOKENS) {
        expect(text, `text="${text}" matched banned token ${re}`).not.toMatch(re);
      }
    });
  }

  it('entity_not_found includes the label', () => {
    const result = buildEditRejectionResponse('entity_not_found', { label: 'churn rate' });
    expect(result.assistantText).toContain('churn rate');
    expect(result.suggestedActions[0].label).toContain('churn rate');
  });

  it('entity_not_found falls back gracefully when label is missing', () => {
    const result = buildEditRejectionResponse('entity_not_found', {});
    expect(result.assistantText).toContain('that element');
    expect(result.suggestedActions[0].label).toContain('that element');
  });

  it('chips do NOT set action_type (uses message-replay path through boundary mapper)', () => {
    for (const reason of REASONS) {
      const ctx = reason === 'entity_not_found' ? { label: 'foo' } : undefined;
      const result = buildEditRejectionResponse(reason, ctx);
      for (const chip of result.suggestedActions) {
        expect(chip.action_type).toBeUndefined();
      }
    }
  });
});
