/**
 * ROADMAP 2.396(b) — "CEE writes observed_state WITHOUT `source` on chat-set
 * values → the 'User edited' pill can never earn on that lane."
 *
 * ── The measured defect (P4 transport lane, 2026-08-05) ─────────────────────
 * The UI's `isReviewedByUser` earns the "User edited" pill from
 * `observed_state.source` ∈ {user_confirmed, user_assumption, user_override,
 * user, user_edited} (witnessed pill-earning wire literal, runE2 of
 * journey-witness-final-2026-08-04: `observed_state.source:"user_override"`).
 * CEE's chat-edit lanes wrote NO source at all:
 *   · edit-graph normal path + held/confirm path (via canonicalise-value-ops):
 *     nothing stamped — neither `source` nor `provenance`;
 *   · set_factor_value: stamps `provenance:'user_set'` only, and the V3
 *     response transform CLOBBERS node provenance from extractionType
 *     (`schema-v3.ts` — `v3Node.provenance = nodeProvenanceDisplay(...)`), so
 *     the provenance rung is unreliable on the wire; `observed_state.source`
 *     is the carrier that demonstrably survives to the UI.
 * So every chat-set value rendered as "Olumi estimate — check first" forever.
 *
 * ── The fix pinned here ─────────────────────────────────────────────────────
 * `stampUserEditProvenance` (canonicalise-value-ops.ts) stamps, INTO THE OP
 * (pre-apply, so the stamp rides the applier → canonical parse →
 * `batchFullyLanded` unchanged — stamping the canonical graph after the fact
 * would trip `updateWritesSurvived`'s deepEqual):
 *   · `observed_state.source: 'user_override'` — the pill's primary rung;
 *   · node-level `provenance: 'user_set'` — the set_factor_value precedent.
 * Applied at BOTH edit seams (edit-graph.ts and gm-held-execute.ts — the held
 * half is pinned in gm-held-provenance-stamp.test.ts).
 *
 * Plus the schema half: `ObservedStateV3.source` was
 * z.enum(['brief_extraction','cee_inference']) — structurally incapable of
 * carrying ANY user stamp, and a UI-stamped persisted graph (the UI writes
 * user_override / user_confirmed / user into the shared store since #581)
 * would FAIL CEE's GraphV3 parse at every edit seam. Widened to the user-owned
 * literals the estate actually writes.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  canonicaliseValueOps,
  stampUserEditProvenance,
  reconcileObservedValuePair,
} from '../canonicalise-value-ops.js';
import { handleEditGraph } from '../tools/edit-graph.js';
import { GraphV3, ObservedStateV3 } from '../../schemas/cee-v3.js';
import type { PatchOperation } from '../types.js';
import type { ConversationContext } from '../types.js';
import type { LLMAdapter } from '../../adapters/llm/types.js';

// ── schema half: the enum can now carry the user's stamp ────────────────────

describe('ObservedStateV3.source — the user-owned members exist', () => {
  it('accepts every source literal the estate actually writes', () => {
    // Producers (CEE): brief_extraction, cee_inference. User-owned (UI writers
    // + this lane's stamp): the five literals the UI's REVIEWED_SOURCES
    // recognises. A UI-stamped stored graph must not fail CEE's edit-seam
    // parse.
    for (const source of [
      'brief_extraction',
      'cee_inference',
      'user_override',
      'user_confirmed',
      'user_assumption',
      'user',
      'user_edited',
    ]) {
      const r = ObservedStateV3.safeParse({ value: 0.5, source });
      expect(r.success, `source '${source}' must parse`).toBe(true);
    }
  });

  it('still REJECTS an arbitrary string — the vocabulary stays closed', () => {
    expect(ObservedStateV3.safeParse({ value: 0.5, source: 'llm_generated' }).success).toBe(false);
    expect(ObservedStateV3.safeParse({ value: 0.5, source: '' }).success).toBe(false);
  });

  it('a graph whose factor carries a UI stamp parses (the pre-fix parse failure)', () => {
    const graph = {
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        {
          id: 'f',
          kind: 'factor',
          label: 'Factor',
          observed_state: { value: 0.7, source: 'user_override' },
        },
      ],
      edges: [
        {
          from: 'f',
          to: 'g',
          strength: { mean: 0.4, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      ],
    };
    expect(GraphV3.safeParse(graph).success).toBe(true);
  });
});

// ── the stamp function ──────────────────────────────────────────────────────

const CURRENT_GRAPH = {
  nodes: [
    { id: 'g', kind: 'goal', label: 'Goal' },
    {
      id: 'fac_target',
      kind: 'factor',
      label: 'Target factor',
      observed_state: { value: 0.2, unit: '£', raw_value: 20000, cap: 100000 },
    },
    { id: 'fac_other', kind: 'factor', label: 'Untouched factor' },
  ],
  edges: [],
};

function valueOp(overrides: Partial<PatchOperation> = {}): PatchOperation {
  return {
    op: 'update_node',
    path: 'fac_target',
    value: { 'data/value': 0.5 },
    ...overrides,
  } as PatchOperation;
}

/**
 * Canonicalise, stamp, then reconcile the value pair — the exact composition
 * both seams run.
 *
 * ⚠ 2.1033: this helper is a MIRROR of the seams' chain, and it silently
 * stopped being one. It ran only canonicalise+stamp while both seams gained a
 * third step, so it asserted a `raw_value` the product no longer persists.
 * Kept in sync deliberately — if you add a step to either seam, add it here,
 * or this file's comment becomes the most convincing stale claim in the repo.
 */
function canonicaliseAndStamp(ops: PatchOperation[]): PatchOperation[] {
  return reconcileObservedValuePair(
    stampUserEditProvenance(canonicaliseValueOps(ops, CURRENT_GRAPH).operations),
    CURRENT_GRAPH,
  );
}

describe('stampUserEditProvenance — the op-level stamp', () => {
  it('stamps source + provenance onto a translated value op, BOUND BY PATH IDENTITY', () => {
    const [stamped] = canonicaliseAndStamp([valueOp()]);
    expect(stamped!.op).toBe('update_node');
    expect(stamped!.path).toBe('fac_target'); // identity, not a value predicate
    const v = stamped!.value as Record<string, unknown>;
    const observed = v.observed_state as Record<string, unknown>;
    expect(observed.source).toBe('user_override');
    expect(v.provenance).toBe('user_set');
    // The merge siblings the canonicaliser threaded are untouched.
    expect(observed.value).toBe(0.5);
    expect(observed.unit).toBe('£');
    // 2.1033 — was `20000`, which pinned the defect: the op moved `value` to
    // 0.5 of a 100000 cap (= £50k) while the denormalised sibling the
    // formatter reads FIRST still said £20k, so the canvas kept rendering the
    // number the user had just replaced. The sibling is now re-derived from
    // the authoritative `value` (0.5 x 100000).
    expect(observed.raw_value).toBe(50000);
    expect(observed.cap).toBe(100000);
  });

  it('stamps a CANONICALLY-spelled observed_state value write too (no translation needed)', () => {
    const [stamped] = stampUserEditProvenance([
      valueOp({ value: { observed_state: { value: 0.9, unit: '£' } } }),
    ]);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    >;
    expect(observed.source).toBe('user_override');
    expect(observed.value).toBe(0.9);
    expect(observed.unit).toBe('£');
  });

  it('OVERRIDES an LLM-claimed producer source — the user confirmed this write', () => {
    const [stamped] = stampUserEditProvenance([
      valueOp({ value: { observed_state: { value: 0.9, source: 'cee_inference' } } }),
    ]);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    >;
    expect(observed.source).toBe('user_override');
  });

  it('does NOT stamp a value-less observed_state write (unit-only edits are not the pill claim)', () => {
    const op = valueOp({ value: { observed_state: { unit: '%' } } });
    const [out] = stampUserEditProvenance([op]);
    expect(out).toBe(op); // by reference — untouched
  });

  it('does NOT stamp non-update_node ops or label-only updates, and returns them BY REFERENCE', () => {
    const addOp = {
      op: 'add_node',
      path: 'risk_x',
      value: { id: 'risk_x', kind: 'risk', label: 'Risk' },
    } as PatchOperation;
    const labelOp = valueOp({ value: { label: 'Renamed' } });
    const out = stampUserEditProvenance([addOp, labelOp]);
    expect(out[0]).toBe(addOp);
    expect(out[1]).toBe(labelOp);
  });

  it('never mutates its input ops', () => {
    const op = valueOp({ value: { observed_state: { value: 0.9 } } });
    const frozen = JSON.parse(JSON.stringify(op));
    stampUserEditProvenance([op]);
    expect(op).toEqual(frozen);
  });
});

// ── end-to-end on the NORMAL edit seam ──────────────────────────────────────
// Mirrors the persisted-false-success harness: the REAL handleEditGraph loop
// with the live slash-keyed spelling. RED before the seam wiring: the applied
// graph carried NO source and NO provenance on the edited node.

function buildContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'dec_a', kind: 'decision', label: 'Decide' },
        {
          id: 'fac_cash',
          kind: 'factor',
          label: 'Monthly Cash',
          category: 'controllable',
          observed_state: {
            value: 0.5,
            source: 'cee_inference',
            factor_type: 'cost',
            extractionType: 'inferred',
          },
        },
        { id: 'out_profit', kind: 'goal', label: 'Profit' },
      ],
      edges: [
        {
          from: 'fac_cash',
          to: 'out_profit',
          strength: { mean: -0.35, std: 0.1 },
          exists_probability: 0.88,
          effect_direction: 'negative',
        },
      ],
    },
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-2396b-repro',
  } as unknown as ConversationContext;
}

function makeAdapter(responseJson: unknown): LLMAdapter {
  return {
    name: 'fixtures',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(responseJson),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'test-model',
      latencyMs: 1,
      stopReason: 'end_turn',
    }),
  } as unknown as LLMAdapter;
}

describe('normal edit seam — a chat-set value earns the user stamp on the APPLIED graph', () => {
  it('⭐ the edited node carries source user_override + provenance user_set (2.396(b))', async () => {
    const result = await handleEditGraph(
      buildContext(),
      'Change the monthly cash factor to 0.42',
      makeAdapter({
        operations: [
          {
            op: 'update_node',
            path: '/nodes/fac_cash/data/value',
            value: 0.42,
            old_value: null,
            impact: 'moderate',
            rationale: 'Set as requested.',
          },
        ],
        removed_edges: [],
        warnings: [],
        coaching: { summary: 'Updated Monthly Cash.', rerun_recommended: true },
      }),
      'req-2396b',
      'turn-2396b',
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();

    const nodes = (result.appliedGraph as { nodes: Array<Record<string, unknown>> }).nodes;
    // Identity binding: the EDITED node, by id.
    const edited = nodes.find((n) => n.id === 'fac_cash')!;
    const observed = edited.observed_state as Record<string, unknown>;
    expect(observed.value).toBe(0.42);
    expect(observed.source).toBe('user_override');
    expect(edited.provenance).toBe('user_set');

    // Negative control: the untouched goal node earned NOTHING.
    const goal = nodes.find((n) => n.id === 'out_profit')!;
    expect(goal.provenance).not.toBe('user_set');
  });
});
