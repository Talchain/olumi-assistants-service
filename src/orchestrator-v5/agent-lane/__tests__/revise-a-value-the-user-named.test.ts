/**
 * ⛔ THE SENSITIVITY LOOP WAS A GUARANTEED DEAD END.
 *
 * The analysis instruction tells the model to name the one or two assumptions the
 * ordering is most sensitive to and "invite the user to change one and see how much
 * it matters". An assumption the ordering is sensitive to ALWAYS already holds a
 * value — otherwise it could not drive an ordering — and `proposeAssumptions`
 * refused exactly that case for every factor, so the invitation could never once be
 * honoured. Complete manifest of all eight agent tools checked: none could revise a
 * value that was already there.
 *
 * The blanket refusal itself was RIGHT and is untouched. It exists to stop the model
 * replacing somebody's number with a guess "under cover of adopting assumptions".
 * What it was never meant to catch is the user naming their own new figure, which is
 * the opposite act. `revise` is opt-in per factor, the old value is carried into the
 * approval the user is shown, and nothing writes without authorise_change.
 *
 * Assertions bind by IDENTITY — the exact node, the exact old and new figures, the
 * exact provenance — never "a proposal happened".
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { committedValueWrite } from './fixtures/served-value-write.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
/** What the user wrote in these rows: a figure is recorded as theirs only when it is here (`stated-by-user.ts`). */
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r', user_text: 'What would 6% churn do? Evidence strength should be 50.' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };

const BASE: Node[] = [
  { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate', observed_state: { value: 4 } },
  { id: 'pro_subscribers', kind: 'factor', label: 'Pro subscribers' },
];

function fakeProduct() {
  const posted: unknown[] = [];
  const nodes: Node[] = BASE.map((n) => ({ ...n, observed_state: n.observed_state ? { ...n.observed_state } : undefined }));
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') { posted.push(b.event); return { status: 200, json: {} }; }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: 'h0' } };
  };
  return { d, posted, read: () => nodes };
}

describe('the user can change an assumption the analysis named', () => {
  it('⭐ revises a value that is already there when the USER named the change', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'the user asked what 6% would do', revise: true }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.assumptions).toEqual([
      { factor: 'Monthly churn rate', value: 6, unit: '%', basis: 'the user asked what 6% would do', replaces: 4 },
    ]);
  });

  it('⛔ CONTROL: without `revise` the blanket refusal is exactly as it was', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'a figure of my own' }],
    });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('nothing_to_adopt');
    expect(r.already_valued).toEqual([{ label: 'Monthly churn rate', current_value: 4 }]);
  });

  it('⛔ the approval SAYS WHAT IT REPLACES — consent is not informed otherwise', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'b', revise: true }],
    });
    // The old figure must be in the label the receipt quotes, not only the new one.
    expect(r.public_label).toContain('4 %');
    expect(r.public_label).toContain('6 %');
    expect(r.public_label).toMatch(/^Revise 1 value you asked to change: /);
  });

  it('a revision the user named is THEIRS, not the model’s', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'b', revise: true }],
    });
    const stored = store.get(String(r.proposal_id));
    expect(stored?.provenance.authored_by).toBe('user_stated');
  });

  it('CONTROL: a mixed proposal is not laundered into the user’s name', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [
        { factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'they asked', revise: true },
        { factor_label: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'my estimate' },
      ],
    });
    const stored = store.get(String(r.proposal_id));
    // One half is the model's own suggestion, so the whole proposal stays model_proposed.
    expect(stored?.provenance.authored_by).toBe('model_proposed');
    expect(r.public_label).toMatch(/^Revise 1 value and adopt 1 starting assumption: /);
  });

  it('⛔ PROPOSES ONLY — a revision still writes nothing without authorise_change', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'b', revise: true }],
    });
    expect(r.mutated).toBe(false);
    expect(p.posted).toHaveLength(0);
    expect(p.read().find((n) => n.id === 'monthly_churn_rate')?.observed_state?.value).toBe(4);
  });
});

/**
 * ⛔ THE FOUR DEFECTS CODEX TRACED (5810763729, 24 Sep) — the native/model mismatch,
 * the dropped `raw_value`, the readback that counted an untouched value as saved, and
 * the automatic Run. Acceptance, stated as Paul stated it: approve changing 70 to 50
 * on a factor whose declared scale is 100 → store raw 50 and model 0.5 → read back 50
 * → Run only when explicitly asked → the value survives a reload.
 *
 * Bound by IDENTITY throughout: the exact node id, the exact pair on the wire, the
 * exact figures in the label. A value predicate another number could satisfy would
 * not discriminate here, because 50 and 0.5 are both "a number that changed".
 */
const FRAMED: Node[] = [
  {
    id: 'evidence_strength', kind: 'factor', label: 'Evidence strength',
    // The frame a constructed model actually carries: native 70 read against a 100 scale.
    observed_state: { value: 0.7, raw_value: 70, cap: 100, declared_scale: 'unit_interval', unit: 'points' },
  },
];

const RECEIPT = (turnId: string, sequence = 3) => ({
  schema: 'model_version_mutation_receipt.v1',
  scenario_id: SCENARIO,
  mutation_id: '11111111-1111-4111-8111-111111111111',
  version_id: '22222222-2222-4222-8222-222222222222',
  sequence,
  graph: { nodes: [{ id: 'evidence_strength', kind: 'factor', label: 'Evidence strength' }], edges: [] },
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
  event_id: 'model_version_created_mutation_11111111-1111-4111-8111-111111111111',
});

/**
 * The product for a framed factor. `writes` decides whether the write is honoured:
 * 'receipt' commits and answers with a real receipt; 'refused' answers 200 with NO
 * receipt and leaves the stored value untouched — the exact shape that used to be
 * reported as "Saved" because the old value read back as a number.
 */
function framedProduct(writes: 'receipt' | 'refused' | 'committed_no_receipt') {
  const posted: Record<string, unknown>[] = [];
  const nodes: Node[] = FRAMED.map((n) => ({ ...n, observed_state: { ...n.observed_state } }));
  let hash = 'h0';
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const e = b.event as Record<string, unknown>;
      posted.push(e);
      if (writes === 'refused') return { status: 200, json: {} };
      // The canonical writer stores the coherent triple it was sent.
      const n = nodes.find((x) => x.id === e.target_id);
      if (n !== undefined) {
        n.observed_state = {
          ...n.observed_state,
          value: e.value as number,
          ...(typeof e.raw_value === 'number' ? { raw_value: e.raw_value } : {}),
        };
      }
      hash = 'h1';
      // The egress validator DELETES the receipt when it is the only field that fails
      // (validators/b1.ts:128) — the write is committed and the 200 carries no receipt.
      if (writes === 'committed_no_receipt') return { status: 200, json: committedValueWrite(String(e.target_id)) };
      return { status: 200, json: committedValueWrite(String(e.target_id), { model_version_receipt: RECEIPT(String(b.turn_id)) }) };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: hash } };
  };
  return { d, posted, read: () => nodes };
}

describe('a value the user revises is saved on its own frame, and only called saved when it was', () => {
  it('⭐ ACCEPTANCE: 70 → 50 on a declared scale of 100 stores raw 50 and model 0.5, and reads back 50', async () => {
    const p = framedProduct('receipt');
    const caps = createAgentCapabilities(p.d, new ProposalStore());

    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Evidence strength', value: 50, unit: 'points', basis: 'the user said 50', revise: true }],
    });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);

    // (1) The approval shows the user's OWN number, not the model's divisor.
    expect(proposed.assumptions).toEqual([
      { factor: 'Evidence strength', value: 50, unit: 'points', basis: 'the user said 50', replaces: 70 },
    ]);
    expect(String(proposed.public_label)).toContain('70 points → 50 points');
    expect(String(proposed.public_label), 'the model divisor must never reach the chip').not.toContain('0.7');

    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);

    // (2) The wire carries the coherent pair — this is what was dropped.
    const edit = p.posted.find((e) => e.kind === 'factor_value_edit');
    expect(edit, 'a factor_value_edit must have been posted').toBeDefined();
    expect(edit!.target_id).toBe('evidence_strength');
    expect(edit!.value, 'model value on the factor’s own 100 scale').toBeCloseTo(0.5, 10);
    expect(edit!.raw_value, 'the user’s native figure, untouched').toBe(50);

    // (3) What is stored, and what the user is told, are both the native figure.
    expect(p.read()[0]!.observed_state).toMatchObject({ value: 0.5, raw_value: 50, cap: 100 });
    expect(applied.values).toEqual([{ factor: 'Evidence strength', requested: 50, recorded: 50 }]);
  });

  it('⛔ RED: a refused write is NOT reported as saved, though the old value still reads back', async () => {
    const p = framedProduct('refused');
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Evidence strength', value: 50, unit: 'points', basis: 'the user said 50', revise: true }],
    });
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });

    // The stored value is untouched and still numeric — the old readback called this "Saved".
    expect(p.read()[0]!.observed_state).toMatchObject({ value: 0.7, raw_value: 70 });
    expect(applied.applied, 'nothing landed, so nothing may claim it did').toBe(false);
    expect(applied.refusal).toBe('not_applied');
    expect(String(applied.detail)).toContain('unchanged');
  });

  it('⛔ RED: a COMMITTED write with no receipt is still saved — the degradable-egress case', async () => {
    // Keying `ownWrite` on the receipt ALONE would report "not saved" for a write that
    // landed, which is worse than the defect item 4 fixes. `model_version_receipt` is the
    // single DEGRADABLE_EGRESS_FIELD (validators/b1.ts:128): when it is the only field that
    // fails egress validation it is deleted and the rest of the response passes. What still
    // proves it is this op's own `graph_patch` (status 'applied') in the same response.
    const p = framedProduct('committed_no_receipt');
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Evidence strength', value: 50, unit: 'points', basis: 'the user said 50', revise: true }],
    });
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(p.read()[0]!.observed_state, 'the write really did land').toMatchObject({ value: 0.5, raw_value: 50 });
    expect(applied.applied, 'a committed write with a degraded receipt must still read as saved').toBe(true);
    expect(applied.values).toEqual([{ factor: 'Evidence strength', requested: 50, recorded: 50 }]);
  });

  it('⚠ CONTROL: an UNCAPPED factor is passed through natively — no divide, no clamp', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'the user asked', revise: true }],
    });
    expect(proposed.assumptions).toEqual([
      { factor: 'Monthly churn rate', value: 6, unit: '%', basis: 'the user asked', replaces: 4 },
    ]);
    await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    const edit = (p.posted as Record<string, unknown>[]).find((e) => e?.kind === 'factor_value_edit');
    expect(edit!.value, 'an uncapped input reaches the writer exactly as the user gave it').toBe(6);
    expect(edit!.raw_value, 'and carries no invented frame').toBeUndefined();
  });
});
