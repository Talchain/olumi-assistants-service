/**
 * ⭐⭐ THE NUMBER AND ITS MEANING TRAVEL TOGETHER.
 *
 * `analysis.margin` is, at its producer
 * (`orchestrator/context/analysis-compact.ts:836-838`),
 * `recommendableOptions[0].win_probability - recommendableOptions[1].win_probability`
 * — the difference between two simulation WIN SHARES. Not an outcome gap, not
 * an effect size, not a probability that the leader does better by that amount.
 *
 * It reaches the model (live join, native request
 * `e986bfbe-2bbf-4a5a-bb40-816bf3bf5050`, CEE `42d1f62`: the model-facing
 * `analysis_section_keys` include `margin`) and, until this change, with no
 * statement of what it is. That answer called 55% vs 36% "a 19 point margin"
 * while the rendered `decision_review` in the SAME response said a frequency
 * difference is not an outcome difference.
 *
 * ⚠ The model did not invent that; it read a field we shipped unlabelled. So the
 *   control is emission-bound, exactly like the provisional-figures
 *   qualification: present when the number is, absent when it is not. No word is
 *   banned and no claim is suppressed.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import {
  MARGIN_MEANING_INSTRUCTION,
  buildUserMessage,
} from '../route-with-tool-use.js';
import type { ContextPack } from '../../context/context-pack-assembler.js';

const USER_MESSAGE = 'What should we look at first?';

function packWith(analysis: unknown): ContextPack {
  return {
    version: '2.0',
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    stage: 'analyse',
    analysis,
  } as unknown as ContextPack;
}

describe('the margin instruction is emitted with the margin, never apart from it', () => {
  it('a serialised non-null margin carries its definition', () => {
    const message = buildUserMessage(
      packWith({ status: 'ok', leading_option: 'A', runner_up: 'B', margin: 0.19 }),
      USER_MESSAGE,
    );
    expect(message).toContain(MARGIN_MEANING_INSTRUCTION);
  });

  it('NEGATIVE — no margin, no instruction', () => {
    // Without this the assertion above could pass on a prompt that appends the
    // block unconditionally, which would tell the model about a field it never
    // received.
    const message = buildUserMessage(
      packWith({ status: 'ok', leading_option: 'A', runner_up: 'B' }),
      USER_MESSAGE,
    );
    expect(message).not.toContain(MARGIN_MEANING_INSTRUCTION);
  });

  it('NEGATIVE — an explicitly null margin is not a margin', () => {
    const message = buildUserMessage(
      packWith({ status: 'ok', leading_option: 'A', runner_up: 'B', margin: null }),
      USER_MESSAGE,
    );
    expect(message).not.toContain(MARGIN_MEANING_INSTRUCTION);
  });

  it('says what the number IS, and what it is not, without banning discussion of it', () => {
    // Bound to the producer's own definition rather than to wording taste.
    expect(MARGIN_MEANING_INSTRUCTION).toContain('win share minus the runner-up');
    expect(MARGIN_MEANING_INSTRUCTION).toContain('NOT an outcome gap');
    // The comparison stays discussable — this is a qualification, not a ban.
    expect(MARGIN_MEANING_INSTRUCTION).toContain('Discuss it as a difference');
  });
});
