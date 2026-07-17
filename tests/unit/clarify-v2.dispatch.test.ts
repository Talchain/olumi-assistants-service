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
