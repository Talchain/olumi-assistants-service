/**
 * Canonical denylist of internal repair / A5 enforcement vocabulary that
 * MUST NOT appear in user-facing assistant_text on any edit_graph (or
 * downstream) surface.
 *
 * Sources of operator-language leakage that historically reached
 * assistant_text or were at risk:
 *   - graph-enforcement.ts:237 ("Rescaled N causal inbound edges from
 *     sum=X.XXX to 1.0")
 *   - applyBudgetRescale / fixBridgeChaining repair codes
 *   - PLoT validator rejection reasons containing `|mean|`, `Σ|mean|`,
 *     `BUDGET_TARGET`, `[INBOUND_BUDGET_RESCALED]`, etc.
 *   - LLM coaching.summary or warnings — Sonnet may occasionally echo
 *     the input prompt's internal vocabulary.
 *
 * The legacy "PLoT applied N repair(s) to ensure semantic consistency"
 * prefix at edit-graph.ts:2337 was removed in 2026-05; this denylist is
 * a defence-in-depth catch for any other path that produces operator
 * vocabulary, including LLM-generated text.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠⚠ 2026-08-16 — THE SCRUBBER WAS ITSELF THE LEAK (P1, witnessed live).
 *
 * Two defects, both user-visible, both found in Paul's manual test with
 * server logs showing `replacement_count: 2` on a real turn:
 *
 *   (1) FOUR OF THE TWELVE PATTERNS WERE ORDINARY ENGLISH — `\binbound\b`,
 *       `\bbridge\b`, `\bceiling\b`, `\brescale`. A user talking about
 *       inbound leads, a bridge loan, or a spending ceiling had their own
 *       vocabulary struck out of the assistant's reply. These are REMOVED.
 *       They were never operator tokens; they were the ordinary words that
 *       happened to appear inside operator sentences, and the operator
 *       sentences are already caught by their genuinely-distinctive
 *       neighbours (`sum=`, `[INBOUND_*]`, `[BRIDGE_*]`, `Σ`).
 *
 *   (2) THE SUBSTITUTION WAS THE LITERAL STRING `[REDACTED]`. A placeholder
 *       token is operator vocabulary too — arguably the loudest kind. It
 *       tells the user that something was hidden from them, on a surface
 *       where nothing sensitive exists. Every surviving pattern now carries
 *       a NEUTRAL PLAIN-ENGLISH replacement DEFINED BESIDE IT, so the
 *       sentence degrades into readable prose instead of into a redaction
 *       notice. `compose/output-safety.ts` carries an egress net asserting
 *       that `[REDACTED]` never reaches `assistant_text` at all.
 *
 * A third defect fell out of the same read: the patterns were NON-GLOBAL and
 * `String.replace` therefore swapped only the FIRST occurrence, so a
 * two-occurrence sentence shipped half-scrubbed. Substitution now uses global
 * patterns; the detection view below strips the `g` flag precisely because a
 * global regex carries `lastIndex` state and makes repeated `.test()` /
 * `toMatch()` calls answer differently on alternate invocations.
 *
 * The bracketed codes are also matched THROUGH their closing bracket rather
 * than by prefix. `/\[INBOUND_/` consumed five characters of
 * `[INBOUND_BUDGET_RESCALED]` and left `BUDGET_RESCALED]` sitting in the
 * user's sentence — the scrub produced the leak it was written to prevent.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Append-only in the direction that matters: ADDING a pattern is free,
 * REMOVING one requires co-review of every `enforceRepairVocabularyDenylist`
 * callsite + every `assertNoBannedInternalTokens` test. That co-review was
 * performed for the four removals above — the complete manifest is two
 * production callsites (`edit-graph.ts:2400`, `edit-graph.ts:3975`) and one
 * test consumer (`tests/unit/orchestrator/tools/edit-graph.test.ts`, via
 * `tests/helpers/banned-internal-tokens.ts`).
 */

/**
 * One operator token and the plain-English phrase that replaces it.
 *
 * ⭐ THE REPLACEMENT IS DEFINED BESIDE THE PATTERN, deliberately. A single
 * shared placeholder is what produced defect (2) above: it makes the
 * substitution independent of what was substituted, which is exactly the
 * property that lets a scrubber emit something no human would write.
 */
export interface RepairVocabularyRule {
  /** Global, so EVERY occurrence is replaced — not just the first. */
  readonly pattern: RegExp;
  /** Neutral plain English. NEVER a placeholder or bracketed token. */
  readonly replacement: string;
}

/**
 * ORDER IS LOAD-BEARING for the two compound forms only: `Σ|mean|` is listed
 * before its own two halves so it renders as one phrase rather than as the
 * concatenation of two independent substitutions.
 */
export const REPAIR_VOCABULARY_RULES: ReadonlyArray<RepairVocabularyRule> = Object.freeze([
  { pattern: /Σ\s*\|mean\|/gi, replacement: 'the total of the average values' },
  { pattern: /\|mean\|/gi, replacement: 'the average value' },
  { pattern: /\bsum=/gi, replacement: 'total ' },
  { pattern: /BUDGET_TARGET/g, replacement: 'the budget target' },
  { pattern: /\[INBOUND_[A-Z0-9_]*\]?/g, replacement: 'an internal adjustment' },
  { pattern: /\[BRIDGE_[A-Z0-9_]*\]?/g, replacement: 'an internal adjustment' },
  { pattern: /\[STRENGTH_CLAMPED\]/g, replacement: 'an internal adjustment' },
  { pattern: /Σ/g, replacement: 'the total' },
  { pattern: /PLoT applied/gi, replacement: 'I made' },
]);

/**
 * Detection-only view of the same rules — DERIVED, never hand-maintained
 * (CLAUDE.md trap 12), so a rule added above cannot be missed here.
 *
 * The `g` flag is stripped on purpose: a global `RegExp` carries `lastIndex`
 * across calls, so `re.test(s)` alternates true/false for the same input and
 * a leak assertion built on it would pass every other time — an instrument
 * that cannot fail reliably is not evidence.
 */
export const REPAIR_VOCABULARY_DENYLIST: ReadonlyArray<RegExp> = Object.freeze(
  REPAIR_VOCABULARY_RULES.map(
    (rule) => new RegExp(rule.pattern.source, rule.pattern.flags.replace(/g/g, '')),
  ),
);

/**
 * The placeholder this module used to emit into user-facing prose. Exported
 * so the egress net in `compose/output-safety.ts` and its tests read the
 * same literal rather than each spelling it independently.
 */
export const FORBIDDEN_USER_FACING_REDACTION_MARKER = '[REDACTED]';

/**
 * Replace any banned-vocabulary substring in `text` with its neutral
 * plain-English equivalent. Returns `{ text, replacements }` so callers can
 * emit telemetry on non-zero replacement counts (a non-zero count is a signal
 * that upstream prompt or LLM behaviour leaked operator vocabulary into
 * user-facing prose — worth observing).
 *
 * Pure function; no I/O. Safe to call from any layer.
 */
export function enforceRepairVocabularyDenylist(
  text: string,
): { text: string; replacements: number } {
  let replacements = 0;
  let out = text;
  for (const rule of REPAIR_VOCABULARY_RULES) {
    // `String.replace` with a global pattern starts at index 0 and resets
    // `lastIndex` itself, so the shared frozen RegExp objects stay safe to
    // reuse across calls.
    out = out.replace(rule.pattern, () => {
      replacements += 1;
      return rule.replacement;
    });
  }
  return { text: out, replacements };
}
