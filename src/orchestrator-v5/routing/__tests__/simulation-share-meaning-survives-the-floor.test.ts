/**
 * ⭐⭐⭐ THE READING SURVIVES THE ADMISSION FLOOR; THE QUALIFICATION DOES NOT.
 *
 * `PROVISIONAL_FIGURES_INSTRUCTION` carries two kinds of line under ONE
 * condition:
 *   · QUALIFICATION — "every estimate is machine-authored", "not a settled
 *     ranking", "no winner or contest framing". True only while nothing in the
 *     model is the person's own.
 *   · READING — "a simulation share is how often an option scored highest
 *     against the goal, not the probability that the goal is achieved". True
 *     of every run that produced a share, whoever authored the inputs.
 *
 * Both are gated on `analysis_context.status === 'provisional_figures'`, which
 * the assembler sets only when the admission caps at `quantified_provisional`.
 * The admission floor is `material_parameters_user_stated > 0`, so ONE figure
 * a person types into their brief moves their run off that arm — and took the
 * reading with it. Dropping the qualification there is correct: it had become
 * false about them. Dropping the reading left the coach free to describe a 55%
 * share as a 55% chance of success on the very run they are most likely to act
 * on.
 *
 * ── WHY THE FIX IS HERE AND NOT AT THE WIRE
 * The output chokepoint (`compose/leading-option-wire-enforcement.ts`) is
 * ruled BY-REFERENCE on the licensed arm — 23 assertions across five specs pin
 * that a permitted response is returned untouched. Attaching prose there would
 * overwrite a standing ruling. The house mechanism for "a number and its
 * definition travel together" is the co-located conditional instruction, which
 * `MARGIN_MEANING_INSTRUCTION` and the provisional block already use, and
 * which restricts nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  PROVISIONAL_FIGURES_INSTRUCTION,
  SIMULATION_SHARE_MEANING_INSTRUCTION,
  buildUserMessage,
} from '../route-with-tool-use.js';
import type { ContextPack } from '../../context/context-pack-assembler.js';

const USER_MESSAGE = 'Which option looks strongest?';

/** The one sentence both blocks must carry, and neither may carry twice. */
const RATIFIED_READING =
  'A simulation share is how often an option scored highest against the goal, not the probability that the goal is achieved.';

/**
 * ⚠ `display_analysis`, NOT `analysis` — the model-facing projection drops the
 *   raw `analysis` and surfaces `display_analysis` under that key. The sibling
 *   margin spec records a hosted failure caused by getting this wrong.
 */
function packWith(displayAnalysis: unknown, analysisContext?: unknown): ContextPack {
  return {
    version: '2.0',
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    stage: 'analyse',
    display_analysis: displayAnalysis,
    ...(analysisContext === undefined ? {} : { analysis_context: analysisContext }),
  } as unknown as ContextPack;
}

/**
 * Shares in the shape the DISPLAY projection actually carries.
 *
 * ⛔ `win_probability` IS A STRING HERE. `DisplaySafeAnalysisOption` types it
 *    `string` and formats it `"86%"` / `">99%"` / `"<1%"`
 *    (`format/format-analysis-for-context.ts:39-48`); the raw decimal never
 *    reaches `llmFacing.analysis`. My first fixture used `0.55` and my first
 *    detector tested for a number, so spec and code agreed with each other and
 *    both were wrong about the wire. The derived `prompt-pack-sanction` gate,
 *    which assembles a real pack, is what refused it.
 */
const WITH_SHARES = {
  status: 'ok',
  options: [
    { label: 'Adopt RudderStack', win_probability: '55%' },
    { label: 'Adopt Segment', win_probability: '36%' },
  ],
};

describe('the simulation-share reading reaches the coach on both admission arms', () => {
  it('⭐ a PERMITTED run with shares still gets the reading', () => {
    // This is the population a person's own typed figure moves their run into.
    // Before the split it received neither block, so nothing told the coach
    // what the 55% means.
    const message = buildUserMessage(packWith(WITH_SHARES), USER_MESSAGE);

    expect(message).toContain(SIMULATION_SHARE_MEANING_INSTRUCTION);
    expect(message).toContain(RATIFIED_READING);
  });

  it('⛔ NEGATIVE — no shares in the pack, no instruction', () => {
    // Without this the assertion above could pass on a prompt that appends the
    // block unconditionally, telling the coach about numbers it never received.
    const message = buildUserMessage(packWith({ status: 'ok', margin: null }), USER_MESSAGE);

    expect(message).not.toContain(SIMULATION_SHARE_MEANING_INSTRUCTION);
  });

  it('⛔ NEGATIVE — options without a win_probability are not shares', () => {
    const message = buildUserMessage(
      packWith({ status: 'ok', options: [{ label: 'Adopt RudderStack' }] }),
      USER_MESSAGE,
    );

    expect(message).not.toContain(SIMULATION_SHARE_MEANING_INSTRUCTION);
  });

  it('⭐ THE DISCRIMINATING TWIN — the provisional arm gets BOTH blocks and the reading exactly once', () => {
    // Same shares, the other admission answer. Both blocks now fire, because
    // the reading has ONE owner and the provisional block keeps only its
    // qualification lines. Asserting the COUNT is the point: leaving the line
    // in both constants would read it to the coach twice, and suppressing this
    // block on that arm makes it an instruction no maximal pack can render —
    // which `prompt-pack-sanction.gate`'s EMISSION check refuses outright.
    const message = buildUserMessage(
      packWith(WITH_SHARES, { status: 'provisional_figures' }),
      USER_MESSAGE,
    );

    expect(message).toContain(PROVISIONAL_FIGURES_INSTRUCTION);
    expect(message).toContain(SIMULATION_SHARE_MEANING_INSTRUCTION);
    expect(message.split(RATIFIED_READING).length - 1).toBe(1);
  });

  it('the reading arrives exactly once on the PERMITTED arm too', () => {
    const message = buildUserMessage(packWith(WITH_SHARES), USER_MESSAGE);

    expect(message).not.toContain(PROVISIONAL_FIGURES_INSTRUCTION);
    expect(message.split(RATIFIED_READING).length - 1).toBe(1);
  });

  it('⛔ it says what the number MEANS and re-imposes no restriction the admission lifted', () => {
    // The provisional block's qualification lines are deliberately absent. On
    // this arm the product is entitled to name a leading option, and quietly
    // reinstating "no winner framing" would be the over-suppression trade
    // running backwards — a fix in one direction opening the defect in the
    // other.
    expect(SIMULATION_SHARE_MEANING_INSTRUCTION).toContain(RATIFIED_READING);
    expect(SIMULATION_SHARE_MEANING_INSTRUCTION).not.toContain('machine-authored');
    expect(SIMULATION_SHARE_MEANING_INSTRUCTION).not.toContain('settled ranking');
    expect(SIMULATION_SHARE_MEANING_INSTRUCTION).not.toContain('No winner');
    expect(SIMULATION_SHARE_MEANING_INSTRUCTION).not.toContain('provisional');
    // ⛔ AND THE PROVISIONAL BLOCK NO LONGER CARRIES IT. One sentence, one
    // owner: leaving a copy behind is the hand-maintained mirror this estate
    // pays for, and it would read to the coach twice on the provisional arm.
    expect(PROVISIONAL_FIGURES_INSTRUCTION).not.toContain(RATIFIED_READING);
    // The qualification lines stay exactly where they were.
    expect(PROVISIONAL_FIGURES_INSTRUCTION).toContain('machine-authored');
    expect(PROVISIONAL_FIGURES_INSTRUCTION).toContain('No winner or contest framing');
  });
});
