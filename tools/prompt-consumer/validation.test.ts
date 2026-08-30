import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { consumeValidation, parsePass2Response, validationSample, validationWireContract, verifyValidationCarriage, runValidationMutations } from './validation.js';
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => expect(collected).toEqual(['mutations', 'uncertainty', 'loss', 'unrelated']));

describe('validate_graph uncertainty is represented and affects its real consumer', () => {
  it('the reusable runner proves both actual consumer influence and discriminating mutations', () => {
    collected.push('mutations');
    expect(runValidationMutations().status).toBe('PASS');
  });
  it('uses std to contest only the different-confidence edge, retaining rationale and basis', () => {
    collected.push('uncertainty');
    expect(validationWireContract()).toEqual({ mode: 'json_object', attachedSchema: null });
    const parsed = parsePass2Response(JSON.stringify(validationSample()), 'contract-positive');
    verifyValidationCarriage(consumeValidation(parsed));
  });
  it('RED: dropping std fails actual parser; ignoring it fails the same semantic verifier', () => {
    collected.push('loss');
    const missing = validationSample() as unknown as { edges: Array<{ strength: Record<string, number> }> };
    delete missing.edges[0]!.strength.std;
    expect(() => parsePass2Response(JSON.stringify(missing))).toThrow('std');
    const parsed = parsePass2Response(JSON.stringify(validationSample()));
    expect(() => verifyValidationCarriage(consumeValidation(parsed, true))).toThrow();
  });
  it('GREEN: unrelated domain labels and rationale wording do not change the uncertainty test', () => {
    collected.push('unrelated');
    const unrelated = validationSample();
    unrelated.edges[0]!.from = 'visitor_capacity';
    unrelated.edges[0]!.reasoning = 'The museum estimate uses a wide interval.';
    const parsed = parsePass2Response(JSON.stringify(unrelated));
    expect(() => verifyValidationCarriage(consumeValidation(parsed), unrelated)).not.toThrow();
  });
});
