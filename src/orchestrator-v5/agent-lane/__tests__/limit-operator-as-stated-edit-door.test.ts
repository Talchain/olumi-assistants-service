/**
 * ⭐ A2 FOLLOW-UP (DL verdict on #2180): A STRICT LIMIT STAYS STRICT THROUGH THE EDIT DOOR, AND IS SAID THAT WAY.
 *
 * `add_constraint` replaces a limit row wholesale on an edit. Before this, the fresh row dropped `operator_as_stated`, so
 * "under 4%" became "at most 5%" after the user changed only the figure, and the receipts and `propose_limit_change`
 * said "at most" for a strict row. Now:
 *   · a new figure alone KEEPS the row's comparator ("under 4%" → "less than 5%");
 *   · a comparator the user STATES on the edit (typed `stated_operator`) replaces it: "at most" clears the field;
 *   · a non-strict row gains nothing;
 *   · the receipts and the Agent's wording read the row's comparator.
 *
 * DOOR rows drive the REAL limit door (`applyLimitEdit` → the typed proposal → the validator → the REAL `add_constraint`
 * handler → the persisted-base re-merge) and read the written row back by its `constraint_id`. The Agent rows drive the
 * REAL `proposeLimitChange` / `authoriseChange`; only the in-process commit port is a stub, and it records what it is
 * asked to write.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { applyLimitEdit, type LimitEditRequest } from '../../system-events/limit-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import type { CommitLimitEditInput, CommitLimitEditResult } from '../../system-events/dispatch.js';
import {
  formatConstraintLabelUpdated,
  formatConstraintUnchanged,
  formatConstraintUpdated,
} from '../../tools/handlers/d1-shared/format-confirmation.js';

type Rec = Record<string, unknown>;
const SCENARIO = 'a2e0a2e0-a2e0-4a2e-8a2e-a2e0a2e0a2e0';
const CHURN_ID = 'gc-churn-1';
const strictRow: Rec = {
  constraint_id: CHURN_ID, node_id: 'fac_churn', operator: '<=', operator_as_stated: '<', value: 4, unit: '%',
  value_frame: 'level', label: 'Monthly churn', provenance: 'explicit',
};
const { operator_as_stated: _strict, ...atMostRow } = strictRow;

/** A runnable pricing model whose churn carries ONE limit (`row`), beside a price cap that must stay untouched. */
function modelWith(row: Rec): Rec {
  const e = (from: string, to: string, mean = 0.5, dir: 'positive' | 'negative' = 'positive') =>
    ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: dir });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_x', kind: 'goal', label: 'MRR', goal_threshold: 0.8 },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', category: 'external', observed_state: { value: 0.03, raw_value: 3, unit: '%', cap: 100, source: 'brief_extraction' } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
    ],
    edges: [e('dec_x', 'opt_a', 1), e('dec_x', 'opt_b', 1), e('opt_a', 'fac_price', 1), e('opt_b', 'fac_price', 1),
      e('fac_price', 'goal_x'), e('fac_price', 'fac_churn', 0.3), e('fac_churn', 'goal_x', 0.4, 'negative')],
    goal_constraints: [
      JSON.parse(JSON.stringify(row)) as Rec,
      { constraint_id: 'gc-price-1', node_id: 'fac_price', operator: '<=', value: 100, unit: 'GBP', value_frame: 'level', label: 'Pro plan price', provenance: 'explicit' },
    ],
  };
}

/** The limit door on `row`, with a new figure and (optionally) a comparator the user stated. */
async function throughTheDoor(row: Rec, rawValue: number, stated?: LimitEditRequest['stated_operator']) {
  const persisted = modelWith(row);
  const before = JSON.stringify(persisted);
  const hash = computeAnalysisAffectingGraphHash(persisted as Parameters<typeof computeAnalysisAffectingGraphHash>[0]);
  expect(hash, 'control: the model hashes').not.toBeNull();
  const result = await applyLimitEdit({
    payload: { scenario_id: SCENARIO, turn_id: 'turn-a2-door', stage: 'frame' },
    request: { node_id: 'fac_churn', operator: '<=', raw_value: rawValue, base_graph_hash: hash!, ...(stated !== undefined ? { stated_operator: stated } : {}) },
    requestId: 'req-a2-door',
    persistedGraph: persisted,
    priorFacts: [],
  });
  expect(JSON.stringify(persisted), 'the persisted base is never mutated in place').toBe(before);
  if (result.kind !== 'mutated') return { result, written: undefined, price: undefined, receipt: '' };
  const rows = ((result.mutatedGraph as Rec).goal_constraints ?? []) as Rec[];
  const response = result.response as unknown as { assistant_text?: unknown };
  return {
    result,
    written: rows.find((c) => c.constraint_id === CHURN_ID),
    price: rows.find((c) => c.constraint_id === 'gc-price-1'),
    receipt: String(response.assistant_text ?? ''),
  };
}

describe('THE DOOR — the real add_constraint write, read back by constraint_id', () => {
  it('RED: a strict row + a new figure alone → still operator_as_stated "<", and the receipt says "less than 5%"', async () => {
    const r = await throughTheDoor(strictRow, 5);
    expect(r.result.kind, JSON.stringify(r.result).slice(0, 300)).toBe('mutated');
    expect(r.written).toMatchObject({ operator: '<=', operator_as_stated: '<', value: 5, unit: '%', value_frame: 'level', provenance: 'explicit' });
    expect(r.receipt).toMatch(/less than 5\s?%/);
    expect(r.receipt).not.toMatch(/at most/);
    expect(r.price, 'the other limit is untouched').toEqual((modelWith(strictRow).goal_constraints as Rec[])[1]);
  });

  it('EXPLICIT (green at base, which drops the field on every edit; its mutant is "the handler ignores the stated comparator"): a strict row + an explicit "at most" edit → the field is cleared, and the receipt says "at most 5%"', async () => {
    const r = await throughTheDoor(strictRow, 5, '<=');
    expect(r.result.kind, JSON.stringify(r.result).slice(0, 300)).toBe('mutated');
    expect(r.written).toMatchObject({ operator: '<=', value: 5 });
    expect(r.written).not.toHaveProperty('operator_as_stated');
    expect(r.receipt).toMatch(/at most 5\s?%/);
  });

  it('CONTROL: a non-strict row + a new figure → no field, "at most 5%" (as before)', async () => {
    const r = await throughTheDoor(atMostRow, 5);
    expect(r.result.kind).toBe('mutated');
    expect(r.written).toMatchObject({ operator: '<=', value: 5 });
    expect(r.written).not.toHaveProperty('operator_as_stated');
    expect(r.receipt).toMatch(/at most 5\s?%/);
  });

  it('RED: a non-strict row + an explicit "less than" edit → the field is set', async () => {
    const r = await throughTheDoor(atMostRow, 5, '<');
    expect(r.result.kind).toBe('mutated');
    expect(r.written).toMatchObject({ operator: '<=', operator_as_stated: '<', value: 5 });
  });

  it('RED: the same figure, "at most" over "under" → a change, never "already constrained"', async () => {
    const r = await throughTheDoor(strictRow, 4, '<=');
    expect(r.result.kind).toBe('mutated');
    expect(r.written).not.toHaveProperty('operator_as_stated');
    expect(r.receipt).toMatch(/^Updated constraint: .* at most 4\s?%/);
  });

  it('RED: the same figure through the door on a strict row → "is already constrained to be less than 4%", strictness kept', async () => {
    const r = await throughTheDoor(strictRow, 4);
    expect(r.result.kind).toBe('mutated');
    expect(r.written).toMatchObject({ operator_as_stated: '<', value: 4 });
    expect(r.receipt).toMatch(/already constrained to be less than 4\s?%/);
  });

  it('a stated comparator in the OTHER direction (">" on an upper limit) is refused; nothing is written', async () => {
    const r = await throughTheDoor(strictRow, 5, '>');
    expect(r.result).toEqual({ kind: 'refused', reason: 'stated_operator_direction' });
  });
});

describe('THE RECEIPTS read operator_as_stated (the canvas unchanged / label-updated sentences)', () => {
  const strictInput = { targetLabel: 'Monthly churn', operator: '<=' as const, operatorAsStated: '<' as const, value: 4, unit: '%' };
  const { operatorAsStated: _s, ...atMostInput } = strictInput;

  it('RED: a strict row is "less than", never "at most", in the updated, unchanged and label-updated receipts', () => {
    for (const text of [formatConstraintUpdated(strictInput), formatConstraintUnchanged(strictInput), formatConstraintLabelUpdated(strictInput)]) {
      expect(text).toMatch(/less than 4\s?%/);
      expect(text).not.toMatch(/at most/);
    }
  });

  it('CONTROL: a non-strict row is "at most", byte for byte as before', () => {
    expect(formatConstraintUnchanged(atMostInput)).toBe('Monthly churn is already constrained to be at most 4%.');
    expect(formatConstraintLabelUpdated(atMostInput)).toBe('Updated the label to Monthly churn — the constraint (must be at most 4%) is unchanged.');
  });

  it('a stamp that contradicts the held operator (">" beside "<=") is never said', () => {
    expect(formatConstraintUnchanged({ ...atMostInput, operatorAsStated: '>' })).toBe('Monthly churn is already constrained to be at most 4%.');
  });
});

// ── The Agent's limit door: the wording it offers and what it relays ──────────────────────────────────────────────
function agentWith(row: Rec) {
  let graph: Rec = modelWith(row);
  let hash = 'h0';
  const commits: CommitLimitEditInput[] = [];
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: hash } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  /** A recording port: writes the figure, keeping the row's comparator unless one was stated (as the door does). */
  const commitLimitEdit = async (input: CommitLimitEditInput): Promise<CommitLimitEditResult> => {
    commits.push(input);
    const rows = (graph.goal_constraints as Rec[]).map((c) => {
      if (c.constraint_id !== CHURN_ID) return c;
      const { operator_as_stated: kept, ...rest } = c;
      const stated = input.stated_operator === undefined ? kept : input.stated_operator === '<' ? '<' : undefined;
      return { ...rest, value: input.raw_value, ...(stated !== undefined ? { operator_as_stated: stated } : {}) };
    });
    graph = { ...graph, goal_constraints: rows };
    hash = 'h1';
    return { status: 'committed', graph_hash: hash, model_version_receipt: undefined, row: { constraint_id: CHURN_ID, value: input.raw_value } };
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore(), undefined, 'full', undefined, { commitLimitEdit });
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r-a2-agent', user_text: 'Our churn limit is now 5%.' };
  return { caps, ctx, commits };
}

describe('THE AGENT — propose_limit_change says the limit as the user stated it, and relays a stated comparator', () => {
  it('RED: a strict row + a new figure → "from less than 4% to less than 5%"; nothing stated is relayed; the follow-up says "less than 5%"', async () => {
    const { caps, ctx, commits } = agentWith(strictRow);
    const p = await caps.proposeLimitChange!(ctx, { limit_label: 'Monthly churn', operator: '<=', new_value: 5, unit: '%', rationale: 'x' }) as Rec;
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p.public_label).toBe('Change the limit on "Monthly churn" from less than 4% to less than 5%');
    expect(p.limit).toEqual({ on: 'Monthly churn', now: 'less than 4%', becomes: 'less than 5%' });
    expect(JSON.stringify(p)).not.toMatch(/at most/);
    const a = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) }) as Rec;
    expect(a.applied, JSON.stringify(a)).toBe(true);
    expect(commits).toHaveLength(1);
    expect(commits[0]).not.toHaveProperty('stated_operator');
    expect(String(a.follow_up)).toMatch(/is now less than 5%/);
  });

  it('RED: the user states "at most" → "from less than 4% to at most 5%", and "<=" is relayed to the door', async () => {
    const { caps, ctx, commits } = agentWith(strictRow);
    const p = await caps.proposeLimitChange!(ctx, { limit_label: 'Monthly churn', operator: '<=', new_value: 5, unit: '%', rationale: 'x', stated_operator: '<=' }) as Rec;
    expect(p.public_label).toBe('Change the limit on "Monthly churn" from less than 4% to at most 5%');
    const a = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) }) as Rec;
    expect(a.applied, JSON.stringify(a)).toBe(true);
    expect(commits[0]).toMatchObject({ node_id: 'fac_churn', operator: '<=', raw_value: 5, stated_operator: '<=' });
    expect(String(a.follow_up)).toMatch(/is now at most 5%/);
  });

  it('CONTROL: a non-strict row + a new figure → "from at most 4% to at most 5%" (as before)', async () => {
    const { caps, ctx } = agentWith(atMostRow);
    const p = await caps.proposeLimitChange!(ctx, { limit_label: 'Monthly churn', operator: '<=', new_value: 5, unit: '%', rationale: 'x' }) as Rec;
    expect(p.public_label).toBe('Change the limit on "Monthly churn" from at most 4% to at most 5%');
  });

  it('the same figure with the SAME comparator is still "already that figure"; with a new comparator it is a change', async () => {
    const { caps, ctx } = agentWith(strictRow);
    const same = await caps.proposeLimitChange!({ ...ctx, user_text: 'Keep churn under 4%.' }, { limit_label: 'Monthly churn', operator: '<=', new_value: 4, unit: '%', rationale: 'x', stated_operator: '<' }) as Rec;
    expect(same).toMatchObject({ ok: false, refusal: 'already_that_figure' });
    const changed = await caps.proposeLimitChange!({ ...ctx, user_text: 'Make churn at most 4%.' }, { limit_label: 'Monthly churn', operator: '<=', new_value: 4, unit: '%', rationale: 'x', stated_operator: '<=' }) as Rec;
    expect(changed.public_label).toBe('Change the limit on "Monthly churn" from less than 4% to at most 4%');
  });

  it('a stated comparator in the other direction is refused; nothing is prepared', async () => {
    const { caps, ctx } = agentWith(strictRow);
    const p = await caps.proposeLimitChange!(ctx, { limit_label: 'Monthly churn', operator: '<=', new_value: 5, unit: '%', rationale: 'x', stated_operator: '>' }) as Rec;
    expect(p).toMatchObject({ ok: false, mutated: false, refusal: 'unreadable_limit' });
  });
});
