/**
 * Capability layer — DSK exercise companions (slice 1).
 *
 * The two DSK-derived lenses each attach a structured ExerciseBlock the
 * contract already carries and the UI already renders (adapter + renderer
 * verified at DecisionGuideAI staging `dae8908f`: `counter_case` renders,
 * `exercise_kind` is a pass-through discriminator, ≥1 prose field required).
 *
 * Deterministic END TO END: the trigger decision is `selectLens` (zero LLM)
 * and the exercise prose is a fixed copy bank routed through the same
 * prose/schema gate as every other Phase-3 block. No producer content is
 * required, so — unlike the pre_mortem companion — these builders do not
 * depend on a surviving review card; they depend on the SELECTION identity
 * alone, plus the GraphNodeLookup for identity-bound target refs
 * (fail-closed to [] on lookup miss, never a fabricated label).
 *
 * One exercise per turn BY CONSTRUCTION: one lens per turn → one companion.
 * That is the UI pacing contract (phase3Pacing.ts reserves exactly ONE
 * default-expanded slot for the turn's exercise; a second would be buried).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExerciseBlockSchema } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../../utils/telemetry.js';
import {
  buildLensCompanionBlocks,
  buildLensSurface,
  type BlockBuildCtx,
  type GraphNodeLookup,
} from '../phase3-blocks.js';
import { selectLens } from '../lens-selector.js';
import {
  FORBIDDEN_HEADLINE_VOCABULARY_REGEX,
  RAW_DECIMAL_REGEX,
  ASSISTANT_TEXT_ID_REGEX,
} from '../../coaching/assistant-text-defences.js';

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-08-05T00:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

interface SinkEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}
let sink: SinkEvent[] = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => {
    sink.push({ event, data });
  });
});
afterEach(() => {
  setTestSink(null);
});

// ============================================================================
// Fixtures
// ============================================================================

/** Fires consider_opposite: decisive attested-stable leader, all else silent. */
function considerOppositeFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.75 }, { win_probability: 0.25 }],
        robustness: { level: 'high' },
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

/** Fires devils_advocacy under sensitivity displacement (see selector spec). */
function devilsAdvocacyFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_dom', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

const LOOKUP: GraphNodeLookup = new Map([
  ['opt_a', { id: 'opt_a', label: 'Option A', kind: 'option' as const }],
  ['fac_dom', { id: 'fac_dom', label: 'Market demand', kind: 'factor' as const }],
]);

const EMPTY_LOOKUP: GraphNodeLookup = new Map();

function selectionFor(fact: RunAnalysisHandlerFact, previous: 'sensitivity_flip_risk' | null) {
  const selection = selectLens(fact, { previousAnalysisLens: previous });
  expect(selection).not.toBeNull();
  return selection!;
}

// ============================================================================
// consider_opposite companion
// ============================================================================

describe('buildLensCompanionBlocks — consider_opposite exercise', () => {
  it('emits exactly one schema-valid consider_opposite exercise bound to the leading option', () => {
    const fact = considerOppositeFact();
    const selection = selectionFor(fact, null);
    expect(selection.lens).toBe('consider_opposite');

    const blocks = buildLensCompanionBlocks(fact, CTX, selection, [], LOOKUP);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;

    const parsed = ExerciseBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);

    // Identity-bound: the exact kind, never a value predicate.
    expect(block.exercise_kind).toBe('consider_opposite');
    // The producer prose channel the live UI renders for this kind.
    expect(typeof block.counter_case).toBe('string');
    expect(block.counter_case!.length).toBeGreaterThan(0);
    // Identity-bound subject: the leading option, resolved through the
    // shared lookup — id AND label AND kind, exactly.
    expect(block.target_refs).toEqual([{ id: 'opt_a', label: 'Option A', kind: 'option' }]);

    // The emitted KEY SET is pinned exactly — a builder inventing any field
    // (numeric or prose) REDs here.
    expect(Object.keys(block).sort()).toEqual(
      [
        'block_id',
        'counter_case',
        'created_at',
        'exercise_kind',
        'freshness',
        'graph_hash_at_generation',
        'signal_id',
        'source_handler',
        'target_refs',
        'type',
      ].sort(),
    );
  });

  it('fails CLOSED to an empty target_refs on lookup miss — never a fabricated label', () => {
    const fact = considerOppositeFact();
    const selection = selectionFor(fact, null);
    const blocks = buildLensCompanionBlocks(fact, CTX, selection, [], EMPTY_LOOKUP);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.target_refs).toEqual([]);
    // Still renderable: the UI requires ≥1 prose field, not refs.
    expect(blocks[0]!.counter_case!.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// devils_advocacy companion
// ============================================================================

describe('buildLensCompanionBlocks — devils_advocacy exercise', () => {
  it('emits exactly one schema-valid devils_advocacy exercise bound to the dominant factor', () => {
    const fact = devilsAdvocacyFact();
    const selection = selectionFor(fact, 'sensitivity_flip_risk');
    expect(selection.lens).toBe('devils_advocacy');

    const blocks = buildLensCompanionBlocks(fact, CTX, selection, [], LOOKUP);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;

    expect(ExerciseBlockSchema.safeParse(block).success).toBe(true);
    expect(block.exercise_kind).toBe('devils_advocacy');
    expect(typeof block.counter_case).toBe('string');
    expect(block.counter_case!.length).toBeGreaterThan(0);
    // Identity-bound subject: the dominating factor the selection named.
    expect(block.target_refs).toEqual([
      { id: 'fac_dom', label: 'Market demand', kind: 'factor' },
    ]);
  });

  it('fails CLOSED to empty target_refs when the subject factor is not in the lookup', () => {
    const fact = devilsAdvocacyFact();
    const selection = selectionFor(fact, 'sensitivity_flip_risk');
    const blocks = buildLensCompanionBlocks(fact, CTX, selection, [], EMPTY_LOOKUP);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.target_refs).toEqual([]);
  });
});

// ============================================================================
// Copy bank — the exercise prose is deterministic and gate-clean
// ============================================================================

describe('DSK exercise copy — clean against the assistant-text defences', () => {
  it('both counter_case copies pass the forbidden-vocabulary / decimal / id defences', () => {
    const co = buildLensCompanionBlocks(
      considerOppositeFact(),
      CTX,
      selectionFor(considerOppositeFact(), null),
      [],
      LOOKUP,
    )[0]!;
    const da = buildLensCompanionBlocks(
      devilsAdvocacyFact(),
      CTX,
      selectionFor(devilsAdvocacyFact(), 'sensitivity_flip_risk'),
      [],
      LOOKUP,
    )[0]!;
    for (const copy of [co.counter_case!, da.counter_case!]) {
      expect(copy).not.toMatch(FORBIDDEN_HEADLINE_VOCABULARY_REGEX);
      expect(copy).not.toMatch(RAW_DECIMAL_REGEX);
      expect(copy).not.toMatch(ASSISTANT_TEXT_ID_REGEX);
    }
    // The two kinds carry DIFFERENT instructions — a copy-paste of one bank
    // into the other REDs here.
    expect(co.counter_case).not.toBe(da.counter_case);
  });
});

// ============================================================================
// Telemetry provenance — the DSK ids ride the suggestion event
// ============================================================================

describe('lens suggestion telemetry — DSK provenance', () => {
  it('consider_opposite carries dsk_protocol_id DSK-P-003 / dsk_trigger_id DSK-TR-003', () => {
    const surface = buildLensSurface(considerOppositeFact(), CTX, null);
    expect(surface).not.toBeNull();
    const events = sink.filter((e) => e.event === 'v5.capability.lens_suggestion_emitted');
    expect(events).toHaveLength(1);
    expect(events[0]!.data.lens_id).toBe('consider_opposite');
    expect(events[0]!.data.dsk_protocol_id).toBe('DSK-P-003');
    expect(events[0]!.data.dsk_trigger_id).toBe('DSK-TR-003');
  });

  it('devils_advocacy carries dsk_protocol_id DSK-P-005 / dsk_trigger_id DSK-TR-005', () => {
    const surface = buildLensSurface(devilsAdvocacyFact(), CTX, 'sensitivity_flip_risk');
    expect(surface).not.toBeNull();
    expect(surface!.selection.lens).toBe('devils_advocacy');
    const events = sink.filter((e) => e.event === 'v5.capability.lens_suggestion_emitted');
    expect(events).toHaveLength(1);
    expect(events[0]!.data.dsk_protocol_id).toBe('DSK-P-005');
    expect(events[0]!.data.dsk_trigger_id).toBe('DSK-TR-005');
  });

  it('a non-DSK lens carries NO dsk keys (absence is the honest default)', () => {
    // The devils fixture WITHOUT displacement selects sensitivity_flip_risk.
    const surface = buildLensSurface(devilsAdvocacyFact(), CTX, null);
    expect(surface).not.toBeNull();
    expect(surface!.selection.lens).toBe('sensitivity_flip_risk');
    const events = sink.filter((e) => e.event === 'v5.capability.lens_suggestion_emitted');
    expect(events).toHaveLength(1);
    expect('dsk_protocol_id' in events[0]!.data).toBe(false);
    expect('dsk_trigger_id' in events[0]!.data).toBe(false);
  });
});
