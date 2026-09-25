/**
 * ⭐ `get_canonical_state` SHOWS WHAT EACH OPTION SETS, AS STORED (Canonical State RCA D1, #69 5833317225).
 *
 * Paul's PA-hiring test on served `d5d5839` (scenario `34276a19`): the canvas held one level per option and
 * factor, and the chat quoted different figures (£38k vs £39k; "20 h/wk" vs "salary 20,000"). The chat's
 * figures were the Agent's own earlier tool arguments: `projectEntity` projected values, units and ranges but
 * NO option levels, so the one read the Agent has of the model never said what an option already sets, and the
 * build prompt asked for "the level each option sets" on every pair.
 *
 * Pinned here: every stored cell comes back in the user's units by the SAME range the writer divides by
 * (`observed_state.cap`, else `scale_frame`, else none), with who set it; a cell with no number is left out;
 * non-options carry no `levels`; and the prompt tells the Agent to quote stored levels and not re-propose them.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createAgentCapabilities, projectOptionLevels, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '34276a19-0000-4000-8000-000000000001';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

/** The served PA shape: a capped salary factor, a hours factor framed by `scale_frame`, an unframed 0..1 share. */
const PA_GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Free up founder time' },
    { id: 'annual_pa_salary', kind: 'factor', label: 'Annual PA salary', observed_state: { value: 0.35, raw_value: 35000, cap: 100000, unit: 'GBP/year' } },
    { id: 'pa_hours', kind: 'factor', label: 'PA hours per week', scale_frame: 40, observed_state: { value: 0, raw_value: 0, unit: 'h/wk' } },
    { id: 'delegated_share', kind: 'factor', label: 'Share of admin delegated', observed_state: { value: 0.1 } },
    { id: 'hire_pa', kind: 'option', label: 'Hire PA', interventions: {
      annual_pa_salary: { value: 0.39, source: 'user_specified' },
      pa_hours: { value: 1, source: 'cee_hypothesis' },
      delegated_share: { value: 0.6, source: 'cee_hypothesis' },
    } },
    { id: 'part_time_pa', kind: 'option', label: 'Part-time PA', interventions: {
      annual_pa_salary: { value: 0.2, source: 'cee_hypothesis' },
      pa_hours: { value: 0.5 },
      delegated_share: { source: 'cee_hypothesis' },
    } },
    { id: 'continue_without_pa', kind: 'option', label: 'Continue without a PA', is_baseline: true },
  ],
  edges: [],
};

function capsOver(graph: unknown = PA_GRAPH) {
  const d: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'h0' } });
  return createAgentCapabilities(d, new ProposalStore());
}

describe('get_canonical_state shows each option’s stored levels (RCA D1)', () => {
  it('RED: every stored cell, in the user’s units by the writer’s own range, with who set it', async () => {
    const r = await capsOver().getCanonicalState(ctx as never);
    expect(r.ok).toBe(true);
    const entities = r.entities as { id: string; levels?: Record<string, unknown>[] }[];
    const hire = entities.find((e) => e.id === 'hire_pa');
    expect(hire?.levels, 'the option carries its stored levels').toBeDefined();
    const byFactor = Object.fromEntries((hire!.levels ?? []).map((l) => [l.factor_id as string, l]));
    // cap 100000: 0.39 is £39,000 — the figure the canvas draws, not the Agent's earlier argument.
    expect(byFactor.annual_pa_salary).toMatchObject({ factor: 'Annual PA salary', unit: 'GBP/year', set_by: 'user_specified' });
    expect(byFactor.annual_pa_salary!.level as number).toBeCloseTo(39000, 6);
    // no cap, scale_frame 40: 1 is 40 h/wk.
    expect(byFactor.pa_hours).toMatchObject({ factor: 'PA hours per week', unit: 'h/wk', set_by: 'cee_hypothesis' });
    expect(byFactor.pa_hours!.level as number).toBeCloseTo(40, 6);
    // no range at all: a 0..1 level is stored as given, so it is shown as given.
    expect(byFactor.delegated_share!.level as number).toBeCloseTo(0.6, 6);
  });

  it('RED: a cell with no number is left out (never a zero); a cell with no source carries no set_by', async () => {
    const r = await capsOver().getCanonicalState(ctx as never);
    const part = (r.entities as { id: string; levels?: Record<string, unknown>[] }[]).find((e) => e.id === 'part_time_pa');
    const ids = (part?.levels ?? []).map((l) => l.factor_id);
    expect(ids).toEqual(['annual_pa_salary', 'pa_hours']);
    const hours = part!.levels!.find((l) => l.factor_id === 'pa_hours')!;
    expect(hours.level as number).toBeCloseTo(20, 6);
    expect('set_by' in hours).toBe(false);
  });

  it('CONTRAST: factors, the goal and an option that sets nothing carry no `levels`', async () => {
    const r = await capsOver().getCanonicalState(ctx as never);
    const entities = r.entities as { id: string; levels?: unknown }[];
    for (const id of ['goal', 'annual_pa_salary', 'pa_hours', 'continue_without_pa']) {
      expect('levels' in entities.find((e) => e.id === id)!, id).toBe(false);
    }
  });

  it('ROUND TRIP: the writer’s range and the reader’s range are one rule (raw → raw / range → raw)', () => {
    const factors = new Map(PA_GRAPH.nodes.filter((n) => n.kind === 'factor').map((n) => [n.id, n as never]));
    for (const [factorId, raw, range] of [['annual_pa_salary', 42500, 100000], ['pa_hours', 22.5, 40]] as const) {
      const stored = { id: 'o', kind: 'option', label: 'O', interventions: { [factorId]: { value: raw / range } } };
      const [level] = projectOptionLevels(stored as never, factors);
      expect(level!.level as number, factorId).toBeCloseTo(raw, 9);
    }
  });
});

describe('the build prompt quotes stored levels and asks only for missing ones', () => {
  it('RED: the instructions carry the rule, and no longer ask for "the level each option sets" on every pair', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../routes/agent-v1-turn.ts'), 'utf8');
    expect(src).toContain('get_canonical_state lists the levels each option already sets (`levels`): quote those as stored, and never propose again a level that is already stored unless the user asks to change it.');
    expect(src).toContain('a level for each option and factor that has none yet');
    expect(src).not.toContain('and the level each option sets, in the user');
  });
});
