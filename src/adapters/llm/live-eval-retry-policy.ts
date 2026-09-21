import {
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from '../../utils/retry.js';

/**
 * Process-local safety mode for a deliberately paid live evaluator.
 *
 * Production has no active scope and retains both retry layers byte-for-byte.
 * The canonical-precedence CLI opens one only after its double opt-in and clean
 * git checks, then restores the prior value. It turns one routing adapter
 * invocation into exactly one provider HTTP attempt at the two supported
 * tool-use adapters: repository retries use one attempt and SDK retries use 0.
 */
let activeScopes = 0;

/** Begin one process-local evaluator scope and return an idempotent release. */
export function beginLiveEvalSingleAttempt(): () => void {
  activeScopes += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeScopes = Math.max(0, activeScopes - 1);
  };
}

export function isLiveEvalSingleAttempt(): boolean {
  return activeScopes > 0;
}

/** `undefined` preserves the SDK's production default. */
export function sdkMaxRetriesForLiveEval(): 0 | undefined {
  return isLiveEvalSingleAttempt() ? 0 : undefined;
}

/** `undefined` preserves the repository retry helper's production default. */
export function retryConfigForLiveEval(): RetryConfig | undefined {
  return isLiveEvalSingleAttempt()
    ? { ...DEFAULT_RETRY_CONFIG, maxAttempts: 1 }
    : undefined;
}
