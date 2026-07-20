/**
 * Clarify v2 — eval FLOORS over the brief fixture pack (E0-B, ROADMAP 1.94
 * Option A replacement; spec §E4).
 *
 * Pass/fail floors, promotion-gating — a candidate (deterministic today,
 * the PMS haiku-class prompt later) must keep every floor green:
 *
 *   1. FIRES-AT-ALL: every 'clarify' fixture produces ≥1 question. The
 *      retired Stage-4 clarifier's live baseline was 0 questions on 100%
 *      of firings (≥7 days of staging logs, positive-control-verified) —
 *      this floor is RED against that baseline by construction, and RED
 *      on the pre-E0-B tree (the production modules it imports do not
 *      exist there).
 *   2. COMPLETE-BRIEF SILENCE: every 'silent' fixture produces 0 questions.
 *   3. CONTRACT PARSE 100%: every emitted clarify response parses the
 *      strict OlumiResponseSchema.
 *   4. NO DEAD ENDS: every emitted question carries 2–5 tap-able candidate
 *      answers, a model-impact clause, and is not in the banned
 *      bare-detail class; every response carries the default-forward chip.
 *   5. NO REPEATS: the scripted multi-round resumes never re-ask an
 *      already-asked dimension, and the stop rule always terminates in a
 *      proceed.
 *
 * House rule (scorer/score-run.ts): floors import the PRODUCTION modules
 * from src/ — never copies. New file; touches nothing owned by the
 * figure-scanner / property-fuzz lane (#461 round 7).
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import {
  decideClarifyV2Round1,
  decideClarifyV2Resume,
  composeClarifyV2Response,
  CLARIFY_V2_PROCEED_CHIP_ID,
  type ClarifyV2Decision,
  type ClarifyV2RoundState,
} from '../../../src/orchestrator-v5/clarify-v2/preflight.js';
import {
  validateQuestionShape,
  isBannedBareDetailRequest,
  CLARIFY_V2_MIN_CANDIDATES,
  CLARIFY_V2_MAX_CANDIDATES,
} from '../../../src/orchestrator-v5/clarify-v2/questions.js';

interface BriefFixture {
  readonly id: string;
  readonly brief: string;
  readonly expected: 'clarify' | 'silent';
  readonly note: string;
}
interface ResumeScript {
  readonly id: string;
  readonly brief: string;
  readonly turns: ReadonlyArray<{
    readonly message: string;
    readonly expect: 'ask_only_never_asked_dimensions' | 'proceed';
  }>;
  readonly note: string;
}

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'clarify-v2-briefs.json',
);
const pack = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  briefs: readonly BriefFixture[];
  resume_scripts: readonly ResumeScript[];
};

const clarifyFixtures = pack.briefs.filter((b) => b.expected === 'clarify');
const silentFixtures = pack.briefs.filter((b) => b.expected === 'silent');

describe('clarify_v2 floors — fixture pack sanity', () => {
  it('covers both classes with a meaningful pack (~20 briefs)', () => {
    expect(pack.briefs.length).toBeGreaterThanOrEqual(18);
    expect(clarifyFixtures.length).toBeGreaterThanOrEqual(10);
    expect(silentFixtures.length).toBeGreaterThanOrEqual(5);
    expect(pack.resume_scripts.length).toBeGreaterThanOrEqual(3);
  });
});

describe('FLOOR 1 — fires-at-all (RED against the never-asks baseline)', () => {
  it.each(clarifyFixtures.map((f) => [f.id, f] as const))('%s asks ≥1 question', (_id, f) => {
    const d = decideClarifyV2Round1(f.brief);
    expect(d.kind, f.note).toBe('ask');
    if (d.kind !== 'ask') return;
    expect(d.questions.length).toBeGreaterThanOrEqual(1);
  });

  it('aggregate ask-rate on thin briefs is 100% (baseline was 0%)', () => {
    const fired = clarifyFixtures.filter((f) => decideClarifyV2Round1(f.brief).kind === 'ask');
    expect(fired.length).toBe(clarifyFixtures.length);
  });
});

describe('FLOOR 2 — complete-brief silence (no busywork)', () => {
  it.each(silentFixtures.map((f) => [f.id, f] as const))('%s proceeds with 0 questions', (_id, f) => {
    const d = decideClarifyV2Round1(f.brief);
    expect(d, f.note).toEqual({ kind: 'proceed', brief: f.brief, reason: 'complete' });
  });
});

describe('FLOOR 3 + 4 — contract parse 100% and no dead-end questions', () => {
  it.each(clarifyFixtures.map((f) => [f.id, f] as const))(
    '%s: response parses the wire schema; every question opens a path',
    (_id, f) => {
      const d = decideClarifyV2Round1(f.brief);
      if (d.kind !== 'ask') throw new Error('floor 1 owns this failure');
      // Floor 4: shape invariants per question.
      for (const q of d.questions) {
        expect(validateQuestionShape(q)).toEqual([]);
        expect(isBannedBareDetailRequest(q.text)).toBe(false);
        expect(q.candidates.length).toBeGreaterThanOrEqual(CLARIFY_V2_MIN_CANDIDATES);
        expect(q.candidates.length).toBeLessThanOrEqual(CLARIFY_V2_MAX_CANDIDATES);
        expect(q.impact.trim().length).toBeGreaterThan(0);
      }
      // Floor 3: the full wire envelope parses strictly.
      const response = composeClarifyV2Response(d.questions, d.phase);
      const parsed = OlumiResponseSchema.safeParse(response);
      expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
      // Floor 4: the default-forward escape is always present.
      expect(response.suggested_actions.map((a) => a.id)).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    },
  );
});

describe('FLOOR 5 — no repeats across rounds + the stop rule terminates', () => {
  it.each(pack.resume_scripts.map((s) => [s.id, s] as const))('%s', (_id, script) => {
    const round1 = decideClarifyV2Round1(script.brief);
    expect(round1.kind).toBe('ask');
    if (round1.kind !== 'ask') return;

    let state: ClarifyV2RoundState = round1.state;
    const everAsked = new Set(round1.questions.map((q) => q.dimension));
    let lastDecision: ClarifyV2Decision = round1;

    for (const turn of script.turns) {
      lastDecision = decideClarifyV2Resume({
        state,
        message: turn.message,
        messageIsDraftShaped: false,
        explicitGenerateBrief: null,
      });
      if (turn.expect === 'proceed') {
        expect(lastDecision.kind, script.note).toBe('proceed');
      } else {
        expect(lastDecision.kind, script.note).toBe('ask');
      }
      if (lastDecision.kind === 'ask') {
        for (const q of lastDecision.questions) {
          expect(
            everAsked.has(q.dimension),
            `${script.id}: dimension '${q.dimension}' re-asked — semantic no-repeat floor violated`,
          ).toBe(false);
          everAsked.add(q.dimension);
        }
        state = lastDecision.state;
      }
    }
    // Every script's final turn is a proceed — the stop rule terminates.
    expect(lastDecision.kind).toBe('proceed');
  });

  it('the stop rule is total: any answer sequence terminates within the round budget', () => {
    // Exhaustive-ish sweep: reply with an unhelpful non-answer every round;
    // the flow must still proceed by round budget, never loop.
    const round1 = decideClarifyV2Round1('Should we expand into the German market?');
    if (round1.kind !== 'ask') throw new Error('must ask');
    let state = round1.state;
    let decision: ClarifyV2Decision = round1;
    for (let i = 0; i < 5; i += 1) {
      decision = decideClarifyV2Resume({
        state,
        message: 'hmm let me think about the weather instead',
        messageIsDraftShaped: false,
        explicitGenerateBrief: null,
      });
      // Break on any terminal decision; the assertion below still pins that
      // THIS sequence ends in 'proceed' (a 'decline' here would be a real
      // behaviour change and must go red, not be absorbed).
      if (decision.kind !== 'ask') break;
      state = decision.state;
    }
    expect(decision.kind).toBe('proceed');
  });
});
