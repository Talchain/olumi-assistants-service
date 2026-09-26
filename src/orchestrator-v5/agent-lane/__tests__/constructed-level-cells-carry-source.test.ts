/**
 * ⛔ A LEVEL THE AGENT CONSTRUCTED MUST BE A LEVEL THE PRODUCT CAN LATER REVISE.
 *
 * MEASURED on served staging (scenario A of the OpenAI Connected acceptance
 * witness): the Agent built the model, the user approved a starting point that
 * REVISED a level the brief stated, and the approval came back
 * `partially_applied`. The option-intervention writer
 * (`prepareOptionInterventionEdit`) refused the level with
 * `invalid_existing_intervention`, because construction wrote the cell as a
 * bare `{ value }` and the writer's reader contract (`ExistingInterventionRead`)
 * requires `source` from the producer's own enum. The served pricing graph
 * banked in `fixtures/served-pricing-graph-c4a6cce.json` carries exactly that
 * shape (`{"value": 0.295}`), and it is used below as the contrast control.
 *
 * The rule is the writer's, and it is RIGHT: an entry with no stated origin
 * cannot be overwritten with user authority without silently erasing what it
 * was. So the fix is the WRITER'S INPUT — construction states where each level
 * came from — never a relaxation of the writer. That is the same claim
 * `framedObservedState` already makes for a baseline: 'explicit' means the
 * brief stated it (`brief_extraction`); anything else is Olumi's hypothesis
 * (`cee_hypothesis`). A machine-derived level must never claim
 * `user_specified`: that stamp is reserved for a value a user actually set, and
 * the writer's own postimage check (`optionInterventionPostimageIsScoped`) is
 * what mints it.
 *
 * The candidate is REAL wire output (`live-hiring-envelope-candidate-20260923`,
 * see its `_provenance`), driven through the real `buildModelFromBrief` with the
 * model call faked, and persisted through the register route's own pipeline.
 * Nothing here calls an LLM or a live service.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitCandidateModel, type AdmittedModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { InterventionV3 } from '../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { normaliseGraphNodeKindField } from '../../graph-registration/normalise-node-kind.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import {
  applyOptionInterventionEdit,
  prepareOptionInterventionEdit,
} from '../../system-events/option-intervention-edit.js';

const SCENARIO = '55555555-5555-4555-8555-555555555555';
const BRIEF = 'Should I hire a Tech lead or two developers to increase velocity?';
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const banked = (): CandidateModel =>
  (fixture('live-hiring-envelope-candidate-20260923.json') as { candidate: CandidateModel }).candidate;

/** The writer's own enum — read off the producer schema, never re-spelled here. */
const WRITER_SOURCES: readonly string[] = InterventionV3.shape.source.options;

// Identity, not position: the option and factor the brief names, by label.
const OPTION_LABEL = 'Hire Two Developers';
const FACTOR_LABEL = 'Developers hired';

function idsFor(admitted: Pick<AdmittedModel, 'nodes'>): { optionId: string; factorId: string } {
  const option = admitted.nodes.filter((n) => n.kind === 'option' && n.label === OPTION_LABEL);
  const factor = admitted.nodes.filter((n) => n.kind === 'factor' && n.label === FACTOR_LABEL);
  expect(option, 'exactly one option carries the brief’s label').toHaveLength(1);
  expect(factor, 'exactly one factor carries the brief’s label').toHaveLength(1);
  return { optionId: option[0]!.id, factorId: factor[0]!.id };
}

function withProvenance(provenance: string, value?: number): CandidateModel {
  const c = banked();
  return {
    ...c,
    options: c.options.map((o) => o.label !== OPTION_LABEL ? o : {
      ...o,
      interventions: (o.interventions ?? []).map((iv) =>
        iv.factor_label !== FACTOR_LABEL ? iv : { ...iv, provenance, ...(value !== undefined ? { value } : {}) }),
    }),
  };
}

function cell(admitted: AdmittedModel): unknown {
  const { optionId, factorId } = idsFor(admitted);
  return admitted.nodes.find((n) => n.id === optionId)!.interventions?.[factorId];
}

/** The `/graph/register` route's own pipeline, in its own order: kind normalise → ingress parse → project. */
function persistAsRegistered(graph: unknown): unknown {
  const normalised = normaliseGraphNodeKindField(graph);
  if (!normalised.ok) throw new Error(`register would refuse: ${normalised.reason}`);
  const parsed = GraphStateIngressSchema.safeParse(normalised.graph);
  if (!parsed.success) throw new Error(`register would refuse: ${parsed.error.issues[0]?.path.join('.')}`);
  return projectGraphForPersistence(parsed.data, {
    scenarioId: SCENARIO, turnClass: 'direct_answer', source: 'graph_registration',
  });
}

/** Drive the REAL construction path with the banked wire output; capture what it registers. */
async function constructAndPersist(candidate: CandidateModel): Promise<unknown> {
  const registered: unknown[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) registered.push((body as { graph: unknown }).graph);
    return { status: 200, json: { registered: true } };
  };
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const out = await buildModelFromBrief(SCENARIO, BRIEF, d, fn);
  expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
  expect(registered, 'construction registers exactly one graph').toHaveLength(1);
  return persistAsRegistered(registered[0]);
}

function reviseLevel(persistedGraph: unknown, ids: { optionId: string; factorId: string }, modelValue: number) {
  return prepareOptionInterventionEdit({
    persistedGraph, ...ids, modelValue,
    expectedGraphHash: computeAnalysisAffectingGraphHash(persistedGraph as never)!,
  });
}

describe('a constructed option level states where it came from', () => {
  it('control: the banked candidate really states this level, from the brief', () => {
    const iv = banked().options.find((o) => o.label === OPTION_LABEL)?.interventions
      ?.find((i) => i.factor_label === FACTOR_LABEL);
    expect(iv).toMatchObject({ value: 2, provenance: 'explicit' });
  });

  it('a brief-stated level (in range) is stamped brief_extraction', () => {
    // 2 of a stated range of 20 → 0.1 on the model scale.
    expect(cell(admitCandidateModel(banked(), {}))).toEqual({ value: 0.1, source: 'brief_extraction' });
  });

  it.each(['inferred', 'ai_proposed'])('a %s level (in range) is stamped cee_hypothesis', (provenance) => {
    expect(cell(admitCandidateModel(withProvenance(provenance), {}))).toEqual({ value: 0.1, source: 'cee_hypothesis' });
  });

  it('an above-range level carries the same claim (the range widens; the level is never kept raw)', () => {
    // 25 hires against a stated range of 20: the range widens to 0..100 (said), so the level is
    // 0.25 in the factor's one value space — never a raw 25 beside normalised siblings (#69 5835137365).
    expect(cell(admitCandidateModel(withProvenance('explicit', 25), {}))).toEqual({ value: 0.25, source: 'brief_extraction' });
    expect(cell(admitCandidateModel(withProvenance('inferred', 25), {}))).toEqual({ value: 0.25, source: 'cee_hypothesis' });
  });

  it('⛔ NO constructed level ever claims user authority, and every one is in the writer’s enum', () => {
    const candidates: CandidateModel[] = [
      banked(),
      withProvenance('inferred'),
      withProvenance('explicit', 25),
      withProvenance('ai_proposed', 25),
      fixture('configC.json') as CandidateModel,
    ];
    let cells = 0;
    for (const c of candidates) {
      for (const n of admitCandidateModel(c, {}).nodes.filter((x) => x.kind === 'option')) {
        for (const [factorId, entry] of Object.entries(n.interventions ?? {})) {
          cells += 1;
          const source = (entry as { source?: unknown }).source;
          expect(source, `${n.id} -> ${factorId}: a machine-derived level is never user_specified`).not.toBe('user_specified');
          expect(WRITER_SOURCES, `${n.id} -> ${factorId}`).toContain(source);
        }
      }
    }
    // Magnitude check: the loop must have seen every stated level, or it proves nothing.
    expect(cells).toBe(4 * 2 + 2);
  });
});

describe('the writer can revise a level the Agent constructed', () => {
  it('contrast: the SERVED source-less cell is refused by the same writer — the defect, on real bytes', () => {
    const served = fixture('served-pricing-graph-c4a6cce.json') as { nodes: { id: string; interventions?: unknown }[] };
    const option = served.nodes.find((n) => n.id === 'raise_with_release')!;
    expect(option.interventions, 'the served shape: a level with no stated origin').toEqual({ pro_plan_price: { value: 0.295 } });
    const persisted = persistAsRegistered(served);
    expect(reviseLevel(persisted, { optionId: 'raise_with_release', factorId: 'pro_plan_price' }, 0.3))
      .toEqual({ kind: 'refused', reason: 'invalid_existing_intervention' });
  });

  it('a brief-stated level, constructed and registered, is PREPARED for a revised value — not refused', async () => {
    const persisted = await constructAndPersist(banked());
    const ids = idsFor(persisted as AdmittedModel);
    // The user revises "two developers" to three: 3 of 20 on the model scale.
    const result = reviseLevel(persisted, ids, 0.15);
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'prepared' });
    // And re-approving the SAME level reaches the writer's no-op, which also
    // requires the existing entry to parse — so this is a second witness.
    expect(reviseLevel(persisted, ids, 0.1)).toEqual({ kind: 'unchanged' });
  });

  it('a machine-proposed level is PREPARED for a revised value too', async () => {
    const persisted = await constructAndPersist(withProvenance('inferred'));
    expect(reviseLevel(persisted, idsFor(persisted as AdmittedModel), 0.15)).toMatchObject({ kind: 'prepared' });
  });

  it('the whole pure transaction completes, and only the writer mints user_specified', async () => {
    const persisted = await constructAndPersist(banked());
    const ids = idsFor(persisted as AdmittedModel);
    const out = applyOptionInterventionEdit({
      persistedGraph: persisted, ...ids, modelValue: 0.15,
      expectedGraphHash: computeAnalysisAffectingGraphHash(persisted as never)!,
      scenarioId: SCENARIO, turnId: 'turn-revise-level', requestId: 'req-revise-level',
      freshness: 'none', hasExistingAnalysis: false,
    });
    expect(out.kind, JSON.stringify(out).slice(0, 300)).toBe('candidate');
    if (out.kind !== 'candidate') return;
    const after = out.graph.nodes.find((n) => n.id === ids.optionId)!.interventions?.[ids.factorId];
    expect(after).toMatchObject({ value: 0.15, source: 'user_specified', target_match: { node_id: ids.factorId } });
  });
});
