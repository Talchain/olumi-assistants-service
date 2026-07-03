/**
 * Track 3 — R1 schema gate (fail-closed). Parses a raw candidate against the v1
 * `.strict()` envelope schema and maps any failure to a REDACTED
 * `{ path, code }` blocker — never a raw payload value (T4.0 §2 R1 + §5
 * redaction). Unknown envelope_version / unknown kind / extra field / missing
 * provenance / empty evidence_pointer / missing base_graph_hash all resolve to a
 * `rejected`-shaped blocker.
 *
 * TOTALITY: never throws. A throwing getter / Proxy on the raw input resolves to
 * `SCHEMA_INVALID`, not an exception.
 */
import {
  CandidateMutationEnvelopeV1,
  type CandidateMutationEnvelope,
} from './types.js';
import {
  SCHEMA_INVALID,
  UNKNOWN_KIND,
  UNKNOWN_ENVELOPE_VERSION,
  MISSING_PROVENANCE,
  EVIDENCE_POINTER_MISSING,
  BASE_HASH_MISSING,
  type MutationReasonCode,
} from './reason-codes.js';
import type { MutationBlocker } from './types.js';

export type ParseEnvelopeResult =
  | { readonly ok: true; readonly envelope: CandidateMutationEnvelope }
  | { readonly ok: false; readonly blocker: MutationBlocker };

/** Minimal structural view of a Zod issue — version-agnostic (avoids coupling to
 *  zod's classic/core issue-type exports across the 3.25 bridge release). */
interface IssueLike {
  readonly code?: string;
  readonly path: ReadonlyArray<string | number | symbol>;
}

/** Map the first (most specific) Zod issue to a reason code, path-based only. */
function codeForIssue(issue: IssueLike): MutationReasonCode {
  // Unknown discriminator (`kind`) — discriminated-union failure.
  if (issue.code === 'invalid_union_discriminator' || issue.path[0] === 'kind') {
    return UNKNOWN_KIND;
  }
  const p0 = issue.path[0];
  if (p0 === 'envelope_version') return UNKNOWN_ENVELOPE_VERSION;
  if (p0 === 'base_graph_hash') return BASE_HASH_MISSING;
  if (p0 === 'provenance') {
    if (issue.path[1] === 'evidence_pointer') return EVIDENCE_POINTER_MISSING;
    // Only a missing/invalid provenance OBJECT is MISSING_PROVENANCE; a present block
    // with an otherwise-invalid sub-field (e.g. a bad `source` enum) is SCHEMA_INVALID.
    if (issue.path.length === 1) return MISSING_PROVENANCE;
    return SCHEMA_INVALID;
  }
  return SCHEMA_INVALID;
}

function redactedPath(issue: IssueLike): string {
  return issue.path.length > 0 ? issue.path.map((p) => String(p)).join('.') : '<root>';
}

export function parseEnvelope(raw: unknown): ParseEnvelopeResult {
  let parsed: ReturnType<typeof CandidateMutationEnvelopeV1.safeParse>;
  try {
    parsed = CandidateMutationEnvelopeV1.safeParse(raw);
  } catch {
    return {
      ok: false,
      blocker: { code: SCHEMA_INVALID, readable: 'Envelope could not be read (unparseable input).' },
    };
  }
  if (parsed.success) return { ok: true, envelope: parsed.data };

  const issue = parsed.error.issues[0];
  const code = issue ? codeForIssue(issue) : SCHEMA_INVALID;
  const path = issue ? redactedPath(issue) : '<root>';
  return {
    ok: false,
    // Redacted: path + code only, NEVER the offending value.
    blocker: { code, readable: `Envelope rejected at \`${path}\` (${code}).` },
  };
}
