/**
 * graph-compact — A VALUE THE USER STATED IS NEVER DESCRIBED AS THE AI'S GUESS
 *
 * ## THE INVARIANT, WRITTEN AGAINST THE SPEC (CLAUDE.md trap 13d)
 *
 * > A factor whose `observed_state.source` the estate's provenance authority
 * > classifies as `user_stated` must NEVER be projected into the LLM-context
 * > vocabulary as `ai_inferred` / `assumption`.
 *
 * It is deliberately NOT written as "user_override must map to user_set" — that
 * would be the failure mode in hand wearing an invariant's clothes, and it would
 * be silent about the other seven user literals. The authority is
 * `classifyValueSource` (`cee/graph-readiness/obligation-provenance.ts`), which
 * already answers "who authored this value?" over the whole twelve-member
 * contract vocabulary. This suite asserts the projection AGREES with it, so a
 * thirteenth literal added to the contract cannot bucket silently.
 *
 * ## WHY `observed_state.source` OUTRANKS `observed_state.extractionType`
 *
 * Derived from the writers, not assumed:
 *   - `canonicalise-value-ops.ts` `stampUserEditProvenance` (the chat-edit
 *     writer, live at `tools/edit-graph.ts:2823` and
 *     `orchestrator-v5/handlers/gm-held-execute.ts:481`) sets
 *     `observed_state.source = 'user_override'` and DOES NOT TOUCH
 *     `extractionType`.
 *   - `orchestrator-v5/tools/handlers/set-factor-value.ts:482` does the same,
 *     and says so at the bytes: "Overrides any producer stamp deliberately:
 *     this write IS the user's."
 * So on an edited node `source` is the LATEST and most specific statement of
 * authorship and `extractionType` is draft-time extraction metadata nobody
 * updated. A disagreement resolves to `source`.
 *
 * ## WHAT ABSENCE MEANS — AND WHY THE FALLBACK IS BYTE-UNCHANGED
 *
 * The shared contract is explicit: *"Absence means the producer stamped no
 * provenance — a consumer MUST NOT read absence as any particular class;
 * classify unknown/absent as neutral, never guess."* So an absent or
 * unrecognised `source` does NOT override anything: the projection falls
 * through to today's `extractionType` mapping, byte-for-byte. Every graph in
 * the pre-existing `graph-compact-provenance.test.ts` corpus carries no
 * `source` at all, which is why that suite stays green unchanged.
 *
 * ## ⚠ REACHABILITY, BOUNDED HONESTLY (CLAUDE.md trap 20)
 *
 * This projection is DERIVED-DARK at this tip, not witnessed-live. `CompactNode.source`
 * and `CompactNode.provenance` are stripped before the prompt:
 * `route-with-tool-use.ts` `buildUserMessage` destructures `graph` out of the
 * ContextPack and substitutes `display_graph`, whose `DisplaySafeNode`
 * (`format-graph-for-context.ts:41-69`) carries no provenance field and whose
 * `projectNode` never reads one. The only two production readers of
 * `CompactNode.source` — `decision-continuity.ts:240` and
 * `entity-state-tracker.ts:162` — are both behind functions with NO production
 * caller (the repo's own `diagnostics/feature-health.ts:188-195` states this of
 * `trackEntityStates()` by name). The context-budget trim even deletes the field
 * outright on its way past (`orchestrator/context/budget.ts:206`,
 * `delete n['source']`). So the fix below corrects a projection that is
 * presently WRITE-ONLY. It is worth correcting because the seam is explicitly
 * reserved for the user-edit path in its own comment, and a mapping that is
 * wrong while unread becomes wrong-and-read the day somebody wires it.
 * NO CLAIM IS MADE HERE THAT A MODEL HAS EVER SEEN THE WRONG VALUE.
 *
 * ⭐ AND WHERE THE MODEL *DOES* GET A PROVENANCE SIGNAL, IT IS ALREADY TRUTHFUL.
 * The one model-facing provenance channel on an ordinary turn is
 * `focus[].value_source`, set from the RAW stamp at
 * `orchestrator-v5/build-turn-context.ts:1063`
 * (`observed?.source !== undefined ? { value_source: observed.source }`) and
 * serialised through `buildUserMessage`'s `...rest`. It reads
 * `observed_state.source` directly, so it never had this defect — and it is
 * present only for nodes the user has SELECTED on the canvas. For an unselected
 * node the model receives no authorship signal at all. That is a capability gap,
 * NOT this lane's defect, and it is deliberately left alone here.
 *
 * ⭐ NO FRESHNESS IMPACT. `orchestrator-v5/context/graph-hash.ts:166`
 * projects `['value', 'baseline', 'cap']` only, so neither `source` nor
 * `extractionType` moves the analysis-affecting graph hash. Changing this
 * projection cannot flip a freshness verdict.
 */

import { describe, it, expect } from 'vitest';

import { OBSERVED_STATE_SOURCE_LITERALS } from '@talchain/schemas';

import { compactGraph } from '../../../../src/orchestrator/context/graph-compact.js';
import {
  canonicaliseValueOps,
  stampUserEditProvenance,
} from '../../../../src/orchestrator/canonicalise-value-ops.js';
import { applyPatchOperations } from '../../../../src/orchestrator/patch-applier.js';
import { classifyValueSource } from '../../../../src/cee/graph-readiness/obligation-provenance.js';
import type { GraphV3T } from '../../../../src/schemas/cee-v3.js';
import type { PatchOperation } from '../../../../src/orchestrator/types.js';

/**
 * A factor exactly as the DRAFT pipeline leaves it: an LLM-estimated value
 * carrying `extractionType: 'inferred'` and NO provenance stamp.
 */
function draftedGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Goal' },
      {
        id: 'fac_churn',
        kind: 'factor',
        label: 'Churn rate',
        observed_state: { value: 0.3, unit: '%', extractionType: 'inferred' },
      },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

/**
 * Put a graph node through the REAL chat-edit writer chain, in the exact
 * composition production uses at `tools/edit-graph.ts:2823`:
 *
 *     stampUserEditProvenance(canonicaliseValueOps(ops, graph).operations, ops)
 *     → applyPatchOperations(graph, …)
 *
 * ⚠ NOTHING HERE IS A HAND-WRITTEN POST-EDIT FIXTURE. A fixture the test author
 * writes encodes the author's model of the producer rather than the producer
 * (CLAUDE.md trap 16-inverse), and that is exactly how a sibling PR's kit came
 * to certify a node shape no producer emits. The only hand-written inputs are
 * the drafted node and the user's own edit operation.
 */
function userEditsValueTo(graph: GraphV3T, nodeId: string, newValue: number): GraphV3T {
  const ops: PatchOperation[] = [
    {
      op: 'update_node',
      path: nodeId,
      value: { observed_state: { value: newValue } },
    } as unknown as PatchOperation,
  ];
  const canonicalised = stampUserEditProvenance(
    canonicaliseValueOps(ops, graph).operations,
    ops,
  );
  return applyPatchOperations(graph, canonicalised);
}

function compactNode(graph: GraphV3T, id: string) {
  return compactGraph(graph).nodes.find((n) => n.id === id);
}

/** A factor carrying an arbitrary source/extractionType pair. */
function graphWith(
  source: string | undefined,
  extractionType: string | undefined,
): GraphV3T {
  const observed_state: Record<string, unknown> = { value: 0.3, unit: '%' };
  if (source !== undefined) observed_state.source = source;
  if (extractionType !== undefined) observed_state.extractionType = extractionType;
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Goal' },
      { id: 'fac_t', kind: 'factor', label: 'Target', observed_state },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

describe('graph-compact — the ROUND TRIP through the real user-edit writer', () => {
  it('PRECONDITION: the real writer stamps observed_state.source and leaves extractionType alone', () => {
    // Pin the precondition in-test (CLAUDE.md trap 13b). If the writer ever
    // starts maintaining `extractionType`, the round-trip assertion below would
    // pass for a reason that has nothing to do with the fix under test.
    const edited = userEditsValueTo(draftedGraph(), 'fac_churn', 0.42);
    const obs = (edited.nodes.find((n) => n.id === 'fac_churn') as unknown as {
      observed_state: Record<string, unknown>;
    }).observed_state;

    expect(obs.source).toBe('user_override');
    expect(obs.value).toBe(0.42);
    // ⚠ MEASURED, NOT ASSUMED, AND IT IS NOT WHAT THE DEFECT DESCRIPTION
    // PREDICTS. The drafted `extractionType: 'inferred'` does not merely go
    // un-refreshed by the user edit — it is GONE. `applyUpdateNode` treats the
    // optional `observed_state` as a scalar and REPLACES the whole object, and
    // `canonicaliseValueOps` merges stored siblings only onto leaf writes it
    // had to translate; an already-canonical value write carries nothing
    // forward. So the real post-edit observed_state is exactly
    // `{ value, source: 'user_override' }`.
    //
    // The consequence for this seam: on the live chat-edit path the projection
    // reaches the ABSENT-extractionType arm, not the `'inferred'` arm. Same
    // defect, different arm — worth pinning, because a reader reasoning from
    // the description alone would test the wrong branch.
    expect(obs.extractionType).toBeUndefined();
    expect(classifyValueSource(obs.source)).toBe('user_stated');
  });

  it('a factor the USER typed is described as the USER\'s, not as an AI inference', () => {
    const edited = userEditsValueTo(draftedGraph(), 'fac_churn', 0.42);
    const n = compactNode(edited, 'fac_churn');

    expect(n?.provenance).not.toBe('ai_inferred');
    expect(n?.source).not.toBe('assumption');
    expect(n?.provenance).toBe('user_set');
    expect(n?.source).toBe('user');
  });

  // ── OPPOSITE-DIRECTION TWIN ──────────────────────────────────────────────
  it('TWIN: a genuinely AI-inferred factor the user never touched is STILL described as an AI inference', () => {
    const n = compactNode(draftedGraph(), 'fac_churn');
    expect(n?.provenance).toBe('ai_inferred');
    expect(n?.source).toBe('assumption');
  });

  it('TWIN: an explicit cee_inference stamp stays an AI inference even after an unrelated node is edited', () => {
    const graph = graphWith('cee_inference', 'inferred');
    const n = compactNode(graph, 'fac_t');
    expect(n?.provenance).toBe('ai_inferred');
    expect(n?.source).toBe('assumption');
  });
});

describe('graph-compact — the WHOLE DOMAIN of the provenance predicate', () => {
  const EXTRACTION_STATES: readonly (string | undefined)[] = [
    undefined,
    'explicit',
    'inferred',
    'observed',
    'range',
    'mystery_value',
  ];

  // ── THE SPEC INVARIANT ───────────────────────────────────────────────────
  it('NO literal the authority calls user_stated is EVER projected as ai_inferred, for ANY extractionType', () => {
    const violations: string[] = [];
    for (const literal of OBSERVED_STATE_SOURCE_LITERALS) {
      if (classifyValueSource(literal) !== 'user_stated') continue;
      for (const et of EXTRACTION_STATES) {
        const n = compactNode(graphWith(literal, et), 'fac_t');
        if (n?.provenance === 'ai_inferred' || n?.source === 'assumption') {
          violations.push(`${literal} × extractionType=${String(et)} → ${String(n?.source)}/${String(n?.provenance)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // ── ITS OPPOSITE-DIRECTION TWIN ──────────────────────────────────────────
  it('TWIN: NO literal the authority calls ai_drafted or system_repaired is EVER projected as the user\'s', () => {
    const violations: string[] = [];
    for (const literal of OBSERVED_STATE_SOURCE_LITERALS) {
      const authored = classifyValueSource(literal);
      if (authored !== 'ai_drafted' && authored !== 'system_repaired') continue;
      for (const et of EXTRACTION_STATES) {
        const n = compactNode(graphWith(literal, et), 'fac_t');
        if (n?.source === 'user' || n?.provenance === 'user_set') {
          violations.push(`${literal} × extractionType=${String(et)} → ${String(n?.source)}/${String(n?.provenance)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('PRECONDITION: both direction sets are NON-EMPTY, so neither guard above can agree vacuously', () => {
    const userStated = OBSERVED_STATE_SOURCE_LITERALS.filter(
      (l) => classifyValueSource(l) === 'user_stated',
    );
    const machineAuthored = OBSERVED_STATE_SOURCE_LITERALS.filter((l) =>
      ['ai_drafted', 'system_repaired'].includes(classifyValueSource(l)),
    );
    expect(userStated.length).toBe(9);
    expect(machineAuthored.length).toBe(3);
    expect(userStated.length + machineAuthored.length).toBe(
      OBSERVED_STATE_SOURCE_LITERALS.length,
    );
  });

  // ── ABSENCE AND UNKNOWNS ARE BYTE-UNCHANGED ──────────────────────────────
  const E_BASELINE: ReadonlyArray<[string | undefined, string, string]> = [
    ['explicit', 'user', 'from_brief'],
    ['inferred', 'assumption', 'ai_inferred'],
    ['observed', 'system', 'from_brief'],
    ['range', 'system', 'ai_inferred'],
    ['mystery_value', 'system', 'ai_inferred'],
    [undefined, 'system', 'ai_inferred'],
  ];

  for (const [et, expectedSource, expectedProvenance] of E_BASELINE) {
    it(`ABSENT source × extractionType=${String(et)} keeps today's mapping byte-unchanged`, () => {
      const n = compactNode(graphWith(undefined, et), 'fac_t');
      expect(n?.source).toBe(expectedSource);
      expect(n?.provenance).toBe(expectedProvenance);
    });

    it(`UNRECOGNISED source × extractionType=${String(et)} keeps today's mapping byte-unchanged — never a guess`, () => {
      const n = compactNode(graphWith('some_future_producer_stamp', et), 'fac_t');
      expect(n?.source).toBe(expectedSource);
      expect(n?.provenance).toBe(expectedProvenance);
    });
  }

  it('a non-string source is treated as absent, never coerced', () => {
    const graph = graphWith(undefined, 'inferred');
    const node = graph.nodes[1] as unknown as { observed_state: Record<string, unknown> };
    node.observed_state.source = 42;
    const n = compactNode(graph, 'fac_t');
    expect(n?.source).toBe('assumption');
    expect(n?.provenance).toBe('ai_inferred');
  });

  it('_raw_provenance still records an unrecognised extractionType, source-stamped or not', () => {
    // The diagnostic must not be lost when `source` decides the projection.
    const withSource = compactNode(graphWith('user_override', 'mystery_value'), 'fac_t');
    const withoutSource = compactNode(graphWith(undefined, 'mystery_value'), 'fac_t');
    expect(withoutSource?._raw_provenance).toBe('mystery_value');
    expect(withSource?._raw_provenance).toBe('mystery_value');
  });
});
