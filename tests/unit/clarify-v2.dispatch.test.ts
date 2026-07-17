/**
 * Clarify v2 — dispatch-level behavioural pins (ROADMAP 1.152).
 *
 * Drives the REAL `tryClarifyV2Turn` + REAL `commitDirectAnswer` through
 * the shared harness (tests/utils/clarify-v2-dispatch-harness.ts) with a
 * controllable session store. Two jobs:
 *
 *   1. Pin the #497 mechanical fixes BEHAVIOURALLY (A6 hold-wipe guard ·
 *      A7 commit-final-response-on-the-wire · A8 telemetry-after-commit)
 *      — #497 merged them code-read-only and disclosed these pins as
 *      this lane's work. Each pin is mutation-checked: reverting the
 *      fix hunk turns the pin RED (evidence in the 1.152 PR body).
 *      (A5, the route gate, is pinned in route-v2-clarify-v2.test.ts —
 *      it lives in route wiring, not in this dispatcher.)
 *
 *   2. Pin the 1.152 design fixes (A1 decline/not-an-answer · A2
 *      replacement bar · A3 explicit-generate merge · A4 bare-ack ·
 *      A9 brief_text-at-terminal) — written RED-first against the #497
 *      baseline.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

import type { PendingAction } from '../../src/orchestrator-v5/session/pending-action.js';
import { TelemetryEvents } from '../../src/utils/telemetry.js';

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
  seedProposedConceptHold,
} from '../utils/clarify-v2-dispatch-harness.js';

/** Thin but draft-shaped (route heuristic): asks questions at round 1. */
const THIN_BRIEF = 'Should we expand into the German market?';
/** Answers goal + options + timeframe; quantities still open → round 2. */
const PARTIAL_ANSWER =
  'The goal is to increase revenue; the alternative is doing nothing; it plays out within this year.';

const QUESTIONS_EMITTED = TelemetryEvents.V5ClarifyV2QuestionsEmitted;

function eventNames(events: readonly { name: string }[]): string[] {
  return events.map((e) => e.name);
}

describe('clarify v2 dispatch — #497 mechanical-fix behavioural pins', () => {
  beforeEach(async () => {
    await resetClarifyV2Harness();
  });
  afterAll(async () => {
    const telemetry = await import('../../src/utils/telemetry.js');
    telemetry.setTestSink(null);
  });

  // ── A6 — store-throw on the pendings read: turn NOT claimed ─────────────
  it('A6: pendings-read failure → not claimed (null), NOTHING committed, live holds untouched', async () => {
    clarifyV2Harness.pendingsReadError = new Error('store down');
    const { outcome, appends, events } = await runClarifyV2Turn({
      message: THIN_BRIEF,
    });
    // Not claimed: the route proceeds exactly as with the flag off.
    expect(outcome).toBeNull();
    // The hold-wipe guard's actual claim: NO commit ran, so no carry-forward
    // could run over a fabricated-empty prior set — live holds untouched.
    expect(appends).toHaveLength(0);
    expect(eventNames(events)).not.toContain(QUESTIONS_EMITTED);
  });

  it('A6 adjunct: persisted-state read failure on RESUME → not claimed, nothing committed', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    clarifyV2Harness.persistedStateReadError = new Error('store down');
    const { outcome, appends } = await runClarifyV2Turn({ message: PARTIAL_ANSWER });
    expect(outcome).toBeNull();
    expect(appends).toHaveLength(0);
  });

  // ── A7 — the commit chokepoint's FINAL response is what goes on the wire ─
  it('A7 round 1: an F-HELD lapse notice appended AT COMMIT is present on the wire response', async () => {
    // A confirmation-expecting hold with turn-TTL 1 lapses at THIS commit's
    // carry-forward; the chokepoint appends the honest lapse notice to the
    // response it persists. The wire must carry that FINAL response.
    clarifyV2Harness.seededPendings = [
      seedProposedConceptHold({ expires_at_turn_count: 1 }),
    ];
    const { outcome, appends } = await runClarifyV2Turn({ message: THIN_BRIEF });
    expect(outcome).not.toBeNull();
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).toContain(
      "The held change 'Add churn risk' has lapsed",
    );
    // Store and wire agree: the persisted content carries the same notice.
    expect(appends).toHaveLength(1);
    expect(JSON.stringify(appends[0])).toContain('has lapsed');
  });

  it('A7 resume: the follow-up ask also carries a commit-time lapse notice on the wire', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
      seedProposedConceptHold({ expires_at_turn_count: 1 }),
    ];
    const { outcome } = await runClarifyV2Turn({ message: PARTIAL_ANSWER });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    // Round-2 ask (quantities) + the lapse notice appended at commit.
    expect(outcome.response.assistant_text).toContain('?');
    expect(outcome.response.assistant_text).toContain(
      "The held change 'Add churn risk' has lapsed",
    );
  });

  it('A7 survival control: a hold with turn-TTL headroom survives the clarify commit un-lapsed', async () => {
    clarifyV2Harness.seededPendings = [
      seedProposedConceptHold({ expires_at_turn_count: 3 }),
    ];
    const { outcome, appends } = await runClarifyV2Turn({ message: THIN_BRIEF });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).not.toContain('has lapsed');
    const pendings = (appends[0]!.pending_actions ?? []) as PendingAction[];
    expect(pendings.map((p) => p.action.kind)).toContain('proposed_concept');
    expect(pendings.map((p) => p.action.kind)).toContain('clarify_v2_round');
  });

  // ── A8 — questions-emitted telemetry fires only AFTER a successful commit ─
  it('A8 positive control: a SUCCESSFUL round-1 ask commit emits questions_emitted (the sink can see it)', async () => {
    const { outcome, events } = await runClarifyV2Turn({ message: THIN_BRIEF });
    expect(outcome?.kind).toBe('respond');
    expect(eventNames(events)).toContain(QUESTIONS_EMITTED);
  });

  it('A8 round 1: a FAILED commit emits NO questions_emitted (silent draft, honest telemetry)', async () => {
    clarifyV2Harness.commitError = new Error('append failed');
    const { outcome, events } = await runClarifyV2Turn({ message: THIN_BRIEF });
    // Round-1 commit failure degrades to not-engaged (silent draft).
    expect(outcome).toBeNull();
    expect(eventNames(events)).not.toContain(QUESTIONS_EMITTED);
  });

  it('A8 resume: a FAILED commit degrades to proceed-with-what-we-have and emits NO questions_emitted', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    clarifyV2Harness.commitError = new Error('append failed');
    const { outcome, events } = await runClarifyV2Turn({ message: PARTIAL_ANSWER });
    // The reply was an answer to OUR question — stranding it via generic
    // routing would lose it; the dispatcher drafts with the working brief.
    if (outcome === null || outcome.kind !== 'draft') {
      throw new Error(`expected draft, got ${outcome?.kind}`);
    }
    expect(outcome.briefOverride).toContain(THIN_BRIEF);
    expect(outcome.briefOverride).toContain('increase revenue');
    expect(eventNames(events)).not.toContain(QUESTIONS_EMITTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ROADMAP 1.152 — design-fix dispatch pins (A1 / A4 / A9 end-to-end).
// Decision-core semantics are pinned RED-first in clarify-v2.preflight
// .test.ts; these pin the I/O half: what commits, what releases, what
// seeds brief_text, what telemetry fires, and what the wire carries.
// ─────────────────────────────────────────────────────────────────────────

const DEFLECTED = TelemetryEvents.V5ClarifyV2Deflected;

describe('clarify v2 dispatch — 1.152 design fixes (A1 / A4 / A9)', () => {
  beforeEach(async () => {
    await resetClarifyV2Harness();
  });

  it("A1 decline: 'not now' releases the round (pending retired, holds carried, brief seeded) with the honest reply", async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
      seedProposedConceptHold({ expires_at_turn_count: 3 }),
    ];
    const { outcome, appends, events } = await runClarifyV2Turn({ message: 'not now' });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).toContain("I'll hold off");
    expect(outcome.response.assistant_text).toContain("Say 'draft it'");
    // Released, not superseded: NO clarify round survives the commit…
    expect(appends).toHaveLength(1);
    const pendings = (appends[0]!.pending_actions ?? []) as PendingAction[];
    expect(pendings.map((p) => p.action.kind)).not.toContain('clarify_v2_round');
    // …while the unrelated hold is carried, not wiped.
    expect(pendings.map((p) => p.action.kind)).toContain('proposed_concept');
    // A9 terminal seed: the working brief is preserved for a later resume.
    expect(appends[0]!.briefText).toBe(THIN_BRIEF);
    // Telemetry: one deflection (release/decline), after the commit.
    const deflections = events.filter((e) => e.name === DEFLECTED);
    expect(deflections).toHaveLength(1);
    expect(deflections[0]!.data).toMatchObject({ action: 'release', cue: 'decline' });
  });

  it('A1 decline commit-fail: not claimed (null), no deflection telemetry', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    clarifyV2Harness.commitError = new Error('append failed');
    const { outcome, events } = await runClarifyV2Turn({ message: 'not now' });
    expect(outcome).toBeNull();
    expect(eventNames(events)).not.toContain(DEFLECTED);
  });

  it('1.152(i) FIX 3: REOFFER commit-fail: not claimed (null), no deflection telemetry (dedicated pin — the decline arm had one, this arm did not)', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    clarifyV2Harness.commitError = new Error('append failed');
    const { outcome, events } = await runClarifyV2Turn({ message: 'ok' });
    // Reoffer commit failure → null: normal routing answers the ack; the
    // prior pending was NOT consumed, so the round stays live for TTL.
    expect(outcome).toBeNull();
    expect(eventNames(events)).not.toContain(DEFLECTED);
  });

  it("1.152(i) P3 end-to-end: 'not sure — maybe just draft it?' re-offers the direct yes/no with cue hedged_proceed (brief untouched)", async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    const { outcome, appends, events } = await runClarifyV2Turn({
      message: 'not sure — maybe just draft it?',
    });
    if (outcome === null || outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${outcome?.kind}`);
    }
    expect(outcome.response.assistant_text).toContain('shall I draft with sensible defaults');
    const pendings = (appends[0]!.pending_actions ?? []) as PendingAction[];
    const roundPending = pendings.find((p) => p.action.kind === 'clarify_v2_round');
    expect(roundPending).toBeDefined();
    if (roundPending!.action.kind !== 'clarify_v2_round') throw new Error('narrow');
    expect(roundPending!.action.brief).toBe(THIN_BRIEF); // never folded
    expect(roundPending!.action.reoffered).toBe(true);
    const deflections = events.filter((e) => e.name === DEFLECTED);
    expect(deflections).toHaveLength(1);
    expect(deflections[0]!.data).toMatchObject({ action: 'reoffer', cue: 'hedged_proceed' });
  });

  it('A1 not-an-answer: a question back to us re-offers ONCE (brief untouched, reoffer marked), then declines', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    const first = await runClarifyV2Turn({ message: 'What do you mean by timeframe?' });
    if (first.outcome === null || first.outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${first.outcome?.kind}`);
    }
    expect(first.outcome.response.assistant_text).toContain('optional');
    const pendings = (first.appends[0]!.pending_actions ?? []) as PendingAction[];
    const roundPending = pendings.find((p) => p.action.kind === 'clarify_v2_round');
    expect(roundPending).toBeDefined();
    if (roundPending!.action.kind !== 'clarify_v2_round') throw new Error('narrow');
    // The question was NOT folded into the brief; round/asked untouched.
    expect(roundPending!.action.brief).toBe(THIN_BRIEF);
    expect(roundPending!.action.round).toBe(1);
    expect(roundPending!.action.reoffered).toBe(true);
    expect(first.appends[0]!.briefText).toBeUndefined(); // A9: ask-class commit
    const deflections = first.events.filter((e) => e.name === DEFLECTED);
    expect(deflections[0]!.data).toMatchObject({ action: 'reoffer', cue: 'question_reply' });

    // Second deflection in the same round → decline (re-offer once per round).
    await resetClarifyV2Harness();
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1, { reoffered: true }),
    ];
    const second = await runClarifyV2Turn({ message: 'Why do you need to know?' });
    if (second.outcome === null || second.outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${second.outcome?.kind}`);
    }
    expect(second.outcome.response.assistant_text).toContain("I'll hold off");
    const secondPendings = (second.appends[0]!.pending_actions ?? []) as PendingAction[];
    expect(secondPendings.map((p) => p.action.kind)).not.toContain('clarify_v2_round');
  });

  it("A4 bare-ack: 'ok' with questions pending re-offers the default-forward choice; 'ok' after the re-offer proceeds", async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    const first = await runClarifyV2Turn({ message: 'ok' });
    if (first.outcome === null || first.outcome.kind !== 'respond') {
      throw new Error(`expected respond, got ${first.outcome?.kind}`);
    }
    expect(first.outcome.response.assistant_text).toContain('sensible defaults');
    const chipIds = (
      (first.outcome.response.suggested_actions ?? []) as Array<{ id: string }>
    ).map((c) => c.id);
    expect(chipIds).toContain('cv2_proceed_default');
    const deflections = first.events.filter((e) => e.name === DEFLECTED);
    expect(deflections[0]!.data).toMatchObject({ action: 'reoffer', cue: 'bare_ack' });

    // After the re-offer (a direct yes/no), the same ack IS consent.
    await resetClarifyV2Harness();
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1, { reoffered: true }),
    ];
    const second = await runClarifyV2Turn({ message: 'ok' });
    if (second.outcome === null || second.outcome.kind !== 'draft') {
      throw new Error(`expected draft, got ${second.outcome?.kind}`);
    }
    expect(second.outcome.briefOverride).toBe(THIN_BRIEF);
  });

  it('A9: ask-class commits (round 1 AND resume follow-up) seed NO brief_text — the write-once column stays free for the terminal brief', async () => {
    // Round 1 ask.
    const round1 = await runClarifyV2Turn({ message: THIN_BRIEF });
    expect(round1.outcome?.kind).toBe('respond');
    expect(round1.appends[0]!.briefText).toBeUndefined();

    // Resume follow-up ask.
    await resetClarifyV2Harness();
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    const resume = await runClarifyV2Turn({ message: PARTIAL_ANSWER });
    expect(resume.outcome?.kind).toBe('respond');
    expect(resume.appends[0]!.briefText).toBeUndefined();
  });

  it('A9 proceed control: the completing answer proceeds as a draft with the FINAL brief as briefOverride (the draft commit seeds it)', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    const answer =
      'The goal is to increase revenue; the alternative is doing nothing; the stakes are around £200,000; it plays out within this year.';
    const { outcome } = await runClarifyV2Turn({ message: answer });
    if (outcome === null || outcome.kind !== 'draft') {
      throw new Error(`expected draft, got ${outcome?.kind}`);
    }
    // dispatchDraftGraph commits briefText from effectiveBrief =
    // briefOverride (draft-graph-dispatch.ts) — the FINAL answered brief.
    expect(outcome.briefOverride).toContain(THIN_BRIEF);
    expect(outcome.briefOverride).toContain('£200,000');
  });

  it('A3 dispatch: an explicit-generate resume threads the ASSEMBLED brief into the merge (not discarded)', async () => {
    clarifyV2Harness.seededPendings = [
      seedClarifyPending(THIN_BRIEF, ['goal', 'options', 'timeframe'], 1),
    ];
    const extra = 'Our runway is about £500,000 and hiring freezes start next quarter.';
    const { outcome } = await runClarifyV2Turn({
      message: 'Yes, build the model now please',
      explicitGenerateBrief: extra,
    });
    if (outcome === null || outcome.kind !== 'draft') {
      throw new Error(`expected draft, got ${outcome?.kind}`);
    }
    expect(outcome.briefOverride).toContain(THIN_BRIEF);
    expect(outcome.briefOverride).toContain('£500,000');
  });
});
