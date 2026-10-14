/**
 * ⭐ SCIENCE (AIE MA1, 13 Oct; Batch 0 amendment 5; DL 14 Oct, marketing joint coaching): a LEVEL target read over the first
 * N months after launch measures a quantity that does not exist before launch. Served marketing (e2e 25d14238 turn 08) told
 * Paul "Conversion rate's current level is missing" and asked "What is today's conversion rate, measured how?" for a feature
 * not yet launched: the wrong model. The gap is a forecast for that window, and with a second target in the same window, the
 * ONE question is whether the two count the same people (AIE laws ruling, `same_cohort`). No writer yet takes that answer
 * into a Run, so the step carries what stays unbuilt beside it (never promised).
 *
 * Corpus: the served Run press, verbatim (`tests/fixtures/marketing-withheld-once/run-08.json`), through the real producers:
 * `targetTestabilityOf` → `untestableTargetParts` → `targetBlockerOf` (the step the AI ends with), `goalLevelAskOf` (the
 * bar's "set current level"), `withholdGoalFiguresForMissingCurrentLevel` (the card), `thresholdReasonLine` (the reply)
 * and `withholdDisclosureForCells` (the face marker). Contrasts change ONLY the basis on the same graph.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { targetBlockerOf, targetTestabilityOf, untestableTargetParts } from '../../admission/target-testability.js';
import { goalLevelAskOf } from '../../agent-lane/current-level-answer.js';
import { withholdGoalFiguresForMissingCurrentLevel } from '../../tools/handlers/run-analysis.js';
import { thresholdReasonLine } from '../../agent-lane/break-even.js';
import { markerForDisclosure, withholdDisclosureForCells } from '../../agent-lane/reply/compose-reply.js';
import { LAUNCH_WINDOW_UNBUILT, launchWindowOf } from '../goal-target-basis.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const GAP = 'Conversion rate is measured over the first three months after launch, so it has no level today, and the model has no forecast for that period yet.';
const COHORT = 'Do your ‘New customers in first 3 months’ come from the same people your ‘Conversion rate’ is measured on?';

/** The same served graph with the goal's basis (and only it) changed. */
function withBasis(patch: Rec, graph: Rec = F.graph): Rec {
  return { ...graph, nodes: (graph.nodes as Rec[]).map((n) => n.kind === 'goal' ? { ...n, goal_target_basis: { ...n.goal_target_basis, ...patch } } : n) };
}
const soleTarget = (graph: Rec): Rec => ({ ...graph, goal_constraints: (graph.goal_constraints as Rec[]).filter((r) => r.role !== 'goal_target' || r.node_id === 'conversion_rate') });
const partsOf = (graph: Rec) => untestableTargetParts(graph, targetTestabilityOf(graph))!;
/** The served Run's enrichment before this producer wrote its warning. */
const pre = (): Rec => ({ ...F.enrichment, inference_warnings: (F.enrichment.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_FIGURES_MISSING_CURRENT_LEVEL') });
const cardMessage = (graph: Rec): string => ((withholdGoalFiguresForMissingCurrentLevel(pre(), graph, graph.goal_constraints) as Rec)
  .inference_warnings as Rec[]).find((w) => w.code === 'GOAL_FIGURES_MISSING_CURRENT_LEVEL')!.message;
/** A card whose every cell is withheld for this one cause (the served card also carried others, so its face said "why is under More detail"). */
const marker = (graph: Rec): string => markerForDisclosure(withholdDisclosureForCells(graph, F.card_options.map((o: Rec) => ({ ...o.cell,
  reasons: (o.cell.reasons as Rec[]).filter((r) => r.code === 'GOAL_FIGURES_MISSING_CURRENT_LEVEL') })))!);

describe('a target measured over the window from launch: no "today\'s level"; the window and the one cohort question', () => {
  it('PRECONDITION: the served goal is a level target over the first three months after launch, with a second target row', () => {
    expect(launchWindowOf((F.graph.nodes as Rec[]).find((n) => n.kind === 'goal'))).toMatchObject({ reference: 'launch', period_kind: 'over_period', period_months: 3 });
    expect((F.graph.goal_constraints as Rec[]).filter((r) => r.role === 'goal_target').map((r) => r.node_id)).toEqual(['conversion_rate', 'new_customers_in_first_3_months']);
    expect(targetTestabilityOf(F.graph)).toMatchObject({ kind: 'not_testable', failures: expect.arrayContaining([expect.objectContaining({ precondition: 'P1', case: 'a' })]) });
  });

  it('RED: the step asks whether the two targets count the same people; never today\'s level', () => {
    const parts = partsOf(F.graph);
    expect(parts.question).toBe(COHORT);
    expect(parts.clauses[0]).toBe('it needs a forecast of Conversion rate over the first three months after launch');
    expect(parts.needs[0]).toBe('a forecast of Conversion rate over the first three months after launch');
    // ⛔ Science PR-4b, EXPECTATION CHANGED: with two targets the answers now BUILD the chance (each option's cohort forecast,
    // `cohort-forecast-capture.test.ts`), so nothing is said to stay unbuilt beside the question. One target alone keeps it (below).
    expect(targetBlockerOf(parts)).toEqual({ kind: 'missing_input', ask: COHORT });
    expect(JSON.stringify(parts)).not.toMatch(/today's level/);
  });

  it('RED: no "set current level" ask on the bar; the card, the reply and the face marker say the window\'s gap', () => {
    expect(goalLevelAskOf(F.graph, { enrichment: F.enrichment })).toBeNull();
    expect(cardMessage(F.graph)).toBe(`Not shown. ${GAP}`);
    expect(thresholdReasonLine(F.graph, { enrichment: F.enrichment })).toBe(`Olumi can't show each option's chance of reaching your Conversion rate target yet. ${GAP} The rest of this Run's results still stand.`);
    expect(marker(F.graph)).toBe('Not shown: no forecast yet for Conversion rate after launch');
  });

  it('CONTRAST: one launch-window target alone → the forecast itself is the question', () => {
    const parts = partsOf(soleTarget(F.graph));
    expect(parts.question).toBe('What Conversion rate do you expect over the first three months after launch? A range is fine.');
    expect(targetBlockerOf(parts)).toEqual({ kind: 'missing_input', ask: parts.question, also_unbuilt: LAUNCH_WINDOW_UNBUILT });
  });

  it('CONTROL: measured from TODAY (same graph, same targets) → today\'s level, exactly as before', () => {
    const today = withBasis({ reference: 'today' });
    expect(launchWindowOf((today.nodes as Rec[]).find((n) => n.kind === 'goal'))).toBeUndefined();
    const parts = partsOf(today);
    expect(parts.question).toBe("What's today's level of Conversion rate?");
    expect(targetBlockerOf(parts)).toEqual({ kind: 'missing_input', ask: "What's today's level of Conversion rate?" });
    expect(goalLevelAskOf(today, { enrichment: F.enrichment })?.question).toBe("To show each option's chance of reaching your Conversion rate target, I first need today’s level of ‘Conversion rate’. What is it, in %?");
    expect(cardMessage(today)).toBe("Not shown. Conversion rate's current level is missing.");
    expect(marker(today)).toBe("Not shown: Conversion rate's current level is missing");
  });

  it('CONTROL: a launch target read AT month three (a snapshot, not over the window) → today\'s level, as before', () => {
    const atEnd = withBasis({ period_kind: 'at_end' });
    expect(partsOf(atEnd).question).toBe("What's today's level of Conversion rate?");
    expect(cardMessage(atEnd)).toBe("Not shown. Conversion rate's current level is missing.");
  });
});
