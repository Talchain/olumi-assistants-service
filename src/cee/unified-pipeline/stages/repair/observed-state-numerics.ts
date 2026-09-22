/**
 * Stage 4 Substep 9c: `observed_state` numeric normalisation (pre-parse).
 *
 * ── THE DEFECT THIS CLOSES, MEASURED ON THE DEPLOYED BUILD ─────────────────
 * On CEE staging `9c16e8c`, the FIRST brief of a session returned HTTP 500
 * `draft_graph_cee_graph_invalid` roughly half the time (6 of 12 turns driven
 * signed-in; independently, 4 of 16 `/orchestrate/v2/turn` responses in an
 * untouched 21:15–21:46Z window). Nothing was persisted and the user was told
 * `retryable: false`, yet the same brief drafted cleanly on a neighbouring run.
 *
 * The server-side cause is one line, identical across 9 captured failures:
 *
 *   {"event":"cee.structural_parse.failed","error_count":2,
 *    "first_issues":[{"path":"graph.nodes.1.observed_state",
 *                     "message":"Invalid input","code":"invalid_union"}, …]}
 *
 * Every failing node index resolved to `kind: "factor"`; no failing graph held
 * a constraint node. BOTH members of `NodeObservedState` (`graph.ts`) require
 * `value: z.number()`, so a factor `observed_state` whose `value` is absent,
 * null, NaN or non-numeric matches NEITHER branch → `invalid_union` →
 * `DraftGraphOutput.parse()` throws → `earlyReturn` 400 → wire 500.
 *
 * ── WHY NO EXISTING REPAIR COULD CATCH IT ──────────────────────────────────
 * 60ms before the Zod net rejects the graph, CEE's own authoritative validator
 * declares it VALID (`graph_validator.complete` `errorCount:0 valid:true`),
 * because `src/validators/graph-validator.ts` contains ZERO code references to
 * `observed_state` (its single hit is inside a comment; same-file controls:
 * `node.data` 5, `uncertainty_drivers` 10, `extractionType` 5, `factor_type` 7).
 * The deterministic sweep therefore reports `violations_out: 0` and the LLM
 * repair pass is skipped as `deterministic_sweep_sufficient`. The structural
 * parse is the first thing to see the field, and it has no repair branch —
 * only `earlyReturn`. The pipeline mandates a field that nothing it can repair
 * with is able to see.
 *
 * ── WHAT THIS DOES, AND THE LINE IT WILL NOT CROSS ─────────────────────────
 * It DROPS a factor `observed_state` that cannot satisfy either union branch,
 * recording the drop in the existing field-deletion audit. It NEVER invents or
 * repairs a number.
 *
 * ⚠ `isFiniteNumber` IS DELIBERATELY STRICTER THAN THE SCHEMA, AND THE EARLIER
 * WORDING HERE WAS WRONG. Measured on zod 3.25.76: `z.number()` rejects `NaN`
 * but ACCEPTS `±Infinity`, so `{ value: Infinity }` parses. This module drops
 * it anyway — an infinite magnitude is not a position on a 0–1 scale and
 * nothing downstream can use it — but it is dropped as UNUSABLE, not as
 * unparseable. Do not read the audit row as "this would have 400ed".
 *
 * ⛔ IT DOES NOT COERCE. A numeric STRING is not promoted, even though
 * `"0.6"` → `0.6` would be value-preserving, because `value` is the factor's
 * position on the model 0–1 scale and a string like `"30000"` would coerce
 * into that slot as an unscaled magnitude. That is the distortion the
 * projector's own header forbids — a £600,000 baseline landing at level 0.6
 * beside a £400,000 option at 0.8, "9 of 25 framings distorted, worst 100x".
 * A wrong number that parses is worse than an absent one that does not.
 *
 * ⛔ IT IS SCOPED TO `kind === "factor"`, which is what the evidence covers
 * (11 of 11 issue paths). A constraint `observed_state` carries the threshold
 * PLoT reads from `metadata.operator`; silently dropping one would delete a
 * user's threshold to buy a 200. Those must keep failing loudly. A
 * constraint-shaped object is identified exactly as `NodeObservedState` does
 * it — by the presence of a `metadata` key — and skipped untouched.
 *
 * ⚠ THE RECOVERY CLAIM IS REAL BUT DOES NOT COVER THE SHAPE THIS ACTUALLY
 * MEETS, and the earlier wording here over-read it. `schema-v3.ts:456` does
 * rebuild `observed_state` from `data.value` — read directly, and it never
 * reads the V1 `observed_state` at all (`rg -an 'node\.observed_state'` on that
 * file: zero code hits; contrast control `isFactorData`: 7). So where
 * `data.value` is sound, nothing is lost downstream.
 *
 * But for the target shape — `{declared_scale}` and nothing else —
 * `projector.ts:3379-3381` sets `data` to `{unit}` or leaves it absent
 * PRECISELY WHEN `claim.value` is not a number, so there is no `data.value` to
 * rebuild from. What is lost there is the `declared_scale` TWIN, not a
 * magnitude: the node-level `declared_scale` survives the drop, and there was
 * never a usable value to begin with. The audit records the twin explicitly.
 */

import type { StageContext } from "../../types.js";
import {
  fieldDeletion,
  recordFieldDeletions,
  type FieldDeletionEvent,
} from "../../utils/field-deletion-audit.js";
import { log } from "../../../../utils/telemetry.js";
import { LEVEL_BEARING_CLAIM_NODE_KINDS } from "../../../draft/records/projector.js";

/** Stage label for the field-deletion audit. */
const STAGE = "observed-state-numerics";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Capture what the node held BEFORE the drop, copied out of the payload being
 * mutated — never re-read from the brief (the audit module's own rule).
 */
function previousState(o: Record<string, unknown>): Record<string, unknown> {
  const prev: Record<string, unknown> = { previous_value: o.value };
  if (isFiniteNumber(o.raw_value)) prev.previous_raw_value = o.raw_value;
  if (typeof o.unit === "string") prev.previous_unit = o.unit;
  if (isFiniteNumber(o.cap)) prev.previous_cap = o.cap;
  // ⚠ THE TARGET SHAPE CARRIES NONE OF THE ABOVE. `projector.ts:3425` emits
  // `{declared_scale}` and nothing else, so an audit recording only
  // value/raw_value/unit/cap says a deletion happened without saying what was
  // deleted. `declared_scale` also has a node-level twin that SURVIVES this
  // drop, and `declared-scale-carriage.test.ts` pins the two carriers as
  // agreeing — so the loss must at minimum be visible here.
  if (o.declared_scale !== undefined) prev.previous_declared_scale = o.declared_scale;
  return prev;
}

export function runObservedStateNumerics(ctx: StageContext): void {
  const nodes = (ctx.graph as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return;

  const events: FieldDeletionEvent[] = [];

  for (const raw of nodes as Array<Record<string, unknown>>) {
    if (raw === null || typeof raw !== "object") continue;
    // ⭐ SCOPE IS BOUND TO THE PRODUCER'S OWN SET, NOT A SECOND COPY OF IT.
    // `projector.ts:3425` writes `observed_state = {...prev, declared_scale}`
    // OUTSIDE its `typeof claim.value === "number"` guard, for every kind in
    // `LEVEL_BEARING_CLAIM_NODE_KINDS` — factor, risk AND outcome. Scoping this
    // to `factor` alone rescued one of the three: risk and outcome still 400ed
    // on the identical shape. The 11-of-11 factor sample was the shape the
    // capture happened to contain, never proof the other two cannot fire.
    // Importing the set means the two cannot drift (trap 21).
    if (typeof raw.kind !== "string") continue;
    if (!LEVEL_BEARING_CLAIM_NODE_KINDS.has(raw.kind as never)) continue;
    if (!("observed_state" in raw)) continue;

    const observed = raw.observed_state;
    const nodeId = typeof raw.id === "string" ? raw.id : "__unknown__";

    // A non-object observed_state (null, array, scalar) satisfies neither
    // branch and carries nothing to preserve.
    if (observed === null || typeof observed !== "object" || Array.isArray(observed)) {
      if (observed === undefined) continue;
      delete raw.observed_state;
      events.push(
        fieldDeletion(STAGE, nodeId, "observed_state", "OBSERVED_STATE_NOT_NUMERIC", {
          previous_value: observed,
        }),
      );
      continue;
    }

    const o = observed as Record<string, unknown>;

    // Constraint-shaped — identified exactly as NodeObservedState identifies
    // it. Out of scope by design; a malformed one must keep 400ing.
    if ("metadata" in o) continue;

    if (!isFiniteNumber(o.value)) {
      const prev = previousState(o);
      delete raw.observed_state;
      events.push(
        fieldDeletion(STAGE, nodeId, "observed_state", "OBSERVED_STATE_NOT_NUMERIC", prev),
      );
      continue;
    }

    // `value` is sound; a non-numeric `raw_value` alone still fails
    // `z.number().optional()` on both branches. Drop only that key.
    // `"raw_value" in o` is the WRONG test: `z.number().optional()` accepts
    // `undefined`, so a present-but-undefined key parses. Deleting it recorded
    // a false row in an audit whose own header demands it support honest
    // statements.
    if (o.raw_value !== undefined && !isFiniteNumber(o.raw_value)) {
      const previous = o.raw_value;
      delete o.raw_value;
      events.push(
        fieldDeletion(STAGE, nodeId, "observed_state.raw_value", "OBSERVED_STATE_NOT_NUMERIC", {
          previous_value: previous,
        }),
      );
    }
  }

  if (events.length === 0) return;

  recordFieldDeletions(ctx, STAGE, events);
  log.warn(
    {
      event: "cee.observed_state.normalised",
      dropped_count: events.length,
      node_ids: events.map((e) => e.node_id).slice(0, 10),
      request_id: ctx.requestId,
    },
    "Dropped unparseable factor observed_state before structural parse",
  );
}
