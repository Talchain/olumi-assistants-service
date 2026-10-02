/**
 * ⭐ K3 — A KEPT RISK NOBODY HAS SAID THE DIRECTION OF NO LONGER BLOCKS THE WHOLE RUN (MG lease #85 5945974225; DL GO +
 * conditions). It is left out of the analysis, kept on the canvas, and said: by admission when the model is
 * built, and by the Run that left it out. ONE definition (`graph/inert-risk.ts`) for readiness, admission and the Run.
 *
 * Real path: the RECORDED drafter answer (T2 Constructor Baseline v1.1, brief K3 rep 1, CEE ccfb1655 — its only
 * structural block: "the effect is unknown", so admission withheld the risk → goal link it will not guess) →
 * `buildModelFromBrief` → `/graph/register` → `assessCanonicalAnalysisReadiness`, the one readiness authority.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { inertRiskBranch } from '../../../graph/inert-risk.js';
import { decisionInputLines } from '../decision-input-ask.js';
import { structuralFacts } from '../structural-facts.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/t2-k3-rep1-draft.json', import.meta.url), 'utf8')) as { brief: string; output_text: string };
const RISK = 'Service-quality problems';
const GOAL = 'annual support costs';
const LEFT_OUT_RUN = `"${RISK}" is left out of this analysis until you say whether it raises or lowers "${GOAL}".`;

async function build(draft: string = FX.output_text) {
  let graph: Rec | null = null;
  const call = (async () => ({ text: draft })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((b as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('c3c3c3c3-0000-4c3c-8c3c-c3c3c3c3c3c3', FX.brief, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: graph as unknown as Rec, out };
}
const riskId = (g: Rec): string => (g.nodes as Rec[]).find((n) => n.label === RISK)!.id;

describe('K3 on the recorded draft: the Run proceeds, the risk is kept and said', () => {
  it('RED: the served K3 draft is SAFE TO ANALYSE, the risk is kept with its cause drawn in, and the build says it is left out', async () => {
    const { graph, out } = await build();
    const id = riskId(graph);
    expect((graph.edges as Rec[]).some((e) => e.to === id), 'its cause is still drawn into it').toBe(true);
    expect((graph.edges as Rec[]).some((e) => e.from === id), 'no guessed onward link').toBe(false);
    const ready = assessCanonicalAnalysisReadiness(graph);
    expect(ready.blockingIssues.map((i) => i.code), 'was ["NO_PATH_TO_GOAL"] on ccfb1655').toEqual([]);
    expect(ready.safeToAnalyse).toBe(true);
    const said = (out.not_represented as string[]).filter((s) => s.includes('left out of this analysis'));
    expect(said).toEqual([`"${RISK}" is kept in the model but left out of this analysis, because nothing says which way it moves "${GOAL}". Say whether it raises or lowers "${GOAL}" and it will count.`]);
  });

  it('CONTROL (DL condition 2): the chat-edit gate reads the validator WITHOUT the flag — a dead-ended risk is still refused there', async () => {
    const { graph } = await build();
    const id = riskId(graph);
    expect(validateGraphStructure(graph as never).violations.filter((v) => v.code === 'NO_PATH_TO_GOAL').map((v) => v.detail)).toEqual([expect.stringContaining(`"${id}"`)]);
    expect(validateGraphStructure(graph as never, { leaveOutInertRisks: true }).violations).toEqual([]);
  });

  it('the Run names it ONCE (DL): on the Run turn only — not the build (admission said it), not once it is connected', async () => {
    const { graph } = await build();
    const at = { restingText: 'Your results are ready.', questionsToggle: false, awaitingApproval: false, builtOrRan: true };
    expect(decisionInputLines(graph, { ...at, ranAnalysis: true }).filter((l) => l.includes('left out'))).toEqual([LEFT_OUT_RUN]);
    expect(decisionInputLines(graph, { ...at, ranAnalysis: false }).filter((l) => l.includes('left out')), 'the build turn').toEqual([]);
    const goalId = (graph.nodes as Rec[]).find((n) => n.kind === 'goal')!.id;
    const connected = { ...graph, edges: [...(graph.edges as Rec[]), { from: riskId(graph), to: goalId }] };
    expect(decisionInputLines(connected, { ...at, ranAnalysis: true }).filter((l) => l.includes('left out')), 'connected').toEqual([]);
  });

  it('the Agent is never told it "cannot reach the goal" (the Run no longer has that blocker)', async () => {
    const { graph } = await build();
    const facts = structuralFacts(graph.nodes as never, graph.edges as never, []);
    expect(facts.entities_that_cannot_reach_goal).not.toContain(RISK);
    expect(facts.entities_with_no_connections).not.toContain(RISK);
  });

  it('a cause drawn ONLY into the risk goes with it and is NAMED in the same line (DL condition 3)', async () => {
    const d = JSON.parse(FX.output_text) as Rec;
    d.factors = [...d.factors, { label: 'Vendor staff turnover', role: 'external', baseline_known: false, baseline_value: null, unit: 'percent', provenance: 'ai_proposed', plausible_max: 100 }];
    d.links = [...d.links, { from: 'Vendor staff turnover', to: RISK, direction: 'positive', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null }];
    const { graph, out } = await build(JSON.stringify(d));
    expect(assessCanonicalAnalysisReadiness(graph).safeToAnalyse).toBe(true);
    expect((out.not_represented as string[]).filter((s) => s.includes('left out of this analysis'))).toEqual([
      `"${RISK}" (with "Vendor staff turnover", drawn only into it) is kept in the model but left out of this analysis, because nothing says which way it moves "${GOAL}". Say whether it raises or lowers "${GOAL}" and it will count.`,
    ]);
  });
});

describe('the ONE definition: only a risk, and only what reaches the goal through nothing else', () => {
  const g = (nodes: Rec[], edges: [string, string][]) => ({ nodes, edges: edges.map(([from, to]) => ({ from, to })) });
  const base = [{ id: 'goal', kind: 'goal' }, { id: 'opt', kind: 'option' }, { id: 'f', kind: 'factor' }, { id: 'r', kind: 'risk' }];

  it('a risk with no onward edge (with or without a cause) is in; a cause drawn only into it joins', () => {
    const x = g([...base, { id: 'exo', kind: 'factor', category: 'external' }], [['opt', 'f'], ['f', 'goal'], ['f', 'r'], ['exo', 'r']]);
    expect([...inertRiskBranch(x.nodes, x.edges, [])].sort()).toEqual(['exo', 'r']);
    expect([...inertRiskBranch(g(base, [['opt', 'f'], ['f', 'goal']]).nodes, g(base, [['opt', 'f'], ['f', 'goal']]).edges, [])]).toEqual(['r']);
  });

  it('CONTROL (DL condition 1): an option whose ONLY path runs through the risk stays REFUSED — never a silent "no effect"', () => {
    const x = g(base, [['opt', 'f'], ['f', 'r']]);
    expect(inertRiskBranch(x.nodes, x.edges, []).has('f'), 'what an option acts on never joins').toBe(false);
    const graph = { nodes: [...base.map((n) => ({ ...n, label: n.id })), { id: 'dec', kind: 'decision', label: 'd' }, { id: 'opt2', kind: 'option', label: 'o2' }],
      edges: [{ from: 'dec', to: 'opt' }, { from: 'dec', to: 'opt2' }, { from: 'opt', to: 'f' }, { from: 'opt2', to: 'f' }, { from: 'f', to: 'r' }] };
    expect(validateGraphStructure(graph as never, { leaveOutInertRisks: true }).violations.map((v) => v.code)).toContain('NO_PATH_TO_GOAL');
  });

  it('CONTROL: a dead-end FACTOR, a lever drawn only into the risk, a risk an option acts on, and a limited risk are never left out', () => {
    expect(inertRiskBranch(g(base, [['opt', 'f']]).nodes, g(base, [['opt', 'f']]).edges, []).has('f')).toBe(false);
    const lever = g([...base, { id: 'lev', kind: 'factor', category: 'controllable' }], [['lev', 'r']]);
    expect(inertRiskBranch(lever.nodes, lever.edges, []).has('lev')).toBe(false);
    expect(inertRiskBranch(g(base, [['opt', 'r']]).nodes, g(base, [['opt', 'r']]).edges, []).has('r')).toBe(false);
    expect(inertRiskBranch(g(base, [['f', 'r']]).nodes, g(base, [['f', 'r']]).edges, ['r']).has('r')).toBe(false);
  });
});
