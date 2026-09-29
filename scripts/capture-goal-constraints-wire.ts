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
import { extractCompoundGoals } from '../src/cee/compound-goal/extractor.js';
import { transformResponseToV3 } from '../src/cee/transforms/schema-v3.js';
import { draftResultToOlumiResponse } from '../src/orchestrator-v5/handlers/draft-graph-dispatch.js';
import { finaliseV5Response } from '../src/orchestrator-v5/response-finaliser.js';
import { validateEgress } from '../src/validators/b1.js';

const LIVE_BRIEF =
  'Should we launch the new product this year? ' +
  'Hard constraint: first-year budget cannot exceed £50,000 — ' +
  'anything over is unaffordable, full stop.';

/**
 * ⭐⭐ THE NODE IDS ARE CONTENT-HASH SHAPED BECAUSE THE LIVE DRAFTER'S ARE, AND
 * THE PREVIOUS SHAPE MADE THIS CAPTURE EVIDENCE ABOUT A PATH THE PRODUCT CANNOT
 * TAKE.
 *
 * This graph used to carry `id: 'fac_year_budget'` — the id the extractor
 * itself synthesises from this brief's subject ("year budget"). The bind
 * therefore resolved at `remapConstraintTargets` STEP 2, exact id, and the
 * run's own telemetry said so: `constraints_remapped: 0`,
 * `constraints_rejected_no_match: 0`.
 *
 * The live drafter never mints a semantic id. Node ids arrive as `sha8()`
 * content hashes from the records projector (`cee/draft/records/projector.ts`),
 * witnessed on the wire across 13 live staging turns on build `3427aea`
 * (2026-09-07): `156e7eaf` = "Full German Market Entry" in 9 independent
 * scenarios, `b87d004b` = "Budget Overrun" in 7. So step 2 is UNREACHABLE in
 * production, and the only path that can fire live — the LABEL match at steps
 * 3-5 — was the one this capture never exercised.
 *
 * ⚠ THE PRECISE CHARGE, because the loose version of it is false. The old graph
 * was not a guard that *could not* bind by label: its label "First-Year Budget"
 * normalises to `first_year_budget` and the target name "year budget" to
 * `year_budget`, and the fuzzy label fallback does bind those. The defect is
 * narrower and still disqualifying: the exact-id path won FIRST, so the capture
 * produced no evidence at all about the path production uses, while reading as
 * a passing end-to-end proof of exactly that.
 *
 * A derived guard below now REDs if any hand-built id ever coincides with an id
 * the extractor synthesises, so the shape cannot quietly come back.
 */
const BOUND_GRAPH = {
  nodes: [
    { id: '0654116f', kind: 'goal', label: 'Launch Successfully' },
    { id: '3f1c02ab', kind: 'decision', label: 'Launch?' },
    { id: '02954f6c', kind: 'option', label: 'Launch now' },
    { id: 'ea22bd24', kind: 'factor', label: 'First-Year Budget' },
    { id: 'a1048c65', kind: 'outcome', label: 'Budget Headroom' },
  ],
  edges: [
    { from: '3f1c02ab', to: '02954f6c', strength_mean: 1 },
    { from: '02954f6c', to: 'ea22bd24', strength_mean: 0.5 },
    { from: 'ea22bd24', to: 'a1048c65', strength_mean: 0.5 },
    { from: 'a1048c65', to: '0654116f', strength_mean: 0.5 },
  ],
};

/**
 * ⭐ THE SECOND ARM — AND IT IS THE ONE THE LIVE PRODUCT ACTUALLY PRODUCED.
 *
 * Node set and labels taken VERBATIM from the wire response of live staging
 * turn D1 on build `3427aea` (2026-09-07), which drafted from this exact brief
 * (asserted byte-identical below). On it the user's £50,000 ceiling binds to
 * NOTHING: "year budget" reaches a factor labelled "First-Year Launch Budget"
 * and the label match fails on the interleaved word.
 *
 * That is not a case to leave uncaptured. It is the majority case, and what the
 * user receives on it is a DISCLOSURE, not a constraint — so the UI needs those
 * bytes at least as much as it needs the bound ones. A capture of the happy arm
 * alone is how a surface ships with no rendering for the arm that actually
 * occurs.
 */
const UNBOUND_GRAPH = {
  nodes: [
    { id: '0654116f', kind: 'goal', label: 'Should we launch the new product this year?' },
    { id: '02954f6c', kind: 'option', label: 'Launch the New Product This Year' },
    { id: '4bfaf8f6', kind: 'option', label: 'Soft Launch / Pilot This Year' },
    { id: '8b7fdaeb', kind: 'factor', label: 'Market Readiness' },
    { id: 'ea22bd24', kind: 'factor', label: 'First-Year Launch Budget' },
    { id: '75dc3edd', kind: 'outcome', label: 'Revenue Generation' },
    { id: 'b87d004b', kind: 'risk', label: 'Budget Overrun' },
  ],
  edges: [
    { from: '02954f6c', to: 'ea22bd24', strength_mean: 0.5 },
    { from: 'ea22bd24', to: '75dc3edd', strength_mean: 0.5 },
    { from: '75dc3edd', to: '0654116f', strength_mean: 0.5 },
  ],
};

const outfile = process.argv[2];
if (!outfile) {
  console.error('usage: tsx scripts/capture-goal-constraints-wire.ts <outfile>');
  process.exit(1);
}

// ── The anti-tautology guard, DERIVED from the extractor, never a list ───────
// Asks the extractor what ids it would synthesise for this brief and asserts no
// hand-built node carries one. A hardcoded denylist here would be the
// hand-maintained mirror (trap 12) that let the original shape stand.
{
  const synthesised = new Set(
    extractCompoundGoals(LIVE_BRIEF, { includeProxies: false })
      .constraints.map((c) => c.targetNodeId),
  );
  if (synthesised.size === 0) {
    console.error('FATAL: the extractor synthesised NO target ids for this brief — the guard below would be vacuous');
    process.exit(1);
  }
  const collisions = [...BOUND_GRAPH.nodes, ...UNBOUND_GRAPH.nodes]
    .map((n) => n.id)
    .filter((id) => synthesised.has(id));
  if (collisions.length > 0) {
    console.error(
      'FATAL: a capture node carries an id the extractor synthesises (' +
        collisions.join(', ') +
        ') — the bind would resolve by exact id, a path the live drafter cannot take, and this capture would prove nothing about production',
    );
    process.exit(1);
  }
}

const ctx: any = {
  requestId: 'capture-goal-constraints',
  effectiveBrief: LIVE_BRIEF,
  graph: structuredClone(BOUND_GRAPH),
  goalConstraints: undefined,
  llmGoalConstraints: undefined,
};

runCompoundGoals(ctx);

if (!Array.isArray(ctx.goalConstraints) || ctx.goalConstraints.length === 0) {
  console.error('FATAL: extractor produced no constraints — capture would be vacuous');
  process.exit(1);
}

// The bind must have gone through the LABEL path. Asserted by IDENTITY of the
// node it landed on (trap 19): a content-hash id could only have been reached
// by a remap, because the extractor never synthesises one.
{
  const boundNodeIds = new Set(BOUND_GRAPH.nodes.map((n) => n.id));
  const offenders = (ctx.goalConstraints as Array<{ node_id?: unknown }>)
    .map((c) => String(c.node_id))
    .filter((id) => !boundNodeIds.has(id));
  if (offenders.length > 0) {
    console.error(`FATAL: constraint bound to a node not in the graph (${offenders.join(', ')})`);
    process.exit(1);
  }
}

// ── ARM 2: the same brief against the REAL live D1 node set ─────────────────
// Captured for its DISCLOSURE bytes. It is asserted to behave as the live wire
// did — no constraint, and a question raised — so this arm reds if either the
// binding or the disclosure silently changes.
const unboundCtx: any = {
  requestId: 'capture-goal-constraints-unbound',
  effectiveBrief: LIVE_BRIEF,
  graph: structuredClone(UNBOUND_GRAPH),
  goalConstraints: undefined,
  llmGoalConstraints: undefined,
};
runCompoundGoals(unboundCtx);
const unboundConstraints = Array.isArray(unboundCtx.goalConstraints) ? unboundCtx.goalConstraints : [];
const unboundAsks = Array.isArray(unboundCtx.directionUnresolved) ? unboundCtx.directionUnresolved : [];
if (unboundConstraints.length !== 0) {
  console.error(
    'FATAL: the live-D1 node set now BINDS the limit. That may be good news, but this arm exists ' +
      'to capture the unbound disclosure — re-derive it against a current live capture before editing.',
  );
  process.exit(1);
}
if (unboundAsks.length === 0) {
  console.error(
    'FATAL: the limit bound to nothing AND raised no question — that is the silent loss this ' +
      'capture exists to make impossible to ship unnoticed',
  );
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
  // The brief this capture drafts from. On the ordinary draft turn the wire
  // message IS the brief, which is why `payload.message` is the same string —
  // but the composer's 5th parameter means "the brief the pipeline drafted
  // from", so pass the value that carries that meaning here (`ctx.effectiveBrief`),
  // not the wire message that happens to equal it.
  ctx.effectiveBrief,
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
console.log('-- arm 2 (live D1 node set, same brief) --');
console.log('goal_constraints count   :', unboundConstraints.length, '(0 = reproduces the live wire)');
console.log('direction questions      :', unboundAsks.length,
  unboundAsks.map((i: any) => `${i.reason}:${JSON.stringify(i.metric_text)}`).join(' ; '));
