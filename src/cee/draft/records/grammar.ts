/**
 * THE DRAFT RECORDS GRAMMAR — what the draft model emits, INSTEAD of a graph.
 *
 * ── THE THREE SHAPES, NAMED APART (trap 21) ────────────────────────────────
 * There are three distinct shapes in this mechanism and they must never share a
 * name:
 *
 *   1. THIS FILE — the MODEL-FACING GRAMMAR. Lives in CEE code, occupies the
 *      `output_config.format.json_schema` slot. Governed by Anthropic's grammar
 *      budgets. Changes on instruction/grammar iteration and NEVER on a
 *      `@talchain/schemas` train.
 *   2. The CEE-INTERNAL STORED RECORDS (the ledger) — CEE-side only, no
 *      published contract.
 *   3. The PUBLISHED WIRE CONTRACT (`@talchain/schemas`) — untouched by this
 *      change. The maths never reads records: PLoT and ISL continue to receive
 *      the GRAPH only.
 *
 * ── WHY RECORDS AND NOT A GRAPH ────────────────────────────────────────────
 * Measured per atom at the raw provider bytes over 42 same-window runs
 * (2026-08-11): 83–89 % of material loss happens at GENERATION — the model never
 * emitted the fact — not in repair or validation. No downstream hardening can
 * recover an atom that was never produced. The output contract is therefore the
 * right seam, and a record set is the shape that lets the model state what the
 * user said SEPARATELY from what the model itself is adding.
 *
 * ── ⚠ TERMINOLOGY: THIS IS NOT A TOOL SCHEMA ───────────────────────────────
 * The draft path does not use a `tools[]` entry. It uses Anthropic STRUCTURED
 * OUTPUTS — `output_config.format = { type: "json_schema", schema }`
 * (`anthropic.ts`, `buildCallParams`). The seam this grammar occupies is the
 * structured-outputs schema slot the graph grammar occupies today.
 *
 * ── ⚠ THE BINDING BUDGET IS COMPILED GRAMMAR SIZE ──────────────────────────
 * The published optional-parameter limit is real but is not what killed the
 * graph schema. The dominant, UNPUBLISHED constraint is COMPILED GRAMMAR SIZE,
 * established by a 15-probe live bisect on 2026-07-07:
 *   PASS boundary ~3.2KB / 7 object schemas · FAIL ~3.5KB / 9 object schemas
 * The repo pins `SERIALIZED_BYTES_BUDGET = 3400`. A schema can satisfy every
 * static budget and still draw 400 "The compiled grammar is too large" — at
 * which point the adapter SILENTLY falls back to prompt-only JSON on every
 * draft. That silent fallback is the real hazard, which is why the budget
 * instruments below are exported and asserted in CI rather than being a
 * one-off probe.
 *
 * This grammar is structurally CHEAPER than the graph grammar on every axis at
 * once, and was live-compile-probed (HTTP 200, with a 400-producing negative
 * control and a same-run contrast control) before any run was spent on it.
 *
 * ── DESIGN DECISIONS THAT ARE NOT FREE (each one recorded) ─────────────────
 *
 * 1. THE MODEL MINTS NO IDENTIFIERS. It cannot cite an id CEE has not minted
 *    yet, so records reference each other by ARRAY POSITION on the wire
 *    (`basis` = integer indices into `stated_items`; `from_ref`/`to_ref` =
 *    `s<N>` / `c<N>` tokens) and the PROJECTOR resolves position → minted id.
 *    No identifier crosses the wire; the projector — a pure function — owns
 *    identity.
 *
 * 2. `stated_items` CARRIES `minItems: 1`; `claims` DELIBERATELY DOES NOT.
 *    `required` + an unbounded array means `[]` is strictly conformant, and
 *    this estate has shipped that hole twice. A brief always states something,
 *    so bounding `stated_items` is safe. Bounding `claims` is NOT: forcing >=1
 *    inference on every draft manufactures pressure to INVENT one, and zero
 *    false authorship is the property this mechanism exists to defend. A
 *    grammar can forbid a shape; it cannot compel sufficiency (trap 23) — a
 *    forced floor would buy a better-looking claim count and a worse
 *    authorship number. Anthropic accepts `minItems` ∈ {0,1} ONLY
 *    (`minItems: 4` → HTTP 400, live-probed), so no larger floor exists anyway.
 *
 * 3. KIND-SCOPED FIELDS ARE OPTIONAL, NOT REQUIRED-NULLABLE. Required-nullable
 *    forces EVERY item to emit EVERY field, and draft latency is near-linear in
 *    output tokens. Optional costs a slot on the 24-budget; required-nullable
 *    costs a slot on the 16-union budget AND real wall-clock on every run.
 *    Discriminators (`kind`, `source_quote`, `claim_kind`, `label`) stay
 *    REQUIRED so the projector's switch is never undefined.
 *
 * 4. `direction` IS `floor` | `ceiling` — THE USER'S LANGUAGE, NEVER THE WIRE
 *    OPERATOR. CEE #888 burned four rounds on a floor/ceiling predicate. The
 *    projector performs the single mapping to `ConstraintOperator`
 *    (`z.enum([">=", "<="])`, `schemas/graph.ts:171`), derived at the consumer's
 *    bytes rather than inferred, and pinned by a test.
 */

import { createHash } from "node:crypto";

// ── Vocabulary, seeded from shipped machinery, minting nothing new ──────────

/**
 * The `STATED_KINDS` SUBSET with live relevance to drafting.
 * Full shipped vocabulary is 8 (`cee/context-integrity/not-modelled-manifest.ts`);
 * this grammar takes the 4 the projector can actually place on a graph. The other four
 * (`evidence`, `assumption`, `disagreement`, `correction`) have no node kind to
 * land on and are OUT OF SCOPE for the DRAFTABLE subset — an omission
 * on the record, not a silent narrowing. They ship as explicit not-tracked
 * entries at the receipt surface (slice R2), never silently absent.
 */
export const DRAFT_RECORD_STATED_KINDS = ["goal", "option", "constraint", "figure"] as const;
export type DraftRecordStatedKind = (typeof DRAFT_RECORD_STATED_KINDS)[number];

/** ≈ `NumericAnchor.role` (`cee/signals/types.ts:22-27`). */
export const DRAFT_RECORD_ROLES = ["target", "baseline", "constraint", "context"] as const;
export type DraftRecordRole = (typeof DRAFT_RECORD_ROLES)[number];

/** The GATE's language. Never the wire operator — see design note 4. */
export const DRAFT_RECORD_DIRECTIONS = ["floor", "ceiling"] as const;
export type DraftRecordDirection = (typeof DRAFT_RECORD_DIRECTIONS)[number];

/** The inference-claim kinds. */
export const DRAFT_RECORD_CLAIM_KINDS = ["factor", "causal_link", "option_refinement", "prior"] as const;
export type DraftRecordClaimKind = (typeof DRAFT_RECORD_CLAIM_KINDS)[number];

/** `FactorCategory` (graph.ts). */
export const DRAFT_RECORD_CATEGORIES = ["controllable", "observable", "external"] as const;
export type DraftRecordCategory = (typeof DRAFT_RECORD_CATEGORIES)[number];

/** `EffectDirection` (graph.ts:356). */
export const DRAFT_RECORD_EFFECTS = ["positive", "negative"] as const;
export type DraftRecordEffect = (typeof DRAFT_RECORD_EFFECTS)[number];

// ── The wire shapes (TS mirrors of the JSON Schema below) ───────────────────

/** What the user said. `id` is absent BY DESIGN — see design note 1. */
export interface DraftStatedItem {
  kind: DraftRecordStatedKind;
  /** REQUIRED, verbatim. Verified by substring location against the brief. */
  source_quote: string;
  value?: number;
  unit?: string;
  role?: DraftRecordRole;
  /** `constraint` only. */
  direction?: DraftRecordDirection;
}

/** What the model adds — the honesty half. `id` absent by design. */
export interface DraftInferenceClaim {
  claim_kind: DraftRecordClaimKind;
  label: string;
  /** Indices into `stated_items`. Empty/absent ⇒ pure invention, and marked so. */
  basis?: number[];
  /** `causal_link` only. `s<N>` = stated_items[N]; `c<N>` = claims[N]. */
  from_ref?: string;
  to_ref?: string;
  effect?: DraftRecordEffect;
  strength?: number;
  category?: DraftRecordCategory;
  value?: number;
  /**
   * `causal_link` FROM AN OPTION ONLY — the value the target factor takes if
   * that option is chosen, in the factor's own unit. Becomes an entry in the
   * option node's `OptionData.interventions` (`schemas/graph.ts:163`), which is
   * what lets the analysis compute a real number rather than compare bare
   * labels.
   *
   * ⚠ DELIBERATELY NOT `strength`, and the two must never be merged. `strength`
   * answers "how strongly does A cause B" and lands on the EDGE as
   * `strength_mean`. `sets_to` answers "what level does this option put the
   * factor at" and lands on the OPTION NODE. Two questions under one name is
   * trap 21, and this estate has paid for it repeatedly; the extra optional
   * slot is cheap (13 free against Anthropic's 24) and the conflation is not.
   */
  sets_to?: number;
}

export interface DraftRecordSet {
  stated_items: DraftStatedItem[];
  claims: DraftInferenceClaim[];
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
export function buildDraftRecordsSchema(): Record<string, unknown> {
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
            kind: { type: "string", enum: [...DRAFT_RECORD_STATED_KINDS] },
            source_quote: { type: "string" },
            value: { type: "number" },
            unit: { type: "string" },
            role: { type: "string", enum: [...DRAFT_RECORD_ROLES] },
            direction: { type: "string", enum: [...DRAFT_RECORD_DIRECTIONS] },
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
            claim_kind: { type: "string", enum: [...DRAFT_RECORD_CLAIM_KINDS] },
            label: { type: "string" },
            basis: { type: "array", items: { type: "integer" } },
            from_ref: { type: "string" },
            to_ref: { type: "string" },
            effect: { type: "string", enum: [...DRAFT_RECORD_EFFECTS] },
            strength: { type: "number" },
            category: { type: "string", enum: [...DRAFT_RECORD_CATEGORIES] },
            value: { type: "number" },
            // Option→factor intervention level. See the interface note: named
            // apart from `strength` on purpose.
            sets_to: { type: "number" },
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

/** Keywords the structured-outputs grammar compiler rejects outright. */
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

export interface DraftRecordsBudgetReport {
  serializedBytes: number;
  optionalParams: number;
  unionParams: number;
  objectSchemas: number;
  minItemsValues: number[];
  forbiddenKeywords: string[];
  objectsMissingAdditionalPropertiesFalse: string[];
}

export function measureDraftRecordsSchemaBudget(
  schema: Record<string, unknown> = buildDraftRecordsSchema(),
): DraftRecordsBudgetReport {
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

/**
 * sha256 of the serialised grammar attached to the request.
 *
 * Derived from `buildDraftRecordsSchema()` itself, never from a copy: the hash a
 * run records must be the hash of the object the adapter actually attached, or
 * it is a claim about a different schema.
 */
export function draftRecordsGrammarHash(): string {
  return createHash("sha256")
    .update(JSON.stringify(buildDraftRecordsSchema()), "utf8")
    .digest("hex");
}
