/**
 * RT-4 class A (#2603; Codex r1 HIGH): a total we COMPUTED is not a figure the user wrote.
 *
 * "Training coverage is 5% today" plus "expand it by another 2%" is admitted as the user's 7%
 * (`prepareProvisionalCandidate` resolves the `additional` level, `explicit` because both inputs are),
 * and admission stamps it `brief_extraction`. "7%" is written nowhere as the user's training figure,
 * and an unrelated "Churn is 7%" was credited to training coverage by the not-modelled manifest.
 *
 * The real path: the drafted candidate → `buildModelFromBrief` (no provider) → the registered graph →
 * `deriveNotModelledManifest`. Rows bind by identity: the option's own level on `training_coverage`.
 */
import { describe, expect, it } from 'vitest';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { deriveNotModelledManifest } from '../../../cee/context-integrity/not-modelled-manifest.js';
import { Ajv } from 'ajv';

const BRIEF = 'Training coverage is 5% today. Should we expand training by another 2% to lift customer satisfaction, or keep training as it is? Churn is 7%.';

function training(kind: 'additional' | 'absolute') {
  return {
    goal: { metric: 'Customer satisfaction', operator: '>=', target_stated: false, frame: 'level' as const, value: null, unit: '%', horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Expand training', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Training coverage', value: kind === 'additional' ? 2 : 7, value_kind: kind, unit: '%', provenance: 'explicit' }] },
      { label: 'Keep training as it is', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [] as { factor_label: string; value: number; value_kind: string; unit: string; provenance: string }[] },
    ],
    factors: [
      { label: 'Training coverage', role: 'controllable' as const, baseline_known: true, baseline_value: 5, unit: '%', plausible_max: 100, provenance: 'explicit' },
    ],
    risks: [],
    outcomes: [],
    links: [
      { from: 'Training coverage', to: 'Customer satisfaction', direction: 'positive' as const, provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  };
}

async function construct(candidate: CandidateModel, brief: string) {
  let graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) graph = (body as { graph: typeof graph }).graph;
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromBrief('44444444-4444-4444-8444-444444444444', brief, dispatch,
    async () => ({ text: JSON.stringify(candidate) }));
  return { result, graph };
}

const trainingLevel = (graph: { nodes: Array<Record<string, unknown>> } | undefined) =>
  (graph?.nodes.find((n) => n.label === 'Expand training')?.interventions as Record<string, Record<string, unknown>> | undefined)?.training_coverage;

const item = (graph: Record<string, unknown>, brief: string, literal: string) => {
  const found = deriveNotModelledManifest(brief, graph).quantities?.items.find(
    (i) => i.literal === literal && i.char_offset === brief.indexOf(literal),
  );
  expect(found, `the manifest must report ${literal}`).toBeDefined();
  return found!;
};

describe('RT-4 class A — a computed total is never credited with a brief literal', () => {
  it('the drafted candidate fits the structured schema', () => {
    const validate = new Ajv({ strict: false }).compile(buildCandidateSchema());
    expect(validate(training('additional')), JSON.stringify(validate.errors)).toBe(true);
  });

  it('5% today + 2% more is the user\'s 7%, marked as computed, and "Churn is 7%" is NOT credited to it', async () => {
    const { result, graph } = await construct(training('additional') as unknown as CandidateModel, BRIEF);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    // The precondition: the level IS the user's (brief_extraction) and holds 7%, the same value and unit as churn.
    expect(trainingLevel(graph)).toMatchObject({ raw_value: 7, unit: '%', source: 'brief_extraction', value_confidence: 'medium' });
    const churn = item(graph as unknown as Record<string, unknown>, BRIEF, '7%');
    expect(churn.verdict).not.toBe('in_model');
    expect(churn.matched_node_id).toBeNull();
  });

  it('CONTROL: a 7% the user WROTE as the level is not marked, and is credited to training coverage', async () => {
    const brief = 'Training coverage is 5% today. Should we raise training coverage to 7% to lift customer satisfaction, or keep training as it is?';
    const { result, graph } = await construct(training('absolute') as unknown as CandidateModel, brief);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const level = trainingLevel(graph);
    expect(level).toMatchObject({ raw_value: 7, unit: '%', source: 'brief_extraction' });
    expect(level).not.toHaveProperty('value_confidence');
    const stated = item(graph as unknown as Record<string, unknown>, brief, '7%');
    expect(stated.verdict).toBe('in_model');
    expect(stated.matched_node_id).toBe('training_coverage');
  });
});
