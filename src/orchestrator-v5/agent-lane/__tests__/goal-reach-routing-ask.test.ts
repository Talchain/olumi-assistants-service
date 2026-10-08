/**
 * GOAL-REACH build 1c (Science §(e) addendum 5): a risk linked straight into the goal vetoes Olumi's stored reading; the
 * routing ask names it. Fixture: the SERVED stored graph after Paul-brief R5 (P44 draw 4), never hand-written.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proposeProductIdentity, storedReadingVetoOf } from '../identity-proposal.js';
import { buildRepointRiskOperations, dispatchRepointRiskTransaction } from '../../handlers/repoint-risk-dispatch.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';

type Rec = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/goal-reach-served-r5-risk-veto.json', import.meta.url), 'utf8')) as Rec).graph as Rec;
const graph = (edit: (g: Rec) => void = () => {}): Rec => { const g = structuredClone(SERVED); edit(g); return g; };
const RISK = 'risk_feature_release_slips';

describe('GOAL-REACH 1c — the one risk that vetoes the reading', () => {
  it('served R5: no card today, and the veto names the risk the user added', () => {
    expect(proposeProductIdentity(SERVED)).toBeNull();
    expect(storedReadingVetoOf(SERVED)).toEqual({ goal_id: 'mrr', risk_id: RISK, factor_ids: ['pro_plan_price', 'pro_paying_subscribers'] });
  });

  it('CONTROL: re-pointing that risk into a factor (the routing answer) brings the card back, and the veto is gone', () => {
    const rerouted = graph(g => { const e = g.edges.find((x: Rec) => x.from === RISK && x.to === 'mrr'); e.to = 'pro_paying_subscribers'; });
    expect(proposeProductIdentity(rerouted)).not.toBeNull();
    expect(storedReadingVetoOf(rerouted)).toBeNull();
  });

  it('no routing ask when two parents veto, when the vetoing parent is not a risk, or when the reading fails for another reason', () => {
    const two = graph(g => {
      g.nodes.push({ id: 'risk_second', kind: 'risk', label: 'Second risk' });
      g.edges.push({ from: 'risk_second', to: 'mrr', strength: { mean: -0.3, std: 0.1 } });
    });
    expect(storedReadingVetoOf(two)).toBeNull();
    const factor = graph(g => { g.nodes.find((n: Rec) => n.id === RISK).kind = 'factor'; });
    expect(storedReadingVetoOf(factor)).toBeNull();
    const confirmed = graph(g => { g.nodes.find((n: Rec) => n.id === 'mrr').nonlinear_identity.stated_in_brief = true; });
    expect(storedReadingVetoOf(confirmed)).toBeNull();
  });
});

describe('GOAL-REACH 1c — the re-point transaction (the routing answer "through ‘<factor>’")', () => {
  const hold = (g: Rec, factor: string, risk = RISK) => dispatchRepointRiskTransaction({ riskId: risk, toFactorId: factor, currentGraph: g,
    currentGraphHash: computeAnalysisAffectingGraphHash(g as never), freshness: 'fresh', mode: 'live',
    scenarioId: '00000000-0000-4000-8000-0000000001c0', turnId: 't-1c', requestId: 'r-1c', stage: 'frame' });
  it.each(['pro_paying_subscribers', 'pro_plan_price'])('RED: through %s → ONE held pending [remove risk→MRR, add risk→factor]; applying it brings the card back', factor => {
    const out = hold(SERVED, factor);
    expect(out.kind).toBe('held');
    if (out.kind !== 'held') return;
    expect(out.pendingActions).toHaveLength(1);
    const ops = (out.pendingActions[0]!.action as { inline_patch: { operations: Rec[] } }).inline_patch.operations;
    expect(ops.map(o => [o.op, o.path])).toEqual([['remove_edge', `${RISK}::mrr`], ['add_edge', `${RISK}::${factor}`]]);
    expect(ops[1]!.value).toMatchObject({ provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
    const after = applyPatchOperations(SERVED as never, ops as never);
    expect(proposeProductIdentity(after)).not.toBeNull();
    expect(storedReadingVetoOf(after)).toBeNull();
  });
  it('CONTROLS: another risk, a factor outside the reading, or an existing link → refused, nothing held', () => {
    expect(buildRepointRiskOperations(SERVED, 'mrr_lost_to_price_resistance', 'pro_paying_subscribers')).toEqual({ ok: false, reason: 'not_the_veto' });
    expect(buildRepointRiskOperations(SERVED, RISK, 'monthly_churn')).toEqual({ ok: false, reason: 'factor_not_in_reading' });
    const linked = graph(g => { g.edges.push({ from: RISK, to: 'pro_paying_subscribers', strength: { mean: -0.5, std: 0.1 } }); });
    expect(buildRepointRiskOperations(linked, RISK, 'pro_paying_subscribers')).toEqual({ ok: false, reason: 'already_linked' });
    expect(hold(SERVED, 'pro_paying_subscribers', 'mrr_lost_to_price_resistance').kind).toBe('refused');
  });
});
