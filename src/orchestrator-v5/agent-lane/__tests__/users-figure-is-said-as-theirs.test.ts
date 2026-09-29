/**
 * ⛔ THE USER'S OWN FIGURE WAS CALLED "A MODEL ASSUMPTION … NOT A MEASUREMENT".
 *
 * Served on CEE e25d0aa (Context Management witness, 3 fresh drafts, 29 Sep): the user wrote "For the record, our
 * current monthly churn is 3.7%. Please put that in the model." The proposal stored the value as the user's
 * (`authored_by: 'user_stated'`; after approval `source: user_override`), yet the Agent told them: "This records it
 * as a model assumption to adopt or correct, not a measurement." Cause: `propose_assumptions` returned ONE note for
 * every value — "say plainly that these are assumptions to adopt or correct and NOT measurements" — whoever wrote it.
 *
 * The words now follow the stored authorship value by value: a figure the proposal records as the user's is marked
 * `your_figure` and is never called an assumption; every other value keeps the assumption wording.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { createAgentCapabilitiesWithLevelsPort } from './fixtures/levels-port.js';
import { ProposalStore } from '../proposal.js';

const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as unknown;
const SERVED = 'For the record, our current monthly churn is 3.7%. Please put that in the model.';
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400d9', authenticated_user_id: null, request_id: 'r', user_text });
const setup = () => {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: paulGraph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const store = new ProposalStore();
  return { caps: createAgentCapabilities(d, store), store };
};
const CHURN = { factor_label: 'Monthly churn', value: 3.7, unit: 'percent per month', basis: 'the figure the user gave', revise: true };
const SUBS = { factor_label: 'Pro subscribers', value: 300, unit: 'subscribers', basis: 'a round starting estimate', revise: true };
type R = ToolResult & { proposal_id: string; note: string; assumptions: { factor: string; your_figure?: boolean }[] };
const ASSUMPTION_WORDS = /assumptions? to adopt or correct|NOT measurements?/i;
const authorOf = (store: ProposalStore, id: string, path: string) =>
  (store.get(id)?.operations.find((o) => (o as { path?: string }).path === path) as { value?: { authored_by?: string } } | undefined)?.value?.authored_by;

describe('propose_assumptions says a figure the user gave as theirs — the words follow the stored authorship', () => {
  it('RED (served e25d0aa): the user\'s own churn figure → marked your_figure, and the note never calls it an assumption', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying(SERVED), { assumptions: [CHURN] }) as R;
    expect(r.ok).toBe(true);
    expect(authorOf(store, r.proposal_id, 'monthly_churn')).toBe('user_stated'); // what will be stored
    expect(r.assumptions).toEqual([expect.objectContaining({ factor: 'Monthly churn', your_figure: true })]);
    expect(r.note).not.toMatch(ASSUMPTION_WORDS);
    expect(r.note).toMatch(/the user['’]s own figure|figures? the user gave/i);
  });

  it('CONTRAST: the same revision when the user did NOT write the figure → Olumi\'s, and it is still said as an assumption', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying('Please update churn to what you think is right.'), { assumptions: [CHURN] }) as R;
    expect(authorOf(store, r.proposal_id, 'monthly_churn')).toBe('model_proposed');
    expect(r.assumptions[0]).not.toHaveProperty('your_figure');
    expect(r.note).toMatch(ASSUMPTION_WORDS);
  });

  it('MIXED: the user\'s churn and Olumi\'s subscriber count in one proposal → each said by who wrote it', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying(SERVED), { assumptions: [CHURN, SUBS] }) as R;
    expect(authorOf(store, r.proposal_id, 'monthly_churn')).toBe('user_stated');
    expect(authorOf(store, r.proposal_id, 'pro_subscribers')).toBe('model_proposed');
    const byFactor = new Map(r.assumptions.map((a) => [a.factor, a]));
    expect(byFactor.get('Monthly churn')?.your_figure).toBe(true);
    expect(byFactor.get('Pro subscribers')).not.toHaveProperty('your_figure');
    expect(r.note).toMatch(/your_figure/);
    expect(r.note).toMatch(ASSUMPTION_WORDS); // the others are still assumptions
  });
});

/**
 * The same rule at the one other producer that told the Agent "these are assumptions" for every entry:
 * `propose_starting_point`'s joined note. A level the user gave carries `stated_by: 'user'` (the flag the writer stamps).
 */
describe('propose_starting_point says a level the user gave as theirs — the rest stay assumptions', () => {
  const nodes = [
    { id: 'velocity', kind: 'goal', label: 'Velocity' },
    { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
    { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
    { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
    { id: 'hire_lead', kind: 'option', label: 'Hire a Tech Lead' },
  ];
  const edges = ['hire_two', 'hire_lead'].map((o) => ({ from: o, to: 'team_size', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }));
  const capsSP = () => {
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes, edges }, graph_hash: 'h0' } };
      throw new Error(`unexpected dispatch ${path}`);
    };
    return createAgentCapabilitiesWithLevelsPort(d, new ProposalStore());
  };
  const ASSUMPTIONS = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team with one lead' }];
  const levels = (userSaid: boolean) => [
    { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five today plus two hires', ...(userSaid ? { user_stated: true } : {}) },
    { option_label: 'Hire a Tech Lead', factor_label: 'Team size', value: 6, basis: 'five today plus one hire' },
  ];
  const OLD_NOTE = 'Nothing has changed. Show the user every value and level and what each rests on, say plainly they are ' +
    'assumptions to adopt or correct, NOT measurements, and that ONE approval applies all of them. Then call ' +
    'authorise_change with this proposal_id once they agree.';
  type SP = ToolResult & { note: string; option_levels: { option: string; stated_by: string }[] };

  it('RED: the user wrote the 7 → that level is stated_by user, and the note says it is theirs while the rest stay assumptions', async () => {
    const r = await capsSP().proposeStartingPoint(ctxSaying('Hiring two developers takes us to 7 people.'), { assumptions: ASSUMPTIONS, option_levels: levels(true) }) as SP;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.option_levels.find((l) => l.option === 'Hire Two Developers')?.stated_by).toBe('user');
    expect(r.note).toMatch(/stated_by 'user'.*never call it an assumption/);
    expect(r.note).toMatch(ASSUMPTION_WORDS);
  });

  it('CONTRAST: none of the figures is the user\'s → the note is byte-identical to before', async () => {
    const r = await capsSP().proposeStartingPoint(ctxSaying('Suggest a starting point.'), { assumptions: ASSUMPTIONS, option_levels: levels(false) }) as SP;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.option_levels.every((l) => l.stated_by !== 'user')).toBe(true);
    expect(r.note.startsWith(OLD_NOTE)).toBe(true);
  });
});
