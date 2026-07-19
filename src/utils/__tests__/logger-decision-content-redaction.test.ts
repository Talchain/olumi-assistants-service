/**
 * Logger-boundary decision-content redaction — sentinel positive-control
 * suite (14-Jul PII ruling, CEE half; mirrors PLoT #224's test doctrine).
 *
 * EVERY absence assertion here is paired with a presence proof:
 *  - the PROTECTED logger must not emit the sentinel (absence), and
 *  - the same capture harness, on a logger WITHOUT the decision-content
 *    paths (i.e. the pre-fix config), MUST emit it (positive control).
 * An absence assertion whose harness cannot see a presence is vacuous —
 * this estate has shipped exactly that (the 0-byte pino/sonic-boom
 * capture), so the control is not optional.
 *
 * Mutation direction: reverting the logger-config change removes the
 * decision-content paths from REDACT_PATHS, which turns the coverage
 * tests here RED (they iterate the live DECISION_CONTENT_FIELDS and
 * assert against the live createLoggerConfig()).
 */

import { describe, expect, it } from "vitest";
import pino from "pino";

import {
  BASE_REDACT_PATHS,
  CREDENTIAL_FIELDS,
  CREDENTIAL_HEADER_NAMES,
  DECISION_CONTENT_FIELDS,
  REDACT_CENSOR,
  REDACT_PATHS,
  createLoggerConfig,
  decisionContentRedactPaths,
  redactCensor,
  sha8,
} from "../logger-config.js";

/** High-entropy sentinel — cannot collide with service vocabulary. */
const SENTINEL = "SENTINEL-9f3ac1e7-acquire-fintechco-for-50m";

const DIGEST_RE = /sha8:[0-9a-f]{8}/;

/** Build a logger over an in-memory destination and return its lines. */
function captureLogger(options: pino.LoggerOptions): {
  logger: pino.Logger;
  lines: string[];
} {
  const lines: string[] = [];
  const logger = pino(options, {
    write: (line: string) => {
      lines.push(line);
    },
  });
  return { logger, lines };
}

/** The production config (what server.ts + telemetry.ts construct). */
function protectedLogger() {
  return captureLogger(createLoggerConfig("info"));
}

/** The PRE-FIX config: credential paths only — the revert shape. */
function preFixLogger() {
  return captureLogger({
    level: "info",
    redact: { paths: [...BASE_REDACT_PATHS], censor: REDACT_CENSOR },
  });
}

describe("decision-content redaction at the pino boundary", () => {
  it("redacts EVERY protected field at depths 0, 1 and 2 (derived from the policy list, not a copy)", () => {
    const { logger, lines } = protectedLogger();
    for (const field of DECISION_CONTENT_FIELDS) {
      logger.info({ [field]: SENTINEL });
      logger.info({ ctx: { [field]: SENTINEL } });
      logger.info({ a: { b: { [field]: SENTINEL } } });
    }
    expect(lines).toHaveLength(DECISION_CONTENT_FIELDS.length * 3);
    for (const line of lines) {
      expect(line).not.toContain(SENTINEL);
      expect(line).toMatch(DIGEST_RE);
    }
  });

  it("POSITIVE CONTROL: the pre-fix config (credential paths only) leaks the sentinel at every depth", () => {
    const { logger, lines } = preFixLogger();
    for (const field of DECISION_CONTENT_FIELDS) {
      logger.info({ [field]: SENTINEL });
      logger.info({ ctx: { [field]: SENTINEL } });
      logger.info({ a: { b: { [field]: SENTINEL } } });
    }
    const leaking = lines.filter((l) => l.includes(SENTINEL));
    // Every line must leak: proves the harness sees presences AND that
    // the protection is exactly the decision-content paths this change
    // adds (revert them and the coverage test above goes RED).
    expect(leaking).toHaveLength(DECISION_CONTENT_FIELDS.length * 3);
  });

  it("POSITIVE CONTROL: a bare pino logger (no redact at all) leaks the sentinel", () => {
    const { logger, lines } = captureLogger({ level: "info" });
    logger.info({ node_label: SENTINEL });
    expect(lines.join("")).toContain(SENTINEL);
  });

  it("digests preserve within-process correlation (equal inputs, equal digests) and are not the raw value", () => {
    const { logger, lines } = protectedLogger();
    logger.info({ node_label: SENTINEL });
    logger.info({ ctx: { node_label: SENTINEL } });
    const digests = lines.map((l) => l.match(DIGEST_RE)?.[0]);
    expect(digests[0]).toBeDefined();
    expect(digests[0]).toBe(digests[1]);
    expect(digests[0]).toBe(sha8(SENTINEL));
    expect(digests[0]).not.toContain(SENTINEL);
  });

  it("digests numbers, digests array elements with length preserved, and keeps null/boolean structural", () => {
    const { logger, lines } = protectedLogger();
    logger.info({ labels: [SENTINEL, "second-label", 42] });
    logger.info({ node_label: 12345 });
    logger.info({ node_label: null, goal_text: true });
    const [arrLine, numLine, nullLine] = lines.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(arrLine.labels).toHaveLength(3);
    expect(arrLine.labels).toEqual([
      sha8(SENTINEL),
      sha8("second-label"),
      sha8(42),
    ]);
    expect(numLine.node_label).toBe(sha8(12345));
    expect(nullLine.node_label).toBeNull();
    expect(nullLine.goal_text).toBe(true);
  });

  it("does NOT disturb the credential class: nested secrets still blank to [REDACTED]", () => {
    const { logger, lines } = protectedLogger();
    logger.info({ req: { password: "hunter2", headers: { authorization: "Bearer abc" } } });
    const rec = JSON.parse(lines[0]) as {
      req: { password: string; headers: { authorization: string } };
    };
    expect(rec.req.password).toBe(REDACT_CENSOR);
    expect(rec.req.headers.authorization).toBe(REDACT_CENSOR);
    expect(lines[0]).not.toContain("hunter2");
  });

  it("closes the probe-proven TOP-LEVEL credential gap (each pino wildcard matches exactly one level)", () => {
    // 19-Jul deployed-head review, executed probe: under the old
    // hand-listed paths (`*.email`, `*.headers.authorization`) a
    // TOP-LEVEL `email` / `headers.authorization` logged VERBATIM
    // while one-level-nested forms redacted — the "at any depth"
    // comment was false. The generated depth-0 paths close it.
    const { logger, lines } = protectedLogger();
    logger.info({ email: "paul@example.com" });
    logger.info({ password: "hunter2" });
    logger.info({ headers: { authorization: "Bearer topsecret" } });
    logger.info({ headers: { cookie: "session=topsecretcookie" } }); // the genuinely-open old gap
    const joined = lines.join("");
    expect(joined).not.toContain("paul@example.com");
    expect(joined).not.toContain("hunter2");
    expect(joined).not.toContain("topsecret");
    expect(joined).not.toContain("topsecretcookie");
    for (const line of lines) {
      expect(line).toContain(REDACT_CENSOR);
    }
  });

  it("POSITIVE CONTROL: the HISTORICAL pre-fix path list leaks top-level credentials (the probe, pinned)", () => {
    // The exact path list that shipped before this change — a fixed
    // historical artifact, not a mirror of live code. Pins what the
    // executed probe ACTUALLY shows (which is narrower than the review
    // sentence that reported it — verified here, not inherited):
    //  - a TOP-LEVEL scalar credential (`email`) leaked: `*.email`
    //    needs one parent level;
    //  - `{headers: {authorization}}` did NOT leak — the generic
    //    `*.authorization` caught it — but header names WITHOUT a bare
    //    `*.<name>` twin (`cookie`, `x-api-key`, …) leaked at top
    //    level, because `*.headers.<name>` needs headers one level
    //    down;
    //  - one-level-nested forms always redacted.
    const HISTORICAL_PRE_FIX_PATHS = [
      "*.password", "*.secret", "*.token", "*.apiKey", "*.api_key",
      "*.apikey", "*.authorization", "*.credentials", "*.accessToken",
      "*.access_token", "*.refreshToken", "*.refresh_token",
      "*.privateKey", "*.private_key",
      "*.headers.authorization", "*.headers.x-api-key",
      "*.headers.x-olumi-assist-key", "*.headers.x-admin-key",
      "*.headers.x-hmac-signature", "*.headers.x-share-token",
      "*.headers.cookie", "*.headers.x-olumi-signature",
      "*.headers.x-olumi-nonce", "*.headers.x-olumi-timestamp",
      "*.email", "*.phone", "*.ssn", "*.creditCard", "*.credit_card",
    ];
    const { logger, lines } = captureLogger({
      level: "info",
      redact: { paths: HISTORICAL_PRE_FIX_PATHS, censor: REDACT_CENSOR },
    });
    logger.info({ email: "paul@example.com" });
    logger.info({ headers: { cookie: "session=topsecretcookie" } });
    logger.info({ ctx: { email: "nested@example.com" } }); // one-deep DID redact
    const joined = lines.join("");
    expect(joined).toContain("paul@example.com"); // top-level scalar leaked
    expect(joined).toContain("topsecretcookie"); // top-level headers.cookie leaked
    expect(joined).not.toContain("nested@example.com"); // depth-1 worked
  });

  it("covers child loggers (the Fastify req.log shape) — the boundary property", () => {
    const { logger, lines } = protectedLogger();
    logger.child({ svc: "turn-executor" }).info({ assistant_text: SENTINEL });
    expect(lines.join("")).not.toContain(SENTINEL);
    expect(lines.join("")).toMatch(DIGEST_RE);
  });

  it("REDACT_PATHS is derived: credential paths + generated decision-content paths, nothing hand-merged", () => {
    expect([...REDACT_PATHS]).toEqual([
      ...BASE_REDACT_PATHS,
      ...decisionContentRedactPaths(DECISION_CONTENT_FIELDS),
    ]);
    // Depth contract: 3 paths per protected field, for BOTH classes.
    expect(decisionContentRedactPaths(["x"])).toEqual(["x", "*.x", "*.*.x"]);
    expect(BASE_REDACT_PATHS).toHaveLength(
      CREDENTIAL_FIELDS.length * 3 + CREDENTIAL_HEADER_NAMES.length * 3,
    );
    for (const f of CREDENTIAL_FIELDS) {
      expect(BASE_REDACT_PATHS).toContain(f); // depth-0 — the closed gap
      expect(BASE_REDACT_PATHS).toContain(`*.${f}`);
      expect(BASE_REDACT_PATHS).toContain(`*.*.${f}`);
    }
    for (const h of CREDENTIAL_HEADER_NAMES) {
      expect(BASE_REDACT_PATHS).toContain(`headers.${h}`); // depth-0 — the closed gap
      expect(BASE_REDACT_PATHS).toContain(`*.headers.${h}`);
      expect(BASE_REDACT_PATHS).toContain(`*.*.headers.${h}`);
    }
  });

  it("censor branches by path terminal: decision content digests, everything else blanks", () => {
    expect(redactCensor(SENTINEL, ["node_label"])).toBe(sha8(SENTINEL));
    expect(redactCensor(SENTINEL, ["ctx", "node_label"])).toBe(sha8(SENTINEL));
    expect(redactCensor("hunter2", ["password"])).toBe(REDACT_CENSOR);
  });

  it("DOCUMENTED RESIDUAL: depth >= 3 is not covered by the path-based boundary", () => {
    // Honest boundary of the guarantee — if this test ever FAILS, the
    // mechanism got stronger and this pin plus the module docs should
    // be updated together.
    const { logger, lines } = protectedLogger();
    logger.info({ a: { b: { c: { node_label: SENTINEL } } } });
    expect(lines.join("")).toContain(SENTINEL);
  });
});
