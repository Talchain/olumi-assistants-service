/**
 * D2 S1 — "Ask Olumi to challenge this" (ACCOUNTS, 2 Oct 2026; spec programme-docs output/d2-team-reasoning/SPEC.md).
 *
 * "Olumi challenges and synthesises" a closed blind round in the HOST's conversation. These rows were written RED
 * before `../panel-challenge.ts` existed (branch accounts/d2-s1-red-rows @daa83b72).
 *
 * The shape these rows pin (smallest change, mirroring RC-PREMORTEM in `method-turn.ts`):
 *   • the carrier is the EXISTING turn field `chip.id` — `agent-panel-challenge:<round uuid>` — so no schemas bump;
 *   • the route recognises the press like `isMethodPress`, reads the round through the collab store with the
 *     VERIFIED caller only, and the method is TERMINAL (`fastPath = 'method'`);
 *   • the context is `summariseDisagreementForPrompt(view)` byte-for-byte; the reply is gated by
 *     `checkPanelChallenge` BEFORE it is sent; a failing draft falls back to the code-owned headline + question.
 *
 * The route rows (the press reaches the branch, ONE tool-less call, the settled reply is what is sent) are in
 * `routes/__tests__/agent-v1-turn.panel-challenge.test.ts`. R5's served corpus (≤10 calls) and R6 (dissent survives
 * apply) are witnessed on staging.
 */
import { describe, expect, it } from 'vitest';

import { FORBIDDEN_RESOLUTION_WORDS } from '../../../../collab/disagreement-copy.js';
import { summariseDisagreementForPrompt, type DisagreementView } from '../../../../collab/disagreement-read-model.js';
import type { CollabStore } from '../../../../collab/types.js';
import { PREMORTEM_PRESS_ID } from '../method-turn.js';
import {
  PANEL_CHALLENGE_PREFIX,
  PANEL_CHALLENGE_UNAVAILABLE,
  checkPanelChallenge,
  panelChallengeFallback,
  panelChallengePressOf,
  panelChallengeTurn,
  resolvePanelChallenge,
  settlePanelChallenge,
} from '../panel-challenge.js';
import { assembleDisagreementView as assembleView } from '../../../../collab/disagreement-read-model.js';
import {
  FIXTURE_ROUND_ID,
  FIXTURE_SCENARIO_ID,
  SENTINELS,
  fixtureRound,
  seededOpenRoundStore,
} from '../../../../../tests/collab/contracts.js';

const ROUND = '0b5d6f0e-3c7a-4d0e-9a51-2f4b8c1d7e90';
const SCENARIO = 'a6f1c2d3-4b5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER_SCENARIO = 'ffffffff-4b5e-4f60-8a7b-9c0d1e2f3a4b';
const OWNER = '11111111-1111-4111-8111-111111111111';

/** A split round: Grace 0.85 (with words), Ada 0.40 (with words), model held 0.60. Self-authored — pure rows only. */
const SPLIT: DisagreementView = {
  round_id: ROUND,
  graph_version_ref: 'v-1',
  standing_note: 'Each person’s answer is shown as they gave it.',
  per_target: [
    {
      target: { kind: 'factor', id: 'fac_close_rate' },
      label: 'Close rate',
      model_value_at_version: 0.6,
      shape: 'split',
      answering_participants: 2,
      distinct_values: 2,
      spread: { low: 0.4, high: 0.85, width: 0.45 },
      positions: [
        { participant_id: 'p-grace', display_label: 'Grace', value: 0.85, stated_basis: 'Last quarter we closed most enterprise pilots.', confidence: 0.7, kind: 'belief_submitted', pole: 'high' },
        { participant_id: 'p-ada', display_label: 'Ada', value: 0.4, stated_basis: 'Procurement cycles doubled this year.', confidence: 0.6, kind: 'belief_submitted', pole: 'low' },
      ],
      positions_with_stated_basis: 2,
      evidence: [],
      headline: '2 people answered, with 2 different numbers between them. They are kept as they were given and are not combined.',
      question: 'These answers differ and each says why. The disagreement is in the reasons — compare what each person is assuming, rather than picking a number.',
    },
  ],
};

const round = (over: Partial<{ status: string; scenario_id: string; created_by: string }> = {}) => ({
  round_id: ROUND,
  scenario_id: SCENARIO,
  status: 'closed',
  created_by: OWNER,
  ...over,
});

describe('D2 S1 — the press (carrier = existing chip.id)', () => {
  it('R3a: recognises its own prefix + a round uuid, and nothing else', () => {
    expect(PANEL_CHALLENGE_PREFIX).toBe('agent-panel-challenge:');
    expect(panelChallengePressOf(`agent-panel-challenge:${ROUND}`)).toEqual({ round_id: ROUND });
    expect(panelChallengePressOf('agent-panel-challenge:not-a-uuid')).toBeNull();
    expect(panelChallengePressOf(`agent-panel-challenge:${ROUND} `)).toBeNull();
    // contrast: the pre-mortem press is a DIFFERENT method and is not claimed here
    expect(panelChallengePressOf(PREMORTEM_PRESS_ID)).toBeNull();
    expect(panelChallengePressOf(undefined)).toBeNull();
  });
});

describe('D2 S1 — the decision (verified owner, own scenario, closed round)', () => {
  it('R3: a closed split round on the turn’s scenario → context is summariseDisagreementForPrompt(view), byte-equal', () => {
    const t = panelChallengeTurn({ caller: OWNER, scenarioId: SCENARIO, round: round(), view: SPLIT });
    expect(t.kind).toBe('challenge');
    expect(t.kind === 'challenge' && t.context).toBe(summariseDisagreementForPrompt(SPLIT));
  });

  it('R4a: an OPEN round → unavailable(round_open), no context, no model call', () => {
    const t = panelChallengeTurn({ caller: OWNER, scenarioId: SCENARIO, round: round({ status: 'open' }), view: null });
    expect(t).toMatchObject({ kind: 'unavailable', reason: 'round_open' });
    expect('context' in t).toBe(false);
  });

  it('R4b: a round of ANOTHER scenario answers exactly like an unknown round (no oracle)', () => {
    const mismatch = panelChallengeTurn({ caller: OWNER, scenarioId: OTHER_SCENARIO, round: round(), view: SPLIT });
    const unknown = panelChallengeTurn({ caller: OWNER, scenarioId: SCENARIO, round: null, view: null });
    expect(mismatch).toMatchObject({ kind: 'unavailable', reason: 'not_found' });
    expect(mismatch).toEqual(unknown);
  });

  it('R4c (pure half): an UNVERIFIED caller (null) never reaches the round', () => {
    const t = panelChallengeTurn({ caller: null, scenarioId: SCENARIO, round: round(), view: SPLIT });
    expect(t).toMatchObject({ kind: 'unavailable', reason: 'not_found' });
  });

  it('R4c: a signed-in caller who did not run the round gets the unknown-round answer, before any status is told', () => {
    const stranger = '22222222-2222-4222-8222-222222222222';
    const closed = panelChallengeTurn({ caller: stranger, scenarioId: SCENARIO, round: round(), view: SPLIT });
    const open = panelChallengeTurn({ caller: stranger, scenarioId: SCENARIO, round: round({ status: 'open' }), view: null });
    expect(closed).toEqual({ kind: 'unavailable', reason: 'not_found', reply: PANEL_CHALLENGE_UNAVAILABLE.not_found });
    expect(open).toEqual(closed);
  });

  it('R4d: a closed round where nobody answered → nothing_to_discuss, no context', () => {
    const empty: DisagreementView = { ...SPLIT, per_target: [{ ...SPLIT.per_target[0]!, shape: 'no_answers', positions: [], question: null }] };
    expect(panelChallengeTurn({ caller: OWNER, scenarioId: SCENARIO, round: round(), view: empty }))
      .toMatchObject({ kind: 'unavailable', reason: 'nothing_to_discuss' });
  });
});

describe('D2 S1 — resolvePanelChallenge through the collab store (the reveal’s own gates, inherited)', () => {
  const OWNER_ID = SENTINELS.OWNER_USER_ID;
  // The N-suite fixture store is the contract's shape, not the port's type: adapted the way the panel-apply suites do.
  const asPort = (s: ReturnType<typeof seededOpenRoundStore>): CollabStore => s as unknown as CollabStore;
  const closedStore = (): CollabStore => {
    const store = seededOpenRoundStore();
    store.state.rounds.set(FIXTURE_ROUND_ID, fixtureRound({ status: 'closed' }));
    return asPort(store);
  };

  it('R3 (store): a closed owned round → context byte-equal to the summary of the reveal’s own disagreement view', async () => {
    const store = closedStore();
    const t = await resolvePanelChallenge(() => store, { caller: OWNER_ID, scenarioId: FIXTURE_SCENARIO_ID, roundId: FIXTURE_ROUND_ID });
    const view = await assembleView(store, { round_id: FIXTURE_ROUND_ID, requested_by: { kind: 'owner', user_id: OWNER_ID } });
    expect(t.kind).toBe('challenge');
    expect(t.kind === 'challenge' && t.context).toBe(summariseDisagreementForPrompt(view));
    expect(t.kind === 'challenge' && t.directive).toContain(summariseDisagreementForPrompt(view));
  });

  it('R4a (store): the seeded OPEN round → round_open', async () => {
    const store = asPort(seededOpenRoundStore());
    expect(await resolvePanelChallenge(() => store, { caller: OWNER_ID, scenarioId: FIXTURE_SCENARIO_ID, roundId: FIXTURE_ROUND_ID }))
      .toMatchObject({ kind: 'unavailable', reason: 'round_open' });
  });

  it('R4b/R4c (store): another scenario, another caller and an unknown id all give ONE answer', async () => {
    const store = closedStore();
    const unknown = await resolvePanelChallenge(() => store, { caller: OWNER_ID, scenarioId: FIXTURE_SCENARIO_ID, roundId: 'no-such-round' });
    const otherScenario = await resolvePanelChallenge(() => store, { caller: OWNER_ID, scenarioId: 'scenario-other', roundId: FIXTURE_ROUND_ID });
    const otherCaller = await resolvePanelChallenge(() => store, { caller: 'someone-else', scenarioId: FIXTURE_SCENARIO_ID, roundId: FIXTURE_ROUND_ID });
    expect(unknown).toMatchObject({ kind: 'unavailable', reason: 'not_found' });
    expect(otherScenario).toEqual(unknown);
    expect(otherCaller).toEqual(unknown);
  });

  it('a store that cannot be built or read → unreadable, never a throw', async () => {
    const t = await resolvePanelChallenge(() => { throw new Error('no env'); }, { caller: OWNER_ID, scenarioId: FIXTURE_SCENARIO_ID, roundId: FIXTURE_ROUND_ID });
    expect(t).toMatchObject({ kind: 'unavailable', reason: 'unreadable' });
  });
});

describe('D2 S1 — the reply gate (restate or ask, never adjudicate)', () => {
  const GOOD =
    'Grace puts the close rate at 0.85 because enterprise pilots closed last quarter; Ada puts it at 0.4 because procurement cycles doubled. ' +
    'The model held 0.6. What would tell you which assumption holds this year?';

  it('R5a: a draft that restates the stated positions and asks → passes', () => {
    expect(checkPanelChallenge(GOOD, SPLIT)).toEqual({ ok: true });
  });

  it('R5b: every FORBIDDEN_RESOLUTION_WORD fails the gate (whole list, not a sample)', () => {
    for (const w of FORBIDDEN_RESOLUTION_WORDS) {
      expect(checkPanelChallenge(`${GOOD} The ${w} view is clear.`, SPLIT).ok, w).toBe(false);
    }
  });

  it('R5c: a number nobody stated (an invented midpoint 0.625) fails; a stated one does not', () => {
    expect(checkPanelChallenge(`${GOOD} Call it 0.625.`, SPLIT)).toMatchObject({ ok: false, reason: 'unstated_number' });
    expect(checkPanelChallenge(`${GOOD} Ada said 0.4.`, SPLIT)).toEqual({ ok: true });
  });

  it('R5d: a split target with no question in the draft fails', () => {
    expect(checkPanelChallenge('Grace said 0.85. Ada said 0.4.', SPLIT)).toMatchObject({ ok: false, reason: 'no_question' });
  });

  // R5e pins two gate rules the fallback forces: the sanctioned negation 'are not combined' (stripSanctionedNegations)
  // is not a forbidden-word hit, and counts the view itself carries (answering_participants, distinct_values) are stated.
  it('R5e: the fallback is code-owned — each target’s headline then its question, and it passes its own gate', () => {
    const fb = panelChallengeFallback(SPLIT);
    expect(fb).toContain(SPLIT.per_target[0]!.headline);
    expect(fb).toContain(SPLIT.per_target[0]!.question!);
    expect(checkPanelChallenge(fb, SPLIT)).toEqual({ ok: true });
  });

  it('R5f: settle sends a passing draft verbatim and a failing one as the fallback — never a repair', () => {
    const turn = panelChallengeTurn({ caller: OWNER, scenarioId: SCENARIO, round: round(), view: SPLIT });
    if (turn.kind !== 'challenge') throw new Error('expected a challenge turn');
    expect(settlePanelChallenge(turn, GOOD)).toEqual({ reply: GOOD, passed: true, failed: null });
    const bad = settlePanelChallenge(turn, `${GOOD} The consensus is 0.6.`);
    expect(bad.passed).toBe(false);
    expect(bad.reply).toBe(panelChallengeFallback(SPLIT));
    expect(settlePanelChallenge(turn, '').reply).toBe(panelChallengeFallback(SPLIT));
  });

  it('R5g: a percentage of a stated proportion counts as stated (85% for 0.85); 62% does not', () => {
    expect(checkPanelChallenge(`${GOOD} Grace’s 85% is the high end.`, SPLIT)).toEqual({ ok: true });
    expect(checkPanelChallenge(`${GOOD} Somewhere near 62% seems fair.`, SPLIT)).toMatchObject({ ok: false, reason: 'unstated_number' });
  });
});
