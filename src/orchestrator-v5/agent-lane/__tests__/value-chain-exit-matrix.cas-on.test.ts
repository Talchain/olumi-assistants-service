import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createProposal, ProposalStore } from '../proposal.js';
import { narrateWriteOutcome, PARTIAL_WRITE_MESSAGES } from '../write-outcome.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

const SID = '22222222-2222-4222-8222-222222222222';
const ctx = { scenario_id: SID, authenticated_user_id: null, request_id: 'exit-matrix' };
const READ_WORDS = 'The values were saved, but Olumi could not read the model afterwards. Check the saved model before making another change.';
const READ_HASH = '4a1d8b3c8ef2c5e7515dbf8ecb49adea46df870a2196b45558305717006d1f6e';
type Mode = 'throw' | 'non-200' | 'empty' | 'null' | 'refusal';
// Each entry is an I/O occurrence after commit 1, including both range-refusal branches.
const steps = [
  { name: 'value-2', write: true },
  { name: 'value-3', write: true },
  { name: 'post-values-read', write: false },
  { name: 'pre-range-read', write: false },
  { name: 'range-register', write: true },
  { name: 'post-range-read', write: false },
  { name: 'range-conflict-read', write: false },
  { name: 'range-refusal-read', write: false },
] as const;
type Step = typeof steps[number]['name'];
const cells = steps.flatMap(step => (['throw', 'non-200', 'empty', 'null', ...(step.write ? ['refusal'] : [])] as Mode[])
  .map(mode => ({ step: step.name, mode })));

function world(cell?: { step: Step; mode: Mode }, options: { guest?: boolean; zero?: boolean; overwrite?: boolean; missingFinalValue?: boolean; laterRefused?: boolean } = {}) {
  let graph = buildD1Fixture();
  for (const id of ['f-budget', 'f-quality']) {
    const n = graph.nodes.find(n => n.id === id)!;
    n.observed_state = { value: 2, source: 'explicit' };
  }
  let writes = 0;
  let rangeAttempted = false;
  let rangeRefused = false;
  let postValuesReads = 0;
  let firstReceipt: unknown;
  const committed: string[] = [];
  const visited: string[] = [];
  const fail = (mode: Mode) => {
    if (mode === 'throw') throw new Error('I/O unavailable');
    if (mode === 'non-200') return { status: 503, json: {} };
    if (mode === 'empty') return { status: 200, json: {} };
    if (mode === 'null') return { status: 200, json: null as unknown as Record<string, unknown> };
    return { status: 422, json: { code: 'refused_no_write', assistant_text: 'refused' } };
  };
  const receipt = (body: Record<string, unknown>, id: number) => ({
    schema: 'model_version_mutation_receipt.v1', scenario_id: SID, mutation_id: SID, version_id: SID, sequence: id,
    graph: structuredClone(graph), full_hash: 'a'.repeat(64), hash_algorithm: 'sha256', identity_projection_version: 'identity.v1',
    identity_normaliser_version: '1', graph_schema_version: 'graph_v3', analysis_affecting_hash: 'b'.repeat(64),
    actor: { kind: 'unknown' }, creation: { kind: 'committed_mutation' }, source_turn_id: String(body.turn_id),
    lineage: { kind: 'unknown' }, undo_version_id: null, event_id: `value-${id}`,
  });
  const dispatch: InternalDispatch = async (path, rawBody) => {
    const body = rawBody as Record<string, unknown>;
    if (path.endsWith('/graph')) {
      let step: Step | undefined;
      if (writes > 0) {
        step = rangeAttempted
          ? rangeRefused ? cell?.step === 'range-conflict-read' ? 'range-conflict-read' : 'range-refusal-read' : 'post-range-read'
          : ++postValuesReads === 1 ? 'post-values-read' : 'pre-range-read';
      }
      if (step) visited.push(step);
      if (cell && step === cell.step) return fail(cell.mode);
      const snapshot = structuredClone(graph);
      if (options.missingFinalValue && step === 'post-range-read') snapshot.nodes.find(n => n.id === 'f-budget')!.observed_state = undefined;
      return { status: 200, json: { graph: snapshot, graph_hash: computeAnalysisAffectingGraphHash(snapshot) } };
    }
    if (path.endsWith('/graph/register')) {
      rangeAttempted = true;
      visited.push('range-register');
      if (cell?.step === 'range-conflict-read' || cell?.step === 'range-refusal-read') {
        rangeRefused = true;
        return { status: cell.step === 'range-conflict-read' ? 409 : 422, json: { code: cell.step === 'range-conflict-read' ? 'GRAPH_STALE' : 'refused' } };
      }
      if (cell?.step === 'range-register') return fail(cell.mode);
      graph = structuredClone(body.graph) as typeof graph;
      committed.push('range');
      return { status: 200, json: options.guest ? {} : { model_version: { version_number: 4, version_id: SID, mutation_id: SID } } };
    }
    const event = body.event as { target_id: string; value: number };
    writes += 1;
    const step = `value-${writes}`;
    visited.push(step);
    if (options.zero || (options.laterRefused && writes > 1) || (options.overwrite && writes === 2)) return fail('refusal');
    if (cell && step === cell.step) return fail(cell.mode);
    graph.nodes.find(n => n.id === event.target_id)!.observed_state = { value: event.value, source: 'explicit' };
    committed.push(step);
    const rc = receipt(body, writes);
    if (writes === 1 && !options.guest) firstReceipt = { version: 1, version_id: SID, mutation_id: SID, source_turn_id: String(body.turn_id) };
    return { status: 200, json: {
      blocks: [{ type: 'graph_patch', operation: 'set_factor_value', target_id: event.target_id, status: 'applied', after: { value: event.value } }],
      ...(!options.guest ? { model_version_receipt: rc } : {}),
    } };
  };
  const proposals = new ProposalStore();
  const base = computeAnalysisAffectingGraphHash(graph);
  if (base === null) throw new Error('Fixture has no hash');
  const proposal = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: base,
    operations: ['f-budget', options.overwrite ? 'f-budget' : 'f-quality', 'f-quality'].map((path, i) => ({ op: 'set_factor_value' as const, path, value: { value: 40 + i } })),
    provenance: { authored_by: 'user_stated' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Exact values',
  });
  proposals.put(proposal);
  return { caps: createAgentCapabilities(dispatch, proposals), proposal, proposals, committed, visited, firstReceipt: () => firstReceipt };
}

beforeEach(() => __setUseAppendV6ForTest(true));
afterEach(() => __setUseAppendV6ForTest(true));

describe('generated value-chain I/O exit matrix', () => {
  it.each(cells)('$step × $mode retains commit 1 and refuses unconfirmed success', async cell => {
    const w = world(cell);
    const r = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(w.visited).toContain(cell.step);
    expect(w.committed).toContain('value-1');
    if (cell.step === 'pre-range-read') expect(w.visited).not.toContain('range-register');
    expect(r.mutated).toBe(true);
    expect(r.receipts).toContainEqual(w.firstReceipt());
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    const narrated = narrateWriteOutcome('', [{ name: 'authorise_change' }], [r]);
    expect(`${r.detail} ${narrated.status}`).not.toMatch(/unchanged|None of the values were recorded|nothing was saved/i);
    expect(narrated.status).toBe(r.detail);
    expect(r.detail).toBe(PARTIAL_WRITE_MESSAGES[String(r.outcome)]);
    if (cell.step.endsWith('read')) {
      expect(r.outcome).toBe('values_saved_read_unconfirmed');
      expect(r.detail).toBe(READ_WORDS);
      for (const text of [r.detail, narrated.status]) expect(createHash('sha256').update(String(text)).digest('hex')).toBe(READ_HASH);
    }
    expect(w.proposals.outstanding(SID, null).map(p => p.proposal_id)).toContain(w.proposal.proposal_id);
  });

  it.each([false, true])('append-only commit survives same-target refusal then throw (guest=%s)', async guest => {
    const w = world({ step: 'value-3', mode: 'throw' }, { overwrite: true, guest });
    const r = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(r).toMatchObject({ ok: false, mutated: true, applied: false, outcome: 'values_saved_remaining_values_unconfirmed' });
    expect(r.receipts).toEqual(guest ? [] : [w.firstReceipt()]);
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [r]).status).toBe(r.detail);
  });

  it('same-target refusal cannot turn commit 1 into a no-write result', async () => {
    const w = world(undefined, { overwrite: true, laterRefused: true });
    const r = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(r).toMatchObject({ ok: false, mutated: true, applied: false });
    expect(r.receipts).toContainEqual(w.firstReceipt());
    expect(String(r.detail)).not.toMatch(/unchanged|None of the values were recorded/);
  });

  it('a successful read missing a requested value does not confirm success', async () => {
    const w = world(undefined, { missingFinalValue: true });
    const r = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(r).toMatchObject({ ok: false, mutated: true, applied: false, outcome: 'values_saved_read_unconfirmed' });
    expect(r.receipts).toContainEqual(w.firstReceipt());
    expect(r.detail).toBe(READ_WORDS);
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [r]).status).toBe(READ_WORDS);
  });

  it('all-success control confirms every value and range', async () => {
    const w = world();
    const r = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(w.visited).toContain('post-range-read');
    expect(r).toMatchObject({ ok: true, mutated: true, applied: true, adopted_count: 3 });
    expect(r.receipts).toContainEqual(w.firstReceipt());
    expect(r.receipts).toHaveLength(4);
    expect(w.proposals.outstanding(SID, null)).toHaveLength(0);
  });

  it('zero-commit control preserves existing no-write words', async () => {
    const w = world(undefined, { zero: true });
    const r = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(w.committed).toHaveLength(0);
    expect(r).toMatchObject({ ok: false, mutated: false, applied: false, refusal: 'not_applied' });
    expect(r.receipts).toBeUndefined();
    expect(r.detail).toBe('None of the values were recorded, so this approval left the model unchanged. Read the model again before describing it: someone else may have changed it meanwhile.');
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [r]).status).toBe('Not saved: none of it was applied.');
  });
});
