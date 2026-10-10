/** DL B3 086e4624, served 81b77b9f: event-prompt selection is the admission authority. No external I/O. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../../utils/telemetry.js';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import type { ToolResult } from '../../agent-lane/runtime/agent-tools.js';
import { firstAnalysisSentence } from '../../agent-lane/first-analysis.js';
import { narrateWriteOutcome } from '../../agent-lane/write-outcome.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import * as EventModel from '../event-by-date-model.js';

type Rec = Record<string, any>;
const SCENARIO = '086e4624-3c4f-4c6f-8706-655fa6b9b388';
const BRIEF = 'Should we hire two senior engineers or four junior engineers to ship the new platform by Q3, while keeping annual salary spend under £400k?';
const refusal = (piece: string) => `Olumi couldn't connect your options to the launch date yet: ${piece}.`;

/** Engineer settings plus capacity, as requested by buildCandidateSchema; B3's stated salary limit is retained. */
const b3 = (): CandidateModel => ({
  goal: { kind: 'event_by_date', deliverable: 'the new platform', metric: 'Platform completion', operator: '>=',
    unit: '%', value: null, target_stated: false, frame: 'level', baseline_known: false,
    baseline_value: null, baseline_provenance: 'inferred', horizon_months: null, provenance: 'inferred', scope: null },
  options: [
    { label: 'Current team', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [], added_capacity: null },
    { label: 'Hire two senior engineers', provenance: 'explicit', changes: [], interventions: [
      { factor_label: 'Senior engineers hired', value: 2, unit: 'engineers', provenance: 'explicit', stated_evidence: null },
    ], added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Hire four junior engineers', provenance: 'explicit', changes: [], interventions: [
      { factor_label: 'Junior engineers hired', value: 4, unit: 'engineers', provenance: 'explicit', stated_evidence: null },
    ], added_capacity: { monthly_share_pct: 10, lead_months_low: 3, lead_months_high: 5 } },
  ],
  factors: [
    { label: 'Senior engineers hired', role: 'controllable', baseline_known: true, baseline_value: 0,
      unit: 'engineers', provenance: 'inferred', plausible_max: 10 },
    { label: 'Junior engineers hired', role: 'controllable', baseline_known: true, baseline_value: 0,
      unit: 'engineers', provenance: 'inferred', plausible_max: 20 },
    { label: 'Annual salary spend', role: 'controllable', baseline_known: false, baseline_value: 0,
      unit: 'GBP/year', provenance: 'inferred', plausible_max: 1000000 },
  ],
  constraints: [{ metric: 'Annual salary spend', operator: '<=', value: 400000, unit: 'GBP/year', provenance: 'explicit' }],
  risks: [], outcomes: [], links: [
    { from: 'Senior engineers hired', to: 'Annual salary spend', direction: 'positive', provenance: 'inferred' },
    { from: 'Junior engineers hired', to: 'Annual salary spend', direction: 'positive', provenance: 'inferred' },
  ], identities: [], decision_question: BRIEF,
});

const flagged = (c = b3(), brief = BRIEF) => admitCandidateModel(c, {}, brief,
  undefined, undefined, undefined, undefined, undefined, { event_by_date_prompted: true });
const normal = (): CandidateModel => ({
  goal: { metric: 'Monthly recurring revenue', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  options: [
    { label: 'Raise the price', provenance: 'explicit', interventions: [{ factor_label: 'Price', value: 59, unit: 'GBP', provenance: 'explicit' }] },
    { label: 'Continue as now', provenance: 'explicit', is_status_quo: true },
  ],
  factors: [{ label: 'Price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 }],
  links: [{ from: 'Price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' }],
  constraints: [], risks: [], outcomes: [], identities: [],
});
/** Stored arm-mechanism/sealedR-d3.json; original prompt flagged; base 81b77b9f ordinary graph. */
const SEALED_BRIEF = "We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least £150,000 monthly recurring revenue within 9 months. Facts: Each starter subscriber costs about £6 a month in support. Keeping pricing as it is adds nothing.";
const sealed = (): CandidateModel => {
  // The recorded schema has extension fields (value_kind/unknowns); retain their exact bytes.
  const stored = {
    goal: {"kind": null, "deliverable": null, "metric": "monthly recurring revenue", "operator": ">=", "target_stated": true, "value": 150000, "unit": "£/month", "horizon_months": 9, "provenance": "explicit", "frame": "level", "baseline_known": true, "baseline_value": 120000, "baseline_provenance": "explicit", "scope": null},
    constraints: [
    ],
    options: [
      {"label": "Raise prices 10%", "provenance": "explicit", "changes": [], "interventions": [{"factor_label": "Price change from current price", "value": 10, "value_kind": "additional", "unit": "%", "provenance": "explicit", "stated_evidence": null}], "added_capacity": null, "is_status_quo": null},
      {"label": "Launch starter tier", "provenance": "explicit", "changes": [], "interventions": [{"factor_label": "Starter monthly price", "value": 49, "value_kind": "absolute", "unit": "£/subscriber/month", "provenance": "explicit", "stated_evidence": {"quote": "Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is.", "start": 110, "end": 204, "amount_start": 166, "option_quote": "launch a starter tier at £49 a month", "option_start": 141, "option_end": 177}}, {"factor_label": "Starter subscribers", "value": 500, "value_kind": "absolute", "unit": "subscribers", "provenance": "ai_proposed", "stated_evidence": null}], "added_capacity": null, "is_status_quo": null},
      {"label": "Keep pricing as is", "provenance": "explicit", "changes": [], "interventions": [], "added_capacity": null, "is_status_quo": true},
    ],
    factors: [
      {"label": "Price change from current price", "role": "controllable", "baseline_known": true, "baseline_value": 0, "unit": "%", "provenance": "explicit", "plausible_max": 50},
      {"label": "Existing customers", "role": "observable", "baseline_known": true, "baseline_value": 400, "unit": "customers", "provenance": "explicit", "plausible_max": 2000},
      {"label": "Starter subscribers", "role": "controllable", "baseline_known": true, "baseline_value": 0, "unit": "subscribers", "provenance": "inferred", "plausible_max": 5000},
      {"label": "Starter monthly price", "role": "controllable", "baseline_known": false, "baseline_value": 0, "unit": "£/subscriber/month", "provenance": "ai_proposed", "plausible_max": 200},
      {"label": "Support cost per starter subscriber", "role": "observable", "baseline_known": true, "baseline_value": 6, "unit": "£/subscriber/month", "provenance": "explicit", "plausible_max": 50},
    ],
    risks: [
      {"label": "Price-increase churn", "provenance": "ai_proposed", "unit": null, "plausible_max": null},
      {"label": "Starter support strain", "provenance": "ai_proposed", "unit": null, "plausible_max": null},
    ],
    outcomes: [
    ],
    links: [
      {"from": "Price change from current price", "to": "monthly recurring revenue", "direction": "positive", "provenance": "ai_proposed", "effect_amount": 1200, "effect_per_source_change": 1, "effect_provenance": "ai_proposed", "definitional": null},
      {"from": "Price change from current price", "to": "Price-increase churn", "direction": "positive", "provenance": "ai_proposed", "effect_amount": null, "effect_per_source_change": null, "effect_provenance": null, "definitional": null},
      {"from": "Price-increase churn", "to": "Existing customers", "direction": "negative", "provenance": "ai_proposed", "effect_amount": -20, "effect_per_source_change": 1, "effect_provenance": "ai_proposed", "definitional": null},
      {"from": "Existing customers", "to": "monthly recurring revenue", "direction": "positive", "provenance": "explicit", "effect_amount": 300, "effect_per_source_change": 1, "effect_provenance": "explicit", "definitional": null},
      {"from": "Starter subscribers", "to": "monthly recurring revenue", "direction": "positive", "provenance": "explicit", "effect_amount": 49, "effect_per_source_change": 1, "effect_provenance": "explicit", "definitional": null},
      {"from": "Starter monthly price", "to": "monthly recurring revenue", "direction": "positive", "provenance": "ai_proposed", "effect_amount": 500, "effect_per_source_change": 1, "effect_provenance": "ai_proposed", "definitional": null},
      {"from": "Support cost per starter subscriber", "to": "Starter support strain", "direction": "positive", "provenance": "ai_proposed", "effect_amount": null, "effect_per_source_change": null, "effect_provenance": null, "definitional": null},
      {"from": "Starter support strain", "to": "Starter subscribers", "direction": "negative", "provenance": "ai_proposed", "effect_amount": -100, "effect_per_source_change": 1, "effect_provenance": "ai_proposed", "definitional": null},
    ],
    identities: [
    ],
    unknowns: [
      "The 500-starter-subscriber estimate is a provisional modelling assumption; what is the expected starter-tier customer acquisition over the next 9 months?",
      "The model assumes a 10% price rise could trigger a discrete loss of about 20 existing customers; what evidence is available on price sensitivity, contracts, and renewal timing?",
      "The model assumes support strain could reduce starter-tier uptake by about 100 subscribers; what support capacity and onboarding volume can the team sustain?",
      "Does the £6 monthly support cost per starter subscriber affect a profitability or cash constraint that should also be modelled?",
    ],
    decision_question: null,
  } as const;
  return stored;
};

async function built(c: CandidateModel, brief = BRIEF) {
  const registrations: Rec[] = [], instructions: string[] = [];
  const call: CallStructuredModel = async body => { instructions.push(body.instructions); return { text: JSON.stringify(c) }; };
  const result = await buildModelFromBrief(SCENARIO, brief, async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registrations.push((body as Rec).graph);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  }, call) as ToolResult & Rec;
  return { result, registrations, instructions };
}
function expectEventGraph(g: Rec) {
  expect(g.edges.find((e: Rec) => e.from === 'event_team' && e.to === 'event_goal')).toMatchObject({
    provenance: { share_by_date: { role: 'team', deliverable: 'the new platform', goal_id: 'event_goal', team_id: 'event_team' } },
  });
  for (const id of ['event_capacity_2', 'event_capacity_3']) {
    expect(g.nodes.find((n: Rec) => n.id === id)).toMatchObject({ kind: 'factor', observed_state: { extra_share_by_date: expect.any(Object) } });
    expect(g.edges.find((e: Rec) => e.from === id && e.to === 'event_goal')).toBeDefined();
  }
  for (const id of ['event_option_1', 'event_option_2', 'event_option_3']) {
    expect(g.edges.find((e: Rec) => e.from === 'event_decision' && e.to === id)).toBeDefined();
    expect(g.edges.find((e: Rec) => e.from === id && e.to === 'event_capacity_2')).toBeDefined();
    expect(g.edges.find((e: Rec) => e.from === id && e.to === 'event_capacity_3')).toBeDefined();
  }
  const admission = resolveRunAdmission(g);
  expect(admission.assessment.blockingIssues.filter(i => i.code === 'NO_PATH_TO_GOAL')).toEqual([]);
  expect(admission.blockedNextStep ?? '').not.toContain('A part of the model cannot reach the goal');
}

describe('event-by-date typed prompt verdict (B3 086e4624; base 81b77b9f)', () => {
  it('sealedR-d3 (flagged, drafted as an ordinary model) keeps its ordinary graph byte-identical to base, no event attempt', async () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
    const eventAdmission = vi.spyOn(EventModel, 'admitEventByDate');
    try {
      const admitted = flagged(sealed(), SEALED_BRIEF);
      expect(validateGraphStructure(GraphV3.parse(admitted), { leaveOutInertRisks: true }).valid).toBe(true);
      expect(JSON.stringify(admitted)).toBe(JSON.stringify(admitCandidateModel(sealed(), {}, SEALED_BRIEF)));
      // Admission precedes fitting. Only these two endpoint-bound transient candidates differ from the recorded base.
      const pending = [
        { from: 'existing_customers', to: 'monthly_recurring_revenue', label: 'Existing customers', mean: 3.2 },
        { from: 'starter_subscribers', to: 'monthly_recurring_revenue', label: 'Starter subscribers', mean: 1.3066666666666664 },
      ];
      expect(admitted.edges.filter(e => e.provenance?.olumi_fit_candidate !== undefined).map(e => `${e.from}→${e.to}`))
        .toEqual(pending.map(e => `${e.from}→${e.to}`));
      const admissionBase = structuredClone(admitted);
      for (const id of pending) {
        const e = admissionBase.edges.find(e => e.from === id.from && e.to === id.to)!;
        const drafted = sealed().links.find(l => l.from === id.label && l.to === 'monthly recurring revenue')!;
        expect(e.provenance?.olumi_fit_candidate).toEqual({
          strength_mean: id.mean, strength_std: id.mean / 2,
          natural_effect: { amount: drafted.effect_amount, amount_unit: '£/month',
            per_source_change: drafted.effect_per_source_change,
            per_source_change_unit: id.from === 'existing_customers' ? 'customers' : 'subscribers',
            strength_mean: id.mean, strength_mean_frame: 'edge_strength' },
        });
        delete e.provenance!.olumi_fit_candidate;
      }
      // S7 PR-B re-record (field-by-field vs base 81b77b9f/staging cbf36b7a): ONLY the drafter-declared explicit factors with no verbatim brief quote differ —
      // source brief_extraction->cee_inference, extractionType absent->inferred, user_material_unverified true, provenance from_brief->unverified_brief. Nothing else moves.
      expect(createHash('sha256').update(JSON.stringify(admissionBase)).digest('hex')).toBe('4822ddd3cd04fdbbd132bb88c1e83b7143875147c063e4fce170f282beb5014e');
      expect(admitted.withheld.some(w => w.reason === 'event_goal_unadmitted')).toBe(false);
      expect(info.mock.calls.some(c => (c[0] as { event?: string } | undefined)?.event === 'cee.event_by_date.fallback_kept')).toBe(false);
      const { result, registrations } = await built(sealed(), SEALED_BRIEF);
      expect(result).toMatchObject({ ok: true, mutated: true });
      expect(registrations).toHaveLength(1);
      // Verified against a replay without the Olumi fit: only this edge changes. Frames and all other bytes stay pinned.
      const fittedIds = [{ from: 'starter_subscribers', to: 'monthly_recurring_revenue' }];
      const registrationBase = structuredClone(registrations[0]);
      for (const id of fittedIds) {
        const index = registrationBase.edges.findIndex((e: Rec) => e.from === id.from && e.to === id.to);
        expect(registrationBase.edges.filter((e: Rec) => e.from === id.from && e.to === id.to)).toHaveLength(1);
        const e = registrationBase.edges[index];
        const drafted = sealed().links.find(l => l.from === 'Starter subscribers' && l.to === 'monthly recurring revenue')!;
        expect(e).toEqual({ ...id, strength: { mean: 0.24499999999999994, std: 0.12249999999999997 },
          exists_probability: 0.8, effect_direction: 'positive', provenance: { source: 'brief_extraction',
            magnitude: 'olumi_estimate', natural_effect: { amount: drafted.effect_amount, amount_unit: '£/month',
              per_source_change: drafted.effect_per_source_change, per_source_change_unit: 'subscribers',
              strength_mean: 0.24499999999999994, strength_mean_frame: 'edge_strength' } } });
        // The original edge, including key order, keeps the original whole-graph digest meaningful.
        registrationBase.edges[index] = { ...id, strength: { mean: 0.09375, std: 0.046875 },
          exists_probability: 0.8, effect_direction: 'positive', provenance: { source: 'brief_extraction',
            magnitude: 'olumi_placeholder', natural_effect: { amount: 9375, amount_unit: '£/month',
              per_source_change: 500, per_source_change_unit: 'subscribers', strength_mean: 0.09375,
              strength_mean_frame: 'edge_strength' } }, defaulted: true };
      }
      expect(JSON.stringify(registrations[0])).not.toContain('olumi_fit_candidate');
      // S7 PR-B re-record (field-by-field vs staging cbf36b7a): only nodes 5, 6, 9 (drafter-declared explicit, no verbatim brief quote) gain
      // extractionType inferred + user_material_unverified, provenance from_brief->unverified_brief (and source brief_extraction->cee_inference where it was set).
      expect(createHash('sha256').update(JSON.stringify(registrationBase)).digest('hex'))
        .toBe('e6e213467888242aaf6e74c98deccdea5415774ea85bae69540b5992aa9dccf7');
      expect(resolveRunAdmission(registrations[0]).willProceed).toBe(true);
      expect(eventAdmission).not.toHaveBeenCalled();
    } finally { info.mockRestore(); eventAdmission.mockRestore(); }
  });

  it('an event-slice draft whose event admission fails keeps its reachable ordinary model and logs the missing piece', () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
    try {
      const c = { ...sealed(), goal: { ...sealed().goal, deliverable: 'the starter tier' } } as CandidateModel;
      const admitted = flagged(c, SEALED_BRIEF);
      expect(admitted.withheld.some(w => w.reason === 'event_goal_unadmitted')).toBe(false);
      expect(admitted).toEqual(admitCandidateModel(c, {}, SEALED_BRIEF));
      expect(info).toHaveBeenCalledWith({ event: 'cee.event_by_date.fallback_kept', missing_piece: 'it needs how much capacity each option adds' },
        'cee.event_by_date.fallback_kept');
    } finally { info.mockRestore(); }
  });

  /** Census r3 B3-d2 (recorded drafter output): the event construction is 36 links, over the cap of 30, on Olumi's own scaffolding. */
  const B3_D2 = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'event-b3-d2-20261008.json'), 'utf8')) as { brief: string; output_text: string };
  it('B3-d2: an event construction over the size cap keeps the reachable ordinary model, as base built it (DL ruling B)', async () => {
    const { result, registrations } = await built(JSON.parse(B3_D2.output_text) as CandidateModel, B3_D2.brief);
    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(registrations).toHaveLength(1);
    // Base staging 94b2554d registered this exact graph (census r3, graph_sha prefix).
    expect(createHash('sha256').update(JSON.stringify(registrations[0])).digest('hex').slice(0, 16)).toBe('beb8fd537da68f6d');
    expect(resolveRunAdmission(registrations[0]).willProceed).toBe(true);
  });

  it('CONTRAST: over the cap with an ordinary model that cannot reach the goal, the event construction takes today\'s size path', async () => {
    const c = { ...(JSON.parse(B3_D2.output_text) as CandidateModel), links: [] };
    const { result, registrations } = await built(c, B3_D2.brief);
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large' });
    expect(registrations).toHaveLength(0);
  });

  it('B3 flagged Platform completion uses event capacity paths despite the scoped-token mismatch', () => {
    const c = b3();
    expect(EventModel.briefAttestsEventByDate(BRIEF)).toBe(true);
    expect(EventModel.briefAttestsEventByDate(BRIEF, c.goal)).toBe(false);
    const a = flagged(c);
    expectEventGraph(a);
    const graph = GraphV3.parse(a);
    for (const label of ['Senior engineers hired', 'Junior engineers hired', 'Annual salary spend']) {
      expect(graph.nodes.find(n => n.label === label)?.analysis_participation).not.toBe('retained_excluded');
    }
    expect(guardAnalysisParticipation(graph).excludedNodeIds).toEqual([]);
  });

  it('B3 construction carries its single classifier verdict from the sent suffix into admission', async () => {
    const attest = vi.spyOn(EventModel, 'briefAttestsEventByDate');
    try {
      const { result, registrations, instructions } = await built(b3());
      expect(instructions[0]).toContain('leave its factors, risks, outcomes, links and identities empty');
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: true });
      expect(registrations).toHaveLength(1);
      expectEventGraph(registrations[0]!);
      expect(attest.mock.calls.filter(([, goal]) => goal !== undefined)).toEqual([]);
      expect(attest).toHaveBeenCalledOnce();
    } finally { attest.mockRestore(); }
  });

  it('P44 heldout3-d1 raw shape: count settings with empty ordinary links keep event capacity reachable', () => {
    const c = b3();
    const a = flagged({ ...c, factors: c.factors.slice(0, 2), constraints: [], links: [] });
    expectEventGraph(a);
    const graph = GraphV3.parse(a), contexts = graph.nodes.filter(n => n.id.startsWith('event_context_'));
    expect(resolveRunAdmission(graph).assessment.blockingIssues).toEqual([expect.objectContaining({
      code: 'MISSING_FACTOR_LEVEL', factor_id: 'event_team',
    })]);
    expect(contexts).toHaveLength(2);
    for (const n of contexts) {
      expect(n).toMatchObject({ analysis_participation: 'retained_excluded', observed_state: { raw_value: 0, unit: 'engineers' } });
      for (const option of graph.nodes.filter(o => o.kind === 'option')) expect(option.interventions ?? {}).not.toHaveProperty(n.id);
    }
    const participation = guardAnalysisParticipation(graph, { goalNodeId: 'event_goal',
      optionInterventionTargetIds: graph.nodes.filter(n => n.kind === 'option').flatMap(n => Object.keys(n.interventions ?? {})) });
    expect(participation.refusals).toEqual([]);
    expect([...participation.excludedNodeIds].sort()).toEqual(contexts.map(n => n.id).sort());
    expect(participation.graph.nodes.some(n => n.id.startsWith('event_context_'))).toBe(false);
    expect(a.nodes.find(n => n.id === 'event_option_2')?.description).toContain('Senior engineers hired = 2 engineers');
    expect(a.nodes.find(n => n.id === 'event_option_3')?.description).toContain('Junior engineers hired = 4 engineers');
    for (const value of [2, 4]) {
      expect(a.loss).toContainEqual(expect.objectContaining({ before: expect.objectContaining({
        original: expect.objectContaining({ value, provenance: 'explicit' }),
      }) }));
    }
  });

  it('readiness excludes only marked event context; an active option target remains a structural blocker', () => {
    const c = b3(), graph = GraphV3.parse(flagged({ ...c, factors: c.factors.slice(0, 2), constraints: [], links: [] }));
    const context = graph.nodes.find(n => n.id.startsWith('event_context_'))!;
    const option = graph.nodes.find(n => n.id === 'event_option_2')!;
    option.interventions = { ...option.interventions, [context.id]: { value: 1 } };
    expect(validateGraphStructure(graph, { leaveOutInertRisks: true }).violations)
      .toContainEqual(expect.objectContaining({ code: 'NO_PATH_TO_GOAL', factor_id: context.id }));
    expect(guardAnalysisParticipation(graph, { optionInterventionTargetIds: [context.id] }).refusals)
      .toContainEqual({ node_id: context.id, reason: 'option_intervention_target' });
  });

  it('readiness keeps an excluded context factor that a limit names', () => {
    const c = b3(), graph = GraphV3.parse(flagged({ ...c, factors: c.factors.slice(0, 2), constraints: [], links: [] }));
    const context = graph.nodes.find(n => n.id.startsWith('event_context_'))!;
    graph.goal_constraints = [{ constraint_id: 'context_limit', node_id: context.id, operator: '<=', value: 10, unit: 'engineers' }];
    expect(GraphV3.safeParse(graph).success).toBe(true);
    const readiness = resolveRunAdmission(graph);
    expect(readiness.willProceed).toBe(false);
    expect(readiness.assessment.blockingIssues).toContainEqual(expect.objectContaining({ code: 'MISSING_OPTION_VALUE', factor_id: context.id }));
  });

  it('malformed event-shaped input retains the existing total readiness refusal', () => {
    const event = flagged();
    for (const malformed of [{ ...event, edges: [null] }, { ...event, nodes: [...event.nodes, null] }]) {
      expect(() => resolveRunAdmission(malformed)).not.toThrow();
      expect(resolveRunAdmission(malformed)).toMatchObject({ willProceed: false, strict: { status: 'unrecoverable' } });
    }
  });

  it('a flagged drafter kind/value cannot override the classifier verdict that selected its prompt', () => {
    const c = b3();
    expectEventGraph(flagged({ ...c, goal: { ...c.goal, kind: null, value: 100 } }));
  });

  it('any thrown event-admission failure returns the closed capacity refusal without ordinary fallback', () => {
    const fail = vi.spyOn(EventModel, 'admitEventByDate').mockImplementation(() => { throw new Error('local admission failure'); });
    try {
      const a = flagged(), expected = refusal('it needs how much capacity each option adds');
      expect(a.withheld).toContainEqual(expect.objectContaining({ reason: 'event_goal_unadmitted', detail: expected }));
      expect(a.nodes).toEqual([]);
      expect(a.edges).toEqual([]);
      expect(resolveRunAdmission(a).blockedNextStep).toBe(expected);
    } finally { fail.mockRestore(); }
  });

  it.each([
    ['no deliverable', 'it needs the deliverable the date is for', (c: CandidateModel): CandidateModel => ({ ...c, goal: { ...c.goal, deliverable: null } })],
    ['no added_capacity', 'it needs how much capacity each option adds', (c: CandidateModel): CandidateModel => ({ ...c, options: c.options.map(o => ({ ...o, added_capacity: null })) })],
    ['invalid added_capacity', 'it needs how much capacity each option adds', (c: CandidateModel): CandidateModel => ({ ...c, options: c.options.map(o => o.is_status_quo ? o : { ...o, added_capacity: { monthly_share_pct: 10, lead_months_low: 5, lead_months_high: 3 } }) })],
    ['zero capacity change', "the options don't change the team's capacity", (c: CandidateModel): CandidateModel => ({ ...c, options: c.options.map(o => o.is_status_quo ? o : { ...o, added_capacity: { monthly_share_pct: 0, lead_months_low: 2, lead_months_high: 4 } }) })],
  ] as const)('flagged %s uses the existing refusal carrier and never ordinary fallback', async (_name, piece, change) => {
    const c = change(b3()), expected = refusal(piece), admitted = flagged(c);
    expect(admitted.withheld).toContainEqual(expect.objectContaining({ reason: 'event_goal_unadmitted', detail: expected }));
    expect(admitted.edges.some(e => e.from === 'senior_engineers_hired')).toBe(false);
    expect(admitted.nodes.find(n => n.kind === 'goal')?.id).not.toBe('platform_completion');
    const detail = admitted.withheld.find(w => w.reason === 'event_goal_unadmitted')!.detail;
    const runAdmission = resolveRunAdmission(admitted);
    expect(runAdmission.willProceed).toBe(false);
    expect(runAdmission.blockedNextStep).toBe(expected);
    expect(firstAnalysisSentence({ ran: false, reason: 'not_admissible', nextStep: detail }))
      .toBe(`The first analysis could not run yet: ${expected}`);
    const { result, registrations } = await built(c);
    expect(result).toMatchObject({ ok: false, mutated: false, detail: expected });
    expect(registrations).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('A part of the model cannot reach the goal');
    expect(narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result]).status).toBe(expected);
  });

  it('unflagged non-event admission is byte-identical to base 81b77b9f', () => {
    const brief = 'Should we raise the price from £49 to £59 to reach £20k monthly recurring revenue?';
    const a = admitCandidateModel(normal(), {}, brief);
    const explicitFalse = admitCandidateModel(normal(), {}, brief, undefined, undefined, undefined, undefined, undefined,
      { event_by_date_prompted: false });
    expect(JSON.stringify(explicitFalse)).toBe(JSON.stringify(a));
    // S7 PR-B re-record (field-by-field vs base 81b77b9f/staging cbf36b7a): ONLY the drafter-declared explicit factors with no verbatim brief quote differ —
    // source brief_extraction->cee_inference, extractionType absent->inferred, user_material_unverified true, provenance from_brief->unverified_brief. Nothing else moves.
    expect(createHash('sha256').update(JSON.stringify(a)).digest('hex')).toBe('28e2aee7fbe6e85c468c897e27c181016d1efa53a7ab3d8888a01b9caa5056e0');
  });
});
