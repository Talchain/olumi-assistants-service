/**
 * ⭐⭐ ROADMAP 2.1266 — fixture-level pin of the FULL deterministic
 * option-effect write chain, on the WIRE-WITNESSED graph.
 *
 * Sibling of `option-configure-apply-chain.test.ts`, and the distinction is
 * the whole row: that file pins the chain for operations the edit LLM
 * PRODUCES. This one pins it for the operation the server COMPOSES when the
 * user sends the product's own advised sentence — the sentence that, on
 * deployed `293da07`, returned "…still has no effect value…" and wrote
 * nothing, because no wire verb on the build could set an option's effect
 * value at all.
 *
 * Chain pinned here, per hop, in the order the dispatcher runs it:
 *   0. resolveOptionEffectWrite — the sentence binds to option, factor and
 *      value BY ID against the persisted graph;
 *   1. buildOptionEffectRawOperation + parseEditGraphResponse — the composed
 *      op canonicalises through the SAME parser the model's output goes
 *      through, keeping factor attribution (the object-leaf shape);
 *   2. evaluateEditGraphMutations (live) — the referee judges it TUNABLE and
 *      PROCEEDS, no hold. The deterministic path acquires no power the LLM
 *      path lacks;
 *   3. applyPatchOperations + encodeOptionInterventionsForEdit — the write
 *      lands as canonical interventions with a numeric value;
 *   4. mergeInterventionSources + computeStructuralReadiness +
 *      deriveMissingEffectPairs — the reader sees it, the option flips
 *      needs_encoding → ready, and the MISSING_OPTION_VALUE blocker for THAT
 *      pair clears;
 *   5. decideOptionInterventionWrite (#1016) — the wrong-entity write guard
 *      ALLOWS, on `interventions_write_landed`. The two compose; the writer
 *      does not bypass the guard.
 *
 * ⚠ The graph and the sentence are VERBATIM wire captures (see the fixture's
 * own `__provenance__`), not a self-authored shape. Historic record: append,
 * never edit (trap 14b).
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import {
  buildCanonicalAnalysisReadyFromGraph,
  computeStructuralReadiness,
  mergeInterventionSources,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import { deriveMissingEffectPairs } from '../../routing/repair-value-binding.js';
import {
  buildOptionEffectRawOperation,
  readCommittedOptionEffect,
  resolveOptionEffectWrite,
} from '../../routing/option-effect-write.js';
import {
  anyInterventionWriteLanded,
  decideOptionInterventionWrite,
} from '../../routing/option-intervention-write-guard.js';
import { evaluateConfigureOptionOutcome } from '../../routing/configure-option-outcome.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

interface WitnessFixture {
  readonly ids: {
    readonly option_id: string;
    readonly option_label: string;
    readonly factor_id: string;
    readonly factor_label: string;
  };
  readonly wire: { readonly t4_chip_message: string };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}

const WITNESS = JSON.parse(
  readFileSync(
    new URL(
      '../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as WitnessFixture;

const OPTION_ID = WITNESS.ids.option_id;
const FACTOR_ID = WITNESS.ids.factor_id;
/** The product's OWN advised sentence, verbatim from the wire. */
const ADVISED_SENTENCE = WITNESS.wire.t4_chip_message;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const graph = () => clone(WITNESS.draft_graph);

function resolveOrThrow(message: string, g: unknown) {
  const resolution = resolveOptionEffectWrite({ message, graph: g });
  if (!resolution.matched || resolution.kind !== 'write') {
    throw new Error(`expected a write, got ${JSON.stringify(resolution)}`);
  }
  return resolution;
}

function canonicalise(resolved: Parameters<typeof buildOptionEffectRawOperation>[0]) {
  return parseEditGraphResponse(
    JSON.stringify({
      operations: [buildOptionEffectRawOperation(resolved)],
      removed_edges: [],
      warnings: [],
      coaching: null,
    }),
  ).operations as PatchOperation[];
}

describe('2.1266 — deterministic option-effect write, full apply chain', () => {
  it('RED BASELINE — the option blocks analysis and the pair has a missing-value blocker', () => {
    // Without this the "it landed" assertions below could pass on a graph that
    // was never blocked (trap 13: an absence probe needs a presence first).
    const parsed = GraphV3.parse(graph()) as GraphV3T;
    const readiness = computeStructuralReadiness(parsed);
    expect(readiness?.options.find((o) => o.option_id === OPTION_ID)?.status).toBe(
      'needs_encoding',
    );
    const pairs = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(graph()));
    expect(pairs.some((p) => p.optionId === OPTION_ID && p.factorId === FACTOR_ID)).toBe(true);
  });

  it('hop 1 — the composed op canonicalises through the SHIPPED parser with attribution intact', () => {
    const ops = canonicalise(resolveOrThrow(ADVISED_SENTENCE, graph()));
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.op).toBe('update_node');
    // Post-parse shape: the path reduces to the bare node id and the leaf is
    // re-keyed by its slash field, so the `<factor_id>` attribution survives.
    expect(op.path).toBe(OPTION_ID);
    expect(Object.keys(op.value as Record<string, unknown>)).toEqual([
      `data/interventions/${FACTOR_ID}`,
    ]);
    expect((op.value as Record<string, Record<string, unknown>>)[
      `data/interventions/${FACTOR_ID}`
    ]!.value).toBe(0.12);
  });

  it('hop 2 — the referee judges the composed op TUNABLE and PROCEEDS (no hold)', () => {
    const ops = canonicalise(resolveOrThrow(ADVISED_SENTENCE, graph()));
    const decision = evaluateEditGraphMutations({
      mode: 'live',
      operations: ops,
      currentGraph: graph(),
      currentGraphHash: 'hash-a',
      baseGraphHash: 'hash-a',
      freshness: 'fresh',
      scenarioId: 'scn-2-1266',
      turnId: 'turn-2-1266',
      requestId: 'req-2-1266',
    });
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
  });

  it('hops 3+4 — ACCEPTANCE 1: the value lands in the persisted row and the blocker clears', () => {
    const base = GraphV3.parse(graph()) as GraphV3T;
    const resolved = resolveOrThrow(ADVISED_SENTENCE, graph());
    const applied = applyPatchOperations(base, canonicalise(resolved));
    const { graph: encoded, unresolvedOptionIds } = encodeOptionInterventionsForEdit(
      applied,
      new Set([OPTION_ID]),
    );
    expect(unresolvedOptionIds).toEqual([]);

    const encodedNode = (encoded as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (n) => n.id === OPTION_ID,
    )!;
    expect(mergeInterventionSources(encodedNode)![FACTOR_ID]).toBeCloseTo(0.12);
    // The acknowledgement's own reader agrees — one reader, one answer.
    expect(readCommittedOptionEffect(encoded, OPTION_ID, FACTOR_ID)).toBeCloseTo(0.12);

    const after = computeStructuralReadiness(GraphV3.parse(encoded));
    expect(after?.options.find((o) => o.option_id === OPTION_ID)?.status).toBe('ready');

    // The blocker the repair copy is composed from is gone for THIS pair —
    // read off the same canonical payload the blocker copy uses (trap 12).
    const pairsAfter = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(encoded));
    expect(pairsAfter.some((p) => p.optionId === OPTION_ID && p.factorId === FACTOR_ID)).toBe(
      false,
    );
    // …and ONLY for this option: every other option's readiness status is
    // byte-identical to the pre-write reading. A write that "cleared the
    // blocker" by clearing everything would pass the assertion above.
    const before = computeStructuralReadiness(GraphV3.parse(graph()));
    const statusById = (r: ReturnType<typeof computeStructuralReadiness>) =>
      Object.fromEntries((r?.options ?? []).filter((o) => o.option_id !== OPTION_ID).map((o) => [o.option_id, o.status]));
    expect(statusById(after)).toEqual(statusById(before));
  });

  it('hop 5 — ACCEPTANCE 2 (composition): 2.427 says HONOURED and #1016 ALLOWS', () => {
    const base = GraphV3.parse(graph()) as GraphV3T;
    const resolved = resolveOrThrow(ADVISED_SENTENCE, graph());
    const applied = applyPatchOperations(base, canonicalise(resolved));
    const { graph: encoded } = encodeOptionInterventionsForEdit(applied, new Set([OPTION_ID]));

    // The 2.427 outcome guard owns the TEXT: it must see the intent HONOURED
    // for the option the user named, so the recovery copy never replaces the
    // acknowledgement.
    expect(
      evaluateConfigureOptionOutcome({
        message: ADVISED_SENTENCE,
        before: graph(),
        after: encoded,
      }),
    ).toEqual({ status: 'honoured', optionId: OPTION_ID });

    // #1016 owns the WRITE, and it lets this one through. The writer composes
    // with the guard rather than bypassing it — the guard runs over exactly
    // these two graphs in the dispatcher.
    const verdict = decideOptionInterventionWrite({
      message: ADVISED_SENTENCE,
      before: graph(),
      after: encoded,
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
    // NOT `interventions_write_landed`: the guard consults the outcome verdict
    // FIRST, and `honoured` short-circuits it. Naming the reason we actually
    // measured, not the one the mechanism suggests (trap 13c — derive the
    // expectation from the producer, never from a reading of what it "ought"
    // to say).
    expect(verdict).toEqual({ verdict: 'allow', reason: 'outcome_not_unhonoured' });
  });

  it('the guard\'s interventions-landed arm is REACHABLE — the write is not merely short-circuited', () => {
    // Positive control for the assertion above (trap 13): if the outcome guard
    // could never reach the interventions arm, the previous test would be
    // silent about whether the write is visible to #1016 at all. Drive the
    // SAME two graphs through the arm's own predicate.
    const base = GraphV3.parse(graph()) as GraphV3T;
    const resolved = resolveOrThrow(ADVISED_SENTENCE, graph());
    const applied = applyPatchOperations(base, canonicalise(resolved));
    const { graph: encoded } = encodeOptionInterventionsForEdit(applied, new Set([OPTION_ID]));
    expect(anyInterventionWriteLanded(base, GraphV3.parse(encoded) as GraphV3T)).toBe(true);
    // Opposite-direction twin: the unchanged graph shows no write.
    expect(anyInterventionWriteLanded(base, GraphV3.parse(graph()) as GraphV3T)).toBe(false);
  });

  it('ACCEPTANCE 5 — the chain still lands for a SURVIVOR after structural deletes', () => {
    const g = graph();
    const removed = new Set(
      g.nodes.filter((n) => n.kind === 'option' && n.id !== OPTION_ID).map((n) => n.id as string),
    );
    g.nodes = g.nodes.filter((n) => !removed.has(n.id as string));
    g.edges = g.edges.filter((e) => !removed.has(e.from as string) && !removed.has(e.to as string));
    // Positive control: the deletes really happened, and the graph still parses.
    expect(g.nodes.filter((n) => n.kind === 'option')).toHaveLength(1);
    expect(GraphV3.safeParse(g).success).toBe(true);

    const resolved = resolveOrThrow(ADVISED_SENTENCE, g);
    const applied = applyPatchOperations(GraphV3.parse(g) as GraphV3T, canonicalise(resolved));
    const { graph: encoded, unresolvedOptionIds } = encodeOptionInterventionsForEdit(
      applied,
      new Set([OPTION_ID]),
    );
    expect(unresolvedOptionIds).toEqual([]);
    expect(readCommittedOptionEffect(encoded, OPTION_ID, FACTOR_ID)).toBeCloseTo(0.12);
    const after = computeStructuralReadiness(GraphV3.parse(encoded));
    // The sole surviving option is now ready, so the whole model is.
    expect(after?.options.find((o) => o.option_id === OPTION_ID)?.status).toBe('ready');
  });

  it('EXTRACTOR-DELETION TWIN — a write for a DIFFERENT option does not clear this pair', () => {
    // The chain assertions above must be sensitive to WHICH option was written
    // (trap 19). Writing the same value on a sibling option leaves this
    // option's blocker in place and its status unchanged.
    const base = GraphV3.parse(graph()) as GraphV3T;
    const sibling = resolveOrThrow(
      "Set the Subcontract inner-city runs to green courier option's effect on "
        + `${WITNESS.ids.factor_label} to 0.12.`,
      graph(),
    );
    expect(sibling.optionId).not.toBe(OPTION_ID);
    const applied = applyPatchOperations(base, canonicalise(sibling));
    const { graph: encoded } = encodeOptionInterventionsForEdit(
      applied,
      new Set([sibling.optionId]),
    );
    expect(readCommittedOptionEffect(encoded, OPTION_ID, FACTOR_ID)).toBeUndefined();
    const pairsAfter = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(encoded));
    expect(pairsAfter.some((p) => p.optionId === OPTION_ID && p.factorId === FACTOR_ID)).toBe(true);
  });
});
