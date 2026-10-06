// ============================================================================
// 0.79 SD-1 Slice R: may the scenario read serve a Run's delivered record, as far as leader claims go?
// Codex r1/r2 on #2654: the final-egress licence gate rewrites only its own prose fields, so a leader claim in a coaching
// `action_prompt`, an option's strings, or an `interventions` KEY passed it. Every record below is PARSED by the
// contract, so each carrier is one a stored `run_delivery` can really hold.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { RunDeliveredRecordSchema, type RunDeliveredRecord } from '@talchain/schemas/boundary';
import { maximalCoachingBlock, maximalReviewCardBlock } from '@talchain/schemas/fixtures';

import { deliveredRecordWithinLicence } from '../delivered-record-licence.js';

const HIRE = 'Hire a marketing manager';
const LEADS = `${HIRE} leads on the current model; test it before you act.`;
const graph = { nodes: [{ id: 'opt_hire', kind: 'option', label: HIRE }, { id: 'opt_hold', kind: 'option', label: 'Hold headcount' }], edges: [] };

function record(over: { coaching?: Record<string, unknown>; options?: unknown[] } = {}): RunDeliveredRecord {
  return RunDeliveredRecordSchema.parse({
    record_version: 1,
    run_id: 'run_b',
    graph_hash: 'a'.repeat(16),
    phase3_blocks: [
      { ...(maximalReviewCardBlock as Record<string, unknown>), body: 'Most of this result rests on a single factor.' },
      { ...(maximalCoachingBlock as Record<string, unknown>), action_prompt: 'Argue the case against the strongest link.', ...over.coaching },
    ],
    analysis_ready_options: over.options ?? [{ option_id: 'opt_hire', label: HIRE, status: 'ready', interventions: { fac_spend: 1 } }],
  });
}
const within = (rec: RunDeliveredRecord, licence: 'permitted' | 'permitted_with_caveat' | 'withheld') =>
  deliveredRecordWithinLicence(rec, { licence, graph, analysisReady: undefined });

describe('0.79 · a delivered record is served only within the read\'s leader licence', () => {
  it('CONTROL: a neutral record is served under every licence', () => {
    for (const licence of ['permitted', 'permitted_with_caveat', 'withheld'] as const) expect(within(record(), licence)).toBe(true);
  });

  it('a leader claim in a coaching action_prompt is served ONLY under a fully permitted licence', () => {
    const rec = record({ coaching: { action_prompt: LEADS } });
    expect(within(rec, 'permitted')).toBe(true);
    expect(within(rec, 'withheld')).toBe(false);
    // Codex r2 P1: "permitted + separated" is not the licence; a caveated or withheld licence never exempts.
    expect(within(rec, 'permitted_with_caveat')).toBe(false);
  });

  it('a leader claim in an option\'s status is not served under a withheld licence', () => {
    // `status` is capped at 64 characters by the contract, so the claim is short enough to be storable.
    const status = `${HIRE} leads on this model`;
    expect(status.length).toBeLessThanOrEqual(64);
    expect(within(record({ options: [{ option_id: 'opt_hire', label: HIRE, status, interventions: { fac_spend: 1 } }] }), 'withheld')).toBe(false);
  });

  it('⭐ a leader claim in an interventions KEY (a parsed key → number) is not served under a withheld licence', () => {
    const keyed = record({ options: [{ option_id: 'opt_hire', label: HIRE, status: 'ready', interventions: { [LEADS]: 1 } }] });
    expect(Object.keys(keyed.analysis_ready_options![0]!.interventions)).toStrictEqual([LEADS]);
    expect(within(keyed, 'withheld')).toBe(false);
    // CONTROL: the same option keyed by a factor id is served, so the refusal is the key's prose.
    expect(within(record(), 'withheld')).toBe(true);
  });

  it('a claim only a ROSTER sees (the record\'s own option "Team") is not served under a withheld licence', () => {
    const rec = record({
      coaching: { action_prompt: 'Team leads in 60% of runs.' },
      options: [{ option_id: 'opt_team', label: 'Team', status: 'ready', interventions: { fac_spend: 1 } }],
    });
    expect(within(rec, 'withheld')).toBe(false);
  });
});
