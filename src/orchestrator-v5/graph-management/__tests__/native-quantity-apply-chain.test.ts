/**
 * ⭐⭐ THE ACTUAL APPLIER WITNESS for the native-quantity write (Codex CX-87:
 * "preserved cells in a composed payload do not establish what the applier
 * persisted").
 *
 * Sibling of `option-effect-write-apply-chain.test.ts`, and the distinction is
 * the row: that file pins the chain for a MISSING model-unit value. This one
 * pins it for a value that EXISTS and is unreadable against a native limit —
 * the opposite question about the same cell.
 *
 * Chain pinned here, per hop, in dispatcher order:
 *   1. buildNativeQuantityOperation + parseEditGraphResponse — the composed op
 *      canonicalises through the SAME parser the model's output goes through;
 *   2. evaluateEditGraphMutations (live) — the referee PROCEEDS. The
 *      deterministic path acquires no power the LLM path lacks;
 *   3. applyPatchOperations + encodeOptionInterventionsForEdit — what the
 *      APPLIER actually persisted;
 *   4. readback — the native survives, the model value is DERIVED from it
 *      rather than carried over, and the neighbouring cell is byte-identical;
 *   5. decideOptionCostAsk — the ask no longer selects the answered cell.
 *
 * ⚠ THE GRAPH IS THE REAL WIRE CAPTURE (`witness-2026-08-17`), with ONE
 * declared addition for the positive arm: the target factor is given an
 * explicit `cap` + `unit`, and the option an existing encoded value. The
 * capture's own factor carries NEITHER — which is exactly why it serves,
 * unmodified, as the UNSUPPORTED arm. The calibration is DECLARED by this
 * fixture, never inferred from a budget ceiling or from the encoded value;
 * inventing one is the fabrication this whole path exists to avoid.
 * Historic capture: append, never edit (trap 14b) — the base file is untouched
 * and the addition is made on a clone.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import {
  buildNativeQuantityOperation,
  readCommittedNativeQuantity,
  readExistingIntervention,
} from '../../routing/native-quantity-operation.js';
import { decideOptionCostAsk } from '../../coaching/decide-option-cost-ask.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

interface WitnessFixture {
  readonly ids: { readonly option_id: string; readonly factor_id: string; readonly option_label: string; readonly factor_label: string };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}

const WITNESS = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url),
    'utf8',
  ),
) as WitnessFixture;

const OPTION_ID = WITNESS.ids.option_id;
const FACTOR_ID = WITNESS.ids.factor_id;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A second factor on the same option — its cell must survive untouched. */
const NEIGHBOUR_ID = 'neighbour_factor';
const NEIGHBOUR_CELL = { value: 0.3, source: 'brief_extraction', reasoning: 'from the brief' };

/** The captured graph, unmodified: the factor carries NO cap and NO unit. */
const uncalibratedGraph = () => clone(WITNESS.draft_graph);

/** The same capture with a DECLARED calibration and an existing encoded value. */
function calibratedGraph() {
  const g = clone(WITNESS.draft_graph);
  for (const node of g.nodes) {
    if (node.id === FACTOR_ID) {
      node.observed_state = { ...(node.observed_state as object), unit: 'GBP', cap: 250000 };
    }
    if (node.id === OPTION_ID) {
      // ⚠ NODE-LEVEL, not under `data`. `NodeV3` is a plain z.object that
      // strips undeclared fields, so cells placed under `data.interventions`
      // vanish at `GraphV3.parse` — BEFORE the applier ever runs. A first cut
      // of this fixture did exactly that and the neighbour assertion failed;
      // it read as "the applier dropped an unrelated cell" and was nothing of
      // the kind. Traced hop by hop rather than reported.
      node.interventions = {
        [FACTOR_ID]: { value: 0.7, source: 'user_specified', reasoning: 'earlier estimate' },
        [NEIGHBOUR_ID]: { ...NEIGHBOUR_CELL },
      };
    }
  }
  g.nodes.push({ id: NEIGHBOUR_ID, kind: 'factor', label: 'Neighbour factor' });
  return g;
}

const WRITE = {
  optionId: OPTION_ID,
  optionLabel: WITNESS.ids.option_label,
  factorId: FACTOR_ID,
  factorLabel: WITNESS.ids.factor_label,
  nativeValue: 150000,
  unit: 'GBP',
};
const SCALE = { cap: 250000, unit: 'GBP' };

function canonicalise(g: Record<string, unknown>) {
  const raw = buildNativeQuantityOperation(WRITE, readExistingIntervention(g, OPTION_ID, FACTOR_ID), SCALE);
  if (raw === null) throw new Error('expected an operation');
  return parseEditGraphResponse(
    JSON.stringify({ operations: [raw], removed_edges: [], warnings: [], coaching: null }),
  ).operations as PatchOperation[];
}

const applyChain = () => {
  const g = calibratedGraph();
  const base = GraphV3.parse(g) as GraphV3T;
  const applied = applyPatchOperations(base, canonicalise(g));
  return encodeOptionInterventionsForEdit(applied, new Set([OPTION_ID]));
};

describe('native-quantity write — the ACTUAL apply chain', () => {
  it('RED BASELINE — the ask selects this cell before the write', () => {
    // Without this, "the ask stops selecting it" could pass on a graph where
    // it never selected it (trap 13: an absence needs a presence first).
    const g = calibratedGraph();
    const ask = decideOptionCostAsk({
      notDecisionGrade: true,
      ratified: [{ node_id: FACTOR_ID, unit: 'GBP', label: 'Budget limit' }],
      nodes: g.nodes as never,
      options: [{ id: OPTION_ID, label: WITNESS.ids.option_label, interventions: g.nodes.find((n) => n.id === OPTION_ID)!.interventions }],
    });
    expect(ask?.option_id).toBe(OPTION_ID);
    expect(ask?.factor_id).toBe(FACTOR_ID);
  });

  it('hop 1 — the composed op canonicalises through the SHIPPED parser', () => {
    const ops = canonicalise(calibratedGraph());
    expect(ops).toHaveLength(1);
    expect(ops[0]!.op).toBe('update_node');
    expect(ops[0]!.path).toBe(OPTION_ID);
    expect(Object.keys(ops[0]!.value as Record<string, unknown>)).toEqual([
      `data/interventions/${FACTOR_ID}`,
    ]);
  });

  it('hop 2 — the referee PROCEEDS; the deterministic path gains no extra power', () => {
    const decision = evaluateEditGraphMutations({
      mode: 'live',
      operations: canonicalise(calibratedGraph()),
      currentGraph: calibratedGraph(),
      currentGraphHash: 'hash-a',
      baseGraphHash: 'hash-a',
      freshness: 'fresh',
      scenarioId: 'scn-native',
      turnId: 'turn-native',
      requestId: 'req-native',
    });
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
  });

  it('⭐⭐ hops 3+4 — WHAT THE APPLIER PERSISTED: native kept, model value DERIVED', () => {
    const { graph: encoded, unresolvedOptionIds } = applyChain();
    expect(unresolvedOptionIds).toEqual([]);

    // The native survived the applier AND the encoder.
    const committed = readCommittedNativeQuantity(encoded, OPTION_ID, FACTOR_ID);
    expect(committed).toEqual({ rawValue: 150000, unit: 'GBP' });

    // ⭐ The model value is DERIVED from the native (150000/250000), not the
    // 0.7 that was there before. That number is the whole point of dropping
    // the stale encoded value.
    const cell = readExistingIntervention(encoded, OPTION_ID, FACTOR_ID)!;
    expect(cell.value).toBeCloseTo(0.6);
    expect(cell.value).not.toBe(0.7);
  });

  it('⭐ the NEIGHBOURING cell is byte-identical after the applier', () => {
    // Codex CX-87: a preserved cell in the composed payload proves nothing
    // about what was persisted. This reads it off the APPLIED graph.
    const { graph: encoded } = applyChain();
    const neighbour = readExistingIntervention(encoded, OPTION_ID, NEIGHBOUR_ID);
    expect(neighbour).toEqual(NEIGHBOUR_CELL);
  });

  it('hop 5 — the ask no longer selects the answered cell', () => {
    const { graph: encoded } = applyChain();
    const nodes = (encoded as { nodes: Array<Record<string, unknown>> }).nodes;
    const optionNode = nodes.find((n) => n.id === OPTION_ID)!;
    const ask = decideOptionCostAsk({
      notDecisionGrade: true,
      ratified: [{ node_id: FACTOR_ID, unit: 'GBP', label: 'Budget limit' }],
      nodes: nodes as never,
      options: [{
        id: OPTION_ID,
        label: WITNESS.ids.option_label,
        interventions: (optionNode.interventions ?? (optionNode.data as { interventions?: unknown } | undefined)?.interventions),
      }],
    });
    expect(ask).toBeNull();
  });

  it('⚠ UNSUPPORTED — the capture AS CAPTURED carries no calibration, so nothing is written', () => {
    // The real wire fixture's factor has an observed value but no cap and no
    // unit. No operation is built, so the applier is never reached and the
    // graph is untouched — the honest outcome, not a silent 0.7.
    const g = uncalibratedGraph();
    const op = buildNativeQuantityOperation(WRITE, readExistingIntervention(g, OPTION_ID, FACTOR_ID), undefined);
    expect(op).toBeNull();
  });
});
