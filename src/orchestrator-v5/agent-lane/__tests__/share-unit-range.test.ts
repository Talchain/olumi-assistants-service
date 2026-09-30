/**
 * ⛔ A UNIT THAT STATES A 0–1 RANGE IS A SHARE, SO "25%" IS READ AS 0.25 THERE TOO (MG SUCCESSOR #75 5910272624; R3's
 * candidate-2 witness `cand2-2cd7823-1057Z/ccalt/r1`, served CEE 2cd7823).
 *
 * The served drafter wrote "GCP unit-cost saving" as `{ unit: 'share (0-1)', value: 0.2 }`. The estate's proportion rule
 * knew only `proportion | ratio | scale | unit_interval`, so the user's "about 25% cheaper" proposed as `{25, "%"}` was
 * NOT read in the factor's frame: the card read "0.2% → 25%" (a 100× false figure) and the write refuses 25 on a 0–1
 * factor (#2348's original class). In 75 served drafts only 2 of 18 uncapped 0–1 factors carried a recognised unit; the
 * rest were `share (0-1)`, `fraction of workloads`, `adoption fraction (0-1)`, `0-1`, …
 *
 * The rule stays CLOSED and "nothing contradicts it" (a cap other than 1, or a recoverable frame, still outranks the
 * unit): a head word `share` / `fraction` / `proportion`, or a stated `0-1` range, joins the vocabulary. A `0/1` switch,
 * a count of `shares`, and an amount unit never do.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { isProportionScaledFactor } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

type Json = Record<string, any>;
const R2 = JSON.parse(readFileSync(new URL('./fixtures/served-share-unit-r2-20260930.json', import.meta.url), 'utf8')) as { sentence: string; graph: Json };
const LABEL = 'GCP unit-cost saving';

async function propose(value: number, unit: string) {
  const graph = structuredClone(R2.graph);
  const d: InternalDispatch = async (path) => { if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } }; throw new Error(path); };
  const store = new ProposalStore();
  const r = await createAgentCapabilities(d, store).proposeAssumptions(
    { scenario_id: '550e8400-e29b-41d4-a716-446655440c02', authenticated_user_id: null, request_id: 'r', user_text: R2.sentence } as never,
    { assumptions: [{ factor_label: LABEL, value, unit, basis: "the team's quote", revise: true }] } as never) as Json;
  const op = r.proposal_id ? (store.get(r.proposal_id)!.operations[0] as Json).value : null;
  return { r, op };
}

describe('served R2: the user\'s "about 25% cheaper" on a `share (0-1)` factor', () => {
  it('vacuity: the served factor holds 0.2 in `share (0-1)`, uncapped, with no frame', () => {
    const f = R2.graph.nodes.find((n: Json) => n.label === LABEL);
    expect(f?.observed_state).toMatchObject({ unit: 'share (0-1)', value: 0.2 });
    expect(f?.observed_state.cap).toBeUndefined();
    expect(f?.observed_state.raw_value).toBeUndefined();
  });

  it('RED: {25, "%"} is read in the factor\'s frame — 0.25, the user\'s — and the card reads 20% → 25%, never 0.2%', async () => {
    const { r, op } = await propose(25, '%');
    expect(op).toEqual({ value: 0.25, unit: 'share (0-1)', basis: "the team's quote", authored_by: 'user_stated' });
    expect(r.public_label).toContain(`${LABEL}: 20% → 25% (your figure, in your words:`);
    expect(r.public_label).not.toContain('0.2%');
  });

  it('CONTROL: {0.25, "share (0-1)"} (the served call that saved) is unchanged', async () => {
    const { op } = await propose(0.25, 'share (0-1)');
    expect(op).toEqual({ value: 0.25, unit: 'share (0-1)', basis: "the team's quote", authored_by: 'user_stated' });
  });
});

describe('the ONE proportion rule, on the units the served drafts use', () => {
  const uncapped = (unit: string, value = 0.2) => isProportionScaledFactor({ unit, cap: undefined, value, raw_value: undefined });
  it.each(['share (0-1)', 'fraction of workloads', 'fraction', 'proportion of workload', 'adoption fraction (0-1)', '0-1', '0-1 deployment', '0–1 adoption', 'share of revenue'])(
    'RED: %s (a stated share or 0–1 range) is proportion-scaled', (unit) => { expect(uncapped(unit)).toBe(true); });
  it.each(['proportion', 'ratio', 'scale', 'unit_interval'])('CONTROL: the existing token %s still is', (unit) => { expect(uncapped(unit)).toBe(true); });
  it.each(['0/1', 'active (0/1)', 'binary', 'active/inactive', 'deployed (0/1)', 'shares', '£/month', 'weeks', '%', 'subscribers', 'market share %', 'share (percent)'])(
    'CONTROL: %s (a switch, a count, an amount, a percent) never is', (unit) => { expect(uncapped(unit)).toBe(false); });
  it('CONTROL: a value outside [0, 1] contradicts a share unit ("market share" holding 23)', () => {
    expect(uncapped('market share', 23)).toBe(false);
    expect(uncapped('fraction', 3)).toBe(false);
  });
  it('CONTROL: a cap other than 1 or a recoverable frame still outranks a share unit', () => {
    expect(isProportionScaledFactor({ unit: 'share (0-1)', cap: 100, value: 0.35, raw_value: 35 })).toBe(false);
    expect(isProportionScaledFactor({ unit: 'fraction', cap: undefined, value: 0.35, raw_value: 35 })).toBe(false);
  });
});
