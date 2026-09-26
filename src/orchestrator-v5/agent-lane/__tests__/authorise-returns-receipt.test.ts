/**
 * An authorised change reports the version it became — and a retry gets the
 * SAME version back.
 *
 * ⛔ MEASURED on deployed staging 9c16e8cd, signed-in and owned (scenario
 * 079d2c24…): the authorised write minted exactly one version, correctly linked
 * — `source_turn_id` equal to `authorisationTurnId(proposal_id)`, `mutation_id`
 * mirrored on the turn row — and the Agent's response carried NO receipt. The
 * retry came back `{ok, mutated:false, applied:true, already_applied:true}`: no
 * `proposal_id`, no receipt, so nothing tied the retry to the proposal and
 * nothing recovered what the first authorisation produced.
 *
 * Cause: the agent lane read `model_version_receipt` in 0 non-test files, against
 * 6 elsewhere in the estate. The orchestrator attaches it — `commitDirectAnswer`
 * calls `attachModelVersionMutationReceipt` whenever a version is minted — and
 * the Agent threw it away.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, receiptSummaryOf, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { ModelVersionMutationReceiptV1LocalSchema } from '../../model-management/mutation-receipt.js';
import { nextRequest } from './fixtures/next-request.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const MUTATION_ID = 'cb1dd25d-36c3-4beb-aadf-5a016b2bce25';
const VERSION_ID = 'c0813c01-1111-4111-8111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

/** A marker that exists ONLY inside the receipt's committed graph. */
const GRAPH_MARKER = 'RECEIPT_GRAPH_MUST_NOT_REACH_THE_MODEL_CONTEXT';

/** A receipt that passes the real strict schema — the wire contract, not a guess. */
const receiptFor = (turnId: string, sequence = 2) => ModelVersionMutationReceiptV1LocalSchema.parse({
  schema: 'model_version_mutation_receipt.v1',
  scenario_id: SCENARIO,
  mutation_id: MUTATION_ID,
  version_id: VERSION_ID,
  sequence,
  graph: { nodes: [{ id: 'n1', kind: 'factor', label: GRAPH_MARKER }], edges: [] },
  full_hash: 'a'.repeat(64),
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
  analysis_affecting_hash: 'b'.repeat(64),
  actor: { kind: 'unknown' },
  creation: { kind: 'committed_mutation' },
  source_turn_id: turnId,
  lineage: { kind: 'known', parent_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', root_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
  undo_version_id: null,
  event_id: `model_version_created_mutation_${MUTATION_ID}`,
});

const NODES = [
  { id: 'price', kind: 'factor', label: 'Pro plan price' },
  { id: 'churn', kind: 'factor', label: 'Monthly churn' },
];

/** The product, as the Agent sees it: reads the graph, applies an edge, answers with (or without) a receipt. */
function fakeProduct(receipt: 'valid' | 'none' | 'malformed') {
  let edges: { from: string; to: string }[] = [];
  const writes: string[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { from: string; to: string };
      edges = [...edges, { from: ev.from, to: ev.to }];
      writes.push(String(b.turn_id));
      const json: Record<string, unknown> = { assistant_text: 'Added.' };
      if (receipt === 'valid') json.model_version_receipt = receiptFor(String(b.turn_id));
      if (receipt === 'malformed') json.model_version_receipt = { schema: 'model_version_mutation_receipt.v1', sequence: 'two' };
      return { status: 200, json };
    }
    return { status: 200, json: { graph: { nodes: NODES, edges }, graph_hash: `h${edges.length}` } };
  };
  return { d, writes };
}

async function authoriseTwice(receipt: 'valid' | 'none' | 'malformed') {
  const p = fakeProduct(receipt);
  const caps = createAgentCapabilities(p.d, new ProposalStore());
  const prop = await caps.proposeModelChange(ctx, {
    from_label: 'Pro plan price', to_label: 'Monthly churn', direction: 'positive', rationale: 'price rises push churn',
  });
  const first = await caps.authoriseChange(nextRequest(ctx), { proposal_id: String(prop.proposal_id) });
  const retry = await caps.authoriseChange(nextRequest(ctx), { proposal_id: String(prop.proposal_id) });
  return { prop, first, retry, writes: p.writes };
}

describe('authorise_change reports the version the change became', () => {
  it('surfaces the receipt the orchestrator attached, bound by identity', async () => {
    const { first, writes } = await authoriseTwice('valid');
    expect(first.ok, JSON.stringify(first)).toBe(true);
    // ⭐ Bound by IDENTITY: the receipt of THIS write — its turn id is the one
    // the Agent sent — not merely "some receipt".
    expect(first.receipts).toEqual([
      { version: 2, version_id: VERSION_ID, mutation_id: MUTATION_ID, source_turn_id: writes[0] },
    ]);
  });

  it('never lets the receipt’s committed graph into the model’s context', async () => {
    const { first, retry } = await authoriseTwice('valid');
    // The tool result is JSON-stringified into the model context on every hop;
    // the receipt carries the ENTIRE graph. Only the summary may travel.
    expect(JSON.stringify(first)).not.toContain(GRAPH_MARKER);
    expect(JSON.stringify(retry)).not.toContain(GRAPH_MARKER);
  });
});

describe('a retry RECOVERS the original result', () => {
  it('returns the SAME receipt, the proposal id, and writes nothing', async () => {
    const { prop, first, retry, writes } = await authoriseTwice('valid');
    expect(retry.already_applied).toBe(true);
    expect(retry.mutated).toBe(false);
    // Bound to the proposal by identity — the witnessed retry carried none.
    expect(retry.proposal_id).toBe(prop.proposal_id);
    // The ORIGINAL receipt, not a fresh one and not an empty one.
    expect(retry.receipts).toEqual(first.receipts);
    expect(String(retry.detail)).toMatch(/saved as version 2/);
    // Contrast control: exactly ONE write reached the product.
    expect(writes).toHaveLength(1);
  });
});

describe('honest when there is no receipt', () => {
  it('reports no version rather than inventing one (e.g. a guest scenario)', async () => {
    const { first, retry } = await authoriseTwice('none');
    expect(first.ok).toBe(true);
    expect(first.receipts).toEqual([]);
    expect(retry.receipts).toEqual([]);
    expect(String(retry.detail)).toMatch(/No saved version was recorded/);
  });

  it('flags a receipt that arrived malformed instead of swallowing or throwing', async () => {
    const { first } = await authoriseTwice('malformed');
    // The write happened; the user's turn must not crash on a bad report.
    expect(first.ok).toBe(true);
    expect(first.mutated).toBe(true);
    expect(first.receipts).toEqual([]);
    expect(first.receipt_unreadable).toBe(true);
  });
});

describe('receiptSummaryOf', () => {
  it('reads through the estate’s own parser — absent, valid and malformed are three different answers', () => {
    expect(receiptSummaryOf({})).toEqual({ summary: null, unreadable: false });
    expect(receiptSummaryOf({ model_version_receipt: receiptFor('t-1', 7) })).toEqual({
      summary: { version: 7, version_id: VERSION_ID, mutation_id: MUTATION_ID, source_turn_id: 't-1' },
      unreadable: false,
    });
    expect(receiptSummaryOf({ model_version_receipt: { sequence: 'x' } })).toEqual({ summary: null, unreadable: true });
    expect(receiptSummaryOf(null)).toEqual({ summary: null, unreadable: false });
  });
});
