/**
 * ⭐ A COUNT IS NOT A SWITCH (AIE count-versus-switch ruling 9bd1d08c, 19 Oct; first loss `prompt/COUNT-FRAME/FIRST-LOSS.md`).
 *
 * Served capacity (CEE 390a1dbe): "Additional specialists" held 0 today and 1 under its option, so admission gave it no frame
 * (`largest <= 1`), `isSwitch` read frame 1 with levels {0, 1} as a 0/1 switch, its link said "per switch", and the card
 * refused 2 ("must be between 0 and 1 on the model scale"). A count's 0, 1 and 2 are counts.
 *
 * A factor is bound as a count only POSITIVELY, by a quantity stated per ONE of its own unit:
 *  · the user's stated size on a link out of it, validated per one source unit by the stated-effect reader
 *    (`statedEffectQuoteMatches`, "each additional packer ships about 30 orders a day"), in a sentence of the brief; or
 *  · a product whose other operand's unit has this unit as its denominator (orders per packer per day × packers).
 * It then gets the existing defaulted reference (10 above one unit) as a DISCLOSED computational scale on the capless carrier
 * (`scale_frame` and the framed pair), never a cap: a later 12 is not refused. Raw levels and the per-unit law are unchanged.
 * Nothing else moves: a switch, and a 0/1 factor whose meaning nothing states, keep today's bytes. Synthetic warehouse brief.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { mergeAppliedGraphForPersistence } from '../../handlers/edit-graph-dispatch.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { prepareOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { normaliseFactorValue } from '../../tools/handlers/d1-shared/normalise-factor-value.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';

type Rec = Record<string, any>;

const EACH = 'Each additional packer ships about 30 orders a day, between 20 and 40.';
const BRIEF = 'Our warehouse ships 400 orders a day today and we need at least 460 a day by the end of next month. '
  + `We can add one packer or keep the team as it is. ${EACH}`;

const set = (factor_label: string, value: number, unit: string) => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'explicit' });
const goal = { kind: null, deliverable: null, metric: 'Orders shipped per day', operator: '>=', target_stated: true, frame: 'level', value: 460,
  unit: 'orders a day', horizon_months: null, provenance: 'explicit', baseline_known: true, baseline_value: 400, baseline_provenance: 'explicit', scope: null };
const keep = { label: 'Keep the team as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] };

/** The served shape, in warehouse words: a count the option sets to 1, sized by the user per ONE of it. */
function perOne(over: { quote?: string | null; unit?: string; label?: string; level?: number } = {}): Rec {
  const label = over.label ?? 'Additional packers';
  const unit = over.unit ?? 'packers';
  return {
    goal, constraints: [],
    options: [{ label: 'Add one packer', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set(label, over.level ?? 1, unit)] }, keep],
    factors: [{ label, role: 'controllable', baseline_known: true, baseline_value: 0, unit, provenance: 'inferred', plausible_max: null }],
    risks: [], outcomes: [],
    links: [{ from: label, to: 'Orders shipped per day', direction: 'positive', provenance: 'explicit', effect_amount: 30, effect_per_source_change: 1,
      effect_provenance: over.quote === null ? 'inferred' : 'explicit', definitional: null, basis: null, source_quote: over.quote === undefined ? EACH : over.quote }],
    identities: [], unknowns: [], decision_question: null,
  };
}

/** The K1 drafter's product shape (`drafts.json` "one", in warehouse words): packers × orders per packer per day. */
function product(): Rec {
  return {
    goal, constraints: [],
    options: [{ label: 'Add one packer', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('New packers', 1, 'packers')] }, keep],
    factors: [
      { label: 'New packers', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'packers', provenance: 'inferred', plausible_max: null },
      { label: 'Orders per packer per day', role: 'observable', baseline_known: true, baseline_value: 30, unit: 'orders/packer/day', provenance: 'explicit', plausible_max: null },
    ],
    risks: [], outcomes: [{ label: 'Extra orders per day', provenance: 'inferred', unit: 'orders/day', plausible_max: null }],
    links: [
      { from: 'New packers', to: 'Extra orders per day', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
      { from: 'Orders per packer per day', to: 'Extra orders per day', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
      { from: 'Extra orders per day', to: 'Orders shipped per day', direction: 'positive', provenance: 'inferred', effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'inferred', definitional: null, basis: 'Each extra order shipped adds one to the daily total.', source_quote: null },
    ],
    identities: [{ outcome: 'Extra orders per day', operation: 'product', factors: ['New packers', 'Orders per packer per day'], provenance: 'inferred', reading: null, evidence: null }],
    unknowns: [], decision_question: null,
  };
}

async function build(wire: Rec, brief = BRIEF): Promise<{ g: Rec; node: (label: string) => Rec; edge: (from: string, to: string) => Rec; repairs: Rec[] }> {
  let registered: Rec | null = null;
  let n = 0;
  const call = (async () => { n += 1; return { text: n === 1 ? JSON.stringify(wire) : JSON.stringify({ options: [], risks: [] }) }; }) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('c0c0c0c0-0000-4000-8000-00000000c0c0', brief, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 800)).toBe(true);
  const g = registered! as Rec;
  const node = (label: string) => (g.nodes as Rec[]).find((x) => x.label === label)!;
  const edge = (from: string, to: string) => (g.edges as Rec[]).find((e) => e.from === node(from).id && e.to === node(to).id)!;
  return { g, node, edge, repairs: (out.repairs ?? out.result?.repairs ?? []) as Rec[] };
}
const option = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((x) => x.kind === 'option' && x.label === label)!;

const SWITCH = 'Opening an express lane would ship about 50 more orders a day.';
const SWITCH_BRIEF = 'Our warehouse ships 400 orders a day today and we need at least 460 a day by the end of next month. '
  + `We can open an express lane or keep the team as it is. ${SWITCH}`;
const STAFF = 'Adding packing staff would ship about 30 more orders a day.';
const STAFF_BRIEF = BRIEF.replace(EACH, STAFF);

/** The canvas save of one option's level on the model scale, through the existing writer and persistence projection. */
function saved(g: Rec, optionLabel: string, factorLabel: string, modelValue: number): Rec {
  const G = GraphV3.parse(g);
  const optionId = option(g, optionLabel).id;
  const factorId = (g.nodes as Rec[]).find((x) => x.label === factorLabel)!.id;
  const r = prepareOptionInterventionEdit({ persistedGraph: G, optionId, factorId, modelValue, expectedGraphHash: computeAnalysisAffectingGraphHash(G)! });
  expect(r.kind, JSON.stringify(r)).toBe('prepared');
  if (r.kind !== 'prepared') throw new Error('not prepared');
  const ops = parseEditGraphResponse(JSON.stringify({ operations: [r.operation], removed_edges: [], warnings: [], coaching: null })).operations as PatchOperation[];
  const encoded = encodeOptionInterventionsForEdit(applyPatchOperations(G, ops), new Set([optionId]));
  const merged = mergeAppliedGraphForPersistence({ appliedGraph: encoded.graph, persistedBase: G, ingressBase: G, scenarioId: 's', requestId: 'r' });
  return JSON.parse(JSON.stringify(projectGraphForPersistence(merged))) as Rec;
}

/** A cold reopen of the saved bytes, then a Run: the request the engine is sent. */
async function coldRunRequest(bytes: string, brief: string): Promise<Rec> {
  const SID = 'c0c0c0c0-0000-4000-8000-00000000c0c1';
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'count-reopen', {
    loadGraphAndBriefText: async () => ({ graph: JSON.parse(bytes), briefText: brief, revision: 2 }),
    readMostRecentPendingActions: async () => [],
  } as never);
  const fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-minimal.json', import.meta.url), 'utf8')) as Rec;
  let request: Rec | null = null;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run: async (q: Rec) => { request = q; return fixture; }, validatePatch: async () => {} } } as never);
  await handler({ payload: { scenario_id: SID, turn_id: 'count-reopen' }, requestId: 'count-reopen', signal: new AbortController().signal,
    context: {}, orientationText: '' } as never);
  expect(request, 'the Run reached the engine').not.toBeNull();
  return request!;
}

const COUNT_WORDS = 'No range was stated for "Additional packers", which counts packers, so a range of 0 to 10 has been used to read it. '
  + 'That is a unit of measurement, not a forecast or a limit on the count, and your own figures are stored unchanged beside it.';

describe('a count is not a switch: 0, 1 and 2 are counts', () => {
  it('⭐ RED→GREEN (served shape): a count sized per ONE of it gets a frame of 10, capless, and its link stays per packer', async () => {
    const { g, node, edge } = await build(perOne());
    const packers = node('Additional packers');
    expect(packers.scale_frame).toBe(10);
    expect(packers.observed_state).toMatchObject({ value: 0, raw_value: 0, unit: 'packers' });
    expect(packers.observed_state).not.toHaveProperty('cap');
    // The option's raw 1 is kept, read on the same frame.
    expect(option(g, 'Add one packer').interventions[packers.id]).toMatchObject({ value: 0.1, raw_value: 1, unit: 'packers' });
    // The per-packer law is unchanged: 30 orders a day per ONE packer, never per switch; β = (30 / goal frame) / (1 / 10).
    const goalFrame = node('Orders shipped per day').observed_state.cap as number;
    const users = edge('Additional packers', 'Orders shipped per day');
    expect(users.provenance.natural_effect).toMatchObject({ amount: 30, per_source_change: 1, per_source_change_unit: 'packers' });
    expect(users.strength.mean).toBeCloseTo((30 / goalFrame) / (1 / 10), 12);
  });

  it('⭐ RED→GREEN (K1 product shape): packers × orders per packer per day binds the packers as a count', async () => {
    const { node } = await build(product());
    expect(node('New packers').scale_frame).toBe(10);
    expect(node('New packers').observed_state).not.toHaveProperty('cap');
  });

  it('the scale is said once, as Olumi\'s unit of measurement and never a limit', () => {
    const loss = admitCandidateModel(perOne() as unknown as CandidateModel, {}, BRIEF).loss.filter((e) => e.field_path.includes('additional_packers'));
    expect(loss.filter((e) => e.field_path.endsWith('.scale_frame')).map((e) => [e.after, e.reason])).toEqual([[10, COUNT_WORDS]]);
    expect(loss.filter((e) => e.field_path.endsWith('.observed_state.cap'))).toEqual([]);
  });

  it('a bound count already set to 2 is read on the same capless scale (the scale is never a cap, whatever the levels)', async () => {
    const { node } = await build(perOne({ level: 2 }));
    expect(node('Additional packers').scale_frame).toBe(10);
    expect(node('Additional packers').observed_state).not.toHaveProperty('cap');
  });

  it('NEVER A CAP: the saved count takes a later 12 on its own carrier; CONTRAST: the same level against a cap of 10 is refused', async () => {
    const os = (await build(perOne())).node('Additional packers');
    const edit = (factorCap?: number) => () => normaliseFactorValue({ rawInput: 12, unit: 'packers', factorUnit: 'packers', inputHasUnit: true,
      factorObservedValue: os.observed_state.value, factorObservedRawValue: os.observed_state.raw_value,
      ...(factorCap !== undefined ? { factorCap } : { factorScaleFrame: os.scale_frame, ...(os.observed_state.cap !== undefined ? { factorCap: os.observed_state.cap } : {}) }) } as never);
    expect(edit()()).toEqual({ raw_value: 12, value: 1.2 });
    expect(edit(10)).toThrow(/above an unconfirmed limit of 10 packers/);
  });

  it('CONTROL (genuine switch): a state with no figure per one of it keeps today\'s bytes: no frame, no cap, per switch', async () => {
    const wire = perOne({ label: 'Express lane', unit: 'open', quote: SWITCH });
    wire.options[0].label = 'Open an express lane';
    wire.links[0].effect_amount = 50;
    const { node, edge } = await build(wire, SWITCH_BRIEF);
    expect(node('Express lane')).not.toHaveProperty('scale_frame');
    expect(node('Express lane').observed_state ?? {}).not.toHaveProperty('cap');
    expect(edge('Express lane', 'Orders shipped per day').provenance.natural_effect).toMatchObject({ per_source_change_unit: 'switch' });
  });

  it.each([
    ['Olumi\'s own size (no sentence of the brief)', perOne({ quote: null }), BRIEF],
    ['a sentence that counts no packer', perOne({ quote: STAFF }), STAFF_BRIEF],
  ])('UNRESOLVED (%s): nothing states a figure per one packer, so no scale is invented and nothing is said', async (_, wire, brief) => {
    const { node } = await build(wire, brief);
    expect(node('Additional packers')).not.toHaveProperty('scale_frame');
    expect(node('Additional packers').observed_state ?? {}).not.toHaveProperty('cap');
    const loss = admitCandidateModel(wire as unknown as CandidateModel, {}, brief).loss;
    expect(loss.filter((e) => e.reason.includes('which counts'))).toEqual([]);
  });

  it('⭐ SAVE → READBACK → COLD REOPEN: 2 packers is saved as 2, reopened as 2 and sent to the engine as 2, on the same per-packer law', async () => {
    const { g, edge } = await build(perOne());
    const before = edge('Additional packers', 'Orders shipped per day');
    const after = saved(g, 'Add one packer', 'Additional packers', 0.2);
    const packers = (after.nodes as Rec[]).find((x) => x.label === 'Additional packers')!;
    expect(option(after, 'Add one packer').interventions[packers.id]).toMatchObject({ value: 0.2, raw_value: 2, unit: 'packers', source: 'user_specified' });
    const bytes = JSON.stringify(GraphV3.parse(after));
    const request = await coldRunRequest(bytes, BRIEF);
    expect((request.options as Rec[]).map((o) => [o.label, o.interventions[packers.id]]))
      .toEqual([['Add one packer', 2], ['Keep the team as it is', 0]]);
    const sent = (request.graph.nodes as Rec[]).find((x) => x.id === packers.id)!;
    expect(sent.scale_frame).toBe(10);
    expect(sent.observed_state).not.toHaveProperty('cap');
    const sentEdge = (request.graph.edges as Rec[]).find((e) => e.from === packers.id && e.to === before.to)!;
    expect(sentEdge.strength.mean).toBe(before.strength.mean);
    expect(sentEdge.provenance.natural_effect).toMatchObject({ amount: 30, per_source_change: 1, per_source_change_unit: 'packers' });
  });
});
