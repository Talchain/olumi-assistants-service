/**
 * V5 handler registry (slice C1).
 *
 * Every turn with `turn_class === 'handler'` is routed through this registry.
 * Slice C1 ships with ZERO handlers registered by design — dispatch lookups
 * miss, `UnhandledTurnClassError(reason='handler_not_registered')` is raised,
 * and the turn-executor UNHANDLED catch maps to INTERNAL_ERROR on the wire.
 * Slice C2 will register `run_analysis` against this surface.
 *
 * ## Shape
 *
 * `HandlerInvocation` carries everything a handler needs:
 *   - `context`: the fully-built `TurnContext` from build-turn-context.ts,
 *     including prior_turns populated from the session store (Slice B).
 *   - `payload`: the raw OrchestratorTurnPayload from the route entry — the
 *     user's message and stage, useful for handlers whose behaviour depends
 *     on the input beyond what TurnContext exposes.
 *   - `requestId`: the per-turn UUID, used for log correlation and as the
 *     client-generated `turn_id` when the handler's outcome is committed.
 *   - `signal`: the AbortSignal that fires when the outer turn budget
 *     (`budgets.turn_ms`) exceeds. See AbortSignal chain below.
 *
 * `HandlerOutcome` mirrors the A2 narrate/clarify result shape + Slice B
 * commit metadata:
 *   - `assistant_text`: the user-facing narration for the OlumiResponse.
 *   - `handler_facts`: typed evidence persisted in v5_handler_facts. Slice B
 *     accepts these through `append_turn_atomic`; Slice C1 never populates.
 *   - `llm_calls_used`: incremental count of LLM calls the handler made.
 *     Turn-executor adds this to the classifier call (always 1) for the
 *     total `llm_calls_used` reported in `turn_executor.completed` telemetry.
 *
 * ## AbortSignal chain (refinement request from Paul 2026-04-18)
 *
 * The `signal` passed into `HandlerInvocation` is NOT a new construct; it is
 * the SAME AbortSignal that bounds classifier and narrate calls in A2. The
 * chain, from outermost to innermost:
 *
 *   1. `turn-executor.ts`:
 *        `const turnAbort = new AbortController();`
 *        `const turnTimer = setTimeout(() => turnAbort.abort(), context.budgets.turn_ms);`
 *      This AbortController fires when the wall-clock TURN_BUDGET_MS elapses.
 *
 *   2. `turn-executor.ts` passes `turnAbort.signal` to `dispatch(context, { signal })`.
 *
 *   3. `dispatch.ts` branches on `turn_class`:
 *        - 'direct_answer' / 'clarify': signal forwarded to `invokeNarrate(..., signal)`,
 *          which wraps a FRESH `LLM_BUDGET_NARRATE_MS` inner controller around it.
 *        - 'handler' (C1+): signal forwarded directly into `HandlerInvocation.signal`.
 *
 *   4. Handlers MAY layer a fresh `LLM_BUDGET_HANDLER_MS` inner controller on
 *      top of `signal` for per-handler bounded awaits. They MUST propagate
 *      the outer abort (wrap, not replace). A child controller that forgets
 *      to listen to the outer signal creates a handler that runs past the
 *      turn budget — Paul's constraint 7 violation.
 *
 * Paul's constraint 7 (A1): BUDGET_EXCEEDED wins over LLM_TIMEOUT when both
 * apply. `turn-executor.ts` inspects `turnAbort.signal.aborted` before
 * mapping any inner timeout error — a handler whose inner LLM call errors
 * out because the outer budget fired still classifies as BUDGET_EXCEEDED, not
 * HANDLER_INVOCATION_FAILED.
 *
 * ## Registry shape
 *
 * `ReadonlyMap<V5ActionType, HandlerFn>` — typed lookup keyed by the 7
 * canonical V5 action types. A `Map` (rather than `Record`) gives explicit
 * miss semantics via `.get() === undefined` and preserves insertion order
 * for telemetry iteration. The readonly modifier prevents accidental
 * mutation from outside the module.
 *
 * `EMPTY_HANDLER_REGISTRY` is the canonical empty registry used by C1.
 * Slice C2 will export a populated registry (still immutable post-
 * initialisation).
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type {
  HandlerFact,
  TurnContext,
  V5ActionType,
} from '@talchain/schemas/orchestrator';

import { createPLoTClient, type PLoTClient } from '../../orchestrator/plot-client.js';

import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from './handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';

// Re-exported for the chip-click dispatch path. The handler-ownership
// invariant ([scripts/validate-handler-ownership.sh]) restricts direct
// imports of `tools/handlers/run-analysis` to this file. Chip-click
// dispatch needs `ScenarioReader` + `RunAnalysisScenarioSnapshot` to
// inject a one-shot reader (single-source-of-truth snapshot wiring);
// re-exporting from the sanctioned surface satisfies the invariant.
export type { ScenarioReader, RunAnalysisScenarioSnapshot };

/**
 * Input to a handler invocation. Populated by dispatch.ts from the same
 * sources it hands to invokeNarrate for direct_answer / clarify, plus the
 * AbortSignal that bounds the turn.
 */
export interface HandlerInvocation {
  readonly context: TurnContext;
  // v0.7.0: handlers only fire on message-kind turns (system events
  // bypass the handler registry entirely via route-v2's deterministic branch).
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

/**
 * What a handler returns on success. Throws on failure — turn-executor
 * catches and maps to HANDLER_INVOCATION_FAILED (for generic errors) or
 * HANDLER_RESULT_INVALID (for Zod-parse-failure on the returned shape).
 */
export interface HandlerOutcome {
  readonly assistant_text: string;
  readonly handler_facts: readonly HandlerFact[];
  readonly llm_calls_used: number;
}

export type HandlerFn = (invocation: HandlerInvocation) => Promise<HandlerOutcome>;

export type HandlerRegistry = ReadonlyMap<V5ActionType, HandlerFn>;

/**
 * The canonical empty registry. Kept for tests that want to exercise the
 * "handler class emitted, no handler registered" path (registry miss →
 * `UnhandledTurnClassError('handler_not_registered')` → INTERNAL_ERROR).
 *
 * Production dispatch uses `getDefaultRegistry()` instead; Slice C2 populates
 * it with `run_analysis`.
 */
export const EMPTY_HANDLER_REGISTRY: HandlerRegistry = new Map();

/**
 * Optional dependency overrides for `createRegistry()`. Tests supply mocks
 * to isolate from real PLoT and real Supabase. Production omits overrides
 * and the factory resolves defaults via `createPLoTClient()` plus a
 * "not-yet-wired" scenario reader (see §ScenarioReader wiring below).
 */
export interface RegistryOverrides {
  readonly plotClient?: PLoTClient;
  readonly scenarioReader?: ScenarioReader;
}

/**
 * Placeholder scenario reader used when no reader is injected. Calling it
 * throws a clear "not wired" error — the `run_analysis` handler will then
 * wrap it as `HandlerInvocationFailedError('scenario_read_failed')` and
 * emit a typed failure envelope. This keeps the contract stable: tests
 * always inject a reader; a later slice wires a production Supabase-backed
 * reader through the same `RegistryOverrides` seam.
 *
 * The error message is deliberately explicit so production logs pinpoint
 * the missing wiring rather than surfacing a generic `TypeError`.
 */
const DEFAULT_SCENARIO_READER: ScenarioReader = (scenarioId) => {
  return loadScenarioSnapshotForRunAnalysis(scenarioId, `run_analysis:${scenarioId}`);
};

/**
 * Construct a populated `HandlerRegistry`. Slice C2 registers `run_analysis`
 * against the injected (or defaulted) dependencies.
 *
 * Tests call this with mocks to get a fresh, isolated registry. Production
 * calls `getDefaultRegistry()` which memoises one instance for the process.
 *
 * Guard rail: handlers MUST be imported from `./handlers/` — no inline
 * handler definitions in this module. D9's invariant script enforces.
 */
export function createRegistry(overrides?: RegistryOverrides): HandlerRegistry {
  const plotClient =
    overrides?.plotClient ?? resolvePlotClient();
  const scenarioReader = overrides?.scenarioReader ?? DEFAULT_SCENARIO_READER;

  const runAnalysis = createRunAnalysisHandler({ plotClient, scenarioReader });

  return new Map<V5ActionType, HandlerFn>([['run_analysis', runAnalysis]]);
}

function resolvePlotClient(): PLoTClient {
  const client = createPLoTClient();
  if (!client) {
    // ISL_BASE_URL / PLoT endpoint not configured. Return a stub that fails
    // on first .run() call rather than throwing at module-load time —
    // keeps `getDefaultRegistry()` safe to call in dev shells where PLoT
    // isn't wired (e.g. local smoke tests of the non-handler paths).
    return {
      run: () =>
        Promise.reject(
          new Error(
            'PLoT client not configured (ISL_BASE_URL missing); cannot invoke run_analysis',
          ),
        ),
      validatePatch: () =>
        Promise.reject(
          new Error('PLoT client not configured (ISL_BASE_URL missing)'),
        ),
    };
  }
  return client;
}

let defaultRegistryCache: HandlerRegistry | undefined;

/**
 * Lazy singleton: the production `HandlerRegistry`. First call constructs
 * it with default dependencies; subsequent calls return the same instance.
 * Tests that want a fresh registry use `createRegistry({...})` instead.
 *
 * Not exported as a `const` because dep resolution (createPLoTClient())
 * reads env variables that the test runner may set AFTER module import.
 * Lazy evaluation avoids capturing stale env at load time.
 */
export function getDefaultRegistry(): HandlerRegistry {
  if (!defaultRegistryCache) {
    defaultRegistryCache = createRegistry();
  }
  return defaultRegistryCache;
}

/**
 * Typed lookup. Returns the `HandlerFn` for `handlerId` if registered,
 * else `null`. Callers (dispatch.ts) branch on the null to decide
 * between invoking the handler and raising the not-registered error.
 *
 * The function never mutates the registry. C2 registers `run_analysis`;
 * later slices (D1/D2) produce new Maps via `createRegistry` with richer
 * dependencies rather than mutating a shared instance. This keeps the
 * "registry immutable after construction" contract visible in the type.
 */
export function resolveHandler(
  registry: HandlerRegistry,
  handlerId: V5ActionType,
): HandlerFn | null {
  return registry.get(handlerId) ?? null;
}
