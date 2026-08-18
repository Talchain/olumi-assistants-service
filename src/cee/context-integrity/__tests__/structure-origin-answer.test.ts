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
