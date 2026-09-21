/**
 * Rich Decision Model v0 — TypeScript mirror of
 * `tools/graph-evaluator/contracts/rich-decision-model.v0.json`.
 *
 * WHY THIS FILE EXISTS AS A HAND-WRITTEN MIRROR RATHER THAN A GENERATED TYPE.
 * The JSON Schema is the wire contract: it is what OpenAI (`text.format`) and
 * Anthropic (`output_config.format`) compile into a grammar, and it is what the
 * OpenAI Connected Witness lane consumes (CONTRACT-v0/README.md). The types here
 * exist so that our own deterministic validators (source-binding, projection)
 * cannot silently drift from it. `assertSchemaMirrorsTypes()` below is the
 * cheapest check that the two have not separated: it reads the contract at
 * runtime and asserts the top-level required list matches this file's view.
 *
 * NULL DISCIPLINE (contract §description): a null numeric means "not stated /
 * unknown", NEVER 0. Nothing in this file may default a null to a number.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { extractJSON } from "./json-extractor.js";
import type { GraphEdge, GraphNode, ParsedGraph } from "./types.js";

// =============================================================================
// Enumerations (mirror of the contract's `enum` members, in contract order)
// =============================================================================

export const HORIZON_UNITS = ["days", "weeks", "months", "quarters", "years"] as const;
export type HorizonUnit = (typeof HORIZON_UNITS)[number];

export const USER_FACT_KINDS = [
  "goal",
  "option",
  "quantity",
  "limit",
  "cause",
  "horizon",
  "qualitative",
  "context",
] as const;
export type UserFactKind = (typeof USER_FACT_KINDS)[number];

export const USER_FACT_ROLES = [
  "target",
  "baseline",
  "current",
  "proposed",
  "limit",
  "horizon",
  "context",
  "not_numeric",
] as const;
export type UserFactRole = (typeof USER_FACT_ROLES)[number];

export const EPISTEMIC_STATES = [
  "known",
  "observed",
  "user_estimate",
  "external_evidence",
  "ai_hypothesis",
  "unknown",
] as const;
export type EpistemicState = (typeof EPISTEMIC_STATES)[number];

/** Epistemic states that assert a user/observed origin and therefore REQUIRE an anchor. */
export const ANCHOR_REQUIRING_EPISTEMIC_STATES: readonly EpistemicState[] = [
  "known",
  "observed",
  "user_estimate",
];

export const ITEM_PROVENANCES = ["user", "ai_proposed"] as const;
export type ItemProvenance = (typeof ITEM_PROVENANCES)[number];

export const LINK_PROVENANCES = ["user", "ai_hypothesis"] as const;
export type LinkProvenance = (typeof LINK_PROVENANCES)[number];

export const CONTROL_KINDS = ["lever", "observable", "external"] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export const MEASURABILITIES = ["quantitative", "qualitative"] as const;
export type Measurability = (typeof MEASURABILITIES)[number];

export const OUTCOME_KINDS = ["outcome", "risk"] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export const BETTER_DIRECTIONS = ["higher", "lower"] as const;
export type BetterDirection = (typeof BETTER_DIRECTIONS)[number];

export const CONSTRAINT_OPERATORS = ["<", "<=", ">", ">=", "="] as const;
export type ConstraintOperator = (typeof CONSTRAINT_OPERATORS)[number];

export const EFFECT_DIRECTIONS = ["positive", "negative", "unknown"] as const;
export type EffectDirection = (typeof EFFECT_DIRECTIONS)[number];

export const MAGNITUDE_KINDS = ["unknown", "qualitative", "user_estimate", "ai_estimate"] as const;
export type MagnitudeKind = (typeof MAGNITUDE_KINDS)[number];

export const PERSISTENCE_KINDS = ["permanent", "decays", "one_off", "unknown"] as const;
export type PersistenceKind = (typeof PERSISTENCE_KINDS)[number];

export const NOTE_KINDS = ["correction", "challenge", "assumption", "limitation"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

// =============================================================================
// Model types
// =============================================================================

export interface RichHorizon {
  value: number | null;
  unit: HorizonUnit | null;
  source_fact_id: string | null;
}

export interface RichDecision {
  question: string;
  horizon: RichHorizon;
}

export interface RichUserFact {
  id: string;
  kind: UserFactKind;
  /** Verbatim contiguous span of the brief. Never paraphrased. */
  source_quote: string;
  /** Native magnitude (59 not 0.59; 4 for 4%). null = not stated. */
  value: number | null;
  unit: string | null;
  role: UserFactRole;
  /** How `value` differs from the literal characters of the quote, or null. */
  transformation: string | null;
}

export interface RichLeverSetting {
  factor_id: string;
  value: number | null;
  unit: string | null;
  epistemic_state: EpistemicState;
  source_fact_id: string | null;
}

export interface RichOption {
  id: string;
  label: string;
  provenance: ItemProvenance;
  source_fact_id: string | null;
  is_status_quo: boolean;
  lever_settings: RichLeverSetting[];
  rationale: string | null;
}

export interface RichFactor {
  id: string;
  label: string;
  control: ControlKind;
  measurability: Measurability;
  epistemic_state: EpistemicState;
  /** null unless a user fact or external evidence states it. NEVER invented. */
  current_value: number | null;
  unit: string | null;
  provenance: ItemProvenance;
  source_fact_id: string | null;
  dsk_refs: string[];
}

export interface RichOutcome {
  id: string;
  label: string;
  kind: OutcomeKind;
  better_direction: BetterDirection;
  measurability: Measurability;
  epistemic_state: EpistemicState;
  provenance: ItemProvenance;
  source_fact_id: string | null;
  dsk_refs: string[];
}

export interface RichConstraint {
  id: string;
  subject_id: string;
  /** EXACT operator. "under 4%" is "<", "at most 4%" is "<=". */
  operator: ConstraintOperator;
  value: number;
  unit: string | null;
  provenance: ItemProvenance;
  source_fact_id: string | null;
}

export interface RichMagnitude {
  kind: MagnitudeKind;
  value: number | null;
  note: string | null;
}

export interface RichTemporal {
  delay: string | null;
  duration: string | null;
  persistence: PersistenceKind;
  note: string | null;
}

export interface RichCausalLink {
  id: string;
  from_id: string;
  to_id: string;
  effect: EffectDirection;
  magnitude: RichMagnitude;
  mediator_id: string | null;
  temporal: RichTemporal;
  provenance: LinkProvenance;
  source_fact_id: string | null;
  rationale: string | null;
  dsk_refs: string[];
}

export interface RichUnknown {
  id: string;
  question: string;
  about_id: string | null;
  blocks_quantitative_analysis: boolean;
}

export interface RichNote {
  about_id: string | null;
  kind: NoteKind;
  text: string;
  dsk_refs: string[];
}

export interface RichDecisionModel {
  decision: RichDecision;
  user_facts: RichUserFact[];
  options: RichOption[];
  factors: RichFactor[];
  outcomes: RichOutcome[];
  constraints: RichConstraint[];
  causal_links: RichCausalLink[];
  unknowns: RichUnknown[];
  notes: RichNote[];
}

/** Top-level required list, mirroring the contract's `required` array in order. */
export const RICH_MODEL_TOP_LEVEL_KEYS: readonly (keyof RichDecisionModel)[] = [
  "decision",
  "user_facts",
  "options",
  "factors",
  "outcomes",
  "constraints",
  "causal_links",
  "unknowns",
  "notes",
];

// =============================================================================
// Validation result / projection report shapes (CONTRACT-v0/README.md)
// =============================================================================

export interface ValidationFailure {
  /** Gate id, e.g. "SB1_quote_not_in_brief". */
  gate: string;
  /** The rich-model id the failure attaches to (or "<model>" for whole-model failures). */
  item_id: string;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  failures: ValidationFailure[];
  /** Non-failing observations (e.g. which match level a quote needed). Never gates anything. */
  observations?: string[];
}

export type OmissionReason =
  | "qualitative"
  | "temporal"
  | "strict_operator"
  | "unknown_magnitude"
  | "no_value";

export interface ProjectionOmission {
  id: string;
  reason: OmissionReason;
  detail: string;
}

export interface ProjectionDisclosure {
  constraint_id: string;
  original_operator: ConstraintOperator;
  projected_operator: string;
  detail: string;
}

export interface ProjectionReport {
  included: string[];
  omitted: ProjectionOmission[];
  disclosures: ProjectionDisclosure[];
}

// =============================================================================
// Projected graph types
// =============================================================================

/**
 * ⚠ WHY THESE TYPES ARE DECLARED HERE AND NOT IN `src/types.ts`.
 *
 * `GraphNodeData.interventions` is declared `Record<string, number>` in
 * `src/types.ts`. The rich→GraphV3 projection must carry
 * `{ value, source }` per intervention (post-projection provenance trust gate,
 * PLAN-v2 amendment 2) — a shape that CANNOT be produced by extending that
 * interface, because the property types conflict. `src/types.ts` is owned by the
 * WP1 lane, so these are declared here as a structural superset instead.
 *
 * TODO(WP1): once `types.ts` carries `GraphNode.provenance`, the `{value,source}`
 * intervention and `GoalConstraint.strictness/relaxed_to`, collapse these onto
 * the shared types and delete this block. Do NOT "fix" it with a cast — a cast
 * would hide exactly the mismatch this comment records.
 */
export type InterventionSource = "brief_extraction" | "cee_hypothesis" | "user_specified";

export interface ProjectedIntervention {
  value: number | null;
  source: InterventionSource;
  unit?: string;
  source_fact_id?: string | null;
}

export interface ProjectedNodeData {
  value?: number;
  raw_value?: number;
  unit?: string;
  extractionType?: string;
  factor_type?: string;
  interventions?: Record<string, ProjectedIntervention>;
  [key: string]: unknown;
}

export interface ProjectedNode extends Omit<GraphNode, "data"> {
  data?: ProjectedNodeData;
  /** Post-projection provenance. NEVER defaulted — see rich-to-graph.ts. */
  provenance: "from_brief" | "ai_inferred";
  /** The rich-model id this node came from (ids are hashed for the graph). */
  rich_id: string;
}

export interface ProjectedEdge extends GraphEdge {
  /**
   * TRUE when `strength.mean` is a PLACEHOLDER because the rich model declared
   * the magnitude unknown. mean 0 here means "no measured magnitude", NOT "no
   * effect". THE SCORER MUST NOT REWARD A PLACEHOLDER EDGE.
   */
  magnitude_placeholder?: boolean;
  rich_id: string;
  provenance: "from_brief" | "ai_inferred";
}

export interface ProjectedGoalConstraint {
  constraint_id: string;
  node_id: string;
  operator: string;
  value: number;
  unit?: string;
  label?: string;
  provenance: "from_brief" | "ai_inferred";
  /** "strict" when the rich model said `<`/`>`; "as_stated" otherwise. */
  strictness: "strict" | "as_stated";
  /** Present only when the operator was relaxed to represent it in GraphV3. */
  relaxed_to?: string;
}

export type ProjectedGraph = Omit<ParsedGraph, "nodes" | "edges" | "goal_constraints"> & {
  nodes: ProjectedNode[];
  edges: ProjectedEdge[];
  goal_constraints: ProjectedGoalConstraint[];
};

// =============================================================================
// Schema loading
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));

/** Canonical on-disk location of the v0 contract, relative to this file. */
export const RICH_SCHEMA_PATH = join(HERE, "..", "contracts", "rich-decision-model.v0.json");

/**
 * Read the v0 JSON Schema and strip `$schema` / `$id`.
 *
 * Both providers compile the schema into a grammar and neither accepts those two
 * meta keys in the position we send them (proven in WP0: the request that
 * returned HTTP 200 carried the schema WITHOUT them —
 * `output/model-gen-20260921/wp0/builder-smoke-request.json`).
 *
 * Throws if the file is missing, is not an object, or if either key survives —
 * a silently-unstripped key is the failure mode this function exists to prevent.
 */
export function loadRichSchema(path: string = RICH_SCHEMA_PATH): Record<string, unknown> {
  const raw = readFileSync(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`[loadRichSchema] ${path} is not a JSON object`);
  }
  const schema = { ...(parsed as Record<string, unknown>) };
  delete schema["$schema"];
  delete schema["$id"];
  if ("$schema" in schema || "$id" in schema) {
    throw new Error("[loadRichSchema] $schema/$id survived stripping");
  }
  if (typeof schema["properties"] !== "object" || schema["properties"] === null) {
    throw new Error(`[loadRichSchema] ${path} has no properties object`);
  }
  return schema;
}

/**
 * Cheap drift check between the on-disk contract and this file's mirror.
 * Throws with the symmetric difference. Called by the unit tests, and by the
 * runner before it spends a model call on a schema our types do not match.
 */
export function assertSchemaMirrorsTypes(path: string = RICH_SCHEMA_PATH): void {
  const schema = loadRichSchema(path);
  const required = schema["required"];
  if (!Array.isArray(required)) {
    throw new Error("[assertSchemaMirrorsTypes] contract has no top-level required array");
  }
  const onDisk = required.map(String);
  const mirrored = RICH_MODEL_TOP_LEVEL_KEYS.map(String);
  const missing = mirrored.filter((k) => !onDisk.includes(k));
  const extra = onDisk.filter((k) => !mirrored.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[assertSchemaMirrorsTypes] contract/type drift — missing in contract: [${missing.join(
        ", ",
      )}]; missing in rich-model.ts: [${extra.join(", ")}]`,
    );
  }
}

// =============================================================================
// Parser — fails LOUD
// =============================================================================

const horizonSchema = z
  .object({
    value: z.number().nullable(),
    unit: z.enum(HORIZON_UNITS).nullable(),
    source_fact_id: z.string().nullable(),
  })
  .strict();

const userFactSchema = z
  .object({
    id: z.string(),
    kind: z.enum(USER_FACT_KINDS),
    source_quote: z.string(),
    value: z.number().nullable(),
    unit: z.string().nullable(),
    role: z.enum(USER_FACT_ROLES),
    transformation: z.string().nullable(),
  })
  .strict();

const leverSettingSchema = z
  .object({
    factor_id: z.string(),
    value: z.number().nullable(),
    unit: z.string().nullable(),
    epistemic_state: z.enum(EPISTEMIC_STATES),
    source_fact_id: z.string().nullable(),
  })
  .strict();

const optionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    provenance: z.enum(ITEM_PROVENANCES),
    source_fact_id: z.string().nullable(),
    is_status_quo: z.boolean(),
    lever_settings: z.array(leverSettingSchema),
    rationale: z.string().nullable(),
  })
  .strict();

const factorSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    control: z.enum(CONTROL_KINDS),
    measurability: z.enum(MEASURABILITIES),
    epistemic_state: z.enum(EPISTEMIC_STATES),
    current_value: z.number().nullable(),
    unit: z.string().nullable(),
    provenance: z.enum(ITEM_PROVENANCES),
    source_fact_id: z.string().nullable(),
    dsk_refs: z.array(z.string()),
  })
  .strict();

const outcomeSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(OUTCOME_KINDS),
    better_direction: z.enum(BETTER_DIRECTIONS),
    measurability: z.enum(MEASURABILITIES),
    epistemic_state: z.enum(EPISTEMIC_STATES),
    provenance: z.enum(ITEM_PROVENANCES),
    source_fact_id: z.string().nullable(),
    dsk_refs: z.array(z.string()),
  })
  .strict();

const constraintSchema = z
  .object({
    id: z.string(),
    subject_id: z.string(),
    operator: z.enum(CONSTRAINT_OPERATORS),
    value: z.number(),
    unit: z.string().nullable(),
    provenance: z.enum(ITEM_PROVENANCES),
    source_fact_id: z.string().nullable(),
  })
  .strict();

const causalLinkSchema = z
  .object({
    id: z.string(),
    from_id: z.string(),
    to_id: z.string(),
    effect: z.enum(EFFECT_DIRECTIONS),
    magnitude: z
      .object({
        kind: z.enum(MAGNITUDE_KINDS),
        value: z.number().nullable(),
        note: z.string().nullable(),
      })
      .strict(),
    mediator_id: z.string().nullable(),
    temporal: z
      .object({
        delay: z.string().nullable(),
        duration: z.string().nullable(),
        persistence: z.enum(PERSISTENCE_KINDS),
        note: z.string().nullable(),
      })
      .strict(),
    provenance: z.enum(LINK_PROVENANCES),
    source_fact_id: z.string().nullable(),
    rationale: z.string().nullable(),
    dsk_refs: z.array(z.string()),
  })
  .strict();

const unknownSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    about_id: z.string().nullable(),
    blocks_quantitative_analysis: z.boolean(),
  })
  .strict();

const noteSchema = z
  .object({
    about_id: z.string().nullable(),
    kind: z.enum(NOTE_KINDS),
    text: z.string(),
    dsk_refs: z.array(z.string()),
  })
  .strict();

export const richDecisionModelSchema = z
  .object({
    decision: z.object({ question: z.string(), horizon: horizonSchema }).strict(),
    user_facts: z.array(userFactSchema),
    options: z.array(optionSchema),
    factors: z.array(factorSchema),
    outcomes: z.array(outcomeSchema),
    constraints: z.array(constraintSchema),
    causal_links: z.array(causalLinkSchema),
    unknowns: z.array(unknownSchema),
    notes: z.array(noteSchema),
  })
  .strict();

/** Thrown by {@link parseRichModel}. Carries the zod issue list verbatim. */
export class RichModelParseError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "RichModelParseError";
    this.issues = issues;
  }
}

/**
 * Parse raw model output into a {@link RichDecisionModel}.
 *
 * FAILS LOUD by design: no coercion, no defaults, no partial model. A model that
 * did not produce the contract is a measurable outcome of the arm, and a
 * silently-repaired model would make every downstream fidelity number a lie.
 */
export function parseRichModel(text: string): RichDecisionModel {
  const extracted = extractJSONOrThrow(text);
  const result = richDecisionModelSchema.safeParse(extracted);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.length > 0 ? i.path.join(".") : "<root>"}: ${i.message}`,
    );
    throw new RichModelParseError(
      `Rich model failed schema validation (${issues.length} issue(s)): ${issues
        .slice(0, 8)
        .join(" | ")}${issues.length > 8 ? " | …" : ""}`,
      issues,
    );
  }
  return result.data as RichDecisionModel;
}

function extractJSONOrThrow(text: string): unknown {
  const extraction = extractJSON(text);
  if (extraction.parsed === null) {
    throw new RichModelParseError("Response contained no parseable JSON object", [
      `raw_text_length=${text.length}`,
    ]);
  }
  return extraction.parsed;
}
