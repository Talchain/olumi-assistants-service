/**
 * Evidence attestations — the watermark FAILS CLOSED BY CONSTRUCTION.
 *
 * Every report carries the watermark
 *     PIPELINE SMOKE TEST — NOT EVIDENCE
 * unless a POSITIVE attestation exists for ALL of:
 *   1. real non-placeholder prompts (attested AND machine-verified: the
 *      loader found zero PLACEHOLDER-headed prompt files);
 *   2. API/model pre-flight passed for every arm in the run;
 *   3. proposal-quality judge clearance exists (attested path present on
 *      disk) AND the verdict provider is the cleared judge, not the smoke
 *      stub;
 *   4. labels and required benchmark inputs are present (labels path on
 *      disk; warranted reference set R present for every brief — R is a HARD
 *      input, the third human-judgement input, not a nice-to-have).
 *
 * Absence of the attestations file, absence of any field, or any failed
 * machine cross-check produces a watermarked report. There are NO negative
 * flags anywhere — nothing can be "switched off" into an evidence report.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { PreflightResult, RunConfig } from "../types.ts";

export const WATERMARK = "PIPELINE SMOKE TEST — NOT EVIDENCE";
export const SMOKE_VERDICT_PROVIDER = "deterministic_smoke_stub";

export const AttestationsSchema = z.object({
  real_prompts: z.literal(true),
  judge_clearance_path: z.string().min(1),
  labels_path: z.string().min(1),
  attested_by: z.string().min(1),
  date: z.string().min(1),
});
export type AttestationsFile = z.infer<typeof AttestationsSchema>;

export interface EvidenceAssessment {
  watermark: boolean;
  reasons: string[];
}

export interface EvidenceInputs {
  attestationsPath: string | null;
  anyPlaceholderPrompts: boolean;
  preflight: PreflightResult | null;
  config: RunConfig;
  verdictProvider: string;
  /** True when any scored brief lacked a warranted reference set R. */
  anyRPending: boolean;
}

export function assessEvidence(inputs: EvidenceInputs): EvidenceAssessment {
  const reasons: string[] = [];

  if (inputs.config.mock) reasons.push("mock mode (deterministic fixture client)");
  if (inputs.anyPlaceholderPrompts) reasons.push("placeholder prompts in use (machine-verified)");
  if (inputs.verdictProvider === SMOKE_VERDICT_PROVIDER) {
    reasons.push("verdicts from the deterministic smoke stub, not a cleared judge");
  }
  if (inputs.anyRPending) {
    reasons.push("warranted reference set R missing for at least one brief (R is a hard benchmark input)");
  }

  if (!inputs.preflight) {
    reasons.push("no pre-flight record");
  } else {
    if (!inputs.preflight.key_present) reasons.push("pre-flight: no API key");
    for (const arm of inputs.config.arms) {
      if (!inputs.preflight.arm_gate[arm]?.allowed) {
        reasons.push(`pre-flight: arm ${arm} not cleared (${inputs.preflight.arm_gate[arm]?.reason ?? "unknown"})`);
      }
    }
  }

  if (!inputs.attestationsPath) {
    reasons.push("no attestations file supplied (--attestations)");
  } else if (!existsSync(inputs.attestationsPath)) {
    reasons.push(`attestations file not found: ${inputs.attestationsPath}`);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(inputs.attestationsPath, "utf-8"));
    } catch {
      reasons.push("attestations file is not valid JSON");
      parsed = null;
    }
    if (parsed !== null) {
      const attestations = AttestationsSchema.safeParse(parsed);
      if (!attestations.success) {
        reasons.push(
          `attestations file missing positive attestation(s): ${attestations.error.issues
            .map((i) => i.path.join("."))
            .join(", ")}`
        );
      } else {
        if (!existsSync(attestations.data.judge_clearance_path)) {
          reasons.push(`judge clearance not found on disk: ${attestations.data.judge_clearance_path}`);
        }
        if (!existsSync(attestations.data.labels_path)) {
          reasons.push(`labels not found on disk: ${attestations.data.labels_path}`);
        }
      }
    }
  }

  return { watermark: reasons.length > 0, reasons };
}
