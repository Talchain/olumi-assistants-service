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
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe,expect,it } from 'vitest';




import { type ClarifyDimension } from '../../../src/orchestrator-v5/clarify-v2/rubric.js';
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


});
