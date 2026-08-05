/**
 * ROADMAP 2.474 / A3 — ACCEPTANCE ON A CAPTURED GRAPH, NOT A FIXTURE I WROTE.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ────────────────────────────────────────
 * An external reviewer ran the canonical phrase across independent models and
 * sessions and got ZERO usable proposals (my own brief said 2 in 10), with
 * `BATCH_CAP_EXCEEDED` on the wire. Its correction to method was the sharp
 * part: *a fixture you write encodes your model of the producer, not the
 * producer*. So the graph below is not written here. It is
 * `codex-deep-review-2026-08-05-raw/canvas-export-1785945361783.json`, a real
 * canvas export from the failing session, converted only in SHAPE (the UI's
 * `{id, type, data:{label, kind}}` and `{source, target}` to CEE's
 * `{id, kind, label}` and `{from, to}`) and in nothing else. Every id, label,
 * kind and edge is the producer's.
 *
 * ⚠ TWO CORRECTIONS TO THE BRIEF I WAS GIVEN, both measured here:
 *  1. The graph I was told to use is "17-node/32-edge". The captured artefacts
 *     do not contain one. The nearest are probe L at 17 nodes / 36 EDGES and
 *     this export at 20 nodes / 34 edges. I use THIS one because probe L's
 *     capture is a DOM scrape carrying ids and aria text but NO node kinds —
 *     it cannot ground a tool call without me inventing the kinds, which is
 *     precisely the fixture-I-wrote failure the correction warned about.
 *  2. This export carries FOUR options, so it is the four-option boundary the
 *     reviewer's acceptance gate names. The five-option case is built by
 *     adding one option to it, and that addition is disclosed as mine.
 *
 * ── THE REVIEWER'S ARITHMETIC, CHECKED ─────────────────────────────────────
 * "Four new drivers plus four connections consume the ENTIRE cap." Measured
 * below: 4 creates + 4 links = 8 envelopes = PROPOSAL_CAP exactly. It fits, and
 * it fits with ZERO room — one removal, reconnection or update on top and the
 * batch is over. That is a knife-edge, not a working capability, and it is why
 * the five-option case and the four-option-plus-cleanup case matter more than
 * the bare four.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildStructuralEditGrounding,
  validateProposedStructuralEdit,
} from '../propose-structural-edit.js';
import { measurePart } from '../structural-edit-batch-split.js';
import { PROPOSAL_CAP } from '../../graph-management/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const CAPTURED = JSON.parse(
  readFileSync(join(here, 'captured', 'canvas-export-2026-08-05.json'), 'utf8'),
) as { nodes: { id: string; kind: string; label: string }[]; edges: { from: string; to: string }[] };

const OPTS = { maxPatchOperations: 15 } as const;

function grounding(graph: unknown = CAPTURED) {
  const g = buildStructuralEditGrounding(graph);
  if (g === null) throw new Error('captured graph must be groundable');
  return g;
}

const OPTION_IDS = CAPTURED.nodes.filter((n) => n.kind === 'option').map((n) => n.id);
const GOAL_ID = CAPTURED.nodes.find((n) => n.kind === 'goal')!.id;

/** "Give each option its own driver" against N options, as the tool composes it. */
function driversFor(optionIds: readonly string[]) {
  return {
    operations: optionIds.flatMap((optId, i) => {
      const driverId = `fac_driver_${i}`;
      return [
        {
          op: 'add_node',
          path: driverId,
          value: { id: driverId, kind: 'factor', label: `Driver for option ${i + 1}` },
        },
        {
          op: 'add_edge',
          path: `${driverId}::${optId}`,
          value: { from: driverId, to: optId },
        },
      ];
    }),
  };
}

describe('the captured graph is the one that failed, and it is intact', () => {
  it('carries 20 nodes, 34 edges and FOUR options, all from the producer', () => {
    expect(CAPTURED.nodes).toHaveLength(20);
    expect(CAPTURED.edges).toHaveLength(34);
    // Bound by IDENTITY to the producer's own option ids.
    expect(OPTION_IDS).toEqual([
      'opt_hire_sales',
      'opt_partner',
      'opt_self_serve',
      'opt_status_quo',
    ]);
    // ⚠ These two values were GUESSED when this file was first written, and the
    // captured graph corrected both ('goal_mrr_250k' / 'Hire 2 Senior AEs' were
    // mine; the producer says otherwise). That is the whole argument for using
    // a capture rather than a fixture, demonstrated on its first run.
    expect(GOAL_ID).toBe('goal_mrr');
  });

  it('grounds — the tool can see every node the export contains', () => {
    const g = grounding();
    expect(g.nodeIds.size).toBe(20);
    expect(g.labelById.get('opt_hire_sales')).toBe('Hire Two Sales Reps');
  });
});

describe('⭐ THE FOUR-OPTION BOUNDARY — the reviewer`s arithmetic, measured', () => {
  const FOUR = driversFor(OPTION_IDS);

  it('four drivers plus four links is EXACTLY the cap, with zero room left', () => {
    const m = measurePart(FOUR.operations);
    expect(m.operationCount).toBe(8);
    expect(m.envelopeCount).toBe(PROPOSAL_CAP);
    expect(m.envelopeCount).toBeLessThanOrEqual(PROPOSAL_CAP);
  });

  it('so it is ONE complete held plan with ONE confirm — the acceptance gate', () => {
    const result = validateProposedStructuralEdit(FOUR, grounding(), OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.operations).toEqual(result.operations);
  });

  it('⚠ but ONE more operation tips it over — the knife-edge, named', () => {
    const plusOne = {
      operations: [
        ...FOUR.operations,
        // A single reconnection on top: the shape the reviewer said cannot fit.
        {
          op: 'add_edge',
          path: `fac_driver_0::${GOAL_ID}`,
          value: { from: 'fac_driver_0', to: GOAL_ID },
        },
      ],
    };
    expect(measurePart(plusOne.operations).envelopeCount).toBeGreaterThan(PROPOSAL_CAP);
    const result = validateProposedStructuralEdit(plusOne, grounding(), OPTS);
    // BEFORE this lane: BATCH_CAP_EXCEEDED, a dead turn. Now: proposals.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.parts.length).toBeGreaterThan(1);
  });
});

describe('⭐ THE FIVE-OPTION CASE — the one that could not fit by construction', () => {
  // The fifth option is MINE, added to the producer's graph. Disclosed rather
  // than blended in, because the graph's authority is exactly what makes this
  // file worth having.
  const FIFTH = { id: 'opt_channel_resell', kind: 'option', label: 'Reseller channel' };
  const GRAPH_5 = { nodes: [...CAPTURED.nodes, FIFTH], edges: [...CAPTURED.edges] };
  const FIVE = driversFor([...OPTION_IDS, FIFTH.id]);

  it('ten envelopes against a cap of eight — over by construction, not by luck', () => {
    const m = measurePart(FIVE.operations);
    expect(m.operationCount).toBe(10);
    expect(m.envelopeCount).toBe(10);
    expect(m.envelopeCount).toBeGreaterThan(PROPOSAL_CAP);
  });

  it('is ACCEPTED and becomes cap-legal proposals rather than a dead turn', () => {
    const result = validateProposedStructuralEdit(FIVE, grounding(GRAPH_5), OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.parts.length).toBeGreaterThan(1);
    for (const part of result.parts) {
      expect(part.envelopeCount).toBeLessThanOrEqual(PROPOSAL_CAP);
    }
  });

  it('every part is INDEPENDENTLY confirmable — no part waits on another', () => {
    const result = validateProposedStructuralEdit(FIVE, grounding(GRAPH_5), OPTS);
    if (!result.ok) throw new Error('unreachable');
    for (const part of result.parts) {
      expect(part.dependsOnEarlierPart).toBe(false);
    }
  });

  it('each part carries whole option-driver units, bound to the producer`s option ids', () => {
    const result = validateProposedStructuralEdit(FIVE, grounding(GRAPH_5), OPTS);
    if (!result.ok) throw new Error('unreachable');
    // A driver and the link to ITS option are never separated: identity
    // binding on the producer's own ids, not "each part has an edge".
    for (const part of result.parts) {
      const created = part.operations
        .filter((o) => o.op === 'add_node')
        .map((o) => o.path);
      const linkSources = part.operations
        .filter((o) => o.op === 'add_edge')
        .map((o) => (o.value as { from: string }).from);
      expect(new Set(linkSources)).toEqual(new Set(created));
    }
    // And nothing is lost across the split.
    const allTargets = result.parts
      .flatMap((p) => p.operations)
      .filter((o) => o.op === 'add_edge')
      .map((o) => (o.value as { to: string }).to);
    expect(new Set(allTargets)).toEqual(new Set([...OPTION_IDS, FIFTH.id]));
  });
});

describe('the reviewer`s harder shape — drivers PLUS cleanup on the real graph', () => {
  it('adds four drivers, links them, and rewires an existing edge — still proposals', () => {
    const existing = CAPTURED.edges[0]!;
    const operations = [
      ...driversFor(OPTION_IDS).operations,
      {
        op: 'remove_edge',
        path: `${existing.from}::${existing.to}`,
      },
      {
        op: 'update_node',
        path: GOAL_ID,
        target_label: CAPTURED.nodes.find((n) => n.id === GOAL_ID)!.label,
        value: { description: 'Reviewed as part of the driver restructure' },
      },
    ];
    expect(measurePart(operations).envelopeCount).toBeGreaterThan(PROPOSAL_CAP);
    const result = validateProposedStructuralEdit({ operations }, grounding(), OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.parts.length).toBeGreaterThan(1);
    // Conservation on the real graph: nothing is dropped.
    const indices = result.parts.flatMap((p) => [...p.indices]);
    expect([...indices].sort((a, b) => a - b)).toEqual(
      Array.from({ length: operations.length }, (_, i) => i),
    );
  });
});
