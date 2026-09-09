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

/**
 * ⭐ EXHAUSTIVE BY THE COMPILER, not by hand (CLAUDE.md trap 12).
 *
 * A `Record` keyed on the union REQUIRES every member, so adding a new
 * `EditRejectionReason` without listing it here fails typecheck. The previous
 * plain array did not: a new reason could join the union and silently escape
 * every invariant below — which is exactly how `service_unavailable`'s absence
 * would have gone unnoticed.
 */
const ALL_REASONS: Record<EditRejectionReason, true> = {
  too_many_operations: true,
  structural_validation: true,
  parse_failure: true,
  entity_not_found: true,
  service_unavailable: true,
  internal_failure: true,
  unknown_failure: true,
};

const REASONS = Object.keys(ALL_REASONS) as EditRejectionReason[];

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
