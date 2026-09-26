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
 *
 * ⭐ THE DIRECTION OF THE USER'S OWN GOAL IS NOW CARRIED (`goal_direction`, stamped by
 * `admit-model.ts` `attestedGoalDirection` and forwarded to PLoT), so for an `explicit`
 * goal "a consumer cannot tell a floor from a ceiling" would be FALSE and is no longer
 * said. A goal that is not the user's is not stamped, and its direction is still said
 * to be not carried — both halves are pinned below.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { buildCandidateSchema, type CallStructuredModel } from '../runtime/build-model.js';

const SCENARIO = '33333333-3333-4333-8333-333333333333';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-goal-loss' };

/** B2 from the estate's brief corpus, shaped the way the builder returns it. */
const GTM = (goal: Record<string, unknown>) => ({
  goal,
  constraints: [
    { metric: 'Go-to-market budget', operator: '<=', value: 900000, unit: 'GBP', provenance: 'explicit' },
  ],
  options: [
    { label: 'Expand outbound sales', provenance: 'explicit', is_status_quo: null, changes: [],
      interventions: [{ factor_label: 'Outbound reps', value: 6, unit: 'FTE', provenance: 'explicit' }] },
    { label: 'Build self-serve motion', provenance: 'explicit', is_status_quo: null, changes: ['Self-serve conversion'], interventions: [] },
  ],
  factors: [
    { label: 'Outbound reps', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'FTE', provenance: 'explicit', plausible_max: 50 },
    { label: 'Self-serve conversion', role: 'controllable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'inferred', plausible_max: 100 },
  ],
  risks: [],
  outcomes: [],
  links: [
    { from: 'Outbound reps', to: 'New ARR', direction: 'positive', provenance: 'inferred' },
    { from: 'Self-serve conversion', to: 'New ARR', direction: 'positive', provenance: 'inferred' },
  ],
  unknowns: [],
});

// `target_stated: true` — both briefs here DO name £3m, and the field is now required
// by `buildCandidateSchema`. The live-schema guard below is what caught its absence,
// which is the one part of that guard this change can vouch for. The goal's current
// level (`baseline_*`, #1840) is required the same way; neither brief states one.
const WITH_DEADLINE = GTM({ metric: 'New ARR', operator: '>=', target_stated: true, value: 3000000, unit: 'GBP', horizon_months: 18, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit' });
const NO_DEADLINE = GTM({ metric: 'New ARR', operator: '>=', target_stated: true, value: 3000000, unit: 'GBP', horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit' });

/**
 * ⭐ THE FIXTURE MUST BE ONE THE REAL SCHEMA WOULD ACCEPT. A test in this area once
 * passed on a payload the real schema would have REFUSED (`buildCandidateSchema`'s own
 * docblock records it), so the required keys are checked against the LIVE schema object
 * rather than a list copied by hand.
 */
function assertRealSchemaWouldAccept(payload: Record<string, unknown>): void {
  const schema = buildCandidateSchema() as {
    required: string[];
    properties: Record<string, { required?: string[]; items?: { required?: string[] } }>;
  };
  for (const key of schema.required) {
    expect(payload, `the real schema requires \`${key}\``).toHaveProperty(key);
  }
  for (const [key, spec] of Object.entries(schema.properties)) {
    const value = payload[key];
    if (spec.required !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const inner of spec.required) {
        expect(value, `the real schema requires \`${key}.${inner}\``).toHaveProperty(inner);
      }
    }
    const itemRequired = spec.items?.required;
    if (itemRequired !== undefined && Array.isArray(value)) {
      for (const [i, entry] of value.entries()) {
        for (const inner of itemRequired) {
          expect(entry, `the real schema requires \`${key}[${i}].${inner}\``).toHaveProperty(inner);
        }
      }
    }
  }
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

const structured = (payload: unknown): CallStructuredModel => async () => ({ text: JSON.stringify(payload) });

async function build(payload: Record<string, unknown>) {
  assertRealSchemaWouldAccept(payload);
  const caps = createAgentCapabilities(product().d, new ProposalStore(), structured(payload));
  const r = await caps.buildModelFromBrief(ctx, {
    brief: 'We are choosing between three go-to-market moves for next year. Budget is £900k either way and we want to add £3m of new ARR within eighteen months.',
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r as { ok: boolean; not_represented?: string[]; projected_field_count?: number };
}

describe('a construction says WHICH goal facts the model could not carry', () => {
  it('names the dropped deadline, and does NOT call the user\'s carried direction dropped', async () => {
    const r = await build(WITH_DEADLINE);
    // The count already travelled before this change; it is the sentence that was missing.
    expect(r.projected_field_count, 'the losses are recorded').toBeGreaterThan(0);
    const said = (r.not_represented ?? []).join(' · ');
    // Bound by IDENTITY: the horizon the fixture states, not merely the word "horizon".
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).toMatch(/18-month horizon/);
    // The operator's own distinctive phrase, which no other loss reason uses: the
    // user's goal carries its sense, so saying it cannot be told apart would be false.
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).not.toMatch(/floor from a ceiling/);
  });

  /**
   * The discriminating half of the pair. If the sentences were constants rather than
   * the recorded losses, this would keep asserting a deadline the goal never stated.
   */
  it('says nothing about a deadline when the goal states none', async () => {
    const r = await build(NO_DEADLINE);
    const said = (r.not_represented ?? []).join(' · ');
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).not.toMatch(/horizon/i);
    expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).not.toMatch(/floor from a ceiling/);
  });

  /**
   * The discriminating twin for the direction: the loss line is withheld only because
   * the sense is carried. A goal Olumi inferred is not stamped, so its direction is
   * still not carried and is still said — the sentence is not simply gone.
   */
  for (const provenance of ['inferred', 'ai_proposed'] as const) {
    it(`still names the direction as not carried for an ${provenance} goal`, async () => {
      const r = await build(GTM({ ...(NO_DEADLINE.goal as Record<string, unknown>), provenance }));
      const said = (r.not_represented ?? []).join(' · ');
      expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).toMatch(/floor from a ceiling/);
      expect(said, `not_represented was: ${JSON.stringify(r.not_represented)}`).not.toMatch(/horizon/i);
    });
  }
});
