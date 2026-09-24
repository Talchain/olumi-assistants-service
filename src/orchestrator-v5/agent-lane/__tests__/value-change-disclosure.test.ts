import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PLACEHOLDER_STRENGTH_DISCLOSURE,
  VALUE_CHANGE_DISCLOSURE_MAX_CHARS,
  disclosuresFor,
  valueChangeDisclosures,
  withDisclosures,
} from '../disclosure.js';
import { collectTurnStateFacts } from '../turn-state-facts.js';

/**
 * The obligation under test: when the product stores a value the user did NOT
 * approve, or chooses a range the user did not give, the USER IS TOLD — on a
 * carrier that is always rendered, and without depending on the model to
 * mention it.
 *
 * ⛔ Written against that SPEC, not against the coaching-block implementation
 * this replaced. The block was emitted correctly and still could not be seen:
 * `MAX_POINTS = 3` demoted it behind a collapsed "Show N more" on every one of
 * three real captures.
 */
describe('the user is told when a value they approved was stored differently', () => {
  const rescaled = (over: Partial<{ option: string; factor: string; requested: number | null; recorded: number | null }> = {}) => ({
    rescaled: [{ factor: 'Churn rate', requested: 40, recorded: 0.4, ...over }],
    ranges_added: [],
  });

  it('⭐ names the factor and BOTH figures, so the change is checkable', () => {
    const [text] = valueChangeDisclosures(rescaled());
    expect(text).toContain('Churn rate');
    expect(text).toContain('you approved 40');
    expect(text).toContain('stored as 0.4');
  });

  it('⭐ names the option too when the change is scoped to one', () => {
    const [text] = valueChangeDisclosures(rescaled({ option: 'Hire two' }));
    expect(text).toContain('Churn rate for Hire two');
  });

  it('⭐ says the stored figure is the one that will be computed with', () => {
    // The point of the disclosure is not that something happened; it is that
    // the model now holds a number the user did not choose.
    const [text] = valueChangeDisclosures(rescaled());
    expect(text).toContain('compute with');
  });

  it('⭐ invites correction — a disclosure with no remedy is a dead end', () => {
    const [text] = valueChangeDisclosures(rescaled());
    expect(text.toLowerCase()).toContain('tell me');
  });

  it('⛔ NEVER prints null as a number', () => {
    const [text] = valueChangeDisclosures({
      rescaled: [{ factor: 'Churn rate', requested: null, recorded: null }],
      ranges_added: [],
    });
    expect(text).not.toContain('null');
    expect(text).not.toContain('NaN');
  });

  it('⭐ discloses a range the PRODUCT chose, and says it is not the user’s', () => {
    const [text] = valueChangeDisclosures({ rescaled: [], ranges_added: [{ factor: 'Headcount', range: 500 }] });
    expect(text).toContain('Headcount');
    expect(text).toContain('0 to 500');
    expect(text).toContain('not yours');
  });

  it('⛔ says NOTHING when nothing was changed — a disclosure every turn is noise', () => {
    expect(valueChangeDisclosures({ rescaled: [], ranges_added: [] })).toEqual([]);
    expect(valueChangeDisclosures(null)).toEqual([]);
    expect(valueChangeDisclosures(undefined)).toEqual([]);
  });

  it('⭐ BOUNDED, and the remainder is NAMED rather than silently dropped', () => {
    const many = {
      rescaled: Array.from({ length: 40 }, (_, i) => ({
        factor: `A rather long factor name number ${i}`,
        requested: i,
        recorded: i / 100,
      })),
      ranges_added: [],
    };
    const [text] = valueChangeDisclosures(many);
    expect(text.length).toBeLessThanOrEqual(VALUE_CHANGE_DISCLOSURE_MAX_CHARS);
    expect(text).toMatch(/…and \d+ more\./);
  });

  it('⛔ even when NOTHING fits, the count is still disclosed rather than suppressed', () => {
    const huge = {
      rescaled: [{ factor: 'x'.repeat(VALUE_CHANGE_DISCLOSURE_MAX_CHARS * 2), requested: 1, recorded: 2 }],
      ranges_added: [],
    };
    const [text] = valueChangeDisclosures(huge);
    expect(text).toContain('…and 1 more.');
  });

  it('⭐ composes with the EXISTING placeholder disclosure rather than replacing it', () => {
    // Both are owed by the same rule; neither may silence the other.
    const owed = [
      ...disclosuresFor([{ mutated: true, placeholder_strength: true }]),
      ...valueChangeDisclosures(rescaled()),
    ];
    expect(owed).toHaveLength(2);
    expect(owed[0]).toBe(PLACEHOLDER_STRENGTH_DISCLOSURE);
    const out = withDisclosures('The model is updated.', owed);
    expect(out).toContain('The model is updated.');
    expect(out).toContain(PLACEHOLDER_STRENGTH_DISCLOSURE);
    expect(out).toContain('Churn rate');
  });

  it('⭐ end to end from a REAL tool-result shape, not a hand-made facts object', () => {
    // Bound to the producer's own key names: a fixture that invents them would
    // pass while the wire dropped every entry.
    const facts = collectTurnStateFacts([
      { rescaled_by_the_model: [{ factor: 'Churn rate', requested: 40, recorded: 0.4 }] },
      { ranges_added_for_analysis: [{ factor: 'Headcount', range: 500 }] },
    ]);
    const owed = valueChangeDisclosures(facts);
    expect(owed).toHaveLength(2);
    expect(owed.join('\n')).toContain('Churn rate');
    expect(owed.join('\n')).toContain('Headcount');
  });
});

describe('the route actually carries it to the user', () => {
  const ROUTE = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');

  it('the probe can see the route (not vacuous)', () => {
    expect(ROUTE).toContain('withDisclosures');
    expect(ROUTE).toContain('assistant_text');
  });

  it('⭐ the value-change disclosures are folded into `owed`, which reaches assistant_text', () => {
    // Bounded to the `owed` assignment itself, so an unrelated edit elsewhere
    // cannot satisfy this and a moved line cannot break it.
    const decl = ROUTE.slice(ROUTE.indexOf('const owed = ['));
    const body = decl.slice(0, decl.indexOf('];') + 2);
    expect(body).toContain('disclosuresFor(result.tool_results)');
    expect(body).toContain('valueChangeDisclosures(stateFacts)');
    expect(ROUTE).toContain('withDisclosures(narration.text, owed)');
  });

  it('⭐ the structured twin travels on the _agent sidecar', () => {
    expect(ROUTE).toContain('{ state_facts: stateFacts }');
  });

  it('⛔ the invisible coaching-block carrier is GONE, not merely unused', () => {
    // It could not reach the user (MAX_POINTS = 3 demotes it behind a collapsed
    // "Show N more"), so leaving it would ship a promise the UI cannot keep.
    expect(ROUTE).not.toContain('buildValueChangeBlocks');
    expect(ROUTE).not.toContain('value-change-block');
  });
});

describe('a value that saved with NO range is disclosed too', () => {
  it('⭐ says the values are saved AND that a range is still needed, naming the factor', () => {
    const [text] = valueChangeDisclosures({
      rescaled: [],
      ranges_added: [],
      ranges_not_attached: [{ factor: 'Headcount', range: 500 }],
    });
    expect(text).toContain('Headcount');
    expect(text).toContain('saved');
    expect(text).toContain('range');
    // The consequence of the old wording was a redone write.
    expect(text.toLowerCase()).toContain('do not re-enter');
  });

  it('⛔ absent field changes nothing — the producer may not emit it', () => {
    // #1743 emits it; this PR must degrade cleanly without it.
    expect(valueChangeDisclosures({ rescaled: [], ranges_added: [] })).toEqual([]);
  });

  it('⭐ end to end from the PRODUCER’s own key, not a hand-made object', () => {
    const facts = collectTurnStateFacts([
      { ranges_not_attached: [{ factor: 'Headcount', range: 500 }] },
    ]);
    expect(facts.ranges_not_attached).toEqual([{ factor: 'Headcount', range: 500 }]);
    expect(valueChangeDisclosures(facts)).toHaveLength(1);
  });

  it('⛔ an unusable range is not named — it would tell the user something untrue', () => {
    const facts = collectTurnStateFacts([
      { ranges_not_attached: [{ factor: 'Bad', range: 1 }, { factor: 'Good', range: 400 }] },
    ]);
    expect(facts.ranges_not_attached.map((r) => r.factor)).toEqual(['Good']);
  });
});
