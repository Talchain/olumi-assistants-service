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
  it('⭐ names the factor that still needs a range, and says the claim was CHECKED', () => {
    // ⚠ THIS TEST PREVIOUSLY ASSERTED THE UNSAFE COPY — that the values were
    // "saved" and the user should "not re-enter" them. CHANGES_REQUIRED on
    // f028650d: `ranges_not_attached` proves only that THIS operation's range did
    // not attach. It says nothing about the values, which a competing writer may
    // have changed. The field is readback-verified by contract, so the missing
    // RANGE may be stated; the values may not.
    const [text] = valueChangeDisclosures({
      rescaled: [],
      ranges_added: [],
      ranges_not_attached: [{ factor: 'Headcount', range: 500 }],
    });
    expect(text).toContain('Headcount');
    expect(text).toContain('range');
    expect(text).toContain('as it now stands');
    expect(text).not.toContain('unchanged');
    expect(text.toLowerCase()).not.toContain('do not re-enter');
    expect(text.toLowerCase()).not.toContain('were saved');
  });

  it('⛔⛔ current_state_unknown WINS — it reports the event and advises NOTHING', () => {
    // The producer could not read the model back, so no present-state claim is
    // available at all. This is the branch that must never advise.
    const owed = valueChangeDisclosures({
      rescaled: [],
      ranges_added: [],
      ranges_not_attached: [],
      current_state_unknown: true,
    });
    expect(owed).toHaveLength(1);
    const text = owed[0];
    expect(text).toContain('AT THE TIME');
    // ⚠ Wording tightened when the guard was lifted above every present-state
    // claim (CHANGES_REQUIRED on 044fe50c): the unknown is now stated in caps as
    // the headline fact rather than as a trailing qualifier.
    expect(text).toContain('NOT KNOWN');
    expect(text).not.toContain('unchanged');
    expect(text.toLowerCase()).not.toContain('do not re-enter');
  });

  it('⛔ unknown SUPPRESSES a stale verified list rather than being merged with it', () => {
    // If both ever arrive together, the unknown is the weaker claim and must win.
    // Emitting both would let a reader take the specific one as current.
    const owed = valueChangeDisclosures({
      rescaled: [{ factor: 'Churn rate', requested: 40, recorded: 0.4 }],
      ranges_added: [],
      ranges_not_attached: [{ factor: 'Headcount', range: 500 }],
      current_state_unknown: true,
    });
    expect(owed.join('\n')).not.toContain('Headcount');
    expect(owed.join('\n')).toContain('AT THE TIME');
  });

  it('⭐ THE COMPETING-WRITER CASE the reviewer asked for, at the consumer', () => {
    // A competing writer supplied the range before the refusal, so the producer's
    // readback removed that factor from the field. The consumer must then say
    // nothing about it — proving the consumer adds no claim of its own.
    const facts = collectTurnStateFacts([
      { ranges_not_attached: [] },
    ]);
    expect(facts.ranges_not_attached).toEqual([]);
    expect(valueChangeDisclosures(facts)).toEqual([]);
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

/**
 * ⛔⛔ UNKNOWN MUST WIN OVER *ALL* PRESENT-STATE CLAIMS, NOT JUST ONE.
 *
 * CHANGES_REQUIRED on `044fe50c`: the unknown check sat BELOW the rescaled and
 * range blocks, so one turn could say "the current model is unknown" and, in the
 * same breath, "those stored figures are the ones it will compute with" and "tell
 * me the right ranges and I will replace them". A partial write followed by a
 * failed readback emits rescaled+unknown from a single operation, so the
 * contradiction was reachable.
 *
 * These are the reviewer's own minimum controls: rescaled+unknown and
 * range+unknown must withhold every current-computation claim and every piece of
 * advice, while verified-current rescaling stays a positive control.
 */
describe('⛔ unknown-state precedence over EVERY present-state claim', () => {
  const FORBIDDEN_WHEN_UNKNOWN = [
    'compute with',        // asserts what the model will use now
    'Tell me if any is wrong',
    'Tell me the right ones',
    'not yours',
    'still needs a range',
    'as it now stands',
  ];

  it('⛔ rescaled + unknown: no figure is named as current and no advice is given', () => {
    const owed = valueChangeDisclosures({
      rescaled: [{ factor: 'Churn rate', requested: 40, recorded: 0.4 }],
      ranges_added: [],
      current_state_unknown: true,
    });
    expect(owed).toHaveLength(1);
    const text = owed[0];
    expect(text).toContain('NOT KNOWN');
    expect(text).toContain('AT THE TIME');
    // The specific stored figure must NOT be presented as current.
    expect(text).not.toContain('0.4');
    expect(text).not.toContain('Churn rate');
    for (const f of FORBIDDEN_WHEN_UNKNOWN) expect(text, `asserted "${f}" with state unknown`).not.toContain(f);
  });

  it('⛔ ranges_added + unknown: the chosen range is not offered for replacement', () => {
    const owed = valueChangeDisclosures({
      rescaled: [],
      ranges_added: [{ factor: 'Headcount', range: 500 }],
      current_state_unknown: true,
    });
    expect(owed).toHaveLength(1);
    expect(owed[0]).not.toContain('Headcount');
    expect(owed[0]).not.toContain('0 to 500');
    for (const f of FORBIDDEN_WHEN_UNKNOWN) expect(owed[0]).not.toContain(f);
  });

  it('⛔ ALL THREE at once + unknown still yields exactly one past-tense disclosure', () => {
    const owed = valueChangeDisclosures({
      rescaled: [{ factor: 'Churn rate', requested: 40, recorded: 0.4 }],
      ranges_added: [{ factor: 'Headcount', range: 500 }],
      ranges_not_attached: [{ factor: 'Seats', range: 200 }],
      current_state_unknown: true,
    });
    expect(owed).toHaveLength(1);
    for (const leak of ['Churn rate', 'Headcount', 'Seats', '0.4', '500', '200']) {
      expect(owed[0], `leaked "${leak}" as current`).not.toContain(leak);
    }
  });

  it('⭐ POSITIVE CONTROL — verified-current rescaling still says everything it should', () => {
    // Without this the rule above could be satisfied by disclosing nothing ever.
    const owed = valueChangeDisclosures({
      rescaled: [{ factor: 'Churn rate', requested: 40, recorded: 0.4 }],
      ranges_added: [],
    });
    expect(owed).toHaveLength(1);
    expect(owed[0]).toContain('Churn rate');
    expect(owed[0]).toContain('stored as 0.4');
    expect(owed[0]).toContain('compute with');
  });

  it('⭐ POSITIVE CONTROL — a verified chosen range is still offered for correction', () => {
    const owed = valueChangeDisclosures({
      rescaled: [],
      ranges_added: [{ factor: 'Headcount', range: 500 }],
    });
    expect(owed).toHaveLength(1);
    expect(owed[0]).toContain('Headcount');
    expect(owed[0]).toContain('not yours');
  });
});
