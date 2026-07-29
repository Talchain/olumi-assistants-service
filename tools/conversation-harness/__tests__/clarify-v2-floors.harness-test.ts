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
 *   6. NO RE-ASK OF A SUPPLIED FACT (ROADMAP 2.103): across the WHOLE
 *      pre-draft flow, the intake never asks about a dimension the brief
 *      itself supplies. This is the micro eval set the 2.103 fix rides —
 *      golden briefs + a deterministic assertion, run before and after the
 *      change. See `no_reask_cases` in the fixture pack.
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
  CLARIFY_V2_MAX_ROUNDS,
  type ClarifyV2Decision,
  type ClarifyV2RoundState,
} from '../../../src/orchestrator-v5/clarify-v2/preflight.js';
import {
  validateQuestionShape,
  isBannedBareDetailRequest,
  CLARIFY_V2_MIN_CANDIDATES,
  CLARIFY_V2_MAX_CANDIDATES,
} from '../../../src/orchestrator-v5/clarify-v2/questions.js';
import type { ClarifyDimension } from '../../../src/orchestrator-v5/clarify-v2/rubric.js';
import { isDraftShapedText } from '../../../src/schemas/assist.js';

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
/** ROADMAP 2.103 — the no-re-ask micro eval set (FLOOR 6). */
interface NoReaskCase {
  readonly id: string;
  readonly brief: string;
  /**
   * The completeness dimensions a reader can extract from the brief's own
   * words — the golden label, and the ONLY hand-written half of this
   * assertion. It fails LOUD: if the rubric asks about anything listed
   * here the case goes red, and if a widening ever silences the
   * `supplied: []` control the ask-floor below goes red.
   */
  readonly supplied: readonly ClarifyDimension[];
  readonly expect: 'silent' | 'ask_only_unsupplied';
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
  no_reask_cases: readonly NoReaskCase[];
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

describe('FLOOR 6 — the intake never asks for a fact the brief supplied (ROADMAP 2.103)', () => {
  const noReask = pack.no_reask_cases;

  it('the eval set is non-trivial and carries both directions', () => {
    // Pack-integrity floor: a micro eval set that someone has quietly
    // gutted reports green by testing nothing (trap 13 — an absence
    // assertion must first prove it can see a presence). These bounds are
    // the presence proof.
    expect(noReask.length).toBeGreaterThanOrEqual(5);
    expect(noReask.filter((c) => c.expect === 'silent').length).toBeGreaterThanOrEqual(3);
    // At least one FALSE-POSITIVE control: a brief supplying nothing, which
    // must still be asked about. Without it, "never asks about a supplied
    // fact" is satisfiable by never asking anything at all.
    expect(noReask.some((c) => c.supplied.length === 0)).toBe(true);
    // At least one MIDDLE case: some dimensions supplied, some not — the
    // only shape that can catch a widening in BOTH directions at once.
    expect(
      noReask.some((c) => c.supplied.length > 0 && c.expect === 'ask_only_unsupplied'),
    ).toBe(true);
  });

  it.each(noReask.map((c) => [c.id, c] as const))(
    '%s: reachable on the live route (draft-shaped)',
    (_id, c) => {
      // A fixture the route's own heuristic would never send to the draft
      // preflight cannot prove anything about the intake. Without this,
      // a case could pass FLOOR 6 by being unreachable.
      expect(isDraftShapedText(c.brief), c.note).toBe(true);
    },
  );

  it.each(noReask.map((c) => [c.id, c] as const))(
    '%s: no question, in any round, asks about a supplied dimension',
    (_id, c) => {
      const round1 = decideClarifyV2Round1(c.brief);
      if (c.expect === 'silent') {
        expect(round1.kind, c.note).toBe('proceed');
        return;
      }
      expect(round1.kind, c.note).toBe('ask');
      if (round1.kind !== 'ask') return;

      const askedDimensions: ClarifyDimension[] = [...round1.questions.map((q) => q.dimension)];
      let state: ClarifyV2RoundState = round1.state;
      let decision: ClarifyV2Decision = round1;
      // Walk the WHOLE pre-draft flow, not just round 1: the live defect was
      // TWO redundant clarify turns before any draft, so a round-1-only
      // assertion would have seen half of it. The reply is a deliberate
      // non-answer (adds no dimension), so `supplied` is constant across the
      // walk and every later round is judged against the same golden label.
      for (let i = 0; i < CLARIFY_V2_MAX_ROUNDS + 2; i += 1) {
        decision = decideClarifyV2Resume({
          state,
          message: 'hmm, let me have a think about that',
          messageIsDraftShaped: false,
          explicitGenerateBrief: null,
        });
        if (decision.kind !== 'ask') break;
        askedDimensions.push(...decision.questions.map((q) => q.dimension));
        state = decision.state;
      }
      // The stop rule must terminate — an intake that never drafts is the
      // same user-visible failure by another route.
      expect(decision.kind, `${c.id}: the pre-draft flow never terminated`).not.toBe('ask');

      const redundant = askedDimensions.filter((d) => c.supplied.includes(d));
      expect(
        redundant,
        `${c.id}: the intake asked for ${JSON.stringify(redundant)}, which this brief already supplies — ${c.note}`,
      ).toEqual([]);
      // Floor-6 positive control, per case: an 'ask_only_unsupplied' case
      // must actually ASK. A widening that silences the sparse control
      // trades this defect for the never-asks baseline clarify v2 exists
      // to end, and that trade must be RED here, not invisible.
      expect(askedDimensions.length, `${c.id}: expected at least one question`).toBeGreaterThan(0);
    },
  );
});
