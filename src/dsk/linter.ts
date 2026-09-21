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
  contextVocab: string[],
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

  // source_citations — triggers are routing logic, not empirical claims; exempt from min-citation rule
  if (obj.type !== "trigger" && !isNonEmptyArray(obj.source_citations)) {
    err(diags, id, "source_citations", "Must have at least one source citation");
  }

  // deprecated
  if (obj.deprecated && !isNonEmptyString(obj.deprecated_reason)) {
    err(diags, id, "deprecated_reason", "Deprecated objects must have a deprecated_reason");
  }

  // supersedes
  if (obj.supersedes !== undefined && obj.supersedes !== null) {
    const target = idSet.get(obj.supersedes);
    if (!target) {
      err(diags, id, "supersedes", `Supersedes target "${obj.supersedes}" not found in bundle`);
    } else {
      if (target.type !== obj.type) {
        err(
          diags,
          id,
          "supersedes",
          `Supersedes target "${obj.supersedes}" is type "${target.type}" but this object is type "${obj.type}" — must be same type`,
        );
      }
      if (target.deprecated) {
        err(
          diags,
          id,
          "supersedes",
          `Supersedes target "${obj.supersedes}" is itself deprecated`,
        );
      }
    }
  }

  // contraindications — required and non-empty
  if (!isNonEmptyArray(obj.contraindications)) {
    err(diags, id, "contraindications", "Must have at least one contraindication");
  }

  // context_tags — required, non-empty, vocabulary-checked, no duplicates
  if (!isNonEmptyArray(obj.context_tags)) {
    err(diags, id, "context_tags", "Must have at least one context tag");
  } else {
    for (const tag of obj.context_tags) {
      if (!contextVocab.includes(tag)) {
        err(diags, id, "context_tags", `Invalid context tag: "${tag}" — must be one of: ${contextVocab.join(", ")}`);
      }
    }
    // Duplicate check (sort a copy and look for consecutive equal elements)
    const sorted = [...obj.context_tags].sort();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1]) {
        err(diags, id, "context_tags", `Duplicate context tag: "${sorted[i]}"`);
        break; // report once per object
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

function validateClaim(
  diags: LintDiagnostic[],
  obj: DSKClaim,
  contextVocab: string[],
): void {
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
    // ['all'] is a special valid value — skip vocabulary check in that case
    const isAll =
      obj.scope.decision_contexts.length === 1 &&
      obj.scope.decision_contexts[0] === "all";
    if (!isAll) {
      for (const ctx of obj.scope.decision_contexts) {
        if (!contextVocab.includes(ctx)) {
          err(diags, id, "scope.decision_contexts", `Invalid context: "${ctx}" — must be one of: ${contextVocab.join(", ")}`);
        }
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

  // permitted_phrasing_band directional validation
  // strong evidence → strong or medium phrasing OK (conservative is allowed)
  // medium evidence → medium or weak phrasing OK
  // weak/mixed evidence → weak phrasing only
  const maxAllowedBand: Record<string, string[]> = {
    strong: ["strong", "medium"],
    medium: ["medium", "weak"],
    weak: ["weak"],
    mixed: ["weak"],
  };
  const allowed = maxAllowedBand[obj.evidence_strength];
  if (allowed && !allowed.includes(obj.permitted_phrasing_band)) {
    err(
      diags,
      id,
      "permitted_phrasing_band",
      `Phrasing band "${obj.permitted_phrasing_band}" exceeds evidence strength "${obj.evidence_strength}" — permitted: ${allowed.join(", ")}`,
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

function validateProtocol(
  diags: LintDiagnostic[],
  obj: DSKProtocol,
  idSet: Map<string, DSKObject>,
): void {
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

  // Cross-reference: linked_claim_id (optional, singular)
  if (obj.linked_claim_id !== undefined) {
    if (!isNonEmptyString(obj.linked_claim_id)) {
      err(diags, id, "linked_claim_id", "linked_claim_id must be a non-empty string if present");
    } else {
      const target = idSet.get(obj.linked_claim_id);
      if (!target) {
        err(diags, id, "linked_claim_id", `Referenced claim "${obj.linked_claim_id}" not found in bundle`);
      } else if (target.type !== "claim") {
        err(diags, id, "linked_claim_id", `Referenced id "${obj.linked_claim_id}" is type "${target.type}", expected "claim"`);
      }
    }
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
// Circular supersedes chain detection
// ---------------------------------------------------------------------------

function detectCircularSupersedes(
  diags: LintDiagnostic[],
  objects: DSKObject[],
): void {
  const supersedesMap = new Map<string, string>();
  for (const obj of objects) {
    if (obj.supersedes) {
      supersedesMap.set(obj.id, obj.supersedes);
    }
  }

  const reported = new Set<string>();

  for (const startId of supersedesMap.keys()) {
    if (reported.has(startId)) continue;

    const visited = new Set<string>();
    let current: string | undefined = startId;
    let hitReported = false;
    while (current && supersedesMap.has(current)) {
      if (reported.has(current)) {
        hitReported = true;
        break;
      }
      if (visited.has(current)) {
        for (const node of visited) reported.add(node);
        err(
          diags,
          startId,
          "supersedes",
          `Circular supersedes chain detected: ${[...visited, current].join(" → ")}`,
        );
        break;
      }
      visited.add(current);
      current = supersedesMap.get(current);
    }
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

/**
 * Lint a DSK bundle.
 *
 * @param bundle - The bundle to validate.
 * @param contextVocab - The controlled vocabulary for context_tags, loaded
 *   from data/dsk/context-tags.json (or custom path via --context-tags).
 */
export function lintBundle(bundle: DSKBundle, contextVocab: string[]): LintResult {
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
    validateBase(errors, obj, idSet, contextVocab);

    switch (obj.type) {
      case "claim":
        validateClaim(errors, obj as DSKClaim, contextVocab);
        break;
      case "protocol":
        validateProtocol(errors, obj as DSKProtocol, idSet);
        break;
      case "trigger":
        validateTrigger(errors, obj as DSKTrigger, idSet);
        break;
    }
  }

  // Cross-bundle checks
  detectCircularSupersedes(errors, bundle.objects);
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
