/**
 * THE TWO PERSIST-MERGE TWINS ARE DELIBERATELY DIFFERENT AND MUST STAY THAT WAY.
 *
 * `mergeAppliedGraphForPersistence` (edit-graph-dispatch.ts, the edit/delete
 * path) and `mergeMutatedGraphForPersistence` (d1-shared/apply-graph-mutation.ts,
 * the D1 handler path) look near-identical — both answer "merge the changed
 * structural fields back onto the server-authoritative persisted shape". They
 * are NOT interchangeable. Each is WRONG on the other's path, in OPPOSITE
 * directions:
 *
 *   AXIS 1 — top-level `options[]` deleted-entry pruning.
 *     applied: PRUNES (precedence rule 4) · mutated: PRESERVES.
 *     The edit path removes nodes, so a deleted option must also leave the
 *     canonical `options[]` roster that live readers prefer. The D1 path never
 *     removes a node (set_factor_value / add_constraint / adjust_edge_strength
 *     all mutate in place), so it has no provably-deleted entry to drop and
 *     pruning there could only ever destroy a legitimate entry.
 *
 *   AXIS 2 — top-level `goal_constraints` overlay.
 *     applied: does NOT overlay · mutated: DOES overlay.
 *     No edit_graph operation writes top-level `goal_constraints`, so the edit
 *     path must let the base keep its own. D1 `add_constraint` OWNS that field,
 *     so the D1 path must overlay it or the constraint the user just added never
 *     lands.
 *
 * Swap either twin for the other and you reproduce a real defect one field over:
 * the applied→mutated swap on `structural_delete` is the P0 where a deleted
 * option's node disappears while `options[]` still lists it.
 *
 * ⚠ WHY THIS FILE EXISTS. Before it, that entire distinction was carried by
 * PROSE COMMENTS ONLY. Measured at 832e762c in an isolated worktree: swapping
 * the twin at the `structural_delete` call site left the ten most relevant
 * suites at 137/137 GREEN, while a positive control that threw at the same line
 * REDed 6 times — so the line is genuinely exercised and the swap was simply
 * invisible. A distinction nothing can turn red is a comment, not a guard.
 *
 * NOT a duplicate of `graph-management/__tests__/isolation-guards.test.ts`: that
 * enforces an IMPORT BOUNDARY inside the graph-management module (Track 3 may not
 * import the D1 merge at all). This file pins the BEHAVIOURAL DIFFERENCE between
 * the two twins repo-wide, and the call-site binding by EFFECT.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { mergeMutatedGraphForPersistence } from '../tools/handlers/d1-shared/apply-graph-mutation.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { applyStructuralDelete } from '../system-events/structural-delete.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const REQ = 'req-persist-merge-twins';
const SCEN = '11111111-2222-3333-4444-555555555555';

/**
 * A persisted graph carrying an option in BOTH places GraphV3 keeps options:
 * an option-KIND node AND the top-level `options[]` mirror that live readers
 * (the ContextPack projection among them) prefer.
 */
function persistedWithOptionRoster(): Record<string, unknown> {
  return {
    goal_node_id: 'g',
    schema_version: '3.0',
    nodes: [
      { id: 'g', kind: 'goal', label: 'Grow revenue' },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
      { id: 'o-wait', kind: 'option', label: 'Wait a quarter' },
      { id: 'f-cost', kind: 'factor', label: 'Contractor cost' },
    ],
    edges: [
      {
        from: 'f-cost',
        to: 'g',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
    options: [
      { id: 'o-launch', label: 'Launch now' },
      { id: 'o-wait', label: 'Wait a quarter' },
    ],
    goal_constraints: [
      { constraint_id: 'c-base', node_id: 'g', operator: '>=' as const, value: 0.1 },
    ],
    meta: { roots: ['f-cost'], leaves: ['g'] },
  };
}

/** The same graph with `o-launch` removed from `nodes` — i.e. a delete applied. */
function appliedWithOptionNodeRemoved(base: Record<string, unknown>): GraphV3T {
  const parsed = GraphV3.safeParse({
    ...base,
    nodes: (base.nodes as Array<{ id: string }>).filter((n) => n.id !== 'o-launch'),
  });
  if (!parsed.success) throw new Error('fixture failed GraphV3 parse');
  return parsed.data;
}

function optionIds(graph: Record<string, unknown>): string[] {
  const opts = graph.options;
  return Array.isArray(opts)
    ? opts
        .map((o) => (o && typeof o === 'object' ? (o as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === 'string')
    : [];
}

describe('persist-merge twins — AXIS 1: options[] deleted-entry pruning', () => {
  it('the APPLIED twin drops an options[] entry whose node this change removed', () => {
    const base = persistedWithOptionRoster();
    const applied = appliedWithOptionNodeRemoved(base);

    // ── PRECONDITIONS PINNED IN-TEST. Rule 4 fires only when the id was a base
    // NODE and is absent from the applied graph. A fixture that silently stopped
    // satisfying that would make this whole test a tautology.
    expect(optionIds(base)).toContain('o-launch');
    expect((base.nodes as Array<{ id: string }>).map((n) => n.id)).toContain('o-launch');
    expect(applied.nodes.map((n) => n.id)).not.toContain('o-launch');

    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: applied,
      persistedBase: base,
      ingressBase: GraphStateIngressSchema.parse(base),
      requestId: REQ,
      scenarioId: SCEN,
    });

    expect(optionIds(merged)).not.toContain('o-launch');
    // Bind by identity: the SURVIVING entry must still be there, so this is a
    // targeted prune and not "options[] got emptied".
    expect(optionIds(merged)).toEqual(['o-wait']);
  });

  it('the MUTATED twin PRESERVES that entry — and that is correct on its own path', () => {
    const base = persistedWithOptionRoster();
    const applied = appliedWithOptionNodeRemoved(base);

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: applied as unknown as Record<string, unknown>,
      persistedBase: base,
      requestId: REQ,
      scenarioId: SCEN,
    });

    // No D1 mutation removes a node, so this twin has no provably-deleted entry
    // to drop. On the EDIT path this same behaviour is the P0.
    expect(optionIds(merged)).toEqual(['o-launch', 'o-wait']);
  });

  it('the two twins therefore DISAGREE on identical input — they are not interchangeable', () => {
    const base = persistedWithOptionRoster();
    const applied = appliedWithOptionNodeRemoved(base);

    const viaApplied = mergeAppliedGraphForPersistence({
      appliedGraph: applied,
      persistedBase: base,
      ingressBase: GraphStateIngressSchema.parse(base),
      requestId: REQ,
      scenarioId: SCEN,
    });
    const viaMutated = mergeMutatedGraphForPersistence({
      mutatedGraph: applied as unknown as Record<string, unknown>,
      persistedBase: base,
      requestId: REQ,
      scenarioId: SCEN,
    });

    expect(optionIds(viaApplied)).not.toEqual(optionIds(viaMutated));
  });
});

describe('persist-merge twins — AXIS 2: top-level goal_constraints overlay', () => {
  it('the MUTATED twin overlays goal_constraints the mutation wrote (D1 add_constraint owns it)', () => {
    const base = persistedWithOptionRoster();
    const mutated = {
      ...base,
      goal_constraints: [
        { constraint_id: 'c-d1', node_id: 'g', operator: '>=' as const, value: 0.78 },
      ],
    };

    // Precondition: the two differ, or the assertion below proves nothing.
    expect(base.goal_constraints).not.toEqual(mutated.goal_constraints);

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: mutated,
      persistedBase: base,
      requestId: REQ,
      scenarioId: SCEN,
    });

    expect(merged.goal_constraints).toEqual([
      { constraint_id: 'c-d1', node_id: 'g', operator: '>=', value: 0.78 },
    ]);
  });

  it('the APPLIED twin does NOT overlay it — the base keeps its own (no edit op writes it)', () => {
    const base = persistedWithOptionRoster();
    const appliedParse = GraphV3.safeParse({
      ...base,
      goal_constraints: [
        { constraint_id: 'c-edit', node_id: 'g', operator: '>=' as const, value: 0.78 },
      ],
    });
    if (!appliedParse.success) throw new Error('fixture failed GraphV3 parse');

    // Precondition: GraphV3 really did carry the different value through, so a
    // non-overlay is a decision and not a fixture that lost the field.
    expect(appliedParse.data.goal_constraints).toEqual([
      { constraint_id: 'c-edit', node_id: 'g', operator: '>=', value: 0.78 },
    ]);

    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: appliedParse.data,
      persistedBase: base,
      ingressBase: GraphStateIngressSchema.parse(base),
      requestId: REQ,
      scenarioId: SCEN,
    });

    expect(merged.goal_constraints).toEqual([
      { constraint_id: 'c-base', node_id: 'g', operator: '>=', value: 0.1 },
    ]);
  });
});

describe('persist-merge twins — the structural_delete call site is bound BY EFFECT', () => {
  it('deleting an option node also drops its top-level options[] entry', () => {
    const persistedGraph = persistedWithOptionRoster();

    // Preconditions pinned in-test.
    expect(optionIds(persistedGraph)).toEqual(['o-launch', 'o-wait']);

    const baseGraphHash = computeAnalysisAffectingGraphHash(
      persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    );
    const payload = {
      kind: 'system_event',
      scenario_id: SCEN,
      turn_id: 'turn-twins-1',
      stage: 'frame',
      event: {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch'],
        removed_edges: [],
        base_graph_hash: baseGraphHash,
      },
    } as unknown as SystemEventTurnPayload;

    const result = applyStructuralDelete({
      payload,
      event: (payload as unknown as { event: never }).event,
      requestId: REQ,
      persistedGraph,
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;

    const persisted = result.mutatedGraph as Record<string, unknown>;
    // The node is gone AND the canonical roster agrees. Swap this call site to
    // the D1 twin and the second assertion REDs while the first still passes —
    // which is exactly the defect shape being guarded.
    expect((persisted.nodes as Array<{ id: string }>).map((n) => n.id)).not.toContain('o-launch');
    expect(optionIds(persisted)).toEqual(['o-wait']);
  });
});

describe('persist-merge twins — tripwire: a THIRD twin must fail loud', () => {
  it('exactly two merge*ForPersistence functions are exported, derived from source', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcRoot = join(here, '..', '..');

    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
          walk(p);
        } else if (/\.ts$/.test(ent.name) && !/\.test\.ts$/.test(ent.name)) {
          for (const m of readFileSync(p, 'utf-8').matchAll(
            /^export function (merge[A-Za-z0-9]*ForPersistence)\b/gm,
          )) {
            found.push(m[1]!);
          }
        }
      }
    };
    walk(srcRoot);

    // Derived from the tree, never a hand-maintained list: a third twin, or a
    // rename, REDs here and sends the author to this file's docblock to decide
    // which question the new function answers before it acquires call sites.
    expect(found.sort()).toEqual([
      'mergeAppliedGraphForPersistence',
      'mergeMutatedGraphForPersistence',
    ]);
  });
});
