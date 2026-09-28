/**
 * ⛔ THE USER'S SPLIT OF A TOTAL THEY SET IS THEIR LEVEL, WITH THE WORKING (AI Quality ruling #70 5859388817).
 *
 * Served (DL pj-20260927T181846Z, journey C): C06/C07 set the "Incremental 6-month spend" limit to at most £30,000
 * (`goal_constraints` row, `provenance: 'explicit'`). At C08 the user typed "Let's spit it 50/50 at this stage." (sic),
 * and the option went in with NO levels: "'50/50' did not state a separate figure for either factor in the model".
 *
 * THE SEAM: the real `proposeNewOption` over the SERVED C08 graph. The split levels ride the ONE proposal SET, with the
 * working as their basis. INTERIM (AI Quality 5859798011): until Canonical's `derived_from` slot lands (#70 5859537590)
 * they are recorded as Olumi's reading of the user's split (`cee_hypothesis`), never as the user's with no record of the
 * derivation; the PR that lands the slot flips these rows to `user_specified` + `derived_from`. Anything short of the
 * three conditions takes today's path (unset and said).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { gmHeldProposalRef } from '../../handlers/edit-graph-referee-gate.js';

const SCENARIO = '205b462e-edfc-439d-9a4a-5398ffc11ecf';
const C08 = "Let's spit it 50/50 at this stage.";
const FEATURES = 'Incremental feature investment…';
const ADS = 'Incremental advertising spend…';
const TOTAL = 'Incremental 6-month spend';
const cGraph = JSON.parse(readFileSync(new URL('./fixtures/journey-c-c08-draft-graph.json', import.meta.url), 'utf8')) as {
  nodes: Record<string, unknown>[]; goal_constraints: Record<string, unknown>[];
};

type Iv = { factor_id: string; value: unknown; raw_value?: unknown; source?: unknown; derived_from?: unknown };
type Lv = { factor: string; value: unknown; stated_by?: string; derived?: string };

function setup(graph: unknown) {
  const sent: { path: string; body: unknown }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    sent.push({ path, body });
    const oid = (body as { chip?: { parameters?: { option_id?: string } } }).chip?.parameters?.option_id;
    return { status: 200, json: { suggested_actions: [{ id: gmHeldProposalRef(SCENARIO, `node:${oid}`), label: 'Approve', message: 'Yes, add it.' }] } };
  };
  return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
}

async function propose(message: string, levels: { features?: number; ads?: number; total?: number }, graph: unknown = cGraph, sessionText?: string, label = 'Split it 50/50 at this stage') {
  const { caps, sent } = setup(graph);
  const acts = [
    { factor_label: FEATURES, direction: 'positive', ...(levels.features !== undefined ? { level: { value: levels.features, unit: 'GBP' } } : {}) },
    { factor_label: ADS, direction: 'positive', ...(levels.ads !== undefined ? { level: { value: levels.ads, unit: 'GBP' } } : {}) },
    { factor_label: TOTAL, direction: 'positive', ...(levels.total !== undefined ? { level: { value: levels.total, unit: 'GBP' } } : {}) },
  ];
  const r = await caps.proposeNewOption(
    { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_turn_text: message, user_text: sessionText ?? message },
    { label, acts_on: acts, rationale: 'The user asked for it.' } as never,
  ) as { ok?: boolean; levels?: Lv[]; levels_not_set?: { factor: string; reason: string }[] };
  const ivs = ((sent[0]?.body as { chip?: { parameters?: { interventions?: Iv[] } } } | undefined)?.chip?.parameters?.interventions ?? []);
  return { r, iv: (id: string) => ivs.find((x) => x.factor_id === id), lv: (f: string) => r.levels?.find((l) => l.factor === f), sent };
}

const withLimits = (rows: Record<string, unknown>[]) => ({ ...cGraph, goal_constraints: rows });
const SPEND_LIMIT = cGraph.goal_constraints.find((c) => c.node_id === 'incremental_6_month_spend')!;

describe('C08: "50/50" of the £30,000 the user set → £15,000 each, set, with the working', () => {
  it('RED: both parts are SET at £15,000 (served: both left unset), as Olumi\'s reading until the derived_from slot lands', async () => {
    const { iv, r } = await propose(C08, { features: 15000, ads: 15000 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    for (const id of ['incremental_feature_investment_6_months', 'incremental_advertising_spend_6_months']) {
      expect(iv(id)?.raw_value, id).toBe(15000);
      expect(iv(id)?.source, `${id}: never the user's while the derivation cannot be recorded`).toBe('cee_hypothesis');
    }
  });

  it('RED: the Agent is handed the working as the basis ("£15,000 each: half of your £30,000, as Olumi read it")', async () => {
    const { lv } = await propose(C08, { features: 15000, ads: 15000 });
    for (const f of [FEATURES, ADS]) {
      expect(lv(f)).toMatchObject({ stated_by: 'olumi_estimate', basis: '£15,000 each: half of your £30,000, as Olumi read it' });
    }
  });

  it('RED: an option named for the whole ("Split the £30,000 50/50") still sets the parts: the name\'s figure is the total, not a level', async () => {
    const { iv } = await propose(C08, { features: 15000, ads: 15000 }, cGraph, undefined, 'Split the £30,000 50/50');
    expect(iv('incremental_feature_investment_6_months')?.raw_value).toBe(15000);
    expect(iv('incremental_advertising_spend_6_months')?.raw_value).toBe(15000);
  });

  it('the total itself is not a part of its own split: a level the user did not write for it stays unset', async () => {
    const { iv } = await propose(C08, { features: 15000, ads: 15000, total: 30000 });
    expect(iv('incremental_feature_investment_6_months')?.raw_value, 'control: the parts still derive').toBe(15000);
    expect(iv('incremental_6_month_spend')?.value).toBeNull();
  });
});

describe('any condition failing takes today\'s path (unset and said), never the user\'s', () => {
  it('RED: condition 1 — a limit Olumi inferred is not a total the user set', async () => {
    const { iv } = await propose(C08, { features: 15000, ads: 15000 }, withLimits([{ ...SPEND_LIMIT, provenance: 'inferred' }]));
    expect(iv('incremental_feature_investment_6_months')?.value).toBeNull();
    expect(iv('incremental_feature_investment_6_months')?.derived_from).toBeUndefined();
  });

  it('RED: condition 1 — the ratio must be typed in THIS message; a "50/50" from an earlier turn is not this change', async () => {
    const { iv } = await propose('Add that as an option.', { features: 15000, ads: 15000 }, cGraph, `${C08}\nAdd that as an option.`);
    expect(iv('incremental_feature_investment_6_months')?.value).toBeNull();
  });

  it('RED: condition 3 — two totals the user set in scope → both left unset and one ask, never a pick', async () => {
    const second = { unit: 'GBP', label: ADS, value: 20000, node_id: 'incremental_advertising_spend_6_months', operator: '<=', provenance: 'explicit', value_frame: 'level' };
    const { iv, r } = await propose(C08, { features: 15000, ads: 15000, total: 30000 }, withLimits([SPEND_LIMIT, second]));
    expect(iv('incremental_feature_investment_6_months')?.value).toBeNull();
    expect(r.levels_not_set?.find((l) => l.factor === FEATURES)?.reason).toMatch(/more than one total they set.*Ask which total they mean/);
  });

  it('RED: figures that are not the user\'s split (the Agent\'s 20,000 / 10,000 for "50/50") are not theirs', async () => {
    const { iv } = await propose(C08, { features: 20000, ads: 10000 });
    expect(iv('incremental_feature_investment_6_months')?.value).toBeNull();
    expect(iv('incremental_advertising_spend_6_months')?.value).toBeNull();
  });

  it('condition 2 — a hedge ("roughly 50/50") is not exact arithmetic', async () => {
    const { iv } = await propose("Let's do roughly 50/50.", { features: 15000, ads: 15000 });
    expect(iv('incremental_feature_investment_6_months')?.value).toBeNull();
  });

  it('CONTROL: figures the user typed ("£15,000 each") are theirs by the ordinary path, with no derivation recorded', async () => {
    const { iv } = await propose('Put £15,000 into features and £15,000 into advertising.', { features: 15000, ads: 15000 });
    expect(iv('incremental_feature_investment_6_months')?.raw_value).toBe(15000);
    expect(iv('incremental_feature_investment_6_months')?.source).toBeUndefined();
    expect(iv('incremental_feature_investment_6_months')?.derived_from).toBeUndefined();
  });
});

/**
 * SERVED `pj-aic-C-9303888` (C08 on 9303888): here the limit and every spend factor are in "GBP over 6 months". An
 * offline replay on that graph left both parts UNSET when the Agent spelt the level "GBP", and set them when it spelt
 * "GBP over 6 months" or gave no unit: whether C08 moved depended on the model's spelling of the unit.
 */
describe('the split binds in the FACTOR\'s unit, never the Agent\'s spelling of it (served run 2 graph)', () => {
  const g2 = JSON.parse(readFileSync(new URL('./fixtures/journey-c-c08-run2-draft-graph.json', import.meta.url), 'utf8')) as unknown;
  const run = async (unit: string | undefined) => {
    const { caps, sent } = setup(g2);
    const lvl = (v: number) => (unit === undefined ? { value: v } : { value: v, unit });
    await caps.proposeNewOption(
      { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_turn_text: C08, user_text: C08 },
      { label: 'Split £30k equally between features and advertising', rationale: 'r', acts_on: [
        { factor_label: 'Incremental feature spend', direction: 'positive', level: lvl(15000) },
        { factor_label: 'Additional advertising spend', direction: 'positive', level: lvl(15000) },
      ] } as never,
    );
    const ivs = ((sent[0]?.body as { chip?: { parameters?: { interventions?: Iv[] } } } | undefined)?.chip?.parameters?.interventions ?? []);
    return (id: string) => ivs.find((x) => x.factor_id === id);
  };

  it('RED: the Agent spells the level "GBP" → both parts still set at £15,000 (served: unset)', async () => {
    const iv = await run('GBP');
    expect(iv('incremental_feature_spend')?.raw_value).toBe(15000);
    expect(iv('additional_advertising_spend')?.raw_value).toBe(15000);
    expect(iv('incremental_feature_spend')?.source).toBe('cee_hypothesis');
  });

  it('CONTROL: the factor\'s own unit, or none, binds as before', async () => {
    expect((await run('GBP over 6 months'))('incremental_feature_spend')?.raw_value).toBe(15000);
    expect((await run(undefined))('incremental_feature_spend')?.raw_value).toBe(15000);
  });

  it('RED (AIQ 5860429146): factors measured PER MONTH under a six-month total → unset with the period reason, even as Olumi\'s estimate', async () => {
    const perMonth = JSON.parse(JSON.stringify(g2)) as { nodes: { id: string; observed_state?: { unit?: string } }[] };
    for (const n of perMonth.nodes) if (n.id === 'incremental_feature_spend' || n.id === 'additional_advertising_spend') n.observed_state!.unit = 'GBP per month';
    for (const estimate of [false, true]) {
      const { caps, sent } = setup(perMonth);
      const lvl = { value: 15000, unit: 'GBP', ...(estimate ? { estimate: true, basis: 'half of the £30,000' } : {}) };
      const r = await caps.proposeNewOption(
        { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_turn_text: C08, user_text: C08 },
        { label: 'Split £30k equally between features and advertising', rationale: 'r', acts_on: [
          { factor_label: 'Incremental feature spend', direction: 'positive', level: lvl },
          { factor_label: 'Additional advertising spend', direction: 'positive', level: lvl },
        ] } as never,
      ) as { levels_not_set?: { factor: string; reason: string }[] };
      const ivs = ((sent[0]?.body as { chip?: { parameters?: { interventions?: Iv[] } } } | undefined)?.chip?.parameters?.interventions ?? []);
      expect(ivs.find((x) => x.factor_id === 'incremental_feature_spend')?.value, `estimate=${estimate}`).toBeNull();
      expect(r.levels_not_set?.find((l) => l.factor === 'Incremental feature spend')?.reason, `estimate=${estimate}`).toMatch(/measured in GBP per month.*never convert it/);
    }
  });

  it('CONTRAST: a level in another period ("GBP per month") is never a part of a six-month total', async () => {
    const iv = await run('GBP per month');
    expect(iv('incremental_feature_spend')?.value).toBeNull();
    expect(iv('additional_advertising_spend')?.value).toBeNull();
  });
});
