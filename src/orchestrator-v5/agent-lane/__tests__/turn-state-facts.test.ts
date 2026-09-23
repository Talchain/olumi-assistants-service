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
    expect(collectTurnStateFacts([{ ok: true, mutated: true }])).toEqual({ rescaled: [], ranges_added: [] });
    expect(collectTurnStateFacts([])).toEqual({ rescaled: [], ranges_added: [] });
    expect(collectTurnStateFacts(undefined)).toEqual({ rescaled: [], ranges_added: [] });
  });

  it('⛔ drops an entry that cannot name WHICH option and factor it concerns', () => {
    // A rescaling the user cannot locate is not a disclosure, and a half-one is
    // worse than none because it looks like an answer.
    const out = collectTurnStateFacts([{
      rescaled_by_the_model: [
        { factor: 'F', requested: 1, recorded: 2 },      // no option
        { option: 'O', requested: 1, recorded: 2 },      // no factor
        null, 'nope', 7,
        RESCALED,
      ],
    }]);
    expect(out.rescaled).toEqual([RESCALED]);
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
      .toEqual({ rescaled: [], ranges_added: [] });
  });
});

describe('the agent route surfaces them, and only when there is something to say', () => {
  const ROUTE = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');

  it('the probe can see the sidecar (not vacuous)', () => {
    expect(ROUTE.lastIndexOf('_agent: {')).toBeGreaterThan(-1);
  });

  it('⛔ the _agent sidecar reports them', () => {
    // A helper that is never called is green everywhere — the exact failure
    // independent review caught on my redraw mount.
    const sidecar = ROUTE.slice(ROUTE.lastIndexOf('_agent: {'));
    expect(sidecar).toContain('collectTurnStateFacts(result.tool_results)');
  });

  it('⛔ the key is OMITTED when there is nothing to disclose', () => {
    // An always-present empty object reads as "we checked and there was nothing",
    // which is true — but it also trains a consumer to ignore the field. The
    // conditional is what keeps its presence meaningful.
    const sidecar = ROUTE.slice(ROUTE.lastIndexOf('_agent: {'));
    expect(sidecar).toContain('facts.rescaled.length > 0 || facts.ranges_added.length > 0');
  });
});
