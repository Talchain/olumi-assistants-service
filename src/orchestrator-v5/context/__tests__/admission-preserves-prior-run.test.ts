/**
 * (B) — #70: ONE admission verdict, WITHOUT erasing the prior run.
 *
 * Readiness is about the MODEL; run state is about the RUN (schemas
 * `AnalysisReadinessSchema`). A blocked admission must not make an EARLIER
 * result unusable, and a rerun is offered only when one is currently permitted.
 * These are the pure arms of `canonicalStateFromFreshness` + `composeAnalysisStateV1`
 * that the read route and every turn reply share.
 */
import { describe, it, expect } from 'vitest';
import { canonicalStateFromFreshness } from '../canonical-analysis-state.js';
import { composeAnalysisStateV1 } from '../../compose/analysis-state-v1.js';

type Freshness = Parameters<typeof canonicalStateFromFreshness>[0];

function derivation(freshness: 'fresh' | 'stale' | 'none' | 'unknown', hasFact: boolean): Freshness {
  return {
    freshness,
    reason: freshness === 'none' ? 'never_run' : freshness === 'unknown' ? 'derivation_failed' : freshness,
    selected_fact_index: hasFact ? 0 : null,
    computed_at: hasFact ? '2026-09-25T17:40:00.000Z' : null,
    graph_hash_at_run: hasFact ? 'aaaaaaaaaaaaaaaa' : null,
    current_graph_hash: 'bbbbbbbbbbbbbbbb',
  } as unknown as Freshness;
}

const BLOCKED = {
  status: 'blocked',
  may_run: false,
  blocked_reason: 'MODEL_HAS_BLOCKERS',
  readiness_issues: [
    { issue_id: 'structural_1', code: 'OPTION_NOT_LINKED_TO_DECISION', category: 'graph_structure',
      message: 'An option is not linked to the decision.', repairability: 'human_input_required' },
  ],
};
const ADMITTED = { status: 'ready', may_run: true, readiness_issues: [] };

function wire(freshness: 'fresh' | 'stale' | 'none' | 'unknown', hasFact: boolean, readiness?: Record<string, unknown>) {
  const d = derivation(freshness, hasFact);
  const canonical = canonicalStateFromFreshness(d, readiness ? { readiness: readiness as never } : {});
  const state = composeAnalysisStateV1({
    canonical,
    freshness: d,
    ...(readiness ? { readiness: readiness as never } : {}),
    mayNameLeadingOption: false,
    rawRobustness: null,
  } as never);
  return { canonical, state: state as unknown as {
    run_state: { kind: string }; readiness: { status: string; blockers: Array<{ code: string }> };
    usable_for_prose: boolean; usable_for_followup: boolean; requires_rerun: boolean; blocked_unusable: boolean;
  } };
}

describe('(B) a blocked admission keeps the prior run', () => {
  it('STALE prior run + BLOCKED model → complete_stale, usable as context, NO rerun offered, blockers in readiness', () => {
    const { state } = wire('stale', true, BLOCKED);
    expect(state.run_state.kind).toBe('complete_stale');
    expect(state.blocked_unusable).toBe(false);
    expect(state.usable_for_prose).toBe(true);
    expect(state.usable_for_followup).toBe(true);
    expect(state.requires_rerun).toBe(false);
    expect(state.readiness.status).toBe('blocked');
    expect(state.readiness.blockers.map((b) => b.code)).toEqual(['OPTION_NOT_LINKED_TO_DECISION']);
  });

  it('FRESH prior run + BLOCKED model → complete_current (the run is not erased)', () => {
    expect(wire('fresh', true, BLOCKED).state.run_state.kind).toBe('complete_current');
  });

  it('CONTROL: STALE + ADMITTED → a rerun IS offered', () => {
    const { state } = wire('stale', true, ADMITTED);
    expect(state.run_state.kind).toBe('complete_stale');
    expect(state.requires_rerun).toBe(true);
  });

  it('may_run:false alone withholds the rerun, whatever the status word', () => {
    expect(wire('stale', true, { ...ADMITTED, status: 'needs_user_input', may_run: false }).state.requires_rerun).toBe(false);
  });

  it('KNOWN no run + BLOCKED → run_state blocked, blocked_unusable (nothing to preserve)', () => {
    const { state } = wire('none', false, BLOCKED);
    expect(state.run_state.kind).toBe('blocked');
    expect(state.blocked_unusable).toBe(true);
  });

  it('UNREADABLE record + BLOCKED → unknown_degraded is NOT masked as blocked', () => {
    expect(wire('unknown', false, BLOCKED).state.run_state.kind).not.toBe('blocked');
  });

  it('UNSUPPLIED readiness + no run → never_run (pre-(B) behaviour unchanged)', () => {
    expect(wire('none', false).state.run_state.kind).toBe('never_run');
  });
});
