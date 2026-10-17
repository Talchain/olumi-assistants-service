import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { dispatchTool, AGENT_TOOLS } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import * as door from '../../statement-door/read.js';

const quote = 'Evening opening might add between 4 and 7 percentage points to weekday attendance, only if transport is available; our curator disputes that estimate.';
const graph = { nodes: [
  { id: 'opening', kind: 'factor', label: 'Evening opening' },
  { id: 'attendance', kind: 'goal', label: 'Weekday attendance' },
], edges: [{ from: 'opening', to: 'attendance', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] };
const ctx = { scenario_id: '11111111-1111-4111-8111-111111111111', authenticated_user_id: null, request_id: 'reading-plumbing',
  user_text: quote, user_turn_text: quote, user_text_complete: true };
afterEach(() => vi.restoreAllMocks());

describe('statement reading transport to the existing owner, without interpretation', () => {
  it.each([
    { form: 'range', low: -7, high: -4, unit: 'percentage points', negated: true },
    { form: 'range', value: 0, low: 4, high: 7, unit: 'points', negated: false },
    { form: 'range', low: 4, high: 7, unit: 'points' },
  ])('passes the complete source and AI fields unchanged: %j', async reading => {
    const calls: string[] = [], spy = vi.spyOn(door, 'readStatement');
    const caps = createAgentCapabilities(async path => {
      calls.push(path);
      if (!path.endsWith('/graph')) throw new Error(`No write or Run is authorised in this transport test: ${path}`);
      return { status: 200, json: { graph } };
    }, new ProposalStore());
    const result = await dispatchTool('propose_statement', JSON.stringify({
      subject: { kind: 'link', id: 'opening', to_id: 'attendance', label: 'Evening opening', to_label: 'Weekday attendance', field: 'effect' },
      statements: [{ quote, ...reading, ignored_field: 'never forwarded' }],
    }), ctx, caps);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![3]).toEqual([{ quote, ...reading }]);
    expect(result.mutated).toBe(false);
    expect(calls).toEqual([`/assist/v1/scenarios/${ctx.scenario_id}/graph`]);
  });

  it('keeps the five reading fields optional and preserves AIE quantity, reference and negation guidance', () => {
    const tool = AGENT_TOOLS.find(t => t.name === 'propose_statement')!;
    const item = (tool.parameters as { properties: { statements: { items: { properties: Record<string, { description: string; enum?: string[] }>; required: string[] } } } }).properties.statements.items;
    expect(item.required).toEqual(['quote']);
    expect(item.properties.form).toBeDefined();
    expect(item.properties.form!.enum).toEqual(['range']);
    expect(item.properties.form!.description).toContain('with the stated reference and conditions');
    expect(item.properties.unit!.description).toContain('wherever it occurs in the statement');
    expect(item.properties.negated!.description).toContain('a denied range is not a positive supplied effect range');
  });
});
