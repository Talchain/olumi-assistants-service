import { strictRecordsWire } from './records-wire-fixture.js';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { Ajv } from 'ajv';
import { buildStrictDraftRecordsSchema } from '../runtime/build-model-from-records.js';
/**
 * ⛔ THE GOAL'S DEADLINE AND DIRECTION ARE DROPPED, AND ONLY A COUNT TRAVELS.
 *
 * `admit-model.ts` records a warn-level loss for `goal.horizon_months` and for
 * `goal.operator`, because GraphV3 has nowhere to put either. Its own reasons say
 * what that costs: '"reach it" and "reach it within a year" become the same goal',
 * and 'a consumer cannot tell a floor from a ceiling from the projection alone'.
 *
 * MEASURED on served CEE 3f412be over the six estate briefs in
 * `Docs/v5/evidence/records-v11-cause-not-option-2026-08-30/briefs`, each read
 * immediately after construction and before any approval: 0 of 6 carried either the
 * values or the loss records anywhere on the wire, while `goal_threshold_raw`,
 * `goal_constraints`, `scale_frame` and `provenance` all did (the contrast control,
 * so the probe could see wire content). The build result passed
 * `projected_field_count` — a NUMBER the Agent cannot turn into a sentence.
 *
 * The cost is not thinness. The Agent narrates from the brief, so on B2 its prose
 * said 'the goal of £3m new ARR within 18 months' while the model held no horizon at
 * all, and `permitted_analysis_mode` was `quantified_provisional` — figures shown
 * against a deadline the analysis never received. That is prose asserting a frame the
 * model cannot support.
 *
 * `build-model.ts:501` already declares the channel and the intent: 'What the
 * projection could not carry — the Agent is expected to say this.' These losses simply
 * were not in the list.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { type CallStructuredModel } from '../runtime/build-model.js';

const SCENARIO = '33333333-3333-4333-8333-333333333333';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-goal-loss' };

/** The records grammar can state a deadline but cannot encode the old drafter's parked questions. */
const GTM = (horizon?: number, value = 3000000): DraftRecordSet => ({
  stated_items: [
    { kind: 'goal', source_quote: 'add £3m of new ARR', value, unit: 'GBP', role: 'target',
      ...(horizon === undefined ? {} : { horizon_months: horizon }) },
    { kind: 'option', source_quote: 'three go-to-market moves' },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Outbound reps', value: 6, unit: 'FTE', value_scale: 'raw_count' },
    { claim_kind: 'outcome', label: 'New ARR' },
    { claim_kind: 'causal_link', label: 'Sales capacity', from_stated: 1, to_claim: 0, sets_to: 6, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Sales effect', from_claim: 0, to_claim: 1, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'ARR reaches goal', from_claim: 1, to_stated: 0, effect: 'positive' },
  ],
});
const WITH_DEADLINE = GTM(18);
const NO_DEADLINE = GTM();
const unstatedTarget = (records: DraftRecordSet): DraftRecordSet => ({
  ...records, stated_items: records.stated_items.map((item, index) => index === 0 ? { ...item, value: 2500000 } : item),
});
function assertRealSchemaWouldAccept(payload: DraftRecordSet): void {
  const validate = new Ajv({ strict: false }).compile(buildStrictDraftRecordsSchema());
  expect(validate(strictRecordsWire(payload)), JSON.stringify(validate.errors)).toBe(true);
}

/** The product's storage, and nothing else. */
function product() {
  let graph: unknown = { nodes: [], edges: [] };
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      graph = structuredClone(b.graph);
      rev += 1;
      return { status: 200, json: {} };
    }
    return { status: 200, json: { graph, graph_hash: `h${rev}` } };
  };
  return { d };
}

const structured = (payload: DraftRecordSet): CallStructuredModel => async () => ({ text: JSON.stringify(strictRecordsWire(payload)) });

async function build(payload: DraftRecordSet) {
  assertRealSchemaWouldAccept(payload);
  const caps = createAgentCapabilities(product().d, new ProposalStore(), structured(payload));
  const r = await caps.buildModelFromBrief(ctx, {
    brief: 'We are choosing between three go-to-market moves for next year. Budget is £900k either way and we want to add £3m of new ARR within eighteen months.',
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r as { ok: boolean; not_represented?: string[]; open_questions?: string[]; projected_field_count?: number };
}

describe('a construction says WHICH goal facts the model could not carry', () => {
  it('names the dropped deadline and the dropped direction, not just how many fields were lost', async () => {
    const r = await build(unstatedTarget(WITH_DEADLINE));
    // The count already travelled before this change; it is the sentence that was missing.
    expect(r.projected_field_count, 'the losses are recorded').toBeGreaterThan(0);
    const said = (r.not_represented ?? []).join(' · ');
    // Bound by IDENTITY: the horizon the fixture states, not merely the word "horizon".
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).toMatch(/18-month horizon/);
    // The operator's own distinctive phrase, which no other loss reason uses.
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).toMatch(/floor from a ceiling/);
  });

  /**
   * The discriminating half of the pair. If the sentences were constants rather than
   * the recorded losses, this would keep asserting a deadline the goal never stated.
   */
  it('says nothing about a deadline when the goal states none, while still naming the direction', async () => {
    const r = await build(unstatedTarget(NO_DEADLINE));
    const said = (r.not_represented ?? []).join(' · ');
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).not.toMatch(/horizon/i);
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).toMatch(/floor from a ceiling/);
  });

  it('G1: a direction beside a target the brief states is HELD, so it is not said as a loss; the unheld deadline still is', async () => {
    const r = await build(WITH_DEADLINE);
    const said = (r.not_represented ?? []).join(' · ');
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).not.toMatch(/floor from a ceiling/);
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).toMatch(/18-month horizon/);
  });
});

/**
 * ⛔ THE DEADLINE MUST REACH THE USER, NOT ONLY THE AGENT (MG fidelity scorecard, served CEE `85ce874`,
 * 26 Sep 00:16Z: Paul's "£20k MRR within 12 months" brief built a model with no horizon, and the reply
 * never mentioned the deadline). `not_represented` is read only by the Agent's model, which may skip it;
 * `open_questions` is appended to the user's reply by the server every time (`write-outcome.ts`
 * `openQuestionsLine`). A stated deadline the model cannot hold is therefore ASKED there, first, so it is
 * never cut by the five-question cap.
 */
describe('a deadline the model cannot hold is asked where the user always sees it', () => {
  it('RED: an 18-month deadline becomes the FIRST open question, naming the goal and the months', async () => {
    // Six parked questions: more than the five the reply shows, so "first" is what keeps the deadline visible.
    const parked = ['Which channel converts best?', 'What does a lost deal cost?', 'Who owns pricing?', 'How long is the sales cycle?', 'What is churn today?', 'Which segment grows fastest?'];
    const r = await build(WITH_DEADLINE);
    const qs = r.open_questions ?? [];
    expect(qs.slice(1), 'the drafter\'s own questions follow, unchanged and in order').toEqual(parked);
    expect(qs[0], JSON.stringify(qs)).toBe('Does "New ARR" get there within 18 months? The model holds no deadline yet, so no result answers that.');
    // Stated exactly once, whatever else the drafter parked.
    expect(qs.filter((q) => /within 18 months/.test(q))).toHaveLength(1);
  });

  it('CONTROL: a goal with no deadline adds no deadline question', async () => {
    const r = await build(NO_DEADLINE);
    expect((r.open_questions ?? []).filter((q) => /within \d+ months|no deadline/.test(q))).toHaveLength(0);
  });
});
