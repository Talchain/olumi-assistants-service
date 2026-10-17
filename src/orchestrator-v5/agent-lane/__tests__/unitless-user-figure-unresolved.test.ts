/**
 * ⭐ AIE W27 (17 Oct 22:03Z): a user's figure with no unit and no definition of what it measures has no established scale.
 * Measured first loss (CONTRACT-A trace, P09 part 1): admission framed such a figure 0–100 (`cap 100`, `unit_interval`, 0.45)
 * and stamped it `cee_inference`. Now it keeps the figure exactly, unresolved, and the one missing meaning is asked through
 * construction's existing ask (`.magnitude_question` → `open_questions`). A dimensionless figure WITH a supplied definition and
 * a figure WITH a unit are admitted exactly as before. Synthetic brief; served through `buildModelFromBrief` → `/graph/register`.
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { findScaleIncoherentBaselineFactorIds } from '../../tools/plot-intervention-scale.js';
import { valueProvenanceOf } from '../../../cee/provenance/provenance-of.js';

type Rec = Record<string, any>;
const UNITLESS = 'Our queue strain index is 45, and nobody has said what unit it is in.';
const WITH_UNIT = 'Our queue strain index is 45 points.';
const DEFINED = 'The queue strain index is the share of next week\'s appointment slots already booked.';
const QUESTION = '"Queue strain index" is recorded as 45. What does this figure measure, and what scale, if any, does it use?';
const ID = 'queue_strain_index';
const statement = (quote: string, label: string, field: string, form: string, value: number | null, unit: string | null): Rec =>
  ({ quote, subject: { kind: 'factor', label, to_label: null, factor_label: null }, field, form, value, low: null, high: null, unit, qualifier: null, conditions: null });
const briefWith = (level: string): string => `We are deciding whether to open evening appointments at the clinic. ${level} ${DEFINED} `
  + 'We see 300 patients a week today and want to see at least 400 patients a week within 12 months. Evening appointments would add 40 slots a week.';

function wire(o: { unit?: string; definition?: boolean } = {}): Rec {
  return {
    goal: { metric: 'Patients seen per week', operator: '>=', target_stated: true, frame: 'level', value: 400, unit: 'patients per week',
      horizon_months: 12, provenance: 'explicit', baseline_known: true, baseline_value: 300, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Keep daytime hours only', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Open evening appointments', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Evening slots', value: 40, value_kind: 'absolute', unit: 'slots per week', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Queue strain index', role: 'observable', baseline_known: true, baseline_value: 45, unit: o.unit ?? null, provenance: 'explicit', plausible_max: 100 },
      { label: 'Evening slots', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'slots per week', provenance: 'explicit', plausible_max: 200 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Evening slots', to: 'Patients seen per week', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Queue strain index', to: 'Patients seen per week', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    ],
    identities: [], unknowns: [], decision_question: null,
    statements: [
      statement(o.unit === undefined ? UNITLESS : WITH_UNIT, 'Queue strain index', 'level', 'point', 45, o.unit ?? null),
      ...(o.definition === true ? [statement(DEFINED, 'Queue strain index', 'measure', 'describes', null, null)] : []),
      statement('Evening appointments would add 40 slots a week.', 'Evening slots', 'level', 'point', 40, 'slots per week'),
    ],
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
async function build(draft: Rec, brief: string): Promise<{ graph: Rec; out: Rec }> {
  expect(strict(draft), JSON.stringify(strict.errors)).toBe(true);
  let graph: Rec | undefined;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call = (async () => ({ text: JSON.stringify(draft) })) as unknown as CallStructuredModel;
  const out = await buildModelFromBrief('31313131-3131-4131-8131-313131313131', brief, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 2000)).toBe(true);
  return { graph: graph!, out };
}
const node = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === ID);
const asked = (out: Rec): string[] => (out.open_questions ?? []).filter((q: string) => q.includes('What does this figure measure'));

describe('W27: a user figure with no unit and no definition stays unresolved, and only its meaning is asked', () => {
  it('RED on base: the figure is kept as written, unresolved — no frame, cap, unit_interval or Olumi stamp; out of the Run; asked once', async () => {
    const { graph, out } = await build(wire(), briefWith(UNITLESS));
    const n = node(graph);
    expect(n.observed_state).toEqual({ value: 45, user_material_unverified: true });
    expect(n.scale_frame).toBeUndefined();
    // Still the user's material, role unverified: never relabelled Olumi's.
    expect(valueProvenanceOf(n.observed_state)).toMatchObject({ origin: 'human', role: 'unverified' });
    // Held out of the Run by the Run's own scale gate, which names exactly this factor.
    expect(findScaleIncoherentBaselineFactorIds(graph.nodes, [])).toEqual([ID]);
    // The factor and its link stay in the model.
    expect(graph.edges.some((e: Rec) => e.from === ID && e.to === 'patients_seen_per_week')).toBe(true);
    // The one missing meaning, asked once; the known figure is never re-requested.
    expect(asked(out)).toEqual([QUESTION]);
  });

  it('a dimensionless index WITH a supplied definition is admitted as before, and nothing is asked', async () => {
    const { graph, out } = await build(wire({ definition: true }), briefWith(UNITLESS));
    expect(node(graph).observed_state).toEqual({ value: 0.45, raw_value: 45, cap: 100, declared_scale: 'unit_interval',
      source: 'cee_inference', extractionType: 'inferred', user_material_unverified: true });
    expect(asked(out)).toEqual([]);
  });

  it('a figure WITH a unit is admitted exactly as before, and nothing is asked', async () => {
    const { graph, out } = await build(wire({ unit: 'points' }), briefWith(WITH_UNIT));
    expect(node(graph).observed_state).toEqual({ value: 0.45, raw_value: 45, cap: 100, declared_scale: 'unit_interval', unit: 'points',
      source: 'brief_extraction', extractionType: 'explicit' });
    expect(findScaleIncoherentBaselineFactorIds(graph.nodes, [])).toEqual([]);
    expect(asked(out)).toEqual([]);
  });
});
