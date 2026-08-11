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
}).passthrough();

const InferenceClaimWire = z.object({
  claim_kind: z.enum(DRAFT_RECORD_CLAIM_KINDS),
  label: z.string(),
  basis: z.array(z.number().int()).optional(),
  from_ref: z.string().optional(),
  to_ref: z.string().optional(),
  effect: z.enum(DRAFT_RECORD_EFFECTS).optional(),
  strength: z.number().optional(),
  category: z.enum(DRAFT_RECORD_CATEGORIES).optional(),
  value: z.number().optional(),
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
export function projectDraftRecords(rawJson: unknown): DraftRecordsSeamResult {
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
  const records = parsed.data as unknown as DraftRecordSet;
  return { ok: true, records, projection: projectRecordsToGraph(records) };
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
