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
import { decisionInputLines, withA7AfterGate } from '../decision-input-ask.js';
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

  it('HOST-said (CODEX P1): on the build turn and every Run — never left to the narrator; not on follow-ups; gone once connected', async () => {
    const { graph } = await build();
    const at = { restingText: 'Your results are ready.', questionsToggle: false, awaitingApproval: false, builtOrRan: true };
    expect(decisionInputLines(graph, at).filter((l) => l.includes('left out'))).toEqual([LEFT_OUT_RUN]);
    expect(decisionInputLines(graph, { ...at, builtOrRan: false }).filter((l) => l.includes('left out')), 'a follow-up turn').toEqual([]);
    const goalId = (graph.nodes as Rec[]).find((n) => n.kind === 'goal')!.id;
    const connected = { ...graph, edges: [...(graph.edges as Rec[]), { from: riskId(graph), to: goalId }] };
    expect(decisionInputLines(connected, at).filter((l) => l.includes('left out')), 'connected').toEqual([]);
  });

  it('ONCE PER RISK on the build turn (DL): the narrator relaying admission\'s line → the host does not say it again', async () => {
    const { graph, out } = await build();
    const ledger = (out.not_represented as string[]).find((s) => s.includes('left out of this analysis'))!;
    const narrated = `I built the model. ${ledger} Ask me to run it.`;
    const owed = decisionInputLines(graph, { restingText: narrated, questionsToggle: false, awaitingApproval: false, builtOrRan: true });
    const reply = [narrated, ...owed].join('\n\n');
    expect(reply.split('left out of this analysis').length - 1, 'said once').toBe(1);
    // CONTROL: a narrator that did not say it → the host says it, once; another risk's mention does not suppress it.
    const silent = decisionInputLines(graph, { restingText: 'I built the model. "Founder burnout" matters too.', questionsToggle: false, awaitingApproval: false, builtOrRan: true });
    expect(silent.filter((l) => l.includes('left out of this analysis'))).toEqual([LEFT_OUT_RUN]);
    // CONTROL (DL): a NEGATED sentence says the opposite → still said ("not", "no longer", "isn't").
    for (const neg of [`"${RISK}" is not left out of this analysis.`, `"${RISK}" is no longer left out of this analysis.`, `"${RISK}" isn't left out of this analysis.`]) {
      const said = decisionInputLines(graph, { restingText: `I built the model. ${neg}`, questionsToggle: false, awaitingApproval: false, builtOrRan: true });
      expect(said.filter((l) => l.includes('left out of this analysis')), neg).toEqual([LEFT_OUT_RUN]);
    }
    // CONTROL: the narrator names THIS risk without saying it is left out → still said (the label alone never suppresses it).
    const named = decisionInputLines(graph, { restingText: `I built the model. "${RISK}" is a real worry.`, questionsToggle: false, awaitingApproval: false, builtOrRan: true });
    expect(named.filter((l) => l.includes('left out of this analysis'))).toEqual([LEFT_OUT_RUN]);
  });

  it('RED (CODEX P2): A7 is restored after the gate by its OWN words — never mistaken for the left-out line', () => {
    const goal = JSON.parse(readFileSync(new URL('./fixtures/served-goal-target-train-0258Z.json', import.meta.url), 'utf8')).goal_after_build as Rec;
    const g = { nodes: [goal, { id: 'opt_a', kind: 'option', label: 'Angel pilot' }, { id: 'f_x', kind: 'factor', label: 'Founder hours' }, { id: 'r_b', kind: 'risk', label: 'Founder burnout' }], edges: [{ from: 'f_x', to: 'r_b' }] };
    const owed = decisionInputLines(g, { restingText: '', questionsToggle: false, awaitingApproval: false, builtOrRan: true });
    const [left, a7, ask] = owed;
    expect(left).toContain('"Founder burnout" is left out of this analysis');
    expect(a7).toMatch(/^This model doesn't yet say whether any option gets there/);
    const folded = `Your results are ready.\n\n${left}\n\n${ask}`;
    expect(withA7AfterGate(folded, g, { awaitingApproval: false, builtOrRan: true }, null)).toBe(`Your results are ready.\n\n${left}\n\n${a7}\n\n${ask}`);
  });

  it('the Agent is never told it "cannot reach the goal" (the Run no longer has that blocker)', async () => {
    const { graph } = await build();
    const facts = structuralFacts(graph.nodes as never, graph.edges as never, []);
    expect(facts.entities_that_cannot_reach_goal).not.toContain(RISK);
    expect(facts.entities_with_no_connections).not.toContain(RISK);
  });

  it('the WHOLE left-out branch is NAMED in the same line, however many hops (DL condition 3; CODEX P2)', async () => {
    const d = JSON.parse(FX.output_text) as Rec;
    const ext = (label: string) => ({ label, role: 'external', baseline_known: false, baseline_value: null, unit: 'percent', provenance: 'ai_proposed', plausible_max: 100 });
    const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
    d.factors = [...d.factors, ext('Vendor contract churn'), ext('Vendor staff turnover')];
    d.links = [...d.links, link('Vendor contract churn', 'Vendor staff turnover'), link('Vendor staff turnover', RISK)];
    const { graph, out } = await build(JSON.stringify(d));
    expect(assessCanonicalAnalysisReadiness(graph).safeToAnalyse).toBe(true);
    expect((out.not_represented as string[]).filter((s) => s.includes('left out of this analysis'))).toEqual([
      `"${RISK}" is kept in the model but left out of this analysis, because nothing says which way it moves "${GOAL}", and so are "Vendor contract churn" and "Vendor staff turnover", which feed only what is left out. Say whether it raises or lowers "${GOAL}" and it will count.`,
    ]);
  });
});

describe('the ONE definition: only a risk, and only what reaches the goal through nothing else', () => {
  type N = { id: string; kind?: string; category?: string };
  const g = (nodes: N[], edges: [string, string][]) => ({ nodes, edges: edges.map(([from, to]) => ({ from, to })) });
  const base: N[] = [{ id: 'goal', kind: 'goal' }, { id: 'opt', kind: 'option' }, { id: 'f', kind: 'factor' }, { id: 'r', kind: 'risk' }];

  it('a risk with a cause drawn in and no onward edge is in; a cause drawn only into it joins', () => {
    const x = g([...base, { id: 'exo', kind: 'factor', category: 'external' }], [['opt', 'f'], ['f', 'goal'], ['f', 'r'], ['exo', 'r']]);
    expect([...inertRiskBranch(x.nodes, x.edges, [])].sort()).toEqual(['exo', 'r']);
  });

  it('CONTROL (CI: dual-draft G12): a risk with NO edge at all states nothing — never left out; it stays an ORPHAN_NODE', () => {
    const bare = g(base, [['opt', 'f'], ['f', 'goal']]);
    expect(inertRiskBranch(bare.nodes, bare.edges, []).has('r')).toBe(false);
    const graph = { nodes: [...base.map((n) => ({ ...n, label: n.id })), { id: 'dec', kind: 'decision', label: 'd' }, { id: 'opt2', kind: 'option', label: 'o2' }],
      edges: [{ from: 'dec', to: 'opt' }, { from: 'dec', to: 'opt2' }, { from: 'opt', to: 'f' }, { from: 'opt2', to: 'f' }, { from: 'f', to: 'goal' }] };
    expect(validateGraphStructure(graph as never, { leaveOutInertRisks: true }).violations.map((v) => `${v.code} ${v.detail.match(/^Node "([^"]+)"/)?.[1]}`)).toEqual(['ORPHAN_NODE r']);
  });

  it('CONTROL (DL condition 1): an option whose ONLY path runs through the risk stays REFUSED — never a silent "no effect"', () => {
    const x = g(base, [['opt', 'f'], ['f', 'r']]);
    expect(inertRiskBranch(x.nodes, x.edges, []).has('f'), 'what an option acts on never joins').toBe(false);
    // A comparison that otherwise runs (opt2 → f2 → goal), so the refusal is bound to the stranded factor's IDENTITY (CODEX).
    const graph = { nodes: [...base.map((n) => ({ ...n, label: n.id })), { id: 'dec', kind: 'decision', label: 'd' }, { id: 'opt2', kind: 'option', label: 'o2' }, { id: 'f2', kind: 'factor', label: 'f2' }],
      edges: [{ from: 'dec', to: 'opt' }, { from: 'dec', to: 'opt2' }, { from: 'opt', to: 'f' }, { from: 'opt2', to: 'f2' }, { from: 'f2', to: 'goal' }, { from: 'f', to: 'r' }] };
    const noPath = validateGraphStructure(graph as never, { leaveOutInertRisks: true }).violations.filter((v) => v.code === 'NO_PATH_TO_GOAL');
    // The stranded option AND what it acts on are refused by name; the left-out risk and the working comparison are not.
    expect(noPath.map((v) => v.detail.match(/^Node "([^"]+)"/)?.[1])).toEqual(['opt', 'f']);
  });

  it('CONTROL: a dead-end FACTOR, a lever drawn only into the risk, a risk an option acts on, and a limited risk are never left out', () => {
    expect(inertRiskBranch(g(base, [['opt', 'f']]).nodes, g(base, [['opt', 'f']]).edges, []).has('f')).toBe(false);
    const lever = g([...base, { id: 'lev', kind: 'factor', category: 'controllable' }], [['lev', 'r']]);
    expect(inertRiskBranch(lever.nodes, lever.edges, []).has('lev')).toBe(false);
    expect(inertRiskBranch(g(base, [['opt', 'r']]).nodes, g(base, [['opt', 'r']]).edges, []).has('r')).toBe(false);
    expect(inertRiskBranch(g(base, [['f', 'r']]).nodes, g(base, [['f', 'r']]).edges, ['r']).has('r')).toBe(false);
  });
});
