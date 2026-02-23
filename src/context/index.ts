/**
 * Context Module
 *
 * Provides structured request context for authentication and telemetry,
 * as well as market context for LLM-first extraction.
 *
 * @example
 * ```typescript
 * import { getCallerContext, CallerContext } from './context/index.js';
 * import { resolveContext, ResolvedContext } from './context/index.js';
 * ```
 */

// Caller context (authentication, telemetry)
export {
  type CallerContext,
  type CallerTelemetry,
  CallerContextError,
  getCallerContext,
  requireCallerContext,
  attachCallerContext,
  createTestContext,
  contextToTelemetry,
} from './caller.js';

// Market context (LLM-first extraction)
export {
  // Types
  type GlossaryTerm,
  type ConstraintPattern,
  type MarketContext,
  type ResolvedContext,
  type SupportedDomain,
  type HallucinationValidationResult,
  type ExtractionSource,
  type ExtractionProvenance,
  SUPPORTED_DOMAINS,
  // Schemas
  GlossaryTermSchema,
  ConstraintPatternSchema,
  MarketContextSchema,
} from './types.js';

export {
  // Context loading
  loadContext,
  clearContextCache,
  // Domain detection
  detectDomain,
  // Resolution
  resolveContext,
  // Prompt formatting
  formatGlossaryForPrompt,
  formatConstraintsForPrompt,
  formatContextForPrompt,
  // Validation
  extractNumericValues,
  validateAgainstBrief,
  // Alias matching
  findTermByAlias,
  expandAbbreviation,
} from './resolver.js';

// ContextPack v1 (Stream C — deterministic context identity)
export {
  type Capability,
  type RetrievalMode,
  type ContextPackV1,
  type CacheBoundary,
  type ClarificationAnswer,
  type RelevantConfig,
  type AssembleContextPackInput,
  computeHash,
  computeStringHash,
  hashClarificationAnswers,
  hashConfig,
  hashPromptContent,
  computeCacheBoundary,
  assembleContextPack,
} from './context-pack.js';
