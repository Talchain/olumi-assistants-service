/**
 * ⛔ NO CARD, NO BUTTON — A TURN THAT ASKS FOR THE READING RE-OFFERS IT (R3 H witness 5910559613, served CEE 950177e).
 *
 * The draft turn offered the confirm card. The user then typed "Run the analysis." before pressing it: the Agent called
 * NO tool and replied "Is MRR your price × subscribers? … If yes, Olumi will calculate MRR that way", with
 * `suggested_actions: []` (2/2). A typed yes cannot write (the reading is the user's only on its displayed card), so there
 * was nothing to press. `identityCardToIssue` keys on a Run's result, and there was no Run. `identityCardToReoffer` puts
 * the SAME card back (same stored words, same id; nothing is written) on a turn that wrote nothing, offered no other
 * proposal and was no chip's fast path, while the STORED model still holds an unconfirmed reading its writer can record.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { identityConfirmBaseIsWritable } from '../../system-events/editable-graph.js';
import { identityCardToReoffer } from '../identity-card.js';

type Json = Record<string, any>;
const STORED = (JSON.parse(readFileSync(new URL('./fixtures/served-identity-draft-950177e-20260930.json', import.meta.url), 'utf8')) as { graph: Json }).graph;
const readingWaiting = (g: Json) => proposeProductIdentity(g) !== null && identityConfirmBaseIsWritable(g);
const R3_TURN = { toolCalls: [] as { name: string }[], mutated: false, fastPath: undefined, proposalOffered: false, readingWaiting: true };

describe('served: a typed "Run the analysis." before the card was pressed', () => {
  it('vacuity: the STORED model after the draft still holds the unconfirmed reading its writer can record', () => {
    expect(readingWaiting(STORED)).toBe(true);
    expect(proposeProductIdentity(STORED)!.words).toMatch(/MRR/);
  });

  it('RED: the turn that called no tool re-offers the card — the SAME stored words, on its button, writing nothing', async () => {
    expect(identityCardToReoffer({ ...R3_TURN, readingWaiting: readingWaiting(STORED) })).toBe(true);
    const store = new ProposalStore(); let writes = 0;
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: STORED, graph_hash: computeAnalysisAffectingGraphHash(STORED as never) ?? '' } };
      writes += 1; throw new Error(`unexpected ${path}`);
    };
    const caps = createAgentCapabilities(d, store);
    const ctx = { scenario_id: '550e8400-e29b-41d4-a716-446655440c0a', authenticated_user_id: null, request_id: 'r', user_text: 'Run the analysis.' };
    const issued = await dispatchTool('propose_identity', '{}', ctx as never, caps) as Json;
    expect(issued.ok, JSON.stringify(issued)).toBe(true);
    const chips = approvalChipsFor([{ name: 'propose_identity', ok: true, mutated: false, proposal_id: String(issued.proposal_id) }],
      (id) => ({ proposal: store.get(id), result: issued as never }));
    expect(chips[0]).toEqual(expect.objectContaining({ label: 'Yes, calculate it that way', detail: proposeProductIdentity(STORED)!.words }));
    expect(writes).toBe(0);
  });
});

describe('controls: never beside another change, never twice, never without a waiting reading', () => {
  it.each([
    ['a chip\'s fast path (the Run chip, an approval)', { fastPath: 'run' }],
    ['a turn that changed the model', { mutated: true }],
    ['a turn that already offers another proposal (one approval carries one change)', { proposalOffered: true }],
    ['no unconfirmed reading on the stored model', { readingWaiting: false }],
    ['the Agent already proposed the card', { toolCalls: [{ name: 'propose_identity' }] }],
    ['an approval was authorised this turn', { toolCalls: [{ name: 'authorise_change' }] }],
  ] as const)('CONTROL: not on %s', (_name, over) => {
    expect(identityCardToReoffer({ ...R3_TURN, ...(over as object) } as never)).toBe(false);
  });
  it('CONTROL: an answered question with no tool call still re-offers only while the reading waits', () => {
    expect(identityCardToReoffer({ ...R3_TURN, toolCalls: [{ name: 'read_model' }] })).toBe(true);
  });
});

describe('one button per id (R3 5910885689, served e9fba88: the Run button\'s reply listed the card and "Change something first" TWICE)', () => {
  it('RED: the card issued this turn and the same card carried from the last are offered once, in order', async () => {
    const { firstOfEachId } = await import('../../../routes/agent-v1-turn.js');
    const card = { id: 'agent-approve-proposal:prop_e84ae458', label: 'Yes, calculate it that way', message: 'Yes, calculate it that way.' };
    const amend = { id: 'agent-amend-proposal', label: 'Change something first', message: 'x' };
    const run = { id: 'agent-run-analysis', label: 'Run analysis', message: 'Run analysis.' };
    expect(firstOfEachId([card, amend, card, amend, run])).toEqual([card, amend, run]);
    expect(firstOfEachId([run])).toEqual([run]);
  });
});
