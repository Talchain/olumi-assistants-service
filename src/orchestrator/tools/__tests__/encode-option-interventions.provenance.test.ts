/**
 * ⭐⭐ WHOSE NUMBER IS THIS? — the encoder's provenance carry.
 *
 * `buildInterventionV3` stamped `source: 'user_specified'` UNCONDITIONALLY, so
 * a value the MODEL produced became permanently indistinguishable from one the
 * USER stated. Measured through the full apply chain at pristine `staging`:
 *
 *   AssertionError: expected 'user_specified' to be 'cee_hypothesis'
 *
 * That is the difference between "the product suggested 0.4 and I agreed" and
 * "I said 0.4" — and it is the question every later review of the model rests
 * on. It is not cosmetic: `obligation-provenance.ts` turns the stamp into an
 * OBLIGATION, so a mis-stamped estimate makes the product DEMAND that the user
 * own a number it invented.
 *
 * ⚠ EVERY GUARD HERE IS WRITTEN AGAINST THE CHAIN
 * (`parseEditGraphResponse` → `applyPatchOperations` → `encodeOptionInterventionsForEdit`),
 * never against a helper of this spec's own, so none can pass by agreeing with
 * itself. The cells are DERIVED from the readiness producer at test time rather
 * than transcribed — a self-authored fixture encodes the author's model of the
 * producer rather than the producer (CLAUDE.md trap 16-inverse).
 *
 * The graph is a REAL DATED CAPTURE (`witness-2026-08-17/j4-wrong-entity-write
 * .json`, deployed CEE `8be62df`, scenario J4), varied only by CLEARING option
 * interventions in memory. The capture file itself is never edited — it is a
 * historic record (trap 14b).
 *
 * ⚠ SPLIT OUT OF PR #1337, which carried this encoder fix alongside an
 * unrelated, currently-unreferenced handler. These guards drive the ENCODER
 * directly and depend on no handler, so they land with the live fix.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { assessCanonicalAnalysisReadiness } from '../analysis-ready-helper.js';
import { parseEditGraphResponse } from '../edit-graph.js';
import {
  PRESERVED_INTERVENTION_SOURCES,
  encodeOptionInterventionsForEdit,
} from '../encode-option-interventions.js';
import { applyPatchOperations } from '../../patch-applier.js';
import { selectAnswerableBlockers } from '../../../orchestrator-v5/routing/readiness-answer-chips.js';
import {
  classifyIssueObligation,
  classifyValueSource,
  obligationFor,
} from '../../../cee/graph-readiness/obligation-provenance.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../types.js';

const CAPTURE = JSON.parse(
  readFileSync(
    new URL(
      '../../../orchestrator-v5/__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } };

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

/** The witnessed arm: every option unconfigured, so every effect value is open. */
function zeroConfiguredGraph(): Graph {
  const graph = structuredClone(CAPTURE.draft_graph) as Graph;
  for (const node of graph.nodes) if (node.kind === 'option') node.interventions = {};
  return graph;
}

const assess = (graph: unknown) => assessCanonicalAnalysisReadiness(graph);

/**
 * An option/factor cell the PRODUCER itself raises as an answerable blocker
 * whose factor it knows — derived, never transcribed. Throws rather than
 * returning a fallback, so a capture that stopped raising blockers fails loudly
 * instead of turning every guard below into a pass-by-absence.
 */
function firstSettableCell(graph: unknown): { option_id: string; factor_id: string } {
  const answerable = selectAnswerableBlockers(assess(graph).blockingIssues);
  const issue = answerable.find(
    (i) =>
      typeof i.option_id === 'string'
      && i.option_id.length > 0
      && typeof i.factor_id === 'string'
      && i.factor_id.length > 0,
  );
  if (!issue) {
    throw new Error(
      'the capture no longer raises an answerable blocker with a known factor — '
      + 'these guards would otherwise pass by absence',
    );
  }
  return { option_id: issue.option_id as string, factor_id: issue.factor_id as string };
}

/**
 * Write one intervention through the real edit chain and read back what the
 * encoder committed. `value` is the raw op payload, so a guard can post any
 * shape a model or a user could actually produce.
 */
function encodeThroughChain(
  graph: Graph,
  cell: { option_id: string; factor_id: string },
  value: Record<string, unknown>,
  rationale: string,
): Record<string, unknown> {
  const operations = parseEditGraphResponse(
    JSON.stringify({
      operations: [
        {
          op: 'update_node',
          path: `/nodes/${cell.option_id}/data/interventions/${cell.factor_id}`,
          value,
          old_value: null,
          impact: 'moderate',
          rationale,
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: null,
    }),
  ).operations as PatchOperation[];
  const applied = applyPatchOperations(GraphV3.parse(graph), operations);
  const { graph: encoded } = encodeOptionInterventionsForEdit(applied, new Set([cell.option_id]));
  const node = (encoded as { nodes: Array<Record<string, unknown>> }).nodes.find(
    (n) => n.id === cell.option_id,
  );
  expect(node, `option ${cell.option_id} survives encoding`).toBeDefined();
  const stored = (node!.interventions as Record<string, Record<string, unknown>>)[cell.factor_id];
  // Reachability first: a missing entry would make every source assertion below
  // pass by absence rather than by survival (trap 13).
  expect(stored, `intervention ${cell.option_id}/${cell.factor_id} survives encoding`).toBeDefined();
  return stored!;
}

describe('encode-option-interventions — a model-authored value is not attributed to the user', () => {
  /**
   * ⭐⭐⭐ THE GUARD THAT IS RED AT PRISTINE `staging`.
   *
   * With the unconditional stamp restored, this reads:
   *   AssertionError: expected 'user_specified' to be 'cee_hypothesis'
   */
  it('a cee_hypothesis value reads back as cee_hypothesis, not user_specified', () => {
    const graph = zeroConfiguredGraph();
    const cell = firstSettableCell(graph);
    const stored = encodeThroughChain(
      graph,
      cell,
      {
        value: 0.4,
        source: 'cee_hypothesis',
        value_confidence: 'low',
        reasoning: 'Reviewed estimate.',
      },
      'estimate',
    );
    expect(stored.source).toBe('cee_hypothesis');
    expect(stored.value_confidence).toBe('low');
    expect(stored.reasoning).toBe('Reviewed estimate.');
  });

  it('a value with NO stated provenance still defaults to user_specified — the existing contract is unchanged', () => {
    // The control for the guard above. If the default had moved, every
    // pre-existing writer's provenance would have changed silently.
    const graph = zeroConfiguredGraph();
    const cell = firstSettableCell(graph);
    const stored = encodeThroughChain(graph, cell, { value: 0.4 }, 'user value');
    expect(stored.source).toBe('user_specified');
  });

  it('an UNRECOGNISED source cannot be smuggled in, and cannot claim user authorship', () => {
    // The allowlist holds only NON-user provenances, so this carry can narrow a
    // claim but never widen it. A junk value falls through to the default.
    const graph = zeroConfiguredGraph();
    const cell = firstSettableCell(graph);
    const stored = encodeThroughChain(
      graph,
      cell,
      { value: 0.4, source: 'totally_made_up', value_confidence: 'high' },
      'junk',
    );
    expect(stored.source).toBe('user_specified');
    // The confidence rides ONLY with a preserved provenance, never on its own.
    expect(stored.value_confidence).toBeUndefined();
  });

  it('a brief_extraction record is NOT carried — it defaults exactly as it did before', () => {
    // Not a regression: `brief_extraction` and the `user_specified` default are
    // the same `user_stated` class, so the obligation is unchanged either way.
    // What the narrow allowlist buys is that the live edit path gains no new way
    // to persist a "we read this in your brief" stamp the product wrote itself.
    const graph = zeroConfiguredGraph();
    const cell = firstSettableCell(graph);
    const stored = encodeThroughChain(
      graph,
      cell,
      { value: 0.4, source: 'brief_extraction', value_confidence: 'high' },
      'brief',
    );
    expect(stored.source).toBe('user_specified');
    expect(stored.value_confidence).toBeUndefined();
  });
});

describe('encode-option-interventions — the stamp changes the OBLIGATION, not just the string', () => {
  /**
   * ⭐⭐ THE BEHAVIOUR THE STRING EXISTS FOR — asserted, not just the string.
   *
   * Every other guard above asserts the literal `'cee_hypothesis'`. None
   * asserts what it BUYS, so a tidy-up that collapsed the allowlist would keep
   * them all green while restoring the demand.
   *
   * The live chain is `analysis-ready-helper` → `classifyIssueObligation` →
   * `structureProvenanceOfEffect` → `classifyValueSource(entry.source)`. So this
   * change alters obligation classification on the shared edit path: before,
   * EVERY encoder-written value was `user_specified` → `user_stated` →
   * `required`; now a model-authored one is `ai_drafted` → `offered`.
   *
   * That is the entire point of the mark — the product may OFFER to fill a
   * number it invented and may never DEMAND that the user own it — and it is
   * pinned with a DISCRIMINATING CONTROL rather than alone: the same issue, the
   * same graph, the same call, differing only in who wrote the value.
   *
   * ⚠ The AI arm is driven through the ENCODER chain. PR #1337 drove it through
   * a handler that has no caller; the claim is the encoder's either way, and
   * pinning it here keeps it independent of whether that handler ever ships.
   */
  it('⭐ an encoder-written cee_hypothesis value is ai_drafted/offered — a user-written one is still user_stated/required', () => {
    const graph = zeroConfiguredGraph();
    const assessment = assess(graph);
    const cell = firstSettableCell(graph);

    // The real issue from the producer, not a hand-built one — so the category
    // and code are the ones the live path classifies.
    const issue = assessment.blockingIssues.find(
      (i) => i.option_id === cell.option_id && i.factor_id === cell.factor_id,
    );
    expect(issue, 'the producer really raises this cell as a blocker').toBeDefined();

    // Precondition, in-test: before either write, this cell is unattributed — so
    // neither arm below can pass on state that was already there.
    expect(classifyIssueObligation(issue!, graph).provenance).toBe('unattributed');

    // ⭐ THE AI ARM, written through the real encoder chain.
    const aiGraph = structuredClone(graph);
    const operations = parseEditGraphResponse(
      JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: `/nodes/${cell.option_id}/data/interventions/${cell.factor_id}`,
            value: {
              value: 0.4,
              source: 'cee_hypothesis',
              value_confidence: 'low',
              reasoning: 'Reviewed estimate.',
            },
            old_value: null,
            impact: 'moderate',
            rationale: 'estimate',
          },
        ],
        removed_edges: [],
        warnings: [],
        coaching: null,
      }),
    ).operations as PatchOperation[];
    const applied = applyPatchOperations(GraphV3.parse(aiGraph), operations);
    const { graph: encoded } = encodeOptionInterventionsForEdit(
      applied,
      new Set([cell.option_id]),
    );

    const aiDecision = classifyIssueObligation(issue!, encoded);
    expect(aiDecision.provenance).toBe('ai_drafted');
    expect(aiDecision.obligation).toBe('offered');

    // ⭐ THE CONTROL. Identical call, identical issue, identical graph shape —
    // the ONLY difference is that the user stated this value. If it did not come
    // back `required`, the arm above would be agreeing with itself.
    const userGraph = structuredClone(graph);
    const userNode = userGraph.nodes.find((n) => n.id === cell.option_id)!;
    userNode.interventions = {
      [cell.factor_id]: {
        value: 0.4,
        source: 'user_specified',
        target_match: { node_id: cell.factor_id, match_type: 'exact_id', confidence: 'high' },
      },
    };
    const userDecision = classifyIssueObligation(issue!, userGraph);
    expect(userDecision.provenance).toBe('user_stated');
    expect(userDecision.obligation).toBe('required');
  });

  /**
   * ⭐ THE ALLOWLIST'S INVARIANT, DERIVED FROM THE AUTHORITY RATHER THAN RESTATED.
   *
   * `PRESERVED_INTERVENTION_SOURCES` may only ever hold provenances the estate
   * classes as NOT the user's. An earlier revision of this change also
   * allowlisted `brief_extraction` under a comment calling it one of "the two
   * NON-user provenances" — but `obligation-provenance.ts` maps it to
   * `user_stated`, the SAME class as `user_specified`, and
   * `obligationFor('user_stated')` is `required`.
   *
   * This reads the mapping out of the authority at test time, so it goes RED if
   * anyone re-adds a user provenance to the carry — including by a rename.
   */
  it('⭐ every preserved source is a NON-user provenance, checked against the authority', () => {
    expect(PRESERVED_INTERVENTION_SOURCES.size).toBeGreaterThan(0);
    for (const source of PRESERVED_INTERVENTION_SOURCES) {
      expect(classifyValueSource(source), `${source} must not be a user provenance`)
        .not.toBe('user_stated');
    }
    // CONTRAST CONTROL: the authority really does discriminate, so a green
    // result above is a fact about the allowlist and not about a probe that
    // returns the same answer for every input.
    expect(classifyValueSource('user_specified')).toBe('user_stated');
    expect(classifyValueSource('brief_extraction')).toBe('user_stated');
    expect(classifyValueSource('cee_hypothesis')).toBe('ai_drafted');
    // And the consequence, stated where it bites.
    expect(obligationFor('user_stated')).toBe('required');
    expect(obligationFor('ai_drafted')).toBe('offered');
  });
});
