/**
 * ROADMAP 2.380 — write semantics for REQUIRED NESTED OBJECT fields, owned in
 * ONE place so the two writers can never drift again.
 *
 * WHY THIS MODULE EXISTS (the defect it retires)
 * ----------------------------------------------
 * `EdgeV3.strength` is a REQUIRED nested object with REQUIRED `{mean, std}`
 * members. Two independent code paths write it:
 *
 *   - the LIVE applier, `orchestrator/patch-applier.ts` — hardened 2026-05-12
 *     (`85a18f52`) to MERGE a partial write over the existing sub-object;
 *   - the graph-management REFEREE's candidate builder,
 *     `orchestrator-v5/graph-management/candidate-graph.ts` — which REPLACED
 *     the whole object, dropping `std`.
 *
 * Because `referee.ts` ADOPTS a built candidate as the applied view for
 * tunable mutations, the referee's replace OVERWROTE the applier's correct
 * merge; the candidate then failed `GraphV3.parse` and the live gate discarded
 * the edit. Result: 0 of 15 live edge-strength edits changed the model
 * (L52 diagnosis, 2026-08-04). The applier's hardening comment described the
 * hazard exactly — the referee just never learned it. A second hand-written
 * copy of the semantics is precisely the mirror that caused this, so the
 * semantics live HERE and both sides import them.
 *
 * WHAT IS DERIVED, AND WHAT DERIVATION CANNOT DO (CLAUDE.md trap 12d)
 * ------------------------------------------------------------------
 * `requiredNestedObjectFields` reads the canonical Zod schema: a field is
 * "required nested object" iff its declared schema IS a `ZodObject` — an
 * optional field is a `ZodOptional` wrapper, so it is excluded by
 * construction, never by a hand-maintained exclusion list. This means a
 * future required nested object on `EdgeV3` is covered without anyone
 * remembering to add it.
 *
 * Derivation proves the two writers AGREE. It can NEVER prove the derived set
 * is RIGHT — it is structurally blind to a member the schema itself omits.
 * The companion guard is therefore a hand-written corpus of real write shapes
 * in `graph-management/__tests__/applier-referee-tunable-parity.test.ts`.
 * Neither guard supersedes the other; both ship.
 *
 * SCOPE: root-level fields of an entity object. That is deliberately the same
 * scope the applier operates on (it merges over the keys of `op.value`), so
 * the two paths agree by construction rather than by coincidence.
 *
 * PURITY: zod + the canonical schemas only. No I/O, no telemetry, no live-path
 * coupling, no hash derivation, no persistence — which is what makes it
 * admissible across the `graph-management` import boundary (see the comment on
 * `ALLOWED_RESOLVED` in `graph-management/__tests__/isolation-guards.test.ts`).
 */
import { z } from 'zod';

import { EdgeV3, NodeV3 } from './cee-v3.js';

/**
 * The root-level fields of `schema` whose declared type is a REQUIRED nested
 * object. Optional fields resolve to `ZodOptional` (not `ZodObject`) and are
 * excluded by construction — there is no exclusion list to maintain.
 */
export function requiredNestedObjectFields(
  schema: z.ZodObject<z.ZodRawShape>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [key, def] of Object.entries(schema.shape)) {
    if (def instanceof z.ZodObject) out.add(key);
  }
  return out;
}

/**
 * The declared member names of a required nested object field, in declaration
 * order — used to build a refusal message that names the real members instead
 * of restating them as a literal that could drift from the schema.
 * Empty when `field` is not a required nested object on `schema`.
 */
export function requiredNestedMemberNames(
  schema: z.ZodObject<z.ZodRawShape>,
  field: string,
): readonly string[] {
  const def = schema.shape[field];
  if (!(def instanceof z.ZodObject)) return [];
  return Object.keys(def.shape);
}

/** Derived once at module load: `EdgeV3` → `{ strength }` at time of writing. */
export const EDGE_REQUIRED_NESTED_FIELDS: ReadonlySet<string> =
  requiredNestedObjectFields(EdgeV3);

/**
 * Derived once at module load: `NodeV3` → EMPTY at time of writing (every
 * object-typed NodeV3 field — `observed_state`, `prior` — is `.optional()`).
 * That asymmetry is exactly why `update_node_field` survived the whole-object
 * replace and `update_edge_field` did not. Passing the derived set (rather
 * than skipping the node path) keeps the two entity paths structurally
 * identical, so a future required nested object on `NodeV3` is handled the
 * same way on both writers without a second diagnosis.
 */
export const NODE_REQUIRED_NESTED_FIELDS: ReadonlySet<string> =
  requiredNestedObjectFields(NodeV3);

/**
 * Read a dynamically-named field off a typed entity.
 *
 * Exists so callers iterating a DERIVED field set do not each need their own
 * double-cast through `unknown` — a pattern the forbidden-boundary ratchet
 * (`scripts/check-forbidden-boundary-patterns.sh`) blocks the growth of, and
 * rightly: three copies of it would have been three places where an unchecked
 * shape assumption hides. One single assertion, here, next to the merge it
 * feeds. Callers write back via `Object.assign`, which needs no assertion.
 */
export function readNestedField(target: object, field: string): unknown {
  return (target as Record<string, unknown>)[field];
}

/** A plain (non-null, non-array) object — the only coherent shape for a
 *  partial write onto a nested object field. */
export function isPlainObjectWrite(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Name the incoherent shape for a refusal message, without echoing its value
 *  (the value is model-controlled and must not reach a user-facing string). */
export function describeNonObjectWrite(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Merge a partial write over the existing nested object. THE contract:
 *
 *  - members the write does not mention are PRESERVED (this is the whole
 *    point — a write carrying only `{mean}` must not strip `std`);
 *  - members the write mentions WIN;
 *  - an explicit `undefined` member is treated as "no change", never as a
 *    wipe. JSON parsing cannot produce an `undefined` own property, so the
 *    production path is unaffected; the rule matters for direct JS callers
 *    (tests, future internal use), where treating `{ std: undefined }` as a
 *    wipe would silently re-introduce this exact defect.
 *
 * `existing` is tolerated as `unknown`: a base graph whose nested field is
 * absent or malformed degrades to "the write is the whole value" rather than
 * throwing, and the caller's post-write schema validation remains the gate.
 */
export function mergeRequiredNestedWrite(
  existing: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const base = isPlainObjectWrite(existing) ? existing : {};
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(incoming)) {
    if (incoming[key] !== undefined) filtered[key] = incoming[key];
  }
  return { ...base, ...filtered };
}
