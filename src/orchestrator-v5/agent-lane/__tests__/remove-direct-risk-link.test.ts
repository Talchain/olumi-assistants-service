/**
 * ⭐ A DIRECT OPTION→RISK LINK CAN BE REMOVED, WITH THE USER'S APPROVAL — the only way out of a block
 * the conversation could not otherwise clear.
 *
 * `buildAnalysisReadyPayload` (`cee/transforms/analysis-ready.ts`) holds every option with a direct,
 * non-bidirected edge to a RISK at `needs_user_mapping` — "a causal coefficient is not an intervention
 * level; other numeric effects cannot resolve this missing mapping". MEASURED on served `0415b19`
 * (witness g10, scenario `058f1f3e`): after one approval saved every value and level, the Run was refused
 * on three such links; the user answered the Agent's own question and `propose_model_change` could only
 * reply `already_present` ×3 — nothing approvable, the block permanent. 13/120 recent scenarios carry
 * such links (read-only, #63 5809906752).
 *
 * The removal goes through the product's own atomic `structural_delete` writer (edges only). The fake
 * below enforces that writer's rules: the base hash must be current and every named edge must exist.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { toolsFor } from '../runtime/agent-tools.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

const SCENARIO = '7d2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r' };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });

type Node = { id: string; kind: string; label: string };
const NODES: Node[] = [
  { id: 'margin', kind: 'goal', label: 'Gross margin' },
  { id: 'capacity', kind: 'factor', label: 'Assembly capacity' },
  { id: 'supplier_failure', kind: 'risk', label: 'Contract supplier failure' },
  { id: 'contract', kind: 'option', label: 'Contract Assembly' },
];
const EDGES = () => [edge('contract', 'capacity'), edge('contract', 'supplier_failure'), edge('capacity', 'margin'), edge('supplier_failure', 'margin')];

function product() {
  const events: Record<string, unknown>[] = [];
  let edges = EDGES();
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { kind: string; removed_node_ids: string[]; removed_edges: { from: string; to: string }[]; base_graph_hash: string };
      events.push(ev as unknown as Record<string, unknown>);
      if (ev.kind !== 'structural_delete') return { status: 400, json: {} };
      if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
      if (!ev.removed_edges.every((r) => edges.some((e) => e.from === r.from && e.to === r.to))) return { status: 422, json: { refusal_reason: 'edge_not_found' } };
      edges = edges.filter((e) => !ev.removed_edges.some((r) => r.from === e.from && r.to === e.to));
      rev += 1;
      return { status: 200, json: { assistant_text: 'Removed.', graph_hash: `h${rev}` } };
    }
    return { status: 200, json: { graph: { nodes: NODES, edges }, graph_hash: `h${rev}` } };
  };
  return { d, events, edges: () => edges };
}

describe('the Agent can propose removing a direct option→risk link, and one approval removes exactly it', () => {
  it('RED: propose → authorise → structural_delete of exactly that edge, on the current base; the risk and its own link stay', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const proposed = await caps.proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'The analysis cannot use a direct option-to-risk link.' });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(p.events, 'a proposal writes nothing').toEqual([]);

    const out = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.mutated).toBe(true);
    expect(p.events).toEqual([{ kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'contract', to: 'supplier_failure' }], base_graph_hash: 'h0' }]);
    expect(p.edges().map((e) => `${e.from}->${e.to}`)).toEqual(['contract->capacity', 'capacity->margin', 'supplier_failure->margin']);
  });

  it('CONTRAST: a link to a FACTOR is never removed by this capability — nothing is stored', async () => {
    const p = product();
    const store = new ProposalStore();
    const r = await createAgentCapabilities(p.d, store).proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Assembly capacity', rationale: 'x' });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('not_a_risk_link');
    expect(store.outstanding(SCENARIO, USER)).toEqual([]);
  });

  it('CONTRAST: a link that is not there → refused, nothing stored', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const first = await caps.proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    await caps.authoriseChange(ctx, { proposal_id: String(first.proposal_id) });
    const again = await caps.proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    expect(again.ok).toBe(false);
    expect(again.refusal).toBe('not_present');
  });

  it('a stale base refuses at write and reports nothing removed', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const proposed = await caps.proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    // The model moves between proposal and approval: the store refuses the proposal as superseded.
    await p.d('/orchestrate/v2/turn', { kind: 'system_event', event: { kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'capacity', to: 'margin' }], base_graph_hash: 'h0' } });
    const out = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.mutated).toBe(false);
    expect(p.edges().some((e) => e.from === 'contract' && e.to === 'supplier_failure'), 'the link is still there').toBe(true);
  });

  it('its proposal gets the typed one-click approve chip, and the tool is withheld from the read-only preview', () => {
    expect(approvalChipsFor([{ name: 'propose_remove_risk_link', ok: true, mutated: false, proposal_id: 'prop_abc123' }]).map((c) => [c.id, c.label, c.message]))
      .toEqual([
        ['agent-approve-proposal:prop_abc123', 'Remove this link', 'Yes, remove that link.'],
        ['agent-amend-proposal', 'Change something first', 'Before you apply it, I want to change some of it.'],
      ]);
    expect(toolsFor('full').map((t) => t.name)).toContain('propose_remove_risk_link');
    expect(toolsFor('preview').map((t) => t.name)).not.toContain('propose_remove_risk_link');
  });
});

/**
 * ⛔ THE LINK REMOVED IS THE ONE THE USER NAMED (Codex #1816, CHANGES_REQUIRED at df304a57): the first
 * label-OR-description match won, so an earlier option DESCRIBED as "Contract Assembly" could beat the option
 * LABELLED it, and two same-labelled risks resolved arbitrarily. An exact visible label wins; a description
 * is only a fallback; any ambiguity refuses before a proposal exists.
 */
describe('the endpoints are the ones the user named', () => {
  const productWith = (nodes: { id: string; kind: string; label: string; description?: string }[], edges: ReturnType<typeof edge>[]) => {
    const events: Record<string, unknown>[] = [];
    const d: InternalDispatch = async (path, body) => {
      const b = (body ?? {}) as Record<string, unknown>;
      if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') { events.push(b.event as Record<string, unknown>); return { status: 200, json: { graph_hash: 'h1' } }; }
      return { status: 200, json: { graph: { nodes, edges }, graph_hash: 'h0' } };
    };
    return { d, events };
  };
  const base = [{ id: 'margin', kind: 'goal', label: 'Gross margin' }, { id: 'supplier_failure', kind: 'risk', label: 'Contract supplier failure' }];

  it('RED: an earlier option DESCRIBED as the name never steals it from the option LABELLED it', async () => {
    const nodes = [...base,
      { id: 'decoy', kind: 'option', label: 'Outsource everything', description: 'Contract Assembly' },
      { id: 'contract', kind: 'option', label: 'Contract Assembly' }];
    const p = productWith(nodes, [edge('decoy', 'supplier_failure'), edge('contract', 'supplier_failure')]);
    const store = new ProposalStore();
    const r = await createAgentCapabilities(p.d, store).proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.get(String(r.proposal_id))?.operations).toEqual([{ op: 'remove_edge', path: 'contract::supplier_failure', value: { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure' } }]);
  });

  it('RED: two risks with the same label → refused as ambiguous, nothing stored', async () => {
    const nodes = [...base, { id: 'supplier_failure_2', kind: 'risk', label: 'Contract supplier failure' }, { id: 'contract', kind: 'option', label: 'Contract Assembly' }];
    const p = productWith(nodes, [edge('contract', 'supplier_failure'), edge('contract', 'supplier_failure_2')]);
    const store = new ProposalStore();
    const r = await createAgentCapabilities(p.d, store).proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('ambiguous_label');
    expect(store.outstanding(SCENARIO, USER)).toEqual([]);
  });

  it('RED: two options with the same label → refused as ambiguous, nothing stored', async () => {
    const nodes = [...base, { id: 'contract', kind: 'option', label: 'Contract Assembly' }, { id: 'contract_2', kind: 'option', label: 'Contract Assembly' }];
    const p = productWith(nodes, [edge('contract', 'supplier_failure'), edge('contract_2', 'supplier_failure')]);
    const store = new ProposalStore();
    const r = await createAgentCapabilities(p.d, store).proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('ambiguous_label');
    expect(store.outstanding(SCENARIO, USER)).toEqual([]);
  });

  it('CONTRAST: a description still resolves when no visible label matches, and it is unique', async () => {
    const nodes = [...base, { id: 'contract', kind: 'option', label: 'Option C', description: 'Contract Assembly' }];
    const p = productWith(nodes, [edge('contract', 'supplier_failure')]);
    const store = new ProposalStore();
    const r = await createAgentCapabilities(p.d, store).proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.get(String(r.proposal_id))?.operations).toEqual([{ op: 'remove_edge', path: 'contract::supplier_failure', value: { option_label: 'Option C', risk_label: 'Contract supplier failure' } }]);
  });
});

/**
 * ⛔ THE NAMES THE USER APPROVED ARE THE NAMES AT THE WRITE (Codex #1816, CHANGES_REQUIRED at 1ab2194e): the
 * proposal's base is the ANALYSIS hash, which excludes labels, so a risk renamed or swapped after the proposal
 * left it "unchanged" — and approving "remove the link to R" could delete the link to what is now called S.
 * The approved endpoint labels ride in the proposal (hashed into its id) and approval refuses if the stored
 * ids no longer bear them.
 */
describe('approval refuses when the named endpoints were renamed or swapped since the proposal', () => {
  const twoRisks = () => {
    let nodes = [
      { id: 'margin', kind: 'goal', label: 'Gross margin' },
      { id: 'r1', kind: 'risk', label: 'Contract supplier failure' },
      { id: 'r2', kind: 'risk', label: 'Quality escapes' },
      { id: 'contract', kind: 'option', label: 'Contract Assembly' },
    ];
    let edges = [edge('contract', 'r1'), edge('contract', 'r2'), edge('r1', 'margin'), edge('r2', 'margin')];
    const events: Record<string, unknown>[] = [];
    const d: InternalDispatch = async (path, body) => {
      const b = (body ?? {}) as Record<string, unknown>;
      if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
        const ev = b.event as { removed_edges: { from: string; to: string }[] };
        events.push(ev as unknown as Record<string, unknown>);
        edges = edges.filter((e) => !ev.removed_edges.some((r) => r.from === e.from && r.to === e.to));
        return { status: 200, json: { graph_hash: 'h0' } };
      }
      // The ANALYSIS hash ignores labels: a rename leaves it unchanged, exactly as in production.
      return { status: 200, json: { graph: { nodes, edges }, graph_hash: 'h0' } };
    };
    const swapLabels = () => { nodes = nodes.map((n) => n.id === 'r1' ? { ...n, label: 'Quality escapes' } : n.id === 'r2' ? { ...n, label: 'Contract supplier failure' } : n); };
    return { d, events, swapLabels, edges: () => edges };
  };

  it('RED: the two risks swap names after the proposal → approval refuses, nothing is deleted', async () => {
    const p = twoRisks();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const proposed = await caps.proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    p.swapLabels();
    const out = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.mutated).toBe(false);
    expect(p.events, 'no delete was sent').toEqual([]);
    expect(p.edges().filter((e) => e.from === 'contract').map((e) => e.to).sort()).toEqual(['r1', 'r2']);
  });

  it('CONTRAST: names unchanged → exactly the named link is removed', async () => {
    const p = twoRisks();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const proposed = await caps.proposeRemoveRiskLink(ctx, { option_label: 'Contract Assembly', risk_label: 'Contract supplier failure', rationale: 'x' });
    const out = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(p.edges().filter((e) => e.from === 'contract').map((e) => e.to)).toEqual(['r2']);
  });
});

/**
 * ⭐ THE REMOVAL IS WHAT UNBLOCKS — proven with the product's OWN readiness builder, not a restatement of it.
 * The same graph, with and without the one direct option→risk link: the first is `needs_user_mapping`, the
 * second is `ready`. Nothing else differs.
 */
describe('the canonical readiness builder: the direct risk link is the whole block', () => {
  const e = (from: string, to: string, extra: Record<string, unknown> = {}) => ({ id: `${from}__${to}`, from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive', ...extra });
  const graph = (withRiskLink: boolean) => ({
    version: '3', default_seed: 17,
    nodes: [
      { id: 'decision', kind: 'decision', label: 'How to assemble' },
      { id: 'margin', kind: 'goal', label: 'Gross margin' },
      { id: 'capacity', kind: 'factor', label: 'Assembly capacity', category: 'controllable', observed_state: { value: 0.5, raw_value: 50, cap: 100, unit: 'units' } },
      { id: 'supplier_failure', kind: 'risk', label: 'Contract supplier failure' },
      { id: 'contract', kind: 'option', label: 'Contract Assembly', interventions: { capacity: 0.7 } },
      { id: 'inhouse', kind: 'option', label: 'In-house', interventions: { capacity: 0.5 } },
    ],
    edges: [e('decision', 'contract'), e('decision', 'inhouse'), e('contract', 'capacity'), e('inhouse', 'capacity'), e('capacity', 'margin'),
      e('supplier_failure', 'margin', { effect_direction: 'negative' }), ...(withRiskLink ? [e('contract', 'supplier_failure')] : [])],
  });

  it('with the link: needs_user_mapping on exactly that option; without it: ready', () => {
    const before = buildCanonicalAnalysisReadyFromGraph(graph(true)) as { status?: string; options?: { label: string; status: string; unresolved_targets?: string[] }[] } | undefined;
    const after = buildCanonicalAnalysisReadyFromGraph(graph(false)) as { status?: string; options?: { label: string; status: string }[] } | undefined;
    expect(before?.status).toBe('needs_user_mapping');
    expect(before?.options?.find((o) => o.label === 'Contract Assembly')?.unresolved_targets).toEqual(['supplier_failure']);
    expect(before?.options?.find((o) => o.label === 'In-house')?.status, 'the control: the other option is fine').toBe('ready');
    expect(after?.status).toBe('ready');
    expect(after?.options?.every((o) => o.status === 'ready')).toBe(true);
  });
});
