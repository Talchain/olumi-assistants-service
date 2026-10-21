/**
 * ROADMAP 2.713 — THE APPLY-SIDE CONTRACT THAT A COMPOUND EDIT MUST MEET.
 *
 * ⚠ 21 Oct 2026 — the structural-edit composer (`propose-structural-edit.ts`)
 * this file once round-tripped was retired with the coach's structural-edit
 * tool (superseded by the core `propose_change`). Its rows went with it. What
 * stays is every row that asserts LIVE apply-side code, now fed literal
 * operations instead of composer output:
 *   · `PatchOperationsArraySchema` requires `value.id` on `add_node`;
 *   · `checkReferentialIntegrity` reads add-identity from `value.id`, so an
 *     id-less create is invisible to it in BOTH directions;
 *   · `enforceStructuralEdgeDefaults` treats exactly decision→option and
 *     option→factor as topology, sees kinds of nodes created IN the batch, and
 *     is a fixed point over already-canonical operations;
 *   · `readGmHeldResume` (the confirm-click revalidation) accepts a canonical
 *     batch and refuses an id-less one as `no_payload`.
 *
 * ── THE DEFECT THESE ROWS STILL PIN ────────────────────────────────────────
 * Witnessed in production on the first-ever `engaged_split` (15 ops, 3 parts,
 * 5/5 rejected, `violation_codes:["zod:invalid_type"]`, `ref_errors:0`): an
 * `add_node` carrying identity in `path` only fails apply at `value.id`.
 *
 * ── IDENTITY BINDING (CLAUDE.md trap 19) ───────────────────────────────────
 * Every identity assertion names its op by `path` — never by array position
 * and never by a value predicate a sibling op could satisfy.
 */
import { describe, expect, it } from 'vitest';

import {
  PatchOperationsArraySchema,
  checkReferentialIntegrity,
} from '../../../orchestrator/patch-validation.js';
import { enforceStructuralEdgeDefaults } from '../../../orchestrator/tools/edit-graph.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';
import { NodeKindV3 } from '../../../schemas/cee-v3.js';
import { readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { GM_HELD_HANDLER_ID } from '../../handlers/edit-graph-referee-gate.js';
import { buildReadyGraph } from '../../graph-management/__tests__/fixtures.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

const GRAPH = buildReadyGraph();

const CAUSAL_BELIEF = {
  strength: { mean: 0.4, std: 0.15 },
  exists_probability: 0.8,
  effect_direction: 'positive',
} as const;

/** A create with identity in `path` ONLY — the shape that failed apply in production. */
function idlessCreate(path: string, kind: string, label: string) {
  return { op: 'add_node', path, value: { kind, label } };
}

/** The same create in canonical form: `value.id` restates `path`. */
function canonicalCreate(path: string, kind: string, label: string) {
  return { op: 'add_node', path, value: { kind, label, id: path } };
}

/** A causal link carrying every apply-required field. */
function fullyStatedLink(path: string, from: string, to: string) {
  return { op: 'add_edge', path, value: { from, to, ...CAUSAL_BELIEF } };
}

/** Run B's part-1 kind mix (2 node-adds + 3 links), creates built by `create`. */
function runBShapedBatch(create: typeof idlessCreate) {
  return [
    create('fac_channel_mix', 'factor', 'Channel mix'),
    create('fac_brand_lift', 'factor', 'Brand lift'),
    fullyStatedLink('fac_channel_mix::g-profit', 'fac_channel_mix', 'g-profit'),
    fullyStatedLink('fac_brand_lift::g-profit', 'fac_brand_lift', 'g-profit'),
    fullyStatedLink('f-spend::fac_channel_mix', 'f-spend', 'fac_channel_mix'),
  ];
}

/** What the APPLY path does: does `enforceStructuralEdgeDefaults` fill this pair in? */
function enforcerTreatsAsStructural(fromKind: string, toKind: string): boolean {
  const op = { op: 'add_edge', path: 'n_from::n_to', value: { from: 'n_from', to: 'n_to' } };
  const enforced = enforceStructuralEdgeDefaults([op as PatchOperation], {
    nodes: [
      { id: 'n_from', kind: fromKind },
      { id: 'n_to', kind: toKind },
    ],
  });
  return JSON.stringify(enforced[0]!.value) !== JSON.stringify(op.value);
}

// ===========================================================================
// §1 The apply contract and its referential-integrity guard.
// ===========================================================================

describe('the apply contract requires `value.id` on add_node', () => {
  it('a create with kind+label but no id is rejected, and the issue lands on `value.id`', () => {
    const parsed = PatchOperationsArraySchema.safeParse([
      { op: 'add_node', path: 'fac_x', value: { kind: 'factor', label: 'X' } },
    ]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('0.value.id');
  });

  it('REPRODUCES the production failure signature on an id-less batch', () => {
    const raw = runBShapedBatch(idlessCreate);
    const parsed = PatchOperationsArraySchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    // Signature 1: every issue is `invalid_type` — the wire's
    // `violation_codes:["zod:invalid_type"]`, and nothing else.
    expect([...new Set(parsed.error.issues.map((i) => i.code))]).toEqual(['invalid_type']);

    // Signature 2: the creates fail at `value.id`, bound to the op that NAMES
    // each id — not "some add_node".
    const issuePaths = parsed.error.issues.map((i) => i.path.join('.'));
    for (const [index, op] of raw.entries()) {
      if (op.op !== 'add_node') continue;
      expect(issuePaths, `create '${op.path}' must fail at value.id`).toContain(`${index}.value.id`);
    }

    // Signature 3: `ref_errors:0` on the wire is NOT a clean bill of health —
    // referential integrity reads add-identity from `value.id`, so reached on
    // this batch it is wrong in BOTH directions:
    const refErrors = checkReferentialIntegrity(
      raw as unknown as Parameters<typeof checkReferentialIntegrity>[0],
      GRAPH,
    );
    // (a) FALSE POSITIVES — every link to a node this batch creates is called
    //     unknown, because the create registered no id the guard could see.
    expect(refErrors.map((e) => e.path).sort()).toEqual(
      ['f-spend::fac_channel_mix', 'fac_brand_lift::g-profit', 'fac_channel_mix::g-profit'],
    );
    // (b) FALSE NEGATIVES — a create that collides with a PERSISTED id is
    //     waved through, because the guard reads `undefined`.
    expect(
      checkReferentialIntegrity(
        [{ op: 'add_node', path: 'f-spend', value: { kind: 'factor', label: 'X' } }] as unknown as Parameters<typeof checkReferentialIntegrity>[0],
        GRAPH,
      ),
    ).toEqual([]);
    // …while the same collision IS caught once identity is present.
    expect(
      checkReferentialIntegrity(
        [{ op: 'add_node', path: 'f-spend', value: { id: 'f-spend', kind: 'factor', label: 'X' } }] as unknown as Parameters<typeof checkReferentialIntegrity>[0],
        GRAPH,
      ),
    ).toHaveLength(1);
  });
});

// ===========================================================================
// §2 The structural-edge enforcer on the apply path.
// ===========================================================================

describe('`enforceStructuralEdgeDefaults` — topology by kind, from the ONE constant', () => {
  it('the enforcer treats EXACTLY decision→option and option→factor as topology', () => {
    // Over the FULL kind cross-product, so both classes are seen and the
    // structural set cannot grow or shrink unnoticed.
    const structural = NodeKindV3.options.flatMap((f) =>
      NodeKindV3.options.filter((t) => enforcerTreatsAsStructural(f, t)).map((t) => `${f}→${t}`),
    );
    expect(structural).toEqual(['decision→option', 'option→factor']);
    expect(structural.length).toBeLessThan(NodeKindV3.options.length ** 2);
  });

  it('FIXED POINT: over already-canonical operations the enforcer changes nothing', () => {
    // Structural links already carry the shared constant; the causal link
    // carries its own stated belief, which the enforcer must leave untouched.
    const ops = [
      canonicalCreate('opt_d', 'option', 'Plan D'),
      canonicalCreate('fac_d_cost', 'factor', 'Plan D cost'),
      { op: 'add_edge', path: 'd-choice::opt_d', value: { from: 'd-choice', to: 'opt_d', ...STRUCTURAL_EDGE_DEFAULTS } },
      { op: 'add_edge', path: 'opt_d::fac_d_cost', value: { from: 'opt_d', to: 'fac_d_cost', ...STRUCTURAL_EDGE_DEFAULTS } },
      fullyStatedLink('fac_d_cost::g-profit', 'fac_d_cost', 'g-profit'),
    ] as unknown as PatchOperation[];
    expect(PatchOperationsArraySchema.safeParse(ops).success).toBe(true);
    expect(enforceStructuralEdgeDefaults(ops, GRAPH)).toEqual(ops);
  });

  it('the kind of a node created IN the batch is visible to the enforcer via `value.id`/`value.kind`', () => {
    const edge = { op: 'add_edge', path: 'd-choice::opt_e', value: { from: 'd-choice', to: 'opt_e' } };
    const enforced = enforceStructuralEdgeDefaults(
      [canonicalCreate('opt_e', 'option', 'Plan E'), edge] as unknown as PatchOperation[],
      GRAPH,
    );
    expect(enforced.find((o) => o.path === 'd-choice::opt_e')!.value).toMatchObject(
      STRUCTURAL_EDGE_DEFAULTS,
    );
  });
});

// ===========================================================================
// §3 The HELD path — the confirm-click revalidation.
// ===========================================================================

describe('`readGmHeldResume` re-parses a held batch on the confirm click', () => {
  it('a canonical batch is returned (`ok`), in order, not `no_payload`', () => {
    const ops = runBShapedBatch(canonicalCreate);
    const read = readGmHeldResume({
      action: {
        kind: 'apply_proposed_change',
        inline_patch: { handler_id: GM_HELD_HANDLER_ID, operations: ops },
      },
    } as unknown as Parameters<typeof readGmHeldResume>[0]);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.operations.map((o) => o.path)).toEqual(ops.map((o) => o.path));
  });

  it('the same batch with id-less creates is `no_payload` — the confirm click was the second failure point', () => {
    const read = readGmHeldResume({
      action: {
        kind: 'apply_proposed_change',
        inline_patch: { handler_id: GM_HELD_HANDLER_ID, operations: runBShapedBatch(idlessCreate) },
      },
    } as unknown as Parameters<typeof readGmHeldResume>[0]);
    expect(read.kind).toBe('no_payload');
  });
});
