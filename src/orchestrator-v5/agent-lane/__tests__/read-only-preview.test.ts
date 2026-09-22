/**
 * READ-ONLY preview — the boundary is structural, in three layers.
 *
 * ⛔ PROMPTING IS NOT A BOUNDARY. A model told not to change things is a model
 * that usually does not change things. So: the mutation tools are not declared,
 * `dispatchTool` refuses their names even if the model invents them, and the
 * capabilities refuse as well. Each layer is tested on its own, because a test
 * that only exercises the outermost one passes while the inner two rot.
 */

import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, MUTATION_TOOLS, toolsFor, dispatchTool } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const ctx = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'u', request_id: 'r' };

const GRAPH = {
  nodes: [
    { id: 'a', kind: 'factor', label: 'Competitive pricing' },
    { id: 'b', kind: 'factor', label: 'Monthly churn' },
  ],
  edges: [] as { from: string; to: string }[],
};

/** Records every internal call, so "nothing was written" is checked, not assumed. */
function spyDispatch() {
  const posted: string[] = [];
  const d: InternalDispatch = async (path, body) => {
    posted.push(`${path}:${(body as { kind?: string })?.kind ?? ''}`);
    return { status: 200, json: { graph: GRAPH, graph_hash: 'h0' } };
  };
  return { d, posted };
}

describe('layer 1 — the tool is not declared', () => {
  it('omits every mutation tool in preview', () => {
    const names = toolsFor('preview').map((t) => t.name);
    for (const m of MUTATION_TOOLS) expect(names, `${m} must not be offered`).not.toContain(m);
  });

  it('still offers them in full mode — the contrast control', () => {
    const names = toolsFor('full').map((t) => t.name);
    for (const m of MUTATION_TOOLS) expect(names).toContain(m);
    expect(names.length).toBe(AGENT_TOOLS.length);
  });

  it('keeps the read and build tools, or the preview has nothing to do', () => {
    const names = toolsFor('preview').map((t) => t.name);
    expect(names).toContain('get_canonical_state');
    expect(names).toContain('build_model_from_brief');
    expect(names).toContain('run_analysis');
  });
});

describe('layer 2 — dispatch refuses the name even if the model invents it', () => {
  it('refuses propose_model_change without reaching the capability', async () => {
    const { d, posted } = spyDispatch();
    let capabilityRan = false;
    const caps = {
      ...createAgentCapabilities(d, new ProposalStore()),
      proposeModelChange: async () => { capabilityRan = true; return { ok: true, mutated: true }; },
    };
    const r = await dispatchTool('propose_model_change', '{"from_label":"Competitive pricing","to_label":"Monthly churn","direction":"negative","rationale":"x"}', ctx, caps as never, 'preview');
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('read_only_preview');
    expect(r.mutated).toBe(false);
    expect(capabilityRan, 'dispatch must refuse BEFORE the capability').toBe(false);
    expect(posted, 'nothing may be posted to the product').toEqual([]);
  });

  it('refuses authorise_change the same way', async () => {
    const { d } = spyDispatch();
    const r = await dispatchTool('authorise_change', '{"proposal_id":"prop_x"}', ctx, createAgentCapabilities(d, new ProposalStore()) as never, 'preview');
    expect(r.refusal).toBe('read_only_preview');
  });

  it('lets them through in full mode — the contrast control', async () => {
    const { d } = spyDispatch();
    const caps = createAgentCapabilities(d, new ProposalStore());
    const r = await dispatchTool('propose_model_change', '{"from_label":"Competitive pricing","to_label":"Monthly churn","direction":"negative","rationale":"x"}', ctx, caps, 'full');
    expect(r.refusal).not.toBe('read_only_preview');
  });
});

describe('layer 3 — the capability itself refuses', () => {
  it('refuses a direct call that bypasses the tool surface entirely', async () => {
    const { d, posted } = spyDispatch();
    const caps = createAgentCapabilities(d, new ProposalStore(), undefined, 'preview');
    const p = await caps.proposeModelChange(ctx, { from_label: 'Competitive pricing', to_label: 'Monthly churn', direction: 'negative', rationale: 'x' });
    const a = await caps.authoriseChange(ctx, { proposal_id: 'prop_x' });
    expect(p.refusal).toBe('read_only_preview');
    expect(a.refusal).toBe('read_only_preview');
    expect(posted).toEqual([]);
  });

  it('leaves the READ path working in preview', async () => {
    const { d } = spyDispatch();
    const caps = createAgentCapabilities(d, new ProposalStore(), undefined, 'preview');
    const r = await caps.getCanonicalState(ctx);
    expect(r.ok).toBe(true);
    expect(r.mutated).toBe(false);
    expect(r.structure).toBeDefined();
  });
});
