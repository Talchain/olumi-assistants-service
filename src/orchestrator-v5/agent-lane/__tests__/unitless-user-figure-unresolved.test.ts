/**
 * ⭐ AIE W27 (17 Oct 22:03Z, 23:45Z): a user's figure with no unit has no established scale, and a definition of what it measures
 * gives its meaning, never its encoding. Measured first loss (CONTRACT-A trace, P09 part 1): admission framed such a figure 0–100
 * (`cap 100`, `unit_interval`, 0.45) and stamped it `cee_inference`. Now it keeps the figure exactly, unresolved; only what is
 * missing is asked through construction's existing ask (`.magnitude_question` → `open_questions`); and the Run's existing scale
 * hold (`baseline_scale_unresolved` / FACTOR_LEVEL_SCALE_UNRESOLVED) also covers every setting on it (BUDDY-A #3378 B1: an Olumi
 * 70 used to clear it). A figure with its unit or encoding supplied is admitted and computes exactly as before. Synthetic brief;
 * served through `buildModelFromBrief` → `/graph/register` → GraphV3 cold read → canonical readiness → the prepared Run request.
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { findScaleIncoherentBaselineFactorIds } from '../../tools/plot-intervention-scale.js';
import { valueProvenanceOf } from '../../../cee/provenance/provenance-of.js';

type Rec = Record<string, any>;
const SID = '31313131-3131-4131-8131-313131313131';
const UNITLESS = 'Our queue strain index is 45, and nobody has said what unit it is in.';
const WITH_UNIT = 'Our queue strain index is 45 points.';
const PERCENT = 'Our queue strain index is 45%.';
const DEFINED = 'The queue strain index is the share of next week\'s appointment slots already booked.';
const SETTING = 'Evening appointments would bring the queue strain index to 70 points.';
const QUESTION = 'Olumi holds 45 for “Queue strain index”, with its meaning or scale unresolved. What does this figure measure, and what scale, if any, does it use?';
const ID = 'queue_strain_index';
const statement = (quote: string, subject: Rec, field: string, form: string, value: number | null, unit: string | null): Rec =>
  ({ quote, subject: { kind: 'factor', to_label: null, factor_label: null, ...subject }, field, form, value, low: null, high: null, unit, qualifier: null, conditions: null });
const QSI = { label: 'Queue strain index' };

type Row = { level?: string; unit?: string; definition?: boolean; setting?: 'olumi' | 'stated' };
// The definition sentence is always in the brief; whether the draft binds it to the factor (a verified `measure` statement) varies.
const briefOf = (o: Row): string => `We are deciding whether to open evening appointments at the clinic. ${o.level ?? UNITLESS} ${DEFINED} `
  + 'We see 300 patients a week today and want to see at least 400 patients a week within 12 months. '
  + `Evening appointments would add 40 slots a week.${o.setting === 'stated' ? ` ${SETTING}` : ''}`;

function wire(o: Row): Rec {
  const unit = o.unit ?? null;
  return {
    goal: { metric: 'Patients seen per week', operator: '>=', target_stated: true, frame: 'level', value: 400, unit: 'patients per week',
      horizon_months: 12, provenance: 'explicit', baseline_known: true, baseline_value: 300, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Keep daytime hours only', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Open evening appointments', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Evening slots', value: 40, value_kind: 'absolute', unit: 'slots per week', provenance: 'explicit' },
          // BUDDY-A's counterexample: Olumi's 70, written nowhere in the brief; or the user's own stated setting, in its unit.
          ...(o.setting === undefined ? [] : [{ factor_label: 'Queue strain index', value: 70, value_kind: 'absolute', unit: unit ?? '',
            provenance: o.setting === 'olumi' ? 'ai_proposed' : 'explicit' }])] },
    ],
    factors: [
      { label: 'Queue strain index', role: 'observable', baseline_known: true, baseline_value: 45, unit, provenance: 'explicit', plausible_max: 100 },
      { label: 'Evening slots', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'slots per week', provenance: 'explicit', plausible_max: 200 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Evening slots', to: 'Patients seen per week', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Queue strain index', to: 'Patients seen per week', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    ],
    identities: [], unknowns: [], decision_question: null,
    statements: [
      statement(o.level ?? UNITLESS, QSI, 'level', 'point', 45, unit),
      ...(o.definition === true ? [statement(DEFINED, QSI, 'measure', 'describes', null, null)] : []),
      ...(o.setting === 'stated' ? [statement(SETTING, { kind: 'option', label: 'Open evening appointments', factor_label: 'Queue strain index' }, 'level', 'point', 70, unit)] : []),
      statement('Evening appointments would add 40 slots a week.', { label: 'Evening slots' }, 'level', 'point', 40, 'slots per week'),
    ],
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
async function build(o: Row = {}): Promise<{ graph: Rec; out: Rec; brief: string }> {
  const draft = wire(o);
  const brief = briefOf(o);
  expect(strict(draft), JSON.stringify(strict.errors)).toBe(true);
  let graph: Rec | undefined;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call = (async () => ({ text: JSON.stringify(draft) })) as unknown as CallStructuredModel;
  const out = await buildModelFromBrief(SID, brief, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 2000)).toBe(true);
  return { graph: graph!, out, brief };
}

/** The saved graph read cold, as readiness says it and as the Run prepares its request, stopped before the engine. */
async function prepared(graph: Rec, brief: string): Promise<{ mayRun: unknown; held?: Rec; request?: Rec }> {
  const cold = GraphV3.parse(JSON.parse(JSON.stringify(graph)));
  const canonical = await createAgentCapabilities((async () => ({ status: 200, json: { graph: cold, graph_hash: 'cold' } })) as never, new ProposalStore())
    .getCanonicalState({ scenario_id: SID, authenticated_user_id: null, request_id: 'cold', user_text: 'What is known?', user_turn_text: 'What is known?' } as never) as Rec;
  let snapshot: unknown;
  let held: Rec | undefined;
  try {
    snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'cold', { loadGraphAndBriefText: async () => ({ graph: cold, briefText: brief }),
      readMostRecentPendingActions: async () => [] } as never);
  } catch (e) { held = e as Rec; }
  let request: Rec | undefined;
  let engineCalls = 0;
  if (snapshot !== undefined) {
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run: async () => { engineCalls++; throw Error('ENGINE'); }, validatePatch: async () => { throw Error('ENGINE'); } },
      probe: async (v: Rec) => { request = v.plotPayload; throw Error('STOP_AFTER_REQUEST'); } } as never);
    try {
      await handler({ payload: { scenario_id: SID, turn_id: 'cold', kind: 'message', message: 'Run analysis.' }, requestId: 'cold',
        signal: new AbortController().signal, context: {}, orientationText: '' } as never);
    } catch { /* stopped at the request */ }
  }
  expect(engineCalls).toBe(0);
  return { mayRun: canonical.readiness?.may_run, held, request };
}
const node = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === ID);
const asked = (out: Rec): string[] => (out.open_questions ?? []).filter((q: string) => q.includes('scale, if any, does it use?'));
const heldOn = (held: Rec | undefined): unknown[] => (held?.verdict?.issues ?? []).map((i: Rec) => [i.code, i.factor_id]);

describe('W27: a user figure with no unit or encoding stays unresolved, out of every calculation, and only what is missing is asked', () => {
  it('RED on base: the figure is kept as written, unresolved — no frame, cap, unit_interval or Olumi stamp; out of the Run; asked once', async () => {
    const { graph, out } = await build();
    const n = node(graph);
    expect(n.observed_state).toEqual({ value: 45, user_material_unverified: true });
    expect(n.scale_frame).toBeUndefined();
    // Still the user's material, role unverified: never relabelled Olumi's.
    expect(valueProvenanceOf(n.observed_state)).toMatchObject({ origin: 'human', role: 'unverified' });
    // Held out of the Run by the Run's own scale gate, which names exactly this factor.
    expect(findScaleIncoherentBaselineFactorIds(graph.nodes, [])).toEqual([ID]);
    // The factor and its link stay in the model.
    expect(graph.edges.some((e: Rec) => e.from === ID && e.to === 'patients_seen_per_week')).toBe(true);
    // The one missing meaning, asked once (AIE 23:45Z words); the known figure is never re-requested.
    expect(asked(out)).toEqual([QUESTION]);
  });

  it('(a) RED at 9ddf9676 (BUDDY-A B1): Olumi\'s 70 on the unresolved figure does not clear the hold — readiness refuses and no request carries 45 or 70', async () => {
    const { graph, brief } = await build({ setting: 'olumi' });
    expect(node(graph).observed_state).toEqual({ value: 45, user_material_unverified: true });
    const run = await prepared(graph, brief);
    expect(run.mayRun).toBe(false);
    expect(heldOn(run.held)).toContainEqual(['FACTOR_LEVEL_SCALE_UNRESOLVED', ID]);
    expect(run.request).toBeUndefined();
  });

  it('(b) contrast: the user\'s own setting in a stated unit on a figure with its unit still reaches the Run request', async () => {
    const { graph, brief } = await build({ level: WITH_UNIT, unit: 'points', setting: 'stated' });
    const run = await prepared(graph, brief);
    expect(run.held).toBeUndefined();
    expect(run.mayRun).toBe(true);
    const evening = (run.request?.options ?? []).find((o: Rec) => o.id === 'open_evening_appointments' || o.option_id === 'open_evening_appointments');
    expect(evening?.interventions?.[ID]).toBe(70);
  });

  it('RED at 9ddf9676 (BUDDY-A B2): a definition alone gives the meaning, not the encoding — unresolved, and the signed question is asked', async () => {
    const { graph, out, brief } = await build({ definition: true });
    expect(node(graph).observed_state).toEqual({ value: 45, user_material_unverified: true });
    expect(node(graph).scale_frame).toBeUndefined();
    expect(asked(out)).toEqual([QUESTION]);
    const run = await prepared(graph, brief);
    expect(run.mayRun).toBe(false);
    expect(run.request).toBeUndefined();
  });

  it('contrast: a definition WITH its encoding supplied (45%) is framed as before, computes, and nothing is asked', async () => {
    const { graph, out, brief } = await build({ level: PERCENT, unit: '%', definition: true });
    expect(node(graph).observed_state).toMatchObject({ value: 0.45, raw_value: 45, cap: 100, declared_scale: 'unit_interval', unit: '%' });
    expect(asked(out)).toEqual([]);
    const run = await prepared(graph, brief);
    expect(run.held).toBeUndefined();
    expect(run.request).toBeDefined();
  });

  it('a figure WITH a unit is admitted exactly as before, and nothing is asked', async () => {
    const { graph, out } = await build({ level: WITH_UNIT, unit: 'points' });
    expect(node(graph).observed_state).toEqual({ value: 0.45, raw_value: 45, cap: 100, declared_scale: 'unit_interval', unit: 'points',
      source: 'brief_extraction', extractionType: 'explicit' });
    expect(findScaleIncoherentBaselineFactorIds(graph.nodes, [])).toEqual([]);
    expect(asked(out)).toEqual([]);
  });
});
