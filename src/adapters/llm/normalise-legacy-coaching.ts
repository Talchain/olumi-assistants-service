/**
 * Legacy coaching normaliser (v0.11.0 schema amendment).
 *
 * Sits at the post-structured-output Zod parse seam in
 * `src/adapters/llm/anthropic.ts`, before any downstream Zod parse. Maps
 * v192b/v193 LLM output shapes to the canonical v0.11.0 contract:
 *
 *  - `coaching.strengthen_items[*].bias_category`: legacy enum values
 *      `framing | blindspots | confidence` → canonical `BiasType`
 *      (`narrow_framing | narrow_framing | overconfidence`).
 *  - `coaching.bias_signals[*].type`: same mapping as above.
 *  - `coaching.widening_log`: legacy array of `{ node_id, label, reason }`
 *      entries → canonical object
 *      `{ elements_added, elements_considered_but_excluded, brief_completeness }`.
 *      Per-entry `node_id` is collected into `elements_added`; `reason` is
 *      collected into `elements_considered_but_excluded` (the canonical
 *      "reason descriptions" surface). `brief_completeness` defaults to
 *      "thin" (cannot infer from legacy shape).
 *  - `coaching.strengthen_items[*].action_type`: legacy default value
 *      `"improve"` → canonical `"add_constraint"` (the closest semantic
 *      member of `StrengthenItemActionType`).
 *
 * Telemetry: emits one `cee.draft_graph.legacy_coaching_value_normalised`
 * event per substitution with `{ field, original_value, normalised_value,
 * request_id }`.
 *
 * **Removable** once the v194 prompt is deployed AND the telemetry event
 * shows zero occurrences for 7 consecutive days. See
 * `Docs/schema-amendment-task0-discovery-2026-05-01.md`.
 */

import { emit, TelemetryEvents } from "../../utils/telemetry.js";

const LEGACY_BIAS_MAP: Record<string, string> = {
  framing: "narrow_framing",
  blindspots: "narrow_framing",
  confidence: "overconfidence",
};

const LEGACY_ACTION_TYPE_MAP: Record<string, string> = {
  // Pre-v0.11.0 default applied at unified-pipeline Stage 5 to LLM
  // strengthen_items missing an action_type. Not in canonical enum.
  improve: "add_constraint",
};

/**
 * Mutates `parsed.coaching` in place. Safe to call when coaching is
 * absent or shape-invalid (no-op).
 */
export function normaliseLegacyCoachingValues(
  parsed: { coaching?: unknown },
  requestId: string | undefined,
): void {
  const coaching = parsed.coaching;
  if (!coaching || typeof coaching !== "object") return;
  const c = coaching as Record<string, unknown>;

  // strengthen_items[*].bias_category + .action_type
  const items = c.strengthen_items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;

      const bias = obj.bias_category;
      if (typeof bias === "string" && bias in LEGACY_BIAS_MAP) {
        const normalised = LEGACY_BIAS_MAP[bias]!;
        emit(TelemetryEvents.DraftGraphLegacyCoachingValueNormalised, {
          field: "coaching.strengthen_items[*].bias_category",
          original_value: bias,
          normalised_value: normalised,
          request_id: requestId,
        });
        obj.bias_category = normalised;
      }

      const action = obj.action_type;
      if (typeof action === "string" && action in LEGACY_ACTION_TYPE_MAP) {
        const normalised = LEGACY_ACTION_TYPE_MAP[action]!;
        emit(TelemetryEvents.DraftGraphLegacyCoachingValueNormalised, {
          field: "coaching.strengthen_items[*].action_type",
          original_value: action,
          normalised_value: normalised,
          request_id: requestId,
        });
        obj.action_type = normalised;
      }
    }
  }

  // bias_signals[*].type
  const signals = c.bias_signals;
  if (Array.isArray(signals)) {
    for (const sig of signals) {
      if (!sig || typeof sig !== "object") continue;
      const obj = sig as Record<string, unknown>;
      const v = obj.type;
      if (typeof v === "string" && v in LEGACY_BIAS_MAP) {
        const normalised = LEGACY_BIAS_MAP[v]!;
        emit(TelemetryEvents.DraftGraphLegacyCoachingValueNormalised, {
          field: "coaching.bias_signals[*].type",
          original_value: v,
          normalised_value: normalised,
          request_id: requestId,
        });
        obj.type = normalised;
      }
    }
  }

  // widening_log: legacy array → canonical object.
  // Production fixtures (e.g. tests/fixtures/cross-service/
  // draft-graph.success.with-coaching-and-provenance.json) carry the
  // legacy shape. Without conversion the canonical V1 Zod parse rejects
  // the response.
  const wl = c.widening_log;
  if (Array.isArray(wl)) {
    const elementsAdded: string[] = [];
    const reasons: string[] = [];
    for (const entry of wl) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      if (typeof obj.node_id === "string" && obj.node_id.length > 0) {
        elementsAdded.push(obj.node_id);
      }
      if (typeof obj.reason === "string" && obj.reason.length > 0) {
        reasons.push(obj.reason);
      }
    }
    emit(TelemetryEvents.DraftGraphLegacyCoachingValueNormalised, {
      field: "coaching.widening_log",
      original_value: "legacy_array",
      normalised_value: "canonical_object",
      request_id: requestId,
      legacy_entry_count: wl.length,
    });
    c.widening_log = {
      elements_added: elementsAdded,
      elements_considered_but_excluded: reasons,
      brief_completeness: "thin",
    };
  }
}
