/**
 * ⭐ A SWITCH THE OPTIONS TURN ON IS OFF TODAY — OLUMI'S 0, KEPT AND LABELLED (DL #72 5864452374, journey A on served
 * `f217dea`, `pj-20260928T060545Z`).
 *
 * "Pro feature release delivered" (a 0/1 switch every option acts on) reached the graph with NO `observed_state`, and
 * ranked #2 in sensitivity at the final Run as an unvalued driver (PJ-B3). The drafter gave it today-0 on its 0..1
 * frame, as Olumi's estimate; `estimatedObservedState` dropped every estimate on a frame of 1 or less, and because the
 * candidate still carried a number, `findCoverageGaps` saw no gap and spent no retry. A KNOWN baseline on the same frame
 * was already kept as-is (`framedObservedState`: "already a proportion"). Now an ESTIMATE on a frame of 1 or less, within
 * [0, 1], is kept the same way — stamped Olumi's (`cee_inference`, `extractionType: 'inferred'`), never the user's.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const BRIEF = 'We need to reach £100k MRR within 12 months, from £75k today, while keeping monthly churn under 4%. '
  + 'Should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const link = (from: string, to: string, direction: 'positive' | 'negative') =>
  ({ from, to, direction, provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const iv = (factor_label: string, value: number, unit: string, provenance = 'ai_proposed') => ({ factor_label, value, value_kind: 'absolute' as const, unit, provenance });

function draft(release: { baseline_value: number | null; plausible_max: number; known?: boolean }) {
  return {
    goal: { metric: 'MRR', operator: '>=', target_stated: true, frame: 'level', value: 100000, unit: 'GBP', horizon_months: 12, provenance: 'explicit', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Monthly churn rate', operator: '<', value: 4, unit: '%', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Raise Pro to £59 with the release', provenance: 'explicit', is_status_quo: null, brief_words: null, changes: [], interventions: [iv('Pro plan price', 59, 'GBP per month', 'explicit'), iv('Pro feature release delivered', 1, '')] },
      { label: 'Keep £49', provenance: 'ai_proposed', is_status_quo: true, brief_words: null, changes: [], interventions: [] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP per month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro feature release delivered', role: 'controllable', baseline_known: release.known ?? false, baseline_value: release.baseline_value, unit: '', provenance: 'ai_proposed', plausible_max: release.plausible_max },
      { label: 'Monthly churn rate', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [], outcomes: [],
    links: [
      link('Pro plan price', 'MRR', 'positive'), link('Pro plan price', 'Monthly churn rate', 'positive'),
      link('Pro feature release delivered', 'MRR', 'positive'), link('Pro feature release delivered', 'Monthly churn rate', 'negative'),
      link('Monthly churn rate', 'MRR', 'negative'),
    ],
    identities: [], unknowns: [] as string[], decision_question: null,
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
type Node = { id: string; label: string; kind: string; observed_state?: Record<string, unknown> };
async function registered(...drafts: ReturnType<typeof draft>[]) {
  for (const d of drafts) expect(strict(d), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown; const inputs: string[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const r = await buildModelFromBrief('0e0e0e0e-1111-4222-8333-444455556666', BRIEF, dispatch, async (req) => {
    inputs.push(String((req as { input: unknown }).input));
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as Record<string, unknown>;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const nodes = (GraphV3.parse(graph) as unknown as { nodes: Node[] }).nodes;
  return { node: (label: string) => nodes.find((n) => n.label === label)!, inputs };
}

describe('a switch every option turns on is off today — Olumi\'s 0 is kept and labelled', () => {
  it('⭐ RED (served A01): today-0 on a 0..1 frame, as Olumi\'s estimate → observed_state 0, cee_inference, inferred', async () => {
    const { node } = await registered(draft({ baseline_value: 0, plausible_max: 1 }));
    expect(node('Pro feature release delivered').observed_state).toEqual({ value: 0, source: 'cee_inference', extractionType: 'inferred' });
  });

  it('⭐ RED: an estimate of 0.4 on a 0..1 share is kept as 0.4 — Olumi\'s, never the user\'s', async () => {
    const { node } = await registered(draft({ baseline_value: 0.4, plausible_max: 1 }));
    expect(node('Pro feature release delivered').observed_state).toMatchObject({ value: 0.4, source: 'cee_inference' });
  });

  it('CONTROL: a graded estimate on a wider frame is unchanged (3 on 0..100 → 0.03 with its raw 3)', async () => {
    const { node } = await registered(draft({ baseline_value: 0, plausible_max: 1 }));
    expect(node('Monthly churn rate').observed_state).toMatchObject({ value: 0.03, raw_value: 3, source: 'cee_inference' });
  });

  it('CONTROL: a KNOWN today-0 on the same frame is unchanged (framedObservedState)', async () => {
    const { node } = await registered(draft({ baseline_value: 0, plausible_max: 1, known: true }));
    expect(node('Pro feature release delivered').observed_state).toMatchObject({ value: 0 });
    expect(node('Pro feature release delivered').observed_state?.source).not.toBe('brief_extraction');
  });

  it('CONTRAST: an estimate outside [0, 1] on a 0..1 frame is still not written (no proportion to keep)', async () => {
    const { node } = await registered(draft({ baseline_value: 3, plausible_max: 1 }));
    expect(node('Pro feature release delivered').observed_state).toBeUndefined();
  });

  it('CONTRAST: a negative estimate on a 0..1 frame is still not written (a 0..1 frame cannot express it)', async () => {
    const { node } = await registered(draft({ baseline_value: -1, plausible_max: 1 }));
    expect(node('Pro feature release delivered').observed_state).toBeUndefined();
  });
});
