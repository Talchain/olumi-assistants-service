/**
 * ROADMAP 2.474 / AMENDMENT A3 — THE CAP BECOMES A SPLIT, NOT A DEAD TURN.
 *
 * ── THE FRAME UNDER TEST IS A MEASURED ONE ─────────────────────────────────
 * `PHASE0-EVIDENCE-2026-07-28/witness-2474-live-2026-08-05.md`, PROBE C. The
 * canonical headline sentence ("give each option its own driver") composed a
 * real structural batch on the deployed build — the server itself reported
 * "3 node operations and 12 edge operations" — and the whole thing was
 * discarded on caps the user cannot see. Across ten runs of that sentence the
 * tool produced a usable proposal TWICE.
 *
 * `PROBE_C_SHAPE` below is that composition: three new factors, each wired to
 * four nodes that are already in the model. Fifteen operations, fifteen
 * envelopes, twelve edge ops — legal on the operation count, illegal on both
 * the envelope cap (8) and the edge budget (8).
 *
 * ── THE POSITIVE CONTROL IS NOT OPTIONAL (trap 13) ─────────────────────────
 * `PROBE_D_SHAPE` is the six-operation batch that DID hold live (probe D
 * rung 0). It must take the SINGLE-proposal path. Without it, every "this
 * splits" assertion below could be satisfied by a partitioner that splits
 * everything, and the suite would prove nothing about when splitting happens.
 *
 * ── WHAT WOULD HAVE TO BE TRUE FOR THESE GUARDS TO PASS WHILE THE PROPERTY
 *    FAILS (trap 13b), and the case written for each ────────────────────────
 *  · a partitioner that TRUNCATES would satisfy "every part is cap-legal"
 *    perfectly → the CONSERVATION test reassembles the parts and compares to
 *    the input, in order;
 *  · a partitioner that splits by position rather than by dependency would
 *    also produce cap-legal parts → the INDEPENDENCE test asserts no part of
 *    the headline shape names a node an earlier part creates, and its
 *    DISCRIMINATING TWIN asserts the flag goes TRUE on a batch that genuinely
 *    is dependent (neither test alone shows the flag means anything);
 *  · a validator that partitioned an UNGROUNDED batch would look identical on
 *    every case here → the grounding-wins test puts an invented id inside an
 *    over-cap batch and demands a rejection, not a partition.
 *
 * Every assertion binds by IDENTITY — a named id or a named label — never by a
 * value predicate another operation could satisfy (trap 19).
 */
import { describe, expect, it } from 'vitest';

import {
  buildStructuralEditGrounding,
  validateProposedStructuralEdit,
} from '../propose-structural-edit.js';
import {
  deriveSplitLimits,
  measurePart,
  partitionStructuralEditBatch,
} from '../structural-edit-batch-split.js';
import { PROPOSAL_CAP } from '../../graph-management/types.js';
import {
  MAX_EDGE_OPS,
  MAX_NODE_OPS,
} from '../../../orchestrator/tools/patch-budget-limits.js';
import { buildReadyGraph } from '../../graph-management/__tests__/fixtures.js';

const GRAPH = buildReadyGraph();
const OPTS = { maxPatchOperations: 15 } as const;
const LIMITS = deriveSplitLimits(OPTS.maxPatchOperations);

function grounding() {
  const g = buildStructuralEditGrounding(GRAPH);
  if (g === null) throw new Error('fixture graph must be groundable');
  return g;
}

/** The four EXISTING nodes each new driver is wired to. All are in the fixture. */
const WIRED_TO = ['g-profit', 'f-spend', 'f-reach', 'd-choice'] as const;

/** The three new drivers, named so every assertion can bind to one by id. */
const NEW_DRIVERS = [
  { id: 'f-driver-a', label: 'Plan A cost driver' },
  { id: 'f-driver-b', label: 'Plan B cost driver' },
  { id: 'f-driver-c', label: 'Shared overhead driver' },
] as const;

/**
 * PROBE C, reconstructed: 3 add_node + 12 add_edge = 15 operations.
 * Operations are INTERLEAVED (each create immediately followed by its links),
 * which is how a model actually composes this — and which a position-based
 * splitter would get right by accident. The `interleaved: false` variant below
 * defeats that accident.
 */
function probeCShape(interleaved = true): { operations: unknown[] } {
  const creates = NEW_DRIVERS.map((d) => ({
    op: 'add_node',
    path: d.id,
    value: { id: d.id, kind: 'factor', label: d.label },
  }));
  const links = NEW_DRIVERS.flatMap((d) =>
    WIRED_TO.map((target) => ({
      op: 'add_edge',
      path: `${d.id}::${target}`,
      value: { from: d.id, to: target },
    })),
  );
  if (!interleaved) return { operations: [...creates, ...links] };
  return {
    operations: NEW_DRIVERS.flatMap((d) => [
      creates.find((c) => c.path === d.id)!,
      ...links.filter((l) => l.value.from === d.id),
    ]),
  };
}

/** PROBE D rung 0, reconstructed: the six-op batch that DID hold live. */
const PROBE_D_SHAPE = {
  operations: [
    ...NEW_DRIVERS.map((d) => ({
      op: 'add_node',
      path: d.id,
      value: { id: d.id, kind: 'factor', label: d.label },
    })),
    ...NEW_DRIVERS.map((d) => ({
      op: 'add_edge',
      path: `${d.id}::g-profit`,
      value: { from: d.id, to: 'g-profit' },
    })),
  ],
};

function accept(payload: unknown) {
  const result = validateProposedStructuralEdit(payload, grounding(), OPTS);
  if (!result.ok) throw new Error(`validator rejected the fixture: ${result.code} — ${result.reason}`);
  return result;
}

// ---------------------------------------------------------------------------

describe('⭐ THE WITNESSED FRAME — probe C composes 3 node + 12 edge ops', () => {
  it('is OVER the caps that killed it live: 12 edge ops > MAX_EDGE_OPS, 15 envelopes > PROPOSAL_CAP', () => {
    // The premise, measured rather than asserted. If this ever stops being
    // true the test below is testing a frame that no longer reproduces the
    // defect, and it must go red HERE rather than pass quietly downstream.
    const ops = probeCShape().operations as { op: string; path: string; value: unknown }[];
    const m = measurePart(ops);
    expect(m.operationCount).toBe(15);
    expect(m.nodeOps).toBe(3);
    expect(m.edgeOps).toBe(12);
    expect(m.envelopeCount).toBe(15);
    expect(m.edgeOps).toBeGreaterThan(MAX_EDGE_OPS);
    expect(m.envelopeCount).toBeGreaterThan(PROPOSAL_CAP);
    expect(m.operationCount).toBeLessThanOrEqual(OPTS.maxPatchOperations);
  });

  it('is ACCEPTED and SPLIT — not rejected. This is the defect, killed', () => {
    const result = validateProposedStructuralEdit(probeCShape(), grounding(), OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.parts.length).toBeGreaterThan(1);
    // The whole batch survives on the acceptance — nothing is dropped at the
    // validator, only distributed.
    expect(result.operations).toHaveLength(15);
  });

  it('splits into ONE PART PER DRIVER, each part bound to its named driver by id', () => {
    const result = accept(probeCShape());
    expect(result.parts).toHaveLength(3);
    // IDENTITY binding: part k creates driver k and links only from driver k.
    // A value predicate ("some part has 5 ops") would be satisfied by a split
    // that mixed the drivers together — which is exactly the split that would
    // make the later parts ungrounded.
    NEW_DRIVERS.forEach((driver, i) => {
      const part = result.parts[i]!;
      const created = part.operations.filter((o) => o.op === 'add_node').map((o) => o.path);
      expect(created).toEqual([driver.id]);
      const linkSources = part.operations
        .filter((o) => o.op === 'add_edge')
        .map((o) => (o.value as { from: string }).from);
      expect(new Set(linkSources)).toEqual(new Set([driver.id]));
      expect(linkSources).toHaveLength(WIRED_TO.length);
    });
  });

  it('every part independently satisfies EVERY cap on the path', () => {
    for (const part of accept(probeCShape()).parts) {
      const m = measurePart(part.operations);
      expect(m.operationCount).toBeLessThanOrEqual(OPTS.maxPatchOperations);
      expect(m.nodeOps).toBeLessThanOrEqual(MAX_NODE_OPS);
      expect(m.edgeOps).toBeLessThanOrEqual(MAX_EDGE_OPS);
      expect(m.envelopeCount).toBeLessThanOrEqual(PROPOSAL_CAP);
      // The part's own reported fan-out agrees with the producer the referee
      // consumes — a part that lied about its size would pass every cap check
      // above while being rejected at the gate.
      expect(part.envelopeCount).toBe(m.envelopeCount);
    }
  });

  it('EVERY part is INDEPENDENT — no part waits on a node an earlier part creates', () => {
    for (const part of accept(probeCShape()).parts) {
      expect(part.dependsOnEarlierPart).toBe(false);
    }
  });

  it('splits the SAME WAY when the model emits all creates first — dependency, not position', () => {
    // A position-based splitter gets the interleaved shape right by accident
    // and this shape wrong: it would put all three creates plus five links in
    // part 1 and leave part 2 naming nodes that are not in the model yet.
    const result = accept(probeCShape(false));
    expect(result.parts).toHaveLength(3);
    for (const part of result.parts) expect(part.dependsOnEarlierPart).toBe(false);
    NEW_DRIVERS.forEach((driver, i) => {
      expect(
        result.parts[i]!.operations.filter((o) => o.op === 'add_node').map((o) => o.path),
      ).toEqual([driver.id]);
    });
  });
});

describe('⭐ POSITIVE CONTROL (trap 13) — a normal-sized request still takes the SINGLE-proposal path', () => {
  it('probe D`s six-operation batch produces exactly ONE part, carrying every operation', () => {
    const result = accept(PROBE_D_SHAPE);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.operations).toEqual(result.operations);
    expect(result.parts[0]!.dependsOnEarlierPart).toBe(false);
  });

  it('and it is genuinely under the caps — so the single part is a verdict, not a default', () => {
    const m = measurePart(accept(PROBE_D_SHAPE).operations);
    expect(m.nodeOps).toBe(3);
    expect(m.edgeOps).toBe(3);
    expect(m.envelopeCount).toBe(6);
    expect(m.envelopeCount).toBeLessThanOrEqual(PROPOSAL_CAP);
  });
});

/**
 * ⚠ A CORRECTED PREMISE, RECORDED RATHER THAN QUIETLY FIXED.
 *
 * This block first asserted that concatenating the parts reproduces the input
 * IN ORDER. It went red, and it was right to: a dependency-clustering splitter
 * MOVES an operation next to the create it names, so global order cannot
 * survive — that reordering is the whole mechanism by which the headline case
 * yields independent parts. The claim below is the one the code provides, and
 * it is what "never silently truncate" actually needs: nothing lost, nothing
 * duplicated, local order kept, and creates always ahead of their references.
 */
describe('⭐ NEVER SILENTLY TRUNCATE — conservation, stated as what it really is', () => {
  for (const [name, shape] of [
    ['interleaved', probeCShape()],
    ['all creates first', probeCShape(false)],
  ] as const) {
    it(`(${name}) every operation lands in exactly ONE part — none dropped, none duplicated`, () => {
      const result = accept(shape);
      const indices = result.parts.flatMap((p) => [...p.indices]);
      expect(new Set(indices).size).toBe(indices.length);
      expect([...indices].sort((a, b) => a - b)).toEqual(
        Array.from({ length: result.operations.length }, (_, i) => i),
      );
      // And the operations carried by a part ARE the operations at those
      // indices — a part could otherwise report honest indices while carrying
      // something else entirely.
      for (const part of result.parts) {
        expect([...part.operations]).toEqual(part.indices.map((i) => result.operations[i]));
      }
    });

    it(`(${name}) within a part, the model's own ordering is preserved`, () => {
      for (const part of accept(shape).parts) {
        const ascending = [...part.indices].sort((a, b) => a - b);
        expect([...part.indices]).toEqual(ascending);
      }
    });

    it(`(${name}) a create is never in a LATER part than something naming it`, () => {
      const result = accept(shape);
      const partOfIndex = new Map<number, number>();
      result.parts.forEach((p, pi) => p.indices.forEach((i) => partOfIndex.set(i, pi)));
      const creatorPart = new Map<string, number>();
      result.operations.forEach((op, i) => {
        if (op.op === 'add_node') creatorPart.set(op.path, partOfIndex.get(i)!);
      });
      result.operations.forEach((op, i) => {
        if (op.op !== 'add_edge') return;
        const { from, to } = op.value as { from: string; to: string };
        for (const endpoint of [from, to]) {
          const created = creatorPart.get(endpoint);
          if (created !== undefined) {
            expect(created).toBeLessThanOrEqual(partOfIndex.get(i)!);
          }
        }
      });
    });
  }
});

/**
 * A shape where TWO clusters share ONE part, and their indices interleave.
 * Three drivers with two links each, creates emitted first: clusters are
 * {0,3,4}, {1,5,6}, {2,7,8}. Nine envelopes is over the cap, so it splits; the
 * first two clusters fit together at six envelopes, so part 1 holds indices
 * from both. Concatenating clusters gives [0,3,4,1,5,6] — NOT ascending. This
 * is the only fixture in the suite that can see the within-part sort, and
 * without it that sort is unobserved.
 */
const MERGED_CLUSTERS = {
  operations: [
    ...NEW_DRIVERS.map((d) => ({
      op: 'add_node',
      path: d.id,
      value: { id: d.id, kind: 'factor', label: d.label },
    })),
    ...NEW_DRIVERS.flatMap((d) =>
      ['g-profit', 'f-spend'].map((t) => ({
        op: 'add_edge',
        path: `${d.id}::${t}`,
        value: { from: d.id, to: t },
      })),
    ),
  ],
};

describe('two clusters in one part — the model`s ordering survives the merge', () => {
  it('the fixture really does merge two clusters into part 1', () => {
    const result = accept(MERGED_CLUSTERS);
    expect(result.parts.length).toBeGreaterThan(1);
    const creates = result.parts[0]!.operations.filter((o) => o.op === 'add_node');
    expect(creates.length).toBeGreaterThan(1);
  });

  it('indices within every part are ASCENDING, so the merge does not shuffle the batch', () => {
    for (const part of accept(MERGED_CLUSTERS).parts) {
      expect([...part.indices]).toEqual([...part.indices].sort((a, b) => a - b));
    }
  });

  it('and every create still precedes the links naming it', () => {
    const result = accept(MERGED_CLUSTERS);
    const partOf = new Map<number, number>();
    result.parts.forEach((p, pi) => p.indices.forEach((i) => partOf.set(i, pi)));
    result.operations.forEach((op, i) => {
      if (op.op !== 'add_edge') return;
      const from = (op.value as { from: string }).from;
      const creator = result.operations.findIndex(
        (o) => o.op === 'add_node' && o.path === from,
      );
      expect(partOf.get(creator)!).toBeLessThanOrEqual(partOf.get(i)!);
    });
  });
});

describe('the dependency flag MEANS something — a discriminating pair', () => {
  /**
   * One driver wired to NINE targets cannot fit a part (9 edges > 8), so its
   * cluster must be broken and the second half genuinely waits on the first.
   * Paired with the headline case above, which is the same shape at a legal
   * size and reports FALSE: neither reading alone shows the flag is bound to
   * anything.
   */
  const OVERSIZED_CLUSTER = {
    operations: [
      {
        op: 'add_node',
        path: 'f-driver-a',
        value: { id: 'f-driver-a', kind: 'factor', label: 'Plan A cost driver' },
      },
      ...['g-profit', 'f-spend', 'f-reach', 'd-choice', 'o-a', 'o-b'].map((t) => ({
        op: 'add_edge',
        path: `f-driver-a::${t}`,
        value: { from: 'f-driver-a', to: t },
      })),
      ...['g-profit', 'f-spend', 'f-reach'].map((t) => ({
        op: 'add_edge',
        path: `${t}::f-driver-a`,
        value: { from: t, to: 'f-driver-a' },
      })),
    ],
  };

  it('a cluster too large for one part becomes DEPENDENT parts, and says so', () => {
    const result = accept(OVERSIZED_CLUSTER);
    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts[0]!.dependsOnEarlierPart).toBe(false);
    expect(result.parts.slice(1).some((p) => p.dependsOnEarlierPart)).toBe(true);
    // The create still leads: nothing names 'f-driver-a' before it exists.
    expect(result.parts[0]!.operations[0]!.path).toBe('f-driver-a');
    expect(result.parts[0]!.operations[0]!.op).toBe('add_node');
  });
});

describe('an honest REFUSAL remains where no partition can help', () => {
  it('a single operation larger than one reviewable change is refused, and the copy says WHAT', () => {
    // One update writing nine fields fans out to nine envelopes. No partition
    // of the batch can make that operation legal.
    const value: Record<string, number> = {};
    for (let i = 0; i < PROPOSAL_CAP + 1; i += 1) value[`field_${i}`] = i / 100;
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'update_node', path: 'f-spend', target_label: 'Marketing spend', value },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('BATCH_CAP_EXCEEDED');
    // The refusal names the situation and a next step, not just a limit.
    expect(result.reason).toContain(String(PROPOSAL_CAP));
    expect(result.reason).toContain('fewer fields');
  });

  it('a partition needing more parts than allowed is refused, naming the count', () => {
    // Eight three-field updates = 24 envelopes = 3 per part at best, but the
    // node budget binds first (4 node ops per part) → 2 parts. Push past
    // maxParts by shrinking the pipeline cap the limits derive from.
    const tightLimits = deriveSplitLimits(4); // maxParts = 2
    const operations = Array.from({ length: 9 }, (_, i) => ({
      op: 'update_node',
      path: 'f-spend',
      value: { [`field_${i}`]: i / 100 },
    }));
    const partition = partitionStructuralEditBatch(operations, tightLimits);
    expect(partition.ok).toBe(false);
    if (partition.ok) throw new Error('unreachable');
    expect(partition.failure).toBe('too_many_parts');
    expect(partition.partsNeeded).toBeGreaterThan(tightLimits.maxParts);
  });

  it('the runaway OPERATION-COUNT guard is untouched — a batch over the pipeline cap still refuses', () => {
    const operations = Array.from({ length: 4 }, () => ({
      op: 'update_node',
      path: 'f-spend',
      target_label: 'Marketing spend',
      value: { observed_state: { value: 0.7 } },
    }));
    const result = validateProposedStructuralEdit({ operations }, grounding(), {
      maxPatchOperations: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('BATCH_CAP_EXCEEDED');
    expect(result.reason).toContain('3');
  });
});

describe('⭐ GROUNDING STILL WINS — an ungrounded batch is never partitioned', () => {
  it('one invented id inside an OVER-CAP batch rejects the whole thing, and returns no parts', () => {
    const payload = probeCShape();
    // Not the first op, and every other op is perfectly grounded — a validator
    // that partitioned first would hand back two clean parts and one dirty one.
    (payload.operations as { op: string; path: string; value: unknown }[])[7] = {
      op: 'add_edge',
      path: 'f-driver-b::f-ghost',
      value: { from: 'f-driver-b', to: 'f-ghost' },
    };
    const result = validateProposedStructuralEdit(payload, grounding(), OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNKNOWN_ENTITY_ID');
    expect(result.reason).toContain('f-ghost');
  });
});

/**
 * ⚠ THIS BLOCK EXISTS BECAUSE TWO MUTANTS SURVIVED, and the reason each
 * survived is a different thing worth recording.
 *
 * Deleting the NODE-budget check from the part sizer changed nothing on any
 * fixture above: in every one of them the envelope cap binds first. That is a
 * COVERAGE GAP, not an equivalence — the node budget is a real cap with a real
 * frame that reaches it, and the first case below is that frame.
 *
 * Deleting the EDGE-budget check also changed nothing, for a different and
 * more interesting reason: every edge operation projects to AT LEAST one
 * envelope, so `edgeOps <= envelopeCount` always holds — and at the shipped
 * values `MAX_EDGE_OPS` and `PROPOSAL_CAP` are BOTH 8, so the envelope cap
 * subsumes the edge budget exactly. The check is therefore unobservable today
 * and would start binding the moment `PROPOSAL_CAP` moved. The second case
 * proves it is wired up by relaxing the envelope cap and watching the edge
 * budget do the splitting on its own — demonstrated, not asserted.
 */
describe('every cap in the sizer is REACHABLE, including the ones the others hide', () => {
  it('the NODE budget splits a batch the envelope cap would have let through', () => {
    // Five creates: 5 envelopes (under the cap of 8) but 5 node ops (over 4).
    const operations = Array.from({ length: MAX_NODE_OPS + 1 }, (_, i) => ({
      op: 'add_node',
      path: `f-new-${i}`,
      value: { id: `f-new-${i}`, kind: 'factor', label: `New factor ${i}` },
    }));
    const whole = measurePart(operations);
    expect(whole.nodeOps).toBeGreaterThan(MAX_NODE_OPS);
    expect(whole.envelopeCount).toBeLessThanOrEqual(PROPOSAL_CAP); // the cap that does NOT bind
    const partition = partitionStructuralEditBatch(operations, LIMITS);
    expect(partition.ok).toBe(true);
    if (!partition.ok) throw new Error('unreachable');
    expect(partition.parts).toHaveLength(2);
    for (const part of partition.parts) {
      expect(measurePart(part.operations).nodeOps).toBeLessThanOrEqual(MAX_NODE_OPS);
    }
  });

  it('the EDGE budget splits on its own once the envelope cap stops hiding it', () => {
    const operations = Array.from({ length: MAX_EDGE_OPS + 1 }, (_, i) => ({
      op: 'add_edge',
      path: `f-spend::f-reach-${i}`,
      value: { from: 'f-spend', to: `f-reach-${i}` },
    }));
    // Control first: at the SHIPPED limits the two caps are indistinguishable.
    const m = measurePart(operations);
    expect(m.edgeOps).toBe(m.envelopeCount);
    expect(LIMITS.maxEdgeOps).toBe(LIMITS.maxEnvelopes);
    // Now relax the envelope cap so only the edge budget can bind.
    const relaxed = { ...LIMITS, maxEnvelopes: 100 };
    const partition = partitionStructuralEditBatch(operations, relaxed);
    expect(partition.ok).toBe(true);
    if (!partition.ok) throw new Error('unreachable');
    expect(partition.parts).toHaveLength(2);
    for (const part of partition.parts) {
      expect(measurePart(part.operations).edgeOps).toBeLessThanOrEqual(MAX_EDGE_OPS);
    }
  });
});

describe('the caps a part is sized against are DERIVED from what enforces them', () => {
  it('the split limits ARE the pipeline`s own constants, not a copy of their values', () => {
    expect(LIMITS.maxNodeOps).toBe(MAX_NODE_OPS);
    expect(LIMITS.maxEdgeOps).toBe(MAX_EDGE_OPS);
    expect(LIMITS.maxEnvelopes).toBe(PROPOSAL_CAP);
    expect(LIMITS.maxOperations).toBe(OPTS.maxPatchOperations);
  });

  it('maxParts is derived from the tightest cap, with a floor of two', () => {
    expect(deriveSplitLimits(15).maxParts).toBe(Math.ceil(15 / MAX_NODE_OPS));
    expect(deriveSplitLimits(1).maxParts).toBe(2);
  });
});
