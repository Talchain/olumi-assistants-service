/**
 * The level an option sets — the last structural wall on the journey.
 *
 * ⛔ MEASURED LIVE at served 59c90069, after the scale frame landed: every
 * factor valued, `baseline_scale_unresolved` gone, and the analysis STILL
 * refused because two options connected to a factor without stating a level.
 *
 * ⛔ AND THE CONSTRAINT THAT SHAPES IT. `option_intervention_edit.value` is
 * `min(0).max(1)` — "the client converts nothing, and the server licenses no
 * raw-unit conversion on this path". A first version of this capability took
 * the user's "£54" straight through and was withdrawn unshipped. It is honest
 * now only because the factor publishes a `cap`, so `raw / cap` reads the
 * user's number against a range the model already declared.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, authorisationTurnId, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = {
  id: string; kind: string; label: string;
  observed_state?: Record<string, unknown>;
  interventions?: Record<string, unknown> | null;
};

const BASE: Node[] = [
  { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue' },
  // Framed: cap 200, so £54 is expressible as 0.27.
  { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP/month' } },
  // Already a proportion: no cap needed.
  { id: 'feature_value', kind: 'factor', label: 'Pro feature value', observed_state: { value: 0.7, unit: 'index 0-1' } },
  // ⛔ THE CONTRAST CONTROL: no frame at all.
  { id: 'subscribers', kind: 'factor', label: 'Pro subscribers', observed_state: { value: 250, unit: 'subscribers' } },
  { id: 'phase_increase', kind: 'option', label: 'Phase Pro price increase', interventions: null },
  { id: 'raise_now', kind: 'option', label: 'Raise at next release', interventions: { pro_plan_price: { value: 0.295 } } },
];

function fakeProduct(opts: { failOn?: string[] } = {}) {
  const posted: { turn_id: string; event: Record<string, unknown> }[] = [];
  let nodes: Node[] = BASE.map((n) => ({ ...n, interventions: n.interventions == null ? n.interventions : { ...n.interventions } }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { option_id: string; factor_id: string; value: number; base_graph_hash: string };
      posted.push({ turn_id: String(b.turn_id), event: ev as unknown as Record<string, unknown> });
      // The real event is CAS-gated: a stale base is refused, as on the wire.
      if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
      if (opts.failOn?.includes(`${ev.option_id}::${ev.factor_id}`) === true) return { status: 422, json: {} };
      nodes = nodes.map((n) => (n.id === ev.option_id
        ? { ...n, interventions: { ...(n.interventions ?? {}), [ev.factor_id]: { value: ev.value } } } : n));
      rev += 1;
      return { status: 200, json: { assistant_text: 'Recorded.' } };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, posted, read: () => nodes };
}

const ASK = {
  interventions: [
    { option_label: 'Phase Pro price increase', factor_label: 'Pro plan price', value: 54, basis: 'the user said a staged rise to £54 first' },
    { option_label: 'Phase Pro price increase', factor_label: 'Pro feature value', value: 0.8, basis: 'the release lifts perceived value' },
  ],
};

describe('the value is read against the factor’s declared range', () => {
  it('normalises a user-scale number by the cap and reports BOTH numbers', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, ASK);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    expect(p.posted).toHaveLength(0);
    expect(r.interventions).toEqual([
      { option: 'Phase Pro price increase', factor: 'Pro feature value', value: 0.8, unit: 'index 0-1',
        recorded_on_model_scale: 0.8, model_range: null, basis: 'the release lifts perceived value' },
      { option: 'Phase Pro price increase', factor: 'Pro plan price', value: 54, unit: 'GBP/month',
        recorded_on_model_scale: 54 / 200, model_range: 200, basis: 'the user said a staged rise to £54 first' },
    ]);
    // The label the user sees quotes THEIR number, never the normalised one.
    expect(String(r.public_label)).toMatch(/sets Pro plan price to 54 GBP\/month/);
  });

  it('REFUSES a factor with no range rather than picking a denominator', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Phase Pro price increase', factor_label: 'Pro subscribers', value: 300, basis: 'growth' }],
    });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('nothing_to_set');
    expect(r.no_stated_range).toEqual([
      { factor: 'Pro subscribers', detail: expect.stringMatching(/has no stated range, so 300 cannot be recorded/) },
    ]);
    expect(String((r.no_stated_range as { detail: string }[])[0].detail)).toMatch(/nothing here will pick a range on your behalf/);
    expect(p.posted).toHaveLength(0);
  });

  it('refuses a number outside the model’s own range', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Phase Pro price increase', factor_label: 'Pro plan price', value: 5000, basis: 'typo' }],
    });
    expect(r.refusal).toBe('nothing_to_set');
    expect((r.no_stated_range as { detail: string }[])[0].detail).toMatch(/outside the model's range for this factor \(0 to 200\)/);
  });

  it('refuses a restatement of what the option already does — the contrast control', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Raise at next release', factor_label: 'Pro plan price', value: 59, basis: 'restated' }],
    });
    expect(r.refusal).toBe('nothing_to_set');
    expect(r.already_set).toEqual(['Raise at next release already sets Pro plan price to 0.295']);
  });
});

describe('authorise_change records the STORED levels', () => {
  it('applies every level although each write moves the graph hash', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeOptionInterventions(ctx, ASK);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });

    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.recorded_count).toBe(2);
    // ⛔ THE DISCRIMINATOR: the second edit carries the hash AFTER the first.
    expect(p.posted.map((x) => x.event.base_graph_hash)).toEqual(['h0', 'h1']);
    // Bound by identity: which option, which factor, which model-scale value.
    expect(p.posted.map((x) => [x.event.option_id, x.event.factor_id, x.event.value])).toEqual([
      ['phase_increase', 'feature_value', 0.8],
      ['phase_increase', 'pro_plan_price', 54 / 200],
    ]);
    expect(p.read().find((n) => n.id === 'phase_increase')?.interventions).toEqual({
      feature_value: { value: 0.8 },
      pro_plan_price: { value: 54 / 200 },
    });
    // And the user's own number is what comes back.
    expect(applied.interventions).toEqual([
      { option: 'Phase Pro price increase', factor: 'Pro feature value', requested: 0.8, recorded: 0.8 },
      { option: 'Phase Pro price increase', factor: 'Pro plan price', requested: 54, recorded: 54 / 200 },
    ]);
    expect(String(applied.not_represented)).toMatch(/quote the user’s own number back/);
  });

  it('gives each level its own derived identity, stable across processes', async () => {
    const p1 = fakeProduct();
    const c1 = createAgentCapabilities(p1.d, new ProposalStore());
    const prop = await c1.proposeOptionInterventions(ctx, ASK);
    await c1.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    const id = String(prop.proposal_id);
    expect(p1.posted.map((x) => x.turn_id)).toEqual([authorisationTurnId(`${id}#0`), authorisationTurnId(`${id}#1`)]);
    expect(new Set(p1.posted.map((x) => x.turn_id)).size).toBe(2);

    const p2 = fakeProduct();
    const c2 = createAgentCapabilities(p2.d, new ProposalStore());
    const prop2 = await c2.proposeOptionInterventions(ctx, ASK);
    await c2.authoriseChange(ctx, { proposal_id: String(prop2.proposal_id) });
    expect(p2.posted.map((x) => x.turn_id)).toEqual(p1.posted.map((x) => x.turn_id));
  });

  it('refuses honestly when nothing was recorded', async () => {
    const p = fakeProduct({ failOn: ['phase_increase::pro_plan_price', 'phase_increase::feature_value'] });
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeOptionInterventions(ctx, ASK);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.ok).toBe(false);
    expect(applied.mutated).toBe(false);
    expect(applied.refusal).toBe('not_applied');
  });
});

describe('preview mode', () => {
  it('has no intervention surface at all', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'preview');
    const r = await caps.proposeOptionInterventions(ctx, ASK);
    expect(r.refusal).toBe('read_only_preview');
    expect(p.posted).toHaveLength(0);
  });
});

describe('the emitted event satisfies the REAL wire contract', () => {
  it('is accepted by SystemEventTurnPayloadSchema, and REFUSES a user-scale number', async () => {
    const { SystemEventTurnPayloadSchema } = await import('@talchain/schemas/boundary');
    const payload = {
      kind: 'system_event' as const,
      turn_id: authorisationTurnId('prop_ff26e7596c7a8bafc3e1695e4b362aa5#0'),
      scenario_id: SCENARIO,
      stage: 'frame' as const,
      event: { kind: 'option_intervention_edit', option_id: 'phase_increase', factor_id: 'pro_plan_price', value: 0.27, base_graph_hash: 'h0' },
    };
    const ok = SystemEventTurnPayloadSchema.safeParse(payload);
    expect(ok.success, JSON.stringify(ok.success ? {} : ok.error.issues.slice(0, 3))).toBe(true);

    // ⛔ THE WHOLE REASON FOR THE cap: the raw £54 is REFUSED by the wire.
    // This is the assertion that killed the first version of this capability.
    const raw = SystemEventTurnPayloadSchema.safeParse({ ...payload, event: { ...payload.event, value: 54 } });
    expect(raw.success).toBe(false);

    // And the base hash is required here, unlike factor_value_edit.
    const { base_graph_hash: _drop, ...noBase } = payload.event;
    expect(SystemEventTurnPayloadSchema.safeParse({ ...payload, event: noBase }).success).toBe(false);
  });
});
