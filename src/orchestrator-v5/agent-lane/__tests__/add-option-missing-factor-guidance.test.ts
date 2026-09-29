/**
 * A factor the model does not have: the option is not half-added silently (planNewOption's invariant), and the
 * Agent is told exactly how to add it honestly — against the factors that exist, saying which part is not yet
 * represented. Served (F) on 319dde1, row F4s: "Keep £49 and add a paid AI add-on" was never added, because the
 * add-on's effect had no factor and the Agent stopped there.
 *
 * #1953 review: the retry the refusal asks for must not be forbidden by the tool's own description, and an option
 * with NOTHING the model represents must never be pushed onto an unrelated factor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planNewOption } from '../propose-new-option.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';

const graph = [{ id: 'price', kind: 'factor', label: 'Pro plan price' }];

describe('an option naming a factor the model does not have', () => {
  it('is refused with nothing prepared, and the refusal tells the Agent to add it NOW against the factors that exist and to say what is not represented', () => {
    const r = planNewOption(graph, {
      label: 'Raise to £59 and add a paid AI add-on',
      acts_on: [{ factor_label: 'Pro plan price', direction: 'positive' }, { factor_label: 'AI add-on revenue', direction: 'positive' }],
      rationale: 'x',
    });
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'no_such_factor', unresolved_labels: ['AI add-on revenue'] }));
    const detail = (r as { detail: string }).detail;
    expect(detail).toMatch(/Nothing was prepared/);
    expect(detail).toMatch(/call propose_new_option again without the missing one/);
    expect(detail).toMatch(/which part of the option the model does not yet represent/);
    // #1953 review B1: "add it against what it has" must not turn an option into a copy of the status quo.
    expect(detail).toMatch(/what the model already has today/);
    expect(detail).toMatch(/could not be told apart\s+from carrying on as now/);
    // DL 5843303596: a missing factor is added in the SAME change (`new_factors`), not as a later step.
    expect(detail).toMatch(/a missing factor can be added in the same change, through `new_factors`/);
  });

  it('RED: NOTHING it names exists → never "retry without the missing one" (that is a link to nothing, or to the wrong factor): offer the factor instead', () => {
    const r = planNewOption(graph, {
      label: 'Add a paid AI add-on',
      acts_on: [{ factor_label: 'AI add-on revenue', direction: 'positive' }],
      rationale: 'x',
    });
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'no_such_factor', unresolved_labels: ['AI add-on revenue'] }));
    const detail = (r as { detail: string }).detail;
    expect(detail).toMatch(/Nothing was prepared/);
    expect(detail).not.toMatch(/again without the missing one/);
    expect(detail).toMatch(/never link it to an unrelated factor/);
    expect(detail).toMatch(/add the missing factor IN THE SAME CHANGE/);
  });

  it('RED: an option naming no factor at all is told never to borrow an unrelated one', () => {
    const r = planNewOption(graph, { label: 'Add a paid AI add-on', acts_on: [], rationale: 'x' });
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'no_factors_named' }));
    expect((r as { detail: string }).detail).toMatch(/never link it to an unrelated one/);
  });
});

describe('the retry the refusal asks for is one the tool allows', () => {
  it('RED: propose_new_option\'s description permits ONE corrected retry after a refusal, and forbids a second call only once a change is prepared', () => {
    const description = AGENT_TOOLS.find((t) => t.name === 'propose_new_option')!.description;
    expect(description).not.toMatch(/Never call this twice in one reply/);
    expect(description).toMatch(/Once a call has prepared a change, never call it again in the same reply/);
    expect(description).toMatch(/REFUSED prepared nothing: you may call it once more in the same reply/);
  });

  it('RED: the Agent\'s instructions say the same for an option with nothing the model represents', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    // DL 5843303596: the missing factor is added in the same change; an unrelated link is still never made.
    expect(route).toContain('If part of what an option does has no factor in the model, add that factor IN THE SAME CHANGE through `new_factors`');
    expect(route).toContain('Never link an option to an unrelated factor instead.');
    expect(route).not.toContain('offer to add that factor first');
  });

  it('RED (#1953 review B1): the instructions never add an option that would only repeat today\'s values — it would vanish into carrying on as now', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('unless what it would set there is what the model already has today (for example keeping a price at its current level): then it could not be told apart from carrying on as now, so do not add it');
  });

  it('(#1953 review N1) "add them now" still asks when which way an option pushes a factor is unclear', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('do not first ask what they do, unless which way it pushes a factor is unclear');
  });
});
