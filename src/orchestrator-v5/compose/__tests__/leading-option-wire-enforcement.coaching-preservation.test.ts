/**
 * TEST-FIRST controlled coaching-preservation proof; NOT a reconstruction of
 * the native model answer (its pre-egress bytes are UNKNOWN).
 *
 * Source: deployed dcff3c562a53ecda0c487dd211aa9e04f788b468.
 * Captured scenario e309fd7e-851b-46ff-bc66-ceefd70b5595:
 * graph roster/endpoints are a deliberately minimal projection of resource
 * 1d330c16acd030a2bd2fc67967eedfcf80624246.json (13 nodes / 18 edges);
 * admission/freshness are exact selected fields from native response
 * 2fc59eda4e6baf1620a0be84e762fe653c3661cf.json at16:47UTC.
 * The enforcer reads graph only for option identity; this is NOT a simulation
 * replay or a claim that an incomplete graph projection proves calculations.
 *
 * ALL assistant prose below is synthetic. Budget and hiring routes follow the
 * captured question, but the unsupported statistic is deliberately invented
 * as the unsafe control. Conditional qualitative exploration is not a licence
 * to state a statistical leader.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OlumiResponseSchema, type OlumiResponse } from '@talchain/schemas/boundary';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';
import { analysisReadyPermitsLeaderNaming } from '../../admission/analysis-admission.js';
import {
  enforceLeadingOptionClaimsAtWire,
  optionRosterFromGraph,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
} from '../leading-option-wire-enforcement.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';

const CAPTURED = {
  "graph": {
    "nodes": [
      {
        "id": "124ec3bb",
        "kind": "factor",
        "label": "Team Coordination Overhead"
      },
      {
        "id": "1d98a2b1",
        "kind": "risk",
        "label": "Hiring Cost Burden"
      },
      {
        "id": "3fc10c08",
        "kind": "risk",
        "label": "Integration and Ramp Delay"
      },
      {
        "id": "49d90be9",
        "kind": "option",
        "label": "Hire a Hands-on Technical Lead"
      },
      {
        "id": "57f5d1fa",
        "kind": "option",
        "label": "Status Quo: No New Hire"
      },
      {
        "id": "7291c125",
        "kind": "factor",
        "label": "Onboarding and Ramp Time"
      },
      {
        "id": "756a7698",
        "kind": "factor",
        "label": "Technical Leadership Capacity"
      },
      {
        "id": "7cef0139",
        "kind": "decision",
        "label": "Question"
      },
      {
        "id": "b0c56077",
        "kind": "outcome",
        "label": "Feature Delivery Velocity"
      },
      {
        "id": "bb2d8637",
        "kind": "goal",
        "label": "Improve Productivity"
      },
      {
        "id": "be215545",
        "kind": "option",
        "label": "Two Developers"
      },
      {
        "id": "ce5f1250",
        "kind": "factor",
        "label": "Developer Headcount"
      },
      {
        "id": "e42f609a",
        "kind": "outcome",
        "label": "Code Quality and Maintainability"
      }
    ],
    "edges": [
      {
        "id": "e-0",
        "from": "124ec3bb",
        "to": "b0c56077"
      },
      {
        "id": "e-1",
        "from": "1d98a2b1",
        "to": "bb2d8637"
      },
      {
        "id": "e-2",
        "from": "3fc10c08",
        "to": "bb2d8637"
      },
      {
        "id": "e-3",
        "from": "49d90be9",
        "to": "756a7698"
      },
      {
        "id": "e-4",
        "from": "57f5d1fa",
        "to": "756a7698"
      },
      {
        "id": "e-5",
        "from": "57f5d1fa",
        "to": "ce5f1250"
      },
      {
        "id": "e-6",
        "from": "7291c125",
        "to": "3fc10c08"
      },
      {
        "id": "e-7",
        "from": "756a7698",
        "to": "1d98a2b1"
      },
      {
        "id": "e-8",
        "from": "756a7698",
        "to": "b0c56077"
      },
      {
        "id": "e-9",
        "from": "756a7698",
        "to": "e42f609a"
      },
      {
        "id": "e-10",
        "from": "7cef0139",
        "to": "49d90be9"
      },
      {
        "id": "e-11",
        "from": "7cef0139",
        "to": "57f5d1fa"
      },
      {
        "id": "e-12",
        "from": "7cef0139",
        "to": "be215545"
      },
      {
        "id": "e-13",
        "from": "b0c56077",
        "to": "bb2d8637"
      },
      {
        "id": "e-14",
        "from": "be215545",
        "to": "ce5f1250"
      },
      {
        "id": "e-15",
        "from": "ce5f1250",
        "to": "1d98a2b1"
      },
      {
        "id": "e-16",
        "from": "ce5f1250",
        "to": "b0c56077"
      },
      {
        "id": "e-17",
        "from": "e42f609a",
        "to": "bb2d8637"
      }
    ]
  },
  "analysisReady": {
    "options": [
      {
        "option_id": "49d90be9",
        "label": "Hire a Hands-on Technical Lead",
        "status": "ready",
        "interventions": {
          "756a7698": 0.85
        },
        "is_baseline": false,
        "intervention_details": {
          "756a7698": {
            "display_value": "Very high (0.85)",
            "normalised_value": 0.85
          }
        },
        "raw_interventions": {
          "756a7698": 0.85
        },
        "status_reason": "1 intervention(s) ready for analysis"
      },
      {
        "option_id": "57f5d1fa",
        "label": "Status Quo: No New Hire",
        "status": "ready",
        "interventions": {
          "756a7698": 0.2,
          "ce5f1250": 0.2
        },
        "is_baseline": true,
        "intervention_details": {
          "756a7698": {
            "display_value": "Low (0.2)",
            "normalised_value": 0.2
          },
          "ce5f1250": {
            "display_value": "Low (0.2)",
            "normalised_value": 0.2
          }
        },
        "raw_interventions": {
          "756a7698": 0.2,
          "ce5f1250": 0.2
        },
        "status_reason": "2 intervention(s) ready for analysis"
      },
      {
        "option_id": "be215545",
        "label": "Two Developers",
        "status": "ready",
        "interventions": {
          "ce5f1250": 0.8
        },
        "is_baseline": false,
        "intervention_details": {
          "ce5f1250": {
            "display_value": "Very high (0.8)",
            "normalised_value": 0.8
          }
        },
        "raw_interventions": {
          "ce5f1250": 0.8
        },
        "status_reason": "1 intervention(s) ready for analysis"
      }
    ],
    "goal_node_id": "bb2d8637",
    "status": "ready",
    "bias_findings": [],
    "may_run": true,
    "analysis_admission": {
      "structurally_analysable": true,
      "missing_important_inputs": [],
      "semantic_quality_sufficient": false,
      "permitted_analysis_mode": "quantified_provisional",
      "reasons": [
        {
          "field": "structurally_analysable",
          "code": "READY_TO_COMPARE",
          "message": "Analysis can run on this model as it stands."
        },
        {
          "field": "semantic_quality_sufficient",
          "code": "USER_STATED_PARAMETERS_NOT_MATERIAL",
          "message": "The values you have set sit outside what this comparison turns on, so every estimate behind it is still Olumi’s. Figures can be shown as provisional, but no option can be called the leader until you have set a value on a factor one of the options changes, or somewhere on the chain from there to your goal."
        },
        {
          "field": "permitted_analysis_mode",
          "code": "USER_STATED_PARAMETERS_NOT_MATERIAL",
          "message": "The values you have set sit outside what this comparison turns on, so every estimate behind it is still Olumi’s. Figures can be shown as provisional, but no option can be called the leader until you have set a value on a factor one of the options changes, or somewhere on the chain from there to your goal."
        }
      ],
      "graph_hash": "f0944ec2af452dc9adff8d6841c122f58d2e1b0a6fd73b9a09d67e416b20bae0",
      "semantic_signals": {
        "confidence_parameters_total": 20,
        "confidence_parameters_user_stated": 1,
        "confidence_parameters_machine_authored": 10,
        "confidence_parameters_unattributed": 9,
        "material_parameters_total": 14,
        "material_parameters_user_stated": 0,
        "intervened_factor_baselines_total": 2,
        "intervened_factor_baselines_user_stated": 0,
        "goal_target_stated": false
      }
    },
    "computed_at": "2026-09-08T12:43:02.042Z",
    "freshness": "stale",
    "freshness_reason": "graph_hash_diverged",
    "graph_hash_at_run": "e6aceffe33a51baf",
    "current_graph_hash": "f0944ec2af452dc9"
  },
  "analysisState": {
    "run_state": {
      "kind": "complete_stale",
      "computed_at": "2026-09-08T12:43:02.042Z",
      "cause": "graph_changed"
    },
    "readiness": {
      "status": "ready",
      "blockers": []
    },
    "leader_claim": {
      "permitted": false,
      "withheld_reason": "separation_unavailable"
    },
    "robustness": {},
    "usable_for_prose": true,
    "usable_for_chips": false,
    "usable_for_followup": true,
    "requires_rerun": true,
    "blocked_unusable": false,
    "contradictions": []
  }
} as const;

const LEAD = 'Hire a Hands-on Technical Lead';
const DEVELOPERS = 'Two Developers';
const BUDGET = 'A £200,000 budget does not by itself settle whether you need leadership or more delivery capacity.';
const UNSAFE = `${LEAD} leads in 54% of simulations against ${DEVELOPERS}.`;
const QUALITATIVE_LEAD = `If unclear technical direction and coaching are the bottleneck, explore ${LEAD} as a way to address that gap.`;
const QUALITATIVE_DEVELOPERS = `If priorities are clear but execution capacity is the bottleneck, explore ${DEVELOPERS} while accounting for onboarding and coordination.`;
const QUESTION = 'Before treating the amount as a hiring plan, what period must it cover, and does it include employment costs and onboarding?';
const STALENESS = 'The previous analysis is stale; it does not settle this qualitative question or establish which hiring route fits the budget.';
const SAFE = [BUDGET, QUALITATIVE_LEAD, QUALITATIVE_DEVELOPERS, QUESTION, STALENESS].join('\n\n');
const MIXED = [BUDGET, UNSAFE, QUALITATIVE_LEAD, QUALITATIVE_DEVELOPERS, QUESTION, STALENESS].join('\n\n');
const CONTEXT = { optionLabels: optionRosterFromGraph(CAPTURED.graph) };
const OPTS = {
  requestId: 'synthetic-coaching-preservation-control',
  exitPath: 'execute',
  graph: CAPTURED.graph,
  // Actual native telemetry reported turn entitlement true. Admission still
  // withholds leader naming. Do not silently change either permission.
  mayNameLeadingOption: true,
  analysisReady: CAPTURED.analysisReady,
};
function envelope(text: string): OlumiResponse {
  return OlumiResponseSchema.parse({
    response_version: 2,
    assistant_text: text,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
    analysis_ready: CAPTURED.analysisReady,
    analysis_state: CAPTURED.analysisState,
  });
}
let events: Array<{ name: string; data: Record<string, unknown> }> = [];
beforeEach(() => {
  events = [];
  setTestSink((name, data) => events.push({ name, data: data as Record<string, unknown> }));
});
afterEach(() => setTestSink(null));

describe('controlled preservation of qualitative coaching at the real wire guard', () => {
  it('pins actual roster/admission/freshness and confirms the synthetic contrast discriminates', () => {
    expect(CAPTURED.graph.nodes).toHaveLength(13);
    expect(CAPTURED.graph.edges).toHaveLength(18);
    expect(CONTEXT.optionLabels).toEqual([LEAD, 'Status Quo: No New Hire', DEVELOPERS]);
    expect(CAPTURED.analysisReady.freshness).toBe('stale');
    expect(CAPTURED.analysisState.run_state.kind).toBe('complete_stale');
    expect(CAPTURED.analysisReady.analysis_admission.permitted_analysis_mode).toBe('quantified_provisional');
    expect(analysisReadyPermitsLeaderNaming(CAPTURED.analysisReady)).toBe(false);
    expect(textAssertsLeadingOption(UNSAFE, CONTEXT)).toBe(true);
    expect(textAssertsLeadingOption(SAFE, CONTEXT)).toBe(false);
  });

  it('unsafe-only still removes the unsupported statistic and emits a nonempty refusal', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(UNSAFE), OPTS);
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toBe(WIRE_WITHHELD_LEADER_REPLACEMENT);
    expect(result.response.assistant_text).not.toContain('54%');
    expect(textAssertsLeadingOption(result.response.assistant_text, CONTEXT)).toBe(false);
  });

  it('legitimate qualitative coaching alone is preserved byte-for-byte and by reference', () => {
    const input = envelope(SAFE);
    const result = enforceLeadingOptionClaimsAtWire(input, OPTS);
    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
    expect(result.response.assistant_text).toBe(SAFE);
  });

  it.each([
    ['leadership bottleneck', QUALITATIVE_LEAD],
    ['delivery bottleneck', QUALITATIVE_DEVELOPERS],
  ])('removes the unsafe claim but retains the distinct conditional %s discussion', (_name, wanted) => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(MIXED), OPTS);
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).not.toContain(UNSAFE);
    expect(result.response.assistant_text).not.toContain('54%');
    expect(textAssertsLeadingOption(result.response.assistant_text, CONTEXT)).toBe(false);
    expect(result.response.assistant_text).toContain(BUDGET);
    expect(result.response.assistant_text).toContain(QUESTION);
    console.info('SYNTHETIC_WIRE_PROJECTION', JSON.stringify({
      wanted, output: result.response.assistant_text,
      mode: events.find(e => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire)?.data['mode'],
    }));
    expect(result.response.assistant_text).toContain(wanted);
  });

  it('a refusal mentioning both options is not itself a statistical leader claim', () => {
    const text = `Neither ${LEAD} nor ${DEVELOPERS} can be described as the leading option on this stale analysis.`;
    expect(textAssertsLeadingOption(text, CONTEXT)).toBe(false);
    const input = envelope(text);
    expect(enforceLeadingOptionClaimsAtWire(input, OPTS).response).toBe(input);
  });

  it('job-title and option discussion do not create metric permission', () => {
    const text = `A technical lead can coach the team. Discuss ${LEAD} and ${DEVELOPERS} as hypotheses, not as a statistical ranking.`;
    expect(textAssertsLeadingOption(text, CONTEXT)).toBe(false);
    const input = envelope(text);
    expect(enforceLeadingOptionClaimsAtWire(input, OPTS).response).toBe(input);
    expect(analysisReadyPermitsLeaderNaming(CAPTURED.analysisReady)).toBe(false);
  });

  it('existing distributed-claim safety must remain: naming half plus pronoun statistic cannot escape', () => {
    const text = `${LEAD} is strong. It leads at 54%.`;
    const result = enforceLeadingOptionClaimsAtWire(envelope(text), OPTS);
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).not.toContain(LEAD);
    expect(result.response.assistant_text).not.toContain('54%');
  });

  /**
   * ⭐⭐ THE COMPARATOR IS NOT THE SUBJECT — reproduced by the independent
   * reviewer at `7b54f07c` and repaired here.
   *
   * `BORROWED` and `UNSAFE` differ in ONE way: who the claim is about. Both
   * carry the same statistic, the same comparator and the same two roster
   * labels; `UNSAFE` names its own subject, `BORROWED` takes it anaphorically
   * from the sentence before. The first cut of the escalation discriminator
   * asked only "does this asserting unit name AN option", so `BORROWED`'s unit
   * answered yes on the COMPARATOR, no escalation ran, and the withheld answer
   * shipped as "Hire a Hands-on Technical Lead is strong. No single option can
   * be put forward yet." — still designating the leader it may not name.
   *
   * These cases are a PAIR and neither is evidence alone. The borrowed case
   * shows the leak is closed; the self-contained case, one line below, shows it
   * was closed WITHOUT reopening the over-escalation this PR exists to fix, on
   * prose that differs only in its subject. A repair that escalated everything
   * would pass the first and fail the second.
   */
  const BORROWED = `${LEAD} is strong. It leads in 54% of simulations against ${DEVELOPERS}.`;

  it('a borrowed subject naming only the comparator loses BOTH halves', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(BORROWED), OPTS);
    expect(result.changed).toBe(true);
    // The naming half is the whole point: it survived the first cut.
    expect(result.response.assistant_text).not.toContain(LEAD);
    expect(result.response.assistant_text).not.toContain('54%');
    expect(textAssertsLeadingOption(result.response.assistant_text, CONTEXT)).toBe(false);
  });

  it('the self-contained comparative twin keeps its conditional neighbours', () => {
    // Same statistic, same comparator, same roster — the assertion names its
    // OWN subject, so surgery is complete and nothing else is collateral.
    const field = [BUDGET, UNSAFE, QUALITATIVE_LEAD, QUALITATIVE_DEVELOPERS].join('\n\n');
    const result = enforceLeadingOptionClaimsAtWire(envelope(field), OPTS);
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).not.toContain('54%');
    expect(result.response.assistant_text).toContain(QUALITATIVE_LEAD);
    expect(result.response.assistant_text).toContain(QUALITATIVE_DEVELOPERS);
    expect(result.response.assistant_text).toContain(BUDGET);
  });

  it('the borrowed twin in the SAME field does escalate — the discrimination is the subject', () => {
    const field = [BUDGET, BORROWED, QUALITATIVE_LEAD, QUALITATIVE_DEVELOPERS].join('\n\n');
    const result = enforceLeadingOptionClaimsAtWire(envelope(field), OPTS);
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).not.toContain(LEAD);
    expect(result.response.assistant_text).not.toContain('54%');
    expect(textAssertsLeadingOption(result.response.assistant_text, CONTEXT)).toBe(false);
    // The option-free coaching is still not collateral, even when escalating.
    expect(result.response.assistant_text).toContain(BUDGET);
  });

  it('permission identity is unchanged for the borrowed-subject input', () => {
    // ⚠ `OPTS.mayNameLeadingOption` is ALREADY true here — the permit is a
    //   CONJUNCTION with admission, and this fixture's captured admission
    //   withholds. Flipping the turn flag alone would have proved nothing, so
    //   the permitting half is supplied too, and the assertion is BY REFERENCE:
    //   a permitted turn must not be re-serialised, whatever its prose says.
    expect(analysisReadyPermitsLeaderNaming(CAPTURED.analysisReady)).toBe(false);
    const input = envelope(BORROWED);
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      mayNameLeadingOption: true,
      analysisReady: undefined,
    });
    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
    expect(result.response.assistant_text).toBe(BORROWED);
  });
});

