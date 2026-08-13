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

  // ── ADJUDICATION FLIP (30 Jul live probe) — post-Stop, a standalone
  // restatement that still has something to ask FOLDS AND DISCLOSES.
  //
  // This test previously pinned the opposite ("the frame REPLACES and
  // carries NO disclosure (it would be false)"). The live acceptance probe
  // (liveproof-post-stop-disclosure.md, Arm 2/3, 100% deterministic)
  // falsified that premise at the copy: the replace-arm ask emitted the
  // EXACT confound copy ("Thanks — I have folded that in") — a false
  // statement about a replacement — with no disclosure and no choice, in
  // precisely the state 2.171 exists to fix. And which arm a new brief
  // landed on was textual noise: "Completely different question: …" folded
  // (the word "question" trips the meta-reference guard) while "Different
  // topic: …" replaced. Post-Stop, the destructive silent replacement now
  // takes the user's explicit consent — which is exactly what the
  // disclosure choice provides ("start over" = the consented replacement).
  it('post-Stop + standalone restatement with something left to ask: FOLDS and DISCLOSES (the silent replace is gone)', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...SEEDED_ROUND)];
    clarifyV2Harness.latestScenarioTurnStopped = true;

    // Clears the A2 replacement bar: draft-shaped, >= 60 chars, no
    // meta-reference. Pre-fix this silently replaced the working brief.
    const restatement =
      'Should we relocate the London office to Manchester before the lease renews next spring?';
    const { outcome, appends } = await runClarifyV2Turn({ message: restatement });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).toContain('Still working on');
    expect(outcome.response.assistant_text).toContain('German market');
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    // KEPT AS A FOLD — the original frame survives until the user chooses —
    // and the choice is armed with the restatement verbatim.
    expect((round!.action as { brief: string }).brief).toContain('German market');
    expect((round!.action as { brief: string }).brief).toContain('London office');
    expect(
      (round!.action as { start_over_brief?: string }).start_over_brief,
    ).toBe(restatement);
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

/**
 * 30 Jul live-probe fix — branch-derived disclosure.
 *
 * The acceptance probe (liveproof-post-stop-disclosure.md) proved the miss
 * at the bytes: the probe's brief B "Different topic: …" cleared the A2
 * replacement bar, so the resume REPLACED the working brief — and the
 * composer still emitted the fold ack ("Thanks — I have folded that in"),
 * a false statement, with the disclosure suppressed. Two authorities: the
 * branch decided REPLACE, the copy claimed FOLD. The fix collapses them:
 * the ask copy and the disclosure both DERIVE from the one fold-vs-replace
 * branch, and post-Stop the silent replacement is disabled (destructive
 * move; consent comes from the disclosure choice). Replacement survives
 * post-Stop in exactly one shape: an immediate draft of the NEW brief
 * (nothing left to ask), where the streaming new-topic draft is itself the
 * visible proof the stop took.
 */
describe('2.171 live-probe fix — branch-derived disclosure (30 Jul)', () => {
  /** The probe's EXACT miss string (Arm 2/2b/3-meal/3-swap2, 0/4 disclosed). */
  const PROBE_MISS_BRIEF =
    "Different topic: we need to pick a cloud data warehouse - Snowflake versus BigQuery. Criteria: query cost at our scale, our data engineers' familiarity, and integration with dbt.";
  /** The stopped decision the probe's miss scenarios were working on. */
  const MEAL_KIT_BRIEF =
    'We are deciding whether to launch a premium subscription tier for our meal-kit delivery business.';
  const MEAL_ROUND: readonly [string, readonly string[], number] = [
    MEAL_KIT_BRIEF,
    ['goal', 'options', 'timeframe'],
    1,
  ];

  beforeEach(async () => {
    await resetClarifyV2Harness();
  });
  afterAll(async () => {
    const telemetry = await import('../../src/utils/telemetry.js');
    telemetry.setTestSink(null);
  });

  // ── THE PROBE PIN (proven RED at a1fb06bd — the live miss, verbatim) ─────
  it('the probe miss string, post-Stop: DISCLOSES with the choice armed (was the confound copy live)', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...MEAL_ROUND)];
    clarifyV2Harness.latestScenarioTurnStopped = true;

    const { outcome, appends, events } = await runClarifyV2Turn({
      message: PROBE_MISS_BRIEF,
    });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    // The disclosure, naming the ORIGINAL (stopped) decision.
    expect(outcome.response.assistant_text).toContain('Still working on');
    expect(outcome.response.assistant_text).toContain('meal-kit');
    // The live confound copy must be gone.
    expect(outcome.response.assistant_text).not.toContain(
      'Thanks — I have folded that in',
    );
    const actions = (outcome.response.suggested_actions ?? []) as ReadonlyArray<{
      label?: string;
    }>;
    expect(actions.some((a) => /start over/i.test(a.label ?? ''))).toBe(true);
    // Fold kept, choice armed with the new brief verbatim.
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    expect((round!.action as { brief: string }).brief).toContain('meal-kit');
    expect((round!.action as { brief: string }).brief).toContain('data warehouse');
    expect(
      (round!.action as { start_over_brief?: string }).start_over_brief,
    ).toBe(PROBE_MISS_BRIEF);
    // Telemetry now reports the disclosure honestly.
    const asked = events.find(
      (e) => (e.data as { post_stop_disclosed?: boolean }).post_stop_disclosed !== undefined,
    );
    expect(asked).toBeDefined();
    expect((asked!.data as { post_stop_disclosed?: boolean }).post_stop_disclosed).toBe(true);
  });

  // ── SCOPE CONTROL — the ordinary (non-post-Stop) replacement is untouched ─
  it('the same string WITHOUT a Stop: the A2 replacement runs exactly as ratified — no disclosure, frame switched', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...MEAL_ROUND)];
    clarifyV2Harness.latestScenarioTurnStopped = false;

    const { outcome, appends } = await runClarifyV2Turn({ message: PROBE_MISS_BRIEF });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).not.toContain('Still working on');
    const actions = (outcome.response.suggested_actions ?? []) as ReadonlyArray<{
      label?: string;
    }>;
    expect(actions.some((a) => /start over/i.test(a.label ?? ''))).toBe(false);
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    // The frame switched wholesale — the ratified A2 destructive move.
    expect((round!.action as { brief: string }).brief).toBe(PROBE_MISS_BRIEF);
    expect(
      (round!.action as { start_over_brief?: string }).start_over_brief,
    ).toBeUndefined();
  });

  // ── HONEST COPY — the replace-arm ask stops claiming a fold ──────────────
  // The composer was the second authority: on the replace arm it said
  // "Thanks — I have folded that in", which is false (nothing was folded;
  // the brief was replaced). The copy now derives from the branch.
  it('an ordinary replacement ask says the frame switched — never "folded that in"', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...MEAL_ROUND)];
    clarifyV2Harness.latestScenarioTurnStopped = false;

    const { outcome } = await runClarifyV2Turn({ message: PROBE_MISS_BRIEF });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).not.toContain(
      'Thanks — I have folded that in',
    );
    expect(outcome.response.assistant_text).toContain('switched to your new decision');
  });

  // ── REPLACEMENT SURVIVOR — nothing left to ask → draft the NEW brief ─────
  // With every dimension already asked the fold has no carrier for the
  // disclosure, so the standalone restatement gets what it asked for: an
  // immediate draft of the NEW brief alone (never a merged-topic draft) —
  // the streaming new-topic draft is the visible proof the stop took.
  it('post-Stop + standalone restatement with nothing askable: proceeds with the NEW brief alone', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(MEAL_KIT_BRIEF, ['goal', 'options', 'quantities', 'timeframe'], 1),
    ];
    clarifyV2Harness.latestScenarioTurnStopped = true;

    const { outcome } = await runClarifyV2Turn({ message: PROBE_MISS_BRIEF });
    if (outcome === null || outcome.kind !== 'draft') {
      throw new Error(`expected draft, got ${outcome?.kind}`);
    }
    expect(outcome.briefOverride).toBe(PROBE_MISS_BRIEF);
  });

  // ── THE PROBE HIT stays a hit — the fold path is byte-identical ──────────
  it('the probe HIT string (meta-word trips the restatement bar) still folds and discloses', async () => {
    clarifyV2Harness.seededPendings = [seedClarifyPending(...MEAL_ROUND)];
    clarifyV2Harness.latestScenarioTurnStopped = true;

    const PROBE_HIT_BRIEF =
      'Completely different question: we must choose a database vendor for our new platform - managed PostgreSQL on RDS versus CockroachDB serverless. Criteria: query latency, migration cost from our current MySQL, and multi-region failover.';
    const { outcome, appends } = await runClarifyV2Turn({ message: PROBE_HIT_BRIEF });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).toContain('Still working on');
    const round = roundPendingOf(appends);
    expect(round).toBeDefined();
    expect(
      (round!.action as { start_over_brief?: string }).start_over_brief,
    ).toBe(PROBE_HIT_BRIEF);
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
    expect(outcome.response.assistant_text).toContain('shall I draft the model now');
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
