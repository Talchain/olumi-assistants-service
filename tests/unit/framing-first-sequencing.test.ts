/**
 * FRAMING BEFORE THE RUN NUDGE — the class-b sequencing pins.
 *
 * Every assertion here binds by IDENTITY (the named statement, the named chip
 * id, the block INDEX of a named sentence), never by a count or a value
 * predicate another object could satisfy (platform trap 19).
 *
 * The suite is deliberately BOTH-DIRECTIONAL in the same run (platform trap
 * 13e): the cause-disagreement graph must fire the signal AND the
 * decision-shaped graph must not, so a probe that had gone blind could not
 * produce this pair of answers.
 */
import { describe, it, expect } from 'vitest';

import {
  FRAMING_CHIP_ROW_CAP,
  hasOptionFactorLabelMirror,
  NEXT_STEP_BLOCK_PREFIX,
  normaliseNodeLabelKey,
  optionLabelsMirroringFactorLabels,
  POST_DRAFT_DISPLACEABLE_CHIP_IDS,
  type FramingSignalNode,
  promoteFramingAboveNextStep,
  promoteFramingChips,
} from '../../src/orchestrator-v5/clarify-v2/framing-first-sequencing.js';
import { buildPostDraftChips } from '../../src/orchestrator-v5/handlers/draft-graph-dispatch.js';
import { projectReadinessRecovery } from '../../src/orchestrator-v5/coaching/readiness-recovery.js';
import {
  composeDraftFirstDisclosure,
  composeDraftFirstFramingChips,
} from '../../src/orchestrator-v5/clarify-v2/preflight.js';
import { composeClarifyQuestions } from '../../src/orchestrator-v5/clarify-v2/questions.js';
import {
  decisionFreeCountsFromNodes,
  isDecisionFreeShape,
} from '../../src/validators/decision-free-shape.js';
import type { GraphV3T } from '../../src/orchestrator/types.js';

/**
 * THE CLASS-B GRAPH — the measured shape, not an invented one. The brief is a
 * disagreement about causes; the drafter turned each competing EXPLANATION into
 * BOTH an option and a factor, which is what makes the option -> factor effect
 * cells tautological.
 */
const CAUSE_DISAGREEMENT_NODES = [
  { id: 'goal_1', kind: 'goal', label: 'Improve retention' },
  { id: 'opt_1', kind: 'option', label: 'The Product Has Fallen Behind' },
  { id: 'opt_2', kind: 'option', label: 'Onboarding Is Failing New Users' },
  { id: 'opt_3', kind: 'option', label: 'We Are Selling To The Wrong Customers' },
  { id: 'fac_1', kind: 'factor', label: 'The Product Has Fallen Behind' },
  { id: 'fac_2', kind: 'factor', label: 'Onboarding Is Failing New Users' },
  { id: 'fac_3', kind: 'factor', label: 'Product Competitiveness' },
];

/**
 * THE CONTROL — a genuinely decision-shaped brief ("should we build or buy").
 * Named, mutually-exclusive options; factors that describe consequences rather
 * than restating the options. Note `Build in-house` against `Build cost`: a
 * CONTAINMENT match would fire here, which is exactly why the discriminator is
 * exact-after-normalisation.
 */
const DECISION_SHAPED_NODES = [
  { id: 'goal_1', kind: 'goal', label: 'Ship the billing platform' },
  { id: 'opt_1', kind: 'option', label: 'Build in-house' },
  { id: 'opt_2', kind: 'option', label: 'Buy off the shelf' },
  { id: 'fac_1', kind: 'factor', label: 'Build cost' },
  { id: 'fac_2', kind: 'factor', label: 'Time to market' },
  { id: 'fac_3', kind: 'factor', label: 'Vendor lock-in risk' },
];

describe('the mechanical discriminator — an option label that mirrors a factor label', () => {
  it('BOTH DIRECTIONS IN ONE RUN: the cause-disagreement graph fires and names its statements; the decision-shaped graph does not', () => {
    // Bound by IDENTITY: the exact statements the drafter duplicated, in
    // option order — not a count, and not "at least one".
    expect(optionLabelsMirroringFactorLabels(CAUSE_DISAGREEMENT_NODES)).toEqual([
      'product has fallen behind',
      'onboarding is failing new users',
    ]);
    expect(hasOptionFactorLabelMirror(CAUSE_DISAGREEMENT_NODES)).toBe(true);

    // THE CONTRAST CONTROL, same run: absence is only evidence when a
    // same-family positive fires alongside it.
    expect(optionLabelsMirroringFactorLabels(DECISION_SHAPED_NODES)).toEqual([]);
    expect(hasOptionFactorLabelMirror(DECISION_SHAPED_NODES)).toBe(false);
  });

  it('an option whose label merely CONTAINS a factor label does not fire', () => {
    expect(
      hasOptionFactorLabelMirror([
        { id: 'o1', kind: 'option', label: 'Build in-house' },
        { id: 'f1', kind: 'factor', label: 'Build' },
      ]),
    ).toBe(false);
  });

  it('an option and a factor of the same kind never mirror each other', () => {
    // Two options sharing a label is the options-dedup concern, not this one.
    expect(
      hasOptionFactorLabelMirror([
        { id: 'o1', kind: 'option', label: 'Delay' },
        { id: 'o2', kind: 'option', label: 'Delay' },
      ]),
    ).toBe(false);
    expect(
      hasOptionFactorLabelMirror([
        { id: 'f1', kind: 'factor', label: 'Churn' },
        { id: 'f2', kind: 'factor', label: 'Churn' },
      ]),
    ).toBe(false);
  });

  it('normalisation is mechanical: case, whitespace, quotes, trailing punctuation, one leading article', () => {
    expect(normaliseNodeLabelKey('  The   Product Has Fallen Behind.  ')).toBe(
      'product has fallen behind',
    );
    expect(normaliseNodeLabelKey('“Onboarding Is Failing”')).toBe('onboarding is failing');
    expect(normaliseNodeLabelKey('')).toBeNull();
    expect(normaliseNodeLabelKey('   ')).toBeNull();
    expect(normaliseNodeLabelKey(undefined)).toBeNull();
    expect(normaliseNodeLabelKey(42)).toBeNull();
  });

  /**
   * WHY THIS IS NOT `validators/decision-free-shape.ts`, DEMONSTRATED RATHER
   * THAN ARGUED. Reusing the single existing authority was checked first and
   * preferred; it does not fit, and this is the measurement that settles it.
   *
   * `isDecisionFreeShape` is `decisions === 0 && options === 0` — the
   * deliberate exploratory map. Class-b is the OPPOSITE shape: the drafter
   * MINTED options the user never posed. It reads FALSE on exactly the graph
   * this lane exists to catch, so it cannot gate this promotion.
   */
  it('CHECKED FIRST: isDecisionFreeShape does not fit — it is false on the very graph class-b produces', () => {
    const counts = decisionFreeCountsFromNodes(CAUSE_DISAGREEMENT_NODES);
    expect(counts.optionCount).toBe(3);
    expect(isDecisionFreeShape(counts)).toBe(false);
    // The signal this lane needs fires on the same graph — the two predicates
    // answer different questions and are named apart (platform trap 21).
    expect(hasOptionFactorLabelMirror(CAUSE_DISAGREEMENT_NODES)).toBe(true);

    // POSITIVE CONTROL: the predicate is not simply always-false — it is TRUE
    // on the class it was built for, so the reading above is a real
    // discrimination and not a blind instrument.
    expect(isDecisionFreeShape(decisionFreeCountsFromNodes([
      { id: 'f1', kind: 'factor', label: 'Retention' },
      { id: 'f2', kind: 'factor', label: 'Onboarding quality' },
    ]))).toBe(true);
  });

  /**
   * ⚠ THE 500. `dg.graph` is typed `GraphV3T | null`, and route-v2's long-
   * standing guard is `dg.graph !== null` — which is TRUE for `undefined`. The
   * previous code never dereferenced the graph, so nothing noticed; the first
   * version of this lane read `dg.graph.nodes` behind that guard and threw a
   * TypeError on every decision-shaped draft whose dispatcher result carried no
   * `graph` key, turning the positive control in
   * `route-v2-process-meta-intake.test.ts` from 200 into 500.
   *
   * Caught by CI, NOT by this lane's own blast-radius sample — which had the
   * file in front of it and did not run it. The predicate must therefore be
   * total over a missing node list, and say so here.
   */
  it('REGRESSION: a missing or undefined node list is read as NO NODES, never thrown on', () => {
    expect(() => hasOptionFactorLabelMirror(undefined as never)).toThrow();
    // The call site's shape — `graph?.nodes ?? []` — must be total.
    const noGraph: { nodes?: readonly FramingSignalNode[] } | undefined = undefined;
    expect(hasOptionFactorLabelMirror(noGraph?.nodes ?? [])).toBe(false);
    const graphWithoutNodes: { nodes?: readonly FramingSignalNode[] } = {};
    expect(hasOptionFactorLabelMirror(graphWithoutNodes?.nodes ?? [])).toBe(false);
  });

  it('an empty or label-free graph cannot fire it', () => {
    expect(hasOptionFactorLabelMirror([])).toBe(false);
    expect(
      hasOptionFactorLabelMirror([
        { id: 'o1', kind: 'option' },
        { id: 'f1', kind: 'factor' },
      ]),
    ).toBe(false);
  });
});

/**
 * THE DERIVED GUARD ON THE MIRRORED PREFIX. `promoteFramingAboveNextStep`
 * locates the run nudge by its opening. That is a mirror of another module's
 * copy, so it is pinned against the PRODUCER rather than described in a
 * comment: every branch of `projectReadinessRecovery` is driven and its
 * sentence checked. A future branch that stops saying "Next, " REDs here
 * instead of silently mis-placing the framing block.
 */
describe('every readiness next-step sentence opens with the prefix the splice locates', () => {
  const BRANCH_INPUTS: ReadonlyArray<{
    readonly name: string;
    readonly analysisReady: unknown;
    readonly nodes: ReadonlyArray<{ id?: string; kind?: string; label?: string }>;
  }> = [
    { name: 'run', analysisReady: { status: 'ready' }, nodes: [] },
    { name: 'resolve_model_issue', analysisReady: { status: 'blocked' }, nodes: [] },
    {
      name: 'map_option (labelled)',
      analysisReady: {
        status: 'needs_user_mapping',
        options: [{ id: 'o1', status: 'needs_user_mapping', label: 'Build in-house' }],
      },
      nodes: [{ id: 'o1', kind: 'option', label: 'Build in-house' }],
    },
    { name: 'map_option (no label)', analysisReady: { status: 'needs_user_mapping' }, nodes: [] },
    {
      name: 'encode_option (labelled)',
      analysisReady: {
        status: 'needs_encoding',
        options: [{ id: 'o1', status: 'needs_encoding', label: 'Build in-house' }],
      },
      nodes: [{ id: 'o1', kind: 'option', label: 'Build in-house' }],
    },
    { name: 'encode_option (no label)', analysisReady: { status: 'needs_encoding' }, nodes: [] },
    {
      name: 'provide_value',
      analysisReady: {
        status: 'needs_user_input',
        blockers: [
          {
            blocker_type: 'missing_value',
            option_id: 'o1',
            option_label: 'Build in-house',
            factor_id: 'f1',
            factor_label: 'Build cost',
          },
        ],
      },
      nodes: [
        { id: 'o1', kind: 'option', label: 'Build in-house' },
        { id: 'f1', kind: 'factor', label: 'Build cost' },
      ],
    },
    {
      name: 'confirm_value',
      analysisReady: {
        status: 'needs_user_input',
        blockers: [
          {
            blocker_type: 'ambiguous_value',
            option_id: 'o1',
            option_label: 'Build in-house',
            factor_id: 'f1',
            factor_label: 'Build cost',
          },
        ],
      },
      nodes: [
        { id: 'o1', kind: 'option', label: 'Build in-house' },
        { id: 'f1', kind: 'factor', label: 'Build cost' },
      ],
    },
    {
      name: 'connect_option',
      analysisReady: {
        status: 'needs_user_input',
        blockers: [
          {
            blocker_type: 'missing_connection',
            option_id: 'o1',
            option_label: 'Build in-house',
            factor_id: 'f1',
            factor_label: 'Build cost',
          },
        ],
      },
      nodes: [
        { id: 'o1', kind: 'option', label: 'Build in-house' },
        { id: 'f1', kind: 'factor', label: 'Build cost' },
      ],
    },
    {
      name: 'review_constraint',
      analysisReady: {
        status: 'needs_user_input',
        blockers: [{ blocker_type: 'constraint_dropped' }],
      },
      nodes: [],
    },
    { name: 'configure_option (no label)', analysisReady: { status: 'needs_user_input' }, nodes: [] },
    { name: 'review_model', analysisReady: { status: 'something_else' }, nodes: [] },
    { name: 'review_model (null payload)', analysisReady: null, nodes: [] },
  ];

  it('covers every declared ReadinessRecoveryKind and every sentence starts with the prefix', () => {
    const kinds = new Set<string>();
    for (const branch of BRANCH_INPUTS) {
      const projection = projectReadinessRecovery(
        branch.analysisReady as never,
        branch.nodes as never,
      );
      kinds.add(projection.kind);
      expect(
        projection.nextStep.startsWith(NEXT_STEP_BLOCK_PREFIX),
        `${branch.name} → ${projection.nextStep}`,
      ).toBe(true);
    }
    // COMPLETENESS, not just agreement: the ten declared kinds, all reached.
    expect([...kinds].sort()).toEqual(
      [
        'confirm_value',
        'configure_option',
        'connect_option',
        'encode_option',
        'map_option',
        'provide_value',
        'resolve_model_issue',
        'review_constraint',
        'review_model',
        'run',
      ].sort(),
    );
  });
});

/** The narrative shape the product actually ships, from the live reply corpus. */
const LIVE_NARRATIVE = [
  'I’ve built a first decision model for "retention is slipping".',
  'Options compared\n• The Product Has Fallen Behind\n• Onboarding Is Failing New Users',
  'What the model is weighing\n• Main trade-off: Product Competitiveness balanced against Onboarding Quality',
  'Next, run the analysis to see how the options compare and what could shift the outcome.',
].join('\n\n');

const DISCLOSURE = composeDraftFirstDisclosure(
  composeClarifyQuestions(['goal', 'options', 'timeframe'], 3),
);

describe('sequencing — the framing questions lead, the run nudge is subordinated but never removed', () => {
  it('splices the disclosure ABOVE the run nudge, and the run nudge still ships', () => {
    const promoted = promoteFramingAboveNextStep(LIVE_NARRATIVE, DISCLOSURE);
    const blocks = promoted.split('\n\n');
    const framingIndex = blocks.findIndex((b) => b.includes('things to check'));
    const nudgeIndex = blocks.findIndex((b) => b.startsWith(NEXT_STEP_BLOCK_PREFIX));

    expect(framingIndex).toBeGreaterThanOrEqual(0);
    expect(nudgeIndex).toBeGreaterThanOrEqual(0);
    // THE WHOLE POINT: framing first, nudge after.
    expect(framingIndex).toBeLessThan(nudgeIndex);
    // NOT BLOCKED — the run nudge survives verbatim.
    expect(promoted).toContain(
      'Next, run the analysis to see how the options compare and what could shift the outcome.',
    );
    // And the framing questions themselves are intact, verbatim.
    expect(promoted).toContain('What outcome would make this decision a success?');
    expect(promoted).toContain('What alternatives are you weighing this against?');
  });

  it('nothing is lost: every block of the original narrative survives, once', () => {
    const promoted = promoteFramingAboveNextStep(LIVE_NARRATIVE, DISCLOSURE);
    for (const block of LIVE_NARRATIVE.split('\n\n')) {
      expect(promoted.split(block).length - 1).toBe(1);
    }
  });

  it('FAIL-SAFE: with no run-nudge block the disclosure is APPENDED, byte-identical to the old behaviour', () => {
    const noNudge = 'I’ve built a first decision model.\n\nOptions compared\n• A\n• B';
    expect(promoteFramingAboveNextStep(noNudge, DISCLOSURE)).toBe(`${noNudge}\n\n${DISCLOSURE}`);
  });

  it('locates the LAST run-nudge block when an earlier block happens to open the same way', () => {
    const text = ['Next, a red herring block.', 'Middle.', 'Next, run the analysis.'].join('\n\n');
    const blocks = promoteFramingAboveNextStep(text, DISCLOSURE).split('\n\n');
    expect(blocks[blocks.length - 1]).toBe('Next, run the analysis.');
    expect(blocks[blocks.length - 2]).toBe(DISCLOSURE);
  });
});

describe('the framing questions ride as actionable chips, and no affordance is displaced', () => {
  const framing = composeDraftFirstFramingChips(
    composeClarifyQuestions(['goal', 'options', 'timeframe'], 3),
  );

  it('the displaceable set agrees with what buildPostDraftChips actually emits, in BOTH directions', () => {
    const readyRow = buildPostDraftChips({
      graphPersisted: true,
      analysisReadyField: { status: 'ready' } as never,
      graph: null,
    });
    const emittedIds = new Set(readyRow.map((c) => c.id));
    // Every id we are prepared to displace is genuinely emitted (no dead entry).
    for (const id of POST_DRAFT_DISPLACEABLE_CHIP_IDS) {
      expect(emittedIds.has(id), `displaceable id not emitted: ${id}`).toBe(true);
    }
    // And nothing carrying an affordance is in the set.
    for (const chip of readyRow) {
      if (chip.action_type !== undefined) {
        expect(POST_DRAFT_DISPLACEABLE_CHIP_IDS.has(chip.id)).toBe(false);
      }
    }
    // The executable run chip exists on this row — so the assertion above is
    // not vacuously true over a row with no affordances (trap 13).
    expect(readyRow.some((c) => c.action_type === 'run_analysis')).toBe(true);
  });

  it('READY ROW: framing chips lead, the run-analysis chip SURVIVES, the row stays capped', () => {
    const existing = buildPostDraftChips({
      graphPersisted: true,
      analysisReadyField: { status: 'ready' } as never,
      graph: null,
    });
    const row = promoteFramingChips({
      existing,
      framing,
      displaceableChipIds: POST_DRAFT_DISPLACEABLE_CHIP_IDS,
    });
    expect(row).toHaveLength(FRAMING_CHIP_ROW_CAP);
    // Bound by identity, not by position-count: the named executable chip.
    expect(row.some((c) => c.id === 'chip_action_run_analysis')).toBe(true);
    // The two generic conversation starters gave up their slots.
    expect(row.some((c) => POST_DRAFT_DISPLACEABLE_CHIP_IDS.has(c.id))).toBe(false);
    // Framing chips lead the row.
    expect(row[0]!.id).toBe('cv2_goal_revenue');
    expect(row[1]!.id).toBe('cv2_options_nothing');
    expect(row[2]!.id).toBe('chip_action_run_analysis');
  });

  it('NON-READY ROW: the readiness recovery chip is NOT displaceable and survives', () => {
    const recovery = { id: 'chip_prompt_configure_option', label: 'Set the effect', message: 'Set it.' };
    const row = promoteFramingChips({
      existing: [recovery],
      framing,
      displaceableChipIds: POST_DRAFT_DISPLACEABLE_CHIP_IDS,
    });
    expect(row).toHaveLength(FRAMING_CHIP_ROW_CAP);
    expect(row.some((c) => c.id === 'chip_prompt_configure_option')).toBe(true);
    expect(row[0]!.id).toBe('cv2_goal_revenue');
    expect(row[1]!.id).toBe('cv2_options_nothing');
  });

  it('a full row of affordances is never overrun by framing chips', () => {
    const full = [
      { id: 'a', label: 'A', message: 'a' },
      { id: 'b', label: 'B', message: 'b' },
      { id: 'c', label: 'C', message: 'c' },
    ];
    const row = promoteFramingChips({
      existing: full,
      framing,
      displaceableChipIds: POST_DRAFT_DISPLACEABLE_CHIP_IDS,
    });
    expect(row.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('the framing chips are the SAME candidates the blocking clarify round already offers', () => {
    expect(framing.map((c) => c.id)).toEqual([
      'cv2_goal_revenue',
      'cv2_options_nothing',
      'cv2_timeframe_quarter',
    ]);
    for (const chip of framing) {
      expect(chip.message.length).toBeGreaterThan(0);
      expect(chip.action_type).toBeUndefined();
    }
  });
});

describe('the two classes, end to end over the composed reply', () => {
  /** What route-v2 does at the splice, in the two directions. */
  function composeDraftReply(nodes: GraphV3T['nodes']): string {
    return hasOptionFactorLabelMirror(nodes)
      ? promoteFramingAboveNextStep(LIVE_NARRATIVE, DISCLOSURE)
      : `${LIVE_NARRATIVE.trimEnd()}\n\n${DISCLOSURE}`;
  }

  it('cause-disagreement: framing first. decision-shaped: UNCHANGED, byte-identical to the pre-change append', () => {
    const classB = composeDraftReply(CAUSE_DISAGREEMENT_NODES as never);
    const classBBlocks = classB.split('\n\n');
    expect(classBBlocks.findIndex((b) => b.includes('things to check'))).toBeLessThan(
      classBBlocks.findIndex((b) => b.startsWith(NEXT_STEP_BLOCK_PREFIX)),
    );

    // THE UNCHANGED DIRECTION — asserted as a byte equality against the exact
    // expression this change replaced, so a regression cannot hide in
    // whitespace.
    const shaped = composeDraftReply(DECISION_SHAPED_NODES as never);
    expect(shaped).toBe(`${LIVE_NARRATIVE.trimEnd()}\n\n${DISCLOSURE}`);
    const shapedBlocks = shaped.split('\n\n');
    expect(shapedBlocks[shapedBlocks.length - 1]).toBe(DISCLOSURE);
    expect(shapedBlocks[shapedBlocks.length - 2]).toBe(
      'Next, run the analysis to see how the options compare and what could shift the outcome.',
    );
  });
});
