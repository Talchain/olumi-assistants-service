/**
 * DSK Bias Alert Formatter
 *
 * Converts BIL dsk_cues[] into structured BiasAlert[] with reflective questions.
 * Deterministic — no LLM calls.
 */

import { createHash } from "node:crypto";
import type { BriefIntelligence } from "../../schemas/brief-intelligence.js";
import type { BiasAlert } from "../../schemas/dsk-coaching.js";
import { getClaimById, getAllByType } from "../dsk-loader.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Reflective question templates — British English, always end with "?"
// ============================================================================

const QUESTION_MAP: Record<string, string> = {
  sunk_cost: "Could past investment or time already spent be influencing this decision?",
  anchoring: "Is the first number mentioned anchoring your expectations?",
  availability: "Are recent or vivid events weighing more heavily than broader evidence?",
  planning_fallacy: "Could timelines or estimates be more optimistic than evidence supports?",
  affect_heuristic: "Are emotional reactions shaping the analysis more than the data?",
  narrow_framing: "Have all meaningfully different approaches been considered?",
  status_quo: "Is maintaining the current approach getting more weight than it deserves?",
  confirmation: "Is the framing seeking evidence for a preferred outcome?",
};

const REFLECTION_MAP: Record<string, string> = {
  sunk_cost: "Try evaluating each option as if starting fresh today, ignoring what has already been invested.",
  anchoring: "Consider generating your own estimate before reviewing any reference numbers provided.",
  availability: "Look for base rate data or historical trends rather than relying on memorable examples.",
  planning_fallacy: "Compare this timeline with similar past projects to calibrate expectations.",
  affect_heuristic: "Separate your feelings about the options from the evidence for and against each.",
  narrow_framing: "List at least one alternative approach that has not yet been considered.",
  status_quo: "Imagine you were choosing between all options for the first time, with no existing commitment.",
  confirmation: "Actively seek out evidence that contradicts the leading hypothesis.",
};

const GENERIC_QUESTION = "Could there be a cognitive pattern influencing how this decision is being framed?";
const GENERIC_REFLECTION = "Step back and consider whether any assumptions are going unexamined.";

const MAX_ALERTS = 3;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

// ============================================================================
// ID generation
// ============================================================================

function computeBiasAlertId(biasType: string, signal: string): string {
  const input = `bias:${biasType.toLowerCase().trim()}:${signal.toLowerCase().trim()}`;
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 12);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Format BIL dsk_cues into structured bias alerts.
 *
 * @param dskCues - From BriefIntelligence.dsk_cues
 * @param options.confidenceThreshold - Minimum confidence to include (default 0.7)
 * @returns BiasAlert[] — max 3, deduped by bias_type, sorted by confidence desc
 */
export function formatBiasAlerts(
  dskCues: BriefIntelligence['dsk_cues'],
  options?: { confidenceThreshold?: number },
): BiasAlert[] {
  const threshold = options?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  // Filter by confidence threshold
  const qualifying = dskCues.filter((cue) => cue.confidence >= threshold);

  // Dedup by bias_type (case-insensitive), keep highest confidence
  const byType = new Map<string, typeof qualifying[number]>();
  for (const cue of qualifying) {
    const key = cue.bias_type.toLowerCase().trim();
    const existing = byType.get(key);
    if (!existing || cue.confidence > existing.confidence) {
      byType.set(key, cue);
    }
  }

  // Sort by confidence descending, then alphabetically for stability
  const sorted = Array.from(byType.values()).sort((a, b) => {
    const diff = b.confidence - a.confidence;
    if (diff !== 0) return diff;
    return a.bias_type.localeCompare(b.bias_type);
  });

  // Cap at MAX_ALERTS
  const capped = sorted.slice(0, MAX_ALERTS);

  return capped.map((cue): BiasAlert => {
    const typeKey = cue.bias_type.toLowerCase().trim();
    const question = QUESTION_MAP[typeKey] ?? GENERIC_QUESTION;
    const reflection = REFLECTION_MAP[typeKey] ?? GENERIC_REFLECTION;

    // DSK bundle validation — look up evidence_strength from bundle
    // Only emit drift warnings when a bundle is actually loaded
    let evidenceStrength: "strong" | "medium" | null = null;
    if (cue.claim_id) {
      const claim = getClaimById(cue.claim_id);
      if (claim) {
        const es = claim.evidence_strength;
        if (es === "strong" || es === "medium") {
          evidenceStrength = es;
        }
      } else if (getAllByType('claim').length > 0) {
        log.warn(
          { claim_id: cue.claim_id, bias_type: cue.bias_type },
          "DSK coaching: bias alert claim_id not found in loaded bundle (drift detection)",
        );
      }
    }

    return {
      id: computeBiasAlertId(cue.bias_type, cue.signal),
      bias_type: cue.bias_type,
      human_description: question,
      suggested_reflection: reflection,
      claim_id: cue.claim_id,
      evidence_strength: evidenceStrength,
      confidence: cue.confidence,
      surface_targets: ['guidance_panel'],
    };
  });
}
