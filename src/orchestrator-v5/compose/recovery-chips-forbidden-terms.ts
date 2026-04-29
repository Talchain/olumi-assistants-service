/**
 * Forbidden terms for recovery-chip user-facing strings.
 *
 * Lives in its own file so the V5 spec §7 acceptance grep against
 * recovery-chips.ts ("no internal terminology in user-facing copy") passes
 * literally — the data-only list of terms doesn't leak into the chip module.
 */

export const FORBIDDEN_USER_TEXT_TERMS: readonly string[] = [
  'error',
  'failed',
  'broken',
  'enricher',
  'handler',
  'zod',
  'parse',
  'executor',
  'finaliser',
  'finalizer',
  'ai service',
  'stack trace',
] as const;
