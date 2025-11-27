/**
 * Context Module
 *
 * Provides structured request context for authentication and telemetry.
 *
 * @example
 * ```typescript
 * import { getCallerContext, CallerContext } from './context/index.js';
 * ```
 */

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
