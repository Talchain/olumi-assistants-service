/**
 * Pin the draft bias-signal block projector against DGAI PR #356's contract.
 *
 * Every emitted block is validated against the REAL boundary
 * CoachingBlockSchema (the schema mapV5Blocks' V5Block type is derived
 * from), so the field shape the UI parser reads — block_id, title, body,
 * coaching_kind, source, target_refs, priority_rank, freshness — is pinned
 * to the wire contract, not a hand-copied shape.
 *
 * Grounding rules mirror the UI-side bridge
 * (src/canvas/conversation/draftBiasSignalBlocks.ts) exactly.
 */
import { describe, it, expect } from 'vitest';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';

import {
  buildDraftBiasSignalBlocks,
  DRAFT_BIAS_SIGNAL_CARD_CAP,
} from '../draft-bias-signal-blocks.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

const CREATED_AT = '2026-07-19T12:00:00.000Z';

// A supplier-decision graph mirroring the 16-Jul CEE staging shape, with two
// factor nodes the bias signals ground on.
const GRAPH = {
  nodes: [
    { id: 'dec_supplier', kind: 'decision', label: 'Choose supplier strategy' },
    { id: 'opt_switch', kind: 'option', label: 'Switch supplier' },
    { id: 'fac_current_supplier', kind: 'factor', label: 'Current supplier terms' },
    { id: 'fac_initial_quote', kind: 'factor', label: 'Initial quote' },
    { id: 'goal_cost', kind: 'goal', label: 'Minimise total cost' },
  ],
  edges: [],
} as unknown as GraphV3T;

const STATUS_QUO = {
  type: 'status_quo_bias',
  detail: 'The model leans on keeping the current supplier without weighing the switch on equal terms.',
  target: 'fac_current_supplier',
};
const ANCHORING = {
  type: 'anchoring',
  detail: 'Estimates cluster tightly around the initial quote rather than an independent range.',
  target: 'fac_initial_quote',
};

function build(signals: unknown[], graph: GraphV3T | null = GRAPH) {
  return buildDraftBiasSignalBlocks({ biasSignals: signals, graph, createdAt: CREATED_AT });
}

describe('buildDraftBiasSignalBlocks — DGAI #356 producer contract', () => {
  it('emits 2 grounded bias_signal blocks that validate against CoachingBlockSchema', () => {
    const blocks = build([STATUS_QUO, ANCHORING]);

    expect(blocks).toHaveLength(2);

    // Contract: every block is a schema-valid boundary CoachingBlock.
    for (const b of blocks) {
      expect(CoachingBlockSchema.safeParse(b).success).toBe(true);
      expect(b.type).toBe('coaching');
      expect(b.coaching_kind).toBe('bias_signal');
      expect(b.source).toBe('draft_graph');
      expect(b.freshness).toBe('fresh');
      expect(typeof b.priority_rank).toBe('number');
    }

    // Canonical titles (one bias, one name — matches the DGAI registry).
    expect(blocks.map((b) => b.title)).toEqual(['Status quo bias', 'Anchoring']);
    // Body is the engine detail verbatim.
    expect(blocks.map((b) => b.body)).toEqual([STATUS_QUO.detail, ANCHORING.detail]);
    // Grounded target refs resolved against the graph.
    expect(blocks[0]!.target_refs).toEqual([
      { id: 'fac_current_supplier', label: 'Current supplier terms', kind: 'factor' },
    ]);
    expect(blocks[1]!.target_refs).toEqual([
      { id: 'fac_initial_quote', label: 'Initial quote', kind: 'factor' },
    ]);
    // Priority order = engine order.
    expect(blocks.map((b) => b.priority_rank)).toEqual([1, 2]);
    // block_id is a stable UUID (deterministic per signal).
    expect(blocks[0]!.block_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(blocks[0]!.block_id).not.toBe(blocks[1]!.block_id);
  });

  it('emits zero blocks for zero signals', () => {
    expect(build([])).toEqual([]);
    expect(buildDraftBiasSignalBlocks({ biasSignals: null, graph: GRAPH, createdAt: CREATED_AT })).toEqual([]);
    expect(buildDraftBiasSignalBlocks({ biasSignals: undefined, graph: GRAPH, createdAt: CREATED_AT })).toEqual([]);
  });

  it('caps at 2 blocks and preserves engine order when 3+ signals arrive', () => {
    const third = {
      type: 'optimism_bias',
      detail: 'The upside is stated more confidently than the evidence supports.',
      target: 'goal_cost',
    };
    const blocks = build([STATUS_QUO, ANCHORING, third]);
    expect(blocks).toHaveLength(DRAFT_BIAS_SIGNAL_CARD_CAP);
    expect(blocks.map((b) => b.title)).toEqual(['Status quo bias', 'Anchoring']);
  });

  it('fails closed on an unknown bias code (never sentence-cases a raw token)', () => {
    const unknown = { type: 'not_a_real_bias', detail: 'x'.repeat(20), target: 'fac_initial_quote' };
    expect(build([unknown])).toEqual([]);
    // A known signal alongside an unknown one still emits — only the unknown drops.
    expect(build([unknown, ANCHORING]).map((b) => b.title)).toEqual(['Anchoring']);
  });

  it('fails closed on prototype-chain hostile codes', () => {
    expect(build([{ type: '__proto__', detail: 'x'.repeat(20), target: 'fac_initial_quote' }])).toEqual([]);
    expect(build([{ type: 'constructor', detail: 'x'.repeat(20), target: 'fac_initial_quote' }])).toEqual([]);
  });

  it('fails closed on ungrounded signals (missing / unresolvable / blank-label / non-TargetRefKind target)', () => {
    // missing target
    expect(build([{ type: 'anchoring', detail: 'd'.repeat(20) }])).toEqual([]);
    // unresolvable target id
    expect(build([{ ...ANCHORING, target: 'no_such_node' }])).toEqual([]);
    // target node kind is 'decision' — not a boundary TargetRefKind
    expect(build([{ ...ANCHORING, target: 'dec_supplier' }])).toEqual([]);
    // blank-label node
    const blankLabelGraph = {
      nodes: [{ id: 'fac_x', kind: 'factor', label: '   ' }],
      edges: [],
    } as unknown as GraphV3T;
    expect(build([{ type: 'anchoring', detail: 'd'.repeat(20), target: 'fac_x' }], blankLabelGraph)).toEqual([]);
  });

  it('fails closed on malformed entries (non-object, blank/non-string detail)', () => {
    expect(build([null, 42, 'x', { type: 'anchoring', detail: '   ', target: 'fac_initial_quote' }])).toEqual([]);
    expect(build([{ type: 'anchoring', detail: 123, target: 'fac_initial_quote' }])).toEqual([]);
  });

  it('emits nothing without a graph to ground against', () => {
    expect(build([STATUS_QUO, ANCHORING], null)).toEqual([]);
  });

  it('dedupes identical (title, target) pairs BEFORE the cap so a duplicate cannot displace a distinct signal', () => {
    // anchoring / anchoring_bias share the canonical title 'Anchoring'; both
    // grounded on the same node collapse to one, leaving room for the distinct
    // status-quo signal.
    const aliasDup = { type: 'anchoring_bias', detail: ANCHORING.detail, target: 'fac_initial_quote' };
    const blocks = build([ANCHORING, aliasDup, STATUS_QUO]);
    expect(blocks.map((b) => b.title)).toEqual(['Anchoring', 'Status quo bias']);
  });

  it('length-caps an over-long body to the schema max (300)', () => {
    const long = { type: 'anchoring', detail: 'a'.repeat(500), target: 'fac_initial_quote' };
    const [block] = build([long]);
    expect(block).toBeDefined();
    expect(block!.body.length).toBeLessThanOrEqual(300);
    expect(CoachingBlockSchema.safeParse(block).success).toBe(true);
  });
});
