/**
 * R1 residual (follow-up to PR #509) — confirm-side value-op canonicalisation
 * for the held-batch apply seam.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 * A mixed compound edit ("set Setup and Migration Complexity to 0.5, and also
 * add a risk about data quality") is HELD by the graph-management referee and
 * re-applied LOCALLY on confirm by `executeGmHeldResume` via
 * `applyPatchOperations` — `applyUpdateNode` is a shallow `Object.assign`, so
 * whatever key the op carries is written onto the node VERBATIM. The edit
 * prompt (`edit-graph-v6.ts` PATH SYNTAX) teaches `/nodes/<id>/data/value`,
 * which `normalisePath` + the scalar-wrap turn into the LITERAL op key
 * `{ 'data/value': 0.5 }`. `NodeV3` declares neither `data` nor `data/value`,
 * so the GraphV3 re-parse in `applyAndValidateMutation` STRIPS the write and
 * `observed_state.value` never moves, while the structural siblings land.
 *
 * #509 made that HONEST (`heldBatchFullyLanded` refuses the whole batch) but
 * left the capability closed: the user was correctly told it did not work, and
 * still could not apply their value on this path. This module makes it apply.
 *
 * ── Why canonicalise here rather than round-trip PLoT ─────────────────────
 * The obvious alternative — route the confirm through the same PLoT call the
 * normal edit flow uses — does not exist to be routed to, and would not work
 * if it did:
 *   1. The live V5 edit path calls `handleEditGraph(ctx, msg, adapter, reqId,
 *      turnId)` with NO opts, so `plotClient` is `null` and PLoT is never
 *      called on the edit path at all. There is no PLoT round-trip to reuse.
 *   2. PLoT's `validate-patch` `CANONICAL_NODE_FIELDS` contains
 *      `observed_state` and NOT `data`, so a `data`/`data/value`-spelled
 *      `update_node` is REJECTED there (`INVALID_PATCH_FIELD`) — PLoT would
 *      hard-decline the live spelling, not canonicalise it.
 *   3. A network call inside a confirm would make a previously-pure,
 *      always-available user action fail on a PLoT outage, and PLoT's repair
 *      loop could return ops the user never confirmed — breaking the consent
 *      contract that the confirm applies EXACTLY the named batch.
 *
 * ── Why this is not a second, driftable canonicaliser ─────────────────────
 * Trap 12 (derive, don't mirror). Every input to the translation is derived
 * from the module that already OWNS it:
 *   - which node fields survive the re-parse → `NodeV3.shape` (the schema that
 *     does the stripping), never a hand-listed copy;
 *   - which `observed_state` sub-keys are tunable → `ALLOWED_OBSERVED_SUBKEYS`,
 *     imported from `field-safety.ts` (the referee's own allowlist);
 *   - merge-not-replace semantics → PLoT's own `update_node` behaviour
 *     (`deepMerge(node, op.value)` in `validate-patch.ts`), so a value write
 *     never wipes `unit` / `raw_value` / `cap` siblings;
 *   - the `data` ⇄ `observed_state` alias → the SAME equivalence
 *     `normaliseEditOpsForPlot` asserts when it renames `observed_state` →
 *     `data` for `add_node`, and that `field-safety.ts` asserts when it treats
 *     `root === 'observed_state' || root === 'data'` as one subtree.
 * The one irreducible constant is that alias, and it is NOT assume-good: an op
 * this module fails to translate is left VERBATIM, and `heldBatchFullyLanded`
 * then refuses the whole batch. Drift fails LOUD (an honest refusal), never
 * silently-green.
 *
 * ── Atomicity ─────────────────────────────────────────────────────────────
 * This module changes only the SPELLING of ops, never their number, order,
 * targets, or semantics. It runs AFTER the confirm-time re-referee (so the
 * verdict and its telemetry stay byte-identical) and BEFORE the local apply.
 * `heldBatchFullyLanded` remains the backstop: all-or-nothing per turn.
 *
 * Pure and total — never throws, never mutates its inputs.
 */
import { NodeV3 } from '../../schemas/cee-v3.js';
import { ALLOWED_OBSERVED_SUBKEYS } from '../graph-management/field-safety.js';
import type { PatchOperation } from '../../orchestrator/types.js';

/**
 * Node fields that SURVIVE the GraphV3 re-parse, derived from the schema that
 * performs the strip. A field added to (or removed from) `NodeV3` changes this
 * set automatically — there is no list to keep in sync.
 */
const NODE_DECLARED_FIELDS: ReadonlySet<string> = new Set(Object.keys(NodeV3.shape));

/** The canonical node field a tunable value write must land in. */
const OBSERVED_ROOT = 'observed_state';

/**
 * Producer spellings of {@link OBSERVED_ROOT}. `data` is the edit prompt's own
 * vocabulary ("Data: { value, raw_value, unit, cap, … }") and the rename
 * target `normaliseEditOpsForPlot` uses for `add_node`; `field-safety.ts`
 * already treats the two roots as one subtree.
 */
const OBSERVED_ROOT_SPELLINGS: ReadonlySet<string> = new Set([OBSERVED_ROOT, 'data']);

/**
 * Tunable leaves this module will translate, DERIVED from the referee's
 * allowlist minus `interventions`.
 *
 * `interventions` is deliberately excluded: `extractInterventionUpdates`
 * (edit-graph.ts) reads the `data.interventions` spelling OFF THE OPERATION,
 * so rewriting that subtree would break the option-configure chain that
 * option-configure-apply-chain.test.ts pins. An interventions op is left
 * verbatim and the atomicity guard refuses it honestly — exactly today's
 * behaviour.
 */
const TRANSLATABLE_LEAVES: ReadonlySet<string> = new Set(
  [...ALLOWED_OBSERVED_SUBKEYS].filter((k) => k !== 'interventions'),
);

/**
 * Path segments that could reach the prototype chain. Op keys are
 * model-controlled, so a key like `__proto__/value` is never translated (left
 * verbatim → guard refuses), mirroring `candidate-graph.ts`'s setter guard.
 */
const FORBIDDEN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Locate a node by id on an arbitrary (possibly hostile) ingress graph. */
function findNode(graph: unknown, nodeId: string): Record<string, unknown> | null {
  const g = asRecord(graph);
  if (g === null || !Array.isArray(g.nodes)) return null;
  for (const n of g.nodes) {
    const node = asRecord(n);
    if (node !== null && node.id === nodeId) return node;
  }
  return null;
}

/**
 * Canonicalise ONE `update_node` op's value payload. Returns `null` when
 * nothing needed translating, so the caller can return the ORIGINAL operation
 * object by reference (identity — byte-identical for canonical spellings).
 */
function canonicaliseUpdateNodeValue(
  value: Record<string, unknown>,
  currentNode: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  /** Accumulated tunable leaf writes destined for `observed_state`. */
  let observedPatch: Record<string, unknown> | null = null;

  for (const [key, to] of Object.entries(value)) {
    // A key the schema already declares (including a canonical `observed_state`
    // whole-object write) is passed through UNTOUCHED — its existing semantics,
    // whatever they are, are not this lane's to change.
    if (NODE_DECLARED_FIELDS.has(key)) {
      out[key] = to;
      continue;
    }

    const segments = key.split(/[/.]/).filter((s) => s.length > 0);
    if (
      segments.length === 0 ||
      segments.some((s) => FORBIDDEN_PATH_SEGMENTS.has(s)) ||
      !OBSERVED_ROOT_SPELLINGS.has(segments[0]!)
    ) {
      out[key] = to;
      continue;
    }

    if (segments.length === 1) {
      // Whole-root write in an alias spelling, e.g. `{ data: { value: 0.5 } }`.
      // Translate only when EVERY member is a tunable leaf; anything else
      // (an interventions map, an unknown sub-key) stays verbatim.
      const members = asRecord(to);
      if (
        members === null ||
        Object.keys(members).length === 0 ||
        !Object.keys(members).every((k) => TRANSLATABLE_LEAVES.has(k))
      ) {
        out[key] = to;
        continue;
      }
      observedPatch = { ...(observedPatch ?? {}), ...members };
      continue;
    }

    if (segments.length === 2 && TRANSLATABLE_LEAVES.has(segments[1]!)) {
      observedPatch = { ...(observedPatch ?? {}), [segments[1]!]: to };
      continue;
    }

    // Deeper paths (`data/interventions/<factor_id>`) and non-tunable leaves
    // are NOT this module's to rewrite — verbatim, guard decides.
    out[key] = to;
  }

  if (observedPatch === null) return null;

  // PLoT's `update_node` semantics (`deepMerge`): merge onto what the node
  // already has, so a value write never wipes `unit` / `raw_value` / `cap`.
  // An explicit `observed_state` in the same op still wins over the node's
  // existing state; the translated leaves win over both (they are the write
  // the user confirmed).
  const existing = asRecord(currentNode?.observed_state) ?? {};
  const explicit = asRecord(out[OBSERVED_ROOT]) ?? {};
  out[OBSERVED_ROOT] = { ...existing, ...explicit, ...observedPatch };
  return out;
}

/**
 * Translate every `update_node` value op in a confirmed held batch into the
 * field spelling GraphV3 preserves. Ops that need no translation are returned
 * BY REFERENCE; when no op changes, the input array is returned by reference
 * too, so a flag-on run over a canonical batch is byte-identical to flag-off.
 *
 * `currentGraph` is the graph the batch is about to be applied to — it supplies
 * the existing `observed_state` that translated leaves merge onto.
 */
export function canonicaliseHeldValueOps(
  operations: readonly PatchOperation[],
  currentGraph: unknown,
): { readonly operations: PatchOperation[]; readonly translatedCount: number } {
  let translatedCount = 0;
  const out = operations.map((op) => {
    if (op.op !== 'update_node') return op;
    const value = asRecord(op.value);
    if (value === null) return op;
    const canonical = canonicaliseUpdateNodeValue(value, findNode(currentGraph, op.path));
    if (canonical === null) return op;
    translatedCount += 1;
    return { ...op, value: canonical };
  });
  return {
    operations: translatedCount === 0 ? [...operations] : out,
    translatedCount,
  };
}
