/**
 * ⛔ A REFUSED BUILD IS TOLD TO THE USER IN WORDS, WITH A NEXT STEP — never as a code.
 *
 * MEASURED on served staging `785185b7` (acceptance witness, hiring scenario
 * `03b93536`; replayed 4/4 with the real `runAgentTurn`): a first build refused
 * `model_too_large` left the user reading "The model was not built: it was refused
 * (model_too_large)." — an internal code, no reason, no next step. Every
 * `build_model_from_brief` refusal the builder can return is listed here from
 * `runtime/build-model.ts`, and each must read as a sentence.
 */
import { describe, it, expect } from 'vitest';
import { narrateWriteOutcome, withWriteOutcome } from '../write-outcome.js';

const BUILD_REFUSALS = ['model_too_large', 'no_structured_output', 'construction_failed', 'admitted_graph_invalid', 'registration_refused'] as const;
/** Exactly what the user reads: the model's checked words, then the server's status line. */
const said = (refusal: string) => {
  const n = narrateWriteOutcome('Here is what I found.', [{ name: 'build_model_from_brief' }], [{ ok: false, mutated: false, refusal }]);
  return withWriteOutcome(n.text, n.status);
};

describe('a refused build says why, in words, with a next step', () => {
  for (const code of BUILD_REFUSALS) {
    it(`RED: ${code} is not shown to the user as a code`, () => {
      const text = said(code);
      expect(text).toContain('The model was not built');
      expect(text, text).not.toContain(code);
      expect(text).toMatch(/ask me|try again|tell me/i);
    });
  }

  it('CONTRAST: a code nobody has worded still falls back to the honest raw code, never to silence', () => {
    expect(said('some_new_refusal')).toContain('it was refused (some_new_refusal)');
  });
});

describe('⛔ the wording is true of EVERY way the producer reaches the code (review 5803854263)', () => {
  /**
   * `construction_failed` is produced both when the builder call throws AND when it
   * returns a non-empty answer that is not a usable model (`build-model.ts`, the
   * JSON.parse catch). "Did not answer" is false in the second case, so the words
   * must claim only what both cases share: no usable model came back.
   */
  const buildSaid = async (callStructured: unknown) => {
    const { buildModelFromBrief } = await import('../runtime/build-model.js');
    const dispatch = async () => ({ status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } });
    const out = await buildModelFromBrief('33333333-3333-4333-8333-333333333333', 'Should I hire a tech lead?', dispatch as never, callStructured as never);
    const n = narrateWriteOutcome('Here is what I found.', [{ name: 'build_model_from_brief' }], [out as never]);
    return { refusal: (out as { refusal?: string }).refusal, text: withWriteOutcome(n.text, n.status) };
  };

  it('RED: the builder ANSWERED with malformed output: never told the user it "did not answer"', async () => {
    const r = await buildSaid(async () => ({ text: '{"goal": {"metric": "Velocity"' }));
    expect(r.refusal, 'the control: this is the construction_failed producer path').toBe('construction_failed');
    expect(r.text).not.toMatch(/did not answer/i);
    expect(r.text).toMatch(/could not produce a usable model/i);
    expect(r.text).toMatch(/ask me to try again/i);
  });

  it('the builder call THREW: the same honest no-build message with a retry', async () => {
    const r = await buildSaid(async () => { throw new Error('upstream timeout'); });
    expect(r.refusal).toBe('construction_failed');
    expect(r.text).toContain('The model was not built');
    expect(r.text).toMatch(/could not produce a usable model/i);
    expect(r.text).not.toContain('construction_failed');
  });
});
