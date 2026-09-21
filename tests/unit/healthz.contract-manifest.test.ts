/**
 * /healthz — the four contract-health-manifest fields.
 *
 * WHY THIS FILE EXISTS. `CLAUDE.md` names schema-version skew as the estate's
 * DOMINANT cross-cutting risk: each repo pins its own `@talchain/schemas`, the
 * versions drift, and a consumer on an older version SILENTLY DROPS fields it
 * does not know. A value that validates at the producer vanishes at the
 * consumer with no error anywhere.
 *
 * That risk was UNMEASURABLE from outside the box. A live debug capture on
 * 18 Sep 2026 reported all six `schema_versions.*` fields null with
 * `consistency_status: "unknown"`, reason `missing_schema_versions` — so the
 * one risk the estate calls dominant could not be observed on a real turn.
 *
 * `@talchain/schemas` has shipped the remedy since 2026-07-26 (olumi-schemas
 * #20, `src/contracts/health-manifest.ts`): four fields EVERY Olumi service
 * must expose at the TOP LEVEL of its health response, plus a strict parser
 * and a reader/writer compatibility comparator. Measured 18 Sep 2026 across
 * all four repos: ZERO adoption (contrast control `@talchain/schemas` = 1336
 * hits in this repo, so the probe was not blind). This is the first adopter.
 *
 * ⚠ THE FIELDS ARE READ FROM THE RUNTIME-RESOLVED MODULE, NOT THE PIN.
 * `package.json` is a DECLARATION; the loaded module is the FACT, and they
 * diverge exactly when it matters — a stale `node_modules`, a hoisted
 * duplicate, a vendored tarball that was re-cut under the same version
 * string. This repo's `@talchain/schemas` is a vendored tarball, and the
 * divergence is live TODAY: the published 0.55.0 tarball carries
 * `CONTRACT_MANIFEST_SHA = 088fb46a…` while olumi-schemas `main` — also
 * calling itself 0.55.0 — carries `4d3b0995…`. Two byte-sets, one version
 * string. That is precisely the case `schema_sha` / `contract_manifest_sha`
 * exist to catch, and a pin-derived value could never see it.
 *
 * ⚠ EVERY ASSERTION BINDS BY IDENTITY TO THE IMPORTED CONSTANT, never to a
 * literal `'0.55.0'`. A literal here would be a hand-maintained mirror
 * (CLAUDE.md trap 12): it would go stale on the next contract bump and the
 * failure would read as a product defect rather than as drift in this file.
 *
 * ⚠ IT EXERCISES THE REAL ROUTE. `tests/integration/healthz.test.ts` REPLICATES
 * the handler in its own `app.get("/healthz", …)` closure, so it is structurally
 * incapable of noticing that the real endpoint stopped emitting something. This
 * file boots the real server via `build()` and injects, following
 * `tests/unit/healthz.prompt-env-readiness.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  SCHEMA_PACKAGE_VERSION,
  SCHEMA_SHA,
  CONTRACT_MANIFEST_SHA,
  HEALTH_MANIFEST_FIELDS,
  parseHealthManifest,
  releaseLine,
} from "@talchain/schemas";
import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("/healthz — contract health manifest", () => {
  let app: FastifyInstance;
  let body: Record<string, unknown>;

  beforeAll(async () => {
    process.env.LLM_PROVIDER = "fixtures";
    cleanBaseUrl();
    app = await build();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    body = res.json() as Record<string, unknown>;
  });

  afterAll(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // THE MECHANISM — all four fields, at the TOP LEVEL.
  //
  // The contract is explicit that they are NOT nested under a `contract` key:
  // "a nested object is easy to add and easy for a load balancer / smoke test
  // to never look at. Top-level fields sit next to `build` and get read."
  // Asserting the nesting is therefore part of asserting the mechanism.
  // -----------------------------------------------------------------------
  it("exposes all four HEALTH_MANIFEST_FIELDS at the top level", () => {
    for (const field of HEALTH_MANIFEST_FIELDS) {
      expect(body, `missing top-level "${field}"`).toHaveProperty(field);
    }
  });

  it("satisfies the contract's OWN strict parser", () => {
    // `parseHealthManifest` narrows to the four keys then parses `.strict()`,
    // so a typo like `schema_read_version` throws instead of being ignored.
    // Using the contract's validator rather than a local re-implementation is
    // what stops this test drifting from the rule it claims to enforce.
    expect(() => parseHealthManifest(body)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // THE RUNTIME-VS-PIN DISTINCTION — the whole point of the change.
  // -----------------------------------------------------------------------
  it("reports the RUNTIME-RESOLVED contract version and byte digests", () => {
    expect(body.schema_write_version).toBe(SCHEMA_PACKAGE_VERSION);
    expect(body.schema_sha).toBe(SCHEMA_SHA);
    expect(body.contract_manifest_sha).toBe(CONTRACT_MANIFEST_SHA);
  });

  it("declares a read set that includes what it writes", () => {
    const readVersions = body.schema_read_versions as string[];
    expect(Array.isArray(readVersions)).toBe(true);
    expect(readVersions.length).toBeGreaterThan(0);
    expect(readVersions).toContain(SCHEMA_PACKAGE_VERSION);
  });

  it("is judged on RELEASE LINES, which is how 0.x compatibility is defined", () => {
    // `@talchain/schemas` is 0.x, so per semver-caret the breaking axis is
    // MINOR: releaseLine('0.55.0') === '0.55'. A peer comparing this service
    // against another compares these, never the exact strings.
    const readVersions = body.schema_read_versions as string[];
    const writeLine = releaseLine(body.schema_write_version as string);
    expect(writeLine).toBe(releaseLine(SCHEMA_PACKAGE_VERSION));
    expect(readVersions.map(releaseLine)).toContain(writeLine);
  });

  // -----------------------------------------------------------------------
  // NON-SECRET BY CONSTRUCTION — `/healthz` is an UNAUTHENTICATED route
  // (src/plugins/auth.ts allowlists it), so anything added here is public.
  // A version string and two sha256 digests carry no key, host, path or
  // magnitude. This asserts the shape stays that narrow.
  // -----------------------------------------------------------------------
  it("publishes only a version, a read set and two digests — no secrets", () => {
    expect(typeof body.schema_write_version).toBe("string");
    expect(body.schema_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(body.contract_manifest_sha).toMatch(/^[0-9a-f]{64}$/);
    for (const v of body.schema_read_versions as string[]) {
      expect(v).toMatch(/^\d+\.\d+\.\d+(?:[-+].*)?$/);
    }
  });
});
