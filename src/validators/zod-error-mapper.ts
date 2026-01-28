/**
 * Zod Error Mapper
 *
 * Converts Zod validation errors to the ValidationIssue format
 * used by the graph validator. Provides LLM-friendly error messages
 * for the repair loop.
 *
 * @module validators/zod-error-mapper
 */

import type { ZodError, ZodIssue } from "zod";
import type { ValidationIssue } from "./graph-validator.types.js";

/**
 * Map Zod issue code to a user-friendly error code.
 */
function mapZodCodeToErrorCode(issue: ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return "ZOD_INVALID_TYPE";
    case "invalid_literal":
      return "ZOD_INVALID_LITERAL";
    case "unrecognized_keys":
      return "ZOD_UNRECOGNIZED_KEYS";
    case "invalid_union":
      return "ZOD_INVALID_UNION";
    case "invalid_enum_value":
      return "ZOD_INVALID_ENUM";
    case "invalid_arguments":
      return "ZOD_INVALID_ARGUMENTS";
    case "invalid_return_type":
      return "ZOD_INVALID_RETURN_TYPE";
    case "invalid_date":
      return "ZOD_INVALID_DATE";
    case "invalid_string":
      return "ZOD_INVALID_STRING";
    case "too_small":
      return "ZOD_TOO_SMALL";
    case "too_big":
      return "ZOD_TOO_BIG";
    case "custom":
      return "ZOD_CUSTOM_ERROR";
    case "invalid_intersection_types":
      return "ZOD_INVALID_INTERSECTION";
    case "not_multiple_of":
      return "ZOD_NOT_MULTIPLE_OF";
    case "not_finite":
      return "ZOD_NOT_FINITE";
    default:
      return "ZOD_VALIDATION_ERROR";
  }
}

/**
 * Convert Zod path to a JSON pointer-style string.
 * e.g., ["nodes", 0, "kind"] → "nodes[0].kind"
 */
function formatZodPath(path: (string | number)[]): string {
  if (path.length === 0) return "";

  return path.reduce((acc, segment, index) => {
    if (typeof segment === "number") {
      return `${acc}[${segment}]`;
    }
    return index === 0 ? segment : `${acc}.${segment}`;
  }, "") as string;
}

/**
 * Extract node/edge ID from Zod path if present.
 * Helps the repair LLM locate the problematic element.
 */
function extractContextFromPath(
  path: (string | number)[]
): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  // Check for nodes[index] or edges[index] pattern
  if (path.length >= 2) {
    const root = path[0];
    const index = path[1];

    if (root === "nodes" && typeof index === "number") {
      context.nodeIndex = index;
    } else if (root === "edges" && typeof index === "number") {
      context.edgeIndex = index;
    }
  }

  return context;
}

/**
 * Generate an LLM-friendly message from a Zod issue.
 * Focuses on actionable feedback rather than technical details.
 */
function generateLLMFriendlyMessage(issue: ZodIssue, path: string): string {
  const location = path ? ` at ${path}` : "";

  switch (issue.code) {
    case "invalid_type":
      return `Expected ${issue.expected}, received ${issue.received}${location}`;

    case "invalid_enum_value":
      const options = issue.options?.slice(0, 5).join(", ") ?? "unknown";
      return `Invalid value${location}. Must be one of: ${options}`;

    case "too_small":
      if (issue.type === "string") {
        return `String${location} must be at least ${issue.minimum} characters`;
      } else if (issue.type === "array") {
        return `Array${location} must have at least ${issue.minimum} items`;
      } else if (issue.type === "number") {
        return `Number${location} must be at least ${issue.minimum}`;
      }
      return `Value${location} is too small (minimum: ${issue.minimum})`;

    case "too_big":
      if (issue.type === "string") {
        return `String${location} must be at most ${issue.maximum} characters`;
      } else if (issue.type === "array") {
        return `Array${location} must have at most ${issue.maximum} items`;
      } else if (issue.type === "number") {
        return `Number${location} must be at most ${issue.maximum}`;
      }
      return `Value${location} is too large (maximum: ${issue.maximum})`;

    case "unrecognized_keys":
      const keys = issue.keys?.slice(0, 3).join(", ") ?? "unknown";
      return `Unrecognized keys${location}: ${keys}`;

    case "invalid_union":
      return `Value${location} does not match any valid schema`;

    case "custom":
      return issue.message || `Custom validation failed${location}`;

    default:
      return issue.message || `Validation error${location}`;
  }
}

/**
 * Convert a ZodError to an array of ValidationIssue objects.
 *
 * This mapper:
 * - Extracts path information for precise error location
 * - Generates LLM-friendly messages for repair prompts
 * - Preserves context (nodeIndex, edgeIndex) for targeted fixes
 *
 * @param zodError - The Zod validation error
 * @returns Array of ValidationIssue objects
 *
 * @example
 * ```typescript
 * import { Graph } from '../schemas/graph.js';
 * import { zodToValidationErrors } from './zod-error-mapper.js';
 *
 * const result = Graph.safeParse(rawGraph);
 * if (!result.success) {
 *   const errors = zodToValidationErrors(result.error);
 *   // errors can be passed to repair prompt
 * }
 * ```
 */
export function zodToValidationErrors(
  zodError: ZodError
): ValidationIssue[] {
  return zodError.issues.map((issue) => {
    const path = formatZodPath(issue.path);
    const code = mapZodCodeToErrorCode(issue);
    const message = generateLLMFriendlyMessage(issue, path);
    const context = extractContextFromPath(issue.path);

    // Add original Zod details for debugging
    context.zodCode = issue.code;
    if (issue.message !== message) {
      context.zodMessage = issue.message;
    }

    return {
      code: code as ValidationIssue["code"],
      severity: "error" as const,
      message,
      path: path || undefined,
      context,
    };
  });
}

/**
 * Check if an error is a ZodError.
 * Useful for catch blocks to determine if Zod validation failed.
 */
export function isZodError(error: unknown): error is ZodError {
  return (
    error !== null &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as ZodError).issues)
  );
}
