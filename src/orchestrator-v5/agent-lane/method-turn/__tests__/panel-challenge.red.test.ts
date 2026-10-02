/**
 * D2 S1 — RED ROWS ONLY (ACCOUNTS, 2 Oct 2026; spec programme-docs output/d2-team-reasoning/SPEC.md).
 *
 * "Olumi challenges and synthesises" a closed blind round in the HOST's conversation. The module under test,
 * `../panel-challenge.ts`, does NOT exist at this tip — every row here is RED by construction, and the build lands it.
 * Queued behind B2 by the DL; no PR from this branch.
 *
 * The shape these rows pin (smallest change, mirroring RC-PREMORTEM in `method-turn.ts`):
 *   • the carrier is the EXISTING turn field `chip.id` — `agent-panel-challenge:<round uuid>` — so no schemas bump;
 *   • the route recognises the press like `isMethodPress`, reads the round through the collab store with the
 *     VERIFIED caller only, and the method is TERMINAL (`fastPath = 'method'`);
 *   • the context is `summariseDisagreementForPrompt(view)` byte-for-byte; the reply is gated by
 *     `checkPanelChallenge` BEFORE it is sent; a failing draft falls back to the code-owned headline + question.
 *
 * Route-level rows (R4c member/participant refused at the turn's owner gate; R5 served corpus ≤10 calls; R6 dissent
 * survives apply) are listed in the spec and belong to the build PR — they need the real route + served replies.
 */
import { describe, expect, it } from 'vitest';

import { FORBIDDEN_RESOLUTION_WORDS } from '../../../../collab/disagreement-copy.js';
import { summariseDisagreementForPrompt, type DisagreementView } from '../../../../collab/disagreement-read-model.js';
import { PREMORTEM_PRESS_ID } from '../method-turn.js';
import {
  PANEL_CHALLENGE_PREFIX,
  checkPanelChallenge,
  panelChallengeFallback,
  panelChallengePressOf,
  panelChallengeTurn,
} from '../panel-challenge.js';

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

const round = (over: Partial<{ status: string; scenario_id: string }> = {}) => ({
  round_id: ROUND,
  scenario_id: SCENARIO,
  status: 'closed',
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
});
