/**
 * P02 bar gate (DL ruling, 8 Oct 00:2xZ; served witness p02-3, CEE 7b9db3b): after a pre-mortem press left its card
 * waiting, the bar still offered `pre_mortem` as a fresh press, and pressing it only said "That suggestion is already
 * waiting for your yes" (agent-v1-turn.ts, #2751 idempotency): a near-dead control. While an approval card waits on this
 * revision, the bar offers the pre-mortem DISABLED with a reason that points at the waiting card. It reads only the
 * persisted carrier (`approvalWaitingOf`), so the live bar and the reload GET's bar stay byte-identical (amendment 9).
 */
import { describe, it, expect } from 'vitest';
import served from '../../__tests__/fixtures/m1-s1-served-graphs.json';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { actionFactsOf, type ActionRead } from '../state.js';
import { actionBarOf, DISABLED, type ActionBarV1 } from '../rank.js';
import { approvalChipIdFor } from '../../approval-chips.js';
import type { PendingAction } from '../../../session/pending-action.js';

const D1 = served.cases.find((c) => c.id === 'D1-sprint-run')!;
const SCENARIO = '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const AT = '2026-10-07T12:00:00.000Z';
const hashOf = (g: unknown) => computeAnalysisAffectingGraphHash(g as never)!;
const ran = (graph: unknown): ActionRead => {
  const h = hashOf(graph);
  return {
    scenarioId: SCENARIO, graph, graphHash: h,
    analysisState: { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true, leader_claim: { permitted: true, separation: 'separated' } },
    analysisReady: { status: 'ready', may_run: true },
    analysisResult: { type: 'analysis_result', computed_against_hash: h, data: {} },
    optionParticipation: [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }],
  };
};
const approval = (graph: unknown, overrides: Partial<PendingAction> = {}): PendingAction => ({
  id: 'pending', scenario_id: SCENARIO, chip_id: approvalChipIdFor('prop_0123456789ab'),
  action: { kind: 'apply_proposed_change', proposal_ref: 'prop_0123456789ab', inline_patch: {}, public_label: 'Approve', public_message: 'Approve the held change.' },
  preconditions: { graph_hash: hashOf(graph) }, expires_at_turn_count: 12, expires_at_iso: '2099-01-01T00:00:00.000Z', emitted_at_iso: AT, ...overrides,
});
const bar = (read: ActionRead) => actionBarOf(actionFactsOf(read));
const offers = (b: ActionBarV1) => [...b.priority, ...b.standard, ...b.more];
const premortem = (b: ActionBarV1) => offers(b).find((o) => o.action_id === 'pre_mortem');

describe('P02 bar gate: no fresh pre-mortem press while its card waits', () => {
  it('CONTROL: a bound Run with no waiting card offers the pre-mortem enabled', () => {
    expect(premortem(bar(ran(D1.graph)))).toMatchObject({ enabled: true });
  });

  it('RED: a live approval card on this revision → the pre-mortem is offered disabled, pointing at the waiting card', () => {
    const p = premortem(bar({ ...ran(D1.graph), pending: [approval(D1.graph)] }));
    expect(p).toMatchObject({ enabled: false, disabled_reason: DISABLED.already_waiting });
    expect(p).not.toHaveProperty('why_now');
  });

  it('CONTROL (passes on base too): the pre-mortem is never a priority pill while a card waits', () => {
    const b = bar({ ...ran(D1.graph), pending: [approval(D1.graph)] });
    expect(b.priority.map((o) => o.action_id)).not.toContain('pre_mortem');
  });

  it('CONTROL: an approval with no turns left, or offered on another revision, is not waiting → enabled', () => {
    expect(premortem(bar({ ...ran(D1.graph), pending: [approval(D1.graph, { expires_at_turn_count: 0 })] }))).toMatchObject({ enabled: true });
    expect(premortem(bar({ ...ran(D1.graph), pending: [approval(D1.graph, { preconditions: { graph_hash: 'f'.repeat(16) } })] }))).toMatchObject({ enabled: true });
  });

  it('the live bar and the reload bar agree: same facts → byte-identical bar', () => {
    const read = { ...ran(D1.graph), pending: [approval(D1.graph)] };
    expect(JSON.stringify(bar(read))).toBe(JSON.stringify(bar(read)));
  });

  it('the reason names the waiting card, never a ranking or a recommendation', () => {
    expect(DISABLED.already_waiting).toMatch(/waiting for your yes/i);
    expect(DISABLED.already_waiting).not.toMatch(/\b(best|winner|recommend)/i);
  });
});
