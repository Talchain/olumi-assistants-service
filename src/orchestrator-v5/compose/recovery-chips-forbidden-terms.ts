/**
 * Forbidden terms for recovery-chip user-facing strings.
 *
 * Lives in its own file so the V5 spec §7 acceptance grep against
 * recovery-chips.ts ("no internal terminology in user-facing copy") passes
 * literally — the data-only list of terms doesn't leak into the chip module.
 *
 * The data itself moved to `src/orchestrator/shared/forbidden-tokens.ts` so
 * the enrichment scrubber (`src/orchestrator-v5/compose/sanitise-enrichment.ts`)
 * can share the same vocabulary without a V4→V5 dependency edge. This file
 * re-exports for backward compatibility — every existing callsite keeps its
 * import path unchanged.
 */

export { FORBIDDEN_USER_TEXT_TERMS } from '../../orchestrator/shared/forbidden-tokens.js';
