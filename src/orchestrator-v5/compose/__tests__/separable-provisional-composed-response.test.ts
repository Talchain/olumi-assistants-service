/**
 * ⭐⭐ THE COMPOSED RESPONSE, not a model-facing field snapshot.
 *
 * Root's acceptance for this repair (8 Sep 2026, 21:47 and the receiving
 * contract's closing section): the coach and the STRUCTURED SUMMARY must agree
 * on one interpretation. A qualified model-facing state is not the finished
 * response while the final projection still replaces the summary with
 * "No single option can be put forward yet."
 *
 * The witnessed failure, native request `23ab579d-5dda-4e5f-9ed9-a9eb889446f8`:
 * `permitted_analysis_mode = quantified_provisional`, `leader_claim.separation
 * = separated`, entitlement true, a stated 55%/36% — and the two surfaces
 * disagreed because the enforcer's conjunction could only ask "does the
 * admission license a leader at all".
 *
 * Populations, because confusing them reverses a ruling:
 *   · Paul (relayed, `olumi-programme-docs#38` comment `5576895511`):
 *     `quantified_provisional` is **caveat, not withhold**.
 *   · #1254 (merged `9de184f1`): withhold where options **cannot be separated**.
 * Disposition: `contextual-research/SCOPE-DISPOSITION-f361-20260908.md`.
 *
 * Case (1) is the new behaviour. (2)-(5) are the restrictions that must NOT
 * move, and each is a distinct reason to withhold — so a permit that widened
 * beyond the named population REDs on one of them.
 *
 * Synthetic prose. No provider, browser or DB call.
 */
import { describe, expect, it } from 'vitest';
import { OlumiResponseSchema, type OlumiResponse } from '@talchain/schemas/boundary';
import {
  enforceLeadingOptionClaimsAtWire,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
} from '../leading-option-wire-enforcement.js';

const LEAD = 'Adopt RudderStack';
const OTHER = 'Adopt Segment';
const GRAPH = {
  nodes: [
    { id: 'lead', kind: 'option', label: LEAD },
    { id: 'other', kind: 'option', label: OTHER },
  ],
  edges: [],
};

/** The comparative summary a separable provisional run legitimately carries. */
const SUMMARY = `${LEAD} scored highest against your goal in 55% of runs, ${OTHER} in 36%. These are provisional estimates, not a settled ranking.`;

function envelope(): OlumiResponse {
  return OlumiResponseSchema.parse({
    response_version: 2,
    assistant_text: SUMMARY,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  });
}

function readiness(mode: string | null): unknown {
  return mode === null
    ? {}
    : { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: mode } };
}

const BASE = { requestId: 'separable-provisional-composed', exitPath: 'edit_graph', graph: GRAPH };

describe('separable provisional — the composed response agrees with the coach', () => {
  it('(1) entitled + separated + provisional: the summary SURVIVES, byte-identical', () => {
    const input = envelope();
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: true,
    });
    // Paul's population: caveat, not withhold. Byte identity by reference is the
    // module's own permit contract, so this also proves no re-serialisation.
    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
    expect(result.response.assistant_text).not.toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(2) separation NEAR-TIE / not separated: still withheld — #1254 untouched', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(), {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: false,
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(3) separation NOT COMPUTED (operand absent): fail-closed, today’s behaviour exactly', () => {
    // Absence is not permission. A caller that does not thread the operand — or
    // a run whose separation was never computed — must be unchanged from before.
    const result = enforceLeadingOptionClaimsAtWire(envelope(), {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('quantified_provisional'),
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(4) NOT entitled: a genuine constraint restriction still withholds, separation regardless', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(), {
      ...BASE,
      mayNameLeadingOption: false,
      analysisReady: readiness('quantified_provisional'),
      separationEstablished: true,
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(5) a LOWER mode is not the named population, even when separated', () => {
    // The arm requires EXACTLY the provisional cap. `exploratory` sits BELOW it
    // in the lattice (`ANALYSIS_MODE_RANK`) — a different admission answer, and
    // it keeps its restriction. Paul's ruling named the class that can state a
    // percentage; this one cannot.
    const result = enforceLeadingOptionClaimsAtWire(envelope(), {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness('exploratory'),
      separationEstablished: true,
    });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(6) missing admission compatibility: legacy permit, unchanged by this work', () => {
    const input = envelope();
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: readiness(null),
    });
    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });
});
