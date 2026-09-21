/**
 * ROADMAP 2.713 — THE COMPOSER↔APPLY SEAM. The last contract before a user
 * ever sees a compound edit applied, and it was broken 100% of the time.
 *
 * ── THE DEFECT THIS FILE PINS ──────────────────────────────────────────────
 * The apply-side Zod contract (`PatchOperationsArraySchema`, unchanged since
 * 2026-02-25, three consumers: edit-graph ingress, `readGmHeldResume`'s
 * confirm-click revalidation, and `checkReferentialIntegrity`) requires
 * `value.{id,kind,label}` on `add_node` and the full canonical edge payload on
 * `add_edge`. The composer's advert (`buildProposeStructuralEditTool`) declares
 * `value` with `additionalProperties: false` and NO `id` property at all, and
 * its prose actively forbids restating identity inside `value`. So every
 * `add_node` the composer could ever emit failed apply with `invalid_type` at
 * `value.id` — deterministically, by construction, witnessed in production on
 * the first-ever `engaged_split` (15 ops, 3 parts, 5/5 rejected,
 * `violation_codes:["zod:invalid_type"]`, `ref_errors:0`).
 *
 * ── WHY THESE TESTS ARE DERIVED, NOT MIRRORED (CLAUDE.md trap 12) ──────────
 * Neither shape is hand-written here. The producer side is the real
 * `validateProposedStructuralEdit` fed through the real
 * `buildProposeStructuralEditTool` advert; the consumer side is the real
 * `PatchOperationsArraySchema`. The round-trip therefore REDs the day EITHER
 * side drifts — which is the only property that could have caught this defect
 * when the composer was written, and the property the composer's own header
 * asserted (falsely, at the bytes) that it already had.
 *
 * ── FIXTURE HONESTY (stated, not assumed) ──────────────────────────────────
 * The raw `tool_use` payload is deliberately never logged, so the production
 * failure's exact per-op field split is UNVERIFIABLE. What IS derived: the
 * fixtures below carry exactly and only what the DEPLOYED advert permits and
 * instructs at `6682dedb` (asserted against the advert at runtime, below), and
 * the failure signature they reproduce — every issue `invalid_type`, `value.id`
 * among them, zero referential-integrity errors because Zod fails first — is
 * the signature the capture carried. The capture's issue COUNT (5 over 5 ops)
 * is consistent with several per-op mixes and determines none of them; no test
 * here asserts it.
 *
 * ── IDENTITY BINDING (CLAUDE.md trap 19) ───────────────────────────────────
 * Every identity assertion below names its op by `path` and locates it by that
 * path — never by array position and never by a value predicate a sibling op
 * could satisfy. The discriminating mutant pair that proves this binding is
 * recorded in the PR: breaking the synthesis for ALL ops REDs these tests;
 * breaking it for a DIFFERENT op leaves the named-op assertion GREEN while the
 * whole-batch round-trip REDs.
 */
import { describe, expect, it } from 'vitest';

import {
  buildStructuralEditGrounding,
  buildProposeStructuralEditTool,
  validateProposedStructuralEdit,
} from '../propose-structural-edit.js';
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
const OPTS = { maxPatchOperations: 15 } as const;

function grounding() {
  const g = buildStructuralEditGrounding(GRAPH);
  if (g === null) throw new Error('fixture graph must be groundable');
  return g;
}

/**
 * The advert's `value` property table, READ FROM THE PRODUCTION ADVERT.
 * Every fixture key below is asserted to be a member of this set, so no fixture
 * can quietly use a field the deployed model was never offered.
 */
function advertValueProperties(): Set<string> {
  const schema = buildProposeStructuralEditTool(grounding()).input_schema as {
    properties: {
      operations: { items: { properties: { value: { properties: Record<string, unknown> } } } };
    };
  };
  return new Set(Object.keys(schema.properties.operations.items.properties.value.properties));
}

/** Assert a fixture uses only advert-declared `value` keys — at every depth we use. */
function assertAdvertLegal(value: Record<string, unknown>): void {
  const declared = advertValueProperties();
  for (const key of Object.keys(value)) {
    expect(declared, `fixture uses \`value.${key}\`, which the deployed advert does not declare`).toContain(key);
  }
}

// ---------------------------------------------------------------------------
// The fixtures — advert-shaped, mirroring run B's disclosed part-1 kind mix
// (2 node-adds + 3 links). Identity lives ONLY in `path`, exactly as the
// deployed advert's prose instructs ("name it once, in `path`").
// ---------------------------------------------------------------------------

/** A create the deployed advert can express: kind + label, id in `path` only. */
function advertShapedCreate(path: string, kind: string, label: string) {
  const value = { kind, label };
  assertAdvertLegal(value);
  return { op: 'add_node', path, value };
}

/**
 * A link the deployed advert can express with its declared MINIMUM: the advert
 * marks only `strength.mean` required and leaves `std`, `exists_probability`
 * and `effect_direction` optional — while the apply contract requires all four.
 */
function advertMinimumLink(path: string, from: string, to: string) {
  const value = { from, to, strength: { mean: 0.4 } };
  assertAdvertLegal(value);
  return { op: 'add_edge', path, value };
}

/** The same link, with every apply-required field the model volunteered. */
function fullyStatedLink(path: string, from: string, to: string) {
  const value = {
    from,
    to,
    strength: { mean: 0.4, std: 0.15 },
    exists_probability: 0.8,
    effect_direction: 'positive',
  };
  assertAdvertLegal(value);
  return { op: 'add_edge', path, value };
}

/**
 * Run B's part-1 shape: two creates and three links, all grounded in the
 * fixture graph, all fully stated so the ONLY reason this batch could fail
 * apply is the identity defect.
 */
function runBShapedBatch() {
  return {
    operations: [
      advertShapedCreate('fac_channel_mix', 'factor', 'Channel mix'),
      advertShapedCreate('fac_brand_lift', 'factor', 'Brand lift'),
      fullyStatedLink('fac_channel_mix::g-profit', 'fac_channel_mix', 'g-profit'),
      fullyStatedLink('fac_brand_lift::g-profit', 'fac_brand_lift', 'g-profit'),
      fullyStatedLink('f-spend::fac_channel_mix', 'f-spend', 'fac_channel_mix'),
    ],
  };
}

/** Locate an accepted op by the id it NAMES — never by array position. */
function opNamed(ops: readonly { op: string; path: string; value?: unknown }[], path: string) {
  const found = ops.filter((o) => o.path === path);
  expect(found, `exactly one accepted op must name '${path}'`).toHaveLength(1);
  return found[0]!;
}

// ---------------------------------------------------------------------------
// Two behaviour probes over the SAME question, one per production module:
// "is a link between these two node kinds TOPOLOGY rather than a belief?"
// Neither reads a predicate; each asks the module what it does. The agreement
// assertion below then needs no shared constant to trust.
// ---------------------------------------------------------------------------

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

/** What the COMPOSER does: does it accept a link carrying no belief at all? */
function composerWaivesBelief(fromKind: string, toKind: string): boolean {
  const g = buildStructuralEditGrounding({
    nodes: [
      { id: 'n_from', kind: fromKind, label: 'From' },
      { id: 'n_to', kind: toKind, label: 'To' },
    ],
    edges: [],
  });
  if (g === null) throw new Error('probe grounding must build');
  const result = validateProposedStructuralEdit(
    { operations: [{ op: 'add_edge', path: 'n_from::n_to', value: { from: 'n_from', to: 'n_to' } }] },
    g,
    OPTS,
  );
  if (!result.ok) return false;
  // Accepted — and it must be accepted in a shape the apply contract takes.
  expect(PatchOperationsArraySchema.safeParse(result.operations).success).toBe(true);
  return true;
}

function acceptOrThrow(payload: unknown) {
  const result = validateProposedStructuralEdit(payload, grounding(), OPTS);
  if (!result.ok) throw new Error(`expected acceptance, got ${result.code}: ${result.reason}`);
  return result;
}

// ===========================================================================
// §1 The premise, derived from the deployed artefacts — not asserted.
// ===========================================================================

describe('the premise: the advert CANNOT express what the apply contract REQUIRES', () => {
  it('the advert declares no `value.id` property, so the model is structurally incapable of supplying one', () => {
    expect(advertValueProperties().has('id')).toBe(false);
  });

  it('the advert closes `value` to additional properties, so `id` cannot arrive as an extra key either', () => {
    const schema = buildProposeStructuralEditTool(grounding()).input_schema as {
      properties: {
        operations: { items: { properties: { value: { additionalProperties: boolean } } } };
      };
    };
    expect(schema.properties.operations.items.properties.value.additionalProperties).toBe(false);
  });

  it('the apply contract requires `value.id` on add_node — the field the advert cannot carry', () => {
    // Derived from the enforcing schema itself: a create with kind+label but no
    // id is rejected, and the issue lands on `value.id`.
    const parsed = PatchOperationsArraySchema.safeParse([
      { op: 'add_node', path: 'fac_x', value: { kind: 'factor', label: 'X' } },
    ]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('0.value.id');
  });

  it('REPRODUCES the production failure signature on the raw advert-shaped batch', () => {
    // What the composer emitted verbatim before this fix: `value` passed
    // through from the model, identity in `path` only.
    const raw = runBShapedBatch().operations;
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
    // referential integrity is simply never REACHED, because Zod fails first.
    // Reached, it would have been wrong in BOTH directions, because it reads
    // add-identity from `value.id` and the raw batch has none:
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
    //     waved through, because the guard reads `undefined` and compares it
    //     against the graph. This is the collision check going dark.
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
// §2 I1 — THE DERIVED ROUND-TRIP. The decisive test.
// ===========================================================================

describe('I1 — every operation the composer ACCEPTS parses under the APPLY contract', () => {
  it("run B's part-1 shape round-trips composer → PatchOperationsArraySchema", () => {
    const accepted = acceptOrThrow(runBShapedBatch());
    const parsed = PatchOperationsArraySchema.safeParse(accepted.operations);
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
    ).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('every ACCEPTED part round-trips too — a split part is what actually reaches apply', () => {
    // The dispatcher submits `parts[0]`, not `operations`; a fix that repaired
    // only the whole batch would leave the submitted artefact broken.
    const accepted = acceptOrThrow(runBShapedBatch());
    for (const part of accepted.parts) {
      const parsed = PatchOperationsArraySchema.safeParse(part.operations);
      expect(
        parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
      ).toEqual([]);
    }
  });

  it('a batch spanning EVERY op kind the composer advertises round-trips', () => {
    // Coverage by construction over the advertised vocabulary, so a newly
    // advertised op with an unsatisfiable apply shape cannot land unnoticed.
    const accepted = acceptOrThrow({
      operations: [
        advertShapedCreate('fac_new_reach', 'factor', 'New reach'),
        fullyStatedLink('fac_new_reach::g-profit', 'fac_new_reach', 'g-profit'),
        { op: 'update_node', path: 'f-spend', target_label: 'Marketing spend', value: { label: 'Marketing spend v2' } },
        { op: 'update_edge', path: 'f-spend::g-profit', value: { exists_probability: 0.7 } },
        { op: 'remove_edge', path: 'f-reach::g-profit' },
        { op: 'remove_node', path: 'f-reach', target_label: 'Audience reach' },
      ],
    });
    const kinds = new Set(accepted.operations.map((o) => o.op));
    expect(kinds.size).toBe(6);
    const parsed = PatchOperationsArraySchema.safeParse(accepted.operations);
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
    ).toEqual([]);
  });
});

// ===========================================================================
// §3 I2 — ONE identity, ECHOED from `path`, never forked and never invented.
// ===========================================================================

describe('I2 — add_node identity is synthesised from the authoritative `path`', () => {
  it("the op NAMED 'fac_brand_lift' carries value.id === 'fac_brand_lift'", () => {
    const accepted = acceptOrThrow(runBShapedBatch());
    const op = opNamed(accepted.operations, 'fac_brand_lift');
    expect((op.value as { id?: unknown }).id).toBe('fac_brand_lift');
  });

  it("the op NAMED 'fac_channel_mix' carries its OWN id — not a sibling's", () => {
    const accepted = acceptOrThrow(runBShapedBatch());
    const op = opNamed(accepted.operations, 'fac_channel_mix');
    expect((op.value as { id?: unknown }).id).toBe('fac_channel_mix');
    // The cross-echo the discriminating mutant installs: a sibling's id.
    expect((op.value as { id?: unknown }).id).not.toBe('fac_brand_lift');
  });

  it('every accepted create binds value.id to its own path, and no two creates share one', () => {
    const accepted = acceptOrThrow(runBShapedBatch());
    const creates = accepted.operations.filter((o) => o.op === 'add_node');
    expect(creates.length).toBeGreaterThan(1); // a one-create batch cannot see a fork
    const ids = creates.map((o) => (o.value as { id?: unknown }).id);
    expect(ids).toEqual(creates.map((o) => o.path));
    expect(new Set(ids).size).toBe(creates.length);
  });

  it('`checkReferentialIntegrity` — which reads add-identity from value.id — now sees the created ids', () => {
    // The cascade the missing id blinded: the apply-side integrity guard reads
    // `value.id`, so before the fix it could not see a single created node.
    const accepted = acceptOrThrow(runBShapedBatch());
    const parsed = PatchOperationsArraySchema.parse(accepted.operations);
    const errors = checkReferentialIntegrity(parsed, GRAPH);
    expect(errors).toEqual([]);
    // And it BITES on a real collision, so the emptiness above is not vacuous.
    const colliding = PatchOperationsArraySchema.parse(
      acceptOrThrow({ operations: [advertShapedCreate('fac_dup', 'factor', 'Dup')] }).operations,
    );
    expect(
      checkReferentialIntegrity(colliding, {
        nodes: [...GRAPH.nodes, { id: 'fac_dup' }],
        edges: GRAPH.edges,
      }),
    ).toHaveLength(1);
  });

  it('an AGREEING `value.id` echo from the model is accepted and left equal to `path`', () => {
    // The advert cannot produce this, but the validator is the enforcing
    // contract and the advert is descriptive — so the validator must be right
    // about it either way. G7 already tolerates agreement.
    const accepted = acceptOrThrow({
      operations: [
        { op: 'add_node', path: 'fac_echo', value: { id: 'fac_echo', kind: 'factor', label: 'Echo' } },
      ],
    });
    expect((opNamed(accepted.operations, 'fac_echo').value as { id?: unknown }).id).toBe('fac_echo');
  });

  it('a DISAGREEING `value.id` is still a VALUE_IDENTITY_CONFLICT — synthesis never papers over a fork', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'add_node', path: 'fac_forked', value: { id: 'fac_other', kind: 'factor', label: 'Forked' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALUE_IDENTITY_CONFLICT');
  });
});

describe('I2 — a create whose content the apply contract requires is REFUSED, never invented', () => {
  it('a create with no `label` is refused with a model-facing reason naming the field', () => {
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'add_node', path: 'fac_nameless', value: { kind: 'factor' } }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_INVALID');
    expect(result.reason).toContain('label');
    expect(result.reason).toContain('fac_nameless');
  });

  it('a create with no `kind` is refused — no kind is ever guessed from an id prefix', () => {
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'add_node', path: 'fac_kindless', value: { label: 'Kindless' } }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_INVALID');
    expect(result.reason).toContain('kind');
  });

  it('a create with no `value` at all is refused, not synthesised into existence', () => {
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'add_node', path: 'fac_empty' }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_INVALID');
  });

  it('REJECT-DON\'T-REPAIR holds: a batch whose LAST op lacks a label returns NO operations', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          advertShapedCreate('fac_good_one', 'factor', 'Good one'),
          { op: 'add_node', path: 'fac_bad_one', value: { kind: 'factor' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).not.toHaveProperty('operations');
  });
});

// ===========================================================================
// §4 I3 — edge creates carry the full canonical payload, or are refused.
// ===========================================================================

describe('I3 — a CAUSAL link create is refused when the apply-required payload is incomplete', () => {
  it('the advert-MINIMUM link (only `strength.mean`) is refused, never defaulted into existence', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          advertShapedCreate('fac_causal_src', 'factor', 'Causal source'),
          advertMinimumLink('fac_causal_src::g-profit', 'fac_causal_src', 'g-profit'),
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_INVALID');
    for (const field of ['std', 'exists_probability', 'effect_direction']) {
      expect(result.reason).toContain(field);
    }
  });

  it.each([
    ['strength.std', { from: 'f-spend', to: 'g-profit', strength: { mean: 0.4 }, exists_probability: 0.8, effect_direction: 'positive' }],
    ['exists_probability', { from: 'f-spend', to: 'g-profit', strength: { mean: 0.4, std: 0.1 }, effect_direction: 'positive' }],
    ['effect_direction', { from: 'f-spend', to: 'g-profit', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8 }],
  ])('a causal link missing ONLY %s is refused — each apply-required field is enforced on its own', (field, value) => {
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'add_edge', path: 'f-spend::g-profit', value }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_INVALID');
    expect(result.reason).toContain(field.split('.').pop()!);
  });

  it('a fully stated causal link is accepted with the model\'s OWN numbers, untouched', () => {
    const accepted = acceptOrThrow({
      operations: [fullyStatedLink('f-spend::f-reach', 'f-spend', 'f-reach')],
    });
    const op = opNamed(accepted.operations, 'f-spend::f-reach');
    expect(op.value).toMatchObject({
      strength: { mean: 0.4, std: 0.15 },
      exists_probability: 0.8,
      effect_direction: 'positive',
    });
  });
});

describe('I3 — a STRUCTURAL link carries the shared canonical topology, from the ONE constant', () => {
  it('a decision→option link needs no model-stated belief: it is topology', () => {
    const accepted = acceptOrThrow({
      operations: [
        advertShapedCreate('opt_c', 'option', 'Plan C'),
        { op: 'add_edge', path: 'd-choice::opt_c', value: { from: 'd-choice', to: 'opt_c' } },
      ],
    });
    expect(opNamed(accepted.operations, 'd-choice::opt_c').value).toMatchObject(
      STRUCTURAL_EDGE_DEFAULTS,
    );
  });

  it('the named structural pairs are directional: option→decision is NOT topology', () => {
    expect(composerWaivesBelief('decision', 'option')).toBe(true);
    expect(composerWaivesBelief('option', 'factor')).toBe(true);
    expect(composerWaivesBelief('option', 'decision')).toBe(false);
    expect(composerWaivesBelief('factor', 'goal')).toBe(false);
  });

  it('AGREEMENT over the FULL kind cross-product: the composer waives a belief exactly where the apply path supplies one', () => {
    // Trap 12d union assertion, behaviour-to-behaviour over two production
    // artefacts. The composer may only accept a link without a model-stated
    // belief where `enforceStructuralEdgeDefaults` would have supplied one;
    // anywhere else, waiving it would be fabrication. This REDs the day
    // EITHER module's classification drifts.
    const disagreements: string[] = [];
    for (const fromKind of NodeKindV3.options) {
      for (const toKind of NodeKindV3.options) {
        const applyPathSupplies = enforcerTreatsAsStructural(fromKind, toKind);
        if (composerWaivesBelief(fromKind, toKind) !== applyPathSupplies) {
          disagreements.push(`${fromKind}→${toKind}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('the cross-product probe is not vacuous: it finds both classes', () => {
    // A positive control for the agreement test above — if every pair landed
    // in one class the agreement would be trivially satisfiable.
    const structural = NodeKindV3.options.flatMap((f) =>
      NodeKindV3.options.filter((t) => enforcerTreatsAsStructural(f, t)).map((t) => `${f}→${t}`),
    );
    expect(structural).toEqual(['decision→option', 'option→factor']);
    expect(structural.length).toBeLessThan(NodeKindV3.options.length ** 2);
  });

  it('FIXED POINT: running the apply path\'s enforcer over composed output changes nothing', () => {
    // The strongest statement of agreement available — what the composer emits
    // IS what the apply path applies, so the disclosure the user reads and the
    // payload that lands cannot diverge.
    const accepted = acceptOrThrow({
      operations: [
        advertShapedCreate('opt_d', 'option', 'Plan D'),
        advertShapedCreate('fac_d_cost', 'factor', 'Plan D cost'),
        { op: 'add_edge', path: 'd-choice::opt_d', value: { from: 'd-choice', to: 'opt_d' } },
        { op: 'add_edge', path: 'opt_d::fac_d_cost', value: { from: 'opt_d', to: 'fac_d_cost' } },
        fullyStatedLink('fac_d_cost::g-profit', 'fac_d_cost', 'g-profit'),
      ],
    });
    const ops = accepted.operations as unknown as PatchOperation[];
    expect(enforceStructuralEdgeDefaults(ops, GRAPH)).toEqual(ops);
  });

  it('the batch-created node kinds are VISIBLE to the apply-path enforcer (the cascade the missing id closed)', () => {
    // Before the fix, `enforceStructuralEdgeDefaults` built its kind map from
    // `value.id`/`value.kind` and therefore could not see a single node the
    // batch created — so an edge to a batch-created option was invisible to it.
    const accepted = acceptOrThrow({
      operations: [
        advertShapedCreate('opt_e', 'option', 'Plan E'),
        { op: 'add_edge', path: 'd-choice::opt_e', value: { from: 'd-choice', to: 'opt_e' } },
      ],
    });
    const create = opNamed(accepted.operations, 'opt_e').value as Record<string, unknown>;
    expect(create.id).toBe('opt_e');
    expect(create.kind).toBe('option');
    // The enforcer's map is keyed on exactly those two fields.
    const enforced = enforceStructuralEdgeDefaults(
      [{ op: 'add_edge', path: 'd-choice::opt_e', value: { from: 'd-choice', to: 'opt_e' } } as PatchOperation],
      { nodes: [...GRAPH.nodes, { id: 'opt_e', kind: String(create.kind) }] },
    );
    expect(enforced[0]!.value).toMatchObject(STRUCTURAL_EDGE_DEFAULTS);
  });
});

// ===========================================================================
// §5 I5 — the HELD path is part of the seam.
// ===========================================================================

describe('I5 — a composed batch survives the confirm-click revalidation', () => {
  it('`readGmHeldResume` re-parses the composed ops and returns them (not `no_payload`)', () => {
    const accepted = acceptOrThrow(runBShapedBatch());
    const read = readGmHeldResume({
      action: {
        kind: 'apply_proposed_change',
        inline_patch: {
          handler_id: GM_HELD_HANDLER_ID,
          operations: accepted.parts[0]!.operations,
        },
      },
    } as unknown as Parameters<typeof readGmHeldResume>[0]);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.operations.map((o) => o.path)).toEqual(
      accepted.parts[0]!.operations.map((o) => o.path),
    );
  });

  it('the same read on the PRE-FIX advert-shaped ops is `no_payload` — the confirm click was the second failure point', () => {
    const read = readGmHeldResume({
      action: {
        kind: 'apply_proposed_change',
        inline_patch: { handler_id: GM_HELD_HANDLER_ID, operations: runBShapedBatch().operations },
      },
    } as unknown as Parameters<typeof readGmHeldResume>[0]);
    expect(read.kind).toBe('no_payload');
  });
});
