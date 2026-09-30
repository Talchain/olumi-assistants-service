/**
 * ⛔ THE USER'S "25% CHEAPER" NEVER LANDED ON A 0–1 FACTOR (R3 joined run on the final share tuple, CEE `2366977`:
 * ccalt edit_applied_user 0/3; r1 guest `4f6334be`).
 *
 * The user wrote "Our team's quote shows GCP would be about 25% cheaper than AWS for our workload." The Agent proposed
 * `GCP saving rate` (unit `proportion`, value 0.2, no cap, no frame) at 25 %. `propose_assumptions` adopted the 25 raw:
 * the approval read "GCP saving rate: 0.2% → 25%", and `authorise_change` came back `not_applied` ("the value was
 * rejected as invalid"). The same figure proposed as 0.25 lands (alt-B, `users-comparative-figure-is-theirs.test.ts`).
 *
 * A factor whose native range IS [0,1] — the value gate's own rule, `isProportionScaledFactorState` — takes a percent in
 * (1, 100] as v ÷ 100 in its own unit, shown as the percent the user wrote. Nothing else moves.
 *
 * FIXTURE: the served graph read after the brief, and the user's sentence (`_provenance`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

type Json = Record<string, any>;
const F = JSON.parse(readFileSync(new URL('./fixtures/served-ccalt-r1-2366977-before-edit.json', import.meta.url), 'utf8')) as {
  _provenance: { edit: string }; graph: Json;
};
const EDIT = F._provenance.edit;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type R = ToolResult & { proposal_id: string; public_label: string };

async function propose(graph: Json, value: number, unit: string, said = EDIT) {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const store = new ProposalStore();
  const r = await createAgentCapabilities(d, store).proposeAssumptions(
    { scenario_id: '4f6334be-cb3f-49ef-aa26-520cc9095ec3', authenticated_user_id: null, request_id: 'r', user_text: said } as never,
    { assumptions: [{ factor_label: 'GCP saving rate', value, unit, basis: 'the team\'s quote', revise: true }] },
  ) as R;
  const op = store.get(String(r.proposal_id))?.operations.find((o) => (o as { path?: string }).path === 'gcp_saving_rate') as
    { value?: { value?: number; unit?: string; authored_by?: string } } | undefined;
  return { r, stored: op?.value };
}
const withSaving = (state: Json): Json => {
  const g = clone(F.graph);
  (g.nodes as Json[]).find((n) => n.id === 'gcp_saving_rate')!.observed_state = state;
  return g;
};

describe('PREMISE — the served factor', () => {
  it('GCP saving rate is a 0–1 proportion at 0.2, with no cap and no frame, and Olumi\'s', () => {
    expect((F.graph.nodes as Json[]).find((n) => n.id === 'gcp_saving_rate')!.observed_state)
      .toEqual({ unit: 'proportion', value: 0.2, source: 'cee_inference', extractionType: 'inferred' });
  });
});

describe('a user\'s percent on a 0–1 factor is stored on its scale', () => {
  it('RED (served ccalt r1): 25 % is stored as 0.25 in the factor\'s unit, the user\'s, shown "20% → 25%"', async () => {
    const { r, stored } = await propose(F.graph, 25, '%');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(stored).toMatchObject({ value: 0.25, unit: 'proportion', authored_by: 'user_stated' });
    expect(r.public_label).toContain('GCP saving rate: 20% → 25%');
    expect(r.public_label).not.toContain('0.2%');
  });

  it('CONTROL: the same figure proposed as 0.25 proportion is unchanged', async () => {
    const { r, stored } = await propose(F.graph, 0.25, 'proportion');
    expect(stored).toMatchObject({ value: 0.25, unit: 'proportion', authored_by: 'user_stated' });
    expect(r.public_label).toContain('GCP saving rate: 20% → 25%');
  });

  it('CONTROL: a capped factor (0–100 frame) keeps 25 — the cap outranks the unit token', async () => {
    const { stored } = await propose(withSaving({ unit: 'proportion', value: 0.2, raw_value: 20, cap: 100, source: 'cee_inference' }), 25, '%');
    expect(stored).toMatchObject({ value: 25, unit: '%' });
  });

  it('CONTROL: a framed factor (value/raw_value pair, no cap) keeps 25 — the frame outranks the unit token', async () => {
    const { stored } = await propose(withSaving({ unit: 'proportion', value: 0.2, raw_value: 20, source: 'cee_inference' }), 25, '%');
    expect(stored).toMatchObject({ value: 25, unit: '%' });
  });

  it('CONTROL: a percent above 100 is not a share — never divided', async () => {
    const { stored } = await propose(F.graph, 150, '%', 'It is 150% of AWS.');
    expect(stored).toMatchObject({ value: 150, unit: '%' });
  });

  it('CONTROL: a figure in another unit is not converted', async () => {
    const { stored } = await propose(F.graph, 25, 'points');
    expect(stored?.value).toBe(25);
  });
});
