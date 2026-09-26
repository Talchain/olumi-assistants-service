/**
 * A factor the model does not have: the option is not half-added silently (planNewOption's invariant), and the
 * Agent is told exactly how to add it honestly — against the factors that exist, saying which part is not yet
 * represented. Served (F) on 319dde1, row F4s: "Keep £49 and add a paid AI add-on" was never added, because the
 * add-on's effect had no factor and the Agent stopped there.
 */
import { describe, it, expect } from 'vitest';
import { planNewOption } from '../propose-new-option.js';

describe('an option naming a factor the model does not have', () => {
  it('is refused with nothing prepared, and the refusal tells the Agent to add it NOW against the factors that exist and to say what is not represented', () => {
    const r = planNewOption([{ id: 'price', kind: 'factor', label: 'Pro plan price' }], {
      label: 'Keep £49 and add a paid AI add-on',
      acts_on: [{ factor_label: 'Pro plan price', direction: 'positive' }, { factor_label: 'AI add-on revenue', direction: 'positive' }],
      rationale: 'x',
    });
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'no_such_factor', unresolved_labels: ['AI add-on revenue'] }));
    const detail = (r as { detail: string }).detail;
    expect(detail).toMatch(/Nothing was prepared/);
    expect(detail).toMatch(/call propose_new_option again without the missing one/);
    expect(detail).toMatch(/which part of the option the model does not yet represent/);
  });
});
