/**
 * Capture the EXACT `/orchestrate/v2/turn` wire bytes for a hard-constraint
 * brief, using the real production chain end-to-end:
 *
 *   compound-goals.runCompoundGoals   (deterministic regex extractor)
 *   package.ts:406 sibling placement   (goal_constraints beside `graph`)
 *   schema-v3.transformResponseToV3    (V1 root -> V3 root)
 *   draft-graph.ts:300 `body.graph ?? body`
 *   draft-graph-dispatch.draftResultToOlumiResponse   (the V5 projection)
 *   response-finaliser.finaliseV5Response             (envelope stamping)
 *   validators/b1.validateEgress                      (the egress gate)
 *
 * The emitted JSON is the cross-repo proof artefact: the UI integration test
 * consumes these bytes verbatim, so the two halves of this lane are joined by
 * a real CEE payload rather than by a hand-written fixture that could agree
 * with neither side.
 *
 * Usage: pnpm tsx scripts/capture-goal-constraints-wire.ts <outfile>
 */
import { writeFileSync } from 'node:fs';

import { runCompoundGoals } from '../src/cee/unified-pipeline/stages/repair/compound-goals.js';
import { transformResponseToV3 } from '../src/cee/transforms/schema-v3.js';
import { draftResultToOlumiResponse } from '../src/orchestrator-v5/handlers/draft-graph-dispatch.js';
import { finaliseV5Response } from '../src/orchestrator-v5/response-finaliser.js';
import { validateEgress } from '../src/validators/b1.js';

const LIVE_BRIEF =
  'Should we launch the new product this year? ' +
  'Hard constraint: first-year budget cannot exceed £50,000 — ' +
  'anything over is unaffordable, full stop.';

function makeGraph() {
  return {
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Launch Successfully' },
      { id: 'd1', kind: 'decision', label: 'Launch?' },
      { id: 'opt_a', kind: 'option', label: 'Launch now' },
      { id: 'fac_year_budget', kind: 'factor', label: 'First-Year Budget' },
      { id: 'out_budget_headroom', kind: 'outcome', label: 'Budget Headroom' },
    ],
    edges: [
      { from: 'd1', to: 'opt_a', strength_mean: 1 },
      { from: 'opt_a', to: 'fac_year_budget', strength_mean: 0.5 },
      { from: 'fac_year_budget', to: 'out_budget_headroom', strength_mean: 0.5 },
      { from: 'out_budget_headroom', to: 'g1', strength_mean: 0.5 },
    ],
  };
}

const outfile = process.argv[2];
if (!outfile) {
  console.error('usage: tsx scripts/capture-goal-constraints-wire.ts <outfile>');
  process.exit(1);
}

const ctx: any = {
  requestId: 'capture-goal-constraints',
  effectiveBrief: LIVE_BRIEF,
  graph: makeGraph(),
  goalConstraints: undefined,
  llmGoalConstraints: undefined,
};

runCompoundGoals(ctx);

if (!Array.isArray(ctx.goalConstraints) || ctx.goalConstraints.length === 0) {
  console.error('FATAL: extractor produced no constraints — capture would be vacuous');
  process.exit(1);
}

const v1Response: any = {
  graph: ctx.graph,
  goal_constraints: ctx.goalConstraints,
  rationales: [],
  confidence: 0.5,
};

const v3Body: any = transformResponseToV3(v1Response, { requestId: ctx.requestId });
const graphOutput = v3Body.graph ?? v3Body;

const payload: any = {
  scenario_id: 'scn_capture',
  turn_id: 'turn_capture',
  stage: 'frame',
  message: LIVE_BRIEF,
};

const composed = draftResultToOlumiResponse(
  {
    graphOutput,
    assistantText: null,
    analysisReady: v3Body.analysis_ready ?? null,
    strengthenItems: [],
    coachingSummary: null,
    coachingBiasSignals: [],
    coachingWideningLogObject: null,
  } as any,
  payload,
  true,
  ctx.requestId,
);

// Stamp the envelope exactly as the route does before send.
const finalised = finaliseV5Response(composed, {
  requestId: ctx.requestId,
  analysisReady: v3Body.analysis_ready ?? undefined,
} as any);

const egress: any = validateEgress(finalised, ctx.requestId);
if (!egress.ok) {
  console.error('FATAL: validateEgress REJECTED the response — would ship EGRESS_CONTRACT_VIOLATION');
  console.error(JSON.stringify(egress, null, 2).slice(0, 2000));
  process.exit(1);
}

const bytes = JSON.stringify(finalised, null, 2);
writeFileSync(outfile, bytes + '\n');

const gc = (finalised as any).draft_graph?.goal_constraints;
console.log('egress.ok                :', egress.ok);
console.log('draft_graph keys         :', Object.keys((finalised as any).draft_graph ?? {}).sort().join(','));
console.log('goal_constraints count   :', Array.isArray(gc) ? gc.length : 'ABSENT');
console.log('constraint               :', JSON.stringify(gc?.[0]));
console.log('analysis_ready present   :', (finalised as any).analysis_ready != null);
console.log('bytes written            :', bytes.length, '->', outfile);
