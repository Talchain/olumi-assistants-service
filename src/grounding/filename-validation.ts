/**
 * Attachment filename validation — SALVAGED, INERT (nothing imports this).
 *
 * Origin: PR #19 (v1.4 "Document Grounding Hardening"), closed unmerged.
 * Salvaged 2026-07-19.
 *
 * WHY IT WAS KEPT. There is a real raw-filename interpolation at
 * `src/grounding/process-attachments.ts:87` — an attacker-supplied filename
 * reaches a formatted string unvalidated. Control characters in that string
 * are a genuine (if low-severity) output-integrity problem, and an unbounded
 * filename is a genuine resource concern. Those two checks are what this
 * module carries.
 *
 * WHAT WAS DELIBERATELY *NOT* KEPT. PR #19's `security.ts` also asserted
 * path-traversal rejection (`..`, `/`, `\`, absolute paths) and CSV formula
 * injection rejection. Those checks were dropped on inspection because
 * **neither claim has a sink in this repo**: the attachment path never opens a
 * file by the supplied name and never writes a spreadsheet, so the checks
 * guarded a threat model that does not exist here. Importing them would have
 * shipped security theatre — a guard that reads as protection while protecting
 * nothing. If a filesystem or spreadsheet sink is ever introduced, re-derive
 * those checks against the real sink rather than restoring them from #19.
 *
 * WIRING IS DEFERRED AND ROWED. PR #19 also patched `process-attachments.ts`
 * to call the validator. That is a behaviour change (it makes previously
 * accepted uploads throw) and was NOT imported. This module is currently dead
 * code, preserved so the analysis is not lost.
 *
 * Pure: no I/O, no telemetry, no env reads.
 */

/** Maximum accepted filename length, in UTF-16 code units. */
export const MAX_FILENAME_LENGTH = 255;

/**
 * Validate an attachment filename.
 *
 * Rejects control characters (C0 range plus DEL) and filenames longer than
 * {@link MAX_FILENAME_LENGTH}.
 *
 * @throws Error with a `filename_invalid:` prefix if the filename is unsafe.
 */
export function validateFilename(filename: string): void {
  // Reject control characters — these corrupt any log line, header, or
  // human-facing string the filename is interpolated into.
  // Matching control characters is the entire purpose of this check.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(filename)) {
    throw new Error("filename_invalid: Filename contains control characters");
  }

  // Bound the length.
  if (filename.length > MAX_FILENAME_LENGTH) {
    throw new Error(
      `filename_invalid: Filename exceeds ${MAX_FILENAME_LENGTH} characters`
    );
  }
}
