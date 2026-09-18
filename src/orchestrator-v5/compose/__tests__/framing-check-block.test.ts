/**
 * ⭐ TRACK 3 — the FRAME card. Unit suite for `buildFramingCheckCoachingBlock`.
 *
 * WHAT IS BEING PROVED, and why each one is here rather than assumed:
 *
 *  T1  a positive control FIRST — the builder can see a PRESENCE. Every
 *      absence assertion below is worthless without it (CLAUDE.md trap 13).
 *  T2  the emitted block parses against the VENDORED `CoachingBlockSchema`,
 *      which is the actual egress authority (`.strict()`), not a local shape.
 *  T3  the ruled taxonomy: kind / source / rank / guidance signals, each by
 *      exact value — rank 5 is load-bearing (`PHASE3_DEFAULT_EXPANDED` is 6 in
 *      the UI and a collapsed card renders NULL).
 *  T4  THE CONTRAST — the body carries the team's own goal, the model's
 *      concern and the model's reframe, each matched as a WHOLE STRING by
 *      identity. A length or "contains some text" predicate would pass on the
 *      wrong object (trap 19).
 *  T5  THE POLARITY PAIR, and the single most important pair in this file.
 *      `addresses_goal` decides NOTHING: a `true` payload carrying prose still
 *      emits, and a prose-less `{addresses_goal: false}` emits nothing. A gate
 *      written as `addresses_goal === false` REDs on both halves at once —
 *      that is the inverted-gate class the producer-polarity suite was written
 *      to warn about, caught here on the consumer side.
 *  T6  no `dsk_claim_provenance`, asserted WITH a contrast (a sibling optional
 *      field IS present), so the absence is the producer's decision and not a
 *      block that failed to build.
 *  T7  the chip is an ordinary chat turn and its prompt is NOT the reframe.
 *  T8  two goal nodes ⇒ no quote and no target_ref, card still ships.
 *  T9  the budget rule: segments are dropped WHOLE, a model sentence is never
 *      cut. Asserted by requiring the sentence to appear entire or not at all.
 *  T10 absence, with its contrast in the same test.
 */

import { describe, expect, it } from 'vitest';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  buildFramingCheckCoachingBlock,
  type BlockBuildCtx,
  type GraphNodeLookup,
} from '../phase3-blocks.js';
import { GUIDANCE_SIGNAL_CODES, PRIORITY_BY_CATEGORY } from '../guidance-signals.js';

const GRAPH_HASH = 'gh_framing_test_0001';
const CTX: BlockBuildCtx = {
  created_at: '2026-09-18T10:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

const GOAL_LABEL = 'Migrate the billing platform to the new vendor';
const CONCERN =
  'The goal is stated as an action to take rather than as the outcome the team wants.';
const REFRAME = 'Reduce billing errors and support cost without disrupting customers';

function lookupWithGoals(count: number): GraphNodeLookup {
  const map: GraphNodeLookup = new Map();
  for (let i = 0; i < count; i++) {
    map.set(`goal_${i}`, { id: `goal_${i}`, label: GOAL_LABEL, kind: 'goal' });
  }
  map.set('fac_cost', { id: 'fac_cost', label: 'Support cost', kind: 'factor' });
  return map;
}

function factWith(framingCheck: unknown, includeKey = true): RunAnalysisHandlerFact {
  const decisionReview: Record<string, unknown> = {
    produced_at: '2026-09-18T09:59:00.000Z',
    narrative_summary: 'The analysis reads clearly.',
    key_assumptions: [],
    decision_quality_prompts: [],
  };
  if (includeKey) decisionReview.framing_check = framingCheck;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-framing',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: { decision_review: decisionReview },
    },
  } as unknown as RunAnalysisHandlerFact;
}

const FULL_FRAMING = {
  addresses_goal: false,
  concern: CONCERN,
  suggested_reframe: REFRAME,
};

describe('T1 — positive control: the builder can see a framing_check', () => {
  it('emits exactly one block for a full framing_check', () => {
    const block = buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(1), CTX);
    expect(block, 'the positive control must fire before any absence below means anything')
      .not.toBeNull();
    expect(block!.type).toBe('coaching');
  });
});

describe('T2 — the block is valid at the egress authority', () => {
  it('parses against the vendored, strict CoachingBlockSchema', () => {
    const block = buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(1), CTX)!;
    const parsed = CoachingBlockSchema.safeParse(block);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.flatten())).toBe(true);
  });
});

describe('T3 — the ruled taxonomy, by exact value', () => {
  const block = () => buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(1), CTX)!;

  it('is coaching_kind strengthen, sourced from decision_review', () => {
    expect(block().coaching_kind).toBe('strengthen');
    expect(block().source).toBe('decision_review');
  });

  it('ranks 5 — above the narrative summary (10), the lens suggestion (15) and every review card', () => {
    // Load-bearing, not cosmetic: the UI opens the first six phase-3 cards and
    // renders every later one as NULL. The coaching band in this file is 100+.
    expect(block().priority_rank).toBe(5);
  });

  it('carries should_fix, the FRAMING_CHECK detector code and its deterministic trigger line', () => {
    expect(block().category).toBe('should_fix');
    expect(block().priority).toBe(PRIORITY_BY_CATEGORY.should_fix);
    expect(block().signal_code).toBe(GUIDANCE_SIGNAL_CODES.FRAMING_CHECK);
    expect(block().signal).toBe('The review flagged how this decision is framed');
  });

  it('titles itself as a QUESTION to the team, never an assertion about their framing', () => {
    expect(block().title).toBe('Does this model answer the question you asked?');
  });
});

describe('T4 — THE CONTRAST: the body sets the team’s own framing beside the alternative', () => {
  const body = () =>
    buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(1), CTX)!.body;

  it('quotes the team’s own goal label — bound by identity, not by a substring another node could satisfy', () => {
    expect(body()).toContain(`You framed this as “${GOAL_LABEL}”.`);
  });

  it('carries the model’s concern VERBATIM and whole', () => {
    expect(body()).toContain(CONCERN);
  });

  it('carries the model’s reframe VERBATIM and whole, labelled as something to weigh', () => {
    expect(body()).toContain(`A different framing to weigh: “${REFRAME}”`);
  });

  it('orders them what-you-said → why → what-to-weigh', () => {
    const b = body();
    expect(b.indexOf(GOAL_LABEL)).toBeLessThan(b.indexOf(CONCERN));
    expect(b.indexOf(CONCERN)).toBeLessThan(b.indexOf(REFRAME));
  });

  it('links the goal node so it stays clickable — the UI renders target_refs[].label verbatim', () => {
    const block = buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(1), CTX)!;
    expect(block.target_refs).toEqual([{ id: 'goal_0', label: GOAL_LABEL, kind: 'goal' }]);
  });
});

describe('T5 — THE POLARITY PAIR: `addresses_goal` decides nothing; the prose does', () => {
  it('a payload with addresses_goal TRUE still emits, because the concern prose is the evidence', () => {
    // The historic v4_1 prompt showed the model `"addresses_goal": true` twice,
    // and the LIVE served monolith states the inclusion rule with no polarity
    // instruction at all. A consumer gated on `=== false` would go dark here.
    const block = buildFramingCheckCoachingBlock(
      factWith({ addresses_goal: true, concern: CONCERN }),
      lookupWithGoals(1),
      CTX,
    );
    expect(block).not.toBeNull();
    expect(block!.body).toContain(CONCERN);
  });

  it('a prose-less {addresses_goal: false} emits NOTHING — composeFragments retains that object, so it does reach here', () => {
    expect(
      buildFramingCheckCoachingBlock(factWith({ addresses_goal: false }), lookupWithGoals(1), CTX),
    ).toBeNull();
  });

  it('a suggested_reframe with no concern still emits (the monolith marks concern OPTIONAL)', () => {
    const block = buildFramingCheckCoachingBlock(
      factWith({ addresses_goal: false, suggested_reframe: REFRAME }),
      lookupWithGoals(1),
      CTX,
    );
    expect(block).not.toBeNull();
    expect(block!.body).toContain(REFRAME);
  });

  it('whitespace-only prose is not prose', () => {
    expect(
      buildFramingCheckCoachingBlock(
        factWith({ addresses_goal: false, concern: '   ', suggested_reframe: '\n\t' }),
        lookupWithGoals(1),
        CTX,
      ),
    ).toBeNull();
  });
});

describe('T6 — no DSK badge, and the absence is a decision rather than a failure', () => {
  it('omits dsk_claim_provenance while the sibling optional fields ARE present (contrast control)', () => {
    const block = buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(1), CTX)!;
    // Target: absent. No claim in `data/dsk/v1.json` grounds goal-vs-outcome
    // framing (re-censused over all 27 objects; DSK-B-007 is option-set size).
    expect('dsk_claim_provenance' in block).toBe(false);
    // Contrast: other optional fields on the same block ARE populated, so the
    // absence above is not a block that half-built.
    expect(block.signal_code).toBeDefined();
    expect(block.action_prompt).toBeDefined();
  });
});

describe('T7 — the chip offers a conversation, never a reframe the product cannot accept', () => {
  const block = () => buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(1), CTX)!;

  it('dispatches an ordinary chat turn', () => {
    expect(block().action_intent).toBe('start_guided_chat');
    expect(block().action_label).toBe('Challenge the framing');
  });

  it('does NOT dispatch the model’s reframe — the team decides whether it beats their own', () => {
    expect(block().action_prompt).not.toContain(REFRAME);
    expect(block().action_prompt).toBe(
      'Help me pressure-test how I have framed this decision — is the goal I stated the outcome I actually want?',
    );
  });
});

describe('T8 — the goal referent fails closed without costing the card', () => {
  it('two goal nodes ⇒ no quote and no target_ref, but the concern still ships', () => {
    const block = buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(2), CTX)!;
    expect(block).not.toBeNull();
    expect(block.target_refs).toEqual([]);
    expect(block.body).not.toContain('You framed this as');
    expect(block.body).toContain(CONCERN);
  });

  it('no goal node at all ⇒ same honest degradation', () => {
    const block = buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookupWithGoals(0), CTX)!;
    expect(block).not.toBeNull();
    expect(block.target_refs).toEqual([]);
    expect(block.body).toContain(CONCERN);
  });
});

describe('T9 — segments are dropped WHOLE; a model sentence is never cut', () => {
  const LONG_CONCERN =
    'The options on the board all describe implementation routes for a migration already chosen, so none speaks to the outcome the brief actually asks about.';

  // ⚠ THE FIXTURE'S PRECONDITION IS PINNED IN-TEST (trap 13b, third face). A
  // budget test whose fixture quietly stopped straddling the boundary would go
  // green while proving nothing — it would simply be exercising the ordinary
  // path. These two assertions state that this fixture DOES straddle it.
  const GOAL_SEGMENT = `You framed this as \u201c${GOAL_LABEL}\u201d.`;
  const REFRAME_SEGMENT = `A different framing to weigh: \u201c${REFRAME}\u201d`;

  it('the fixture straddles the 300-character boundary (precondition, not a result)', () => {
    expect(
      [GOAL_SEGMENT, LONG_CONCERN, REFRAME_SEGMENT].join(' ').length,
      'with the goal segment this MUST overflow, or the drop branch is never reached',
    ).toBeGreaterThan(300);
    expect(
      [LONG_CONCERN, REFRAME_SEGMENT].join(' ').length,
      'without it this MUST fit, or the test would prove a whole-block drop instead',
    ).toBeLessThanOrEqual(300);
  });

  it('drops the goal segment to fit, and keeps the model’s sentence entire', () => {
    const block = buildFramingCheckCoachingBlock(
      factWith({ addresses_goal: false, concern: LONG_CONCERN, suggested_reframe: REFRAME }),
      lookupWithGoals(1),
      CTX,
    )!;
    expect(block).not.toBeNull();
    expect(block.body).not.toContain('You framed this as');
    // The whole sentence, or nothing. A truncated framing sentence can invert
    // its own meaning, which is worse than no card.
    expect(block.body).toContain(LONG_CONCERN);
    expect(block.body.length).toBeLessThanOrEqual(300);
    // The goal survives as a linked ref even though its quote was dropped.
    expect(block.target_refs).toEqual([{ id: 'goal_0', label: GOAL_LABEL, kind: 'goal' }]);
  });

  it('RUNG 3 — drops the REFRAME next, keeping the challenge entire; the answer goes before the question', () => {
    // The reframe segment alone is ~150 chars here, so concern + reframe
    // overflows while the concern alone fits: the exact shape of the real
    // captured payload pinned in the group below.
    const block = buildFramingCheckCoachingBlock(
      factWith({
        addresses_goal: false,
        concern: LONG_CONCERN,
        suggested_reframe: `${REFRAME} and then re-run the comparison against that restated outcome`,
      }),
      lookupWithGoals(1),
      CTX,
    )!;
    expect(block, 'the card must survive on the concern alone').not.toBeNull();
    expect(block.body).toBe(LONG_CONCERN);
    expect(block.body).not.toContain('A different framing to weigh');
    // The chip still opens the conversation in which the reframe can be raised.
    expect(block.action_prompt).toBeDefined();
  });

  it('RUNG 4 — drops the block whole when even the concern alone cannot fit, rather than truncating it', () => {
    const block = buildFramingCheckCoachingBlock(
      factWith({
        addresses_goal: false,
        concern: `${LONG_CONCERN} ${LONG_CONCERN}`,
      }),
      lookupWithGoals(1),
      CTX,
    );
    expect(block).toBeNull();
  });
});

/**
 * ⭐ THE ONLY REAL `framing_check` THIS ESTATE HAS EVER CAPTURED.
 *
 * Provenance, inlined rather than read from disk so this record cannot be
 * broken by a report being regenerated or moved, and APPEND-ONLY thereafter:
 * `tools/orchestrator-eval/reports/decision-review-v16-2026-09-10/captures/`
 * `r1-05-constraint-infeasible.json`, `candidates[0].output.framing_check`,
 * captured 10 Sep 2026 from the v16 decision-review eval, case
 * `05-constraint-infeasible`.
 *
 * WHY IT IS HERE AND NOT JUST CITED. A corpus drawn from the author's head
 * cannot see the class the author did not imagine, and this payload proved that
 * twice over in ten minutes:
 *
 *   1. IT DOES NOT FIT. Its `concern` is 222 characters and its reframe segment
 *      150 — 373 against a 300 budget. A two-rung ladder (drop the goal, then
 *      give up) returned `null`, so the feature would have shipped DARK on its
 *      one known real input. Every self-authored fixture in this file fitted
 *      comfortably, because the author wrote them to.
 *   2. ITS PROSE READS AS LEADER-SAFE, AND THAT WAS MEASURED RATHER THAN
 *      ASSUMED. The sentence names an option ("the option this model points to
 *      on outcome grounds, Launch in March") on a CONSTRAINT-INFEASIBLE case —
 *      i.e. the withheld arm — which reads like exactly the prose the claim
 *      gate exists to catch. Run through the shared vocabulary it is FALSE on
 *      both `textAssertsLeadingOption` and the wider `textNamesLeadingOption`,
 *      and correctly so: the sentence EXPLAINS the withholding ("is barred by
 *      the stated constraint … the comparison as framed does not resolve the
 *      actual decision") rather than asserting a recommendation. Reading it and
 *      concluding otherwise would have been a false claim about somebody else's
 *      predicate; the wiring suite pins the gate's behaviour on this payload.
 */
const REAL_CAPTURE_2026_09_10 = {
  addresses_goal: false,
  concern:
    'The option this model points to on outcome grounds, Launch in March, is barred by the stated constraint that shipping cannot happen before the audit closes, so the comparison as framed does not resolve the actual decision.',
  suggested_reframe:
    'Reframe around the audit completion date itself, then compare launch timing options that are feasible given that date.',
} as const;

describe('T11 — the real captured payload (outside the author’s head)', () => {
  it('its measurements are what this group claims (precondition, pinned so the record cannot rot)', () => {
    expect(REAL_CAPTURE_2026_09_10.concern.length).toBe(222);
    expect(
      `A different framing to weigh: “${REAL_CAPTURE_2026_09_10.suggested_reframe}”`.length,
    ).toBe(150);
  });

  it('SHIPS — and on the concern alone, because the full composition overflows the contract budget', () => {
    const block = buildFramingCheckCoachingBlock(
      factWith(REAL_CAPTURE_2026_09_10),
      lookupWithGoals(1),
      CTX,
    );
    expect(block, 'a two-rung ladder returned null here — the dark-ship this fixture exists to prevent')
      .not.toBeNull();
    expect(block!.body).toBe(REAL_CAPTURE_2026_09_10.concern);
    expect(block!.body.length).toBeLessThanOrEqual(300);
  });

  it('keeps the model’s sentence WHOLE — not one character of it is cut', () => {
    const block = buildFramingCheckCoachingBlock(
      factWith(REAL_CAPTURE_2026_09_10),
      lookupWithGoals(1),
      CTX,
    )!;
    expect(block.body.endsWith('does not resolve the actual decision.')).toBe(true);
    expect(block.body).not.toContain('…');
  });

  it('still validates at the egress authority', () => {
    const block = buildFramingCheckCoachingBlock(
      factWith(REAL_CAPTURE_2026_09_10),
      lookupWithGoals(1),
      CTX,
    )!;
    expect(CoachingBlockSchema.safeParse(block).success).toBe(true);
  });
});

describe('T10 — absence, with its contrast in the same run', () => {
  it('no framing_check key ⇒ null, while the same fact WITH the key emits', () => {
    const lookup = lookupWithGoals(1);
    expect(buildFramingCheckCoachingBlock(factWith(null, false), lookup, CTX)).toBeNull();
    expect(buildFramingCheckCoachingBlock(factWith(FULL_FRAMING), lookup, CTX)).not.toBeNull();
  });

  it('a wrong-typed framing_check ⇒ null (performShapeCheck only WARNS on it, so it reaches here)', () => {
    expect(
      buildFramingCheckCoachingBlock(factWith('your framing is weak'), lookupWithGoals(1), CTX),
    ).toBeNull();
  });

  it('no decision_review at all ⇒ null', () => {
    const fact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: { scenario_id: 's', summary: '', graph_hash_at_run: GRAPH_HASH, enrichment: {} },
    } as unknown as RunAnalysisHandlerFact;
    expect(buildFramingCheckCoachingBlock(fact, lookupWithGoals(1), CTX)).toBeNull();
  });
});
