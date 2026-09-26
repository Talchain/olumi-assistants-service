/**
 * A COMMAND SEQUENCE OVER ONE HELD ADD-OPTION: EDIT → APPROVAL / RETRY → OUT-OF-ORDER → RELOAD
 * (ChatGPT #70 5845888839, bounded handoff to Canonical: "one committed operation, exact admitted revision and no
 * stale receipt overwriting newer state").
 *
 * Deterministic variants first, over the REAL seams a confirm uses (no HTTP, no store fake): the typed dispatcher
 * holds the change, the referee assesses it against the graph at approval time, the held resume applies it with the
 * production applier, and the read route's admission is built from the committed graph.
 *
 *   late approval   the hold was proposed at R0; a newer value edit landed first (R1). The approval applies to R1
 *                   and the newer value survives — the hold never carries a stale image back.
 *   retry           the same approval again, after it committed: refused. Exactly ONE option was added.
 *   reload          the admission read from the committed graph is bound to that exact revision.
 *   either order    edit-then-approve and approve-then-edit reach the same analysis-affecting revision.
 *
 * The graph is Paul's served pricing graph (DL browser bf-20260926T101424Z, turn 1). Levels and the edit are this
 * spec's.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { assessHeldBatchAgainstGraph } from '../../handlers/edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-same-levels-option.bf-101424.json', import.meta.url), 'utf8'),
) as { graph: Json; _provenance: { decision_id: string } };
const R0 = projectGraphForPersistence(structuredClone(SERVED.graph) as never) as Json;
const H0 = computeAnalysisAffectingGraphHash(R0 as never)!;
const LABEL = 'Raise Pro to £57';
const hashOf = (g: Json) => computeAnalysisAffectingGraphHash(g as never)!;
const optionsLabelled = (g: Json, label: string) => (g.nodes as Json[]).filter((n) => n.kind === 'option' && n.label === label);
const churnOf = (g: Json) => (g.nodes as Json[]).find((n) => n.id === 'monthly_churn_rate')!.observed_state.value;

/** The newer edit: monthly churn moves to 6% (production applier, one update_node; every other field kept). */
function valueEdit(g: Json): Json {
  const before = (g.nodes as Json[]).find((n) => n.id === 'monthly_churn_rate')!.observed_state;
  return projectGraphForPersistence(applyPatchOperations(structuredClone(g) as never, [
    { op: 'update_node', path: 'monthly_churn_rate', value: { observed_state: { ...before, value: 0.06 } } },
  ] as never) as never) as Json;
}

/** Propose at `graph`: the typed add-option chip holds ONE change. */
function propose(graph: Json): Json {
  const out = dispatchAddOptionTransaction({
    parameters: { parent_decision_id: SERVED._provenance.decision_id, label: LABEL, interventions: [{ factor_id: 'pro_plan_price', value: 0.285 }] },
    currentGraph: graph, currentGraphHash: hashOf(graph), freshness: 'none', mode: 'live',
    scenarioId: 'scn-seq', turnId: 'turn-propose', requestId: 'req-propose', stage: 'frame',
  } as never) as Json;
  expect(out.kind, 'premise: held').toBe('held');
  return readGmHeldResume(out.pendingActions[0]) as Json;
}

/** Approve `held` against `graph`, exactly as the confirm path does: referee first, then the held resume. */
function approve(held: Json, graph: Json): { valid: boolean; graph?: Json } {
  const cap = held.envelopeCap !== undefined ? { envelopeCap: held.envelopeCap } : {};
  const assessed = assessHeldBatchAgainstGraph({
    operations: held.operations, currentGraph: graph, currentGraphHash: hashOf(graph),
    scenarioId: 'scn-seq', turnId: 'turn-confirm', requestId: 'req-confirm', ...cap,
  } as never) as Json;
  if (assessed.valid !== true) return { valid: false };
  const executed = executeGmHeldResume({
    operations: held.operations, ...cap, currentGraph: graph, currentGraphHash: hashOf(graph),
    freshness: 'none', hasExistingAnalysis: false, scenarioId: 'scn-seq', turnId: 'turn-confirm', requestId: 'req-confirm',
  } as never) as Json;
  return executed.status === 'executed' ? { valid: true, graph: executed.mutatedGraph as Json } : { valid: false };
}

describe('⭐ edit → approval → retry → reload over ONE held add-option', () => {
  const held = propose(R0);
  const R1 = valueEdit(R0);

  it('PREMISE: the newer edit moved the revision, and the hold was proposed before it', () => {
    expect(churnOf(R0)).toBe(0.08);
    expect(churnOf(R1)).toBe(0.06);
    expect(hashOf(R1)).not.toBe(H0);
  });

  it('⭐ late approval: applies to the NEWER revision, and the newer value survives (no stale image carried back)', () => {
    const r = approve(held, R1);
    expect(r.valid).toBe(true);
    expect(optionsLabelled(r.graph!, LABEL)).toHaveLength(1);
    expect(churnOf(r.graph!)).toBe(0.06);
    expect(hashOf(r.graph!)).not.toBe(hashOf(R1));
  });

  it('⭐ retry: the same approval after it committed is refused — exactly ONE option was added', () => {
    const committed = approve(held, R1).graph!;
    const again = approve(held, committed);
    expect(again.valid).toBe(false);
    expect(optionsLabelled(committed, LABEL)).toHaveLength(1);
  });

  it('⭐ reload: the admission read from the committed graph is bound to exactly that revision', () => {
    const committed = approve(held, R1).graph!;
    const ready = buildCanonicalAnalysisReadyFromGraph(committed as never) as Json;
    expect(String(ready.analysis_admission.graph_hash).startsWith(hashOf(committed))).toBe(true);
    expect(String(ready.analysis_admission.graph_hash).startsWith(hashOf(R1))).toBe(false);
  });

  it('either order — edit then approve, approve then edit — reaches the same analysis-affecting revision', () => {
    const editFirst = approve(held, R1).graph!;
    const approveFirst = valueEdit(approve(held, R0).graph!);
    expect(hashOf(approveFirst)).toBe(hashOf(editFirst));
    expect(churnOf(approveFirst)).toBe(0.06);
  });
});
