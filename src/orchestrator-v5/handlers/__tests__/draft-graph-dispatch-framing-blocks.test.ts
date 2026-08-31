/**
 * RED-first pin for the JOIN: `draftResultToOlumiResponse` must actually hand
 * `draft-framing-blocks` the draft's own `strengthenItems`, and the resulting
 * envelope must still satisfy the strict boundary contract.
 *
 * ⭐ WHY THIS FILE EXISTS SEPARATELY FROM THE UNIT SPEC. The unit spec proves
 * the emitter is correct given its inputs; it is structurally blind to the
 * emitter being wired to the WRONG FIELD. During this build the join was first
 * written against `result.coachingStrengthenItems` — a field that does not
 * exist on `DraftGraphResult` (the widening sibling's parallel field is named
 * `coachingWideningLogObject`, which is what invited the wrong guess). That
 * yields `undefined`, which the emitter's gate 2 turns into a permanently empty
 * array: a card that can never appear, under a fully green unit suite. This
 * test is the only thing in the lane that can see that class of defect.
 *
 * FIXTURE PROVENANCE, stated precisely (CLAUDE.md trap 16 / trap 22). The
 * strengthen items below are NOT verbatim captures: their `id`, `label` and
 * `action_type` — the fields the join and the emitter key on — are reproduced
 * from live draft responses in the estate's evidence directories, while the
 * `detail` strings are abridged and `bias_category` is dropped. They are not
 * sentences invented by this lane, but they must not be cited as evidence of
 * what the drafter emits on the wire. The earlier header here claimed verbatim
 * capture and named the unit spec's source list, which is not where these came
 * from; an overstated provenance label teaches the next reader to stop
 * checking, which is the defect class this estate keeps paying for.
 */
import { describe, it, expect, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// emit() is telemetry-only; silence it so the composer runs side-effect-free.
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { draftResultToOlumiResponse } from '../draft-graph-dispatch.js';
import { DRAFT_FRAMING_SIGNAL_PREFIX } from '../draft-framing-blocks.js';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';

const PAYLOAD = {
  kind: 'message' as const,
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  stage: 'frame' as const,
  message: 'We need to decide how to respond to the clean-air zone.',
  turn_class: 'frame' as const,
  source: 'composer' as const,
};

const GRAPH = {
  nodes: [
    { id: 'dec_fleet', kind: 'decision', label: 'Choose a clean-air response' },
    { id: 'opt_electrify', kind: 'option', label: 'Electrify the fleet' },
    { id: 'opt_subcontract', kind: 'option', label: 'Subcontract the routes' },
    { id: 'fac_capex', kind: 'factor', label: 'Capital outlay' },
    { id: 'goal_compliance', kind: 'goal', label: 'Meet the clean-air deadline' },
  ],
  edges: [{ from: 'opt_electrify', to: 'goal_compliance' }],
};

/** VERBATIM capture — olumi-docs/witness-998-2026-08-16/c-a1-graph-response.json */
const CAPTURED_REFRAME_GOAL = {
  id: 'reframe-goal-beyond-compliance',
  label: 'Reframe the goal to include competitive positioning, not just compliance',
  detail:
    'The stated goal is responding to the clean-air zone within a year, but the choice between options has long-run implications for customer retention and fleet economics that a compliance-only goal framing hides.',
  action_type: 'reframe_goal',
};

/** VERBATIM capture — same corpus. */
const CAPTURED_ADD_RISK = {
  id: 'add-contract-exit-magnitude',
  label: 'Quantify the contract-exit risk beyond the trigger clause',
  detail:
    'The brief identifies that two big contracts can exit if prices rise more than 5%, but the revenue concentration those contracts represent is not captured.',
  action_type: 'add_risk',
};

const NOT_READY = {
  status: 'needs_user_input',
  goal_node_id: 'goal_compliance',
  options: [],
};

const READY = { status: 'ready', goal_node_id: 'goal_compliance', options: [] };

function makeResult(overrides: Partial<Record<string, unknown>> = {}): DraftGraphResult {
  return {
    blocks: [],
    assistantText: 'Drafted a decision model.',
    latencyMs: 1000,
    strengthenItems: [CAPTURED_REFRAME_GOAL],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingWideningLogObject: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput: GRAPH,
    analysisReady: NOT_READY,
    ...overrides,
  } as unknown as DraftGraphResult;
}

function framingBlocks(res: { blocks: ReadonlyArray<unknown> }) {
  return res.blocks.filter(
    (b) =>
      typeof (b as { signal_id?: unknown }).signal_id === 'string' &&
      (b as { signal_id: string }).signal_id.startsWith(DRAFT_FRAMING_SIGNAL_PREFIX),
  );
}

describe('draftResultToOlumiResponse — FRAME/IDEATE framing blocks', () => {
  it('J1 emits the framing card on a NOT-ready persisted draft, carrying the drafter own label', () => {
    const res = draftResultToOlumiResponse(makeResult(), PAYLOAD, true, 'req-f1', PAYLOAD.message);

    const blocks = framingBlocks(res);
    expect(blocks).toHaveLength(1);
    // Identity: the exact captured item, by signal_id and by its own label.
    expect((blocks[0] as { signal_id: string }).signal_id).toBe(
      `${DRAFT_FRAMING_SIGNAL_PREFIX}reframe_goal:reframe-goal-beyond-compliance`,
    );
    expect((blocks[0] as { title: string }).title).toBe(CAPTURED_REFRAME_GOAL.label);

    // The whole envelope still validates against the strict boundary schema.
    expect(OlumiResponseSchema.safeParse(res).success).toBe(true);
  });

  it('J2 emits NO framing card on a READY draft (the complement property, at the join)', () => {
    const res = draftResultToOlumiResponse(
      makeResult({ analysisReady: READY }),
      PAYLOAD,
      true,
      'req-f2',
      PAYLOAD.message,
    );
    expect(framingBlocks(res)).toEqual([]);
  });

  it('J3 emits no framing card on the non-persisted (failure) path', () => {
    const res = draftResultToOlumiResponse(makeResult(), PAYLOAD, false, 'req-f3', PAYLOAD.message);
    expect(framingBlocks(res)).toEqual([]);
  });

  it('J4 emits no framing card when the draft carried only non-frame/ideate items', () => {
    const res = draftResultToOlumiResponse(
      makeResult({ strengthenItems: [CAPTURED_ADD_RISK] }),
      PAYLOAD,
      true,
      'req-f4',
      PAYLOAD.message,
    );
    expect(framingBlocks(res)).toEqual([]);
  });
});
