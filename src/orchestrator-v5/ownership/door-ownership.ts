import { AsyncLocalStorage } from 'node:async_hooks';
import { scenarioAccessDecision } from '../agent-lane/scenario-access.js';
import { log } from '../../utils/telemetry.js';

const writeCallerStorage = new AsyncLocalStorage<{ userId: string | null; verified: boolean }>();

/** Bind the admitted caller to the request's awaited writers, without signature threading. */
export function bindWriteCaller<T>(caller: { userId: string | null; verified: boolean }, done: () => T): T {
  return writeCallerStorage.run(caller, done);
}

export class ModelWriteOwnershipRefused extends Error {
  readonly code = 'model_write_ownership_refused';
  constructor(readonly reason: 'not_owner' | 'owner_unreadable') {
    super('Model write ownership refused');
    this.name = 'ModelWriteOwnershipRefused';
  }
}

/** One owner read per door entry, including sidecar-only writes and writes outside a request. */
/** Only the owner reader is needed; a structural port keeps the session store out of this module. */
type OwnerReader = { getScenarioOwner?(scenarioId: string): Promise<string | null> };

export async function assertDoorOwnership(store: OwnerReader, scenarioId: string, site?: string): Promise<void> {
  // Stores without this port model no ownership; production's port is pinned by a test.
  if (typeof store.getScenarioOwner !== 'function') return;
  const caller = writeCallerStorage.getStore() ?? { userId: null, verified: false };
  const refuse = (reason: ModelWriteOwnershipRefused['reason']): never => {
    log.warn({ event: 'model_write.ownership_refused', site, reason, scenario_id_prefix: scenarioId.slice(0, 8) },
      'Model write ownership refused');
    throw new ModelWriteOwnershipRefused(reason);
  };
  let owner: string | null;
  try { owner = await store.getScenarioOwner(scenarioId); }
  catch { return refuse('owner_unreadable'); }
  if (scenarioAccessDecision(owner, caller.verified ? caller.userId : null) !== 'allow') refuse('not_owner');
}
