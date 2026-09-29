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
