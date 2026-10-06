/**
 * Red-team F2 end to end on the SERVED dental graph (no-shows kept in "% of appointments"): the user's one-sentence answer
 * reaches an approval card through both propose_link_effect paths, recording exactly the sentence that licenses it.
 * Base (3ee87d3c): both answers were refused `not_the_users_statement`, and the Agent asked the same question again.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const { graph } = JSON.parse(readFileSync(new URL('./fixtures/served-dental-no-show-6ce136c0.json', import.meta.url), 'utf8')) as { graph: Json };
const A1 = 'Through patient dissatisfaction, each £1 rise in the no-show charge raises no-shows by about 0.05 percentage points of appointments.';

async function propose(quote: string, mode: 'single' | 'batch') {
  const store = new ProposalStore();
  const d: InternalDispatch = async () => ({ status: 200, json: { graph: structuredClone(graph), graph_hash: computeAnalysisAffectingGraphHash(graph as never) } });
  const link = { from_label: 'No-show charge', to_label: 'no-shows', amount: 0.05, amount_unit: '% of appointments', per_source_change: 1,
    per_source_change_unit: 'GBP per missed appointment', quote };
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', authenticated_user_id: null, request_id: 'f2', user_text: quote, user_turn_text: quote };
  const result = await createAgentCapabilities(d, store).proposeLinkEffect!(ctx as never, (mode === 'single' ? link : { links: [link] }) as never) as Json;
  return { result, op: result.proposal_id ? store.get(String(result.proposal_id))?.operations[0] as Json | undefined : undefined };
}

describe('F2 on the served dental graph: the answer reaches a card', () => {
  it.each(['single', 'batch'] as const)('%s: "No-show charge" → "no-shows" is prepared with the user\'s exact sentence', async (mode) => {
    const { result, op } = await propose(A1, mode);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(op?.path).toBe('no_show_charge::no_shows');
    expect(op?.value.quote).toBe(A1);
  });

  it.each(['single', 'batch'] as const)('%s: a second sentence about another quantity is never recorded (buddy r2)', async (mode) => {
    const first = 'Each £1 rise in the no-show charge raises no-shows by about 0.05 percentage points of appointments.';
    const { result, op } = await propose(`${first} We estimated 0.05 percentage points of revenue last week.`, mode);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(op?.value.quote).toBe(first);
  });
});
