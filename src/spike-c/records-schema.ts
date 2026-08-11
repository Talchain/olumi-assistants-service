/**
 * SPIKE ARM C — records schema (SEMANTIC-SPINE-SPIKE-PROTOCOL §2 arm C).
 *
 * ⚠ THROWAWAY. Spike branch only. Never merged, never pushed to `staging`.
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────
 * The grammar the draft LLM emits on arm C INSTEAD of a GraphV3. A deterministic
 * projector (`project.ts`) turns the record set into GraphV3; every existing
 * consumer downstream of the parse stage is unchanged.
 *
 * ── ⚠ TERMINOLOGY CORRECTION (reported finding, protocol §2 / §7 C-K0) ─────
 * The protocol calls this "the records TOOL schema" and C-K0 "the records tool
 * schema fails the live compile probe". Derived at `75516366`: the draft path
 * does NOT use a `tools[]` entry. It uses Anthropic **structured outputs** —
 * `output_config.format = { type: "json_schema", schema }` (anthropic.ts:908-916,
 * `buildCallParams`). So the seam arm C occupies is the structured-outputs
 * schema slot the graph schema occupies today, not a tool definition. The
 * budgets and failure mode are the structured-outputs grammar compiler's.
 * Named, not silently reinterpreted.
 *
 * ── ⚠ THE BINDING BUDGET IS NOT THE ONE THE PROTOCOL CITES ─────────────────
 * §2/§7 C-K0 cites the "optional-parameter budget — the graph schema died at
 * 23/24". Derived at the bytes (anthropic-graph-schema.ts:29-102 and
 * scripts/probe-grammar-compile.mjs): the optional-parameter limit is real but
 * is NOT what killed the graph schema. The dominant, UNPUBLISHED constraint is
 * COMPILED GRAMMAR SIZE, established by a 15-probe live bisect on 2026-07-07:
 *   PASS boundary ~3.2KB / 7 object schemas · FAIL ~3.5KB / 9 object schemas
 * (claude-sonnet-4-6, the frozen spike model). The repo pins
 * SERIALIZED_BYTES_BUDGET = 3400. A schema can satisfy every static budget and
 * still draw 400 "The compiled grammar is too large" — at which point the
 * adapter SILENTLY falls back to prompt-only JSON on every draft. That silent
 * fallback is the real C-K0 hazard, and it is a measurement-validity hazard for
 * the whole arm, not merely a kill condition.
 *
 * This schema is therefore built to be structurally CHEAPER than the graph
 * schema on every axis at once (measured, see BUDGET below).
 *
 * ── DESIGN DECISIONS THAT ARE NOT FREE (each one reported) ─────────────────
 *
 * 1. THE LLM MINTS NO IDENTIFIERS. §2 requires `id` be "CEE-minted
 *    sha8(kind + normalised quote), never LLM-minted" — but the same block
 *    gives `InferenceClaim.basis` as "stated_item_ids it builds on". Those two
 *    clauses are in tension: the model cannot cite an id CEE has not minted yet.
 *    RESOLVED by referencing ARRAY POSITION on the wire and resolving
 *    position → minted id inside the projector. `basis` is integer indices into
 *    `stated_items`; `from_ref`/`to_ref` are `s<N>` / `c<N>` tokens. No
 *    identifier crosses the wire, so the "never LLM-minted" rule holds
 *    literally, and it is the projector — a pure function — that owns identity.
 *
 * 2. `stated_items` CARRIES `minItems: 1`; `claims` DELIBERATELY DOES NOT.
 *    The empty-array hole is real and shipped twice here (nodes/edges, CEE #876
 *    and the 2026-08-08 edge regression): `required` + unbounded array means
 *    `[]` is strictly conformant. A brief always states something, so bounding
 *    `stated_items` is safe. Bounding `claims` is NOT: forcing >=1 inference on
 *    every draft manufactures pressure to invent one, and F2 (zero false
 *    authorship) is the floor arm C exists to defend. Trap 23 is the governing
 *    lesson — a grammar can forbid a shape, it cannot compel sufficiency; a
 *    forced floor would buy a better-looking claim count and a worse authorship
 *    number. Anthropic accepts `minItems` ∈ {0,1} ONLY (`minItems: 4` → HTTP
 *    400, live-probed by the graph-schema lane), so no larger floor was
 *    available even had one been wanted.
 *
 * 3. KIND-SCOPED FIELDS ARE OPTIONAL, NOT REQUIRED-NULLABLE. The graph schema's
 *    v9 amendment (anthropic-graph-schema.ts:88-102) measured this: required-
 *    nullable forces EVERY item to emit EVERY field, and draft latency is
 *    near-linear in output tokens. Optional costs a slot on the 24-budget;
 *    required-nullable costs a slot on the 16-union budget AND real wall-clock
 *    on every run. Optional is cheaper on both the union budget and C-K2
 *    (latency). Discriminators (`kind`, `source_quote`, `claim_kind`, `label`)
 *    stay required so the projector's switch is never undefined.
 *
 * 4. `direction` IS `floor` | `ceiling` — THE GATE'S LANGUAGE, NEVER THE WIRE
 *    OPERATOR. §2 is explicit and CEE #888's four oscillating rounds are the
 *    reason. The projector performs the single mapping to
 *    `ConstraintOperator` (`z.enum([">=", "<="])`, graph.ts:171), derived at the
 *    consumer's bytes rather than inferred, and it is pinned by a test.
 */

// ── Vocabulary, seeded from shipped machinery (§0.2), minting nothing new ────

/**
 * The S1 `STATED_KINDS` SUBSET with live relevance to drafting (§2).
 * Full shipped vocabulary is 8 (`cee/context-integrity/not-modelled-manifest.ts`);
 * arm C takes the 4 the projector can actually place on a graph. The other four
 * (`evidence`, `assumption`, `disagreement`, `correction`) have no node kind to
 * land on and are OUT OF SCOPE for this arm — an omission on the record, not a
 * silent narrowing.
 */
export const SPIKE_C_STATED_KINDS = ["goal", "option", "constraint", "figure"] as const;
export type SpikeCStatedKind = (typeof SPIKE_C_STATED_KINDS)[number];

/** ≈ `NumericAnchor.role` (`cee/signals/types.ts:22-27`). */
export const SPIKE_C_ROLES = ["target", "baseline", "constraint", "context"] as const;
export type SpikeCRole = (typeof SPIKE_C_ROLES)[number];

/** The GATE's language. Never the wire operator — see design note 4. */
export const SPIKE_C_DIRECTIONS = ["floor", "ceiling"] as const;
export type SpikeCDirection = (typeof SPIKE_C_DIRECTIONS)[number];

/** §2 `InferenceClaim.claim_kind`. */
export const SPIKE_C_CLAIM_KINDS = ["factor", "causal_link", "option_refinement", "prior"] as const;
export type SpikeCClaimKind = (typeof SPIKE_C_CLAIM_KINDS)[number];

/** `FactorCategory` (graph.ts). */
export const SPIKE_C_CATEGORIES = ["controllable", "observable", "external"] as const;
export type SpikeCCategory = (typeof SPIKE_C_CATEGORIES)[number];

/** `EffectDirection` (graph.ts:356). */
export const SPIKE_C_EFFECTS = ["positive", "negative"] as const;
export type SpikeCEffect = (typeof SPIKE_C_EFFECTS)[number];

// ── The wire shapes (TS mirrors of the JSON Schema below) ───────────────────

/** What the user said. `id` is absent BY DESIGN — see design note 1. */
export interface SpikeCStatedItem {
  kind: SpikeCStatedKind;
  /** REQUIRED, verbatim. Verified by substring location against the brief. */
  source_quote: string;
  value?: number;
  unit?: string;
  role?: SpikeCRole;
  /** `constraint` only. */
  direction?: SpikeCDirection;
}

/** What the model adds — the honesty half. `id` absent by design. */
export interface SpikeCInferenceClaim {
  claim_kind: SpikeCClaimKind;
  label: string;
  /** Indices into `stated_items`. Empty/absent ⇒ pure invention, and marked so. */
  basis?: number[];
  /** `causal_link` only. `s<N>` = stated_items[N]; `c<N>` = claims[N]. */
  from_ref?: string;
  to_ref?: string;
  effect?: SpikeCEffect;
  strength?: number;
  category?: SpikeCCategory;
  value?: number;
}

export interface SpikeCRecordSet {
  stated_items: SpikeCStatedItem[];
  claims: SpikeCInferenceClaim[];
}

// ── The structured-outputs JSON Schema ──────────────────────────────────────

/**
 * Built by a FUNCTION, not exported as a frozen literal, so the C-K0 probe and
 * the budget test measure the EXACT object the adapter attaches (the lesson
 * `scripts/probe-grammar-compile.mjs` states: "this probes the EXACT object
 * production attaches, not a copy").
 *
 * Compliant by construction: every `type: "object"` carries
 * `additionalProperties: false`; no `$ref`, `oneOf`, `minimum`, `maximum`,
 * `pattern`, `maxItems`, or `format` anywhere.
 */
export function buildSpikeCRecordsSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      stated_items: {
        type: "array",
        // See design note 2. `minItems` ∈ {0,1} only.
        minItems: 1,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...SPIKE_C_STATED_KINDS] },
            source_quote: { type: "string" },
            value: { type: "number" },
            unit: { type: "string" },
            role: { type: "string", enum: [...SPIKE_C_ROLES] },
            direction: { type: "string", enum: [...SPIKE_C_DIRECTIONS] },
          },
          required: ["kind", "source_quote"],
          additionalProperties: false,
        },
      },
      claims: {
        type: "array",
        // NO minItems — see design note 2. This absence is load-bearing.
        items: {
          type: "object",
          properties: {
            claim_kind: { type: "string", enum: [...SPIKE_C_CLAIM_KINDS] },
            label: { type: "string" },
            basis: { type: "array", items: { type: "integer" } },
            from_ref: { type: "string" },
            to_ref: { type: "string" },
            effect: { type: "string", enum: [...SPIKE_C_EFFECTS] },
            strength: { type: "number" },
            category: { type: "string", enum: [...SPIKE_C_CATEGORIES] },
            value: { type: "number" },
          },
          required: ["claim_kind", "label"],
          additionalProperties: false,
        },
      },
    },
    required: ["stated_items", "claims"],
    additionalProperties: false,
  };
}

// ── Static budget instruments (C-K0's cheap half) ───────────────────────────

/**
 * Anthropic's published static limits, and the empirically-bisected grammar-size
 * boundary. The bytes budget is the repo's own pin (3400) — deliberately reused
 * rather than re-derived, because it is the number the graph schema's live
 * probes calibrated.
 */
export const ANTHROPIC_OPTIONAL_PARAM_LIMIT = 24;
export const ANTHROPIC_UNION_PARAM_LIMIT = 16;
export const SERIALIZED_BYTES_BUDGET = 3400;
/** Anthropic accepts these and only these (live-probed; `minItems: 4` → 400). */
export const MIN_ITEMS_ALLOWED_VALUES = [0, 1] as const;

/** Count properties NOT listed in their object's `required` array. */
export function countOptionalParams(obj: unknown): number {
  if (obj === null || typeof obj !== "object") return 0;
  if (Array.isArray(obj)) return obj.reduce((n: number, v) => n + countOptionalParams(v), 0);
  const rec = obj as Record<string, unknown>;
  let count = 0;
  if (rec.type === "object" && rec.properties && typeof rec.properties === "object") {
    const props = Object.keys(rec.properties as Record<string, unknown>);
    const req = new Set(Array.isArray(rec.required) ? (rec.required as string[]) : []);
    count += props.filter((p) => !req.has(p)).length;
  }
  for (const v of Object.values(rec)) count += countOptionalParams(v);
  return count;
}

/** Count fields typed by `anyOf` or a `type: [...]` array. */
export function countUnionParams(obj: unknown): number {
  if (obj === null || typeof obj !== "object") return 0;
  if (Array.isArray(obj)) return obj.reduce((n: number, v) => n + countUnionParams(v), 0);
  const rec = obj as Record<string, unknown>;
  let count = 0;
  if (Array.isArray(rec.anyOf) || Array.isArray(rec.type)) count += 1;
  for (const v of Object.values(rec)) count += countUnionParams(v);
  return count;
}

/** Count `type: "object"` schemas — the bisect's dominant compile-cost proxy. */
export function countObjectSchemas(obj: unknown): number {
  if (obj === null || typeof obj !== "object") return 0;
  if (Array.isArray(obj)) return obj.reduce((n: number, v) => n + countObjectSchemas(v), 0);
  const rec = obj as Record<string, unknown>;
  let count = rec.type === "object" ? 1 : 0;
  for (const v of Object.values(rec)) count += countObjectSchemas(v);
  return count;
}

/** Every `minItems` value present, so a disallowed one fails loud. */
export function collectMinItemsValues(obj: unknown): number[] {
  if (obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap((v) => collectMinItemsValues(v));
  const rec = obj as Record<string, unknown>;
  const out: number[] = [];
  if (typeof rec.minItems === "number") out.push(rec.minItems);
  for (const v of Object.values(rec)) out.push(...collectMinItemsValues(v));
  return out;
}

/** Keywords the structured-outputs compiler rejects outright (capture-first §1.4 S). */
export const FORBIDDEN_SCHEMA_KEYWORDS = [
  "minimum",
  "maximum",
  "pattern",
  "maxItems",
  "minLength",
  "maxLength",
  "multipleOf",
  "format",
  "$ref",
  "oneOf",
  "allOf",
] as const;

export function findForbiddenKeywords(obj: unknown): string[] {
  if (obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap((v) => findForbiddenKeywords(v));
  const rec = obj as Record<string, unknown>;
  const out: string[] = [];
  for (const k of Object.keys(rec)) {
    if ((FORBIDDEN_SCHEMA_KEYWORDS as readonly string[]).includes(k)) out.push(k);
  }
  for (const v of Object.values(rec)) out.push(...findForbiddenKeywords(v));
  return out;
}

/** Every `type: "object"` must carry `additionalProperties: false`. Returns offenders' paths. */
export function findObjectsMissingAdditionalPropertiesFalse(obj: unknown, path = "$"): string[] {
  if (obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => findObjectsMissingAdditionalPropertiesFalse(v, `${path}[${i}]`));
  const rec = obj as Record<string, unknown>;
  const out: string[] = [];
  if (rec.type === "object" && rec.additionalProperties !== false) out.push(path);
  for (const [k, v] of Object.entries(rec)) out.push(...findObjectsMissingAdditionalPropertiesFalse(v, `${path}.${k}`));
  return out;
}

export interface SpikeCBudgetReport {
  serializedBytes: number;
  optionalParams: number;
  unionParams: number;
  objectSchemas: number;
  minItemsValues: number[];
  forbiddenKeywords: string[];
  objectsMissingAdditionalPropertiesFalse: string[];
}

export function measureSpikeCSchemaBudget(
  schema: Record<string, unknown> = buildSpikeCRecordsSchema(),
): SpikeCBudgetReport {
  return {
    serializedBytes: JSON.stringify(schema).length,
    optionalParams: countOptionalParams(schema),
    unionParams: countUnionParams(schema),
    objectSchemas: countObjectSchemas(schema),
    minItemsValues: collectMinItemsValues(schema),
    forbiddenKeywords: findForbiddenKeywords(schema),
    objectsMissingAdditionalPropertiesFalse: findObjectsMissingAdditionalPropertiesFalse(schema),
  };
}
