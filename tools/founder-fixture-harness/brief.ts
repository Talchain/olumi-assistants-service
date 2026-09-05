/**
 * The brief, and the hash assertion that makes the run evidence rather than
 * an anecdote.
 *
 * PROTOCOL.md rule 3, verbatim: "Assert the brief by HASH, not by name. sha256
 * the text in-page before send, and again against the request body on the
 * wire. A harness that reports which fixture it *thinks* it sent is not
 * evidence."
 *
 * So there are TWO assertions here and they answer different questions:
 *
 *   `loadBrief`        — does the file on disk hash to what the fixture's own
 *                        `.sha256` sidecar says? (Did I read the right file?)
 *   `assertSentBrief`  — do the bytes recovered FROM THE SERIALISED REQUEST
 *                        BODY hash to the same value? (Did the right bytes go
 *                        on the wire?)
 *
 * The second is not redundant. A JSON-encoding mangle, a stray trim, an editor
 * that normalised a line ending, or a `message` field truncated by a builder
 * would all pass the first and fail the second. The expected hash is read from
 * the sidecar FILE, never from a constant in this repo — a constant here would
 * be a hand-maintained mirror of a value that lives somewhere else.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface LoadedBrief {
  readonly text: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly path: string;
  readonly sha256SidecarPath: string;
}

export function sha256Of(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export class BriefHashMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefHashMismatchError';
  }
}

/**
 * Parse a `shasum -a 256` sidecar line: `<64 hex>  <filename>`.
 * Returns the digest only when the named file matches the brief we loaded —
 * a sidecar naming a DIFFERENT file is a mismatch, not a match to be assumed.
 */
export function parseSha256Sidecar(contents: string, expectedFileName: string): string {
  const line = contents
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line === undefined) {
    throw new BriefHashMismatchError('sha256 sidecar is empty — cannot assert the brief.');
  }
  const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line);
  if (m === null) {
    throw new BriefHashMismatchError(
      `sha256 sidecar line is not "<64 hex>  <filename>": ${JSON.stringify(line.slice(0, 120))}`,
    );
  }
  const [, digest, named] = m;
  if (basename(named.trim()) !== expectedFileName) {
    throw new BriefHashMismatchError(
      `sha256 sidecar names ${JSON.stringify(basename(named.trim()))} but the brief loaded is ` +
        `${JSON.stringify(expectedFileName)}. Refusing to assume they are the same file.`,
    );
  }
  return digest.toLowerCase();
}

/**
 * Read the brief and assert it against its own `.sha256` sidecar.
 * Throws `BriefHashMismatchError` on any disagreement — the caller HALTS.
 * A run on an unverified brief is not a measurement of this fixture.
 */
export function loadBrief(briefPath: string): LoadedBrief {
  const raw = readFileSync(briefPath);
  const text = raw.toString('utf8');
  const actual = sha256Of(text);

  const sidecarPath = join(dirname(briefPath), `${basename(briefPath)}.sha256`);
  let sidecar: string;
  try {
    sidecar = readFileSync(sidecarPath, 'utf8');
  } catch {
    throw new BriefHashMismatchError(
      `No sha256 sidecar at ${sidecarPath}. PROTOCOL.md rule 3 requires asserting the brief by ` +
        'HASH, not by name; without the sidecar there is nothing to assert against. ' +
        'Point --brief at the fixture checkout, which ships BRIEF-FOUNDER-VERBATIM.txt.sha256.',
    );
  }

  const expected = parseSha256Sidecar(sidecar, basename(briefPath));
  if (actual !== expected) {
    throw new BriefHashMismatchError(
      `Brief hash mismatch. ${briefPath}\n  expected ${expected} (from ${sidecarPath})\n  actual   ${actual}\n` +
        'The file on disk is not the banked fixture. Do not run — no metric measured on a different ' +
        'brief is comparable with one measured on this one (README.md).',
    );
  }

  return {
    text,
    sha256: actual,
    bytes: raw.byteLength,
    path: briefPath,
    sha256SidecarPath: sidecarPath,
  };
}

/**
 * The second assertion: recover the brief FROM THE SERIALISED REQUEST BODY and
 * re-hash it.
 *
 * `serialisedBody` is the exact string handed to `fetch`. We parse it back and
 * hash `message`. This is what makes the claim "the brief went on the wire"
 * rather than "the harness believes it sent the brief".
 */
export function assertSentBrief(serialisedBody: string, expectedSha256: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialisedBody);
  } catch (err) {
    throw new BriefHashMismatchError(
      `Request body is not valid JSON, so the brief on the wire cannot be hashed: ${String(err)}`,
    );
  }
  const message = (parsed as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') {
    throw new BriefHashMismatchError(
      'Request body carries no string `message` field — nothing to hash. The brief did not go on the wire.',
    );
  }
  const onWire = sha256Of(message);
  if (onWire !== expectedSha256) {
    throw new BriefHashMismatchError(
      `Brief hash on the wire does not match the file.\n  file ${expectedSha256}\n  wire ${onWire}\n` +
        `  wire length ${message.length} chars / ${Buffer.byteLength(message, 'utf8')} bytes\n` +
        'A truncated or altered brief must never pass unnoticed (PROTOCOL.md rule 3).',
    );
  }
}
