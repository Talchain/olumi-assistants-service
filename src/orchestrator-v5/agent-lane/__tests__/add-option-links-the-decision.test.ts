/**
 * ⛔ AN APPROVED NEW OPTION MUST BE SELECTABLE BY THE DECISION (served `52453d3`, witness c14,
 * scenario 8efc70af).
 *
 * Measured: `propose_new_option` + `authorise_change` wrote the option and its option → factor
 * links, and NOTHING from the decision — so readiness blocked with OPTION_NOT_LINKED_TO_DECISION
 * ("An option is not connected from the decision") straight after the user approved. The recovery
 * the user found (`propose_model_change` decision → option) then landed the link as a CAUSAL edge
 * (mean 0.5, std 0.1, p 0.8) and disclosed a "placeholder strength" for a link that has no strength
 * to state: every constructor-built decision → option edge carries `STRUCTURAL_EDGE_DEFAULTS`.
 *
 * ⭐ THE FAKE PRODUCT RUNS THE REAL WRITERS. `structural_add` and `structural_add_edge` are served
 * by `applyStructuralAdd` / `applyStructuralAddEdge` over a GraphV3 held in memory, hashed with the
 * product's own `computeAnalysisAffectingGraphHash` — so the base-hash gate, the endpoint gate, the
 * duplicate gate and the edge values are the served writer's, not a shape this file invented. The
 * readiness verdict is the canonical builder's, over the bytes those writers persisted.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_EXISTS_PROBABILITY, DEFAULT_STD } from '@talchain/schemas';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { applyStructuralAdd } from '../../system-events/structural-add.js';
import { applyStructuralAddEdge } from '../../system-events/structural-add-edge.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' };

type Edge = {
  from: string; to: string;
  strength: { mean: number; std: number };
  exists_probability: number; effect_direction: string;
  provenance?: { source?: string };
};
type Graph = { nodes: { id: string; kind: string; label: string }[]; edges: Edge[] } & Record<string, unknown>;

const topo = (from: string, to: string): Edge => ({ from, to, ...STRUCTURAL_EDGE_DEFAULTS, strength: { ...STRUCTURAL_EDGE_DEFAULTS.strength } });

/** A constructor-shaped model: one decision selecting two options, each acting on a factor. */
function modelWithDecision(): Graph {
  return {
    schema_version: '3.0',
    goal_node_id: 'goal',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Increase delivery velocity' },
      { id: 'dec', kind: 'decision', label: 'How to add capacity' },
      { id: 'opt_hire', kind: 'option', label: 'Hire two developers', interventions: { dev_headcount: { value: 0.6, raw_value: 12 } } },
      { id: 'opt_keep', kind: 'option', label: 'Keep the current team', interventions: { dev_headcount: { value: 0.5, raw_value: 10 } } },
      { id: 'dev_headcount', kind: 'factor', label: 'Developer headcount', category: 'controllable', observed_state: { value: 0.5, raw_value: 10, cap: 20 } },
      { id: 'lead_time', kind: 'factor', label: 'Lead time', category: 'observable', observed_state: { value: 0.4, raw_value: 8, cap: 20 } },
    ] as Graph['nodes'],
    edges: [
      topo('dec', 'opt_hire'),
      topo('dec', 'opt_keep'),
      topo('opt_hire', 'dev_headcount'),
      topo('opt_keep', 'dev_headcount'),
      { from: 'dev_headcount', to: 'goal', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'lead_time', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  };
}

/** The same model with no decision node — the shape where there is nothing to link from. */
function modelWithoutDecision(): Graph {
  const g = modelWithDecision();
  return { ...g, nodes: g.nodes.filter((n) => n.kind !== 'decision'), edges: g.edges.filter((e) => e.from !== 'dec') };
}

function realWriterProduct(initial: Graph) {
  let graph: Graph = structuredClone(initial);
  let refuseOnce: string | null = null;
  const writes: string[] = [];
  const hash = (): string => {
    const h = computeAnalysisAffectingGraphHash(graph as never);
    if (h === null) throw new Error('fixture is unhashable — the fixture is wrong, not the code');
    return h;
  };
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      const payload = { kind: 'system_event', turn_id: b.turn_id, scenario_id: SCENARIO, stage: 'frame', event: ev } as unknown as SystemEventTurnPayload;
      const key = `${String(ev.kind)}:${String(ev.from ?? ev.node_id)}::${String(ev.to ?? '')}`;
      // As the served route does on a refusal: the reply, and the CURRENT hash, and no write.
      if (refuseOnce === key) { refuseOnce = null; return { status: 200, json: { assistant_text: 'That link was refused.', graph_hash: hash() } }; }
      const r = ev.kind === 'structural_add'
        ? applyStructuralAdd({ payload, event: ev as never, requestId: 'req', persistedGraph: graph })
        : ev.kind === 'structural_add_edge'
          ? applyStructuralAddEdge({ payload, event: ev as never, requestId: 'req', persistedGraph: graph })
          : null;
      if (r === null) throw new Error(`the fake has no writer for ${String(ev.kind)}`);
      if (r.kind === 'refused') return { status: 200, json: { ...r.response, refused: r.reason, graph_hash: hash() } };
      graph = structuredClone(r.mutatedGraph) as Graph;
      writes.push(key);
      return { status: 200, json: { ...r.response, graph_hash: hash() } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) return { status: 200, json: { graph, graph_hash: hash() } };
    throw new Error(`the fake does not serve ${path}`);
  };
  return { d, graph: () => graph, writes, refuseNext: (k: string) => { refuseOnce = k; } };
}

const ASK = {
  label: 'Hire a contractor',
  acts_on: [
    { factor_label: 'Developer headcount', direction: 'positive' as const },
    { factor_label: 'Lead time', direction: 'negative' as const },
  ],
  rationale: 'a faster route to capacity',
};

const addedOptionId = (g: Graph): string => {
  const o = g.nodes.find((n) => n.kind === 'option' && n.label === ASK.label);
  if (o === undefined) throw new Error('the approved option is not in the persisted graph');
  return o.id;
};
const decisionLinkViolations = (g: Graph, optionId: string) =>
  validateGraphStructure(g as never).violations
    .filter((v) => v.code === 'OPTION_NOT_LINKED_TO_DECISION' && v.detail.includes(`"${optionId}"`));

describe('one approval adds the option AND the decision → option link', () => {
  it('RED: the persisted decision → option edge carries STRUCTURAL_EDGE_DEFAULTS, and readiness no longer reports OPTION_NOT_LINKED_TO_DECISION', async () => {
    const p = realWriterProduct(modelWithDecision());
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    expect(prop.ok, JSON.stringify(prop)).toBe(true);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied, JSON.stringify(applied).slice(0, 400)).toMatchObject({ ok: true, applied: true });

    const g = p.graph();
    const optionId = addedOptionId(g);
    const link = g.edges.find((e) => e.from === 'dec' && e.to === optionId);
    expect(link, 'the decision must select the new option').toBeDefined();
    expect(link!.strength.mean).toBe(STRUCTURAL_EDGE_DEFAULTS.strength.mean);
    expect(link!.strength.std).toBe(STRUCTURAL_EDGE_DEFAULTS.strength.std);
    expect(link!.exists_probability).toBe(STRUCTURAL_EDGE_DEFAULTS.exists_probability);
    expect(link!.effect_direction).toBe(STRUCTURAL_EDGE_DEFAULTS.effect_direction);

    // The structural validator, bound to THIS option by id.
    expect(decisionLinkViolations(g, optionId)).toEqual([]);
    // The canonical readiness authority, over the persisted bytes.
    const wire = buildCanonicalAnalysisReadyFromGraph(g);
    const codes = (wire?.readiness_issues ?? []).map((i) => i.code);
    expect(codes).not.toContain('OPTION_NOT_LINKED_TO_DECISION');
    // ⭐ CONTRAST CONTROL, same run: the probe DOES see this option — it still needs its levels.
    expect((wire?.readiness_issues ?? []).some((i) => i.option_id === optionId), JSON.stringify(wire?.readiness_issues)).toBe(true);
  });

  it('CONTRAST: the option → factor links are unchanged — the stated direction, the causal defaults', async () => {
    const p = realWriterProduct(modelWithDecision());
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    const g = p.graph();
    const optionId = addedOptionId(g);
    const byTo = Object.fromEntries(g.edges.filter((e) => e.from === optionId).map((e) => [e.to, e]));
    expect(Object.keys(byTo).sort()).toEqual(['dev_headcount', 'lead_time']);
    expect(byTo.dev_headcount.strength.mean).toBe(0.5);
    expect(byTo.lead_time.strength.mean).toBe(-0.5);
    for (const e of [byTo.dev_headcount, byTo.lead_time]) {
      expect(e.strength.std).toBe(DEFAULT_STD);
      expect(e.exists_probability).toBe(DEFAULT_EXISTS_PROBABILITY);
    }
  });

  it('CONTROL: without the fix’s link the SAME graph reports OPTION_NOT_LINKED_TO_DECISION for the new option — the probe can fail', async () => {
    const p = realWriterProduct(modelWithDecision());
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    const g = p.graph();
    const optionId = addedOptionId(g);
    const stripped = { ...g, edges: g.edges.filter((e) => !(e.from === 'dec' && e.to === optionId)) };
    expect(decisionLinkViolations(stripped, optionId)).toHaveLength(1);
    expect((buildCanonicalAnalysisReadyFromGraph(stripped)?.readiness_issues ?? []).map((i) => i.code)).toContain('OPTION_NOT_LINKED_TO_DECISION');
  });

  it('RED: a refused decision link is a named partial; approving the same proposal again lands ONLY that link', async () => {
    // The option id is minted at propose time and never shown to the Agent, so the refusal is
    // armed on the decision end: the FIRST decision → option write is refused, as the served route refuses.
    const p2 = realWriterProduct(modelWithDecision());
    const store2 = new ProposalStore();
    let armed = true;
    const guarded: InternalDispatch = async (path, body) => {
      const ev = ((body ?? {}) as { event?: { kind?: string; from?: string; to?: string } }).event;
      if (armed && ev?.kind === 'structural_add_edge' && ev.from === 'dec') { armed = false; p2.refuseNext(`structural_add_edge:dec::${String(ev.to)}`); }
      return p2.d(path, body);
    };
    const caps2 = createAgentCapabilities(guarded, store2);
    const prop2 = await caps2.proposeNewOption(ctx, ASK);
    const partial = await caps2.authoriseChange(ctx, { proposal_id: String(prop2.proposal_id) });
    expect(partial, JSON.stringify(partial).slice(0, 400)).toMatchObject({ ok: false, applied: false, mutated: true });
    expect(JSON.stringify(partial.not_linked)).toContain('How to add capacity');
    const optionId = addedOptionId(p2.graph());
    expect(p2.graph().edges.some((e) => e.from === 'dec' && e.to === optionId)).toBe(false);
    const writesAfterPartial = [...p2.writes];

    const retry = await caps2.authoriseChange(ctx, { proposal_id: String(prop2.proposal_id) });
    expect(retry, JSON.stringify(retry).slice(0, 400)).toMatchObject({ ok: true, applied: true });
    expect(p2.graph().nodes.filter((n) => n.kind === 'option' && n.label === ASK.label)).toHaveLength(1);
    expect(p2.writes.slice(writesAfterPartial.length), 'only the missing link was written').toEqual([`structural_add_edge:dec::${optionId}`]);
    expect(decisionLinkViolations(p2.graph(), optionId)).toEqual([]);
  });
});

describe('a model with no decision keeps today’s behaviour, and says so', () => {
  it('RED: the option and its factor links land, no decision link is attempted, and the result says why', async () => {
    const p = realWriterProduct(modelWithoutDecision());
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    expect(prop.ok, JSON.stringify(prop)).toBe(true);
    expect(String(prop.decision_link)).toMatch(/no decision/i);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied, JSON.stringify(applied).slice(0, 400)).toMatchObject({ ok: true, applied: true });
    const optionId = addedOptionId(p.graph());
    expect(p.writes).toEqual([
      `structural_add:${optionId}::`,
      `structural_add_edge:${optionId}::dev_headcount`,
      `structural_add_edge:${optionId}::lead_time`,
    ]);
    expect(String(applied.decision_link)).toMatch(/no decision/i);
  });
});

describe('the user’s own recovery — propose_model_change decision → option', () => {
  const unlinkedOption = (): Graph => {
    const g = modelWithDecision();
    g.nodes.push({ id: 'opt_contract', kind: 'option', label: 'Hire a contractor' });
    g.edges.push({ from: 'opt_contract', to: 'lead_time', strength: { mean: -0.5, std: DEFAULT_STD }, exists_probability: DEFAULT_EXISTS_PROBABILITY, effect_direction: 'negative' });
    return g;
  };

  it('RED: lands as topology and is NOT disclosed as a placeholder strength', async () => {
    const p = realWriterProduct(unlinkedOption());
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeModelChange(ctx, { from_label: 'How to add capacity', to_label: 'Hire a contractor', direction: 'positive', rationale: 'r' });
    expect(prop.ok, JSON.stringify(prop)).toBe(true);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.ok, JSON.stringify(applied).slice(0, 400)).toBe(true);
    const link = p.graph().edges.find((e) => e.from === 'dec' && e.to === 'opt_contract');
    expect(link?.strength.mean).toBe(STRUCTURAL_EDGE_DEFAULTS.strength.mean);
    expect(link?.exists_probability).toBe(STRUCTURAL_EDGE_DEFAULTS.exists_probability);
    expect(applied.placeholder_strength).not.toBe(true);
    expect(String(applied.not_represented ?? '')).not.toMatch(/placeholder/i);
  });

  it('CONTRAST: a causal link the user states by direction only is still disclosed as a placeholder', async () => {
    const p = realWriterProduct(unlinkedOption());
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeModelChange(ctx, { from_label: 'Lead time', to_label: 'Developer headcount', direction: 'negative', rationale: 'r' });
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.ok, JSON.stringify(applied).slice(0, 400)).toBe(true);
    expect(applied.placeholder_strength).toBe(true);
    const link = p.graph().edges.find((e) => e.from === 'lead_time' && e.to === 'dev_headcount');
    expect(link?.exists_probability).toBe(DEFAULT_EXISTS_PROBABILITY);
  });
});
