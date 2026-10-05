/**
 * RT-10 B′ follow-through (Science #87 5999608477, template approved with edits; DL e8): when the target can't be tested
 * but the run KEPT the ordering, the reply says ONE tail about the target — what Olumi can't yet say, what it needs, and
 * the one question that unlocks it — and the Agent is licensed to say the shares as model findings in the goal's own
 * direction, never as a chance of reaching the target.
 *
 * Served before (red team #87 5999041843, rt10b Run 2): "This run doesn't show how often each option reaches the goal's
 * target." then "What is the most that 'monthly cancellations' can be?" — for the target the user had just set.
 *
 * Fixture: the red team's post-edit graph and the REAL PLoT body for its own payload (minimise, 2473ace). Science asked
 * for a plural and a singular goal label: both bound by their exact words.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import {
  goalChanceWithheldForAgent,
  PLACEHOLDER_PATH_NOTE,
  TARGET_ONLY_NOTE,
} from '../goal-chance-withheld.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';

type Json = Record<string, any>;
const F = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_with_target: Json; plot_body_minimise: Json;
};

const PLURAL_TAIL = "I can't yet say how likely any option is to keep monthly cancellations at or below 400 cancellations / month: "
  + 'I need today\'s level, and a size for the link from Pauses taken instead of cancellations to monthly cancellations. '
  + "What's today's level of monthly cancellations?";
const SINGULAR_TAIL = "I can't yet say how likely any option is to keep monthly cancellation count at or below 400 cancellations / month: "
  + 'I need today\'s level, and a size for the link from Pauses taken instead of cancellations to monthly cancellation count. '
  + "What's today's level of monthly cancellation count?";

const relabelled = (label: string): Json => {
  const g = structuredClone(F.graph_with_target);
  for (const n of g.nodes) if (n.kind === 'goal') n.label = label;
  return g;
};
const runOn = (graph: Json): Json => ({ enrichment: withholdGoalFiguresForUntestableTarget(structuredClone(F.plot_body_minimise), graph) });
const targetWarning = (block: Json): Json =>
  (block.enrichment.inference_warnings as Json[]).find((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)!;

describe('B′ — the target tail and the target-only licence', () => {
  it('plural label (served): the warning carries the tail, and the Agent says it once under the target-only licence', () => {
    const block = runOn(F.graph_with_target);
    expect(targetWarning(block).say).toBe(PLURAL_TAIL);
    const chance = goalChanceWithheldForAgent(block);
    expect(chance).toMatchObject({ withheld: true, say: PLURAL_TAIL, note: TARGET_ONLY_NOTE, node_ids: ['monthly_cancellations'] });
  });

  it('singular label: the same template, the label agrees', () => {
    const block = runOn(relabelled('monthly cancellation count'));
    expect(targetWarning(block).say).toBe(SINGULAR_TAIL);
    expect(goalChanceWithheldForAgent(block)?.say).toBe(SINGULAR_TAIL);
  });

  it('the licence lets the shares be said in the goal\'s own direction, never as a target chance or a recommendation', () => {
    expect(TARGET_ONLY_NOTE).toMatch(/where lower is better, the option that came out lowest/);
    expect(TARGET_ONLY_NOTE).toMatch(/never as a\s+chance of reaching the target and never as a recommendation/);
  });

  it('CONTRAST: a placeholder-path withhold (the shares go too) keeps its own licence, never the target-only one', () => {
    const block = { enrichment: { inference_warnings: [{
      code: GOAL_FIGURES_PLACEHOLDER_PATH, message: 'Not shown. A link Olumi has not sized moves these options.', severity: 'warning',
      node_ids: ['monthly_cancellations'], option_ids: ['pause_instead_of_cancel'],
    }] } };
    expect(goalChanceWithheldForAgent(block)?.note).toBe(PLACEHOLDER_PATH_NOTE);
  });

  it('CONTRAST: a target warning that withheld the shares (`win_share`) is not the target-only licence', () => {
    const block = runOn(F.graph_with_target);
    const w = targetWarning(block);
    w.withheld_claims = [...w.withheld_claims, 'win_share'];
    expect(goalChanceWithheldForAgent(block)?.note).not.toBe(TARGET_ONLY_NOTE);
  });
});
