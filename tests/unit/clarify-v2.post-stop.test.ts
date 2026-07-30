/**
 * ROADMAP 2.171 — post-explicit-Stop fold disclosure (Paul-ratified, 30 Jul).
 *
 * The tester confound (stop-fence acceptance probe, arm 1): a user STOPS a
 * draft, types a NEW brief on the same scenario, and the live clarify round
 * claims it as an answer — "Thanks — I have folded that in…" — so a
 * defaults-click drafts the OLD topic and the stop reads as ignored.
 *
 * Ratified semantics: KEEP the fold; in exactly this state the coach must
 * DISCLOSE it is still working on the ORIGINAL decision and offer the choice
 * ("fold this in, or start over?"), with "start over" routing to the existing
 * new-draft path. Ordinary folds are untouched (control pin below).
 *
 * The post-Stop signal is SERVER-VISIBLE: the #759 stop tombstone
 * (`v5_turn_fence.stopped_at`), read as "the newest prior fence row on this
 * scenario is tombstoned" — any later ordinary turn clears the state by
 * claiming a newer generation.
 *
 * RED-first: the DISCLOSURE pin was proven RED at bfcd89f0 (pre-fix copy is
 * the plain fold ack) with the CONTROL pin green — evidence in
 * PHASE0-EVIDENCE-2026-07-28/cee-consolidated-quality.md.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

import type { PendingAction } from '../../src/orchestrator-v5/session/pending-action.js';

vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../src/orchestrator-v5/session/index.js')
  >();
  const { buildHarnessSessionStore } = await import(
    '../utils/clarify-v2-dispatch-harness.js'
  );
  return {
    ...original,
    getSessionStore: () => buildHarnessSessionStore(),
    resetSessionStoreForTests: () => {},
  };
});

import {
  clarifyV2Harness,
  resetClarifyV2Harness,
  runClarifyV2Turn,
  seedClarifyPending,
} from '../utils/clarify-v2-dispatch-harness.js';

/** Topic A — the original decision the user stopped a draft of. */
const ORIGINAL_BRIEF = 'Should we expand into the German market?';
/**
 * Topic B — the new brief typed right after the Stop. Deliberately NOT a
 * standalone draft-shaped restatement (the probe's brief B folded, which is
 * the confound this row exists for), so the resume FOLDS it.
 */
const NEW_BRIEF = 'We also need to pick a CRM for the sales team.';

const SEEDED_ROUND: readonly [string, readonly string[], number] = [
  ORIGINAL_BRIEF,
  ['goal', 'options', 'timeframe'],
  1,
];

function roundPendingOf(appends: readonly Record<string, unknown>[]): PendingAction | undefined {
  const pendings = (appends[0]?.pending_actions ?? []) as PendingAction[];
  return pendings.find((p) => p.action.kind === 'clarify_v2_round');
}

describe('2.171 — post-Stop fold disclosure (RED-first pin + control)', () => {
  beforeEach(async () => {
    await resetClarifyV2Harness();
  });
  afterAll(async () => {
    const telemetry = await import('../../src/utils/telemetry.js');
    telemetry.setTestSink(null);
  });

  // ── THE PIN (proven RED before the fix) ──────────────────────────────────
  it('post-Stop + new brief + same scenario: the fold reply DISCLOSES the original topic and offers "start over"', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...SEEDED_ROUND)];
    clarifyV2Harness.latestScenarioTurnStopped = true;

    const { outcome, appends } = await runClarifyV2Turn({
      message: NEW_BRIEF,
      draftShaped: false,
    });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }

    // Disclosure: still on the ORIGINAL decision, choice offered.
    expect(outcome.response.assistant_text).toContain('Still working on');
    expect(outcome.response.assistant_text).toContain('German market');
    expect(outcome.response.assistant_text.toLowerCase()).toContain('start over');
    // The misleading plain ack is exactly what must NOT appear here.
    expect(outcome.response.assistant_text).not.toContain(
      'Thanks — I have folded that in',
    );
    // The choice is tappable: a start-over chip rides beside the escape hatch.
    const actions = (outcome.response.suggested_actions ?? []) as ReadonlyArray<{
      id?: string;
      label?: string;
    }>;
    expect(actions.some((a) => /start over/i.test(a.label ?? ''))).toBe(true);

    // KEEP THE FOLD (ratified): the persisted round still incorporates B.
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    expect((round!.action as { brief: string }).brief).toContain('German market');
    expect((round!.action as { brief: string }).brief).toContain('CRM');
  });

  // ── THE CONTROL (green before AND after the fix) ─────────────────────────
  it('CONTROL — an ordinary (non-post-Stop) fold keeps the plain ack and carries NO disclosure', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...SEEDED_ROUND)];
    clarifyV2Harness.latestScenarioTurnStopped = false;

    const { outcome } = await runClarifyV2Turn({
      message: NEW_BRIEF,
      draftShaped: false,
    });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).toContain(
      'Thanks — I have folded that in',
    );
    expect(outcome.response.assistant_text).not.toContain('Still working on');
    const actions = (outcome.response.suggested_actions ?? []) as ReadonlyArray<{
      label?: string;
    }>;
    expect(actions.some((a) => /start over/i.test(a.label ?? ''))).toBe(false);
  });

  // ── SCOPE CONTROL — a REPLACEMENT is not a fold, even post-Stop ──────────
  it('post-Stop + standalone restatement: the frame REPLACES and carries NO disclosure (it would be false)', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...SEEDED_ROUND)];
    clarifyV2Harness.latestScenarioTurnStopped = true;

    // Clears the A2 replacement bar: draft-shaped, >= 60 chars, no
    // meta-reference — the one destructive move, and it really switches frame.
    const restatement =
      'Should we relocate the London office to Manchester before the lease renews next spring?';
    const { outcome, appends } = await runClarifyV2Turn({ message: restatement });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).not.toContain('Still working on');
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    // The frame switched wholesale — and the choice is NOT armed.
    expect((round!.action as { brief: string }).brief).toBe(restatement);
    expect(
      (round!.action as { start_over_brief?: string }).start_over_brief,
    ).toBeUndefined();
  });

  // ── BEST-EFFORT — a throwing tombstone read must cost only the copy ──────
  it('post-Stop read THROWS: the turn still folds and commits with the ordinary copy', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...SEEDED_ROUND)];
    clarifyV2Harness.postStopReadError = new Error('fence table unreachable');

    const { outcome, appends } = await runClarifyV2Turn({
      message: NEW_BRIEF,
      draftShaped: false,
    });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).toContain(
      'Thanks — I have folded that in',
    );
    expect(outcome.response.assistant_text).not.toContain('Still working on');
    expect(appends).toHaveLength(1);
  });
});

describe('2.171 — "start over" routes to the existing new-draft path', () => {
  beforeEach(async () => {
    await resetClarifyV2Harness();
  });
  afterAll(async () => {
    const telemetry = await import('../../src/utils/telemetry.js');
    telemetry.setTestSink(null);
  });

  const FOLDED_BRIEF = `${ORIGINAL_BRIEF} ${NEW_BRIEF}`;
  const armedRound = () =>
    seedClarifyPending(FOLDED_BRIEF, ['goal', 'options', 'timeframe'], 2, {
      startOverBrief: NEW_BRIEF,
    });

  it('typed "start over" on the armed round: round 1 re-runs over the NEW brief (old frame discarded)', async () => {
    clarifyV2Harness.seededPendings = [armedRound()];
    const { outcome, appends } = await runClarifyV2Turn({ message: 'Start over' });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    // Round-1 lead over the new topic — not a follow-up on the old frame.
    expect(outcome.response.assistant_text).toContain('Before I draft the model');
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    const action = round!.action as { brief: string; round: number; start_over_brief?: string };
    expect(action.brief).toBe(NEW_BRIEF);
    expect(action.round).toBe(1);
    expect(action.start_over_brief).toBeUndefined();
  });

  it('the start-over CHIP message routes exactly like the typed phrase (constant inside the pattern — the A10 pin)', async () => {
    const { CLARIFY_V2_START_OVER_MESSAGE, CLARIFY_V2_START_OVER_PATTERN } =
      await import('../../src/orchestrator-v5/clarify-v2/preflight.js');
    expect(CLARIFY_V2_START_OVER_PATTERN.test(CLARIFY_V2_START_OVER_MESSAGE)).toBe(true);

    clarifyV2Harness.seededPendings = [armedRound()];
    const { outcome, appends } = await runClarifyV2Turn({
      message: CLARIFY_V2_START_OVER_MESSAGE,
    });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    const round = roundPendingOf(appends);
    expect((round!.action as { brief: string }).brief).toBe(NEW_BRIEF);
  });

  it('UNARMED control: "start over" in an ordinary round stays an ordinary answer (no round-1 reset)', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...SEEDED_ROUND)];
    const { outcome, appends } = await runClarifyV2Turn({ message: 'Start over' });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    // Folded as an answer into the ORIGINAL frame — the pre-2.171 behaviour,
    // deliberately untouched outside the armed state.
    const action = round!.action as { brief: string; round: number };
    expect(action.brief).toContain('German market');
    expect(action.brief).toContain('Start over');
    expect(action.round).toBe(2);
  });

  it('"fold it in" on the armed round: bare-ack calibration (re-offer), words never pollute the brief, choice stays armed', async () => {
    clarifyV2Harness.seededPendings = [armedRound()];
    const { outcome, appends } = await runClarifyV2Turn({ message: 'Fold it in' });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).toContain('draft with sensible defaults');
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    const action = round!.action as {
      brief: string;
      reoffered?: boolean;
      start_over_brief?: string;
    };
    expect(action.brief).toBe(FOLDED_BRIEF); // untouched — no pollution
    expect(action.reoffered).toBe(true);
    expect(action.start_over_brief).toBe(NEW_BRIEF); // still armed
  });
});

describe('2.171 — renderDecisionTopic (pure)', () => {
  it('short briefs pass through; long ones cut at a word boundary with an ellipsis', async () => {
    const { renderDecisionTopic, CLARIFY_V2_TOPIC_MAX_LENGTH } = await import(
      '../../src/orchestrator-v5/clarify-v2/preflight.js'
    );
    expect(renderDecisionTopic(ORIGINAL_BRIEF)).toBe(ORIGINAL_BRIEF);
    const long =
      'We are trying to decide whether to migrate the entire data platform to a new vendor while keeping the analytics team fully staffed through the transition period and beyond';
    const topic = renderDecisionTopic(long);
    expect(topic.length).toBeLessThanOrEqual(CLARIFY_V2_TOPIC_MAX_LENGTH + 1);
    expect(topic.endsWith('…')).toBe(true);
    expect(topic).not.toMatch(/\s…$/); // word-boundary cut, no trailing space
  });
});
