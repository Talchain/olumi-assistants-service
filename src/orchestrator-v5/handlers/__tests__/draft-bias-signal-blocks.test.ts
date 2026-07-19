/**
 * Pin the draft bias-signal block projector against DGAI PR #356's contract.
 *
 * THE LESSON (verdict B, 2026-07-19): the real draft engine emits bias
 * signals as `{type, detail}` ONLY — the deployed BiasSignalSchema
 * (@talchain/schemas 0.18.0) is `z.object({type, detail}).strict()`, which
 * carries NO `target` and would reject one. The original projector required
 * a `target` that resolved to a graph node, so it skipped EVERY real signal
 * and emitted nothing on the wire — yet its test passed because the fixture
 * supplied a target the wire never has. Node-grounding is therefore now
 * OPTIONAL: a signal that names a resolvable target gets a grounded
 * `target_ref`; a signal that does not (the real wire shape) still emits a
 * card with `target_refs: []`. CoachingBlockSchema.target_refs is
 * `z.array(TargetRefSchema)` — no `.min(1)`, so `[]` validates.
 *
 * Every emitted block is validated against the REAL boundary
 * CoachingBlockSchema (the schema mapV5Blocks' V5Block type is derived
 * from), so the field shape the UI parser reads is pinned to the wire
 * contract, not a hand-copied shape.
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
// factor nodes a (rare) target-bearing signal could ground on.
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

// The REAL wire shape: BiasSignalSchema is {type, detail}.strict — NO target.
const STATUS_QUO = {
  type: 'status_quo_bias',
  detail: 'The model leans on keeping the current supplier without weighing the switch on equal terms.',
};
const ANCHORING = {
  type: 'anchoring',
  detail: 'Estimates cluster tightly around the initial quote rather than an independent range.',
};

// A target-bearing variant (legacy / hypothetical) used only to prove that
// grounding STILL attaches a resolved target_ref when a target is present.
const STATUS_QUO_TARGETED = { ...STATUS_QUO, target: 'fac_current_supplier' };
const ANCHORING_TARGETED = { ...ANCHORING, target: 'fac_initial_quote' };

function build(signals: unknown[], graph: GraphV3T | null = GRAPH) {
  return buildDraftBiasSignalBlocks({ biasSignals: signals, graph, createdAt: CREATED_AT });
}

describe('buildDraftBiasSignalBlocks — DGAI #356 producer contract', () => {
  // ── THE LOAD-BEARING PIN ──────────────────────────────────────────────
  // The real engine emits {type, detail} with NO target. The card MUST emit
  // (with target_refs: []) — the whole reason R-bias was dark on the wire.
  it('emits an ungrounded bias_signal block (target_refs: []) for a real no-target draft signal', () => {
    const blocks = build([STATUS_QUO]);

    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(CoachingBlockSchema.safeParse(block).success).toBe(true);
    expect(block.type).toBe('coaching');
    expect(block.coaching_kind).toBe('bias_signal');
    expect(block.source).toBe('draft_graph');
    expect(block.freshness).toBe('fresh');
    expect(block.title).toBe('Status quo bias');
    expect(block.body).toBe(STATUS_QUO.detail);
    // The empty array is schema-legal and is exactly what the wire carries.
    expect(block.target_refs).toEqual([]);
    expect(block.block_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('emits an ungrounded card for every real no-target signal (capped, engine order)', () => {
    const blocks = build([STATUS_QUO, ANCHORING]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.title)).toEqual(['Status quo bias', 'Anchoring']);
    expect(blocks.map((b) => b.body)).toEqual([STATUS_QUO.detail, ANCHORING.detail]);
    expect(blocks.map((b) => b.target_refs)).toEqual([[], []]);
    expect(blocks.map((b) => b.priority_rank)).toEqual([1, 2]);
    for (const b of blocks) {
      expect(CoachingBlockSchema.safeParse(b).success).toBe(true);
    }
    // block_ids are stable UUIDs, distinct per signal.
    expect(blocks[0]!.block_id).not.toBe(blocks[1]!.block_id);
  });

  // ── Optional grounding STILL attaches when a target resolves ───────────
  it('attaches a grounded target_ref when a signal DOES carry a resolvable target', () => {
    const blocks = build([STATUS_QUO_TARGETED, ANCHORING_TARGETED]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.title)).toEqual(['Status quo bias', 'Anchoring']);
    expect(blocks[0]!.target_refs).toEqual([
      { id: 'fac_current_supplier', label: 'Current supplier terms', kind: 'factor' },
    ]);
    expect(blocks[1]!.target_refs).toEqual([
      { id: 'fac_initial_quote', label: 'Initial quote', kind: 'factor' },
    ]);
    for (const b of blocks) {
      expect(CoachingBlockSchema.safeParse(b).success).toBe(true);
    }
  });

  it('emits zero blocks for zero signals', () => {
    expect(build([])).toEqual([]);
    expect(buildDraftBiasSignalBlocks({ biasSignals: null, graph: GRAPH, createdAt: CREATED_AT })).toEqual([]);
    expect(buildDraftBiasSignalBlocks({ biasSignals: undefined, graph: GRAPH, createdAt: CREATED_AT })).toEqual([]);
  });

  it('caps at 2 blocks and preserves engine order when 3+ signals arrive', () => {
    const third = { type: 'overconfidence', detail: 'The upside is stated more confidently than the evidence supports.' };
    const blocks = build([STATUS_QUO, ANCHORING, third]);
    expect(blocks).toHaveLength(DRAFT_BIAS_SIGNAL_CARD_CAP);
    expect(blocks.map((b) => b.title)).toEqual(['Status quo bias', 'Anchoring']);
  });

  it('fails closed on an unknown bias code (never sentence-cases a raw token)', () => {
    const unknown = { type: 'not_a_real_bias', detail: 'x'.repeat(20) };
    expect(build([unknown])).toEqual([]);
    // A known signal alongside an unknown one still emits — only the unknown drops.
    expect(build([unknown, ANCHORING]).map((b) => b.title)).toEqual(['Anchoring']);
  });

  it('fails closed on prototype-chain hostile codes', () => {
    expect(build([{ type: '__proto__', detail: 'x'.repeat(20) }])).toEqual([]);
    expect(build([{ type: 'constructor', detail: 'x'.repeat(20) }])).toEqual([]);
  });

  // ── Grounding degrades to target_refs: [] — it never drops the card ────
  it('degrades to target_refs: [] when the target is unresolvable / non-TargetRefKind / blank-label', () => {
    // unresolvable target id → ungrounded card still emits
    const [a] = build([{ ...ANCHORING, target: 'no_such_node' }]);
    expect(a).toBeDefined();
    expect(a!.title).toBe('Anchoring');
    expect(a!.target_refs).toEqual([]);
    expect(CoachingBlockSchema.safeParse(a).success).toBe(true);

    // target node kind is 'decision' — not a boundary TargetRefKind → ungrounded
    const [b] = build([{ ...ANCHORING, target: 'dec_supplier' }]);
    expect(b!.target_refs).toEqual([]);

    // blank-label node → ungrounded
    const blankLabelGraph = {
      nodes: [{ id: 'fac_x', kind: 'factor', label: '   ' }],
      edges: [],
    } as unknown as GraphV3T;
    const [c] = build([{ type: 'anchoring', detail: 'd'.repeat(20), target: 'fac_x' }], blankLabelGraph);
    expect(c!.target_refs).toEqual([]);
  });

  it('fails closed on malformed entries (non-object, blank/non-string detail)', () => {
    expect(build([null, 42, 'x', { type: 'anchoring', detail: '   ' }])).toEqual([]);
    expect(build([{ type: 'anchoring', detail: 123 }])).toEqual([]);
  });

  it('still emits ungrounded cards even without a graph (grounding is optional)', () => {
    const blocks = build([STATUS_QUO, ANCHORING], null);
    expect(blocks.map((b) => b.title)).toEqual(['Status quo bias', 'Anchoring']);
    expect(blocks.map((b) => b.target_refs)).toEqual([[], []]);
    for (const b of blocks) {
      expect(CoachingBlockSchema.safeParse(b).success).toBe(true);
    }
  });

  it('dedupes by canonical title BEFORE the cap so a duplicate cannot displace a distinct signal', () => {
    // anchoring / anchoring_bias share the canonical title 'Anchoring'; both
    // collapse to one, leaving room for the distinct status-quo signal.
    const aliasDup = { type: 'anchoring_bias', detail: ANCHORING.detail };
    const blocks = build([ANCHORING, aliasDup, STATUS_QUO]);
    expect(blocks.map((b) => b.title)).toEqual(['Anchoring', 'Status quo bias']);
  });

  it('length-caps an over-long body to the schema max (300)', () => {
    const long = { type: 'anchoring', detail: 'a'.repeat(500) };
    const [block] = build([long]);
    expect(block).toBeDefined();
    expect(block!.body.length).toBeLessThanOrEqual(300);
    expect(CoachingBlockSchema.safeParse(block).success).toBe(true);
  });
});
