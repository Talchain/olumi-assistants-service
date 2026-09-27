/**
 * ⭐ PAUL-HIT B1 (AIC #70 5854805501; R&C claim 5854818253) — AN ADDED OPTION THE RUN LEFT OUT READS `ready` — RED-first
 * on Paul's own export `90b8f080` (frozen PAUL_TEST_NOW tuple, CEE 263dbd5).
 *
 * THE DEFECT: Paul added "£59 for new Pro customers; grandfather existing customers". Its new factor's level was never
 * recorded, so the option's only intervention is the price — identical to "Increase price to £59" — and its
 * `analysis_ready` status reads `ready`. The result did not score it (its label is absent from `win_probabilities`).
 * #2075's untested-option card required `status !== 'ready'`, so the Run's one card was "Your limit could not be
 * checked" and nothing asked for the missing level. CEE's readiness authority had already said why, TYPED:
 * `analysis_ready.blockers[]` → `{ option_id, factor_label, blocker_type: 'missing_value', suggested_action: 'add_value' }`.
 *
 * THE RULE: an option is untested when the bound result does not score it AND (its status is not `ready` OR a
 * `missing_value` blocker names its option_id). Reads the existing blocker; the card words are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTurnCoaching, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';

type Rec = Record<string, unknown>;
type Served = {
  graph_hash: string;
  analysis_state: Rec;
  analysis_result: Rec & { win_probabilities: Record<string, number> };
  analysis_ready: Rec & { options: Array<Rec & { option_id: string; label: string; status: string }>; blockers: Rec[] };
  draft_graph: Rec;
  served_card_signal_id: string;
};
const served = JSON.parse(readFileSync(
  new URL('../../coaching/__tests__/fixtures/paul-export-90b8f080-untested-option.json', import.meta.url), 'utf8',
)) as Served;
const ADDED = '146aa89d';
const ADDED_LABEL = '£59 for new Pro customers; grandfather existing customers';

const cards = (ready: Served['analysis_ready'] = served.analysis_ready, result: Served['analysis_result'] = served.analysis_result) => {
  const captured: CapturedAnalysis = {
    scenario_id: 'paul-90b8f080', status: 200, trigger: 'explicit_run',
    analysis_state: served.analysis_state, analysis_ready: ready, blocks: [result],
  };
  const final: RunTurnCoachingFinal = {
    scenarioId: 'paul-90b8f080', graphHash: served.graph_hash, analysisState: served.analysis_state,
    analysisResult: result, graph: served.draft_graph,
    // The served Run card took the `unchecked` arm, which only `unevaluated` licenses.
    constraintVerdictState: 'unevaluated',
  };
  return runTurnCoaching(captured, final).blocks.filter((b) => /^coach:[a-z_]+:/.test((b as { signal_id?: string }).signal_id ?? '')) as
    Array<{ signal_id: string; title: string; body: string; action_label: string }>;
};
const withoutBlocker = () => ({ ...served.analysis_ready, blockers: served.analysis_ready.blockers.filter((b) => b.option_id !== ADDED) });

describe('B1: an added option the run left out, though it reads `ready`', () => {
  it('precondition (Paul\'s export): ready, unscored, and a typed missing_value blocker names it', () => {
    const opt = served.analysis_ready.options.find((o) => o.option_id === ADDED)!;
    expect(opt.label).toBe(ADDED_LABEL);
    expect(opt.status).toBe('ready');
    expect(Object.keys(served.analysis_result.win_probabilities)).not.toContain(ADDED_LABEL);
    expect(served.analysis_ready.blockers).toContainEqual(expect.objectContaining({ option_id: ADDED, blocker_type: 'missing_value' }));
  });

  it('CONTRAST: without that blocker, the served Run card is reproduced exactly (the fixture rebinds)', () => {
    expect(cards(withoutBlocker()).map((c) => c.signal_id)).toEqual([served.served_card_signal_id]);
  });

  it('RED: the one card names the untested option and asks for its level', () => {
    const got = cards();
    expect(got).toHaveLength(1);
    expect(got[0]!.signal_id).toBe(`coach:untested_option:${served.graph_hash}:2026-09-27T09:37:54.843Z:explicit_run:named:${ADDED}`);
    expect(got[0]!.title).toBe('One option was not tested');
    expect(got[0]!.body).toContain(`This analysis did not test “${ADDED_LABEL}”`);
    expect(got[0]!.action_label).toBe('Give its level');
  });

  it('CONTRAST: a missing_value blocker on an option the result DID score is not "untested"', () => {
    const result = { ...served.analysis_result, win_probabilities: { ...served.analysis_result.win_probabilities, [ADDED_LABEL]: 0.01 } };
    expect(cards(served.analysis_ready, result).some((c) => c.signal_id.startsWith('coach:untested_option:'))).toBe(false);
  });

  it('CONTRAST: a blocker of another type naming the option is not "missing its level"', () => {
    const ready = {
      ...served.analysis_ready,
      blockers: served.analysis_ready.blockers.map((b) => (b.option_id === ADDED ? { ...b, blocker_type: 'invalid_unit' } : b)),
    };
    expect(cards(ready).some((c) => c.signal_id.startsWith('coach:untested_option:'))).toBe(false);
  });
});
