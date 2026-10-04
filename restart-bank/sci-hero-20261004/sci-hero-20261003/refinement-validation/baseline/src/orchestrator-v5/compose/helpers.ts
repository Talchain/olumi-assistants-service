/**
 * Pure helpers for V5 failure composers.
 *
 *  - `safeLabel`            Never leak entity IDs into user-visible text.
 *  - `sanitiseForUser`      Scrub nested shapes, stack-trace-like fragments,
 *                            and overlong strings before interpolation.
 *  - `describeSchema`       Map common Zod shapes to short user-facing phrases.
 *  - `USER_FACING_HANDLERS` / `curatedHandlerChips` — the curated list of
 *                            handler IDs safe to surface as next-step chips.
 */

import type { z } from 'zod';

import type { HandlerValidationRegistry } from '../routing/validator.js';

// ---------------------------------------------------------------------------
// safeLabel
// ---------------------------------------------------------------------------

export interface EntityLike {
  readonly label?: string | null;
  readonly kind?: string | null;
}

const MAX_LABEL_LENGTH = 60;

// Id-shape detectors. Belt-and-braces guard against upstream bugs that
// might still surface id-shaped tokens through the label field (e.g. an
// adapter regression or a caller hand-constructing EntityLike from raw
// graph data). Real user labels rarely look like these patterns:
//   - all-lowercase `prefix_alphanum` (e.g. opt_a, fac_churn_x7, goal_main).
//     Restricted to lowercase so Title_Case user labels like "Plan_A" or
//     "Draft_v1" don't false-positive.
//   - UUID v1–v5 canonical form (hex is checked case-insensitively).
const ID_LIKE_PREFIXED = /^[a-z][a-z0-9]*_[a-z0-9_]+$/;
const ID_LIKE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeId(s: string): boolean {
  return ID_LIKE_PREFIXED.test(s) || ID_LIKE_UUID.test(s);
}

/**
 * Return a user-safe reference to an entity. Never returns a raw ID. Falls
 * back to "that {kind}" when only kind is known, else "that item". The 60-
 * char cap is defence-in-depth: pathological labels from user-supplied graph
 * data can't blow up template readability even if a caller forgets to
 * sanitise further. Id-shaped strings are rejected so label-substituted-with-
 * id fallbacks (should any upstream regression reintroduce them) still
 * degrade to the kind-based phrase rather than leaking the id.
 */
export function safeLabel(entity: EntityLike | null | undefined): string {
  if (entity && typeof entity.label === 'string') {
    const trimmed = entity.label.trim();
    if (trimmed.length > 0 && !looksLikeId(trimmed)) {
      return truncate(trimmed, MAX_LABEL_LENGTH);
    }
  }
  if (entity && typeof entity.kind === 'string' && entity.kind.trim().length > 0) {
    return `that ${entity.kind.trim()}`;
  }
  return 'that item';
}

// ---------------------------------------------------------------------------
// sanitiseForUser
// ---------------------------------------------------------------------------

/**
 * Stack-trace-fragment scrubber. Targets Node.js / V8 stack frames such
 * as:
 *   - `at /app/src/foo.ts:123:45`
 *   - `at functionName (/app/src/foo.ts:123:45)`
 *   - `at Object.<anonymous> (/path:42:5)`
 *
 * Phase 2a.1 — the previous form
 *
 *   /\s*at\s+[^\s]+(?::\d+)?(?::\d+)?\)?/g
 *
 * made the `:LINE` suffix optional, so any phrase containing
 * ` at <word>` matched. The greedy scrubber then destroyed legitimate
 * prose. Concrete production failure observed on staging:
 *
 *   user prompt → set_factor_value handler throws D1HandlerError with
 *     userGuidance="I could not update that value because the target
 *                   or value was not valid."
 *   sanitiseForUser strips " at value" → "I could not update th  because…"
 *   whitespace collapse → "I could not update th because the target or
 *                          value was not valid."
 *
 * All three D1 handler canonical phrases were affected
 * (`add_constraint` / `set_factor_value` / `adjust_edge_strength`)
 * because each contains an `at <word>` token (`at constraint`,
 * `at value`, `at edit`). The tightened form below requires EITHER:
 *
 *   1. a path-shaped token (containing `/`, `.`, or a letter) directly
 *      followed by `:\d+(?::\d+)?\)?` — real direct stack-frame, or
 *   2. `at <token>` followed by a parenthesised non-empty source
 *      location — function-with-parens stack-frame.
 *
 * A look-ahead `(?=\S*[\/.a-zA-Z])` guards Alt 1 from matching pure-
 * digit + colon tokens like time literals (`at 10:30`). Alt 2 captures
 * the parenthesised source path so `at Object.<anonymous> (/path:42:5)`
 * is stripped as a single unit.
 */
const STACK_TRACE_FRAGMENT =
  /\s*at\s+(?:(?=\S*[/.a-zA-Z])\S+:\d+(?::\d+)?\)?|\S+\s+\([^)]*\))/g;
const MAX_USER_STRING = 100;

/**
 * Convert arbitrary internal values into a single short user-safe string.
 *
 * Rules (in order):
 *   - null/undefined → "unknown"
 *   - boolean/number → `String(value)`
 *   - array          → recursively sanitise each element, join with ", ",
 *                      THEN cap at 100 chars so large arrays can't exceed
 *                      the output budget
 *   - plain object   → "[complex value]" (do not leak internal fields)
 *   - string         → strip stack-trace fragments, collapse whitespace,
 *                      truncate at 100 chars with a trailing "..." marker
 */
export function sanitiseForUser(value: unknown): string {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const joined = value
      .map((v) => sanitiseForUser(v))
      .filter((s) => s.length > 0)
      .join(', ');
    return truncate(joined, MAX_USER_STRING);
  }
  if (typeof value === 'object') return '[complex value]';
  if (typeof value !== 'string') return '[complex value]';

  const s = value.replace(STACK_TRACE_FRAGMENT, ' ').replace(/\s+/g, ' ').trim();
  if (s.length === 0) return 'unknown';
  return truncate(s, MAX_USER_STRING);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`;
}

// ---------------------------------------------------------------------------
// describeSchema — hardcoded shapes + .describe() fallback
// ---------------------------------------------------------------------------

interface ZodCheckLike {
  readonly kind: string;
  readonly value?: unknown;
}

interface ZodDefLike {
  readonly typeName?: string;
  readonly checks?: readonly ZodCheckLike[];
}

/**
 * Map a Zod schema to a short user-facing phrase. Tries hardcoded patterns
 * for the PoC-common constraints first, then falls back to `.description`,
 * then to a generic string. Wrapped in try/catch because `_def` is
 * technically internal — safety net defends against Zod major bumps.
 */
export function describeSchema(schema: z.ZodTypeAny): string {
  try {
    const descriptive = typeof schema.description === 'string' && schema.description.trim().length > 0
      ? schema.description.trim()
      : null;
    if (descriptive) return descriptive;

    const def = (schema as { _def?: ZodDefLike })._def;
    if (!def) return 'a valid value';

    if (def.typeName === 'ZodNumber') {
      const checks = def.checks ?? [];
      const min = checks.find((c) => c.kind === 'min');
      const max = checks.find((c) => c.kind === 'max');
      if (min && max && typeof min.value === 'number' && typeof max.value === 'number') {
        return `a number between ${min.value} and ${max.value}`;
      }
      if (min && typeof min.value === 'number' && min.value === 0) return 'a positive number';
      if (min && typeof min.value === 'number') return `a number ≥ ${min.value}`;
      return 'a number';
    }
    if (def.typeName === 'ZodString') return 'text';
    if (def.typeName === 'ZodBoolean') return 'true or false';
    if (def.typeName === 'ZodEnum') return 'one of the allowed values';
  } catch {
    // fall through to the generic fallback
  }
  return 'a valid value';
}

// ---------------------------------------------------------------------------
// Curated user-facing handler list
// ---------------------------------------------------------------------------

/**
 * Handler IDs that are safe to surface as user-facing next-step chips.
 * New handlers must be added explicitly here; the registry is NOT the source
 * of truth (it holds internal-only / dormant entries too).
 */
export const USER_FACING_HANDLERS: readonly string[] = ['run_analysis'] as const;

const USER_FACING_LABELS: Readonly<Record<string, string>> = {
  run_analysis: 'Run analysis',
};

/**
 * Intersect `USER_FACING_HANDLERS` with whatever the registry currently
 * declares, so chips can only point at handlers that actually exist.
 */
export function curatedHandlerChips(
  registry: HandlerValidationRegistry,
): ReadonlyArray<{ handler_id: string; label: string }> {
  return USER_FACING_HANDLERS.filter((id) => registry[id] != null).map((id) => ({
    handler_id: id,
    label: USER_FACING_LABELS[id] ?? id,
  }));
}
