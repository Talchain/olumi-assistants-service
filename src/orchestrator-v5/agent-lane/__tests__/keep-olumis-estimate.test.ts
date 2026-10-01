/**
 * ⭐ KEEP OLUMI'S ESTIMATE (52f8cd, lease #75 5925744661) — the user's "that's about right, keep it" is recorded as their
 * ACCEPTANCE of Olumi's figure, through the REAL writer, with the figure unchanged and still Olumi's.
 *
 * Served `b47db0b5`, guest `9390a1b4` (Paul's funding brief): Examine → "4 hours a week is about right for me. Keep it." →
 * "no change is needed", no card, the node stayed `cee_inference` with no review, and on reload Examine still said
 * "You haven't confirmed it". The draft had filled every value, so the adoption door (blanks only) could not record it.
 *
 * The fake dispatch hands each `factor_value_edit` to the PRODUCT'S OWN writer (`applyFactorValueEdit`), as the route's
 * `app.inject` does, so the stamp under test is the served writer's (`values-only-adoption-is-an-assumption.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { isAcceptedOlumiEstimate, observedValueAuthorship } from '../../../cee/transforms/provenance-display.js';
import { ProposalStore } from '../proposal.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { earnsAuthorshipCredit, structureProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { sayFigureRead } from '../say-figure.js';
import { approvalChipsFor, figureInUserUnits } from '../approval-chips.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { levelsPortOver } from './fixtures/levels-port.js';
import { readFileSync } from 'node:fs';

const SCENARIO = '9390a1b4-ab29-4a16-b39c-64bc00cc4ed0';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: '4 hours a week is about right for me. Keep it.', user_turn_text: '4 hours a week is about right for me. Keep it.' };

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number; provenance?: string };
const OLUMIS = { unit: 'hours/week', value: 0.1, source: 'cee_inference', raw_value: 4, extractionType: 'inferred' };
const BASE: Node[] = [
  { id: 'funding', kind: 'goal', label: 'Funding secured' },
  // Served `9390a1b4`'s node, verbatim: Olumi's inferred 4 hours/week on a 40-hour frame.
  { id: 'warm_hours', kind: 'factor', label: 'Hours per week finding warm connections', category: 'external', provenance: 'ai_inferred', scale_frame: 40, observed_state: { ...OLUMIS } },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE', source: 'user_override' } },
  { id: 'runway', kind: 'factor', label: 'Months of runway', category: 'observable', scale_frame: 24, observed_state: { value: 0.25, raw_value: 6, unit: 'months', source: 'brief_extraction', extractionType: 'explicit' } },
  { id: 'reply_rate', kind: 'factor', label: 'Reply rate', category: 'observable', observed_state: { value: 0.05, raw_value: 5, unit: '%', source: 'user_assumption', reviewed_by_user: { intent: 'confirm', at: '2026-10-01T00:00:00.000Z' } } },
  { id: 'deal_count', kind: 'factor', label: 'Deals in pipeline', category: 'observable', observed_state: { value: 0.3, cap: 10, unit: 'deals', source: 'cee_inference', extractionType: 'inferred' } },
  { id: 'blank', kind: 'factor', label: 'Intro quality', category: 'observable', scale_frame: 100 },
  // CODEX CEE BUDDY 5925977983: framed by the NODE's `scale_frame` alone (no raw, no cap), and a bare percent share.
  { id: 'cold_hours', kind: 'factor', label: 'Hours per week on cold emails', category: 'controllable', scale_frame: 40, observed_state: { unit: 'hours/week', value: 0.1, source: 'cee_inference', extractionType: 'inferred' } },
  { id: 'firm_reply', kind: 'factor', label: 'Investment-firm responsiveness', category: 'observable', observed_state: { unit: '%', value: 0.05, source: 'cee_inference', extractionType: 'inferred' } },
  { id: 'odd_cap', kind: 'factor', label: 'Odd-capped estimate', category: 'observable', observed_state: { unit: 'deals', value: 0.1, cap: 3, source: 'cee_inference', extractionType: 'inferred' } },
  // Served `9390a1b4`'s stored 0: Olumi's estimate that no time goes on angels yet.
  { id: 'angel_hours', kind: 'factor', label: 'Hours per week on angel outreach', category: 'controllable', scale_frame: 40, observed_state: { unit: 'hours/week', value: 0, source: 'cee_inference', raw_value: 0, extractionType: 'inferred' } },
];
const EDGES = ['warm_hours', 'team_size', 'runway', 'reply_rate', 'deal_count', 'blank', 'angel_hours', 'cold_hours', 'firm_reply', 'odd_cap'].map((from) => (
  { from, to: 'funding', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }));

/** The product double whose value writer IS the served writer. */
function product() {
  let nodes: Node[] = structuredClone(BASE);
  let rev = 0;
  let writes = 0;
  const graph = () => ({ nodes, edges: EDGES });
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind !== 'factor_value_edit') return { status: 400, json: {} };
      const res = await applyFactorValueEdit({
        payload: { kind: 'system_event', turn_id: String(b.turn_id), scenario_id: SCENARIO, stage: 'frame', event: ev } as never,
        event: ev as never, requestId: `w${writes}`, persistedGraph: graph() as never, priorFacts: [],
      });
      if (res.kind !== 'mutated') return { status: 200, json: { assistant_text: 'Not changed.' } };
      writes += 1;
      nodes = (res as unknown as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes;
      rev += 1;
      const fact = (res as unknown as { handlerFacts: { fact_type: string; result: { after?: unknown } }[] }).handlerFacts.find((f) => f.fact_type === 'set_factor_value');
      return { status: 200, json: { assistant_text: 'Saved.', graph_hash: `h${rev}`, blocks: [{ type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: String(ev.target_id), after: fact?.result.after }] } };
    }
    return { status: 200, json: { graph: graph(), graph_hash: `h${rev}` } };
  };
  /** Another writer (the user's own inspector edit, through the real writer) sets a figure between card and approval. */
  const otherWriter = async (target: string, raw: number) => {
    const ev = { kind: 'factor_value_edit', target_id: target, value: raw, intent: 'set' };
    const res = await applyFactorValueEdit({
      payload: { kind: 'system_event', turn_id: '7e1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b', scenario_id: SCENARIO, stage: 'frame', event: ev } as never,
      event: ev as never, requestId: 'other-writer', persistedGraph: graph() as never, priorFacts: [],
    });
    if (res.kind !== 'mutated') throw new Error(`PRECONDITION: the other writer wrote (${res.kind})`);
    nodes = (res as unknown as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes;
    rev += 1;
  };
  return { d, byId: () => Object.fromEntries(nodes.map((n) => [n.id, n])), graph, writes: () => writes, otherWriter };
}

const keepOf = (factor_label: string, value: number, unit: string) => ({ factor_label, value, unit, basis: 'the user said it is about right', keep: true });

async function keep(items: ReturnType<typeof keepOf>[]) {
  const p = product();
  const store = new ProposalStore();
  let stored = 0;
  const put = store.put.bind(store);
  store.put = (x) => { stored += 1; return put(x); };
  const caps = createAgentCapabilities(p.d, store);
  const proposed = await caps.proposeAssumptions(ctx, { assumptions: items } as never);
  const chips = () => approvalChipsFor([{ name: 'propose_assumptions', ok: proposed.ok === true, mutated: false, proposal_id: String(proposed.proposal_id) }],
    (id) => ({ proposal: store.get(id)!, result: proposed }) as never);
  return { p, caps, proposed, stored: () => stored, chips };
}

describe('keep: Olumi’s own figure, accepted unchanged, through the real writer', () => {
  it('RED: the card offers to accept Olumi’s estimate unchanged, and approving it records the acceptance on the SAME figure', async () => {
    const { p, caps, proposed } = await keep([keepOf('Hours per week finding warm connections', 4, 'hours/week')]);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(String(proposed.public_label)).toBe(`Accept Olumi’s estimate, unchanged: Hours per week finding warm connections = ${sayFigureRead(4, 'hours/week')}`);
    expect(String(proposed.note)).toMatch(/stays Olumi’s estimate/);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    const os = p.byId().warm_hours.observed_state!;
    // The figure is byte-identical; only who has reviewed it moved.
    expect({ value: os.value, raw_value: os.raw_value, unit: os.unit }).toEqual({ value: OLUMIS.value, raw_value: OLUMIS.raw_value, unit: OLUMIS.unit });
    expect(os.source).toBe('user_assumption');
    expect(os.reviewed_by_user).toMatchObject({ intent: 'confirm' });
    expect(isAcceptedOlumiEstimate(os)).toBe(true);
    expect(observedValueAuthorship(os)?.provenance, 'never "set by you"').not.toBe('user_set');
    expect(p.byId().warm_hours.provenance).toBe('ai_inferred');
  });

  it('the stored figure is kept, never the model’s argument: a keep sent with 9 still offers and keeps 4', async () => {
    const { p, caps, proposed } = await keep([keepOf('Hours per week finding warm connections', 9, 'hours/week')]);
    expect(String(proposed.public_label)).toContain(sayFigureRead(4, 'hours/week'));
    expect(String(proposed.public_label)).not.toMatch(/\b9\b/);
    await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(p.byId().warm_hours.observed_state).toMatchObject({ raw_value: 4, value: 0.1, source: 'user_assumption' });
  });

  it('an accepted estimate earns no authorship credit: it is Olumi’s figure the user accepted, not one they stated', async () => {
    const { p, caps, proposed } = await keep([keepOf('Hours per week finding warm connections', 4, 'hours/week')]);
    await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    const g = p.graph();
    expect(earnsAuthorshipCredit(structureProvenance(g.nodes.find((n) => n.id === 'warm_hours'), g as never))).toBe(false);
  });

  // CODEX CEE BUDDY 5925977983: every way a stored figure is framed — the card says the user-unit figure, and the model
  // value is byte-identical after the write (a scale-frame-only 0.1 was sent as 0.1 and stored 0.0025).
  it.each([
    ['raw', 'Hours per week finding warm connections', 'warm_hours', 4, 'hours/week', 0.1],
    ['cap only', 'Deals in pipeline', 'deal_count', 3, 'deals', 0.3],
    ['scale_frame only', 'Hours per week on cold emails', 'cold_hours', 4, 'hours/week', 0.1],
    ['percent, no raw', 'Investment-firm responsiveness', 'firm_reply', 5, '%', 0.05],
  ] as const)('%s: the card names the figure in the user’s units and the model value is unchanged', async (_, label, id, figure, unit, modelValue) => {
    const { p, caps, proposed } = await keep([keepOf(label, 999, unit)]);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(String(proposed.public_label)).toBe(`Accept Olumi\u2019s estimate, unchanged: ${label} = ${sayFigureRead(figure, unit)}`);
    await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    const os = p.byId()[id].observed_state!;
    expect(os.value).toBe(modelValue);
    expect(os.raw_value).toBe(figure);
    expect(os.source).toBe('user_assumption');
  });

  it('NEGATIVE: a figure no user-unit number reproduces exactly (0.1 on a cap of 3) is not offered, and nothing is written', async () => {
    const { p, proposed, stored } = await keep([keepOf('Odd-capped estimate', 0.3, 'deals')]);
    expect(proposed.ok).toBe(false);
    expect(proposed.not_keepable).toEqual([{ label: 'Odd-capped estimate', why: 'not_exact' }]);
    expect(stored()).toBe(0);
    expect(p.writes()).toBe(0);
  });
});

describe('collisions and retries (CODEX CEE BUDDY 5925846990)', () => {
  it('a stored 0 is a figure: Olumi’s 0 hours is kept and accepted, still 0', async () => {
    const { p, caps, proposed } = await keep([keepOf('Hours per week on angel outreach', 0, 'hours/week')]);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.byId().angel_hours.observed_state).toMatchObject({ value: 0, raw_value: 0, source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } });
  });

  it('NEGATIVE: the user makes the same 4 their own between card and approval → the keep is refused and never relabels it Olumi’s', async () => {
    const { p, caps, proposed } = await keep([keepOf('Hours per week finding warm connections', 4, 'hours/week')]);
    await p.otherWriter('warm_hours', 4);
    const mine = p.byId().warm_hours.observed_state!;
    expect(mine, 'PRECONDITION: the same figure is now the user’s own').toMatchObject({ raw_value: 4, source: 'user_override' });
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.ok).toBe(false);
    expect(p.writes()).toBe(0);
    expect(p.byId().warm_hours.observed_state).toEqual(mine);
  });

  it('a retried approval writes nothing more and keeps the review byte for byte', async () => {
    const { p, caps, proposed } = await keep([keepOf('Hours per week finding warm connections', 4, 'hours/week')]);
    await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    const once = structuredClone(p.byId().warm_hours.observed_state);
    const again = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(again).toMatchObject({ already_applied: true });
    expect(p.writes()).toBe(1);
    expect(p.byId().warm_hours.observed_state).toEqual(once);
  });

  it('NEGATIVE: a keep is never folded into a starting point’s one Yes', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeStartingPoint(ctx, { assumptions: [keepOf('Hours per week finding warm connections', 4, 'hours/week')], option_levels: [] } as never);
    expect(r).toMatchObject({ ok: false, refusal: 'keep_with_other_changes' });
    expect(p.writes()).toBe(0);
  });
});

describe('only Olumi’s own figure may be kept', () => {
  it.each([
    ['Team size', 5, 'FTE', 'yours', 'team_size'],
    ['Months of runway', 6, 'months', 'brief', 'runway'],
    ['Reply rate', 5, '%', 'already_accepted', 'reply_rate'],
    ['Intro quality', 50, 'index points (0-100)', 'no_figure', 'blank'],
  ])('NEGATIVE: %s (%s) → no card, the reason named, nothing written', async (label, value, unit, why, id) => {
    const { p, stored, proposed } = await keep([keepOf(label, value, unit)]);
    const before = structuredClone(BASE.find((n) => n.id === id)!.observed_state);
    expect(proposed.ok).toBe(false);
    expect(proposed.proposal_id).toBeUndefined();
    expect(proposed.not_keepable).toEqual([{ label, why }]);
    expect(stored()).toBe(0);
    expect(p.byId()[id].observed_state).toEqual(before);
    expect(p.writes()).toBe(0);
  });

  it('NEGATIVE: a keep beside another value is refused whole — one Yes never stands for two different acts', async () => {
    const { stored, proposed } = await keep([keepOf('Hours per week finding warm connections', 4, 'hours/week'),
      { factor_label: 'Intro quality', value: 50, unit: 'index points (0-100)', basis: 'a guess' } as never]);
    expect(proposed).toMatchObject({ ok: false, refusal: 'keep_with_other_changes' });
    expect(stored()).toBe(0);
  });

  it('CONTROL: without `keep`, Olumi’s figure is left alone exactly as before (the door is opt-in)', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Hours per week finding warm connections', value: 4, unit: 'hours/week', basis: 'x' }] });
    expect(r).toMatchObject({ ok: false, refusal: 'nothing_to_adopt', already_valued: [{ label: 'Hours per week finding warm connections', current_value: 4 }] });
  });
});

describe('the button says what the Yes records — never "Set … to" for a figure that does not change', () => {
  it('RED: a keep gets "Keep Olumi’s estimate", with the card (the figure) in detail', async () => {
    const { proposed, chips } = await keep([keepOf('Hours per week finding warm connections', 4, 'hours/week')]);
    const [approve] = chips();
    expect(approve).toMatchObject({ label: 'Keep Olumi\u2019s estimate', message: 'Yes, keep Olumi\u2019s estimate.', detail: String(proposed.public_label) });
    expect(approve!.label).not.toMatch(/^Set /);
  });

  it('CONTROL: the user’s own revision keeps its existing "Set … to" button (the keep button binds to the stored keep only)', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const c = { ...ctx, user_text: 'Make it 6 hours a week.', user_turn_text: 'Make it 6 hours a week.' };
    const r = await caps.proposeAssumptions(c, { assumptions: [{ factor_label: 'Hours per week finding warm connections', value: 6, unit: 'hours/week', basis: 'their figure', revise: true }] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [approve] = approvalChipsFor([{ name: 'propose_assumptions', ok: true, mutated: false, proposal_id: String(r.proposal_id) }], (id) => ({ proposal: store.get(id)!, result: r }) as never);
    expect(approve!.label).toBe(`Set Hours per week\u2026 to ${figureInUserUnits(6, 'hours/week')}`);
    expect(approve!.message).toBe('Yes, use those.');
  });
});

/**
 * The receipt through the COMPOUND door (the served path: `commitOptionLevels`) — served `5a2290c`, guest `02440e60`:
 * a pressed keep read "Saved 1 of 1 starting values." It names the acceptance instead.
 */
describe('the receipt of a keep names the acceptance, never "starting values"', () => {
  type SNode = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> | null };
  type SEdge = { from: string; to: string; strength?: { mean?: number; std?: number } };
  const servedBase = JSON.parse(readFileSync(new URL('./fixtures/served-unwritable-base-61a8c07c.json', import.meta.url), 'utf8')) as { nodes: SNode[]; edges: SEdge[] };
  // The served model with its one out-of-contract link inside [-1, 1] (the writable control of `value-not-saved-…`).
  const writable = { ...servedBase, edges: servedBase.edges.map((e) => (Math.abs(e.strength?.mean ?? 0) > 1 ? { ...e, strength: { ...e.strength, mean: 1 } } : e)) };
  const LABEL = 'Investment-firm warm connections pursued';
  const sctx = { scenario_id: '61a8c07c-026a-45b3-8e13-1d859169df03', authenticated_user_id: null, request_id: 'r', user_text: 'That 5 is about right. Keep it.', user_turn_text: 'That 5 is about right. Keep it.' };
  const compound = () => {
    let nodes: SNode[] = structuredClone(writable.nodes);
    let rev = 0;
    const d: InternalDispatch = async (path, body) => {
      const b = (body ?? {}) as Record<string, unknown>;
      if (path.endsWith('/graph/register')) { nodes = (b as { graph: { nodes: SNode[] } }).graph.nodes; rev += 1; return { status: 200, json: { registered: true, graph_hash: `h${rev}` } }; }
      return { status: 200, json: { graph: { nodes, edges: writable.edges }, graph_hash: `h${rev}` } };
    };
    const store = new ProposalStore();
    return { caps: createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels: levelsPortOver(d) }), nodes: () => nodes };
  };
  const status = (out: unknown) => narrateWriteOutcome('', [{ name: 'authorise_change' }], [out as never], { versioned: false }).status ?? '';

  it('RED: a pressed keep says "Recorded that you accept Olumi’s estimate."', async () => {
    const { caps } = compound();
    const r = await caps.proposeAssumptions(sctx, { assumptions: [{ factor_label: LABEL, value: 5, unit: 'connections/month', basis: 'the user agreed', keep: true }] } as never);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = await caps.authoriseChange(sctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(Array.isArray(out.parts), 'PRECONDITION: the compound door reports by part').toBe(true);
    expect(status(out)).toBe('Recorded that you accept Olumi’s estimate.');
  });

  it('CONTROL: the user’s own revision through the same door keeps its existing receipt', async () => {
    const { caps } = compound();
    const c = { ...sctx, user_text: 'Make it 3 a month.', user_turn_text: 'Make it 3 a month.' };
    const r = await caps.proposeAssumptions(c, { assumptions: [{ factor_label: LABEL, value: 3, unit: 'connections/month', basis: 'their figure', revise: true }] } as never);
    const out = await caps.authoriseChange(c, { proposal_id: String(r.proposal_id) });
    expect(status(out)).toBe('Saved 1 of 1 starting values.');
  });
});
