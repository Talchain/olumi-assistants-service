import { ModelVersionSignInRequiredError } from '../../src/orchestrator-v5/model-management/store-adapter.js';
import { SIGN_IN_REQUIRED_MESSAGE } from '../../src/orchestrator-v5/model-management/types.js';

/** Route outcome-spy seam: preserve the real service's guest refusal mapping. */
export async function modelVersionDoorOutcome<T>(run: () => Promise<T>) {
  try { return await run(); }
  catch (err) {
    if (err instanceof ModelVersionSignInRequiredError) return { status: 'error' as const, error: {
      code: 'sign_in_required' as const, recoverable: true, message: SIGN_IN_REQUIRED_MESSAGE,
    } };
    throw err;
  }
}
