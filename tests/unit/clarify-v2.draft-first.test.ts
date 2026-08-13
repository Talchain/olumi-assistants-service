/**
 * Clarify v2 — DRAFT-FIRST with a disclosed assumption when exactly ONE
 * completeness dimension is missing (Track 1 intake fix, 2026-08-13).
 *
 * Derivation: olumi-docs/PHASE0-EVIDENCE-2026-07-28/draft-reliability-
 * 2026-08-12/INTAKE-FUNNEL.md §5(b). The trigger is a COUNT over the
 * existing detectors (`assessBriefCompleteness(...).missing.length === 1`),
 * deliberately NOT a new natural-language predicate. Briefs missing ≥2
 * dimensions keep the blocking ask unchanged — the thin-brief asks are the
 * rubric doing its job.
 *
 * Honesty invariants pinned here (INTAKE-FUNNEL §5b i):
 *   - the deferred ask's disclosure names the assumption as the
 *     ASSISTANT's, never as user-stated;
 *   - the disclosure binds to the MISSING dimension by identity (a
 *     quantities gap must carry the quantities question, not goal's);
 *   - explicit-generate still proceeds with NO deferred ask (the user
 *     pressed Generate; unchanged behaviour).
 *
 * The 15-brief table is driven by REAL WIRE CAPTURES (tests/fixtures/
 * clarify-v2-wire-briefs-2026-08-12.json — append-only, sha-verified against
 * the deployed-staging baseline runs). The expected column is this change's
 * whole point: 5 of the 13 re-asked briefs draft first-turn.
 *
 * ⚠ THE TABLE MOVED AT REVIEW, AND THE MOVE IS THE POINT (#928, REVIEW-928.md
 * §1). It predicted 7 flips while two of them (S4, M5) rode timeframe arms
 * that an independent corpus measured as FAIL-UNSAFE; those arms were ablated,
 * so S4 and M5 correctly return to the blocking ask. Five flips still clears
 * the ≥5 acceptance target — the capability was never what the defect
 * threatened. **This table is a routing OUTCOME metric (trap 23): it counts
 * briefs that draft, not arms that fire.**
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  decideClarifyV2Round1,
  composeDraftFirstDisclosure,
} from '../../src/orchestrator-v5/clarify-v2/preflight.js';
import { composeClarifyQuestions } from '../../src/orchestrator-v5/clarify-v2/questions.js';
import type { ClarifyDimension } from '../../src/orchestrator-v5/clarify-v2/rubric.js';
import { TelemetryEvents } from '../../src/utils/telemetry.js';
import {
  resetClarifyV2Harness,
  runClarifyV2Turn,
} from '../utils/clarify-v2-dispatch-harness.js';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'clarify-v2-wire-briefs-2026-08-12.json',
);
const wirePack = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  briefs: Record<string, { class: string; brief: string }>;
};
const wireBrief = (id: string): string => {
  const entry = wirePack.briefs[id];
  if (entry === undefined) throw new Error(`wire fixture missing brief ${id}`);
  return entry.brief;
};

/** The provenance marker every disclosure must carry (assistant-authored). */
const PROVENANCE_MARKER = 'not something you told me';

// ── The 15-brief outcome table (the acceptance table, pinned) ──────────────
// 'complete'    → proceed silently, reason 'complete', NO deferred question.
// 'draft_first' → proceed, reason 'single_gap_draft_first', deferred question
//                 for exactly the named dimension.
// 'ask'         → blocking clarify questions (unchanged behaviour).
const EXPECTED_FIRST_TURN: ReadonlyArray<
  readonly [string, 'complete' | 'ask'] | readonly [string, 'draft_first', ClarifyDimension]
> = [
  ['S1', 'ask'],
  ['S2', 'ask'],
  ['S3', 'ask'],
  ['S4', 'ask'], // timeframe arm ABLATED at review (#928) — goal+timeframe missing
  ['S5', 'draft_first', 'goal'],
  ['M1', 'complete'],
  ['M2', 'ask'],
  ['M3', 'complete'], // goal now detected ("…is the main prize")
  ['M4', 'ask'], // options now detected (from-X-to-Y); goal+timeframe still missing
  ['M5', 'ask'], // timeframe arm ABLATED at review (#928) — goal+timeframe missing
  ['L1', 'draft_first', 'goal'],
  ['L2', 'draft_first', 'goal'],
  ['L3', 'draft_first', 'goal'],
  ['L4', 'ask'],
  ['L5', 'complete'],
];

describe('the 15-brief first-turn table (real wire captures)', () => {
  it.each(EXPECTED_FIRST_TURN.map((row) => [row[0], row] as const))(
    '%s',
    (_id, row) => {
      const [id, expected, dimension] = row;
      const decision = decideClarifyV2Round1(wireBrief(id));
      if (expected === 'ask') {
        expect(decision.kind, id).toBe('ask');
        return;
      }
      expect(decision.kind, id).toBe('proceed');
      if (decision.kind !== 'proceed') return;
      if (expected === 'complete') {
        expect(decision.reason, id).toBe('complete');
        expect(decision.deferredQuestion, `${id}: a complete brief must carry NO deferred ask`).toBeUndefined();
      } else {
        expect(decision.reason, id).toBe('single_gap_draft_first');
        expect(decision.deferredQuestion?.dimension, id).toBe(dimension);
      }
    },
  );

  it('acceptance count: at least 5 previously re-asked briefs now draft first-turn', () => {
    const flips = EXPECTED_FIRST_TURN.filter(
      (r) => r[0] !== 'M1' && r[0] !== 'L5' && (r[1] === 'draft_first' || r[1] === 'complete'),
    );
    // EXACT, not a floor-only assertion: a floor alone would stay green if a
    // future widening silently flipped more briefs than were measured, which
    // is the direction that carries invented-value risk. Growth must be a
    // deliberate, re-measured change to this list (S5, M3, L1, L2, L3).
    expect(flips.map((r) => r[0])).toEqual(['S5', 'M3', 'L1', 'L2', 'L3']);
    expect(flips.length).toBeGreaterThanOrEqual(5);
  });
});

// ── Count-predicate pins (the off-by-one mutant target) ───────────────────
describe('the trigger is EXACTLY-ONE missing — never two', () => {
  // Real capture, two missing (goal + quantities): MUST still block.
  it('two missing dimensions keep the blocking ask (S1)', () => {
    const decision = decideClarifyV2Round1(wireBrief('S1'));
    expect(decision.kind).toBe('ask');
  });

  it('two missing dimensions keep the blocking ask (L4)', () => {
    const decision = decideClarifyV2Round1(wireBrief('L4'));
    expect(decision.kind).toBe('ask');
  });

  it('three missing dimensions keep the blocking ask (synthetic control)', () => {
    // Options present via "or"; goal, timeframe, quantities all absent.
    const decision = decideClarifyV2Round1(
      'Should we rebuild the billing platform ourselves or buy a vendor product instead of waiting?',
    );
    expect(decision.kind).toBe('ask');
  });

  it('a single missing dimension proceeds with the deferred question for THAT dimension (quantities)', () => {
    // goal ("The goal is…"), options ("or"), timeframe ("this quarter") all
    // present; quantities absent. Identity-binding pin: the deferred ask must
    // be the QUANTITIES question — a composer hard-wired to goal must go RED.
    const decision = decideClarifyV2Round1(
      'Should we hire a contractor or a permanent engineer this quarter? The goal is to reduce delivery risk.',
    );
    expect(decision.kind).toBe('proceed');
    if (decision.kind !== 'proceed') return;
    expect(decision.reason).toBe('single_gap_draft_first');
    expect(decision.deferredQuestion?.dimension).toBe('quantities');
  });

  it('explicit-generate proceeds with NO deferred question, even on a single-gap brief', () => {
    const decision = decideClarifyV2Round1(wireBrief('S5'), true);
    expect(decision.kind).toBe('proceed');
    if (decision.kind !== 'proceed') return;
    expect(decision.reason).toBe('explicit_generate');
    expect(decision.deferredQuestion).toBeUndefined();
  });

  it('the working brief is preserved (trimmed) as the draft brief', () => {
    const decision = decideClarifyV2Round1(`  ${wireBrief('S5')}  `);
    expect(decision.kind).toBe('proceed');
    if (decision.kind !== 'proceed') return;
    expect(decision.brief).toBe(wireBrief('S5'));
  });
});

// ── Disclosure honesty (INTAKE-FUNNEL §5b constraint i) ────────────────────
describe('composeDraftFirstDisclosure — assistant provenance, dimension identity', () => {
  const questionFor = (dimension: ClarifyDimension) => {
    const [q] = composeClarifyQuestions([dimension], 1);
    if (q === undefined) throw new Error('no question composed');
    return q;
  };

  it.each(['goal', 'options', 'timeframe', 'quantities'] as const)(
    '%s: names the assumption as the assistant’s, never the user’s',
    (dimension) => {
      const text = composeDraftFirstDisclosure(questionFor(dimension));
      expect(text).toContain(PROVENANCE_MARKER);
      expect(text).toMatch(/my assumption/i);
      // The user must never be quoted as the source of the assumed value.
      expect(text).not.toMatch(/\byou (?:said|stated|told me that|asked for)\b/i);
    },
  );

  it.each(['goal', 'options', 'timeframe', 'quantities'] as const)(
    '%s: carries its OWN dimension’s question text (identity binding)',
    (dimension) => {
      const text = composeDraftFirstDisclosure(questionFor(dimension));
      expect(text).toContain(questionFor(dimension).text);
      for (const other of ['goal', 'options', 'timeframe', 'quantities'] as const) {
        if (other === dimension) continue;
        expect(text, `${dimension} disclosure must not carry ${other}'s question`).not.toContain(
          questionFor(other).text,
        );
      }
    },
  );

  it('offers the canvas as the way to change the assumption (a live surface, not a promise of new machinery)', () => {
    const text = composeDraftFirstDisclosure(questionFor('goal'));
    expect(text).toMatch(/canvas/i);
  });
});

// ── Dispatch level: the outcome is a DRAFT instruction, not a commit ──────
describe('tryClarifyV2Turn — single-gap round 1 returns a draft outcome with the deferred ask', () => {
  beforeEach(async () => {
    await resetClarifyV2Harness();
  });
  afterAll(async () => {
    const telemetry = await import('../../src/utils/telemetry.js');
    telemetry.setTestSink(null);
  });

  it('single-gap brief → {kind:"draft"} with briefOverride and a disclosed deferredAsk; NOTHING committed', async () => {
    const { outcome, appends, events } = await runClarifyV2Turn({
      message: wireBrief('S5'),
    });
    expect(outcome).not.toBeNull();
    expect(outcome?.kind).toBe('draft');
    if (outcome?.kind !== 'draft') return;
    expect(outcome.briefOverride).toBe(wireBrief('S5'));
    expect(outcome.deferredAsk?.dimension).toBe('goal');
    expect(outcome.deferredAsk?.disclosure).toContain(PROVENANCE_MARKER);
    // Non-blocking by construction: no clarify turn is committed and no
    // clarify_v2_round pending is persisted — there is nothing to resume.
    expect(appends).toHaveLength(0);
    // Telemetry: the proceed event fires with the new reason.
    const proceeded = events.filter((e) => e.name === TelemetryEvents.V5ClarifyV2Proceeded);
    expect(proceeded).toHaveLength(1);
    expect(proceeded[0]?.data.reason).toBe('single_gap_draft_first');
  });

  it('two-missing brief still gets the blocking ask (dispatch-level off-by-one control)', async () => {
    const { outcome, appends } = await runClarifyV2Turn({
      message: wireBrief('S1'),
    });
    expect(outcome?.kind).toBe('respond');
    expect(appends).toHaveLength(1);
  });

  it('complete brief still proceeds silently — null outcome, no deferred ask anywhere', async () => {
    const { outcome, appends } = await runClarifyV2Turn({
      message: wireBrief('M1'),
    });
    expect(outcome).toBeNull();
    expect(appends).toHaveLength(0);
  });

  it('explicit-generate on a single-gap brief keeps the pristine path (null → route drafts)', async () => {
    const { outcome } = await runClarifyV2Turn({
      message: wireBrief('S5'),
      explicitGenerateBrief: wireBrief('S5'),
    });
    expect(outcome).toBeNull();
  });
});
