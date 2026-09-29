/**
 * Guards for the composition: readiness gap -> estimates -> proposal -> one chip.
 *
 * The graph is the SAME REAL DATED CAPTURE the batch module's own suite uses
 * (`witness-2026-08-17/j4-wrong-entity-write.json`), with every option's
 * interventions cleared — the witnessed arm in which every effect value is open.
 * Reusing it rather than inventing a graph is deliberate: a fixture I wrote
 * myself would encode my model of the producer instead of the producer.
 *
 * ⚠ These prove the COMPOSITION and the failure taxonomy. They make no claim
 * about model output quality — the model call is injected and every reply here
 * is mine.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { selectValueBatchMembership } from '../readiness-value-batch.js';
import {
  prepareValueBatchOffer,
  deriveFactorContext,
} from '../readiness-value-batch-flow.js';

const CAPTURE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url),
    'utf8',
  ),
) as { draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } };

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

function zeroConfiguredGraph(): Graph {
  const graph = structuredClone(CAPTURE.draft_graph) as Graph;
  for (const node of graph.nodes) if (node.kind === 'option') node.interventions = {};
  return graph;
}

const base = (graph: unknown) => ({
  assessment: assessCanonicalAnalysisReadiness(graph),
  graph,
  currentGraphHash: 'hash_under_test',
  scenarioId: 'scn_under_test',
  brief: 'Should we hire a tech lead or two developers?',
});

/** A reply that answers EXACTLY the derived membership — never a transcribed list. */
const answersEveryCell = (graph: unknown, value = 0.7) => {
  const cells = selectValueBatchMembership(assessCanonicalAnalysisReadiness(graph)).cells;
  return async () => ({
    content: JSON.stringify({
      estimates: cells.map((c) => ({
        option_id: c.option_id,
        factor_id: c.factor_id,
        value,
        reasoning: 'Derived from the brief.',
        confidence: 'medium' as const,
      })),
    }),
  });
};

describe('value batch flow — the happy path produces ONE reviewable chip', () => {
  it('turns an open readiness assessment into a single offer', async () => {
    const graph = zeroConfiguredGraph();
    const input = base(graph);
    // PRECONDITION PINNED: the arm really is the open state, so a later
    // assertion cannot pass on a graph that had nothing to ask about.
    expect(input.assessment.safeToAnalyse).toBe(false);
    expect(selectValueBatchMembership(input.assessment).cells.length).toBeGreaterThan(0);

    const out = await prepareValueBatchOffer(input, answersEveryCell(graph));
    expect(out.kind).toBe('offer');
    if (out.kind !== 'offer') return;
    // ONE chip for the whole batch — that is the point of the feature.
    expect(out.offer.chip.id).toMatch(/^rvb_/);
    expect(out.offer.chip.label).toMatch(/Apply (the estimate|all \d+ estimates)/);
    expect(out.offer.pending.preconditions.graph_hash).toBe('hash_under_test');
    // Every writable cell carries the mark and the reasoning it was given.
    expect(out.proposal.cells.every((c) => c.value === null || c.reasoning !== undefined)).toBe(true);
  });

  it('returns no_cells when nothing is open, without calling the model', async () => {
    let called = 0;
    const out = await prepareValueBatchOffer(
      { ...base(CAPTURE.draft_graph), assessment: { blockingIssues: [] } as never },
      async () => {
        called += 1;
        return { content: '{}' };
      },
    );
    expect(out.kind).toBe('no_cells');
    expect(called).toBe(0);
  });
});

describe('value batch flow — every failure is NAMED, never patched over', () => {
  it('a model that returns nothing usable => estimator_failed, and the one-at-a-time route survives', async () => {
    const graph = zeroConfiguredGraph();
    const out = await prepareValueBatchOffer(base(graph), async () => ({ content: 'not json' }));
    expect(out.kind).toBe('estimator_failed');
    if (out.kind !== 'estimator_failed') return;
    expect(out.reason).toContain('unparseable');
  });

  it('⭐ a SHORT estimate set => proposal_invalid "incomplete" — the witnessed defect, still named', async () => {
    // The assembler's own docblock calls a short set "THE WITNESSED DEFECT:
    // ... Named, never patched over." This pins that the composition does not
    // quietly soften it into a partial apply — a batch that writes some cells
    // and silently omits others is worse than the loop it replaces.
    const graph = zeroConfiguredGraph();
    const cells = selectValueBatchMembership(assessCanonicalAnalysisReadiness(graph)).cells;
    expect(cells.length).toBeGreaterThan(1); // precondition: dropping one leaves a real set
    const short = cells.slice(1);
    const out = await prepareValueBatchOffer(base(graph), async () => ({
      content: JSON.stringify({
        estimates: short.map((c) => ({ option_id: c.option_id, factor_id: c.factor_id, value: 0.5 })),
      }),
    }));
    expect(out.kind).toBe('proposal_invalid');
    if (out.kind !== 'proposal_invalid') return;
    expect(out.reason).toBe('incomplete');
  });

  it('⭐ every cell declined => no_writable, and the PROPOSAL IS CARRIED so the reasons survive', async () => {
    // A bare null here would delete the declined reasons, which are the only
    // thing the user can act on in that state.
    const graph = zeroConfiguredGraph();
    const cells = selectValueBatchMembership(assessCanonicalAnalysisReadiness(graph)).cells;
    const out = await prepareValueBatchOffer(base(graph), async () => ({
      content: JSON.stringify({
        estimates: cells.map((c) => ({
          option_id: c.option_id,
          factor_id: c.factor_id,
          value: null,
          declined_reason: 'The brief gives no basis for this one.',
        })),
      }),
    }));
    expect(out.kind).toBe('no_writable');
    if (out.kind !== 'no_writable') return;
    expect(out.proposal.cells.length).toBe(cells.length);
    expect(out.proposal.cells.every((c) => c.declined_reason !== undefined)).toBe(true);
  });
});

describe('value batch flow — factor context is derived from the graph, on BOTH shapes', () => {
  it('⭐ DISCRIMINATING PAIR: reads data.value AND observed_state.value in one probe', () => {
    // A factor's current level lives at `data.value` on the draft path and at
    // `observed_state.value` once canonical, and this runs on both. Reading
    // only one would hand the model "no current level recorded" for every
    // factor on the other path — a degradation with no error anywhere.
    const graph = {
      nodes: [
        { id: 'f_draft', kind: 'factor', label: 'Draft shape', data: { value: 0.42, unit: '%' } },
        { id: 'f_canon', kind: 'factor', label: 'Canonical shape', observed_state: { value: 0.73 } },
        { id: 'f_absent', kind: 'factor', label: 'No level recorded' },
        { id: 'f_ignored', kind: 'factor', label: 'Not asked about', data: { value: 0.9 } },
      ],
    };
    const ctx = deriveFactorContext(graph, new Set(['f_draft', 'f_canon', 'f_absent']));
    const byId = new Map(ctx.map((c) => [c.factor_id, c]));

    expect(byId.get('f_draft')?.current_value).toBe(0.42);
    expect(byId.get('f_canon')?.current_value).toBe(0.73);
    expect(byId.get('f_draft')?.unit).toBe('%');
    // ⭐ ABSENCE STAYS ABSENT. A factor with no recorded level is not a factor
    // at zero, and coercing it would tell the model something false.
    expect(byId.get('f_absent')?.current_value).toBeUndefined();
    // CONTRAST: a factor not in the asked set is not described at all.
    expect(byId.has('f_ignored')).toBe(false);
  });

  it('a graph with no nodes yields no context rather than throwing', () => {
    expect(deriveFactorContext({}, new Set(['anything']))).toEqual([]);
    expect(deriveFactorContext(null, new Set(['anything']))).toEqual([]);
  });
});
