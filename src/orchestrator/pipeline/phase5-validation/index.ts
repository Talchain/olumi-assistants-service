/**
 * Phase 5: Validation + Envelope Assembly
 *
 * Calls all sub-modules and assembles the final OrchestratorResponseEnvelopeV2.
 *
 * Sub-modules:
 * - Progress classifier (maps tool side_effects → ProgressKind)
 * - Stage transition evaluator
 * - Science validator (stub)
 * - Claims ledger (stub)
 * - Observation writer (stub)
 * - Envelope assembler
 */

import type {
  EnrichedContext,
  SpecialistResult,
  LLMResult,
  ToolResult,
  OrchestratorResponseEnvelopeV2,
} from "../types.js";
import { classifyProgress } from "./progress-classifier.js";
import { evaluateStageTransition } from "./stage-transition.js";
import { validateScience } from "./science-validator.js";
import { extractClaims } from "./claims-ledger.js";
import { writeObservation } from "./observation-writer.js";
import { assembleV2Envelope } from "./envelope-assembler.js";
import { validateV2EnvelopeContract } from "../../validation/response-contract.js";

/**
 * Phase 5 entry point: validate and assemble the response envelope.
 */
export function phase5Validate(
  llmResult: LLMResult,
  toolResult: ToolResult,
  enrichedContext: EnrichedContext,
  specialistResult: SpecialistResult,
): OrchestratorResponseEnvelopeV2 {
  // 1. Classify this turn's progress
  const progressKind = classifyProgress(toolResult);

  // 2. Evaluate stage transition
  const stageTransition = evaluateStageTransition(
    enrichedContext.stage_indicator,
    toolResult,
  );

  // 3. Science validation (stub)
  const scienceLedger = validateScience();

  // 3b. Claims ledger (stub — A.12)
  void extractClaims();

  // 4. Observation write (stub — logs only)
  writeObservation(enrichedContext.turn_id, enrichedContext.scenario_id);

  // 5. Assemble envelope
  const envelope = assembleV2Envelope({
    enrichedContext,
    specialistResult,
    llmResult,
    toolResult,
    progressKind,
    stageTransition,
    scienceLedger,
  });

  // 6. Response contract validation — drop malformed chips/blocks, inject fallback if needed
  validateV2EnvelopeContract(envelope, enrichedContext.stage_indicator.stage);

  return envelope;
}
