/**
 * ⭐⭐⭐ THE ACCEPTANCE, AT THE HANDLER: AFTER THE REMEDY, A RE-RUN COMPLETES
 * (P0, journey-witnessed on deployed staging, 2026-09-11).
 *
 * The witness: the analysis withholds, offers *"Review or set an estimate"*,
 * the user sets `250000` on a capless, unitless factor through the inline
 * editor that button opens — and every re-run then refuses, unsatisfiably.
 * The derived loop, and the seam each half sits on:
 *
 *   1. the edit writes `{value: 250000, raw_value: 250000}`
 *      (`d1-shared/normalise-factor-value.ts:289`);
 *   2. the run refuses it — `findScaleIncoherentBaselineFactorIds`
 *      (`plot-intervention-scale.ts:813`) → `baseline_scale_unresolved`
 *      (`run-analysis.ts:666`), whose copy asks for a RANGE;
 *   3. supplying that range was refused — `cap_redeclares_scale`
 *      (`d1-shared/evaluate-factor-value-proposal.ts`, gate 2d), because the
 *      user's own accepted edit at (1) had made `factorHasRecordedValue` true.
 *
 * ⭐ THE ORACLE IS THE RUN GATE ITSELF, NOT A RESTATEMENT OF IT. Each
 * assertion below runs `findScaleIncoherentBaselineFactorIds` — the very
 * function `run_analysis` calls — over the handler's own `mutated_graph`. So
 * "the re-run completes" is measured against the thing that refuses, not
 * against this file's idea of it, and the two seams cannot drift apart.
 *
 * ⚠ BOUND BY IDENTITY, NEVER BY VALUE (CLAUDE.md trap 19). Every assertion
 * names `f-onboarding-investment`. A `toHaveLength(0)` over the gate's output
 * would pass on a graph where a DIFFERENT factor had been cleared, and the
 * fixture deliberately carries a second capless raw factor so that a
 * value-shaped assertion could not tell them apart.
 *
 * ⛔ WHAT IS NOT TOUCHED. The run's readiness check is unchanged — this PR
 * adds not one byte to `plot-intervention-scale.ts`. The gate is the
 * AUTHORITY for when the declaration is admitted, which is the opposite of
 * loosening it.
 */
import { describe, expect, it } from 'vitest';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';
import { findScaleIncoherentBaselineFactorIds } from '../../plot-intervention-scale.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

const TARGET = 'f-onboarding-investment';
/** The second capless raw factor. Present so an identity-free assertion cannot pass. */
const DECOY = 'f-support-load';

/**
 * The witnessed shape. `value === raw_value` on a capless, unitless factor is
 * exactly what `recoverScaleFrame` refuses (it requires `raw > value`), and
 * the options' interventions are framed 0-1 — so NOTHING self-frames the
 * factor and the run gate names it. This is the R2-2 class the gate's own
 * header describes, reproduced rather than invented.
 */
function buildWitnessedGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-arr', kind: 'goal', label: 'ARR' },
      {
        id: TARGET,
        kind: 'factor',
        label: 'Self-Serve Onboarding Investment',
        observed_state: { value: 250_000, raw_value: 250_000 },
      },
      {
        id: DECOY,
        kind: 'factor',
        label: 'Support Load',
        observed_state: { value: 4_000, raw_value: 4_000 },
      },
      {
        id: 'o-invest',
        kind: 'option',
        label: 'Invest in self-serve',
        // ⚠ NODE-LEVEL, NOT `data.interventions` — `schemas/cee-v3.ts:246`.
        // Reading the wrong carrier returns `{}` for every option, which makes
        // NOTHING self-framed and names every capless raw baseline: a silent
        // fail-OPEN that this file's self-framed twin is what caught.
        // Framed levels, 0-1 — the half of the incoherence the gate cannot see
        // from the intervention side, which is why the BASELINE gate exists.
        interventions: { [TARGET]: 0.6, [DECOY]: 0.3 },
      },
    ],
    edges: [
      {
        from: TARGET,
        to: 'g-arr',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  } as unknown as GraphV3T;
}

/**
 * A factor working in its OWN raw scale: its option interventions are raw
 * too. The gate's ratified round-5 astride-1 class — it COMPUTES today, so the
 * declaration must stay refused there. This is the twin that proves the new
 * admission is discriminating rather than a widened window.
 */
function buildSelfFramedGraph(): GraphV3T {
  const g = buildWitnessedGraph() as unknown as {
    nodes: Array<Record<string, unknown>>;
  };
  const option = g.nodes.find((n) => n.id === 'o-invest') as Record<string, unknown>;
  option.interventions = { [TARGET]: 400_000, [DECOY]: 0.3 };
  return g as unknown as GraphV3T;
}

function proposalFor(value: unknown, targetId = TARGET): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: targetId,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  };
}

async function invoke(proposal: ProposalAction, graph: GraphV3T) {
  return createSetFactorValueHandler()(buildHandlerInvocation({ proposal, graph }));
}

/** The run gate's own verdict over a graph, as the analysis seam computes it. */
function gateRefuses(graph: unknown, factorId: string): boolean {
  const nodes = (graph as { nodes: Array<Record<string, unknown>> }).nodes;
  const perOption = nodes
    .filter((n) => n.kind === 'option')
    .map((n) => {
      const iv = n.interventions;
      return iv !== null && typeof iv === 'object' ? (iv as Record<string, unknown>) : {};
    });
  return findScaleIncoherentBaselineFactorIds(nodes, perOption).includes(factorId);
}

function observedAfter(outcome: { mutated_graph?: unknown }, id: string) {
  const nodes = (outcome.mutated_graph as { nodes: Array<Record<string, unknown>> }).nodes;
  return nodes.find((n) => n.id === id)?.observed_state as Record<string, unknown>;
}

describe('the witnessed dead end', () => {
  it('⭐ REPRODUCES: the run gate names the factor the inline editor just accepted', () => {
    expect(gateRefuses(buildWitnessedGraph(), TARGET)).toBe(true);
  });
});

describe('the remedy the run refusal asks for is now accepted, and it CLEARS the run', () => {
  it('⭐⭐ a range is applied, and the gate no longer names the factor', async () => {
    const outcome = await invoke(
      proposalFor({ value: 250_000, cap: 500_000 }),
      buildWitnessedGraph(),
    );
    const after = observedAfter(outcome, TARGET);
    // The declaration is what makes the baseline commensurable: 250k of a 500k
    // range IS 0.5 on the analysis scale, and the user's own magnitude is kept.
    expect(after.value).toBe(0.5);
    expect(after.raw_value).toBe(250_000);
    expect(after.cap).toBe(500_000);
    expect(gateRefuses(outcome.mutated_graph, TARGET)).toBe(false);
  });

  it('⭐ the DECOY is untouched — the gate still names it (identity, not a count)', async () => {
    const outcome = await invoke(
      proposalFor({ value: 250_000, cap: 500_000 }),
      buildWitnessedGraph(),
    );
    expect(gateRefuses(outcome.mutated_graph, DECOY)).toBe(true);
  });
});

describe('the classes that work today are unchanged', () => {
  it('⭐ a SELF-FRAMED factor still refuses the cap declaration (round-5 astride-1)', async () => {
    const graph = buildSelfFramedGraph();
    // Precondition PINNED IN-TEST: the gate does NOT name this factor, so the
    // analysis computes on it today. Without this the assertion below could
    // pass on a fixture that had silently stopped reproducing the class.
    expect(gateRefuses(graph, TARGET)).toBe(false);
    let err: HandlerInvocationFailedError | undefined;
    try {
      await invoke(proposalFor({ value: 250_000, cap: 500_000 }), graph);
    } catch (e) {
      if (e instanceof HandlerInvocationFailedError) err = e;
      else throw e;
    }
    expect(err).toBeDefined();
    expect((err?.details as Record<string, unknown>).rejection_reason).toBe(
      'cap_redeclares_scale',
    );
  });

  it('⭐⭐ OPTIONS PRESENT BUT NO INTERVENTION BUNDLE — the question is unanswerable, so it REFUSES', async () => {
    // The node-level bundle is a COPY (`cee-v3.ts:246`: options[] remains the
    // canonical source for analysis) and it is optional. With options in the
    // graph and no bundle on any of them, this handler cannot tell a
    // self-framed factor from an incoherent one — and the two want opposite
    // answers. Fail CLOSED: today's refusal stands rather than rescaling a
    // baseline whose analysis may be working.
    const graph = buildWitnessedGraph() as unknown as {
      nodes: Array<Record<string, unknown>>;
    };
    const option = graph.nodes.find((n) => n.id === 'o-invest') as Record<string, unknown>;
    delete option.interventions;
    let err: HandlerInvocationFailedError | undefined;
    try {
      await invoke(proposalFor({ value: 250_000, cap: 500_000 }), graph as unknown as GraphV3T);
    } catch (e) {
      if (e instanceof HandlerInvocationFailedError) err = e;
      else throw e;
    }
    expect(err).toBeDefined();
    expect((err?.details as Record<string, unknown>).rejection_reason).toBe(
      'cap_redeclares_scale',
    );
  });

  it('⭐ a unit declaration onto a self-framed factor is still refused', async () => {
    let err: HandlerInvocationFailedError | undefined;
    try {
      await invoke(proposalFor({ value: 250_000, unit: '£' }), buildSelfFramedGraph());
    } catch (e) {
      if (e instanceof HandlerInvocationFailedError) err = e;
      else throw e;
    }
    expect(err).toBeDefined();
    expect((err?.details as Record<string, unknown>).rejection_reason).toBe(
      'unit_redeclares_scale',
    );
  });
});
