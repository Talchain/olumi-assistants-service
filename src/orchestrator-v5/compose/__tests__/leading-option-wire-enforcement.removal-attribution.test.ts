/**
 * WHAT THE WIRE ENFORCER REMOVED — attribution, not prose.
 *
 * Motivated by a real, unclassifiable production event. On native request
 * `478d3445-199c-4c5a-9c6c-c3b48ee7de8d` (8 Sep 2026, CEE `dcff3c5`) this
 * projection cut a coaching answer from 1,521 to 1,023 characters with mode
 * `surgical_escalated`. Whether that removed a leader claim or removed the
 * user's conditional hiring advice could NOT be determined: the pre-egress text
 * is unrecoverable and the event carried lengths and a mode only.
 *
 * `surgical_escalated` says an escalation RAN. It does not say whether anything
 * non-asserting was caught by it — and that is the whole difference between the
 * guard working and the over-suppression this module weights equally with the
 * leak. These tests pin the two counts that separate them.
 *
 * ⚠ THE LOAD-BEARING CASE IS THE THIRD ONE. A count of "units that name an
 *   option" would be non-zero on almost every withheld answer and would look
 *   exactly like a collateral alarm. The third test holds a field FULL of
 *   option-naming conditional prose that is correctly PRESERVED, and requires
 *   `name_only_units_removed` to be 0 — so the number reports what was REMOVED,
 *   never what was present.
 *
 * All prose here is synthetic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OlumiResponseSchema, type OlumiResponse } from '@talchain/schemas/boundary';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';

const LEAD = 'Hire a Hands-on Technical Lead';
const DEVELOPERS = 'Two Developers';
const GRAPH = {
  nodes: [
    { id: 'lead', kind: 'option', label: LEAD },
    { id: 'other', kind: 'option', label: DEVELOPERS },
  ],
  edges: [],
};
const OPTS = {
  requestId: 'removal-attribution-control',
  exitPath: 'edit_graph',
  graph: GRAPH,
  mayNameLeadingOption: false,
};

function envelope(text: string): OlumiResponse {
  return OlumiResponseSchema.parse({
    response_version: 2,
    assistant_text: text,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  });
}

let events: Array<{ name: string; data: Record<string, unknown> }>;
beforeEach(() => {
  events = [];
  setTestSink((name, data) => events.push({ name, data }));
});
afterEach(() => setTestSink(null));

function removal(): Record<string, unknown> {
  const event = events.find(
    (candidate) => candidate.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
  );
  expect(event, 'the enforcement event must be emitted').toBeDefined();
  return event!.data;
}

const CONDITIONAL_LEAD = `If unclear technical direction is the bottleneck, explore ${LEAD} as a way to address that gap.`;
const CONDITIONAL_DEVELOPERS = `If execution capacity is the bottleneck, explore ${DEVELOPERS} while accounting for onboarding.`;

describe('wire enforcement reports WHAT it removed, not only how much', () => {
  it('a self-contained claim is removed as an assertion, with no collateral', () => {
    const text = `${LEAD} leads in 54% of simulations against ${DEVELOPERS}.`;
    const result = enforceLeadingOptionClaimsAtWire(envelope(text), OPTS);
    expect(result.changed).toBe(true);
    const data = removal();
    expect(data['mode']).toBe('surgical');
    expect(data['asserting_units_removed']).toBe(1);
    expect(data['name_only_units_removed']).toBe(0);
  });

  it('a distributed claim reports the collateral naming half it had to take', () => {
    // The escalated pass removes the naming half BECAUSE the assertion borrowed
    // its subject. That removal is justified — and it is still collateral, and
    // the count is what makes it visible in production.
    const text = `${LEAD} is strong. It leads in 54% of simulations.`;
    const result = enforceLeadingOptionClaimsAtWire(envelope(text), OPTS);
    expect(result.changed).toBe(true);
    const data = removal();
    expect(data['mode']).toBe('surgical_escalated');
    expect(data['asserting_units_removed']).toBe(1);
    expect(data['name_only_units_removed']).toBe(1);
  });

  it('⭐ preserved option-naming prose is NOT counted as removed', () => {
    // Two conditional paragraphs that name both options and survive intact,
    // beside one self-contained claim that does not. A count of "units naming
    // an option" would read 2 here; the correct answer is 0.
    const text = [
      CONDITIONAL_LEAD,
      `${LEAD} leads in 54% of simulations against ${DEVELOPERS}.`,
      CONDITIONAL_DEVELOPERS,
    ].join('\n\n');
    const result = enforceLeadingOptionClaimsAtWire(envelope(text), OPTS);
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(CONDITIONAL_LEAD);
    expect(result.response.assistant_text).toContain(CONDITIONAL_DEVELOPERS);
    const data = removal();
    expect(data['mode']).toBe('surgical');
    expect(data['asserting_units_removed']).toBe(1);
    expect(data['name_only_units_removed']).toBe(0);
  });

  it('⭐⭐ an asserting unit that ALSO names an option is counted once, as an assertion', () => {
    // ⚠ THIS IS THE CONTROL THAT BINDS THE DEFINITION, and it exists because the
    //   obvious one did not. My first "preserved prose is not counted" test
    //   passed against a mutant that counted EVERY option-naming unit — because
    //   that test lands in the `surgical` branch, where the collateral count is
    //   a hardcoded 0 and the expression is never read. A guard agreeing with
    //   itself.
    //
    //   Here escalation genuinely runs AND the asserting unit names an option
    //   (its comparator). The two counts must partition the removed units:
    //   1 assertion + 1 name-only half, never 2 name-bearing units.
    const text = `${LEAD} is strong. It leads in 54% of simulations against ${DEVELOPERS}.`;
    const result = enforceLeadingOptionClaimsAtWire(envelope(text), OPTS);
    expect(result.changed).toBe(true);
    const data = removal();
    expect(data['mode']).toBe('surgical_escalated');
    expect(data['asserting_units_removed']).toBe(1);
    expect(data['name_only_units_removed']).toBe(1);
  });

  it('the counts survive alongside the existing length and mode fields', () => {
    const text = `${LEAD} is strong. It leads in 54% of simulations.`;
    enforceLeadingOptionClaimsAtWire(envelope(text), OPTS);
    const data = removal();
    // The pre-existing contract is untouched — this is an addition, and a
    // consumer reading only lengths keeps working.
    expect(typeof data['original_length']).toBe('number');
    expect(typeof data['projected_length']).toBe('number');
    expect(data['original_length']).toBe(text.length);
    expect(data['edited_fields']).toBe('assistant_text');
  });

  it('with no roster nothing is classified, and both counts say so', () => {
    const text = `${LEAD} leads in 54% of simulations.`;
    const result = enforceLeadingOptionClaimsAtWire(envelope(text), {
      ...OPTS,
      graph: { nodes: [], edges: [] },
    });
    // No roster: the module cannot establish a designation, so it edits nothing
    // and must not report a removal it did not make. Asserted unconditionally —
    // a `if (event) { … }` here would pass by testing nothing.
    const data = removal();
    expect(data['mode']).toBe('roster_unavailable');
    expect(data['asserting_units_removed']).toBe(0);
    expect(data['name_only_units_removed']).toBe(0);
    expect(result.response.assistant_text).toBe(text);
  });
});
