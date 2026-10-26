/**
 * propose_change on the real tool (`proposeProgramChange`), answers only, so no drafter call: 0 provider calls.
 *
 * DoD-I qualitative-r5 (25 Oct): an answer set a figure the person gave as "less than" one end only (known, no figure, no
 * low, a high, bounds). The tool projected that model for its Run before reading the compiler's errors, and the display threw
 * a TypeError, which reached the person as a 502. The compiler's own refusal is the answer: typed, with its sentence, back to
 * the agent to correct. The saved model is the synthetic bakery (never a test brief's words); expected sentences by hand.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProposalStore } from '../../agent-lane/proposal.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { withNewRun } from '../program-save.js';
import { MODEL_PROGRAM } from '../program-store.js';
import { proposeProgramChange } from '../program-tools.js';
import { bakery, BRIEF } from './bakery.fixture.js';

const SCENARIO = 'f0e1d2c3-0000-4000-8000-000000000001';
const saved = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: 7, person_words: [BRIEF], runs: [] }).graph;
const dispatch: InternalDispatch = async (path) => (path === `/assist/v1/scenarios/${SCENARIO}/graph`
  ? { status: 200, json: { graph: saved, graph_hash: 'hash-before', graph_identity_hash: 'identity-before' } } : { status: 404, json: {} });
const words = 'The oven costs less than £3,000.';
const propose = (low: number | null) => proposeProgramChange({ dispatch, proposals: new ProposalStore() },
  { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: randomUUID(), verified_user_messages: [words], user_turn_text: words },
  { public_label: 'Oven price', basis: 'their answer', request: '', remove: [],
    answers: [{ id: 'oven_price', status: 'known', author: 'person', value: null, low, high: 3000, range_kind: 'bounds', party: null, quote: 'less than £3,000', basis: null }] });

describe('propose_change reads the compiler’s errors before anything is projected', () => {
  it('a known figure with one end of its range (the qual-r5 shape) is the compiler’s typed refusal, never a throw', async () => {
    await expect(propose(null)).resolves.toEqual({ status: 'refused', reason: 'does_not_compile',
      // S1 strip (B13 off): only the MATHS sentence; a range kind with no range is no longer an error.
      detail: '"oven price" (oven_price) has only one end of its range; give both low and high, or neither.' });
  });

  it('contrast: the same answer with both ends (0 to £3,000) is held on a card as before', async () => {
    const outcome = await propose(0) as Record<string, any>;
    expect(outcome.status, JSON.stringify(outcome)).toBe('ok');
    expect(outcome.data.proposal_id).toEqual(expect.any(String));
    expect(outcome.data.base_revision).toBe('hash-before');
  });
});
