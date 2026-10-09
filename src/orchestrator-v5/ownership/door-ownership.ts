import { AsyncLocalStorage } from 'node:async_hooks';
import { scenarioAccessDecision } from '../agent-lane/scenario-access.js';
import { currentTurnFenceSlot, type TurnFenceHandle } from '../session/turn-fence.js';
import { ANALYSIS_REREAD_TIMEOUT_MS } from '../session/analysis-read-deadline.js';
import { log } from '../../utils/telemetry.js';

type WriteRefusal = { reason: 'not_owner' | 'owner_unreadable'; scenarioId: string; fence?: Readonly<TurnFenceHandle> };
interface WriteCallerContext {
  userId: string | null;
  verified: boolean;
  refusal?: WriteRefusal;
  successfulDoorEntries: number;
  parent?: WriteCallerContext;
}
const writeCallerStorage = new AsyncLocalStorage<WriteCallerContext>();
const requestContexts = new WeakMap<object, WriteCallerContext>();
function writeContext(request?: object): WriteCallerContext | undefined {
  return request === undefined ? writeCallerStorage.getStore() : requestContexts.get(request);
}

// Reuse the existing bounded session-read budget; owner lookup is one database read.
export const OWNER_READ_TIMEOUT_MS = ANALYSIS_REREAD_TIMEOUT_MS;
export const MODEL_WRITE_OWNERSHIP_REFUSAL_BODY = Object.freeze({
  not_owner: Object.freeze({ error: 'model_write_ownership_refused' as const,
    message: "Nothing was saved. You don't have access to change this model." }),
  owner_unreadable: Object.freeze({ error: 'model_write_ownership_refused' as const,
    message: "Nothing was saved. I couldn't check access to this model. Try again." }),
});

export function readWriteRefusal(request?: object): Readonly<WriteRefusal> | undefined {
  return writeContext(request)?.refusal;
}
export function readSuccessfulDoorEntries(request?: object): number {
  return writeContext(request)?.successfulDoorEntries ?? 0;
}

/** Bind the admitted caller to the request's awaited writers, without signature threading. */
export function bindWriteCaller<T>(caller: { userId: string | null; verified: boolean }, done: () => T, request?: object): T {
  const context: WriteCallerContext = { ...caller, successfulDoorEntries: 0, parent: writeCallerStorage.getStore() };
  if (request !== undefined) requestContexts.set(request, context);
  return writeCallerStorage.run(context, done);
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
  const context = writeCallerStorage.getStore();
  const succeed = () => {
    // Effects aggregate through a composition; refusal latches stay local.
    for (let entry = context; entry !== undefined; entry = entry.parent) entry.successfulDoorEntries += 1;
  };
  if (typeof store.getScenarioOwner !== 'function') { succeed(); return; }
  const caller = context ?? { userId: null, verified: false };
  const refuse = (reason: ModelWriteOwnershipRefused['reason']): never => {
    const slot = currentTurnFenceSlot();
    if (context) context.refusal ??= { reason, scenarioId,
      ...(slot?.handle && slot.scenarioId === scenarioId ? { fence: { ...slot.handle } } : {}),
    };
    log.warn({ event: 'model_write.ownership_refused', site, reason, scenario_id_prefix: scenarioId.slice(0, 8) },
      'Model write ownership refused');
    throw new ModelWriteOwnershipRefused(reason);
  };
  let owner: string | null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // As with the canonical session reread, race even non-cancellable readers.
    // Late resolutions/rejections have handlers but cannot reopen this door.
    owner = await Promise.race([
      store.getScenarioOwner(scenarioId),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Owner read deadline exceeded')), OWNER_READ_TIMEOUT_MS);
      }),
    ]);
  } catch { return refuse('owner_unreadable'); }
  finally { clearTimeout(timer); }
  if (scenarioAccessDecision(owner, caller.verified ? caller.userId : null) !== 'allow') refuse('not_owner');
  succeed();
}
