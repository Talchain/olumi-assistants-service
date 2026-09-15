/**
 * ⛔ RED-FIRST REPRO — A BARE `unit` / `value` OP KEY IS STRIPPED, SO THE WHOLE
 *    EDIT IS REFUSED. The user asks for "that's in pounds — raise it to £69"
 *    and gets "That change could not be applied to the model."
 *
 * ── THE MEASURED CASE (deployed, serving tip 07da2c0b) ──────────────────────
 * 100 refusal lines over a 20h window, negative control 0:
 *     reason `update_writes_did_not_survive`   100/100
 *     op     `update_node`                     100/100
 *     key_shape  unit 68 · value 16 · interventions/<*>/value 8
 *                interventions/<*>/<*> 7 · observed_state/<*> 1
 *     key_is_intervention_subtree   false 85 · true 15
 * The two dominant shapes — bare `unit` (68) and bare `value` (16), 84 of 100 —
 * are what this file reproduces.
 *
 * ── THE CHAIN, derived at the bytes at this tip ─────────────────────────────
 *  1. The model emits the field-suffixed path the edit prompt teaches, e.g.
 *     `/nodes/fac_unit_price/unit` with a SCALAR value.
 *  2. `normalisePath` (edit-graph.ts:4764) splits that into
 *     `{ path: 'fac_unit_price', field: 'unit' }`, and `normaliseOperation`
 *     (edit-graph.ts:5265) wraps the scalar as `value = { unit: '£' }`.
 *     ⭐ THAT WRAP IS WHERE THE BARE KEY COMES FROM. It is not a shape this
 *     test invented — it is manufactured by CEE's own op normaliser.
 *  3. `canonicaliseUpdateNodeValue` (canonicalise-value-ops.ts:220-233) passes
 *     it through VERBATIM: `unit` is not in `NODE_DECLARED_FIELDS`
 *     (`Object.keys(NodeV3.shape)`), and its first path segment `unit` is not
 *     in `OBSERVED_ROOT_SPELLINGS` (= {`observed_state`, `data`}), so the
 *     translator's `!OBSERVED_ROOT_SPELLINGS.has(segments[0])` arm fires and
 *     the key is copied out untouched. Only a ROOTED spelling is translated.
 *  4. `applyUpdateNode` (patch-applier.ts:128) is a shallow `Object.assign`,
 *     so the node gains a TOP-LEVEL `unit` key.
 *  5. `NodeV3` (cee-v3.ts:156) is a plain `z.object` — "declared fields only,
 *     unknown fields stripped" — and declares no top-level `unit`/`value`
 *     (they live under `observed_state`). `GraphV3.safeParse` SILENTLY DROPS
 *     the key and still reports `success: true`.
 *  6. `firstOperationThatDidNotLand` (canonicalise-value-ops.ts:1406) compares
 *     raw-vs-canonical per written key, sees the write did not survive, and
 *     returns `update_writes_did_not_survive`.
 *  7. `edit-graph.ts:3994` refuses the WHOLE edit as `OPERATION_DID_NOT_LAND`.
 *
 * ⭐⭐ STEPS 6 AND 7 ARE CORRECT AND ARE NOT THE DEFECT. The guard is doing
 * exactly its job: a stripped write must never be reported as applied. This
 * file therefore asserts THE WRITE LANDS — never that the check is relaxed.
 * A fix that makes these tests pass by weakening step 6/7 would re-open the
 * strip-and-succeed class the guard was built to close.
 *
 * ── MEANING, NOT FIELD NAMES ───────────────────────────────────────────────
 * "raise it to £69" must end up DENOTING 69 pounds. `observed_state.value` is
 * normalised and authoritative, and PLoT's own gate is `value < 0 || value > 1`
 * — so a rename-only fix that routed the bare key straight to
 * `observed_state.value = 69` would land the write, pass a landing-only test,
 * and CORRUPT the model by a factor of the scale frame. The meaning assertions
 * below are written against that consumer predicate (trap 13d: invariants come
 * from the spec, never from the failure mode in hand), and they are what
 * discriminates a real fix from a rename.
 *
 * ── HOW THIS FILE IS KEPT NON-VACUOUS ──────────────────────────────────────
 *  · POSITIVE CONTROL — the SAME edit spelled `observed_state/unit` must pass
 *    TODAY, at both seams. If it does not, the seam is wrong and every RED
 *    below is measuring something else.
 *  · MECHANISM CONTROL — the strip is demonstrated directly (the applier
 *    writes the bare key; the parse removes it) so the RED is provably caused
 *    by the stripping and not by an unrelated rejection.
 *  · CONTRAST CONTROL — `observed_state` survives the SAME parse in the SAME
 *    run, so "the key vanished" cannot be an artefact of a blind probe.
 *  · IDENTITY BINDING — every assertion names the node id `fac_unit_price` and
 *    the exact key path. Nothing is found by a value predicate another node
 *    could satisfy.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { applyPatchOperations } from '../../patch-applier.js';
import {
  canonicaliseValueOps,
  firstOperationThatDidNotLand,
} from '../../canonicalise-value-ops.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

// ── identity: the ONE node every assertion below binds to ───────────────────

/** The node under test. Named once; never re-found by value. */
const FACTOR_ID = 'fac_unit_price';

/** The scale frame of the fixture: raw_value 20 / value 0.2 === 100. */
const SCALE_FRAME = 100;

/** What the user asked for, in real-world units. */
const REQUESTED_RAW = 69;

/**
 * A VALID GraphV3 (the precondition the `baseValid` narrowing at
 * edit-graph.ts:3910 requires — without it the postcondition block is skipped
 * entirely and this file would measure the legacy path instead).
 *
 * The factor carries a COHERENT normalised pair: value 0.2, raw_value 20,
 * cap 100. So `raw_value === value * 100` exactly, and "69" denotes 0.69
 * normalised. That coherence is what makes the corruption assertion bite.
 */
function buildGraph() {
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Pricing' },
      { id: 'opt_a', kind: 'option', label: 'Raise the price' },
      {
        id: FACTOR_ID,
        kind: 'factor',
        label: 'Unit price',
        observed_state: { value: 0.2, raw_value: 20, unit: 'index', cap: 100 },
      },
      { id: 'goal_g', kind: 'goal', label: 'Revenue' },
    ],
    edges: [
      { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: FACTOR_ID, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: FACTOR_ID, to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

function buildContext(): ConversationContext {
  return {
    graph: buildGraph(),
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-bare-key',
  } as unknown as ConversationContext;
}

// ── helpers, all identity-bound ─────────────────────────────────────────────

/** The node under test, found by ID. Throws rather than returning undefined. */
function factorOf(graph: unknown): Record<string, unknown> {
  const nodes = (graph as { nodes: Array<Record<string, unknown>> } | null)?.nodes;
  const node = nodes?.find((n) => n.id === FACTOR_ID);
  if (node === undefined) throw new Error(`fixture broken: no node ${FACTOR_ID}`);
  return node;
}

function observedOf(graph: unknown): Record<string, unknown> {
  return (factorOf(graph).observed_state ?? {}) as Record<string, unknown>;
}

/**
 * WALK the result for the rejection code rather than guessing a block path —
 * a wrong path returns `undefined` identically to "no rejection", which would
 * make every assertion here vacuous in the most convincing way.
 */
function rejectionCodeOf(result: { blocks?: unknown[] }): string | null {
  let found: string | null = null;
  const walk = (v: unknown): void => {
    if (found !== null || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const rec = v as Record<string, unknown>;
    const rejection = rec.rejection as Record<string, unknown> | undefined;
    if (rejection !== undefined && typeof rejection.code === 'string') {
      found = rejection.code;
      return;
    }
    Object.values(rec).forEach(walk);
  };
  walk(result.blocks);
  return found;
}

/** Adapter stub returning ONE canned edit_graph response. */
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

function editResponse(operations: unknown[]) {
  return {
    operations,
    removed_edges: [],
    warnings: [],
    coaching: { summary: 'Updated.', rerun_recommended: true },
  };
}

/**
 * The op shape the SERVED prompt's PATH SYNTAX produces: a field-suffixed path
 * and a SCALAR value. `normaliseOperation` is what turns this into the bare
 * key — this test does not hand-write the bare key at this seam.
 */
function fieldPathOp(field: string, value: unknown, oldValue: unknown) {
  return {
    op: 'update_node',
    path: `/nodes/${FACTOR_ID}/${field}`,
    value,
    old_value: oldValue,
    impact: 'moderate',
    rationale: 'Apply the change the user asked for.',
  };
}

async function runEdit(responseJson: unknown, description: string) {
  return handleEditGraph(
    buildContext(),
    description,
    makeAdapter(responseJson),
    'req-bare-key',
    'turn-bare-key',
  );
}

/**
 * Drive the REAL canonicalise → apply → parse → guard chain, exactly as
 * edit-graph.ts:3913-3957 does, and return the guard's own descriptor.
 * Nothing here is hand-built: `canonical` is produced by `GraphV3.safeParse`,
 * so the strip under test is the product's, not the test's.
 */
function driveGuard(opValue: Record<string, unknown>) {
  const base = buildGraph() as unknown as GraphV3T;
  const ops = [{ op: 'update_node', path: FACTOR_ID, value: opValue }] as never;
  const { operations } = canonicaliseValueOps(ops, base);
  const rawApplied = applyPatchOperations(base, operations as never);
  const parsed = GraphV3.safeParse(rawApplied);
  if (!parsed.success) throw new Error('fixture broken: applied graph did not parse');
  return {
    rawApplied,
    canonical: parsed.data as GraphV3T,
    nonLanding: firstOperationThatDidNotLand(
      operations,
      rawApplied,
      parsed.data as GraphV3T,
      base,
    ),
  };
}

/**
 * ⚠⚠ DISCLOSED CHANGE, MADE BY THE FIX LANE — READ THIS BEFORE TRUSTING THE
 * MECHANISM CONTROL BELOW. NO ASSERTION IN THIS FILE WAS ALTERED; this helper
 * was ADDED and the two MECHANISM CONTROL cases were repointed onto it.
 *
 * WHY. The mechanism control's job is stated in this file's own header: to
 * "demonstrate the strip DIRECTLY (the applier writes the bare key; the parse
 * removes it) so the RED is provably caused by the stripping and not by an
 * unrelated rejection." At pristine it reached the applier through
 * `driveGuard`, i.e. through `canonicaliseValueOps` — which was legitimate
 * ONLY because the canonicaliser was the IDENTITY for a bare key. That is the
 * exact defect the fix closes: the canonicaliser now translates
 * `{ unit: '£' }` into `{ observed_state: { …, unit: '£' } }` before the
 * applier ever sees it, so no top-level `unit` is ever written and the control
 * can no longer observe a strip THROUGH that path. It is a pristine-only
 * driver by construction.
 *
 * WHAT IS PRESERVED. This driver applies the op EXACTLY AS THE MODEL EMITS IT,
 * skipping only the translator, so every assertion below still measures the
 * real product chain it names: the real `applyPatchOperations` writes the bare
 * key, the real `GraphV3.safeParse` removes it, and the real
 * `firstOperationThatDidNotLand` reports `update_writes_did_not_survive` with
 * `key_shape` `unit` / `value`. Those are claims about `NodeV3` and the guard —
 * neither of which the fix touches — and they remain the reason the REDs below
 * are not vacuous. The GUARD IS DELIBERATELY UNCHANGED BY THIS PR; this control
 * is now what proves that.
 */
function driveApplierWithoutTranslation(opValue: Record<string, unknown>) {
  const base = buildGraph() as unknown as GraphV3T;
  const operations = [{ op: 'update_node', path: FACTOR_ID, value: opValue }] as never;
  const rawApplied = applyPatchOperations(base, operations as never);
  const parsed = GraphV3.safeParse(rawApplied);
  if (!parsed.success) throw new Error('fixture broken: applied graph did not parse');
  return {
    rawApplied,
    canonical: parsed.data as GraphV3T,
    nonLanding: firstOperationThatDidNotLand(
      operations,
      rawApplied,
      parsed.data as GraphV3T,
      base,
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 0. PRECONDITIONS — if any of these fail, every RED below is measuring the
//    wrong thing and must not be believed.
// ═══════════════════════════════════════════════════════════════════════════

describe('preconditions (a failure here invalidates every RED in this file)', () => {
  it('the base fixture is a VALID GraphV3, so the postcondition block engages', () => {
    expect(GraphV3.safeParse(buildGraph()).success).toBe(true);
  });

  it('the fixture pair is COHERENT: raw_value === value * SCALE_FRAME', () => {
    const observed = observedOf(buildGraph());
    expect(observed.value).toBe(0.2);
    expect(observed.raw_value).toBe(20);
    expect((observed.value as number) * SCALE_FRAME).toBe(observed.raw_value);
  });

  it('NodeV3 declares NO top-level `unit` or `value` (the stripping premise)', () => {
    const parsed = GraphV3.safeParse({
      ...buildGraph(),
      nodes: buildGraph().nodes.map((n) =>
        n.id === FACTOR_ID ? { ...n, unit: '£', value: 69 } : n,
      ),
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const node = factorOf(parsed.data);
    // TARGET: both bare keys are gone…
    expect(node).not.toHaveProperty('unit');
    expect(node).not.toHaveProperty('value');
    // …CONTRAST CONTROL, same parse, same run: a DECLARED field survives.
    // Without this, "the key vanished" could just mean the probe is blind.
    expect(node).toHaveProperty('observed_state');
    expect((node.observed_state as Record<string, unknown>).unit).toBe('index');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. MECHANISM CONTROL — the strip really happens, and it is what refuses.
//    These PASS today. They exist so the REDs below cannot be vacuous.
// ═══════════════════════════════════════════════════════════════════════════

describe('MECHANISM CONTROL — the bare key is written, then stripped', () => {
  it('the real applier writes a TOP-LEVEL `unit`, and the real parse removes it', () => {
    const { rawApplied, canonical } = driveApplierWithoutTranslation({ unit: '£' });

    // PRESENCE — what the absence assertion must be capable of seeing.
    const rawNode = factorOf(rawApplied);
    expect(rawNode).toHaveProperty('unit');
    expect(rawNode.unit).toBe('£');

    // …and the parse is what removes it.
    expect(factorOf(canonical)).not.toHaveProperty('unit');

    // The write never reached the field the product actually reads.
    expect(observedOf(canonical).unit).toBe('index');
  });

  it('the guard names the op, the reason and the key SHAPE reported on staging', () => {
    // Bound to the exact descriptor fields, so this cannot pass on "something
    // failed". These are the values the deployed lines carry.
    const unitDescriptor = driveApplierWithoutTranslation({ unit: '£' }).nonLanding;
    expect(unitDescriptor).not.toBeNull();
    expect(unitDescriptor?.op).toBe('update_node');
    expect(unitDescriptor?.reason).toBe('update_writes_did_not_survive');
    expect(unitDescriptor?.key_shape).toBe('unit');
    expect(unitDescriptor?.key_is_intervention_subtree).toBe(false);

    const valueDescriptor = driveApplierWithoutTranslation({ value: REQUESTED_RAW }).nonLanding;
    expect(valueDescriptor?.op).toBe('update_node');
    expect(valueDescriptor?.reason).toBe('update_writes_did_not_survive');
    expect(valueDescriptor?.key_shape).toBe('value');
    expect(valueDescriptor?.key_is_intervention_subtree).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. POSITIVE CONTROL — the SAME edit, rooted spelling. MUST PASS TODAY.
//    If this goes red, the seam is wrong and the REDs mean nothing.
// ═══════════════════════════════════════════════════════════════════════════

describe('POSITIVE CONTROL — the rooted `observed_state/unit` spelling lands today', () => {
  it('at the guard seam: every op lands, so the descriptor is null', () => {
    expect(driveGuard({ 'observed_state/unit': '£' }).nonLanding).toBeNull();
  });

  it('at the guard seam: the rooted write reaches observed_state.unit', () => {
    const { canonical } = driveGuard({ 'observed_state/unit': '£' });
    expect(observedOf(canonical).unit).toBe('£');
    // Merge, not replace: the siblings the op never named survive.
    expect(observedOf(canonical).value).toBe(0.2);
    expect(observedOf(canonical).raw_value).toBe(20);
  });

  it('at the PRODUCT seam: the edit is applied, not refused', async () => {
    const result = await runEdit(
      editResponse([fieldPathOp('observed_state/unit', '£', 'index')]),
      'That factor is in pounds, not an index',
    );

    expect(rejectionCodeOf(result)).toBeNull();
    expect(result.wasRejected).toBe(false);
    expect(observedOf(result.appliedGraph).unit).toBe('£');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. ⛔ RED — BARE `unit` (68 of 100 deployed refusals)
// ═══════════════════════════════════════════════════════════════════════════

describe('⛔ RED — a bare `unit` op must LAND, not refuse the whole edit', () => {
  it('guard seam: the op survives canonicalisation (RED today: update_writes_did_not_survive / unit)', () => {
    const { nonLanding } = driveGuard({ unit: '£' });
    // Asserting the SPECIFIC outcome: the named op landed. Today this fails
    // printing the whole descriptor, so the reason is visible in the output.
    expect(nonLanding).toBeNull();
  });

  it('guard seam: the unit write reaches observed_state.unit on the PERSISTED graph', () => {
    const { canonical } = driveGuard({ unit: '£' });
    // Identity-bound: this node, this key path. Meaning, not field name —
    // the unit the user stated must be the unit the product stores.
    expect(observedOf(canonical).unit).toBe('£');
  });

  it('product seam: the edit is NOT refused as OPERATION_DID_NOT_LAND', async () => {
    const result = await runEdit(
      editResponse([fieldPathOp('unit', '£', 'index')]),
      'That factor is in pounds, not an index',
    );

    // The specific refusal, named — not merely "something was rejected".
    expect(rejectionCodeOf(result)).not.toBe('OPERATION_DID_NOT_LAND');
    expect(result.wasRejected).toBe(false);
    expect(observedOf(result.appliedGraph).unit).toBe('£');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ⛔ RED — BARE `value` (16 of 100 deployed refusals)
//    …and the corruption a rename-only fix would ship.
// ═══════════════════════════════════════════════════════════════════════════

describe('⛔ RED — a bare `value` op must LAND, and must DENOTE what was asked', () => {
  it('guard seam: the op survives canonicalisation (RED today: update_writes_did_not_survive / value)', () => {
    expect(driveGuard({ value: REQUESTED_RAW }).nonLanding).toBeNull();
  });

  it('product seam: the edit is NOT refused as OPERATION_DID_NOT_LAND', async () => {
    const result = await runEdit(
      editResponse([fieldPathOp('value', REQUESTED_RAW, 20)]),
      'Raise the unit price to 69',
    );

    expect(rejectionCodeOf(result)).not.toBe('OPERATION_DID_NOT_LAND');
    expect(result.wasRejected).toBe(false);
  });

  /**
   * ⭐ THE ASSERTION A RENAME-ONLY FIX FAILS.
   *
   * Route the bare key straight to `observed_state.value` and the op LANDS —
   * every landing assertion above goes green — while the model now holds 69 in
   * a field PLoT gates as `value < 0 || value > 1`, with `raw_value` stale at
   * 20. The stored pair would denote 6,900 in real units, and the factor would
   * be 345x its true magnitude.
   *
   * Written against the CONSUMER's predicate, not against the failure in hand.
   */
  it('product seam: does NOT corrupt the normalised field (69 must not land in a 0-1 slot)', async () => {
    const result = await runEdit(
      editResponse([fieldPathOp('value', REQUESTED_RAW, 20)]),
      'Raise the unit price to 69',
    );
    expect(result.wasRejected).toBe(false);

    const observed = observedOf(result.appliedGraph);
    const stored = observed.value as number;

    expect(typeof stored).toBe('number');
    // PLoT's own gate, restated as the invariant it is.
    expect(stored).toBeGreaterThanOrEqual(0);
    expect(stored).toBeLessThanOrEqual(1);
  });

  it('product seam: the stored state DENOTES 69 (meaning, not field names)', async () => {
    const result = await runEdit(
      editResponse([fieldPathOp('value', REQUESTED_RAW, 20)]),
      'Raise the unit price to 69',
    );
    expect(result.wasRejected).toBe(false);

    const observed = observedOf(result.appliedGraph);
    // Carrier-agnostic: whichever carrier holds it, the DENOTED quantity is
    // what the user asked for. This accepts any honest reconciliation and
    // rejects both "stripped" and "69 written into the normalised slot".
    const denoted =
      typeof observed.raw_value === 'number'
        ? observed.raw_value
        : (observed.value as number) * SCALE_FRAME;

    expect(denoted).toBeCloseTo(REQUESTED_RAW, 9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ⛔ RED — the REALISTIC batch: the two dominant shapes in one edit.
// ═══════════════════════════════════════════════════════════════════════════

describe('⛔ RED — "that\'s in pounds, raise it to £69" (both bare keys, one batch)', () => {
  it('product seam: the batch lands and the factor denotes £69', async () => {
    const result = await runEdit(
      editResponse([
        fieldPathOp('unit', '£', 'index'),
        fieldPathOp('value', REQUESTED_RAW, 20),
      ]),
      "That's in pounds, not an index — raise it to £69",
    );

    expect(rejectionCodeOf(result)).not.toBe('OPERATION_DID_NOT_LAND');
    expect(result.wasRejected).toBe(false);

    const observed = observedOf(result.appliedGraph);
    expect(observed.unit).toBe('£');

    const denoted =
      typeof observed.raw_value === 'number'
        ? observed.raw_value
        : (observed.value as number) * SCALE_FRAME;
    expect(denoted).toBeCloseTo(REQUESTED_RAW, 9);
    expect(observed.value as number).toBeLessThanOrEqual(1);
  });
});
