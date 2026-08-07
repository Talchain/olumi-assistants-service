/**
 * Route-level forbidden-phrase egress guard for the active V1 narrative
 * routes (`narrate-conditions`, `explain-policy`).
 *
 * Why: PR #173's `FORBIDDEN_USER_FACING_PHRASES` is the single source of
 * truth for banned user-facing copy (`recommendation`, `recommended`,
 * `the winner`, `winning <X>`, the ROADMAP 2.213 choice-directive set,
 * plus the V5 staleness / denial set). The V5 turn-executor applies it
 * via `applyEgressForbiddenPhraseGuard`, but the V1 routes that pre-date
 * V5 — narrate-conditions, explain-policy — emit their composer output
 * verbatim to the wire. The P0 cleanup rewrites the obvious template
 * hits, and this guard catches anything a future template regression
 * introduces.
 *
 * ROADMAP 2.213: the two other routes this guard used to serve are gone
 * (`/assist/v1/key-insight`, `/assist/v1/generate-recommendation`). Doctrine
 * and rationale: `DOCTRINE_FATAL_PATTERNS` in
 * `orchestrator-v5/compose/forbidden-user-facing-phrases.ts`.
 *
 * Hard rule: NEVER mutate the response shape. Replace only string
 * field values with the neutral fallback when a banned phrase fires.
 * Numeric, boolean, structured, and trace fields pass through
 * untouched.
 */

import {
  applyEgressForbiddenPhraseGuard,
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
} from '../../orchestrator-v5/compose/forbidden-user-facing-phrases.js';

export { EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT };

/**
 * Selector tuple — `(field_path, get, set)` for one user-facing string
 * slot on the response. Callers build a list of these for the response
 * shape they want to guard. Keeps the helper schema-agnostic.
 *
 * Contract — slot ownership: this helper is deliberately schema-agnostic.
 * Route-level slot definitions OWN nested-shape assumptions; the helper
 * only iterates them and applies the forbidden-phrase guard. If a
 * callable `get` returns a non-string, the helper skips silently;
 * if it throws, the throw propagates. Route call sites always build
 * a well-typed response before guarding, so this is safe in practice.
 */
export interface NarrativeStringSlot<T> {
  readonly path: string;
  readonly get: (response: T) => string | undefined;
  readonly set: (response: T, value: string) => void;
}

/**
 * Selector for array-of-strings slots (`evidence`, `next_steps`,
 * `key_decision_points`, …). Each element is guarded independently.
 */
export interface NarrativeStringArraySlot<T> {
  readonly path: string;
  readonly get: (response: T) => readonly string[] | undefined;
  readonly set: (response: T, value: readonly string[]) => void;
}

export interface NarrativeEgressGuardResult {
  /** Whether ANY slot was rewritten. */
  readonly rewritten: boolean;
  /**
   * Per-rewrite record. Each entry names the path of the rewritten slot
   * and the specific banned phrase the original text contained. Used by
   * telemetry — never bubbled into user copy.
   */
  readonly rewrites: ReadonlyArray<{
    readonly path: string;
    readonly hit: string;
  }>;
}

/**
 * Apply the forbidden-phrase egress guard to a route response in place.
 *
 * Returns a record describing which fields (if any) were rewritten. The
 * caller is responsible for emitting `v5.egress.forbidden_phrase_detected`
 * telemetry with `dispatch_path: <route-name>` and the rewrites list when
 * the result has `rewritten: true`.
 *
 * @param response — the in-progress route response (mutated in place)
 * @param stringSlots — list of single-string field selectors
 * @param arraySlots — list of array-of-strings field selectors
 */
export function applyNarrativeEgressGuard<T extends object>(
  response: T,
  stringSlots: ReadonlyArray<NarrativeStringSlot<T>>,
  arraySlots: ReadonlyArray<NarrativeStringArraySlot<T>> = [],
): NarrativeEgressGuardResult {
  const rewrites: Array<{ path: string; hit: string }> = [];

  for (const slot of stringSlots) {
    const original = slot.get(response);
    // Type guard mirrors the array-slot path below — defensively skip
    // any slot whose `get` returns a non-string (number / object /
    // symbol / boolean / null / undefined) so the JSDoc "non-string
    // values do not trigger rewrites" contract holds in practice, not
    // just by accident of regex-string-coercion.
    if (typeof original !== 'string' || original.length === 0) continue;
    const guarded = applyEgressForbiddenPhraseGuard(original);
    if (guarded.rewritten && guarded.hit) {
      slot.set(response, guarded.text);
      rewrites.push({ path: slot.path, hit: guarded.hit });
    }
  }

  for (const slot of arraySlots) {
    const original = slot.get(response);
    if (original === undefined || original === null) continue;
    let anyRewritten = false;
    const next: string[] = [];
    for (let i = 0; i < original.length; i++) {
      const entry = original[i];
      if (typeof entry !== 'string' || entry.length === 0) {
        next.push(entry as unknown as string);
        continue;
      }
      const guarded = applyEgressForbiddenPhraseGuard(entry);
      if (guarded.rewritten && guarded.hit) {
        anyRewritten = true;
        next.push(guarded.text);
        rewrites.push({ path: `${slot.path}[${i}]`, hit: guarded.hit });
      } else {
        next.push(entry);
      }
    }
    if (anyRewritten) slot.set(response, next);
  }

  return { rewritten: rewrites.length > 0, rewrites };
}
