/**
 * Golden-Journey Harness — replay-fixture shape + live-run capture.
 *
 * This module owns the ONE type both sides of the fixture seam share
 * (review fix: the writer and the `--replay` reader previously declared the
 * shape independently, coupled only by a comment — silent drift risk).
 * `index.ts --replay` imports {@link ReplayFixture}; `--capture` emits it.
 *
 * Capture flow: a staging behaviour snapshot is reviewed, redaction-checked,
 * and committed as a deterministic regression fixture — a HUMAN step,
 * deliberately: authorised live run → `--capture` → redaction check → human
 * review of the transcript → commit as
 * `fixtures/golden-journey-v1-staging-<date>.json` → add to the CI gate
 * manifest with its verified exit code. The builder is pure (unit-testable on
 * recorded observations, no network); the writer creates the target directory
 * and passes the serialised fixture through the shared redactor so the API
 * key can never reach the file.
 *
 * Round-trip fidelity (review fixes): captures carry each turn's `role` (so
 * replay never has to guess from the step name) and `elapsed_ms` (so A10
 * latency evidence survives replay even when the service ran without timing
 * debug); `timing_debug_enabled` is derived from the observations rather than
 * trusted from a caller.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { hasTimings, type TurnObservation, type TurnRole, type WireBody } from './observation.js';

/** One recorded turn in a fixture. `role`/`elapsed_ms` are optional so
 * hand-authored and pre-existing fixtures stay valid. */
export interface ReplayObservation {
  readonly step: string;
  readonly role?: TurnRole;
  readonly http_status: number;
  readonly elapsed_ms?: number;
  readonly body: WireBody | Record<string, never>;
}

/** The fixture shape `--replay` reads and `--capture` writes. */
export interface ReplayFixture {
  readonly name?: string;
  readonly description?: string;
  readonly brief?: string;
  readonly transcript?: {
    readonly note?: string;
    readonly diagnostic_trace_enabled?: boolean;
    readonly timing_debug_enabled?: boolean;
    readonly observations?: readonly ReplayObservation[];
  };
}

export interface BuildCaptureFixtureInput {
  readonly name: string;
  readonly brief: string;
  readonly baseUrl: string;
  readonly capturedAt: string;
  readonly diagnosticTraceEnabled: boolean;
  readonly observations: readonly TurnObservation[];
}

/**
 * Pure projection: live observations → replay fixture. Carries step, role,
 * status, client-elapsed wall clock, and body; the threaded hash memory and
 * label context are recomputed by `--replay` itself, so a capture can never
 * fossilise stale cross-turn threading.
 */
export function buildCaptureFixture(input: BuildCaptureFixtureInput): ReplayFixture {
  return {
    name: input.name,
    description:
      `LIVE CAPTURE from ${input.baseUrl} at ${input.capturedAt}. Review + redaction-check before ` +
      `committing as a gate fixture; it proves behaviour AT CAPTURE TIME only. Captured by --capture.`,
    brief: input.brief,
    transcript: {
      note: `Live capture (${input.observations.length} observations). Replay recomputes labels + hash memory.`,
      diagnostic_trace_enabled: input.diagnosticTraceEnabled,
      timing_debug_enabled: input.observations.some((o) => hasTimings(o.body)),
      observations: input.observations.map((o) => ({
        step: o.step,
        role: o.role,
        http_status: o.httpStatus,
        ...(typeof o.elapsedMs === 'number' ? { elapsed_ms: Math.round(o.elapsedMs) } : {}),
        body: o.body ?? {},
      })),
    },
  };
}

/**
 * Serialise + write the capture: creates the target directory, passes the
 * JSON through the shared redactor (identity when no secret is configured) so
 * the API key can never reach disk. Throws on I/O failure — the CALLER must
 * treat a capture failure as non-fatal (the live run's report is the more
 * valuable artefact and must still be written).
 */
export function writeCaptureFixture(
  path: string,
  fixture: ReplayFixture,
  redact: (input: unknown) => string,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, redact(JSON.stringify(fixture, null, 2)) + '\n', 'utf-8');
}
