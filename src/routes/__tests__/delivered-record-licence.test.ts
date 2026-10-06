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
import { textAssertsLeadingOption } from '../../orchestrator-v5/compose/leading-option-egress-guard.js';

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
      { ...(maximalCoachingBlock as Record<string, unknown>), action_prompt: 'Argue the case against the single factor this result rests on.', ...over.coaching },
    ],
    analysis_ready_options: over.options ?? [{ option_id: 'opt_hire', label: HIRE, status: 'ready', interventions: { fac_spend: 1 } }],
  });
}
const within = (rec: RunDeliveredRecord, licence: 'permitted' | 'permitted_with_caveat' | 'withheld') =>
  deliveredRecordWithinLicence(rec, { licence, graph, analysisReady: undefined });

// Desk/DL follow-up rows (F1/F2, DL 6 Oct).
const F1_F2_CLAIMS = [
  'Raise to £59 has the highest-revenue path.',
  'Hire a marketing manager gives the lowest-churn route.',
  ...['revenue', 'MRR', 'ARR', 'margin', 'profit', 'return', 'growth', 'churn', 'retention', 'sales', 'income', 'conversion', 'cost']
    .map((metric) => `Raise to £59 gives the lowest-${metric} path.`),
  ...['best', 'top', 'greatest', 'largest', 'biggest', 'strongest'].flatMap((word) => [
    `Hire a marketing manager ends up with the ${word} MRR.`,
    `Both hires end up with the ${word} MRR.`,
    `Hire a marketing manager and Raise to £59 end up with the ${word} MRR.`,
    `The ${word} MRR is what Raise to £59 ends up with.`,
    `With the ${word} MRR, Raise to £59 comes out ahead.`,
    `The ${word} MRR came from Raise to £59.`,
    `The ${word} MRR was produced by Raise to £59.`,
    `MRR is ${word} with Raise to £59.`,
    `The ${word} MRR came from Raise to £59 in 62% of runs.`,
  ]),
  'Both hires end with the highest MRR.',
  'Raise to £59 ends with the highest MRR.',
  'Raise to £59 ended with the highest MRR.',
  'Raise to £59 is ending with the highest MRR.',
  'Both hires finish with the highest MRR.',
  'Raise to £59 finishes with the highest MRR.',
  'Raise to £59 finished with the highest MRR.',
  'Raise to £59 is finishing with the highest MRR.',
];
const F1_F2_PLANNING = [
  'That is the best guess we have.',
  'In the best case, churn stays flat.',
  'The top priority is pricing.',
  'This ends with a question for you.',
  'Start with the lowest-risk path.',
  'Start with the lowest-effort step.',
  // ⛔ The withheld path keeps its BLANKET best / highest / strongest / top bans (DL review 6 Oct): "Raise to £59 has the
  // highest impact on MRR" and "The best way forward is option B" are leader claims a noun exemption would let through.
  // So planning phrases with those four words are rowed only against the ladder (lead-ladder-egress.test.ts); here only
  // the NEW ladder superlatives are rowed.
  ...['greatest', 'largest', 'biggest'].flatMap((word) =>
    ['guess', 'case', 'estimate', 'practice', 'scenario', 'way', 'option to test', 'next step', 'question']
      .map((noun) => `We ended up with the ${word} ${noun}.`)),
];

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

  it('⭐ a claim only the AGENT lane\'s vocabulary sees ("…comes out with the highest MRR") is not served under a withheld licence', () => {
    // Re-picked: #2660 widened the v5 ladder to "ends up with", so the original phrase is now caught by the bare guard.
    const highest = `${HIRE} comes out with the highest MRR.`;
    // Precondition (Desk 6b): the v5 leader patterns miss it, bare and rostered — only the agent lane's catches it.
    expect(textAssertsLeadingOption(highest)).toBe(false);
    expect(textAssertsLeadingOption(highest, { optionLabels: [HIRE, 'Hold headcount'] })).toBe(false);
    const rec = record({ coaching: { action_prompt: highest } });
    expect(within(rec, 'withheld')).toBe(false);
    expect(within(rec, 'permitted')).toBe(true);
  });

  it.each(F1_F2_CLAIMS)('F1/F2: %s is not served under a withheld licence', (text) => {
    expect(textAssertsLeadingOption(text)).toBe(true);
    expect(textAssertsLeadingOption(text, { optionLabels: [HIRE, 'Raise to £59', 'Hold headcount'] })).toBe(true);
    const rec = record({ coaching: { action_prompt: text } });
    expect(within(rec, 'withheld')).toBe(false);
    expect(within(rec, 'permitted')).toBe(true);
  });

  it.each(F1_F2_PLANNING)('F1/F2: %s is served under a withheld licence', (text) => {
    expect(textAssertsLeadingOption(text)).toBe(false);
    expect(textAssertsLeadingOption(text, { optionLabels: [HIRE, 'Raise to £59', 'Hold headcount'] })).toBe(false);
    expect(within(record({ coaching: { action_prompt: text } }), 'withheld')).toBe(true);
  });

  it('a PLACE in an order named by the record\'s own option ("Pilot scheme trails at 40%.") is not served under a withheld licence', () => {
    // Only the agent lane's position rule sees it, and only once it knows "Pilot scheme" is an option: the label is on
    // the record, not the graph.
    const rec = record({
      coaching: { action_prompt: 'Pilot scheme trails at 40%.' },
      options: [{ option_id: 'opt_pilot', label: 'Pilot scheme', status: 'ready', interventions: { fac_spend: 1 } }],
    });
    expect(textAssertsLeadingOption('Pilot scheme trails at 40%.', { optionLabels: ['Pilot scheme'] })).toBe(false);
    expect(within(rec, 'withheld')).toBe(false);
  });

  it('KNOWN LIMIT: the agent lane\'s superlatives also omit a NEUTRAL "strongest link" card under a withheld licence', () => {
    // Serve-or-omit errs on omission: the delivering lane's own fail-closed treats this sentence the same way. Pinned so
    // a narrower agent-lane vocabulary later shows up here as a capability gain, not as a silent change.
    const rec = record({ coaching: { action_prompt: 'Argue the case against the strongest link.' } });
    expect(within(rec, 'withheld')).toBe(false);
    expect(within(rec, 'permitted')).toBe(true);
  });

  it('a claim only a ROSTER sees (the record\'s own option "Team") is not served under a withheld licence', () => {
    const rec = record({
      coaching: { action_prompt: 'Team leads in 60% of runs.' },
      options: [{ option_id: 'opt_team', label: 'Team', status: 'ready', interventions: { fac_spend: 1 } }],
    });
    expect(within(rec, 'withheld')).toBe(false);
  });
});
