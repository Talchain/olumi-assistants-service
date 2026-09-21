/**
 * D1 handler error type. Wraps validator-style codes the validator can't
 * surface (because the structural validator runs before the graph is
 * threaded, or because the failure is intrinsic to a parsed-but-malformed
 * value like a missing `from→to` arrow on an edge id). Caught at the
 * handler boundary in turn-executor and mapped to HandlerInvocationFailed.
 */

export type D1ErrorCode =
  | 'PARAMETER_INVALID'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_KIND_MISMATCH'
  | 'PRECONDITION_UNMET'
  | 'GRAPH_INVARIANT_VIOLATED';

export class D1HandlerError extends Error {
  readonly code: D1ErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly userGuidance?: string;

  constructor(
    code: D1ErrorCode,
    message: string,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly userGuidance?: string;
    },
  ) {
    super(message);
    this.name = 'D1HandlerError';
    this.code = code;
    if (options?.details) this.details = options.details;
    if (options?.userGuidance) this.userGuidance = options.userGuidance;
  }
}
