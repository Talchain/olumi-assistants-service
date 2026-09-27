/**
 * Executable catalogue contract (#70 5858459113). These are TEST expectations,
 * never a runtime registry. Dispatch checks alone are not writer evidence;
 * agent-capability-lifecycle.test.ts exercises the real product writer.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_TOOLS, dispatchTool, toolsFor, type AgentCapabilities, type AgentToolContext } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const rows = [
  ['get_canonical_state', 'read', 'getCanonicalState'],
  ['propose_model_change', 'proposal', 'proposeModelChange'],
  ['authorise_change', 'approval', 'authoriseChange'],
  ['run_analysis', 'analysis', 'runAnalysis'],
  ['build_model_from_brief', 'construction', 'buildModelFromBrief'],
  ['propose_assumptions', 'proposal', 'proposeAssumptions'],
  ['propose_new_option', 'proposal', 'proposeNewOption'],
  ['propose_link_strength', 'proposal', 'proposeLinkStrength'],
  ['propose_goal_target', 'proposal', 'proposeGoalTarget'],
  ['propose_new_risk', 'proposal', 'proposeNewRisk'],
  ['propose_limit_change', 'proposal', 'proposeLimitChange'],
  ['propose_option_interventions', 'proposal', 'proposeOptionInterventions'],
  ['propose_starting_point', 'proposal', 'proposeStartingPoint'],
  ['propose_goal_current_level', 'proposal', 'proposeGoalCurrentLevel'],
  ['offer_public_research', 'research', null],
  ['give_provisional_view', 'reasoning', 'giveProvisionalView'],
] as const satisfies readonly (readonly [string, string, keyof AgentCapabilities | null])[];

const ctx: AgentToolContext = {
  scenario_id: '11111111-1111-4111-8111-111111111111',
  authenticated_user_id: 'owner', request_id: 'capability-contract',
};
const mutationRows = rows.filter(([, category]) => category === 'proposal' || category === 'approval');
const noDispatch = vi.fn<InternalDispatch>(async () => { throw new Error('Unexpected product dispatch'); });

describe('capability catalogue and dispatch (not a writer simulation)', () => {
  it('every declared tool is classified exactly once, and every classification still exists', () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice().sort()).toEqual(rows.map(([name]) => name).sort());
  });

  it.each(rows.filter((r) => r[2] !== null))('%s dispatches to its named capability with server-bound identity', async (name, _category, method) => {
    const caps = createAgentCapabilities(noDispatch, new ProposalStore());
    const result = { ok: true, mutated: false, marker: name };
    const called = vi.spyOn(caps, method!).mockResolvedValue(result);
    // Deliberately hostile extra identity fields: dispatch must retain the turn's context.
    const args = { scenario_id: 'other-scenario', authenticated_user_id: 'other-user', marker: name };
    try {
      expect(await dispatchTool(name, JSON.stringify(args), ctx, caps)).toBe(result);
      expect(called).toHaveBeenCalledTimes(1);
      expect(called.mock.calls[0]?.[0]).toBe(ctx);
      if (name !== 'get_canonical_state') expect(called.mock.calls[0]?.[1]).toEqual(args);
    } finally { called.mockRestore(); }
  });

  it('an unknown name fails closed rather than claiming an executable capability', async () => {
    const caps = createAgentCapabilities(noDispatch, new ProposalStore());
    expect(await dispatchTool('compare_scenarios_not_implemented', '{}', ctx, caps))
      .toMatchObject({ ok: false, mutated: false, refusal: 'unknown_tool' });
  });

  it('research offers a bounded query for a non-decision investigation; it has not searched or changed a model', async () => {
    const query = 'evidence about causes of employee burnout';
    const caps = createAgentCapabilities(noDispatch, new ProposalStore());
    expect(await dispatchTool('offer_public_research', JSON.stringify({ query }), ctx, caps))
      .toMatchObject({ ok: true, mutated: false, offered_query: query });
    expect(noDispatch).not.toHaveBeenCalled();
  });

  it.each(mutationRows)('%s is absent in preview, refused by dispatch and refused by the real capability', async (name, _category, method) => {
    expect(toolsFor('full').map((t) => t.name)).toContain(name);
    expect(toolsFor('preview').map((t) => t.name)).not.toContain(name);
    const caps = createAgentCapabilities(noDispatch, new ProposalStore(), undefined, 'preview');
    const expected = { ok: false, mutated: false, refusal: 'read_only_preview' };
    expect(await dispatchTool(name, '{}', ctx, caps, 'preview')).toMatchObject(expected);
    // Bypass the outer dispatcher deliberately: the real inner guard must also hold.
    const capability = caps[method!] as (c: AgentToolContext, a: Record<string, unknown>) => Promise<unknown>;
    expect(await capability(ctx, {})).toMatchObject(expected);
    expect(noDispatch).not.toHaveBeenCalled();
  });

  it('the approved preview exception is construction, not an edit capability', () => {
    expect(toolsFor('preview').map((t) => t.name)).toEqual([
      'get_canonical_state', 'run_analysis', 'build_model_from_brief', 'offer_public_research', 'give_provisional_view',
    ]);
  });
});

describe('raw arguments reach production dispatch without a test validator', () => {
  const read: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'base' } });
  it('syntactically invalid JSON returns an explicit refusal', async () => {
    const caps = createAgentCapabilities(read, new ProposalStore());
    expect(await dispatchTool('authorise_change', '{', ctx, caps))
      .toMatchObject({ ok: false, mutated: false, refusal: 'unparsable_arguments' });
  });
  it.each(['authorise_change', 'offer_public_research'])('%s refuses JSON null without throwing or writing', async (name) => {
    const caps = createAgentCapabilities(read, new ProposalStore());
    await expect(dispatchTool(name, 'null', ctx, caps)).resolves.toMatchObject({ ok: false, mutated: false });
  });
});

describe('new-option declaration and capability type agree (ordinary RED until Runtime repairs it)', () => {
  const file = ts.createSourceFile('agent-tools.ts', readFileSync(new URL('../runtime/agent-tools.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const contract = file.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'AgentCapabilities')!;
  const method = contract.members.find((m): m is ts.MethodSignature => ts.isMethodSignature(m) && m.name.getText(file) === 'proposeNewOption')!;
  // This intentionally checks the existing interface, not a second schema/validator.
  const properties = (node: ts.TypeNode | undefined): readonly ts.TypeElement[] => node && ts.isTypeLiteralNode(node) ? node.members : [];
  const property = (node: ts.TypeNode | undefined, name: string) => properties(node)
    .find((m): m is ts.PropertySignature => ts.isPropertySignature(m) && m.name.getText(file) === name)?.type;
  const element = (node: ts.TypeNode | undefined) => node && ts.isArrayTypeNode(node) ? node.elementType : undefined;
  const args = method.parameters[1]?.type;

  it.each(['single', 'multiple'] as const)('%s option arguments retain the declared level fields', (shape) => {
    const owner = shape === 'single' ? args : element(property(args, 'options'));
    const level = property(element(property(owner, 'acts_on')), 'level');
    const tool = AGENT_TOOLS.find((t) => t.name === 'propose_new_option')!;
    const declared = tool.parameters as { properties: { acts_on: { items: { properties: { level: { properties: Record<string, unknown> } } } } } };
    const expected = Object.keys(declared.properties.acts_on.items.properties.level.properties).sort();
    expect(expected).toEqual(['basis', 'estimate', 'unit', 'value']);
    expect(properties(level).map((m) => m.name?.getText(file)).sort(), 'Runtime owner: AgentCapabilities.proposeNewOption drops the declared level type')
      .toEqual(expected);
  });
});
