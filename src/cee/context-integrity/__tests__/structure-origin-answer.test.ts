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
 * author's head cannot see the class the author did not imagine). The graph
 * fixture carries the witness's real labels and real provenance classes, and the
 * provenance RECORD SHAPE is taken from a governed capture
 * (`tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json`,
 * 238 node-level records), never invented.
 *
 * Opposite-direction twins are mandatory here (trap 22b): a fix that stops the
 * guard deflecting is indistinguishable from a fix that disables the guard unless
 * the readback class is shown STILL CLAIMED in the same run.
 */
import { describe, expect, it } from 'vitest';

import {
  isStructureOriginQuestion,
  tryStructureOriginAnswer,
} from '../structure-origin-answer.js';

// ── The witness's model, real labels + real provenance classes ────────────────
// Note the built-in ambiguity: FOUR elements carry the token "hybrid". A
// resolver that binds by a value predicate another object could satisfy
// (trap 19) will pick the wrong one.
const WITNESS_GRAPH = {
  nodes: [
    {
      id: '939d4630',
      kind: 'option',
      label: 'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
      provenance: { provenance_class: 'ai_inferred', basis: ['4abad64d', 'e755ec33'], unbased: false },
    },
    {
      id: '4abad64d',
      kind: 'option',
      label: 'double down on enterprise sales (higher margins but longer cycles and more headcount)',
      provenance: {
        provenance_class: 'stated',
        source_quote: 'double down on enterprise sales (higher margins but longer cycles and more headcount)',
        brief_binding: 'verified',
      },
    },
    {
      id: 'e755ec33',
      kind: 'option',
      label: 'invest heavily in a self-serve product (lower CAC but requires significant engineering spend upfront)',
      provenance: {
        provenance_class: 'stated',
        source_quote: 'invest heavily in a self-serve product (lower CAC but requires significant engineering spend upfront)',
        brief_binding: 'verified',
      },
    },
    {
      id: 'e5dc21d6',
      kind: 'option',
      label: 'Continue Current Mix (Status Quo)',
      provenance: { provenance_class: 'ai_inferred', basis: [], unbased: true },
      is_baseline: true,
    },
    { id: '4d3256b4', kind: 'factor', label: 'Sales Headcount - Hybrid Maintained', provenance: { provenance_class: 'ai_inferred', basis: [], unbased: true } },
    { id: 'e53e6665', kind: 'factor', label: 'Customer Acquisition Cost - Hybrid', provenance: { provenance_class: 'ai_inferred', basis: [], unbased: true } },
    { id: '9061009e', kind: 'factor', label: 'Engineering Spend (Upfront Capex) - Hybrid', provenance: { provenance_class: 'ai_inferred', basis: [], unbased: true } },
    {
      id: '666659b7',
      kind: 'goal',
      label: 'Cut Burn Rate by 30%',
      provenance: {
        provenance_class: 'stated',
        source_quote: 'cutting our burn rate by 30%',
        label_authored: true,
        brief_binding: 'verified',
      },
    },
    {
      id: 'd24307c3',
      kind: 'decision',
      label: 'Decision',
      provenance: { provenance_class: 'projector_structural', source: 'synthetic', quote: 'Decision-to-option scaffold minted by the projector' },
    },
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

  it('RED-5 an ai_inferred element with a resolvable basis names what it was built on', () => {
    const answer = tryStructureOriginAnswer(WITNESS_TURN_2, WITNESS_GRAPH);
    // basis ['4abad64d','e755ec33'] both resolve to nodes in this graph.
    expect(answer).toContain('double down on enterprise sales');
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

  it('RED-7 an UNBASED invention says so, and does not invent a basis', () => {
    const answer = tryStructureOriginAnswer(
      'Why did you add Continue Current Mix? Where did that come from?',
      WITNESS_GRAPH,
    );
    expect(answer).not.toBeNull();
    expect(answer!.toLowerCase()).toContain('my suggestion');
    expect(answer!.toLowerCase()).not.toContain('based it on');
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

  it('RED-12 P5: it never claims a basis it cannot resolve to a real element', () => {
    // 45% of real `basis` refs do not resolve to a node (measured on the
    // governed capture: 131 of 238). An unresolvable basis must be silent,
    // NOT reported as "based on nothing" — that would be a fabrication in the
    // opposite direction.
    const graph = {
      nodes: [
        {
          id: 'x1',
          kind: 'option',
          label: 'Partnership Channel Expansion',
          provenance: { provenance_class: 'ai_inferred', basis: ['ghost1', 'ghost2'], unbased: false },
        },
      ],
      edges: [],
    };
    const answer = tryStructureOriginAnswer('Why did you add Partnership Channel Expansion?', graph);
    expect(answer).not.toBeNull();
    expect(answer!.toLowerCase()).not.toContain('based it on');
    expect(answer).not.toContain('ghost1');
    // and it must not claim it was unbased either
    expect(answer!.toLowerCase()).not.toContain('anything specific');
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
// The binding gate on the records-dict branch (finding 2)
// ============================================================================
describe('records-dict branch gates authorship on the brief binding', () => {
  function statedWith(binding: string | undefined) {
    return {
      nodes: [
        {
          id: 'g1',
          kind: 'goal',
          label: 'Revenue Growth Rate',
          provenance: {
            provenance_class: 'stated',
            source_quote: 'Revenue is 10 million pounds',
            ...(binding === undefined ? {} : { brief_binding: binding }),
          },
        },
      ],
      edges: [],
    };
  }
  const Q = 'Why did you add Revenue Growth Rate?';

  it('RED-20 verified EARNS the brief claim', () => {
    const answer = tryStructureOriginAnswer(Q, statedWith('verified'));
    expect(answer).not.toBeNull();
    expect(answer!.toLowerCase()).toContain('your brief');
  });

  // ⚠ The producer: `unverified` means "the brief was available and does NOT
  // support it". 22% of stated records on the reference capture are unverified.
  it('RED-21 unverified must NOT claim the brief (it would contradict the wire badge)', () => {
    expect(tryStructureOriginAnswer(Q, statedWith('unverified'))).toBeNull();
  });

  it('RED-22 unchecked must NOT claim the brief', () => {
    expect(tryStructureOriginAnswer(Q, statedWith('unchecked'))).toBeNull();
  });

  it('RED-23 an ABSENT binding establishes nothing and must NOT claim the brief', () => {
    expect(tryStructureOriginAnswer(Q, statedWith(undefined))).toBeNull();
  });
});
