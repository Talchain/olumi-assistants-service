/**
 * GraphV3 draft-graph contract seam.
 *
 * THE validator is imported READ-ONLY from the repo's real schema module —
 * src/schemas/cee-v3.ts — which itself pins @talchain/schemas (vendored
 * tarball 0.13.0). The schema is NEVER re-created locally: forking the
 * contract is the exact failure the seam discipline exists to prevent.
 *
 * Import-cleanliness note (verified at build time, recorded in provenance):
 * cee-v3.ts transitively imports zod, @talchain/schemas, sibling schema
 * modules, and src/utils/telemetry.ts (module-level pino logger creation —
 * no env validation, no config load, no PMS, no network at import time).
 */
import {
  CEEGraphResponseV3,
  NodeV3,
  EdgeV3,
  GraphV3,
} from "../../../../src/schemas/cee-v3.ts";
import { validateDraftAtBoundary } from "./draft-boundary.ts";

export { CEEGraphResponseV3, NodeV3, EdgeV3, GraphV3 };

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

const MAX_ERRORS = 12;

/**
 * Validate one draft candidate for the DRY RUN ("did M1 emit a well-formed
 * draft"). This delegates to the LLM-boundary gate (validateDraftAtBoundary),
 * which mirrors the live adapter's acceptance gate: de-stringify + normalise +
 * LLMDraftResponse.safeParse. This is the correct basis for the v8 grammar,
 * whose raw output is the LLM-boundary shape (node.data.* nested, stringified
 * aux) — NOT the V3 shape CEEGraphResponseV3 expects (that gate runs live only
 * AFTER the deterministic V1->V3 transform, which is scored-round work).
 *
 * Fail-closed: anything unparsable is invalid; never throws. CEEGraphResponseV3
 * remains exported for downstream (scored-round) use, but is intentionally not
 * the dry-run validity basis. (Basis choice is a flagged rubric decision — see
 * Docs/m2-benchmark / the tooling brief §A7.)
 */
export function validateCandidate(candidate: unknown): ValidationOutcome {
  if (candidate === null || typeof candidate !== "object") {
    return { valid: false, errors: ["candidate is not an object"] };
  }
  const boundary = validateDraftAtBoundary(candidate);
  return { valid: boundary.valid, errors: boundary.errors };
}

export function validateNode(node: unknown): ValidationOutcome {
  const result = NodeV3.safeParse(node);
  return result.success
    ? { valid: true, errors: [] }
    : { valid: false, errors: result.error.issues.slice(0, MAX_ERRORS).map((i) => `${i.path.join(".")}: ${i.message}`) };
}

export function validateEdge(edge: unknown): ValidationOutcome {
  const result = EdgeV3.safeParse(edge);
  return result.success
    ? { valid: true, errors: [] }
    : { valid: false, errors: result.error.issues.slice(0, MAX_ERRORS).map((i) => `${i.path.join(".")}: ${i.message}`) };
}
