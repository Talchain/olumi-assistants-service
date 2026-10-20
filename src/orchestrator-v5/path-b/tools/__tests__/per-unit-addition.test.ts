/** L15: synthetic strict-output replays, real B conversion/save and Run request, no provider or PLoT calls.
 * The user owns the central effect/raw range; existing D3 defaults remain Olumi illustrative assumptions.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModel, type DraftDeps } from '../draft-tool.js';
import { constructionOperationId, type CallStructuredModel } from '../../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { linkProvenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { linkDefaultAssumptionsOf } from '../../../../cee/magnitude/link-default-assumptions.js';

type Rec = Record<string, any>;
const SID = 'c1c1c1c1-0000-4000-8000-000000000015';
const UNIT = 'tickets per week';
const TODAY = 'The existing team clears 80 tickets per week.';
const EFFECT = 'Each extra specialist clears about 20 tickets per week, between 10 and 30.';
const SUM = 'Total capacity is the existing capacity plus the extra capacity.';
const BRIEF = `${TODAY} ${EFFECT} ${SUM} Hold adds 0 specialists. Grow adds 1 specialist. Our target is 100 tickets per week.`;
const said = (quote: string, subject: Rec, field: string, value: number, unit: string, extra: Rec = {}): Rec => ({
  quote, subject: { to_label: null, factor_label: null, ...subject }, field, form: 'point', value, low: null, high: null,
  unit, qualifier: null, conditions: null, speaker: 'user', ...extra,
});
const factor = (label: string, value: number, unit: string, origin = 'olumi'): Rec => ({ label, role: 'observable',
  baseline_known: true, baseline_value: value, unit, origin, stance: 'stated_current', provenance: 'inferred',
  plausible_max: null, baseline_evidence: null });
const link = (from: string, to: string, amount: number, origin = 'olumi', definitional = false): Rec => ({
  from, to, direction: 'positive', provenance: 'inferred', origin, stance: 'estimate', effect_amount: amount,
  effect_per_source_change: 1, effect_provenance: origin === 'user' ? 'explicit' : 'inferred', definitional,
  basis: null, source_quote: origin === 'user' ? EFFECT : SUM,
});
function draft(statementUnit = `${UNIT} per specialist`): Rec {
  return {
    goal: { metric: 'Total capacity', kind: null, deliverable: null, operator: '>=', target_stated: true, value: 100, unit: UNIT,
      horizon_months: null, provenance: 'explicit', frame: 'level', quantity_frame: 'level', baseline_known: true, baseline_value: 80,
      baseline_provenance: 'explicit', baseline_origin: 'user', baseline_stance: 'stated_current', target_origin: 'user', target_stance: 'target',
      source_quote: 'Our target is 100 tickets per week.', scope: null, basis: null },
    constraints: [], risks: [], outcomes: [], unknowns: [], unknown_concerns: [], decision_question: null,
    factors: [
      { ...factor('Existing capacity', 80, UNIT, 'user'), provenance: 'explicit', baseline_evidence: { quote: TODAY } },
      { ...factor('Extra specialists', 0, 'specialists'), role: 'controllable' },
      factor('Extra capacity', 0, UNIT),
    ],
    options: [
      { label: 'Hold', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true, added_capacity: null },
      { label: 'Grow', provenance: 'explicit', changes: [], is_status_quo: false, added_capacity: null,
        interventions: [{ factor_label: 'Extra specialists', value: 1, value_kind: 'absolute', unit: 'specialists', provenance: 'explicit',
          origin: 'user', stance: 'hypothetical', stated_evidence: null }] },
    ],
    links: [link('Existing capacity', 'Total capacity', 1, 'olumi', true),
      link('Extra specialists', 'Extra capacity', 20, 'user'), link('Extra capacity', 'Total capacity', 1, 'olumi', true)],
    identities: [{ operation: 'sum', outcome: 'Total capacity', factors: ['Existing capacity', 'Extra capacity'],
      provenance: 'inferred', reading: null, evidence: null }],
    statements: [said(TODAY, { kind: 'factor', label: 'Existing capacity' }, 'level', 80, UNIT),
      said(TODAY, { kind: 'goal', label: 'Total capacity' }, 'level', 80, UNIT),
      said('Our target is 100 tickets per week.', { kind: 'goal', label: 'Total capacity' }, 'target', 100, UNIT),
      said('Grow adds 1 specialist.', { kind: 'option', label: 'Grow', factor_label: 'Extra specialists' }, 'level', 1, 'specialists'),
      said(EFFECT, { kind: 'link', label: 'Extra specialists', to_label: 'Extra capacity' }, 'effect', 20, statementUnit,
        { form: 'range', low: 10, high: 30, qualifier: 'about' })],
  };
}
async function replay(raw: Rec, brief = BRIEF): Promise<Rec> {
  let stored: Rec | undefined;
  const sourceTurn = registrationTurnId(SID, constructionOperationId(SID, brief));
  const dispatch: DraftDeps['dispatch'] = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = GraphV3.parse((body as Rec).graph);
      return { status: 200, json: {} };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [{ version_id: 'v15', sequence: 1,
      created_at: '2026-10-20T08:00:00.000Z', creation: { kind: 'committed_mutation', mutation_id: 'm15', source_turn_id: sourceTurn } }] } };
    return { status: 200, json: { graph: stored ?? null, graph_present: stored !== undefined, graph_hash: stored ? 'h15' : null } };
  };
  const callStructured = vi.fn<CallStructuredModel>(async () => ({ text: JSON.stringify(raw), status: 'completed' }));
  const out = await buildModel({ dispatch, callStructured }, { scenario_id: SID, verified_user_messages: [brief], user_turn_text: brief }, { brief });
  expect(out.status).toBe('ok');
  expect(callStructured).toHaveBeenCalledTimes(1);
  expect(stored).toBeDefined();
  return stored!;
}
const effectOf = (g: Rec): Rec => g.edges.find((e: Rec) => e.from === 'extra_specialists' && e.to === 'extra_capacity');
async function runRequest(graph: Rec, brief: string): Promise<Rec> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'req-l15', {
    loadGraphAndBriefText: vi.fn(async () => ({ graph, briefText: brief, revision: 1 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  } as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({ plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snapshot, probe: async (sent) => { payload = sent.plotPayload as Rec; } });
  await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
    session_id: SID, request_id: 'req-l15', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [],
    scenarioBriefText: null, persistedGraph: null },
  payload: makeMessagePayload({ turn_id: 't-l15', scenario_id: SID, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
  requestId: 'req-l15', signal: new AbortController().signal, orientationText: '' } as never);
  expect(payload).toBeDefined();
  return payload!;
}

describe('current level plus a stated per-unit addition', () => {
  it.each([
    ['support', BRIEF, draft()],
    ['packing', BRIEF.replaceAll('tickets', 'parcels').replaceAll('specialist', 'packer'),
      JSON.parse(JSON.stringify(draft()).replaceAll('tickets', 'parcels').replaceAll('specialist', 'packer'))],
  ])('%s retains the user central rate/raw range, Olumi D3 defaults and exact sum', async (_name, brief, raw) => {
    const graph = await replay(raw as Rec, brief as string);
    const rate = graph.edges.find((e: Rec) => e.to === 'extra_capacity' && e.from !== 'existing_capacity');
    expect(rate.provenance.magnitude).toBe('user_stated');
    expect(linkProvenanceOf(rate).origin).toBe('human');
    expect(rate.provenance.natural_effect.amount).toBe(20);
    expect(rate.strength.std).toBe(Math.abs(rate.strength.mean) / 2);
    expect(rate.exists_probability).toBe(0.8);
    const defaults = linkDefaultAssumptionsOf(rate);
    expect(defaults.map(d => ({ field: d.field_path, before: d.before, after: d.after }))).toEqual([
      { field: `edges[${rate.from}::${rate.to}].strength.std`, before: null, after: rate.strength.std },
      { field: `edges[${rate.from}::${rate.to}].exists_probability`, before: null, after: 0.8 },
    ]);
    expect(defaults[0].reason).toBe('Nobody stated how uncertain this strength is. Olumi uses half its size as the spread. It is not a measurement of anyone\'s confidence.');
    expect(defaults[1].reason).toBe('Nobody stated how likely this link is to exist. Applied the canonical default. A defaulted value and an elicited value are the same number, so the ledger is the only place the difference survives.');
    expect(rate.provenance.natural_effect.stated_range).toEqual({ low: 10, high: 30,
      text: (raw as Rec).statements.at(-1).quote, end: 'centre' });
    const request = await runRequest(graph, brief as string);
    expect(request.graph.nodes.find((n: Rec) => n.kind === 'goal').nonlinear_identity).toEqual({ operation: 'sum',
      factor_ids: ['existing_capacity', 'extra_capacity'], stated_in_brief: false });
    for (const from of ['existing_capacity', 'extra_capacity']) {
      const part = graph.edges.find((e: Rec) => e.from === from && e.to === 'total_capacity');
      expect(part.exists_probability).toBe(1);
      expect(part.provenance.definitional).toBe(true);
      expect(part.strength.std).toBeLessThan(Math.abs(part.strength.mean) / 2);
      expect(linkDefaultAssumptionsOf(part)).toEqual([]);
    }
    expect(request.graph.edges.find((e: Rec) => e.from === rate.from && e.to === rate.to).strength).toEqual(rate.strength);
  });

  it('absolute additions retain D3 defaults; GraphV3 still rejects zero-std causal carriers', async () => {
    const graph = await replay(draft(UNIT));
    const rate = effectOf(graph);
    expect(rate.provenance.magnitude).toBe('user_stated');
    expect(linkProvenanceOf(rate).origin).toBe('human');
    expect(rate.provenance.natural_effect.amount).toBe(20);
    expect(rate.strength.std).toBeGreaterThan(0);
    expect(rate.exists_probability).toBe(0.8);
    expect(linkDefaultAssumptionsOf(rate)).toHaveLength(2);
    const pointOnly = structuredClone(graph);
    Object.assign(effectOf(pointOnly), { strength: { ...rate.strength, std: 0 }, exists_probability: 1 });
    const parsed = GraphV3.safeParse(pointOnly);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join('.'))).toEqual([
      `edges.${pointOnly.edges.indexOf(effectOf(pointOnly))}.strength.std`,
    ]);
    const request = await runRequest(graph, BRIEF);
    expect(request.graph.nodes.find((n: Rec) => n.kind === 'goal').nonlinear_identity.operation).toBe('sum');
  });

  it('negative: a neighbouring link with the same number cannot supply this link’s authorship', async () => {
    const raw = draft();
    raw.statements.at(-1).subject.to_label = 'Total capacity';
    const graph = await replay(raw, `${BRIEF} Our unrelated queue has 20 tickets.`);
    expect(effectOf(graph).provenance.magnitude).toBe('olumi_placeholder');
  });

  it('negative: a rate with a different driver denominator stays a placeholder', async () => {
    const graph = await replay(draft(`${UNIT} per machine`));
    expect(effectOf(graph).provenance.magnitude).toBe('olumi_placeholder');
  });

  it.each(['parcels per week per specialist', 'tickets per day per specialist'])('negative: a different target numerator (%s) stays a placeholder', async unit => {
    const graph = await replay(draft(unit));
    expect(effectOf(graph).provenance.magnitude).toBe('olumi_placeholder');
  });

  it('the recorded range is independent of the D3 spread and existence assumptions', async () => {
    const original = effectOf(await replay(draft()));
    const brief = BRIEF.replace('10 and 30', '5 and 35');
    const raw = draft();
    Object.assign(raw.statements.at(-1), { low: 5, high: 35, quote: EFFECT.replace('10 and 30', '5 and 35') });
    const changed = effectOf(await replay(raw, brief));
    expect(changed.provenance.natural_effect.stated_range).toEqual({ low: 5, high: 35,
      text: raw.statements.at(-1).quote, end: 'centre' });
    expect(changed.strength).toEqual(original.strength);
    expect(changed.exists_probability).toBe(original.exists_probability);
  });

});
