/**
 * Type declarations for the continuity harness redactor.
 *
 * The runtime module is plain `.mjs` so the Tier 2 battery runs under bare
 * `node` with no build step — a harness that needs compiling before it can
 * observe a deployed service is a harness that will rot. These declarations
 * exist so the Tier 1 self-check imports it with real types rather than `any`,
 * which would silently disable every type guarantee in the tests that prove
 * the instrument works.
 */

export interface RedactionHit {
  kind: 'jwt' | 'bearer' | 'service_key';
  sha256_prefix: string;
  length: number;
}

export interface RedactionResult<T = unknown> {
  value: T;
  hits: RedactionHit[];
}

export interface RedactorControlCheck {
  control: 'positive' | 'contrast';
  expectation: string;
  ok: boolean;
  detail: string;
}

export interface RedactorProof {
  ok: boolean;
  checks: RedactorControlCheck[];
}

/** SHA-256 prefix of a value. Secrets are reported this way and never in the clear. */
export function fingerprint(value: unknown): string;

/** Redact every secret-shaped substring in an arbitrary structure. */
export function redact<T = unknown>(input: T): RedactionResult<T>;

/** Positive + contrast controls. Must be run before the first capture. */
export function proveRedactorFires(): RedactorProof;
