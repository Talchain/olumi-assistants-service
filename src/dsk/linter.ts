/**
 * DSK bundle linter — validates structural, semantic, and cross-reference rules.
 *
 * Produces deterministic output sorted by (object_id, field_path).
 * Exit codes: 0 = clean, 1 = errors, 2 = warnings only.
 */

import type {
  DSKBundle,
  DSKClaim,
  DSKObject,
  DSKProtocol,
  DSKTrigger,
} from "./types.js";
import {
  CLAIM_CATEGORIES,
  CONTEXT_TAG_VOCABULARY,
  DECISION_STAGES,
  DSK_ID_REGEX,
  DSK_OBJECT_TYPES,
  EFFECT_DIRECTIONS,
  EVIDENCE_STRENGTHS,
} from "./types.js";
import { verifyDSKHash, computeDSKHash } from "./hash.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface LintDiagnostic {
  level: "error" | "warning";
  objectId: string;
  fieldPath: string;
  message: string;
}

export interface LintResult {
  errors: LintDiagnostic[];
  warnings: LintDiagnostic[];
  /** 0 = clean, 1 = errors, 2 = warnings only */
  exitCode: 0 | 1 | 2;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(
  diags: LintDiagnostic[],
  objectId: string,
  fieldPath: string,
  message: string,
): void {
  diags.push({ level: "error", objectId, fieldPath, message });
}

function warn(
  diags: LintDiagnostic[],
  objectId: string,
  fieldPath: string,
  message: string,
): void {
  diags.push({ level: "warning", objectId, fieldPath, message });
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isNonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function isValidSemver(v: string): boolean {
  return SEMVER_RE.test(v);
}

/**
 * Strict ISO 8601 check — accepts YYYY-MM-DD or full datetime
 * (YYYY-MM-DDTHH:mm:ssZ / YYYY-MM-DDTHH:mm:ss.sssZ / ±offset).
 */
const ISO8601_RE =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;

function isValidISO8601(v: string): boolean {
  if (!ISO8601_RE.test(v)) return false;
  // Calendar validity: reject impossible dates like 2025-02-31.
  // Extract YYYY-MM-DD and verify Date round-trips correctly.
  const [yyyy, mm, dd] = v.slice(0, 10).split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return (
    d.getUTCFullYear() === yyyy &&
    d.getUTCMonth() === mm - 1 &&
    d.getUTCDate() === dd
  );
}

function containsPlaceholder(v: unknown): boolean {
  return typeof v === "string" && /placeholder/i.test(v);
}

// ---------------------------------------------------------------------------
// Placeholder scanning
// ---------------------------------------------------------------------------

/** Recursively scan all string values for PLACEHOLDER content. */
function scanPlaceholders(
  diags: LintDiagnostic[],
  objectId: string,
  value: unknown,
  path: string,
): void {
  if (typeof value === "string") {
    if (containsPlaceholder(value)) {
      err(
        diags,
        objectId,
        path,
        `Placeholder content — needs review: ${objectId}.${path}`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanPlaceholders(diags, objectId, value[i], `${path}[${i}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      scanPlaceholders(diags, objectId, v, path ? `${path}.${k}` : k);
    }
  }
}

// ---------------------------------------------------------------------------
// Base object validation
// ---------------------------------------------------------------------------

function validateBase(
  diags: LintDiagnostic[],
  obj: DSKObject,
  idSet: Map<string, DSKObject>,
): void {
  const id = obj.id ?? "(missing)";

  // type discriminant
  if (!DSK_OBJECT_TYPES.includes(obj.type as (typeof DSK_OBJECT_TYPES)[number])) {
    err(diags, id, "type", `Invalid type: "${obj.type}"`);
  }

  // id format
  if (!isNonEmptyString(obj.id)) {
    err(diags, id, "id", "Missing or empty id");
  } else if (!DSK_ID_REGEX.test(obj.id)) {
    err(diags, id, "id", `Invalid id format: "${obj.id}" — must match ${DSK_ID_REGEX}`);
  }

  // title
  if (!isNonEmptyString(obj.title)) {
    err(diags, id, "title", "Missing or empty title");
  }

  // evidence_strength
  if (!EVIDENCE_STRENGTHS.includes(obj.evidence_strength as (typeof EVIDENCE_STRENGTHS)[number])) {
    err(diags, id, "evidence_strength", `Invalid evidence_strength: "${obj.evidence_strength}"`);
  }

  // version
  if (!isNonEmptyString(obj.version)) {
    err(diags, id, "version", "Missing or empty version");
  } else if (!isValidSemver(obj.version)) {
    err(diags, id, "version", `Invalid semver: "${obj.version}"`);
  }

  // last_reviewed_at
  if (!isNonEmptyString(obj.last_reviewed_at)) {
    err(diags, id, "last_reviewed_at", "Missing or empty last_reviewed_at");
  } else if (!isValidISO8601(obj.last_reviewed_at)) {
    err(diags, id, "last_reviewed_at", `Invalid ISO 8601 date: "${obj.last_reviewed_at}"`);
  }

  // source_citations
  if (!isNonEmptyArray(obj.source_citations)) {
    err(diags, id, "source_citations", "Must have at least one source citation");
  }

  // deprecated
  if (obj.deprecated && !isNonEmptyString(obj.deprecated_reason)) {
    err(diags, id, "deprecated_reason", "Deprecated objects must have a deprecated_reason");
  }

  // replacement_id
  if (obj.replacement_id !== undefined && obj.replacement_id !== null) {
    const target = idSet.get(obj.replacement_id);
    if (!target) {
      err(diags, id, "replacement_id", `Replacement "${obj.replacement_id}" not found in bundle`);
    } else {
      if (target.type !== obj.type) {
        err(
          diags,
          id,
          "replacement_id",
          `Replacement "${obj.replacement_id}" is type "${target.type}" but this object is type "${obj.type}" — must be same type`,
        );
      }
      if (target.deprecated) {
        err(
          diags,
          id,
          "replacement_id",
          `Replacement "${obj.replacement_id}" is itself deprecated`,
        );
      }
    }
  }

  // contraindications — required and non-empty
  if (!isNonEmptyArray(obj.contraindications)) {
    err(diags, id, "contraindications", "Must have at least one contraindication");
  }

  // context_tags — required, non-empty, and vocabulary-checked
  if (!isNonEmptyArray(obj.context_tags)) {
    err(diags, id, "context_tags", "Must have at least one context tag");
  } else {
    for (const tag of obj.context_tags) {
      if (!CONTEXT_TAG_VOCABULARY.includes(tag as (typeof CONTEXT_TAG_VOCABULARY)[number])) {
        err(diags, id, "context_tags", `Invalid context tag: "${tag}" — must be one of: ${CONTEXT_TAG_VOCABULARY.join(", ")}`);
      }
    }
  }

  // stage_applicability — required, non-empty, and value-checked
  if (!isNonEmptyArray(obj.stage_applicability)) {
    err(diags, id, "stage_applicability", "Must have at least one stage_applicability");
  } else {
    for (const stage of obj.stage_applicability) {
      if (!DECISION_STAGES.includes(stage)) {
        err(diags, id, "stage_applicability", `Invalid stage: "${stage}" — must be one of: ${DECISION_STAGES.join(", ")}`);
      }
    }
  }

  // Scan all string fields for PLACEHOLDER content
  scanPlaceholders(diags, id, obj, "");
}

// ---------------------------------------------------------------------------
// Claim validation
// ---------------------------------------------------------------------------

function validateClaim(diags: LintDiagnostic[], obj: DSKClaim): void {
  const id = obj.id;

  // claim_category
  if (!CLAIM_CATEGORIES.includes(obj.claim_category as (typeof CLAIM_CATEGORIES)[number])) {
    err(diags, id, "claim_category", `Invalid claim_category: "${obj.claim_category}"`);
  }

  // scope
  if (!obj.scope || typeof obj.scope !== "object") {
    err(diags, id, "scope", "Missing scope object");
    return;
  }

  if (!isNonEmptyArray(obj.scope.decision_contexts)) {
    err(diags, id, "scope.decision_contexts", "Must have at least one decision_context");
  } else {
    for (const ctx of obj.scope.decision_contexts) {
      if (!CONTEXT_TAG_VOCABULARY.includes(ctx as (typeof CONTEXT_TAG_VOCABULARY)[number])) {
        err(diags, id, "scope.decision_contexts", `Invalid context: "${ctx}" — must be one of: ${CONTEXT_TAG_VOCABULARY.join(", ")}`);
      }
    }
  }

  if (!isNonEmptyArray(obj.scope.stages)) {
    err(diags, id, "scope.stages", "Must have at least one stage");
  } else {
    for (const s of obj.scope.stages) {
      if (!DECISION_STAGES.includes(s)) {
        err(diags, id, "scope.stages", `Invalid stage: "${s}" — must be one of: ${DECISION_STAGES.join(", ")}`);
      }
    }
  }

  if (!isNonEmptyArray(obj.scope.populations)) {
    err(diags, id, "scope.populations", "Must have at least one population");
  }

  if (!isNonEmptyArray(obj.scope.exclusions)) {
    err(
      diags,
      id,
      "scope.exclusions",
      "Use ['none'] if genuinely universal — scope must be explicit",
    );
  }

  // permitted_phrasing_band consistency
  const bandMap: Record<string, string> = {
    strong: "strong",
    medium: "medium",
    weak: "weak",
    mixed: "weak",
  };
  const expectedBand = bandMap[obj.evidence_strength];
  if (expectedBand && obj.permitted_phrasing_band !== expectedBand) {
    err(
      diags,
      id,
      "permitted_phrasing_band",
      `Inconsistent: evidence_strength="${obj.evidence_strength}" requires permitted_phrasing_band="${expectedBand}" but got "${obj.permitted_phrasing_band}"`,
    );
  }

  // evidence_pack
  if (!obj.evidence_pack || typeof obj.evidence_pack !== "object") {
    err(diags, id, "evidence_pack", "Missing evidence_pack object");
  } else {
    for (const field of [
      "key_findings",
      "boundary_conditions",
      "known_limitations",
    ] as const) {
      if (!isNonEmptyString(obj.evidence_pack[field])) {
        err(diags, id, `evidence_pack.${field}`, `Missing or empty ${field}`);
      }
    }
    if (
      !EFFECT_DIRECTIONS.includes(
        obj.evidence_pack.effect_direction as (typeof EFFECT_DIRECTIONS)[number],
      )
    ) {
      err(
        diags,
        id,
        "evidence_pack.effect_direction",
        `Invalid effect_direction: "${obj.evidence_pack.effect_direction}"`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Protocol validation
// ---------------------------------------------------------------------------

function validateProtocol(diags: LintDiagnostic[], obj: DSKProtocol): void {
  const id = obj.id;

  if (!isNonEmptyArray(obj.steps)) {
    err(diags, id, "steps", "Must have at least one step");
  }
  if (!isNonEmptyArray(obj.required_inputs)) {
    err(diags, id, "required_inputs", "Must have at least one required_input");
  }
  if (!isNonEmptyArray(obj.expected_outputs)) {
    err(diags, id, "expected_outputs", "Must have at least one expected_output");
  }
}

// ---------------------------------------------------------------------------
// Trigger validation
// ---------------------------------------------------------------------------

function validateTrigger(
  diags: LintDiagnostic[],
  obj: DSKTrigger,
  idSet: Map<string, DSKObject>,
): void {
  const id = obj.id;

  if (!isNonEmptyString(obj.observable_signal)) {
    err(diags, id, "observable_signal", "Missing or empty observable_signal");
  }
  if (!isNonEmptyString(obj.recommended_behaviour)) {
    err(diags, id, "recommended_behaviour", "Missing or empty recommended_behaviour");
  }
  if (!isNonEmptyArray(obj.negative_conditions)) {
    err(
      diags,
      id,
      "negative_conditions",
      "Every trigger must have at least one negative condition to prevent false positives",
    );
  }

  // Cross-reference: linked_claim_ids
  if (Array.isArray(obj.linked_claim_ids)) {
    for (const claimId of obj.linked_claim_ids) {
      const target = idSet.get(claimId);
      if (!target) {
        err(diags, id, "linked_claim_ids", `Referenced claim "${claimId}" not found in bundle`);
      } else if (target.type !== "claim") {
        err(
          diags,
          id,
          "linked_claim_ids",
          `Referenced id "${claimId}" is type "${target.type}", expected "claim"`,
        );
      }
    }
  }

  // Cross-reference: linked_protocol_ids
  if (Array.isArray(obj.linked_protocol_ids)) {
    for (const protoId of obj.linked_protocol_ids) {
      const target = idSet.get(protoId);
      if (!target) {
        err(
          diags,
          id,
          "linked_protocol_ids",
          `Referenced protocol "${protoId}" not found in bundle`,
        );
      } else if (target.type !== "protocol") {
        err(
          diags,
          id,
          "linked_protocol_ids",
          `Referenced id "${protoId}" is type "${target.type}", expected "protocol"`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Circular replacement chain detection
// ---------------------------------------------------------------------------

function detectCircularReplacements(
  diags: LintDiagnostic[],
  objects: DSKObject[],
): void {
  const replacementMap = new Map<string, string>();
  for (const obj of objects) {
    if (obj.replacement_id) {
      replacementMap.set(obj.id, obj.replacement_id);
    }
  }

  // Track nodes already reported as part of a cycle to avoid duplicates.
  // When a walk reaches a node in `reported`, it means we've already
  // reported that cycle from a different start — stop silently.
  const reported = new Set<string>();

  for (const startId of replacementMap.keys()) {
    if (reported.has(startId)) continue;

    const visited = new Set<string>();
    let current: string | undefined = startId;
    let hitReported = false;
    while (current && replacementMap.has(current)) {
      if (reported.has(current)) {
        // This node's cycle was already reported — stop without emitting.
        hitReported = true;
        break;
      }
      if (visited.has(current)) {
        // Mark all cycle members as reported so we emit one diagnostic per cycle.
        for (const node of visited) reported.add(node);
        err(
          diags,
          startId,
          "replacement_id",
          `Circular replacement chain detected: ${[...visited, current].join(" → ")}`,
        );
        break;
      }
      visited.add(current);
      current = replacementMap.get(current);
    }
    // If we hit a previously-reported cycle, mark feeder nodes too
    // so other feeders into the same cycle are also silenced.
    if (hitReported) {
      for (const node of visited) reported.add(node);
    }
  }
}

// ---------------------------------------------------------------------------
// Ordering check
// ---------------------------------------------------------------------------

function checkOrdering(
  warnings: LintDiagnostic[],
  objects: DSKObject[],
): void {
  const ids = objects.map((o) => o.id);
  const sorted = [...ids].sort();
  if (JSON.stringify(ids) !== JSON.stringify(sorted)) {
    warn(
      warnings,
      "(bundle)",
      "objects",
      `Objects not in canonical id order. Expected: ${sorted.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Hash verification
// ---------------------------------------------------------------------------

function checkHash(diags: LintDiagnostic[], bundle: DSKBundle): void {
  if (!bundle.dsk_version_hash || bundle.dsk_version_hash.trim() === "") {
    const computed = computeDSKHash(bundle);
    err(
      diags,
      "(bundle)",
      "dsk_version_hash",
      `Hash is empty — computed value should be: ${computed}`,
    );
    return;
  }
  if (!verifyDSKHash(bundle)) {
    const computed = computeDSKHash(bundle);
    err(
      diags,
      "(bundle)",
      "dsk_version_hash",
      `Stored hash does not match computed hash. Stored: ${bundle.dsk_version_hash}, Computed: ${computed}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sort diagnostics deterministically
// ---------------------------------------------------------------------------

function sortDiagnostics(diags: LintDiagnostic[]): LintDiagnostic[] {
  return diags.slice().sort((a, b) => {
    const cmpId = a.objectId.localeCompare(b.objectId);
    if (cmpId !== 0) return cmpId;
    return a.fieldPath.localeCompare(b.fieldPath);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function lintBundle(bundle: DSKBundle): LintResult {
  const errors: LintDiagnostic[] = [];
  const warnings: LintDiagnostic[] = [];

  // Bundle-level structural checks
  if (!isNonEmptyString(bundle.version)) {
    err(errors, "(bundle)", "version", "Missing or empty bundle version");
  } else if (!isValidSemver(bundle.version)) {
    err(errors, "(bundle)", "version", `Invalid bundle semver: "${bundle.version}"`);
  }

  if (!isNonEmptyString(bundle.generated_at)) {
    err(errors, "(bundle)", "generated_at", "Missing or empty generated_at");
  } else if (!isValidISO8601(bundle.generated_at)) {
    err(errors, "(bundle)", "generated_at", `Invalid ISO 8601 date: "${bundle.generated_at}"`);
  }

  if (!Array.isArray(bundle.objects)) {
    err(errors, "(bundle)", "objects", "Missing or invalid objects array");
    return {
      errors: sortDiagnostics(errors),
      warnings: sortDiagnostics(warnings),
      exitCode: 1,
    };
  }

  // Build ID map for cross-referencing
  const idSet = new Map<string, DSKObject>();
  const duplicateIds = new Set<string>();

  for (const obj of bundle.objects) {
    if (idSet.has(obj.id)) {
      duplicateIds.add(obj.id);
    }
    idSet.set(obj.id, obj);
  }

  for (const dupId of duplicateIds) {
    err(errors, dupId, "id", `Duplicate id: "${dupId}"`);
  }

  // Validate each object
  for (const obj of bundle.objects) {
    validateBase(errors, obj, idSet);

    switch (obj.type) {
      case "claim":
        validateClaim(errors, obj as DSKClaim);
        break;
      case "protocol":
        validateProtocol(errors, obj as DSKProtocol);
        break;
      case "trigger":
        validateTrigger(errors, obj as DSKTrigger, idSet);
        break;
    }
  }

  // Cross-bundle checks
  detectCircularReplacements(errors, bundle.objects);
  checkHash(errors, bundle);

  // Ordering check (warning, not error)
  checkOrdering(warnings, bundle.objects);

  // Sort deterministically
  const sortedErrors = sortDiagnostics(errors);
  const sortedWarnings = sortDiagnostics(warnings);

  const exitCode: 0 | 1 | 2 =
    sortedErrors.length > 0 ? 1 : sortedWarnings.length > 0 ? 2 : 0;

  return { errors: sortedErrors, warnings: sortedWarnings, exitCode };
}

/** Reorder bundle objects by id (bytewise sort). Returns a new bundle. */
export function fixOrder(bundle: DSKBundle): DSKBundle {
  const sortedObjects = [...bundle.objects].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return { ...bundle, objects: sortedObjects };
}
