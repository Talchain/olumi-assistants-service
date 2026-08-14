/**
 * THE POST-LLM SEAM — where a record set becomes the graph the pipeline expects.
 *
 * ── HONEST FAILURE, NEVER A PHANTOM GRAPH ──────────────────────────────────
 * The anti-goal is a measured product defect, not a hypothetical: a streamed
 * `GRAPH_READY` frame the user watched arrive, followed by a 504 with empty text
 * and nothing committed. The user saw a graph that never existed. That is the
 * worst class available and this seam must never reproduce it.
 *
 * So the rule here is: if the model's output is not a record set, this module
 * says so and REFUSES, and the caller raises the SAME typed failure a
 * malformed graph raises today. It never guesses, never part-projects, and never
 * substitutes an empty graph for a failed parse — an empty graph is a lie that
 * validates.
 *
 * The complementary half is already in place downstream and is deliberately left
 * there rather than duplicated: the projected graph is validated by
 * `AnthropicDraftResponse.safeParse` exactly as a model-drafted graph was, and a
 * rejection raises `anthropic_response_invalid_schema` → the existing typed,
 * user-visible refusal. One validator, one failure surface, one place to change.
 *
 * ── ⚠ THE PROMPT-ONLY DEGRADATION PATH IS RECORDS-SHAPED TOO ───────────────
 * When structured outputs are rejected by the provider (400), the adapter
 * rebuilds the request WITHOUT the grammar. The instruction block survives that
 * rebuild, so the model is still asked for records — and `isGraphShapedResponse`
 * below exists so that a model which ignores the instruction and returns a GRAPH
 * is treated as a PARSE FAILURE feeding the existing retry, never silently
 * accepted. Accepting it would re-admit the old draft path as an undeclared
 * fallback: the product would sometimes draft by records and sometimes not, with
 * nothing recording which, and every provenance claim this mechanism makes would
 * be true only on the paths nobody checked.
 */
import { z } from "zod";
import {
  buildDraftRecordsSchema,
  DRAFT_RECORD_CATEGORIES,
  DRAFT_RECORD_CLAIM_KINDS,
  DRAFT_RECORD_DIRECTIONS,
  DRAFT_RECORD_EFFECTS,
  DRAFT_RECORD_ROLES,
  DRAFT_RECORD_STATED_KINDS,
  type DraftRecordSet,
} from "./grammar.js";
import { projectRecordsToGraph, type RecordProjection } from "./projector.js";

/**
 * The CEE-INTERNAL validator for what came back off the wire.
 *
 * Deliberately NOT `.strict()` on the items: the grammar already carries
 * `additionalProperties: false`, and on the prompt-only degradation path there is
 * no grammar at all — a model that adds a stray key there should still have its
 * RECORDS honoured rather than the whole draft thrown away over a field nobody
 * reads. What IS enforced is everything the projector's switch depends on:
 * the two arrays, the discriminators, and the enums.
 */
const StatedItemWire = z.object({
  kind: z.enum(DRAFT_RECORD_STATED_KINDS),
  source_quote: z.string(),
  value: z.number().optional(),
  unit: z.string().optional(),
  role: z.enum(DRAFT_RECORD_ROLES).optional(),
  direction: z.enum(DRAFT_RECORD_DIRECTIONS).optional(),
  // `option` only — grammar design note 5.
  is_baseline: z.boolean().optional(),
}).passthrough();

const InferenceClaimWire = z.object({
  claim_kind: z.enum(DRAFT_RECORD_CLAIM_KINDS),
  label: z.string(),
  basis: z.array(z.number().int()).optional(),
  // Typed by namespace — grammar design note 1b.
  from_stated: z.number().int().optional(),
  from_claim: z.number().int().optional(),
  to_stated: z.number().int().optional(),
  to_claim: z.number().int().optional(),
  effect: z.enum(DRAFT_RECORD_EFFECTS).optional(),
  strength: z.number().optional(),
  category: z.enum(DRAFT_RECORD_CATEGORIES).optional(),
  value: z.number().optional(),
  // ⚠ ADDED IN v4 AFTER A MEASURED LIVE DEFECT. `sets_to` shipped in the
  // grammar, the instruction and the projector — and was absent from BOTH this
  // schema and the rebuild below, so every live draft parsed the model's
  // intervention magnitude and discarded it one line before projection.
  // `OptionData.interventions` was therefore never populated on any real run and
  // the analysis could only compare bare labels. Every interventions test calls
  // `projectRecordsToGraph` DIRECTLY and so could not see it (trap 3b/19: the
  // guard was bound to the projector, the live path runs through the seam).
  // `assertSeamCarriesEveryGrammarField` below now makes the next such omission
  // a red rather than a dark capability.
  sets_to: z.number().optional(),
  // `option_refinement` only — grammar design note 5.
  is_baseline: z.boolean().optional(),
}).passthrough();

export const DraftRecordSetWire = z.object({
  // `min(1)` mirrors the grammar's `minItems: 1`. A brief always states
  // something; a record set claiming otherwise did not read the brief.
  stated_items: z.array(StatedItemWire).min(1),
  // NO minimum — see grammar.ts design note 2. Zero claims is a legitimate,
  // expected and honest answer, and requiring one would manufacture invention.
  claims: z.array(InferenceClaimWire),
}).passthrough();

/**
 * Is this parsed JSON a GRAPH rather than a record set?
 *
 * Bound to the graph's own discriminators (`nodes`/`edges` arrays), not to the
 * ABSENCE of record keys — absence is also what a truncated or empty response
 * looks like, and the two must be told apart so the caller can report the right
 * reason. A response that is both is still a graph-shaped violation: the
 * instruction says "Do not emit a graph".
 */
export function isGraphShapedResponse(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return Array.isArray(rec.nodes) || Array.isArray(rec.edges);
}

export type DraftRecordsSeamFailure =
  /** The response is a graph — the old draft shape, on a path that must not accept it. */
  | { ok: false; reason: "graph_shaped_response"; detail: string }
  /** The response is neither a graph nor a conformant record set. */
  | { ok: false; reason: "not_a_record_set"; detail: string };

export type DraftRecordsSeamResult =
  | { ok: true; records: DraftRecordSet; projection: RecordProjection }
  | DraftRecordsSeamFailure;

/**
 * Validate the model's output as a record set and project it to GraphV3.
 *
 * Returns a RESULT rather than throwing, so the caller owns the failure surface
 * and every refusal goes through the ONE typed path the pipeline already
 * understands. A function here that threw its own error type would create a
 * second failure vocabulary for the same user-visible event.
 */
export function projectDraftRecords(
  rawJson: unknown,
  /**
   * ⭐ THE BRIEF, AS READ-ONLY EVIDENCE for the provenance claim — never a source
   * of values. Threaded to `projectRecordsToGraph`, which binds each stated item
   * against it. OPTIONAL and FAIL-CLOSED: a caller that omits it gets nodes that
   * decline the `from_brief` badge rather than nodes that assume it.
   */
  brief?: string,
): DraftRecordsSeamResult {
  // ⚠ GRAPH-SHAPED IS CHECKED FIRST, AND UNCONDITIONALLY.
  //
  // The obvious ordering — validate, and only ask "was it a graph?" when
  // validation fails — has a hole a test found: `DraftRecordSetWire` is
  // `.passthrough()`, so a response carrying BOTH a record set and a graph
  // VALIDATES, and the graph rides straight through as though nothing happened.
  // A hedged response is not a partial success; it is precisely the shape a
  // reader could take either way, and taking it as records would let the retired
  // draft path re-enter as an undeclared fallback with nothing recording it.
  // Refuse it, and say which reason it was.
  if (isGraphShapedResponse(rawJson)) {
    const rec = rawJson as Record<string, unknown>;
    return {
      ok: false,
      reason: "graph_shaped_response",
      detail:
        `model returned a graph (nodes=${Array.isArray(rec.nodes) ? rec.nodes.length : "absent"}, ` +
        `edges=${Array.isArray(rec.edges) ? rec.edges.length : "absent"}) instead of a record set`,
    };
  }
  const parsed = DraftRecordSetWire.safeParse(rawJson);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const fieldIssues = Object.entries(flat.fieldErrors || {})
      .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
      .join("; ");
    const formIssues = (flat.formErrors || []).join("; ");
    return {
      ok: false,
      reason: "not_a_record_set",
      detail: [fieldIssues, formIssues].filter(Boolean).join(" | ") || "unknown record-set validation error",
    };
  }
  // Rebuilt field-by-field rather than double-cast. The wire schema is
  // `.passthrough()`, so its inferred type carries an index signature the
  // declared interface does not; converting explicitly keeps the boundary a
  // CONVERSION rather than an assertion, and a field the projector reads but the
  // wire schema stopped validating would fail to compile here instead of
  // arriving as `undefined` at runtime.
  const records: DraftRecordSet = {
    stated_items: parsed.data.stated_items.map((item) => ({
      kind: item.kind,
      source_quote: item.source_quote,
      ...(item.value !== undefined ? { value: item.value } : {}),
      ...(item.unit !== undefined ? { unit: item.unit } : {}),
      ...(item.role !== undefined ? { role: item.role } : {}),
      ...(item.direction !== undefined ? { direction: item.direction } : {}),
      ...(item.is_baseline !== undefined ? { is_baseline: item.is_baseline } : {}),
    })),
    claims: parsed.data.claims.map((claim) => ({
      claim_kind: claim.claim_kind,
      label: claim.label,
      ...(claim.basis !== undefined ? { basis: claim.basis } : {}),
      ...(claim.from_stated !== undefined ? { from_stated: claim.from_stated } : {}),
      ...(claim.from_claim !== undefined ? { from_claim: claim.from_claim } : {}),
      ...(claim.to_stated !== undefined ? { to_stated: claim.to_stated } : {}),
      ...(claim.to_claim !== undefined ? { to_claim: claim.to_claim } : {}),
      ...(claim.effect !== undefined ? { effect: claim.effect } : {}),
      ...(claim.strength !== undefined ? { strength: claim.strength } : {}),
      ...(claim.category !== undefined ? { category: claim.category } : {}),
      ...(claim.value !== undefined ? { value: claim.value } : {}),
      ...(claim.sets_to !== undefined ? { sets_to: claim.sets_to } : {}),
      ...(claim.is_baseline !== undefined ? { is_baseline: claim.is_baseline } : {}),
    })),
  };
  return { ok: true, records, projection: projectRecordsToGraph(records, brief) };
}

/**
 * ⭐ THE DERIVED COMPLETENESS GUARD — the mirror-killer for the rebuild above.
 *
 * The rebuild is a HAND-WRITTEN LIST of the fields that survive the seam, and a
 * hand-written list that must be kept in step with the grammar is precisely the
 * defect class this estate pays for most often (trap 12). It had already
 * happened: `sets_to` was on the wire, in the instruction and in the projector,
 * and absent here — so the capability was dark on every live draft while 28,165
 * tests stayed green.
 *
 * The seam's own stated defence — "a field the projector reads but the wire
 * schema stopped validating would fail to compile here" — CANNOT do that job,
 * because the wire schemas are `.passthrough()` and therefore carry an index
 * signature: a missing key reads as `unknown`, never as a compile error.
 *
 * So this returns the DIFFERENCE between what the grammar declares and what the
 * seam carries, computed from `buildDraftRecordsSchema()` at call time. A test
 * asserts it is empty. It is a completeness check on the LIST, which derivation
 * alone can never provide (trap 12d): deriving the rebuild from the schema would
 * prove the copies agree, and this proves the list is not SHORT.
 *
 * ⚠ It is exported and called by a test rather than run in the request path: a
 * throw here would turn a future grammar addition into a live outage, and the
 * honest failure mode for "we forgot to carry a field" is a red build.
 *
 * ⭐⭐ IT IS BEHAVIOURAL, NOT DECLARATIVE, AND THAT IS THE WHOLE POINT. An
 * earlier draft of this function compared the grammar's keys against a
 * HAND-WRITTEN set of "the keys the seam carries" — which is a third copy of the
 * same list, and a guard that agrees with itself (trap 13b): add a field to the
 * grammar and to that set but not to the rebuild, and it passes while the field
 * is dropped. So instead it BUILDS a probe record set carrying every
 * grammar-declared key, RUNS `projectDraftRecords`, and reports which keys did
 * not survive. It measures the real code path and cannot be satisfied by a list.
 */
function exampleValueForSchema(spec: unknown): unknown {
  if (spec === null || typeof spec !== "object") return "x";
  const s = spec as Record<string, unknown>;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  switch (s.type) {
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return true;
    case "array":
      return [exampleValueForSchema(s.items)];
    case "object":
      return {};
    default:
      return "x";
  }
}

function propertiesOf(schema: unknown, path: readonly string[]): Record<string, unknown> {
  let cursor: unknown = schema;
  for (const step of path) cursor = (cursor as Record<string, unknown>)?.[step];
  return (cursor ?? {}) as Record<string, unknown>;
}

export function findGrammarFieldsDroppedBySeam(): { claims: string[]; statedItems: string[] } {
  const schema = buildDraftRecordsSchema();
  const statedProps = propertiesOf(schema, ["properties", "stated_items", "items", "properties"]);
  const claimProps = propertiesOf(schema, ["properties", "claims", "items", "properties"]);

  // A probe record set in which EVERY declared property is present with a
  // type-valid value, so anything missing downstream was dropped by the seam.
  const statedProbe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(statedProps)) statedProbe[k] = exampleValueForSchema(v);
  const claimProbe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(claimProps)) claimProbe[k] = exampleValueForSchema(v);

  const result = projectDraftRecords({ stated_items: [statedProbe], claims: [claimProbe] });
  if (!result.ok) {
    // The probe itself failed to validate — report every key as unverifiable
    // rather than returning a clean result the caller would read as a pass. An
    // absence probe that cannot run is not evidence of absence (trap 13).
    return { claims: Object.keys(claimProps), statedItems: Object.keys(statedProps) };
  }
  const carriedStated = new Set(Object.keys(result.records.stated_items[0] ?? {}));
  const carriedClaim = new Set(Object.keys(result.records.claims[0] ?? {}));
  return {
    claims: Object.keys(claimProps).filter((k) => !carriedClaim.has(k)).sort(),
    statedItems: Object.keys(statedProps).filter((k) => !carriedStated.has(k)).sort(),
  };
}

/**
 * Does a truncated-then-salvaged JSON object look like a usable record set
 * PREFIX?
 *
 * The salvage path exists because a generation cut at the token budget often has
 * a complete, usable prefix. Its predicate used to be `Array.isArray(json.nodes)`
 * — the graph's discriminator. On this path that predicate is now permanently
 * false, so salvage would silently never fire and every truncated draft would
 * become a hard failure. This is the records-shaped twin of that check.
 *
 * It is deliberately WEAKER than `DraftRecordSetWire`: salvage only decides
 * whether to hand the object on. The real gate is the projection above, and then
 * `AnthropicDraftResponse.safeParse` on the projected graph — so salvage can only
 * ever offer a candidate, never admit an invalid one.
 */
export function isSalvageableRecordSet(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return Array.isArray(rec.stated_items) && rec.stated_items.length > 0;
}
