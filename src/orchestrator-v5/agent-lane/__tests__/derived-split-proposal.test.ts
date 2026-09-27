/**
 * ⛔ THE USER'S SPLIT OF A TOTAL THEY SET IS THEIR LEVEL, WITH THE WORKING (AI Quality ruling #70 5859388817).
 *
 * Served (DL pj-20260927T181846Z, journey C): C06/C07 set the "Incremental 6-month spend" limit to at most £30,000
 * (`goal_constraints` row, `provenance: 'explicit'`). At C08 the user typed "Let's spit it 50/50 at this stage." (sic),
 * and the option went in with NO levels: "'50/50' did not state a separate figure for either factor in the model".
 *
 * THE SEAM: the real `proposeNewOption` over the SERVED C08 graph. The split levels ride the ONE proposal as the
 * user's (no `cee_hypothesis`), each carrying `derived_from` (the carrier waits for Canonical, #70 5859537590), and the
 * Agent is handed the working to say. Anything short of the three conditions takes today's path.
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

async function propose(message: string, levels: { features?: number; ads?: number; total?: number }, graph: unknown = cGraph, sessionText?: string) {
  const { caps, sent } = setup(graph);
  const acts = [
    { factor_label: FEATURES, direction: 'positive', ...(levels.features !== undefined ? { level: { value: levels.features, unit: 'GBP' } } : {}) },
    { factor_label: ADS, direction: 'positive', ...(levels.ads !== undefined ? { level: { value: levels.ads, unit: 'GBP' } } : {}) },
    { factor_label: TOTAL, direction: 'positive', ...(levels.total !== undefined ? { level: { value: levels.total, unit: 'GBP' } } : {}) },
  ];
  const r = await caps.proposeNewOption(
    { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_turn_text: message, user_text: sessionText ?? message },
    { label: 'Split it 50/50 at this stage', acts_on: acts, rationale: 'The user asked for it.' } as never,
  ) as { ok?: boolean; levels?: Lv[]; levels_not_set?: { factor: string; reason: string }[] };
  const ivs = ((sent[0]?.body as { chip?: { parameters?: { interventions?: Iv[] } } } | undefined)?.chip?.parameters?.interventions ?? []);
  return { r, iv: (id: string) => ivs.find((x) => x.factor_id === id), lv: (f: string) => r.levels?.find((l) => l.factor === f), sent };
}

const withLimits = (rows: Record<string, unknown>[]) => ({ ...cGraph, goal_constraints: rows });
const SPEND_LIMIT = cGraph.goal_constraints.find((c) => c.node_id === 'incremental_6_month_spend')!;

describe('C08: "50/50" of the £30,000 the user set → £15,000 each, the user\'s, with the working', () => {
  it('RED: both parts go as the user\'s levels, each carrying how it was derived', async () => {
    const { iv, r } = await propose(C08, { features: 15000, ads: 15000 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    for (const id of ['incremental_feature_investment_6_months', 'incremental_advertising_spend_6_months']) {
      expect(iv(id)?.raw_value, id).toBe(15000);
      expect(iv(id)?.source, `${id}: the user's, never Olumi's estimate`).toBeUndefined();
      expect(iv(id)?.derived_from).toEqual({ op: 'split', ratio: [0.5, 0.5], base: { node_id: 'incremental_6_month_spend', value: 30000 } });
    }
  });

  it('RED: the Agent is handed the working to say ("£15,000 each: half of your £30,000")', async () => {
    const { lv } = await propose(C08, { features: 15000, ads: 15000 });
    expect(lv(FEATURES)).toMatchObject({ stated_by: 'user', derived: '£15,000 each: half of your £30,000' });
    expect(lv(ADS)).toMatchObject({ stated_by: 'user', derived: '£15,000 each: half of your £30,000' });
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
