/**
 * ROADMAP 2.258 — CEE stamps the goal-threshold FRAME.
 *
 * WHY. The goal probability has never been meaningful. CEE mints
 * `goal_threshold` as an absolute LEVEL (a target divided by a cap); ISL's
 * goal samples are CHANGES FROM BASELINE. Nobody converted, so the engine
 * answered "P(change >= X)" for a user who asked "P(level >= X)" — a
 * STRUCTURAL ZERO, `status: computed`, on decisions whose options separate
 * cleanly. schemas 0.31.0 adds `goal_threshold_frame` so the mismatch fails
 * LOUD instead of silently computing the wrong question.
 *
 * WHAT THIS PINS. The frame is a CODE CONSTANT, not a derivation. CEE's mint
 * arithmetic is `raw / cap` — a LEVEL by construction — so `'level'` is true
 * of every path that arithmetic reaches, and there is exactly one constant to
 * change if that is ever ruled otherwise.
 *
 * The tests below are deliberately NOT a mirror of the source: each one runs a
 * REAL registration path end-to-end and reads the frame off the resulting
 * node, so a path that stops stamping goes red here rather than in review.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { GoalThresholdFrame } from '@talchain/schemas';

import { enrichGraphWithFactorsAsync } from '../enricher.js';
import type { GraphT } from '../../../schemas/graph.js';
import { CEE_GOAL_THRESHOLD_FRAME } from '../../../utils/goal-threshold-cap.js';
import { createAddConstraintHandler } from '../../../orchestrator-v5/tools/handlers/add-constraint.js';
import { buildD1Fixture } from '../../../orchestrator-v5/tools/handlers/d1-shared/__tests__/fixtures.js';
import type { HandlerInvocation } from '../../../orchestrator-v5/tools/registry.js';
import type { ProposalAction } from '../../../orchestrator-v5/routing/types.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function draftPathGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Revenue Goal' },
      { id: 'd1', kind: 'decision', label: 'Pricing decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

function buildChatInvocation(graph: GraphV3T, value: number, unit?: string): HandlerInvocation {
  const parameters: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
    { name: 'value', value, source: 'user_explicit' },
  ];
  if (unit !== undefined) {
    parameters.push({ name: 'unit', value: unit, source: 'user_explicit' });
  }
  const proposal: ProposalAction = {
    handler_id: 'add_constraint',
    entity: {
      id: 'g-revenue',
      kind: 'goal',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters,
    cited_context_fields: [],
  };
  return {
    context: {
      session_id: 'scn-frame',
      stage: 'frame',
      request_id: 'req-frame',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-frame',
      turn_id: 'turn-frame',
      stage: 'frame',
      message: `Set the success target to ${value}`,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-frame',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

describe('ROADMAP 2.258 — the goal-threshold frame is a CODE CONSTANT', () => {
  it("the constant is 'level', and it is a member of the schema's own enum", () => {
    expect(CEE_GOAL_THRESHOLD_FRAME).toBe('level');
    // Derived from the vendored contract, not restated: if 0.32.0 ever renames
    // or removes the member, this REDs instead of shipping an invalid frame.
    expect(GoalThresholdFrame.options).toContain(CEE_GOAL_THRESHOLD_FRAME);
    expect(GoalThresholdFrame.safeParse(CEE_GOAL_THRESHOLD_FRAME).success).toBe(true);
  });

  it("'level' is TRUE OF THE ARITHMETIC — the mint divides a raw target by a cap", async () => {
    // The frame claim is not a preference; it is a property of the minting
    // maths. This is the positive control for the constant: if the mint ever
    // stopped producing raw/cap, the frame would be a lie and this would red.
    const result = await enrichGraphWithFactorsAsync(draftPathGraph(), 'Our target is 800.');
    const goal = result.graph.nodes.find((n) => n.kind === 'goal');
    expect(goal?.goal_threshold_raw).toBe(800);
    expect(goal?.goal_threshold_cap).toBe(1000);
    expect(goal?.goal_threshold).toBeCloseTo(800 / 1000, 10);
  });
});

describe('ROADMAP 2.258 — every registration path stamps the frame', () => {
  it('DRAFT path (factor-extraction enricher) stamps the frame beside the threshold', async () => {
    const result = await enrichGraphWithFactorsAsync(draftPathGraph(), 'Our target is 800.');
    const goal = result.graph.nodes.find((n) => n.kind === 'goal');
    expect(goal?.goal_threshold).toBeDefined();
    expect(goal?.goal_threshold_frame).toBe('level');
  });

  it('CHAT path (add_constraint handler) stamps the frame beside the threshold', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(buildChatInvocation(buildD1Fixture(), 800));
    const goal = (outcome.mutated_graph as GraphV3T).nodes.find((n) => n.kind === 'goal');
    expect(goal?.goal_threshold).toBeDefined();
    expect(goal?.goal_threshold_frame).toBe('level');
  });

  it('BOTH paths agree on the frame (the cap-doctrine parity claim, extended)', async () => {
    const draft = await enrichGraphWithFactorsAsync(draftPathGraph(), 'Our target is 15%.');
    const draftGoal = draft.graph.nodes.find((n) => n.kind === 'goal');

    const handler = createAddConstraintHandler();
    const outcome = await handler(buildChatInvocation(buildD1Fixture(), 15, '%'));
    const chatGoal = (outcome.mutated_graph as GraphV3T).nodes.find((n) => n.kind === 'goal');

    expect(draftGoal?.goal_threshold_frame).toBe(chatGoal?.goal_threshold_frame);
    expect(draftGoal?.goal_threshold_frame).toBe('level');
  });
});

describe('ROADMAP 2.258 — the frame is NEVER LLM-derivable', () => {
  /**
   * The schema's own contract note: "This field is NEVER LLM-derivable and
   * must never be placed in a drafting prompt's output surface — the frame is
   * a property of the minting arithmetic, not of the user's phrasing, and an
   * LLM writing it would be guessing at exactly the seam this field exists to
   * make certain."
   *
   * DERIVED, NOT MIRRORED: this scans the real prompt and LLM-boundary files at
   * the tip under test. `-a`-equivalent reads (readFileSync) are used so a
   * NUL-bearing source file cannot make the scan silently blind (CLAUDE.md
   * trap 17).
   */
  const LLM_SURFACES: ReadonlyArray<string> = [
    'src/adapters/llm/shared-schemas.ts',
    'src/cee/draft/anthropic-graph-schema.ts',
  ];

  it('no LLM output schema declares goal_threshold_frame', () => {
    const offenders: string[] = [];
    for (const rel of LLM_SURFACES) {
      const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
      if (text.includes('goal_threshold_frame')) offenders.push(rel);
    }
    expect(
      offenders,
      'The frame must never enter an LLM output surface — a model writing it ' +
        'would be guessing at the exact seam the field exists to make certain.',
    ).toEqual([]);
  });

  it('POSITIVE CONTROL — the scan can SEE a goal_threshold field when one is present', () => {
    // Without this, the absence assertion above passes just as happily against
    // a mistyped path or an empty read (CLAUDE.md trap 13).
    const text = readFileSync(join(REPO_ROOT, 'src/adapters/llm/shared-schemas.ts'), 'utf8');
    expect(text).toContain('goal_threshold');
  });
});
