/**
 * ⛔ A RISK IN THE USER'S OWN WORDS SURVIVES THE SIZE RETRY (BUDDY-A #3327 de1534fd BLOCK; DL-3 06:4xZ): the green core keeps a
 * risk whose reading cannot be verified as human and unverified (`unverified_brief`), but gave it no inference class, so the
 * existing compaction identity guard had nothing to protect and a retry could register the model without it. The producer now
 * classes it as retained user material; its source, authorship and chance are unchanged (the chance only ever via its card).
 * THE PATH: the REAL `buildModelFromBrief` → admission → the existing size + repair retry → the registration port, with scripted
 * drafts (BUDDY-A's probe, ported). 0 provider/engine/DB calls. SYNTHETIC brief.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { assessConstructionSize } from '../construction-size-gate.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { figureTheUserWrote } from '../stated-by-user.js';

type Rec = Record<string, any>;
const RISK = 'Specialist capacity below target';
const BASE = 'Should we keep the current team or add a specialist? Our output today is 80 projects per week. '
  + 'Our target is at least 100 projects per week. The current team has 1 team. Adding a specialist gives us 2 teams.';
const CHANCE = 'There is about a 30% chance that specialist capacity falls below target.';
const BRIEF = `${BASE} ${CHANCE}`;
const entry = (label: string, kind: string, field: string, quote: string, value: number, unit: string) => ({
  subject: { kind, label }, field, quote, form: 'point', value, unit });

/** The drafter's model; `risk` is how it tags the risk and whether the brief's chance sentence is bound to it. */
function draft(risk: { provenance: string; statement: boolean } | null): Rec {
  return {
    goal: { metric: 'Output', operator: '>=', target_stated: true, frame: 'level', value: 100, unit: 'projects per week',
      horizon_months: null, provenance: 'explicit', baseline_known: true, baseline_value: 80, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Current team', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [
        { factor_label: 'Teams', value: 1, unit: 'teams', provenance: 'explicit', value_kind: 'absolute' }] },
      { label: 'Add a specialist', provenance: 'explicit', changes: [], is_status_quo: false, interventions: [
        { factor_label: 'Teams', value: 2, unit: 'teams', provenance: 'explicit', value_kind: 'absolute' }] },
    ],
    factors: [{ label: 'Teams', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'teams', provenance: 'explicit', plausible_max: 4 }],
    risks: risk === null ? [] : [{ label: RISK, provenance: risk.provenance }], outcomes: [], identities: [], unknowns: [],
    decision_question: 'Should we keep the current team or add a specialist?',
    links: [
      { from: 'Teams', to: 'Output', direction: 'positive', provenance: 'inferred', effect_amount: 20, effect_per_source_change: 1,
        effect_provenance: 'ai_proposed', definitional: false },
      ...(risk === null ? [] : [{ from: RISK, to: 'Output', direction: 'negative', provenance: 'inferred', effect_amount: null,
        effect_per_source_change: null, effect_provenance: null, definitional: false }]),
    ],
    statements: [
      entry('Output', 'goal', 'level', 'Our output today is 80 projects per week.', 80, 'projects per week'),
      entry('Output', 'goal', 'target', 'Our target is at least 100 projects per week.', 100, 'projects per week'),
      entry('Teams', 'factor', 'level', 'The current team has 1 team.', 1, 'teams'),
      { ...entry('Current team', 'option', 'level', 'The current team has 1 team.', 1, 'teams'), subject: { kind: 'option', label: 'Current team', factor_label: 'Teams' } },
      { ...entry('Add a specialist', 'option', 'level', 'Adding a specialist gives us 2 teams.', 2, 'teams'), subject: { kind: 'option', label: 'Add a specialist', factor_label: 'Teams' } },
      ...(risk?.statement === true ? [{ subject: { kind: 'risk', label: RISK }, field: 'occurrence', form: 'point', quote: CHANCE, value: 30, unit: '%' }] : []),
    ],
  };
}
/** Over the existing 18-node cap: fourteen context factors Olumi proposed. */
function oversized(base: Rec): Rec {
  const model = structuredClone(base);
  for (let i = 0; i < 14; i += 1) {
    const label = `Additional context ${i}`;
    model.factors.push({ label, role: 'external', baseline_known: false, baseline_value: 1, unit: 'projects per week', provenance: 'ai_proposed', plausible_max: 10 });
    model.links.push({ from: label, to: 'Output', direction: 'positive', provenance: 'ai_proposed', effect_amount: 1, effect_per_source_change: 1,
      effect_provenance: 'ai_proposed', definitional: false });
  }
  return model;
}
/** The real build: first draft, then the size retry's draft; every registration request is recorded, nothing is sent. */
async function build(first: Rec, retry: Rec) {
  const writes: Rec[] = [];
  let calls = 0;
  const result = await buildModelFromBrief('66666666-6666-4666-8666-666666666666', BRIEF,
    (async (path: string, body: Rec) => {
      if (path.endsWith('/graph/register')) { writes.push(structuredClone(body)); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    }) as never,
    (async () => { calls += 1; return { text: JSON.stringify(calls === 1 ? first : retry) }; }) as never) as Rec;
  return { result, writes, risks: writes.flatMap((w) => ((w.graph?.nodes ?? []) as Rec[]).filter((n) => n.kind === 'risk')) };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('a risk in the user’s own words survives the size retry', () => {
  it('precondition: the first draft is over the cap and the user’s chance sentence keeps the risk human and unverified', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No provider, engine or DB network'); }));
    const first = oversized(draft({ provenance: 'explicit', statement: true }));
    const admitted = admitCandidateModel(first as CandidateModel, {}, BRIEF, (v, u) => figureTheUserWrote(v, u, BRIEF));
    expect(assessConstructionSize(admitted).within).toBe(false);
    const risk = admitted.nodes.find((n) => n.kind === 'risk')!;
    expect(risk.provenance).toBe('unverified_brief');
    expect(admitted.inference_classes[risk.id]).toBe('brief_stated');
  });

  it('⭐ GREEN: the retry sheds Olumi’s fourteen context factors and keeps the risk: ONE registration, the risk human/unverified, no chance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No provider, engine or DB network'); }));
    const { result, writes, risks } = await build(oversized(draft({ provenance: 'explicit', statement: true })), draft({ provenance: 'explicit', statement: true }));
    expect(result.ok, JSON.stringify(result).slice(0, 800)).toBe(true);
    expect(writes).toHaveLength(1);
    expect(risks).toEqual([expect.objectContaining({ label: RISK, provenance: 'unverified_brief' })]);
    expect(risks[0]!.provenance).not.toBe('from_brief');
    expect(risks[0]!.event_risk).toBeUndefined();
  });

  it('⛔ RED → GREEN: a retry that also drops the user’s risk registers nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No provider, engine or DB network'); }));
    const { result, writes } = await build(oversized(draft({ provenance: 'explicit', statement: true })), draft(null));
    expect(writes, JSON.stringify(result).slice(0, 800)).toHaveLength(0);
    // The retry was refused for shedding the user's material, not a failed build: the size refusal after a retry, with the risk
    // counted among what the user said.
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large', retried: true, from_your_brief: 6, added_beyond_brief: 14 });
  });

  it('⛔ CONTRAST: a risk Olumi proposed is still sheddable — the same retry without it registers, as before', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No provider, engine or DB network'); }));
    const { result, writes, risks } = await build(oversized(draft({ provenance: 'ai_proposed', statement: false })), draft(null));
    expect(result.ok, JSON.stringify(result).slice(0, 800)).toBe(true);
    expect(writes).toHaveLength(1);
    expect(risks).toEqual([]);
  });

  // The size refusal's own reader (BUDDY-A #3350 B1): a risk Olumi read out of the brief is Olumi's, but it is not what Olumi
  // added beyond the brief; only the widening is counted there. The pair differs only in the drafter's AI tag.
  it('⛔ RED → GREEN: a risk Olumi read out of the brief is not counted as "added beyond the brief" in the size refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No provider, engine or DB network'); }));
    const tooBig = oversized(draft({ provenance: 'inferred', statement: false }));
    const { result, writes } = await build(tooBig, tooBig);
    expect(writes, JSON.stringify(result).slice(0, 800)).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large', retried: true, added_beyond_brief: 14 });
  });

  it('⛔ CONTRAST: a risk Olumi added beyond the brief is counted there, beside its fourteen context factors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No provider, engine or DB network'); }));
    const tooBig = oversized(draft({ provenance: 'ai_proposed', statement: false }));
    const { result, writes } = await build(tooBig, tooBig);
    expect(writes, JSON.stringify(result).slice(0, 800)).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large', retried: true, added_beyond_brief: 15 });
  });

  // The green core's own rule, unchanged here: a drafter's "explicit" tag with no words of the user's behind it is not the user's.
  it('⛔ CONTRAST: a risk merely tagged "explicit", with no words of the user’s behind it, stays Olumi’s and sheddable', () => {
    const first = oversized(draft({ provenance: 'explicit', statement: false }));
    const admitted = admitCandidateModel(first as CandidateModel, {}, BASE, (v, u) => figureTheUserWrote(v, u, BASE));
    const risk = admitted.nodes.find((n) => n.kind === 'risk')!;
    expect(risk.provenance).toBe('ai_inferred');
    expect(admitted.inference_classes[risk.id]).toBe('model_proposed');
  });

  // Only the user's own words are protected: a claimed sentence the brief does not hold leaves the risk's origin unknown.
  it('⛔ CONTRAST: a chance sentence the brief does not hold leaves the risk unclassified (origin unknown), never protected as the user’s', () => {
    const first = oversized(draft({ provenance: 'explicit', statement: true }));
    const admitted = admitCandidateModel(first as CandidateModel, {}, BASE, (v, u) => figureTheUserWrote(v, u, BASE));
    const risk = admitted.nodes.find((n) => n.kind === 'risk')!;
    expect(risk.provenance).not.toBe('unverified_brief');
    expect(admitted.inference_classes[risk.id]).toBeUndefined();
  });
});
