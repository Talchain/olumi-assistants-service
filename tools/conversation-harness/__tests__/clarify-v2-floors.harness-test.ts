/**
 * Clarify v2 — eval FLOORS over the brief fixture pack (E0-B, ROADMAP 1.94
 * Option A replacement; spec §E4).
 *
 * Pass/fail floors, promotion-gating — a candidate (deterministic today,
 * the PMS haiku-class prompt later) must keep every floor green:
 *
 *   DRAFT-FIRST INTAKE (2026-08-17, Paul's ratified target): round 1 no
 *   longer ASKS — every draft-shaped brief drafts, with its questions
 *   deferred alongside the draft. The floors below are re-derived against
 *   that behaviour; the resume floors run over LEGACY live rounds (rows
 *   persisted by pre-draft-first deploys, honoured within their TTL).
 *
 *   1. FIRES-AT-ALL: every 'clarify' fixture still produces ≥1 question —
 *      now DEFERRED onto the draft, never blocking it. The retired Stage-4
 *      clarifier's live baseline was 0 questions on 100% of firings; this
 *      floor stays RED against that never-fires baseline by construction.
 *   2. COMPLETE-BRIEF SILENCE: every 'silent' fixture produces 0 questions.
 *   3. CONTRACT PARSE 100%: every emitted clarify response (resume-only
 *      surface) parses the strict OlumiResponseSchema.
 *   4. NO DEAD ENDS: every emitted question carries 2–5 tap-able candidate
 *      answers, a model-impact clause, and is not in the banned
 *      bare-detail class; every response carries the default-forward chip.
 *   5. NO REPEATS: the scripted multi-round resumes (legacy rounds) never
 *      re-ask an already-asked dimension, and the stop rule always
 *      terminates in a proceed.
 *   6. NO RE-ASK OF A SUPPLIED FACT (ROADMAP 2.103): across the WHOLE
 *      pre-draft flow, the intake never asks about a dimension the brief
 *      itself supplies. This is the micro eval set the 2.103 fix rides —
 *      golden briefs + a deterministic assertion, run before and after the
 *      change. See `no_reask_cases` in the fixture pack.
 *      ROADMAP 2.162a widened this floor to assert BOTH directions per case:
 *      `supplied` dimensions must never be asked, and `must_ask` dimensions
 *      must always be. The second half is what lets the floor see a detector
 *      that has widened into crediting a brief which names no alternatives —
 *      the failure mode that is worse than the one 2.103 fixed, because it
 *      drafts a model from options the user never gave.
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
  composeDraftFirstDisclosure,
  CLARIFY_V2_PROCEED_CHIP_ID,
  CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  type ClarifyV2Decision,
  type ClarifyV2RoundState,
} from '../../../src/orchestrator-v5/clarify-v2/preflight.js';
import {
  composeClarifyQuestions,
  validateQuestionShape,
  isBannedBareDetailRequest,
  CLARIFY_V2_MIN_CANDIDATES,
  CLARIFY_V2_MAX_CANDIDATES,
} from '../../../src/orchestrator-v5/clarify-v2/questions.js';
import { assessBriefCompleteness, type ClarifyDimension } from '../../../src/orchestrator-v5/clarify-v2/rubric.js';
import { isDraftShapedText } from '../../../src/schemas/assist.js';

interface BriefFixture {
  readonly id: string;
  readonly brief: string;
  readonly expected: 'clarify' | 'silent' | 'draft_first';
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
  /**
   * ROADMAP 2.162a — dimensions the pre-draft flow MUST actually ask about.
   *
   * `supplied` is a one-directional guard: it catches a detector that is too
   * NARROW (the intake asks for a fact the brief gave). It is structurally
   * blind to the opposite error — a detector widened until it credits a brief
   * that names no alternatives at all. Such a case still asks about its other
   * missing dimensions, so `askedDimensions.length > 0` holds and the floor
   * stays green while the product silently drafts from options the user never
   * supplied, which this file's own philosophy ranks as the WORSE failure.
   *
   * `must_ask` is the presence proof for that direction (trap 13). Optional:
   * cases that predate 2.162a keep their original assertion exactly.
   */
  readonly must_ask?: readonly ClarifyDimension[];
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

/**
 * A LEGACY live round state over `brief` — as persisted by a pre-draft-first
 * deploy (when round 1 still asked), derived from the live rubric + question
 * composer (exactly what the retired ask arm recorded), never hand-listed.
 */
function legacyRoundState(brief: string): { state: ClarifyV2RoundState; questions: readonly ReturnType<typeof composeClarifyQuestions>[number][] } {
  const questions = composeClarifyQuestions(
    assessBriefCompleteness(brief).missing,
    CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  );
  if (questions.length === 0) throw new Error('fixture precondition: brief must have gaps');
  return {
    state: { brief, asked: questions.map((q) => q.dimension), round: 1 },
    questions,
  };
}

const clarifyFixtures = pack.briefs.filter((b) => b.expected === 'clarify');
const silentFixtures = pack.briefs.filter((b) => b.expected === 'silent');
// Track-1 intake fix (2026-08-13): EXACTLY ONE dimension missing — drafts
// first-turn with the one question deferred to a disclosed post-draft ask.
const draftFirstFixtures = pack.briefs.filter((b) => b.expected === 'draft_first');

describe('clarify_v2 floors — fixture pack sanity', () => {
  it('covers both classes with a meaningful pack (~20 briefs)', () => {
    expect(pack.briefs.length).toBeGreaterThanOrEqual(18);
    expect(clarifyFixtures.length).toBeGreaterThanOrEqual(10);
    expect(silentFixtures.length).toBeGreaterThanOrEqual(5);
    expect(draftFirstFixtures.length).toBeGreaterThanOrEqual(2);
    expect(pack.resume_scripts.length).toBeGreaterThanOrEqual(3);
  });
});

describe('FLOOR 1 — fires-at-all (RED against the never-fires baseline; draft-first: the questions DEFER, never block)', () => {
  it.each(clarifyFixtures.map((f) => [f.id, f] as const))('%s defers ≥1 question alongside the draft', (_id, f) => {
    const d = decideClarifyV2Round1(f.brief);
    expect(d.kind, f.note).toBe('proceed');
    expect(d.reason, f.note).toBe('multi_gap_draft_first');
    expect(d.deferredQuestions?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('aggregate fire-rate on thin briefs is 100% (baseline was 0%)', () => {
    const fired = clarifyFixtures.filter(
      (f) => (decideClarifyV2Round1(f.brief).deferredQuestions?.length ?? 0) >= 1,
    );
    expect(fired.length).toBe(clarifyFixtures.length);
  });
});

describe('FLOOR 2 — complete-brief silence (no busywork)', () => {
  it.each(silentFixtures.map((f) => [f.id, f] as const))('%s proceeds with 0 questions', (_id, f) => {
    const d = decideClarifyV2Round1(f.brief);
    expect(d, f.note).toEqual({ kind: 'proceed', brief: f.brief, reason: 'complete' });
  });
});

describe('FLOOR DF — draft-first on a single gap (Track-1 intake fix, 2026-08-13)', () => {
  it.each(draftFirstFixtures.map((f) => [f.id, f] as const))(
    '%s proceeds to the draft with the ONE question deferred and disclosed',
    (_id, f) => {
      const assessment = assessBriefCompleteness(f.brief);
      // Fixture-integrity guard: a draft_first fixture must genuinely have
      // exactly one missing dimension — otherwise this floor tests nothing
      // about the count predicate (a guard must pin its own precondition).
      expect(assessment.missing, f.note).toHaveLength(1);
      const d = decideClarifyV2Round1(f.brief);
      expect(d.kind, f.note).toBe('proceed');
      expect(d.reason).toBe('single_gap_draft_first');
      // Identity binding: the deferred question is the missing dimension's.
      expect(d.deferredQuestions?.map((q) => q.dimension)).toEqual([assessment.missing[0]]);
      // The disclosure is provenance-honest: the assumed value is named as
      // the ASSISTANT's, and the question rides.
      //
      // ⚠ MARKER CHANGED AT #928 ROUND 4. This asserted the literal
      // `'not something you told me'` — which is itself A CLAIM ABOUT THE
      // USER'S WORDS, i.e. exactly what round 4 removes (the product may
      // describe what IT did; it may not tell the user what THEY said). A
      // floor that pins the defect is a floor holding the defect in place.
      const disclosure = composeDraftFirstDisclosure(d.deferredQuestions!);
      expect(disclosure).toContain("I've assumed");
      // …and it must assert NOTHING about the brief, in either branch. This
      // floor runs over the fixture pack, so it is the broadest place the
      // property is checked.
      expect(disclosure).not.toMatch(/your brief|\byou (?:didn't|did not|said|told|stated)\b/i);
      expect(disclosure).toContain(d.deferredQuestions![0]!.text);
      expect(isBannedBareDetailRequest(disclosure)).toBe(false);
    },
  );

  it('DRAFT-FIRST WIDENED (2026-08-17): every ≥2-missing clarify fixture ALSO drafts, with ALL its questions (≤ budget) deferred and disclosed honestly', () => {
    for (const f of clarifyFixtures) {
      const missing = assessBriefCompleteness(f.brief).missing;
      expect(missing.length, `${f.id} is misfiled — expected ≥2 missing`).toBeGreaterThanOrEqual(2);
      const d = decideClarifyV2Round1(f.brief);
      expect(d.kind, f.id).toBe('proceed');
      expect(d.reason, f.id).toBe('multi_gap_draft_first');
      const qs = d.deferredQuestions ?? [];
      expect(qs.length, f.id).toBe(Math.min(missing.length, CLARIFY_V2_MAX_QUESTIONS_PER_ROUND));
      // The multi-question disclosure obeys the same honesty floor.
      const disclosure = composeDraftFirstDisclosure(qs);
      expect(disclosure).toContain("I've assumed");
      expect(disclosure).not.toMatch(/your brief|\byou (?:didn't|did not|said|told|stated)\b/i);
      for (const q of qs) expect(disclosure, f.id).toContain(q.text);
      expect(isBannedBareDetailRequest(disclosure)).toBe(false);
    }
  });

  it('complete briefs never carry deferred questions (no busywork on the draft either)', () => {
    for (const f of silentFixtures) {
      const d = decideClarifyV2Round1(f.brief);
      expect(d.kind, f.id).toBe('proceed');
      expect(d.reason, f.id).toBe('complete');
      expect(d.deferredQuestions, f.id).toBeUndefined();
    }
  });
});

describe('FLOOR 3 + 4 — contract parse 100% and no dead-end questions', () => {
  it.each(clarifyFixtures.map((f) => [f.id, f] as const))(
    '%s: every deferred question opens a path; the resume-surface response parses the wire schema',
    (_id, f) => {
      const d = decideClarifyV2Round1(f.brief);
      const questions = d.deferredQuestions ?? [];
      if (questions.length === 0) throw new Error('floor 1 owns this failure');
      // Floor 4: shape invariants per question (deferred set = what a user
      // receives alongside the draft).
      for (const q of questions) {
        expect(validateQuestionShape(q)).toEqual([]);
        expect(isBannedBareDetailRequest(q.text)).toBe(false);
        expect(q.candidates.length).toBeGreaterThanOrEqual(CLARIFY_V2_MIN_CANDIDATES);
        expect(q.candidates.length).toBeLessThanOrEqual(CLARIFY_V2_MAX_CANDIDATES);
        expect(q.impact.trim().length).toBeGreaterThan(0);
      }
      // Floor 3: the clarify wire envelope (LIVE on the resume surface for
      // legacy rounds) still parses strictly over these question sets.
      const response = composeClarifyV2Response(questions, 'follow_up');
      const parsed = OlumiResponseSchema.safeParse(response);
      expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
      // Floor 4: the default-forward escape is always present.
      expect(response.suggested_actions.map((a) => a.id)).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    },
  );
});

describe('FLOOR 5 — no repeats across rounds + the stop rule terminates (LEGACY live rounds)', () => {
  it.each(pack.resume_scripts.map((s) => [s.id, s] as const))('%s', (_id, script) => {
    // Draft-first intake: round 1 no longer asks, so the scripts run over a
    // LEGACY round (persisted pre-draft-first), derived from the live
    // modules exactly as the retired ask arm recorded it.
    const legacy = legacyRoundState(script.brief);
    let state: ClarifyV2RoundState = legacy.state;
    const everAsked = new Set(legacy.questions.map((q) => q.dimension));
    let lastDecision: ClarifyV2Decision = { kind: 'proceed', brief: script.brief, reason: 'complete' };

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
    const legacy = legacyRoundState('Should we expand into the German market?');
    let state = legacy.state;
    let decision: ClarifyV2Decision = { kind: 'proceed', brief: legacy.state.brief, reason: 'complete' };
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
    // ROADMAP 2.162a: at least one OVER-CREDIT negative — a brief that names
    // no alternatives and must still be asked for them. Without it, every
    // widening of the `options` battery is a control pinned to "whatever
    // passes today" (trap 12b) and the floor cannot see a detector that has
    // widened into crediting briefs that supply nothing.
    expect(
      noReask.some((c) => (c.must_ask ?? []).includes('options')),
      'no over-credit negative left in the pack: FLOOR 6 can no longer see a too-wide options detector',
    ).toBe(true);
    // A golden that both supplies and demands the same dimension is
    // self-contradictory and would make one of the two assertions
    // unfalsifiable. Fail on the fixture, not on the product.
    for (const c of noReask) {
      const contradictory = (c.must_ask ?? []).filter((d) => c.supplied.includes(d));
      expect(contradictory, `${c.id}: supplied and must_ask overlap`).toEqual([]);
    }
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
        // Silence means COMPLETE. A deferred draft-first ask is not silence
        // — it must never fire on a brief that supplied everything.
        expect(round1.reason, c.note).toBe('complete');
        expect(round1.deferredQuestions, c.note).toBeUndefined();
        return;
      }

      // Draft-first intake (2026-08-17): the WHOLE pre-draft flow is now
      // round 1's single proceed — the deferred questions ARE the asks for
      // this floor's purposes, and both directions still bite: a detector
      // widened into crediting an unsupplied dimension leaves it un-asked
      // here (must_ask REDs), and a deferred question about a supplied
      // dimension is a re-ask (supplied REDs). Nothing blocks the draft.
      expect(round1.kind, c.note).toBe('proceed');
      expect(
        round1.reason === 'single_gap_draft_first' || round1.reason === 'multi_gap_draft_first',
        `${c.id}: expected a draft-first proceed, got ${round1.reason}`,
      ).toBe(true);
      const askedDimensions: ClarifyDimension[] = [
        ...(round1.deferredQuestions ?? []).map((q) => q.dimension),
      ];

      // ROADMAP 2.162a — the OVER-CREDIT direction. Every dimension the
      // golden says is genuinely absent must actually have been asked. This
      // is what makes the `noask-*` negatives bite: a serial-list detector
      // widened until it credits a geography list or a bullet list of facts
      // leaves `options` un-asked here and reddens the floor, instead of
      // passing because the flow happened to ask about something else.
      const neverAsked = (c.must_ask ?? []).filter((d) => !askedDimensions.includes(d));
      expect(
        neverAsked,
        `${c.id}: the intake NEVER asked about ${JSON.stringify(neverAsked)}, which this brief does not supply — a detector has widened into crediting it. ${c.note}`,
      ).toEqual([]);

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
