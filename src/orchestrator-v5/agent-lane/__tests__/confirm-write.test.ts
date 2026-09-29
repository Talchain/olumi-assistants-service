import { describe, it, expect } from 'vitest';
import { confirmEdgeWrite, describeOutcome } from '../confirm-write.js';

const REV_A = 'a'.repeat(16);
const REV_B = 'b'.repeat(16);

describe('a write is confirmed by state, not by a status code', () => {
  it('THE OBSERVED FAILURE: 200 + unchanged revision + no edge is NOT applied', () => {
    const c = confirmEdgeWrite({
      revision_before: REV_A, revision_after: REV_A, edgeExistsAfter: false,
      system_message: "I couldn't record that properly, so I haven't changed the model.",
    });
    expect(c.applied).toBe(false);
    expect(c.reason).toBe('unchanged');
    // And the Agent must repeat Olumi's words, not invent a success sentence.
    expect(describeOutcome(c)).toBe("I couldn't record that properly, so I haven't changed the model.");
  });

  it('a moved revision without the edge is still NOT applied', () => {
    const c = confirmEdgeWrite({ revision_before: REV_A, revision_after: REV_B, edgeExistsAfter: false });
    expect(c.applied).toBe(false);
    expect(c.reason).toBe('not_present');
    expect(describeOutcome(c)).toBe('The model was not changed.');
  });

  it('CONTROL: the edge present after the write IS applied', () => {
    const c = confirmEdgeWrite({ revision_before: REV_A, revision_after: REV_B, edgeExistsAfter: true });
    expect(c.applied).toBe(true);
    expect(describeOutcome(c)).toBe('The change was applied to the model.');
  });

  it('presence beats revision movement — a no-op rewrite that kept the edge counts', () => {
    const c = confirmEdgeWrite({ revision_before: REV_A, revision_after: REV_A, edgeExistsAfter: true });
    expect(c.applied).toBe(true);
  });
});
