/**
 * Centralized Logger Configuration
 *
 * Single source of truth for Pino logger redaction paths.
 * Used by both server.ts (Fastify) and telemetry.ts (standalone Pino).
 *
 * SECURITY: All sensitive fields must be listed here to prevent
 * accidental exposure in logs. Update this file when adding new
 * secret headers, PII fields, or decision-content field names.
 *
 * TWO REDACTION CLASSES, one boundary (14-Jul PII ruling, CEE half —
 * mirrors the mechanism Paul ratified in PLoT #224 `e0293fe5`):
 *
 *  1. CREDENTIALS / GENERIC PII (`BASE_REDACT_PATHS`): blanked to
 *     "[REDACTED]". Unchanged behaviour — these predate this file's
 *     decision-content layer.
 *  2. DECISION CONTENT (`DECISION_CONTENT_FIELDS`): node labels, goal
 *     text, user messages, assistant prose. Replaced with a SALTED
 *     per-process digest ("sha8:xxxxxxxx") rather than blanked, so
 *     "are these two log lines about the same node?" stays answerable
 *     while the raw value never reaches the log (PLoT #224
 *     pii-redact.ts rationale, mirrored).
 *
 * WHY THE LOGGER BOUNDARY: point defenses at individual call sites
 * (routing-log sink, validator-details stripping, share-redaction)
 * each protect one seam and stay in place. This layer makes a log
 * site safe WITHOUT its author doing anything — the lesson PLoT
 * learned across three rounds of per-call-site edits that each found
 * more leaking sites.
 *
 * MECHANISM: pino `redact` paths (fast-redact), deliberately
 * path-based rather than deep-scanning — redaction runs on every log
 * line, and a content-scrubbing walk would tax every emission. The
 * trade: a protected FIELD NAME is covered at nesting depths 0–2
 * (`f`, `*.f`, `*.*.f` — each fast-redact `*` matches exactly one
 * level, verified against pino 9); a decision value interpolated into
 * message TEXT or nested ≥3 deep is NOT covered by this layer. That
 * residual is accepted and documented — the deep-scan alternative was
 * ruled out on per-line cost.
 */

import { createHmac, randomBytes } from "node:crypto";

/**
 * Credential / generic-PII field names — the pre-existing redaction
 * class, blanked to REDACT_CENSOR. Do not fold decision-content names
 * in here; they belong in DECISION_CONTENT_FIELDS so they get digests
 * (correlation-preserving) instead of blanks.
 *
 * ⚠ The old hand-listed paths claimed "at any depth" — FALSE under
 * pino path semantics (verified by executed probe, 19-Jul review):
 * each fast-redact `*` matches exactly ONE level, so `*.email`
 * redacted `{ctx: {email}}` while logging a TOP-LEVEL `email`
 * VERBATIM. Paths are now GENERATED at depths 0–2 from these name
 * lists, closing the top-level gap.
 */
export const CREDENTIAL_FIELDS = [
  // Auth secrets
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "apikey",
  "authorization",
  "credentials",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "privateKey",
  "private_key",
  // Generic PII
  "email",
  "phone",
  "ssn",
  "creditCard",
  "credit_card",
] as const;

/**
 * Authentication header names redacted under any `headers` object
 * (the Fastify req serializer shape). Includes the HMAC auth headers
 * (timing attack vectors if exposed).
 */
export const CREDENTIAL_HEADER_NAMES = [
  "authorization",
  "x-api-key",
  "x-olumi-assist-key",
  "x-admin-key",
  "x-hmac-signature",
  "x-share-token",
  "cookie",
  "x-olumi-signature",
  "x-olumi-nonce",
  "x-olumi-timestamp",
] as const;

/**
 * Credential-class redact paths — DERIVED at depths 0–2 (`headers.*`
 * entries: the headers object itself at depths 0–2).
 */
export const BASE_REDACT_PATHS: readonly string[] = [
  ...CREDENTIAL_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`]),
  ...CREDENTIAL_HEADER_NAMES.flatMap((h) => [
    `headers.${h}`,
    `*.headers.${h}`,
    `*.*.headers.${h}`,
  ]),
];

/**
 * DECISION-CONTENT FIELD POLICY — the single list every consumer
 * derives from. pino redact paths are GENERATED from it
 * (decisionContentRedactPaths); the routing-log field policy
 * cross-checks against it in tests; the sentinel suite iterates it so
 * a listed field that stops redacting turns a test red.
 *
 * Membership rule: a field name goes here when its VALUE is, by
 * construction, user decision content — labels, goal text, user
 * messages, assistant/model prose, brief text. Service vocabulary
 * (event names, enum codes, error codes) stays out. Ambiguity
 * resolves toward scrubbing (PLoT #224 fail-safe direction): `label`
 * is included even though a minority of sites log service-authored
 * labels — the digest still correlates, and under-scrubbing costs
 * privacy while over-scrubbing costs only debuggability.
 *
 * KNOWN RESIDUAL (same class PLoT documents on DECISION_DOMAIN_KEYS):
 * this is a name list, so a decision value logged under a NAME nobody
 * listed passes through. The guarantee for listed names is mechanical
 * (boundary + derived paths + sentinel tests); the list itself still
 * needs an author to extend it when a new content-bearing field name
 * enters the codebase.
 */
export const DECISION_CONTENT_FIELDS = [
  // The four proven pass-through fields (14-Jul ruling, verified with a
  // positive control 18-Jul):
  "raw_user_message",
  "assistant_text",
  "node_label",
  "goal_text",
  // User-message twins in live vocabulary
  "user_message",
  "userMessage",
  "user_text",
  "message_text",
  // Assistant / model prose twins
  "assistantText",
  "answer_text",
  "answerText",
  "sonnet_text",
  "orientation_text",
  "orientationText",
  // Label family — node/option/factor/goal/target/entity labels and
  // plurals. `option_label` is a verified live leak site
  // (context-pack-assembler isProbabilityValid warn); entity_label /
  // proposed_label / resolved_label are the validator-details names
  // the e4529faf point defense strips before logging (belt-and-braces
  // here for any NEW site that logs them raw).
  "label",
  "labels",
  "node_labels",
  "option_label",
  "option_labels",
  "factor_label",
  "factor_labels",
  "goal_label",
  "target_label",
  "entity_label",
  "proposed_label",
  "resolved_label",
  // Brief / free-text decision framing
  "brief",
  "brief_text",
  "briefText",
  "decision_text",
  "summary_text",
  "coaching_text",
  "headline",
] as const;

export type DecisionContentField = (typeof DECISION_CONTENT_FIELDS)[number];

const DECISION_CONTENT_FIELD_SET: ReadonlySet<string> = new Set(
  DECISION_CONTENT_FIELDS,
);

/** Is this key name in the decision-content redaction class? */
export function isDecisionContentField(field: string): boolean {
  return DECISION_CONTENT_FIELD_SET.has(field);
}

/**
 * Generate the pino redact paths for a set of protected field names.
 * Depths 0–2: `f` (top level — the shape `emit()` produces when it
 * spreads eventData), `*.f` (one level down), `*.*.f` (two levels
 * down). Each fast-redact `*` matches exactly ONE level; there is no
 * deep-glob, which is the accepted residual documented above.
 */
export function decisionContentRedactPaths(
  fields: readonly string[],
): string[] {
  return fields.flatMap((f) => [f, `*.${f}`, `*.*.${f}`]);
}

/**
 * Paths to redact from all log output — DERIVED, not hand-listed:
 * credential paths + generated decision-content paths.
 */
export const REDACT_PATHS = [
  ...BASE_REDACT_PATHS,
  ...decisionContentRedactPaths(DECISION_CONTENT_FIELDS),
] as const;

/**
 * Redaction censor string (credential / generic-PII class).
 */
export const REDACT_CENSOR = "[REDACTED]";

/**
 * Per-process random salt for decision-content digests — minted once
 * at module load, DELIBERATELY not configurable (PLoT #224
 * DIGEST_SALT rationale, mirrored): an unsalted truncated hash over a
 * decision value is reversible offline (tiny input space), and a
 * configured salt would be a long-lived shared secret that leaks.
 * The trade-off: equal inputs digest equally WITHIN one process
 * (correlation survives), but NOT across restarts or replicas — do
 * not join digests across processes or treat them as stable ids.
 */
const DIGEST_SALT = randomBytes(32);

/**
 * Salted digest of a scalar → "sha8:xxxxxxxx". THE digest primitive
 * for decision content bound for logs. Mirrors PLoT #224's sha8.
 */
export function sha8(value: string | number): string {
  return (
    "sha8:" +
    createHmac("sha256", DIGEST_SALT)
      .update(String(value), "utf8")
      .digest("hex")
      .slice(0, 8)
  );
}

/** Digest one leaf under a decision-content key, preserving structure. */
function digestLeaf(value: unknown): unknown {
  // null / undefined / booleans are structural, never identifying —
  // preserve them so "label was null" stays diagnosable.
  if (value === null || value === undefined || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return sha8(value);
  }
  // Objects under a content key: blank rather than walk (path-based
  // discipline — no deep scanning at the boundary).
  return REDACT_CENSOR;
}

/**
 * pino redact censor. Branches on the redacted path's terminal
 * segment: decision-content fields get correlation-preserving digests
 * (arrays element-wise, length preserved); every other redacted path
 * (the credential class) keeps its historical "[REDACTED]" blank —
 * byte-identical to the pre-decision-content behaviour.
 */
export function redactCensor(
  value: unknown,
  path: ReadonlyArray<string | number>,
): unknown {
  const terminal = String(path[path.length - 1] ?? "");
  if (DECISION_CONTENT_FIELD_SET.has(terminal)) {
    if (Array.isArray(value)) {
      return value.map(digestLeaf);
    }
    return digestLeaf(value);
  }
  return REDACT_CENSOR;
}

/**
 * Create a Pino-compatible redact configuration
 */
export function createRedactConfig() {
  return {
    paths: [...REDACT_PATHS],
    censor: redactCensor,
  };
}

/**
 * Create full Pino logger options
 */
export function createLoggerConfig(level: string) {
  return {
    level,
    redact: createRedactConfig(),
  };
}
