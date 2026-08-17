/**
 * Clarify v2 — DRAFT-FIRST intake: a draft-shaped brief ALWAYS drafts, with
 * its missing-dimension questions deferred alongside the draft response.
 *
 * HISTORY, because the table below has moved twice and each move was the
 * point:
 *   - 2026-08-13 (Track 1, INTAKE-FUNNEL §5b): EXACTLY ONE missing
 *     dimension drafted first; ≥2 kept the blocking ask.
 *   - #928 review: two predicted flips (S4, M5) rode FAIL-UNSAFE timeframe
 *     arms; those detector arms were ablated. Round 4 removed every claim
 *     about the user's brief from the disclosure copy.
 *   - 2026-08-17 (Paul's ratified target — draft-first intake): the
 *     blocking round-1 ask is DELETED. A substantive brief produces the
 *     provisional model immediately; clarification rides alongside,
 *     non-blocking, and must never gate seeing the model. The wire witness
 *     (olumi-docs/witness-998-2026-08-16/, session A1) showed a fully
 *     substantive brief answered with questions instead of a model — and
 *     #928 R4 had already voided the cost model that licensed the blocking
 *     ask ("a false MISSING costs one question with a one-tap escape").
 *
 * The trigger remains a COUNT over the existing detectors and the route's
 * own draft-shape heuristic — deliberately NOT a new natural-language
 * predicate (traps 22/22b/22f).
 *
 * Honesty invariants pinned here (INTAKE-FUNNEL §5b i + #928 R4):
 *   - the deferred ask's disclosure names the assumptions as the
 *     ASSISTANT's, never as user-stated, and claims NOTHING about the
 *     user's brief (both branches: genuine miss and over-detection);
 *   - the disclosure binds to the MISSING dimensions by identity;
 *   - explicit-generate still proceeds with NO deferred ask (the user
 *     pressed Generate; unchanged behaviour).
 *
 * The 15-brief table is driven by REAL WIRE CAPTURES (tests/fixtures/
 * clarify-v2-wire-briefs-2026-08-12.json — append-only, never edited).
 * Expected missing-dimension sets are the LIVE RUBRIC's own verdicts,
 * derived at fa8bacc5 (the rubric is untouched by draft-first intake):
 * this table pins the ROUTING OUTCOME (trap 23) — every brief drafts.
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
// The measured over-detection sentence is IMPORTED from the corpus that owns
// it — never retyped here (round 4: it was mirrored across two specs).
import { MEASURED_OVER_DETECTION_GOAL_SENTENCE } from '../fixtures/clarify-v2-measured-strings.js';
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

/**
 * The provenance marker every disclosure must carry (assistant-authored).
 *
 * ⚠ CHANGED at #928 round 4. The old marker was the literal string
 * `'not something you told me'` — which is itself A CLAIM ABOUT THE USER'S
 * WORDS, i.e. the very thing round 4 removes. A marker that pins the defect
 * is a guard holding the defect in place.
 */
const PROVENANCE_MARKER = "I've assumed";

// ── The 15-brief outcome table (the acceptance table, pinned) ──────────────
// 'complete'    → proceed silently, reason 'complete', NO deferred questions.
// 'draft_first' → proceed with the named dimensions' questions deferred:
//                 reason 'single_gap_draft_first' for one dimension,
//                 'multi_gap_draft_first' for two or more. EVERY gapped
//                 brief drafts — no row may be a blocking ask.
const EXPECTED_FIRST_TURN: ReadonlyArray<
  readonly [string, 'complete'] | readonly [string, 'draft_first', readonly ClarifyDimension[]]
> = [
  ['S1', 'draft_first', ['goal', 'quantities']],
  ['S2', 'draft_first', ['goal', 'timeframe']],
  ['S3', 'draft_first', ['goal', 'quantities']],
  ['S4', 'draft_first', ['goal', 'timeframe']],
  ['S5', 'draft_first', ['goal']],
  ['M1', 'complete'],
  ['M2', 'draft_first', ['goal', 'timeframe']],
  ['M3', 'draft_first', ['goal']],
  ['M4', 'draft_first', ['goal', 'options', 'timeframe']],
  ['M5', 'draft_first', ['goal', 'timeframe']],
  ['L1', 'draft_first', ['goal']],
  ['L2', 'draft_first', ['goal']],
  ['L3', 'draft_first', ['goal']],
  ['L4', 'draft_first', ['goal', 'timeframe']],
  ['L5', 'complete'],
];

describe('the 15-brief first-turn table (real wire captures) — every brief drafts', () => {
  it.each(EXPECTED_FIRST_TURN.map((row) => [row[0], row] as const))(
    '%s',
    (_id, row) => {
      const [id, expected, dimensions] = row;
      const decision = decideClarifyV2Round1(wireBrief(id));
      expect(decision.kind, id).toBe('proceed');
      if (expected === 'complete') {
        expect(decision.reason, id).toBe('complete');
        expect(
          decision.deferredQuestions,
          `${id}: a complete brief must carry NO deferred ask`,
        ).toBeUndefined();
        return;
      }
      expect(decision.reason, id).toBe(
        dimensions!.length === 1 ? 'single_gap_draft_first' : 'multi_gap_draft_first',
      );
      expect(
        decision.deferredQuestions?.map((q) => q.dimension),
        id,
      ).toEqual(dimensions);
    },
  );

  it('acceptance: EVERY previously re-asked brief now drafts first-turn — no blocking ask remains in the table', () => {
    // EXACT, not a floor: the whole table drafts. A future change that
    // reintroduces a blocking first-turn ask must edit this list
    // deliberately, and the per-row pins above go RED with it.
    const nonComplete = EXPECTED_FIRST_TURN.filter((r) => r[1] !== 'complete');
    expect(nonComplete.map((r) => r[0])).toEqual([
      'S1', 'S2', 'S3', 'S4', 'S5', 'M2', 'M3', 'M4', 'M5', 'L1', 'L2', 'L3', 'L4',
    ]);
    for (const [id] of nonComplete) {
      const decision = decideClarifyV2Round1(wireBrief(id));
      expect(decision.kind, `${id} must draft, never block`).toBe('proceed');
      expect(decision.deferredQuestions?.length ?? 0, id).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── Gap-count semantics (the off-by-one mutant target, inverted) ───────────
describe('EVERY gap count drafts first — the questions defer, capped at the round budget', () => {
  it('two missing dimensions draft with BOTH questions deferred (S1)', () => {
    const decision = decideClarifyV2Round1(wireBrief('S1'));
    expect(decision.kind).toBe('proceed');
    expect(decision.reason).toBe('multi_gap_draft_first');
    expect(decision.deferredQuestions).toHaveLength(2);
  });

  it('two missing dimensions draft with BOTH questions deferred (L4)', () => {
    const decision = decideClarifyV2Round1(wireBrief('L4'));
    expect(decision.reason).toBe('multi_gap_draft_first');
    expect(decision.deferredQuestions).toHaveLength(2);
  });

  it('three missing dimensions draft with THREE questions deferred (synthetic control)', () => {
    // Options present via "or"; goal, timeframe, quantities all absent.
    const decision = decideClarifyV2Round1(
      'Should we rebuild the billing platform ourselves or buy a vendor product instead of waiting?',
    );
    expect(decision.kind).toBe('proceed');
    expect(decision.reason).toBe('multi_gap_draft_first');
    expect(decision.deferredQuestions).toHaveLength(3);
  });

  it('a single missing dimension proceeds with the deferred question for THAT dimension (quantities)', () => {
    // goal ("The goal is…"), options ("or"), timeframe ("this quarter") all
    // present; quantities absent. Identity-binding pin: the deferred ask must
    // be the QUANTITIES question — a composer hard-wired to goal must go RED.
    const decision = decideClarifyV2Round1(
      'Should we hire a contractor or a permanent engineer this quarter? The goal is to reduce delivery risk.',
    );
    expect(decision.kind).toBe('proceed');
    expect(decision.reason).toBe('single_gap_draft_first');
    expect(decision.deferredQuestions?.map((q) => q.dimension)).toEqual(['quantities']);
  });

  it('explicit-generate proceeds with NO deferred questions, even on a gapped brief', () => {
    const decision = decideClarifyV2Round1(wireBrief('S5'), true);
    expect(decision.kind).toBe('proceed');
    expect(decision.reason).toBe('explicit_generate');
    expect(decision.deferredQuestions).toBeUndefined();
  });

  it('the working brief is preserved (trimmed) as the draft brief', () => {
    const decision = decideClarifyV2Round1(`  ${wireBrief('S5')}  `);
    expect(decision.kind).toBe('proceed');
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
    '%s (single): names the assumption as the assistant’s, never the user’s',
    (dimension) => {
      const text = composeDraftFirstDisclosure([questionFor(dimension)]);
      expect(text).toContain(PROVENANCE_MARKER);
      expect(text).toMatch(/\bassumed\b/i);
      // The user must never be quoted as the source of the assumed value.
      expect(text).not.toMatch(/\byou (?:said|stated|told me that|asked for)\b/i);
    },
  );

  it.each(['goal', 'options', 'timeframe', 'quantities'] as const)(
    '%s (single): carries its OWN dimension’s question text (identity binding)',
    (dimension) => {
      const text = composeDraftFirstDisclosure([questionFor(dimension)]);
      expect(text).toContain(questionFor(dimension).text);
      for (const other of ['goal', 'options', 'timeframe', 'quantities'] as const) {
        if (other === dimension) continue;
        expect(text, `${dimension} disclosure must not carry ${other}'s question`).not.toContain(
          questionFor(other).text,
        );
      }
    },
  );

  it('multi-gap: carries EVERY deferred question’s text and only those (identity binding)', () => {
    const included = ['goal', 'timeframe'] as const;
    const text = composeDraftFirstDisclosure(included.map(questionFor));
    for (const dim of included) {
      expect(text).toContain(questionFor(dim).text);
    }
    for (const other of ['options', 'quantities'] as const) {
      expect(text, `must not carry ${other}'s question`).not.toContain(
        questionFor(other).text,
      );
    }
    // Numbered lines, not a wall of text (the 2026-08-16 P1 lesson).
    expect(text).toContain('1. ');
    expect(text).toContain('2. ');
    expect(text).toContain('\n');
  });

  it('multi-gap: keeps the assistant-authored provenance', () => {
    const text = composeDraftFirstDisclosure(
      (['goal', 'options', 'quantities'] as const).map(questionFor),
    );
    expect(text).toContain(PROVENANCE_MARKER);
    expect(text).not.toMatch(/\byou (?:said|stated|told me that|asked for)\b/i);
  });

  it('offers the canvas as the way to change the assumption(s) — single and multi', () => {
    expect(composeDraftFirstDisclosure([questionFor('goal')])).toMatch(/canvas/i);
    expect(
      composeDraftFirstDisclosure((['goal', 'timeframe'] as const).map(questionFor)),
    ).toMatch(/canvas/i);
  });

  it('the single-question copy is byte-stable across the widening (the 2026-08-13 shape survives)', () => {
    const q = questionFor('goal');
    expect(composeDraftFirstDisclosure([q])).toBe(
      `One thing to check: I've assumed the goal in this draft, and I haven't confirmed it with you. ` +
        `${q.text} You can answer here, or change it directly on the canvas.`,
    );
  });
});

// ── B3 (#928 round 4): THE DISCLOSURE MAKES NO CLAIM ABOUT THE USER'S BRIEF ─
/**
 * ⭐ THE GOVERNING RULE (orchestrator ruling, #928 round 4):
 * **the product may describe what IT did; it may not tell the user what THEY
 * said.** One of those we can always verify; the other we cannot.
 *
 * Round 3's copy said *"your brief didn't state the goal"*. The round-3
 * reviewer measured that sentence shipping, on the wire, on a brief reading
 * *"Our goal is not just cost but speed."* — a false assertion about the
 * user's own words. Draft-first is what made it serious: it removed both the
 * clarifying question and the one-tap escape that used to make a false
 * MISSING cost one question, so the error now costs a confident falsehood
 * about the user with no way to answer back. Draft-first INTAKE (2026-08-17)
 * widens draft-first to every gap count, so this rule now covers the
 * multi-gap disclosure too — pinned below in BOTH branches.
 *
 * THE EXIT IS NOT A BETTER DETECTOR. Four rounds of widening this predicate
 * each fixed one direction and opened the other (trap 22f). Round 4 instead
 * makes the predicate's accuracy STOP BEING A TRUTH-BEARING PROPERTY: the
 * disclosure claims only what the product itself did, so over-detection
 * degrades from a TRUTH defect to a QUALITY-OF-ASSUMPTION defect.
 */
describe('B3 — the disclosure is true in BOTH branches (it claims nothing about the brief)', () => {
  /**
   * Assertions about the USER'S OWN WORDS. Anything matching these is a claim
   * we cannot verify and therefore must not make.
   *
   * ⚠ This list is a hand-written lexicon and CANNOT be complete — it catches
   * the shapes we have actually shipped, not every shape English affords. It
   * is honest about that limit rather than pretending to be a derived guard
   * (trap 12d: deriving would prove the copies agree, never that the list is
   * right). Its POSITIVE CONTROL below is what stops it being decorative.
   */
  const BRIEF_CLAIM_PATTERNS: readonly RegExp[] = [
    /your brief/i,
    /\byou (?:didn't|did not|never|haven't|have not)\b/i,
    /\byou (?:said|stated|told|wrote|mentioned|gave|named|specified|provided)\b/i,
    /something you told me/i,
  ];

  const claimsAboutTheBrief = (text: string): readonly string[] =>
    BRIEF_CLAIM_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);

  const questionFor = (dimension: ClarifyDimension) => {
    const [q] = composeClarifyQuestions([dimension], 1);
    if (q === undefined) throw new Error('no question composed');
    return q;
  };

  it('POSITIVE CONTROL — the guard can SEE a violation (round 3’s exact shipped copy)', () => {
    // Without this, every absence assertion below could pass by testing
    // nothing (trap 13). This is the literal round-3 string, measured on the
    // wire by the reviewer; the guard must flag it.
    const ROUND_3_COPY =
      "One thing to check: your brief didn't state the goal, so the goal in this draft is my " +
      'assumption — not something you told me. What outcome would make this decision a success?';
    expect(claimsAboutTheBrief(ROUND_3_COPY).length).toBeGreaterThan(0);
  });

  it.each(['goal', 'options', 'timeframe', 'quantities'] as const)(
    '%s: the emitted single-question disclosure asserts nothing about what the user said',
    (dimension) => {
      const text = composeDraftFirstDisclosure([questionFor(dimension)]);
      expect(
        claimsAboutTheBrief(text),
        `${dimension} disclosure tells the user what they said: ${text}`,
      ).toEqual([]);
    },
  );

  it('the multi-question disclosure asserts nothing about what the user said (every pair and the full set)', () => {
    const dims = ['goal', 'options', 'timeframe', 'quantities'] as const;
    for (let i = 0; i < dims.length; i += 1) {
      for (let j = i + 1; j < dims.length; j += 1) {
        const text = composeDraftFirstDisclosure([
          questionFor(dims[i]!),
          questionFor(dims[j]!),
        ]);
        expect(
          claimsAboutTheBrief(text),
          `[${dims[i]},${dims[j]}] disclosure tells the user what they said: ${text}`,
        ).toEqual([]);
      }
    }
    const full = composeDraftFirstDisclosure(dims.slice(0, 3).map(questionFor));
    expect(claimsAboutTheBrief(full)).toEqual([]);
  });

  /**
   * The two branches, both routed through the REAL decision function so the
   * test binds to what a user would actually receive — not to the copy table.
   */
  const disclosureFor = (brief: string): string => {
    const decision = decideClarifyV2Round1(brief);
    if (decision.kind !== 'proceed') {
      throw new Error(`expected proceed, got ${decision.kind}`);
    }
    if (decision.reason !== 'single_gap_draft_first') {
      throw new Error(`expected single_gap_draft_first, got ${decision.reason}`);
    }
    if (decision.deferredQuestions === undefined) throw new Error('no deferred questions');
    return composeDraftFirstDisclosure(decision.deferredQuestions);
  };

  /**
   * BRANCH B — THE OVER-DETECTION BRANCH. The reviewer's measured
   * over-detection sentence, IMPORTED from the corpus that owns it, embedded
   * in an otherwise complete brief exactly as measured (REVIEW-928-R3 §6 D-iv).
   *
   * ⚠ COMPOSED FROM THE IMPORT, NOT RETYPED. These bytes were previously
   * duplicated here with no import — two specs depending on one adjudication
   * with nothing tying them together (trap 12).
   */
  const OVER_DETECTED_BRIEF =
    'Should we open a second warehouse in Manchester next year, or expand our existing site? ' +
    `A new site would cost roughly £1.2 million up front. ${MEASURED_OVER_DETECTION_GOAL_SENTENCE}`;

  it('the over-detection branch is REAL at this tip — BOTH halves (the pin is not vacuous)', () => {
    // ⭐⭐ THIS PIN HAD ONLY ONE HALF UNTIL #928 ROUND 4, AND A REVIEWER PROVED
    // IT BY EXECUTION (trap 13b: a guard whose discrimination depends on a
    // fixture nothing pins is real only on the day it was written).
    //
    // HALF ONE — the brief provably contains a sentence the reviewer's corpus
    // records as STATING a goal. It REDs the moment the fixture stops being
    // an over-detection input.
    expect(OVER_DETECTED_BRIEF).toContain(MEASURED_OVER_DETECTION_GOAL_SENTENCE);
    // HALF TWO — and the rubric nevertheless scores goal MISSING. Together
    // these two are what "the detector over-detected" MEANS; either alone is
    // satisfiable by a brief that is not an over-detection at all.
    const decision = decideClarifyV2Round1(OVER_DETECTED_BRIEF);
    expect(decision.kind).toBe('proceed');
    expect(decision.reason).toBe('single_gap_draft_first');
    expect(decision.deferredQuestions?.map((q) => q.dimension)).toEqual(['goal']);
  });

  it('BOTH BRANCHES emit the SAME sentence, and it claims nothing about the brief', () => {
    // Branch A — the goal is genuinely absent (real wire capture S5).
    const genuinelyMissing = disclosureFor(wireBrief('S5'));
    // Branch B — the goal is plainly STATED and the detector over-detected.
    const overDetected = disclosureFor(OVER_DETECTED_BRIEF);

    // Identical by construction, and pinned so it stays that way: the moment
    // the copy branches on anything derived from the brief, it starts making
    // a claim about the brief again.
    expect(overDetected).toBe(genuinelyMissing);
    expect(claimsAboutTheBrief(genuinelyMissing)).toEqual([]);
    expect(claimsAboutTheBrief(overDetected)).toEqual([]);
    // …and it still does its job: it names the value as the assistant's.
    expect(genuinelyMissing).toContain(PROVENANCE_MARKER);
  });
});

// ── Dispatch level: the outcome is a DRAFT instruction, not a commit ──────
describe('tryClarifyV2Turn — round 1 returns a draft outcome with the deferred ask, at EVERY gap count', () => {
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
    expect(outcome.deferredAsk?.dimensions).toEqual(['goal']);
    expect(outcome.deferredAsk?.disclosure).toContain(PROVENANCE_MARKER);
    // Non-blocking by construction: no clarify turn is committed and no
    // clarify_v2_round pending is persisted — there is nothing to resume.
    expect(appends).toHaveLength(0);
    // Telemetry: the proceed event fires with the single-gap reason.
    const proceeded = events.filter((e) => e.name === TelemetryEvents.V5ClarifyV2Proceeded);
    expect(proceeded).toHaveLength(1);
    expect(proceeded[0]?.data.reason).toBe('single_gap_draft_first');
    expect(proceeded[0]?.data.deferred_dimensions).toEqual(['goal']);
  });

  it('two-gap brief → {kind:"draft"} with BOTH dimensions deferred; NOTHING committed (the old blocking ask is gone)', async () => {
    const { outcome, appends, events } = await runClarifyV2Turn({
      message: wireBrief('S1'),
    });
    expect(outcome?.kind).toBe('draft');
    if (outcome?.kind !== 'draft') return;
    expect(outcome.briefOverride).toBe(wireBrief('S1'));
    expect(outcome.deferredAsk?.dimensions).toEqual(['goal', 'quantities']);
    expect(outcome.deferredAsk?.disclosure).toContain(PROVENANCE_MARKER);
    expect(appends).toHaveLength(0);
    const proceeded = events.filter((e) => e.name === TelemetryEvents.V5ClarifyV2Proceeded);
    expect(proceeded).toHaveLength(1);
    expect(proceeded[0]?.data.reason).toBe('multi_gap_draft_first');
    expect(proceeded[0]?.data.deferred_dimensions).toEqual(['goal', 'quantities']);
  });

  it('complete brief still proceeds silently — null outcome, no deferred ask anywhere', async () => {
    const { outcome, appends } = await runClarifyV2Turn({
      message: wireBrief('M1'),
    });
    expect(outcome).toBeNull();
    expect(appends).toHaveLength(0);
  });

  it('explicit-generate on a gapped brief keeps the pristine path (null → route drafts)', async () => {
    const { outcome } = await runClarifyV2Turn({
      message: wireBrief('S5'),
      explicitGenerateBrief: wireBrief('S5'),
    });
    expect(outcome).toBeNull();
  });

  it('NEGATIVE PIN: a non-draft-shaped message is never claimed and never drafted — the route’s own heuristic bounds the draft attempt', async () => {
    const { outcome, appends } = await runClarifyV2Turn({
      message: 'help',
      draftShaped: false,
    });
    // Null = not engaged: no draft instruction is fabricated for a message
    // the pipeline itself judged un-draftable; the route's conversational
    // reply stands (that IS the honest case).
    expect(outcome).toBeNull();
    expect(appends).toHaveLength(0);
  });
});
