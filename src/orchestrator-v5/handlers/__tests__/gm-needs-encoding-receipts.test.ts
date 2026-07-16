/**
 * ROADMAP 2.11 / P1-3 — needs-encoding honesty on the add-option consent
 * flow, both sides:
 *
 *   HOLD side (edit-graph-referee-gate): the consent ask for a batch that
 *   ADDS an intervention-less option must disclose that analysis will stay
 *   blocked after apply — the user learns AT ADD TIME, not two turns later
 *   from a recovery chip (the live A2→A4 sequence in the 2.11 diagnosis).
 *
 *   APPLY side (gm-held-execute receipt builders): the applied receipt must
 *   not advise "Run the analysis again" when the applied graph carries
 *   unconfigured options (PLoT preflight would 422-block it), and the chip
 *   must be the SHARED configure chip (which routes deterministically to
 *   the edit lane) instead of nothing.
 */
import { describe, it, expect } from 'vitest';

import {
  evaluateEditGraphMutations,
  buildNeedsEncodingAddNotice,
} from '../edit-graph-referee-gate.js';
import {
  buildGmHeldAppliedReceipt,
  buildGmHeldAppliedChips,
  buildUnconfiguredOptionsNotice,
  deriveUnconfiguredOptionLabels,
  GM_HELD_APPLIED_RERUN_CHIP,
} from '../gm-held-execute.js';
import { buildConfigureOptionChip } from '../../configure-option-chip-text.js';
import { detectConfigureOptionIntent } from '../../routing/configure-option-intent.js';

// ---------------------------------------------------------------------------
// Fixtures — the A2 held batch (add option + edges, no interventions).
// ---------------------------------------------------------------------------

const CURRENT_GRAPH = {
  nodes: [
    { id: 'dec_eu', kind: 'decision', label: 'EU Expansion' },
    { id: 'opt_berlin', kind: 'option', label: 'Open Berlin Office' },
    {
      id: 'fac_setup_cost',
      kind: 'factor',
      label: 'Setup Cost',
      observed_state: { value: 0.4, raw_value: 1000000, unit: '£', cap: 2500000 },
    },
    { id: 'goal_growth', kind: 'goal', label: 'EU Revenue Growth' },
  ],
  edges: [
    { from: 'dec_eu', to: 'opt_berlin', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_berlin', to: 'fac_setup_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_setup_cost', to: 'goal_growth', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
  ],
};

/** The live A2 shape: add an option with NO interventions + its edges. */
const ADD_OPTION_NO_INTERVENTIONS_OPS = [
  {
    op: 'add_node',
    path: 'opt_acquire',
    value: { id: 'opt_acquire', kind: 'option', label: 'Acquire Small German Competitor' },
  },
  {
    op: 'add_edge',
    path: 'dec_eu::opt_acquire',
    value: { from: 'dec_eu', to: 'opt_acquire', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  },
  {
    op: 'add_edge',
    path: 'opt_acquire::fac_setup_cost',
    value: { from: 'opt_acquire', to: 'fac_setup_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  },
];

/** Control: the same add but WITH a requested intervention. */
const ADD_OPTION_WITH_INTERVENTIONS_OPS = [
  {
    op: 'add_node',
    path: 'opt_acquire',
    value: {
      id: 'opt_acquire',
      kind: 'option',
      label: 'Acquire Small German Competitor',
      interventions: { fac_setup_cost: { value: 0.8, source: 'user_specified' } },
    },
  },
];

describe('HOLD side — buildNeedsEncodingAddNotice', () => {
  it('discloses for an intervention-less option add', () => {
    const notice = buildNeedsEncodingAddNotice(ADD_OPTION_NO_INTERVENTIONS_OPS, CURRENT_GRAPH);
    expect(notice).not.toBeNull();
    expect(notice).toContain("'Acquire Small German Competitor'");
    expect(notice).toContain('no effect values yet');
    expect(notice).toContain('blocked');
  });

  it('stays silent when the add requests interventions (copy byte-identical)', () => {
    expect(
      buildNeedsEncodingAddNotice(ADD_OPTION_WITH_INTERVENTIONS_OPS, CURRENT_GRAPH),
    ).toBeNull();
  });

  it('stays silent for non-option batches', () => {
    expect(
      buildNeedsEncodingAddNotice(
        [{ op: 'add_node', path: 'fac_x', value: { id: 'fac_x', kind: 'factor', label: 'X' } }],
        CURRENT_GRAPH,
      ),
    ).toBeNull();
  });

  it('the LIVE hold decision carries the disclosure (evaluateEditGraphMutations)', () => {
    const decision = evaluateEditGraphMutations({
      mode: 'live',
      operations: ADD_OPTION_NO_INTERVENTIONS_OPS,
      currentGraph: CURRENT_GRAPH,
      currentGraphHash: 'hash-a',
      baseGraphHash: 'hash-a',
      freshness: 'fresh',
      scenarioId: 'scn-1',
      turnId: 'turn-1',
      requestId: 'req-1',
    });
    expect(decision.governing).toBe('held');
    expect(decision.blockApply).toBe(true);
    expect(decision.assistantText).toContain('no effect values yet');
    expect(decision.assistantText).toContain("'Acquire Small German Competitor'");
  });
});

describe('APPLY side — receipt + chips', () => {
  const READY = {
    status: 'ready',
    options: [
      { option_id: 'opt_berlin', label: 'Open Berlin Office', status: 'ready' },
      { option_id: 'opt_acquire', label: 'Acquire Small German Competitor', status: 'ready' },
    ],
  };
  const NEEDS_ENCODING = {
    status: 'needs_encoding',
    options: [
      { option_id: 'opt_berlin', label: 'Open Berlin Office', status: 'ready' },
      { option_id: 'opt_acquire', label: 'Acquire Small German Competitor', status: 'needs_encoding' },
    ],
  };

  it('ready apply: receipt unchanged, rerun chip offered', () => {
    const labels = deriveUnconfiguredOptionLabels(READY);
    expect(labels).toEqual([]);
    expect(buildGmHeldAppliedReceipt(["add 'X' and 2 more changes"], labels)).toBe(
      "Confirmed: add 'X' and 2 more changes. Run the analysis again when you are ready to see how it plays out.",
    );
    expect(buildGmHeldAppliedChips(READY)).toEqual([{ ...GM_HELD_APPLIED_RERUN_CHIP }]);
  });

  it('needs-encoding apply: receipt discloses, chip is the SHARED configure chip', () => {
    const labels = deriveUnconfiguredOptionLabels(NEEDS_ENCODING);
    expect(labels).toEqual(['Acquire Small German Competitor']);

    const receipt = buildGmHeldAppliedReceipt(["add 'Acquire Small German Competitor' and 4 more changes"], labels);
    expect(receipt).toContain('Confirmed:');
    expect(receipt).toContain("'Acquire Small German Competitor' does not have effect values yet");
    expect(receipt).toContain('the analysis cannot run until they are set');

    const chips = buildGmHeldAppliedChips(NEEDS_ENCODING);
    expect(chips).toEqual([buildConfigureOptionChip('Acquire Small German Competitor')]);
    // …and that chip provably routes into the deterministic edit-lane gate.
    expect(detectConfigureOptionIntent(chips[0]!.message, []).matched).toBe(true);
  });

  it('id-shaped labels never leak into the disclosure', () => {
    const labels = deriveUnconfiguredOptionLabels({
      status: 'needs_encoding',
      options: [{ option_id: 'opt_x', label: 'opt_acquire_2', status: 'needs_encoding' }],
    });
    expect(labels).toEqual([]);
    expect(buildUnconfiguredOptionsNotice(labels)).toBeNull();
  });

  it('multiple unconfigured options are counted, first is named', () => {
    const notice = buildUnconfiguredOptionsNotice(['Option A', 'Option B', 'Option C']);
    expect(notice).toContain("'Option A' and 2 more options");
  });
});
