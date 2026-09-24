import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectTurnStateFacts } from '../turn-state-facts.js';

/**
 * ⛔⛔ WHETHER THE USER LEARNED THEIR APPROVED VALUE CHANGED DEPENDED ON THE
 * MODEL CHOOSING TO SAY SO.
 *
 * `authoriseChange` computes `recorded !== requested` itself and ships
 * `rescaled_by_the_model` with `must_disclose_rescaling: true` plus an
 * instruction — *"state every value the model stored differently from the one
 * approved."*
 *
 * MEASURED: `must_disclose_rescaling` occurs at exactly ONE site in the tree,
 * the one that SETS it. Nothing reads it, nothing verifies it. Contrast control:
 * the estate DOES police narration elsewhere (`narration.stripped` removes write
 * claims the model had no right to make), so the mechanism exists and simply was
 * not applied here.
 *
 * Same for `ranges_added_for_analysis`: a factor had no range, which would have
 * stopped the analysis, so THE PRODUCT took one from the figure itself. That is
 * a denominator Olumi chose, and the charter requires its own choices to stay
 * distinguishable.
 */
const RESCALED = { option: 'Two Developers', factor: 'Delivery Velocity', requested: 360, recorded: 0.72 };
const RANGE = { factor: 'Active Subscribers', range: 500 };

describe('what the server itself observed about this turn', () => {
  it('⭐ surfaces a value stored differently from the one approved', () => {
    const out = collectTurnStateFacts([{ ok: true, rescaled_by_the_model: [RESCALED] }]);
    expect(out.rescaled).toEqual([RESCALED]);
  });

  it('⭐ surfaces a range the PRODUCT chose', () => {
    const out = collectTurnStateFacts([{ ok: true, ranges_added_for_analysis: [RANGE] }]);
    expect(out.ranges_added).toEqual([RANGE]);
  });

  it('⛔ reports NOTHING when nothing was rescaled or framed', () => {
    expect(collectTurnStateFacts([{ ok: true, mutated: true }])).toEqual({ rescaled: [], ranges_added: [], ranges_not_attached: [], current_state_unknown: false });
    expect(collectTurnStateFacts([])).toEqual({ rescaled: [], ranges_added: [], ranges_not_attached: [], current_state_unknown: false });
    expect(collectTurnStateFacts(undefined)).toEqual({ rescaled: [], ranges_added: [], ranges_not_attached: [], current_state_unknown: false });
  });

  it('⛔ drops an entry that cannot name WHICH FACTOR it concerns', () => {
    // A rescaling the user cannot locate is not a disclosure, and a half-one is
    // worse than none because it looks like an answer.
    //
    // ⛔ CORRECTED. This used to require an `option` too, and asserted that a
    // `{ factor }`-only entry was DROPPED. That was backwards: the sole producer
    // of `rescaled_by_the_model` (`agent-capabilities.ts:1202`, feeding the emit
    // at `:1292`) carries NO option, so the old rule dropped 100% of real
    // entries and this very assertion was pinning the feature shut. `factor`
    // alone names the change; an option-less entry is the NORMAL case.
    const out = collectTurnStateFacts([{
      rescaled_by_the_model: [
        { factor: 'F', requested: 1, recorded: 2 },      // the PRODUCER's shape — kept
        { option: 'O', requested: 1, recorded: 2 },      // no factor — unnameable, dropped
        null, 'nope', 7,
        RESCALED,
      ],
    }]);
    expect(out.rescaled).toEqual([
      { factor: 'F', requested: 1, recorded: 2 },
      RESCALED,
    ]);
  });

  it('⛔ drops a range that could not be a denominator', () => {
    // 0, 1 and negatives cannot divide a figure into a unit interval. Reporting
    // one would tell the user something untrue about their own model.
    const out = collectTurnStateFacts([{
      ranges_added_for_analysis: [
        { factor: 'A', range: 0 }, { factor: 'B', range: 1 }, { factor: 'C', range: -5 },
        { factor: 'D', range: '500' },
        RANGE,
      ],
    }]);
    expect(out.ranges_added).toEqual([RANGE]);
  });

  it('⛔ de-duplicates — one changed value is not two', () => {
    // An authorisation writes through several hops and a retry RECOVERS the
    // original result, so the same entry legitimately arrives more than once.
    const out = collectTurnStateFacts([
      { rescaled_by_the_model: [RESCALED], ranges_added_for_analysis: [RANGE] },
      { rescaled_by_the_model: [RESCALED], ranges_added_for_analysis: [RANGE] },
    ]);
    expect(out.rescaled).toHaveLength(1);
    expect(out.ranges_added).toHaveLength(1);
  });

  it('keeps a non-numeric requested/recorded as null rather than guessing', () => {
    const out = collectTurnStateFacts([{
      rescaled_by_the_model: [{ option: 'O', factor: 'F', requested: 'n/a', recorded: undefined }],
    }]);
    expect(out.rescaled[0]).toEqual({ option: 'O', factor: 'F', requested: null, recorded: null });
  });

  it('survives malformed tool results without throwing', () => {
    expect(collectTurnStateFacts([null, 'x', 42, { rescaled_by_the_model: 'not-an-array' }, { ranges_added_for_analysis: 5 }]))
      .toEqual({ rescaled: [], ranges_added: [], ranges_not_attached: [], current_state_unknown: false });
  });
});

describe('the agent route surfaces them, and only when there is something to say', () => {
  const ROUTE = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');

  it('the probe can see the sidecar (not vacuous)', () => {
    expect(ROUTE.lastIndexOf('_agent: {')).toBeGreaterThan(-1);
  });

  it('⛔ the facts are COLLECTED from the tool results', () => {
    // A helper that is never called is green everywhere — the exact failure
    // independent review caught on my redraw mount.
    expect(ROUTE).toContain('collectTurnStateFacts(result.tool_results)');
  });

  it('⛔ the _agent sidecar reports them', () => {
    // ⚠ The call is HOISTED now, because the same facts also feed the
    // user-facing disclosure block. The sidecar consumes the hoisted value, so
    // this pins the consumption rather than the call site.
    const sidecar = ROUTE.slice(ROUTE.lastIndexOf('_agent: {'));
    expect(sidecar).toContain('state_facts: stateFacts');
  });

  it('⛔ the key is OMITTED when there is nothing to disclose', () => {
    // An always-present empty object reads as "we checked and there was nothing",
    // which is true — but it also trains a consumer to ignore the field. The
    // conditional is what keeps its presence meaningful.
    const sidecar = ROUTE.slice(ROUTE.lastIndexOf('_agent: {'));
    expect(sidecar).toContain('stateFacts.rescaled.length > 0 || stateFacts.ranges_added.length > 0');
  });
});

/**
 * ⛔⛔⛔ THE FIXTURE ABOVE INVENTED A FIELD THE WIRE DOES NOT CARRY, so the whole
 * rescale disclosure was DEAD and every assertion about it was green.
 *
 * PROVEN AT THE SOURCE, not argued. `rescaled_by_the_model` is emitted at exactly
 * ONE site — `agent-capabilities.ts:1292` — and that return is fed by
 * `const landed = applied.filter(...)` at `:1208`, which is fed by the
 * `applied.push({...})` at `:1202`:
 *
 *     applied.push({ factor, requested, recorded })   // <- NO `option`
 *
 * The other push, at `:1111`, DOES carry `option` — but it feeds the block ending
 * at `:1130`, which never emits `rescaled_by_the_model`. So the collector's
 * `typeof e.option !== 'string' -> continue` dropped **100% of real entries**.
 *
 * `option` is not merely missing, it is SEMANTICALLY ABSENT on that path: a
 * factor-value edit changes a factor, not one option's intervention. Requiring it
 * was my error, not the producer's.
 *
 * This is my own doctrine's trap: a self-authored fixture is not evidence about
 * the wire. These cases use the producer's shape.
 */
describe('the PRODUCER shape — a factor-value rescale carries no option', () => {
  const PRODUCER_RESCALE = { factor: 'Monthly churn rate', requested: 3.5, recorded: 0.035 };

  it('⛔ a rescale with NO option is collected, not dropped', () => {
    const out = collectTurnStateFacts([{ rescaled_by_the_model: [PRODUCER_RESCALE] }]);
    expect(out.rescaled, 'the sole producer emits no `option` — dropping it kills the feature').toHaveLength(1);
    expect(out.rescaled[0]!.factor).toBe('Monthly churn rate');
    expect(out.rescaled[0]!.requested).toBe(3.5);
    expect(out.rescaled[0]!.recorded).toBe(0.035);
  });

  it('CONTRAST: an entry with an option still keeps it (the :1111 shape)', () => {
    const out = collectTurnStateFacts([
      { rescaled_by_the_model: [{ option: 'Two Developers', factor: 'Velocity', requested: 7, recorded: 0.7 }] },
    ]);
    expect(out.rescaled).toHaveLength(1);
    expect(out.rescaled[0]!.option).toBe('Two Developers');
  });

  it('an entry with NO factor is still dropped — a nameless change cannot be disclosed', () => {
    expect(collectTurnStateFacts([{ rescaled_by_the_model: [{ requested: 1, recorded: 2 }] }]).rescaled).toHaveLength(0);
  });

  it('de-dupes option-less entries by factor, and does not collapse two factors', () => {
    const out = collectTurnStateFacts([
      { rescaled_by_the_model: [PRODUCER_RESCALE, PRODUCER_RESCALE, { factor: 'Pro subscribers', requested: 2, recorded: 0.2 }] },
    ]);
    expect(out.rescaled.map((r) => r.factor)).toEqual(['Monthly churn rate', 'Pro subscribers']);
  });

  it("the producer's NaN sentinel becomes null, not NaN", () => {
    const out = collectTurnStateFacts([
      { rescaled_by_the_model: [{ factor: 'Churn', requested: Number.NaN, recorded: 0.04 }] },
    ]);
    expect(out.rescaled[0]!.requested, 'NaN is not a number a user can be shown').toBeNull();
  });
});
