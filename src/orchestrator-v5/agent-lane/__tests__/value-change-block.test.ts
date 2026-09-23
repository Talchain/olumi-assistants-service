import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';
import { buildValueChangeBlocks } from '../value-change-block.js';
import type { TurnStateFacts } from '../turn-state-facts.js';

/**
 * ⛔⛔ THE DISCLOSURE REACHED NO USER.
 *
 * `authoriseChange` told only the MODEL that an approved value was stored
 * differently, or that the PRODUCT chose a factor's scale — on
 * `must_disclose_rescaling`, a field nothing reads and nothing verifies.
 *
 * ⚠ And that was not laziness: the agent response carries **no `coaching`
 * object**, so the rendered prose channel the Conventional path uses does not
 * exist here. `assistant_text` was the only user-facing prose an Agent turn had.
 * A typed `CoachingBlock` is the carrier that does exist.
 */
const AT = '2026-09-23T12:00:00.000Z';
const facts = (f: Partial<TurnStateFacts>): TurnStateFacts =>
  ({ rescaled: [], ranges_added: [], ...f });

const RESCALED = { option: 'Two Developers', factor: 'Delivery Velocity', requested: 360, recorded: 0.72 };
const RANGE = { factor: 'Active Subscribers', range: 500 };

describe('when there is nothing to disclose', () => {
  it('⛔ emits NOTHING — an empty card is noise that trains people to ignore cards', () => {
    expect(buildValueChangeBlocks(facts({}), AT)).toEqual([]);
  });
});

describe('a value stored differently from the one approved', () => {
  const [block] = buildValueChangeBlocks(facts({ rescaled: [RESCALED] }), AT);

  it('emits one block (not vacuous)', () => {
    expect(block).toBeDefined();
  });

  it('⭐ shows BOTH numbers and labels which is which', () => {
    // "Stored differently" without saying what to and from is not something a
    // person can check or correct.
    expect(block!.body).toContain('you approved 360');
    expect(block!.body).toContain('stored as 0.72');
  });

  it('⭐ names the option and factor, so the change can be located', () => {
    expect(block!.body).toContain('Delivery Velocity');
    expect(block!.body).toContain('Two Developers');
  });

  it('⛔ an entry whose figures could not be read is still DISCLOSED, not dropped', () => {
    // It is still a change the user should know happened. Saying "1 further
    // value" is honest; saying nothing would hide it.
    const [b] = buildValueChangeBlocks(
      facts({ rescaled: [RESCALED, { option: 'O', factor: 'F', requested: null, recorded: null }] }),
      AT,
    );
    expect(b!.body).toContain('1 further value was stored differently');
  });
});

describe('a scale the PRODUCT chose', () => {
  const [block] = buildValueChangeBlocks(facts({ ranges_added: [RANGE] }), AT);

  it('⭐ says whose choice it was, and invites correction', () => {
    // The charter: Olumi's own choices stay distinguishable and open to
    // correction. A scale presented as neutral fact is neither.
    expect(block!.body).toContain('0 to 500');
    expect(block!.body).toContain('the product’s choice, not yours');
    expect(block!.body).toContain('correct it if it is wrong');
  });

  it('⛔ does NOT call it a forecast or a limit', () => {
    // It is a unit of measurement. Calling it either would assert a claim about
    // the user's decision that nobody made.
    expect(block!.body).toContain('unit of measurement rather than a forecast or a limit');
  });
});

describe('the carrier', () => {
  // ⛔ BOTH CONCERNS PRESENT IS THE CASE THAT USED TO SHIP NOTHING. A single
  // combined card ran ~380 chars against the gate's CARD_BODY_MAX_CHARS = 300
  // and was rejected whole, so the turn with the MOST to disclose disclosed
  // nothing. It is now one block per concern.
  const both = buildValueChangeBlocks(facts({ rescaled: [RESCALED], ranges_added: [RANGE] }), AT);
  const block = both[0];

  it('⛔ BOTH concerns ship — the case that previously dropped', () => {
    expect(both).toHaveLength(2);
    expect(both.map((b) => b.title)).toEqual([
      'What was stored differs from what you approved',
      'A scale was chosen for you',
    ]);
  });

  it('⛔ every block stays inside the gate’s own body limit', () => {
    for (const b of both) expect(b.body.length).toBeLessThanOrEqual(300);
  });

  it('⭐ validates whole against the published CoachingBlockSchema', () => {
    // Fail-closed: a block egress would reject takes the whole response with it.
    const parsed = CoachingBlockSchema.safeParse(block);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
  });

  it('⛔ declares an ADMITTED source, not an invented one', () => {
    // `source` is a closed enum and `agent_turn` is not in it — the type system
    // refused that, correctly. `deterministic_signal` is admitted AND true: the
    // server computed `recorded !== requested` in code, with no model involved.
    expect(block!.source).toBe('deterministic_signal');
  });

  it('⛔ ranks FIRST — a card behind "Show N more" is a disclosure that did not happen', () => {
    expect(block!.priority_rank).toBe(1);
  });

  it('is a calibration prompt, not an assumption check', () => {
    // They did not assume this. We did it.
    expect(block!.coaching_kind).toBe('calibration_prompt');
  });

  it('carries a deterministic block id, so a retry does not duplicate the card', () => {
    const [again] = buildValueChangeBlocks(facts({ rescaled: [RESCALED], ranges_added: [RANGE] }), AT);
    expect(again!.block_id).toBe(block!.block_id);
  });

  it('⛔ the two blocks have DIFFERENT ids — one card must not replace the other', () => {
    expect(both[0]!.block_id).not.toBe(both[1]!.block_id);
  });
});

describe('the agent route ships it', () => {
  const ROUTE = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');

  it('the probe can see the route (not vacuous)', () => {
    expect(ROUTE).toContain('analysisBlocks');
  });

  it('⛔ the blocks array carries it — a builder never called is green everywhere', () => {
    expect(ROUTE).toContain('buildValueChangeBlocks(stateFacts');
    expect(ROUTE).toContain('...valueChangeBlocks');
  });

  it('⛔ blocks are emitted even when the analysis produced none', () => {
    // The original gate was `analysisBlocks.length > 0`, so a turn that rescaled
    // a value but ran no analysis would have dropped the disclosure entirely.
    expect(ROUTE).toContain('analysisBlocks.length > 0 || valueChangeBlocks.length > 0');
  });
});


/**
 * ⛔⛔ THE LEXICON GATE MUST BE CONSUMED BY ITS VERDICT.
 *
 * `gateCoachingCardBody` returns a `GateResult`, NOT a boolean. My first version
 * wrote `if (!gate(text))` — always falsy-negated on an object — so the gate was
 * INERT and rejected nothing. A probe caught it; reading the code did not.
 *
 * ⭐ AND THIS IS NOT A CONTRIVED CASE. `agent-capabilities.ts` builds the entry
 * as `factor: byId.get(factorId)?.label ?? factorId`, so a factor the lookup
 * misses arrives with a RAW NODE ID as its "label". With the gate inert, the
 * disclosure card shows the user `fac_a1b2c3` and calls it their factor.
 */
describe('a raw internal id must never reach the card', () => {
  const WITH_ID = {
    option: 'Two Developers',
    factor: 'fac_9f2a1c',          // the ?? factorId fallback, verbatim
    requested: 360,
    recorded: 0.72,
  };

  it('⛔ the card is DROPPED rather than shown with an internal id', () => {
    expect(buildValueChangeBlocks(facts({ rescaled: [WITH_ID] }), AT)).toEqual([]);
  });

  it('⭐ CONTRAST CONTROL — the same entry with a real label DOES ship', () => {
    // Without this, "returns []" would also be satisfied by a builder that
    // never emits anything, and the assertion above would prove nothing.
    const out = buildValueChangeBlocks(facts({ rescaled: [{ ...WITH_ID, factor: 'Delivery Velocity' }] }), AT);
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toContain('Delivery Velocity');
  });

  it('⛔ the scale card is held to the same rule', () => {
    expect(buildValueChangeBlocks(facts({ ranges_added: [{ factor: 'opt_raise_59', range: 500 }] }), AT)).toEqual([]);
    expect(buildValueChangeBlocks(facts({ ranges_added: [{ factor: 'Active Subscribers', range: 500 }] }), AT)).toHaveLength(1);
  });
});

/**
 * ⛔⛔ THE OPTION-LESS RESCALE IS THE NORMAL CASE, and the copy rendered
 * `undefined` into it.
 *
 * The sole producer of `rescaled_by_the_model` (`agent-capabilities.ts:1202`,
 * feeding the emit at `:1292`) carries NO `option`. The card body interpolated
 * `${r.option}` unconditionally, so the real shape produced:
 *
 *     "Monthly churn rate for undefined (you approved 3.5, stored as 0.035)"
 *
 * Showing a user the literal word "undefined" in a disclosure about their own
 * number is worse than the silence it replaced.
 */
describe('the disclosure names the factor alone when there is no option', () => {
  const noOption = { factor: 'Monthly churn rate', requested: 3.5, recorded: 0.035 };

  it('⛔ never renders the word "undefined"', () => {
    const blocks = buildValueChangeBlocks(facts({ rescaled: [noOption] }), AT);
    const text = JSON.stringify(blocks);
    expect(blocks.length, 'precondition: a block IS produced for the real shape').toBeGreaterThan(0);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain(' for undefined');
  });

  it('names the factor, the approved value and the stored value', () => {
    const text = JSON.stringify(buildValueChangeBlocks(facts({ rescaled: [noOption] }), AT));
    expect(text).toContain('Monthly churn rate');
    expect(text).toContain('3.5');
    expect(text).toContain('0.035');
  });

  it('CONTRAST: when an option IS present it is still named', () => {
    const text = JSON.stringify(
      buildValueChangeBlocks(facts({ rescaled: [{ option: 'Two Developers', factor: 'Velocity', requested: 7, recorded: 0.7 }] }), AT),
    );
    expect(text).toContain('Two Developers');
    expect(text).toContain('Velocity');
  });
})
