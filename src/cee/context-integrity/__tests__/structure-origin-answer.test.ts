/**
 * ⭐⭐ THE PROVENANCE CHALLENGE IS A FOURTH QUESTION — RED-first spec.
 *
 * Live journey witness, 18 Aug 2026 (`MODEL-COMPILER-JOURNEY-WITNESS-2026-08-18.md`,
 * turn 2, deployed CEE `585f8dce`): the user challenged an option Olumi had
 * invented and received a canned deflection with `llm_calls: 0` from
 * `state-query-guard.ts` `NO_RECENT_CHANGES_TEXT`. The reasoning layer never saw
 * the words.
 *
 * ⚠ EVERY MESSAGE IN THE PRIMARY CORPUS IS VERBATIM FROM THAT WITNESS OR FROM ITS
 * EXECUTED CONTRAST TABLE — not composed here (trap 22 / P7: a corpus from the
 * author's head cannot see the class the author did not imagine).
 *
 * ⚠⚠ AND EVERY GRAPH FIXTURE IS THE **PERSISTED V3 SHAPE**, WHICH IS THE WHOLE
 * POINT OF ROUND 3. Round 1 and round 2 both carried records-dict fixtures
 * (`provenance: { provenance_class, basis, unbased }`), a PRE-BOUNDARY artefact
 * that the persisted graph cannot contain — so a green suite certified an arm
 * that could never fire (trap 16-inverse: a fixture you wrote yourself is not
 * evidence about the wire). The shape here is derived from the PRODUCER, not
 * invented: `schema-v3.ts:1136-1146` sets a string `provenance` and lifts
 * `source_quote` / `label_authored` to node level; `schemas/cee-v3.ts:208-237`
 * declares all three fields. `RED-DICT` pins the consequence so the old shape
 * can never certify this module again.
 *
 * Opposite-direction twins are mandatory here (trap 22b): a fix that stops the
 * guard deflecting is indistinguishable from a fix that disables the guard unless
 * the readback class is shown STILL CLAIMED in the same run.
 */
import { describe, expect, it } from 'vitest';

import { bindingEarnsBriefClaim } from '../../provenance/brief-binding.js';
import { NodeV3 } from '../../../schemas/cee-v3.js';
import { isAnalyticalQuestion } from '../../../orchestrator-v5/routing/analytical-question-guard.js';
import {
  isStructureOriginQuestion,
  tryStructureOriginAnswer,
} from '../structure-origin-answer.js';

// ── The witness's model, real labels, PERSISTED provenance strings ───────────
// Note the built-in ambiguity: FOUR elements carry the token "hybrid". A
// resolver that binds by a value predicate another object could satisfy
// (trap 19) will pick the wrong one.
//
// Shapes derived from the producer (`schema-v3.ts:1136-1171`):
//   ai_inferred, no source_quote      -> Olumi's own structure
//   from_brief + source_quote         -> stated AND brief-verified
//   from_brief, NO source_quote       -> option label bound to the brief
//   ai_inferred + source_quote        -> stated but brief-UNVERIFIED (ambiguous)
//   provenance absent                 -> nothing was established
const WITNESS_GRAPH = {
  nodes: [
    {
      id: '939d4630',
      kind: 'option',
      label: 'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
      provenance: 'ai_inferred',
    },
    {
      id: '4abad64d',
      kind: 'option',
      label: 'double down on enterprise sales (higher margins but longer cycles and more headcount)',
      provenance: 'from_brief',
      source_quote:
        'double down on enterprise sales (higher margins but longer cycles and more headcount)',
    },
    {
      id: 'e755ec33',
      kind: 'option',
      label:
        'invest heavily in a self-serve product (lower CAC but requires significant engineering spend upfront)',
      provenance: 'from_brief',
      source_quote:
        'invest heavily in a self-serve product (lower CAC but requires significant engineering spend upfront)',
    },
    {
      id: 'e5dc21d6',
      kind: 'option',
      label: 'Continue Current Mix (Status Quo)',
      provenance: 'ai_inferred',
      is_baseline: true,
    },
    { id: '4d3256b4', kind: 'factor', label: 'Sales Headcount - Hybrid Maintained', provenance: 'ai_inferred' },
    { id: 'e53e6665', kind: 'factor', label: 'Customer Acquisition Cost - Hybrid', provenance: 'ai_inferred' },
    { id: '9061009e', kind: 'factor', label: 'Engineering Spend (Upfront Capex) - Hybrid', provenance: 'ai_inferred' },
    {
      id: '666659b7',
      kind: 'goal',
      label: 'Cut Burn Rate by 30%',
      provenance: 'from_brief',
      source_quote: 'cutting our burn rate by 30%',
      label_authored: true,
    },
    // The projector's structural scaffold reaches persistence as a plain
    // ai_inferred node: the enum has no `projector_structural` member
    // (`schemas/cee-v3.ts:208`), so we may not claim one.
    { id: 'd24307c3', kind: 'decision', label: 'Decision', provenance: 'ai_inferred' },
    // Nothing was established about this one. It must not acquire an origin.
    { id: '24931e51', kind: 'factor', label: 'NHS Data Regulation Outcome' },
  ],
  edges: [],
};

/** The witness's turn 2, VERBATIM. */
const WITNESS_TURN_2 =
  'Why did you add a hybrid phased option? I never mentioned one — where did that come from?';

describe('isStructureOriginQuestion — the origin-seeking frame', () => {
  // Verbatim from the witness's executed contrast table.
  const ORIGIN = [
    WITNESS_TURN_2,
    'Why is there a hybrid phased option in my model?',
    'What is the hybrid phased option based on?',
    'Why did you add a hybrid phased option?',
    'Where did the hybrid phased option come from?',
  ];
  for (const message of ORIGIN) {
    it(`RED-1 classifies as an origin question: ${JSON.stringify(message)}`, () => {
      expect(isStructureOriginQuestion(message)).toBe(true);
    });
  }

  // ⭐ OPPOSITE-DIRECTION TWIN (trap 22b). These are the READBACK class the
  // guard legitimately owns. If any of these classified as origin questions the
  // fix would be a blanket disable wearing a new name.
  const READBACK = [
    'Did you add the cost constraint?',
    'What changed?',
    'What did you just change?',
    'did you update it?',
    'where did it go?',
    "I can't see it",
    'show me what you added',
    'What update did you make?',
  ];
  for (const message of READBACK) {
    it(`RED-2 TWIN does NOT classify as an origin question: ${JSON.stringify(message)}`, () => {
      expect(isStructureOriginQuestion(message)).toBe(false);
    });
  }

  // ⚠ THE COMPOUND BAIL-OUT IS NOT THIS PREDICATE'S SEAM, and saying so here is
  // the honest placement. `isStructureOriginQuestion` answers exactly one
  // question — "is this message seeking the ORIGIN of something?" — and a
  // compound turn genuinely is. Declining the compound is the GUARD's job, via
  // the `FRESH_EDIT_BAIL_OUT_PATTERNS` it already owns and applies to every
  // arm; that behaviour is pinned by TWIN-5 in
  // `orchestrator-v5/routing/__tests__/state-query-guard.structure-origin.test.ts`.
  // Duplicating the bail-out here would be a second authority for one fact
  // (trap 21), and a copy of it would be a hand-maintained mirror (trap 12).
  it('RED-3 the frame predicate classifies by SPEECH ACT only; the compound bail-out is the guard seam', () => {
    expect(
      isStructureOriginQuestion('Why did you add a hybrid option? Add another option for partnerships.'),
    ).toBe(true);
  });
});

describe('tryStructureOriginAnswer — grounded in the persisted provenance record', () => {
  it('RED-4 THE WITNESSED DEFECT: turn 2 verbatim gets a provenance answer, not a deflection', () => {
    const answer = tryStructureOriginAnswer(WITNESS_TURN_2, WITNESS_GRAPH);
    expect(answer).not.toBeNull();
    // Bound BY IDENTITY to the element asked about (trap 19) — the label of
    // node 939d4630, not merely "some text mentioning hybrid".
    expect(answer).toContain('Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)');
    // It must say the structure is OLUMI'S, which is the honest answer and the
    // thing the user actually asked.
    expect(answer!.toLowerCase()).toContain('my suggestion');
    // And it must NOT claim a memory it does not have.
    expect(answer!.toLowerCase()).not.toContain('i added');
  });

  // ⚠ ROUND 1 ASSERTED THE OPPOSITE HERE, AND THAT IS THE POINT. It required the
  // answer to name the basis ("working from what you said about …"), which it
  // could only do because its fixture was pre-boundary. `basis` and `unbased` do
  // not exist in the persisted shape, so naming one would be an invention.
  it('RED-5 P5: no basis clause is offered on the persisted shape, because there is no basis to read', () => {
    const answer = tryStructureOriginAnswer(WITNESS_TURN_2, WITNESS_GRAPH);
    expect(answer).not.toBeNull();
    expect(answer!.toLowerCase()).not.toContain('working from what you said');
    expect(answer!.toLowerCase()).not.toContain('based it on');
    // …and it must not fabricate the opposite either (an unestablished absence).
    expect(answer!.toLowerCase()).not.toContain('anything specific');
    // The sibling options it was in fact built on are NOT named, because the
    // persisted graph does not record that they were.
    expect(answer).not.toContain('double down on enterprise sales');
  });

  it('RED-6 a STATED element quotes the user back verbatim from source_quote', () => {
    const answer = tryStructureOriginAnswer(
      'Why is the goal Cut Burn Rate by 30%? Where did that come from?',
      WITNESS_GRAPH,
    );
    expect(answer).not.toBeNull();
    expect(answer).toContain('cutting our burn rate by 30%');
    expect(answer!.toLowerCase()).toContain('your brief');
  });

  it('RED-7 an ai_inferred element with no quote is attributed to Olumi, and claims nothing further', () => {
    const answer = tryStructureOriginAnswer(
      'Why did you add Continue Current Mix? Where did that come from?',
      WITNESS_GRAPH,
    );
    expect(answer).not.toBeNull();
    expect(answer!.toLowerCase()).toContain('my suggestion');
    expect(answer!.toLowerCase()).not.toContain('based it on');
    expect(answer!.toLowerCase()).not.toContain('anything specific');
  });

  it('RED-8 AMBIGUOUS reference declines rather than guessing (trap 22f)', () => {
    // "hybrid" alone matches FOUR elements. Guessing one would be trap 19.
    expect(tryStructureOriginAnswer('Why did you add all the hybrid stuff?', WITNESS_GRAPH)).toBeNull();
  });

  it('RED-9 an UNRESOLVABLE reference declines — never a canned deflection', () => {
    expect(
      tryStructureOriginAnswer('Why did you add a marketing budget line?', WITNESS_GRAPH),
    ).toBeNull();
  });

  it('RED-10 an element with NO provenance record declines rather than guessing', () => {
    // NHS Data Regulation Outcome carries no provenance — the witness recorded
    // it as the honestly-unknown factor. We must not invent an origin for it.
    expect(
      tryStructureOriginAnswer(
        'Why is there an NHS Data Regulation Outcome factor?',
        WITNESS_GRAPH,
      ),
    ).toBeNull();
  });

  it('RED-11 a degraded/absent graph declines — never asserts a reassuring origin', () => {
    expect(tryStructureOriginAnswer(WITNESS_TURN_2, null)).toBeNull();
    expect(tryStructureOriginAnswer(WITNESS_TURN_2, {})).toBeNull();
  });

  /**
   * ⭐⭐ RED-DICT — THE STRUCTURAL CLOSE OF THE REVIEW BLOCK.
   *
   * This is the fixture shape that rounds 1 and 2 used to certify the module.
   * `transformNodeToV3` (`schema-v3.ts:222`) rebuilds every node field-by-field
   * and never names `provenance`, and every later assignment to
   * `v3Node.provenance` is a STRING (`:538`, `:554`, `:1136`, `:1165`, `:1171`)
   * — so an object-shaped provenance CANNOT reach this module's only call site
   * (`state-query-guard.ts:417` <- `context.persistedGraph` <- `scenarios.graph`).
   *
   * The module therefore DECLINES on it rather than carrying a second reader for
   * a seam the product does not have. Without this pin, a future lane could
   * re-add a dict branch, write dict fixtures, watch them go green, and ship
   * another dark arm — which is exactly what happened twice.
   */
  it('RED-DICT a PRE-BOUNDARY records-dict provenance DECLINES; it can never certify this arm again', () => {
    const preBoundary = {
      nodes: [
        {
          id: 'x1',
          kind: 'option',
          label: 'Partnership Channel Expansion',
          provenance: {
            provenance_class: 'ai_inferred',
            basis: ['ghost1', 'ghost2'],
            unbased: false,
          },
        },
      ],
      edges: [],
    };
    expect(
      tryStructureOriginAnswer('Why did you add Partnership Channel Expansion?', preBoundary),
    ).toBeNull();

    // ⭐ POSITIVE CONTROL, in the same run: the identical question against the
    // identical label in the PERSISTED shape IS answered. Without this the
    // assertion above would also pass if the resolver were simply broken.
    const persisted = {
      nodes: [
        { id: 'x1', kind: 'option', label: 'Partnership Channel Expansion', provenance: 'ai_inferred' },
      ],
      edges: [],
    };
    const answer = tryStructureOriginAnswer('Why did you add Partnership Channel Expansion?', persisted);
    expect(answer).not.toBeNull();
    expect(answer).toContain('Partnership Channel Expansion');
  });

  it('RED-DICT-2 a stated+verified records-dict node also DECLINES (the shape, not the class, is what is refused)', () => {
    const preBoundary = {
      nodes: [
        {
          id: 'g1',
          kind: 'goal',
          label: 'Revenue Growth Rate',
          provenance: {
            provenance_class: 'stated',
            source_quote: 'Revenue is 10 million pounds',
            brief_binding: 'verified',
          },
        },
      ],
      edges: [],
    };
    expect(tryStructureOriginAnswer('Why did you add Revenue Growth Rate?', preBoundary)).toBeNull();
  });
});

// ============================================================================
// ⭐⭐ THE PERSISTED SHAPE — THE ONLY ONE THAT FIRES LIVE
// ============================================================================
// Round 1's entire corpus used the RECORDS-dict shape, which
// `transformResponseToV3`'s `projectNodeProvenance` collapses before persistence:
// node provenance becomes the STRING enum "from_brief" | "ai_inferred" | "user_set",
// while `source_quote` and `label_authored` are lifted to NODE level and `basis` /
// `unbased` are dropped. Round 1 therefore certified a pre-boundary fixture and the
// arm was DARK on every real graph (trap 16-inverse). These cases pin the shape the
// guard actually receives from `context.persistedGraph`.
const PERSISTED_GRAPH = {
  nodes: [
    // Olumi's own invention: ai_inferred with NO source_quote.
    { id: '939d4630', kind: 'option', label: 'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)', provenance: 'ai_inferred' },
    // The user's own words, brief-VERIFIED (that is what from_brief means).
    { id: '4abad64d', kind: 'option', label: 'double down on enterprise sales (higher margins but longer cycles)', provenance: 'from_brief', source_quote: 'double down on enterprise sales (higher margins but longer cycles)' },
    // Authored label + verified quote.
    { id: '666659b7', kind: 'goal', label: 'Cut Burn Rate by 30%', provenance: 'from_brief', source_quote: 'cutting our burn rate by 30%', label_authored: true },
    // ⚠ THE AMBIGUOUS CLASS: the user stated it, but the brief check could not
    // confirm it, so the enum reads ai_inferred WHILE a source_quote survives.
    { id: 'aa11bb22', kind: 'factor', label: 'Regulatory Approval Timeline', provenance: 'ai_inferred', source_quote: 'approval might take a while' },
    // The user set this directly.
    { id: 'cc33dd44', kind: 'factor', label: 'Marketing Spend Ceiling', provenance: 'user_set' },
  ],
  edges: [],
};

describe('PERSISTED V3 shape — the live path', () => {
  it('RED-13 THE DARK-ARM DEFECT: the witness turn is answered on a PERSISTED graph', () => {
    const answer = tryStructureOriginAnswer(WITNESS_TURN_2, PERSISTED_GRAPH);
    expect(answer).not.toBeNull();
    expect(answer).toContain('Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)');
    expect(answer!.toLowerCase()).toContain('my suggestion');
    // `basis` does not exist in this shape, so no basis clause may be offered.
    expect(answer!.toLowerCase()).not.toContain('working from what you said');
  });

  it('RED-14 from_brief quotes the user back (the binding gate is already inside the enum)', () => {
    const answer = tryStructureOriginAnswer(
      'Why is the goal Cut Burn Rate by 30% in my model? Where did that come from?',
      PERSISTED_GRAPH,
    );
    expect(answer).not.toBeNull();
    expect(answer).toContain('cutting our burn rate by 30%');
    expect(answer!.toLowerCase()).toContain('your brief');
    // (c) the producer warrants only that the label DIFFERS from the quote.
    expect(answer!.toLowerCase()).not.toContain('shortened');
  });

  it('RED-15 user_set is attributed to the user, not to Olumi', () => {
    const answer = tryStructureOriginAnswer(
      'Why did you add a Marketing Spend Ceiling?',
      PERSISTED_GRAPH,
    );
    expect(answer).not.toBeNull();
    expect(answer!.toLowerCase()).toContain('you set it yourself');
    expect(answer!.toLowerCase()).not.toContain('my suggestion');
  });

  it('RED-16 P5: ai_inferred WITH a source_quote is the unverified-stated class and DECLINES', () => {
    // Claiming "my suggestion" would deny the user's own words; claiming "your
    // brief" would contradict the wire badge. Neither is safe, so say nothing.
    expect(
      tryStructureOriginAnswer('Why did you add a Regulatory Approval Timeline?', PERSISTED_GRAPH),
    ).toBeNull();
  });

  it('RED-17 an unrecognised enum value declines rather than guessing', () => {
    const graph = { nodes: [{ id: 'z', kind: 'option', label: 'Some Option', provenance: 'future_value' }], edges: [] };
    expect(tryStructureOriginAnswer('Why did you add Some Option?', graph)).toBeNull();
  });
});

// ============================================================================
// ⭐⭐ THE WITHDRAWN CLAIM — an origin frame must not swallow ANALYSIS questions
// ============================================================================
describe('a question about BEHAVIOUR is not a question about ORIGIN', () => {
  // Verbatim from the adversarial review, reproduced by execution before the fix:
  // all three received confident provenance answers with llm_calls: 0.
  const ANALYSIS_QUESTIONS = [
    'Why is the hybrid option scoring highest in the analysis?',
    'Why would the hybrid approach fail?',
    'Why does the burn rate goal matter so much?',
    'Why is the burn rate goal so important to the result?',
    'Why did the hybrid option win?',
  ];
  for (const message of ANALYSIS_QUESTIONS) {
    it(`RED-18 declines the analysis question: ${JSON.stringify(message)}`, () => {
      expect(isStructureOriginQuestion(message)).toBe(false);
      expect(tryStructureOriginAnswer(message, PERSISTED_GRAPH)).toBeNull();
      expect(tryStructureOriginAnswer(message, WITNESS_GRAPH)).toBeNull();
    });
  }

  /**
   * ⭐⭐ RED-26 — THE CLASS `CREATION_VERBS` EXISTS TO EXCLUDE, WHICH NOTHING
   * PINNED UNTIL NOW.
   *
   * Found by asking what would have to be true for the guard to pass while the
   * property fails (trap 13b). Answer: remove the creation predicate from the
   * first frame pattern and NOTHING in the corpus goes red — the five RED-18
   * analysis questions are all excluded by other conjuncts, so they cannot
   * measure it. A mutant deleting `CREATION_VERBS` would have SURVIVED, and a
   * survivor is a claim either way.
   *
   * The corpus below is derived from the predicate's DECLARED purpose rather
   * than from an observed distribution (P7): the module's own comment states
   * "the question must be about how the element came to BE in the model, not
   * about what it does. Verbs of behaviour, ranking, importance and consequence
   * are absent by construction." These are questions about Olumi's REASONING or
   * OPINION — the reasoning layer's work, not the router's. Answering any of
   * them with a statement about where the node came from is the guard
   * substituting its own task for the user's, which is the whole defect class.
   */
  const OPINION_QUESTIONS = [
    'Why do you think the hybrid option is best?',
    'Why did you say the hybrid option was risky?',
    'Why would you recommend the hybrid option?',
    'Why does it matter that the hybrid option exists?',
    'Why did you rank the hybrid option first?',
    'Why do you keep talking about the hybrid option?',
  ];
  for (const message of OPINION_QUESTIONS) {
    it(`RED-26 declines the opinion/reasoning question: ${JSON.stringify(message)}`, () => {
      expect(isStructureOriginQuestion(message)).toBe(false);
      expect(tryStructureOriginAnswer(message, PERSISTED_GRAPH)).toBeNull();
    });
  }

  // ⭐ ORIGIN TWINS — the same subject, asked about ORIGIN. These must still be
  // claimed, or the narrowing would be a blanket disable of the arm.
  const ORIGIN_TWINS: readonly [string, string][] = [
    ['Why did you add the hybrid option?', 'Hybrid Phased Approach'],
    ['Why is there a hybrid phased option?', 'Hybrid Phased Approach'],
    ['Where did the hybrid phased option come from?', 'Hybrid Phased Approach'],
  ];
  for (const [message, expected] of ORIGIN_TWINS) {
    it(`RED-19 TWIN still claims the origin question: ${JSON.stringify(message)}`, () => {
      expect(isStructureOriginQuestion(message)).toBe(true);
      const answer = tryStructureOriginAnswer(message, PERSISTED_GRAPH);
      expect(answer).not.toBeNull();
      expect(answer).toContain(expected);
    });
  }
});

// ============================================================================
// ⭐⭐ THE AUTHORSHIP GATE IS THE PRODUCER'S, NOT OURS — pinned by DERIVATION
// ============================================================================
// Round 1 re-decided the brief claim itself, keying on `provenance_class ===
// 'stated'` alone, and so emitted "came from your brief. You wrote: …" for
// records the brief does NOT support (22% of stated records on the reference
// capture) — putting the chat reply in direct contradiction with the canvas
// badge on the same node.
//
// The fix is not a better local rule. It is to INHERIT the producer's verdict:
// `"from_brief"` is *defined* at `schema-v3.ts:1136` as `provenance_class ===
// 'stated' && brief_binding === 'verified'`, and at `:1165`/`:1171` as
// `bindingEarnsBriefClaim(...)`. These tests pin that dependency so a widening
// of the producer's gate REDs here rather than silently widening our claim
// (trap 12: derive, do not mirror).
describe('the brief claim is inherited from the producer, never re-decided here', () => {
  it('RED-20 the producer gate we depend on still means what we read it to mean', () => {
    // If `bindingEarnsBriefClaim` ever admits another verdict, our
    // "came from your brief" sentence silently widens with it. Fail loud.
    expect(bindingEarnsBriefClaim('verified')).toBe(true);
    expect(bindingEarnsBriefClaim('unverified')).toBe(false);
    expect(bindingEarnsBriefClaim('unchecked')).toBe(false);
  });

  it('RED-21 DERIVED: every provenance value the producer DECLARES is handled, and only from_brief claims the brief', () => {
    // Derived from the V3 node contract itself, not from a hand-copied list.
    const enumSchema = (NodeV3.shape.provenance as unknown as { unwrap: () => { options: readonly string[] } }).unwrap();
    const declared = [...enumSchema.options];
    expect(declared.length).toBeGreaterThan(0);

    const claimsBrief: string[] = [];
    for (const value of declared) {
      const graph = {
        nodes: [{ id: 'n1', kind: 'option', label: 'Partnership Channel Expansion', provenance: value }],
        edges: [],
      };
      const answer = tryStructureOriginAnswer('Why did you add Partnership Channel Expansion?', graph);
      // Every DECLARED value must be handled — a declared value we return null
      // for is a gap in this module, not a safe decline.
      expect(answer, `declared provenance "${value}" produced no answer`).not.toBeNull();
      if (answer!.toLowerCase().includes('your brief')) claimsBrief.push(value);
    }
    expect(claimsBrief).toEqual(['from_brief']);
  });

  it('RED-22 an UNDECLARED enum value is never guessed at', () => {
    const graph = {
      nodes: [{ id: 'n1', kind: 'option', label: 'Partnership Channel Expansion', provenance: 'imported_from_csv' }],
      edges: [],
    };
    expect(tryStructureOriginAnswer('Why did you add Partnership Channel Expansion?', graph)).toBeNull();
  });

  /**
   * ⭐ RED-23 — the ambiguous class, restated at the PERSISTED shape.
   * A stated record whose brief check returned `unverified` reaches persistence
   * as `ai_inferred` WITH its `source_quote` intact (the quote is lifted at
   * `schema-v3.ts:1145`, outside the enum decision at `:1136`). Claiming "my
   * suggestion" would deny the user's own words; claiming "your brief" would
   * contradict the badge. Both are fabrications, so we say nothing.
   */
  it('RED-23 ai_inferred + a surviving source_quote is the unverified-stated class and DECLINES', () => {
    const graph = {
      nodes: [
        {
          id: 'g1',
          kind: 'goal',
          label: 'Revenue Growth Rate',
          provenance: 'ai_inferred',
          source_quote: 'Revenue is 10 million pounds',
        },
      ],
      edges: [],
    };
    expect(tryStructureOriginAnswer('Why did you add Revenue Growth Rate?', graph)).toBeNull();
  });

  /**
   * ⭐⭐ RED-27 — AN UNREADABLE QUOTE IS NOT AN ABSENT QUOTE.
   *
   * Found by P1, driving malformed input one seam past the guard. `source_quote`
   * arrives from a JSONB column typed `unknown`; a value that is not a non-empty
   * string fails the read, and round 2 keyed the ambiguity gate on the READ
   * rather than on the FIELD. So a degraded `ai_inferred` + `source_quote: 99`
   * node — the unverified-stated class, the user's own words — was answered
   * "was my suggestion, not something you wrote". That is the precise
   * fabrication RED-16/RED-23 exist to prevent, arriving through the one input
   * shape those tests did not carry.
   */
  const UNREADABLE_QUOTES: readonly [string, unknown][] = [
    ['a number', 99],
    ['an empty string', ''],
    ['an object', { text: 'we said this' }],
    ['an array', ['we said this']],
    ['explicit null', null],
  ];
  for (const [why, value] of UNREADABLE_QUOTES) {
    it(`RED-27 ai_inferred with ${why} for source_quote DECLINES (recorded, not readable, is the gate)`, () => {
      const graph = {
        nodes: [
          {
            id: 'g1',
            kind: 'factor',
            label: 'Regulatory Approval Timeline',
            provenance: 'ai_inferred',
            source_quote: value,
          },
        ],
        edges: [],
      };
      expect(
        tryStructureOriginAnswer('Why did you add a Regulatory Approval Timeline?', graph),
      ).toBeNull();
    });
  }

  it('RED-27-CONTROL with NO source_quote FIELD at all, the same node IS answered', () => {
    // The opposite-direction twin: without this, RED-27 would also pass if the
    // ai_inferred branch had simply been disabled.
    const graph = {
      nodes: [
        { id: 'g1', kind: 'factor', label: 'Regulatory Approval Timeline', provenance: 'ai_inferred' },
      ],
      edges: [],
    };
    const answer = tryStructureOriginAnswer('Why did you add a Regulatory Approval Timeline?', graph);
    expect(answer).not.toBeNull();
    expect(answer!.toLowerCase()).toContain('my suggestion');
  });

  /**
   * ⭐ RED-24 — the SECOND producer path into `from_brief`, previously untested.
   * `projectNodeProvenance` also awards `from_brief` to an OPTION whose LABEL
   * binds to the brief (`schema-v3.ts:1164-1167`, via `bindOptionLabelToBrief`).
   * Such a node carries NO `source_quote`. "Came from your brief, not from me"
   * is exactly the claim the wire badge makes for it, so it is honest — and the
   * `You wrote:` clause must simply be omitted rather than filled with anything.
   */
  it('RED-24 from_brief with NO source_quote claims the brief but quotes nothing', () => {
    const graph = {
      nodes: [
        { id: 'o1', kind: 'option', label: 'Partnership Channel Expansion', provenance: 'from_brief' },
      ],
      edges: [],
    };
    const answer = tryStructureOriginAnswer('Why did you add Partnership Channel Expansion?', graph);
    expect(answer).not.toBeNull();
    expect(answer!.toLowerCase()).toContain('your brief');
    expect(answer!.toLowerCase()).not.toContain('you wrote');
  });
});

// ============================================================================
// ⭐⭐ A REFUTED PRESCRIPTION, PINNED SO IT IS NOT RE-LITIGATED FROM PROSE
// ============================================================================
// The review prescribed reusing the estate's existing `isAnalyticalQuestion` as
// the negative gate for analysis questions, on the reasonable principle that we
// should not own a second predicate. MEASURED at this tip, it is constant-FALSE
// over this seam's entire input class — it fires on neither the analysis
// questions it was prescribed for nor the origin questions it might have
// harmed, because it is anchored on ANALYTICAL_OUTCOME_NOUNS in
// "what could change the …" constructions that this seam never sees.
//
// Adding it would therefore have been a guard that cannot fail (trap 13). The
// narrowing that DOES close the defect is `CREATION_VERBS` in conjunct 1, and
// RED-18/RED-19 measure it in both directions.
//
// This test is the honest record of that refutation: if `isAnalyticalQuestion`
// is ever widened to cover these, it REDs and the decision is revisited with
// evidence rather than inherited from a comment.
describe('the prescribed isAnalyticalQuestion gate: measured, refuted, pinned', () => {
  it('RED-25 isAnalyticalQuestion does not fire on ANY message at this seam (so it could not be the gate)', () => {
    const seamCorpus = [
      // the three RED cases the gate was prescribed for
      'Why is the hybrid option scoring highest in the analysis?',
      'Why would the hybrid approach fail?',
      'Why does the burn rate goal matter so much?',
      // origin questions it must not have suppressed
      'Why did you add a hybrid phased option?',
      'What is the leading option based on?',
      'Where did the ranking come from?',
    ];
    expect(seamCorpus.filter((m) => isAnalyticalQuestion(m))).toEqual([]);

    // ⭐ POSITIVE CONTROL — the import is live and the predicate CAN fire.
    // Without this, the assertion above would pass on a broken import
    // (trap 13: an absence claim needs a demonstrated presence).
    expect(isAnalyticalQuestion('What could change the outcome?')).toBe(true);
  });
});
