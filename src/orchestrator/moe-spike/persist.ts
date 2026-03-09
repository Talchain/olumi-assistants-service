/**
 * MoE Spike — persistence (shadow mode, dev tool).
 *
 * Async, non-blocking, fire-and-forget. Never sits on the response critical path.
 * Strips rationale strings and signal quotes before writing — only categories,
 * counts, verdicts, and confidence values are persisted.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../../utils/telemetry.js";
import type { MoeSpikeComparison, MoeSpikeResult } from "./schemas.js";

const RESULTS_DIR = join(process.cwd(), 'tools', 'moe-spike', 'results');

/**
 * Redact a spike result for persistence.
 * Keeps: version, enums, bias_type + confidence. Strips: signal strings, claim_id.
 */
export function redactSpikeResult(result: MoeSpikeResult): Record<string, unknown> {
  return {
    version: result.version,
    framing_quality: result.framing_quality,
    diversity_assessment: result.diversity_assessment,
    stakeholder_completeness: result.stakeholder_completeness,
    bias_signals: result.bias_signals.map((s) => ({
      bias_type: s.bias_type,
      confidence: s.confidence,
    })),
    missing_elements: result.missing_elements,
  };
}

/**
 * Persist spike comparison + redacted result to disk.
 * Fire-and-forget — swallows all errors.
 */
export async function persistSpikeComparison(
  comparison: MoeSpikeComparison,
  spikeResult: MoeSpikeResult,
): Promise<void> {
  try {
    await mkdir(RESULTS_DIR, { recursive: true });

    const payload = {
      comparison,
      spike_redacted: redactSpikeResult(spikeResult),
      persisted_at: new Date().toISOString(),
    };

    // Same briefHash overwrites previous result by design. This captures latest-state, not history.
    // For aggregate analysis, copy results before re-running.
    const filePath = join(RESULTS_DIR, `${comparison.brief_hash}.json`);
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    log.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'moe-spike: persistence failed (non-fatal)',
    );
  }
}
