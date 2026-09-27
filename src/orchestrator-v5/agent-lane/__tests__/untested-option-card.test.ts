/**
 * ⭐ AN OPTION THE RUN COULD NOT TEST IS THE ONE NEXT MOVE — RED-first (served 27 Sep, R&C dloop2x-1, #70 5851938869).
 *
 * THE DEFECT (UI 49af8bb3 · CEE 3c4d9cc): after the limit card's "Change or add an option", the user added "Keep the
 * price at £49 and launch a retention programme", approved it, and re-ran. The run left it out (`needs_encoding`: no
 * level for what it changes), and the one card still said "No option meets your limit" → "Change or add an option" —
 * the move the user had just made.
 *
 * THE RULE: on an explicit run, an option whose `analysis_ready` status is not `ready` AND whose label the result does
 * not score is named by the one card, which asks for its level (offered for approval, nothing changed until then).
 * Both facts must agree; the automatic first pass is untouched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTurnCoaching, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';
import { ELICITATION_CLOSE, RUN_TURN_COACHING_CONTRACT } from '../../coaching/fragile-link-challenge.js';
import { composeUntestedOptionCard } from '../../coaching/untested-option-card.js';

type Option = { option_id: string; label: string; status: string };
type Served = {
  graph_hash: string;
  analysis_state: Record<string, unknown> & { leader_claim: Record<string, unknown> };
  analysis_result: Record<string, unknown> & { win_probabilities: Record<string, number> };
  analysis_ready: Record<string, unknown> & { options: Option[] };
  draft_graph: Record<string, unknown>;
  served_card_signal_id: string;
};
// Verbatim wire fields of the served re-run turn (dloop2x-1 04h-rerun2).
const served = JSON.parse(readFileSync(
  new URL('../../coaching/__tests__/fixtures/served-rerun-untested-option-20260927.json', import.meta.url), 'utf8',
)) as Served;
const ADDED = 'Keep the price at £49 and launch a retention programme';

const run = (opts: { ready?: Served['analysis_ready']; result?: Served['analysis_result']; trigger?: 'explicit_run' | 'auto_first_pass' } = {}) => {
  const result = opts.result ?? served.analysis_result;
  const captured: CapturedAnalysis = {
    scenario_id: 'dloop2x-1', status: 200, trigger: opts.trigger ?? 'explicit_run',
    analysis_state: served.analysis_state, analysis_ready: opts.ready ?? served.analysis_ready, blocks: [result],
  };
  const final: RunTurnCoachingFinal = {
    scenarioId: 'dloop2x-1', graphHash: served.graph_hash, analysisState: served.analysis_state,
    analysisResult: result, graph: served.draft_graph,
  };
  return runTurnCoaching(captured, final).blocks.filter((b) =>
    /^coach:(fragile_link|no_flagged_link|limit_unchecked|near_tie|limit_estimate|untested_option):/.test((b as { signal_id: string }).signal_id),
  ) as Array<{ signal_id: string; title: string; body: string; action_label: string; action_prompt: string }>;
};
// `ready` ALSO drops that option's typed `missing_value` blocker: the one missing-level authority
// (`deriveMissingEffectPairs`) reads it, so a status-only flip still leaves the option untested (C4 / Paul-hit B1).
const withStatus = (status: string) => {
  const optionId = served.analysis_ready.options.find((o) => o.label === ADDED)?.option_id;
  const blockers = (served.analysis_ready as { blockers?: { option_id?: unknown }[] }).blockers;
  return {
    ...served.analysis_ready,
    options: served.analysis_ready.options.map((o) => (o.label === ADDED ? { ...o, status } : o)),
    ...(status === 'ready' && Array.isArray(blockers) ? { blockers: blockers.filter((b) => b.option_id !== optionId) } : {}),
  };
};

describe('an option the run could not test is the one next move', () => {
  it('precondition: the served run left the added option out (needs_encoding, not scored)', () => {
    expect(served.analysis_ready.options.find((o) => o.label === ADDED)?.status).toBe('needs_encoding');
    expect(Object.keys(served.analysis_result.win_probabilities)).not.toContain(ADDED);
    expect(served.analysis_state.leader_claim).toMatchObject({ withheld_reason: 'no_option_meets_limit' });
  });

  it('CONTRAST: the same served run with that option ready reproduces the served card (the fixture rebinds)', () => {
    expect(run({ ready: withStatus('ready') }).map((c) => c.signal_id)).toEqual([served.served_card_signal_id]);
  });

  it('RED: one card names the untested option and asks for its level, never "change or add" again', () => {
    const cards = run();
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card!.signal_id.startsWith('coach:untested_option:')).toBe(true);
    expect(card!.signal_id.endsWith(':explicit_run:named:80206211')).toBe(true);
    // C4: the title stands alone (a surface may show it without the body), so it names the option.
    expect(card!.title).toBe(`“${ADDED}” was not tested`);
    expect(card!.body).toContain(`This analysis did not test “${ADDED}”`);
    expect(card!.action_label).toBe('Give its level');
    expect(card!.action_prompt).toContain('Ask me what level it sets and what that rests on.');
    expect(card!.action_prompt.endsWith(ELICITATION_CLOSE)).toBe(true);
    expect(`${card!.action_label} ${card!.action_prompt}`).not.toMatch(/change or add|re-run|run (it|the analysis) again/i);
  });

  it('CONTRAST: a non-ready status whose label the result DOES score is not "untested" (both facts must agree)', () => {
    const result = { ...served.analysis_result, win_probabilities: { ...served.analysis_result.win_probabilities, [ADDED]: 0.1 } };
    expect(run({ result }).some((c) => c.signal_id.startsWith('coach:untested_option:'))).toBe(false);
  });

  it('CONTRAST: the automatic first pass never takes this card', () => {
    expect(run({ trigger: 'auto_first_pass' }).some((c) => c.signal_id.startsWith('coach:untested_option:'))).toBe(false);
  });

  it('bounds: every form fits the run-turn contract', () => {
    const { title_max, body_max, action_label_max, action_prompt_max } = RUN_TURN_COACHING_CONTRACT.limits;
    for (const c of [composeUntestedOptionCard(ADDED, 1), composeUntestedOptionCard(null, 1), composeUntestedOptionCard(null, 2)]) {
      expect(c.title.length).toBeLessThanOrEqual(title_max);
      expect(c.body.length).toBeLessThanOrEqual(body_max);
      expect(c.action_label.length).toBeLessThanOrEqual(action_label_max);
      expect(c.action_prompt.length).toBeLessThanOrEqual(action_prompt_max);
    }
  });
});
