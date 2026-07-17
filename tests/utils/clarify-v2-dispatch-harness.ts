/**
 * Clarify v2 — SHARED dispatch-level test harness (ROADMAP 1.152 item g).
 *
 * Drives the REAL `tryClarifyV2Turn` (handlers/clarify-v2-dispatch.ts) with
 * a controllable session store underneath the REAL commit chokepoint
 * (`commitDirectAnswer` runs for real — carry-forward, supersession,
 * F-HELD lapse notices and all). This is the one place the dispatch-level
 * behavioural pins for the #497 mechanical fixes (A5-A8) and the 1.152
 * design fixes (A1-A4, A9) plug in; the route-level suite
 * (src/orchestrator/__tests__/route-v2-clarify-v2.test.ts) stays the
 * authority for route WIRING (flag gate, sendFinalised200, draft
 * dispatch threading), while this harness pins the dispatch CONTRACT.
 *
 * Capabilities (per the 1.152 lane spec):
 *   - seeded clarify pendings        → `clarifyV2Harness.seededPendings`
 *   - store-failure injection        → `pendingsReadError` /
 *                                      `persistedStateReadError`
 *   - commit-failure injection       → `commitError` (append throws)
 *   - wire-response capture          → the returned `outcome` IS the wire
 *                                      contract; `appends` captures every
 *                                      persisted turn write; `events`
 *                                      captures every telemetry emit.
 *
 * WIRING (vi.mock factories are hoisted, so the test file owns the call —
 * same convention as tests/utils/mock-session-store.ts):
 *
 *   vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
 *     const original = await importOriginal<
 *       typeof import('../../src/orchestrator-v5/session/index.js')
 *     >();
 *     const { buildHarnessSessionStore } = await import(
 *       '../utils/clarify-v2-dispatch-harness.js'
 *     );
 *     return {
 *       ...original,
 *       getSessionStore: () => buildHarnessSessionStore(),
 *       resetSessionStoreForTests: () => {},
 *     };
 *   });
 *
 * Derive-don't-mirror: the store double comes from
 * `createMockSessionStore` (typechecked against the REAL SessionStore
 * interface), and the module factory spreads `importOriginal` so real
 * exports (`SessionReadError`, …) stay real.
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import type { PendingAction } from '../../src/orchestrator-v5/session/pending-action.js';
import type { SessionStore } from '../../src/orchestrator-v5/session/store.js';
import type { ClarifyV2Outcome } from '../../src/orchestrator-v5/handlers/clarify-v2-dispatch.js';
import {
  DRAFT_GRAPH_DECISION_BRIEF_REGEX,
  DRAFT_GRAPH_MIN_BRIEF_LENGTH,
} from '../../src/schemas/assist.js';
import { createMockSessionStore } from './mock-session-store.js';

export const HARNESS_SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
export const HARNESS_TURN_ID = '66666666-6666-4666-8666-666666666666';
export const HARNESS_REQUEST_ID = 'clarify-v2-harness-request';

/** One captured `SessionStore.append` write (the persisted turn row). */
export type CapturedTurnWrite = Record<string, unknown>;

export interface CapturedTelemetryEvent {
  readonly name: string;
  readonly data: Record<string, unknown>;
}

interface ClarifyV2HarnessState {
  /** Pendings the store returns on `readMostRecentPendingActions`. */
  seededPendings: readonly PendingAction[];
  /** When set, `readMostRecentPendingActions` THROWS it (A6 probe). */
  pendingsReadError: Error | null;
  /** Persisted graph returned by `loadGraphAndBriefText`. */
  persistedGraph: unknown | null;
  /** Persisted brief_text returned by `loadGraphAndBriefText`. */
  persistedBriefText: string | null;
  /** When set, `loadGraphAndBriefText` THROWS it (post-draft-guard probe). */
  persistedStateReadError: Error | null;
  /** When set, `append` THROWS it (commit-failure injection, A8 probe). */
  commitError: Error | null;
  /** Every successful `append` write, in call order. */
  appends: CapturedTurnWrite[];
  /** Every telemetry emit while the harness sink is installed. */
  events: CapturedTelemetryEvent[];
}

export const clarifyV2Harness: ClarifyV2HarnessState = {
  seededPendings: [],
  pendingsReadError: null,
  persistedGraph: null,
  persistedBriefText: null,
  persistedStateReadError: null,
  commitError: null,
  appends: [],
  events: [],
};

/**
 * Complete SessionStore double bound to the mutable harness state. Built
 * fresh per `getSessionStore()` call; all calls observe the same state.
 */
export function buildHarnessSessionStore(): SessionStore {
  return createMockSessionStore({
    readMostRecentPendingActions: async () => {
      if (clarifyV2Harness.pendingsReadError !== null) {
        throw clarifyV2Harness.pendingsReadError;
      }
      return clarifyV2Harness.seededPendings;
    },
    loadGraphAndBriefText: async () => {
      if (clarifyV2Harness.persistedStateReadError !== null) {
        throw clarifyV2Harness.persistedStateReadError;
      }
      return {
        graph: clarifyV2Harness.persistedGraph,
        briefText: clarifyV2Harness.persistedBriefText,
      };
    },
    append: async (write) => {
      if (clarifyV2Harness.commitError !== null) {
        throw clarifyV2Harness.commitError;
      }
      clarifyV2Harness.appends.push(write as unknown as CapturedTurnWrite);
      return { id: 'harness-row-id' };
    },
  });
}

/**
 * Reset all controls + captures and (re)install the telemetry test sink.
 * Call from `beforeEach`. Async because the sink installs through the
 * real telemetry module.
 */
export async function resetClarifyV2Harness(): Promise<void> {
  clarifyV2Harness.seededPendings = [];
  clarifyV2Harness.pendingsReadError = null;
  clarifyV2Harness.persistedGraph = null;
  clarifyV2Harness.persistedBriefText = null;
  clarifyV2Harness.persistedStateReadError = null;
  clarifyV2Harness.commitError = null;
  clarifyV2Harness.appends = [];
  clarifyV2Harness.events = [];
  const telemetry = await import('../../src/utils/telemetry.js');
  telemetry.setTestSink((name, data) => {
    clarifyV2Harness.events.push({ name, data: data as Record<string, unknown> });
  });
}

export interface RunClarifyV2Options {
  readonly message: string;
  /**
   * The route's brief-shape verdict for this turn. Defaults to the
   * route's OWN predicate (length + decision regex) computed over
   * `message`, so harness runs mirror live routing unless a test
   * explicitly overrides.
   */
  readonly draftShaped?: boolean;
  /** Server-assembled explicit-generate brief; null = not a generate turn. */
  readonly explicitGenerateBrief?: string | null;
  readonly payloadOverrides?: Record<string, unknown>;
}

export interface ClarifyV2RunResult {
  readonly outcome: ClarifyV2Outcome | null;
  readonly appends: readonly CapturedTurnWrite[];
  readonly events: readonly CapturedTelemetryEvent[];
}

/** Drive the REAL tryClarifyV2Turn once against the current harness state. */
export async function runClarifyV2Turn(
  opts: RunClarifyV2Options,
): Promise<ClarifyV2RunResult> {
  const { tryClarifyV2Turn } = await import(
    '../../src/orchestrator-v5/handlers/clarify-v2-dispatch.js'
  );
  const payload = {
    kind: 'message',
    turn_id: HARNESS_TURN_ID,
    scenario_id: HARNESS_SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message: opts.message,
    source: 'composer',
    ...(opts.payloadOverrides ?? {}),
  } as unknown as MessageTurnPayload;
  const outcome = await tryClarifyV2Turn({
    payload,
    requestId: HARNESS_REQUEST_ID,
    draftShaped:
      opts.draftShaped ??
      (opts.message.length >= DRAFT_GRAPH_MIN_BRIEF_LENGTH &&
        DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(opts.message)),
    explicitGenerateBrief: opts.explicitGenerateBrief ?? null,
  });
  return {
    outcome,
    appends: clarifyV2Harness.appends,
    events: clarifyV2Harness.events,
  };
}

/** A live `clarify_v2_round` pending, mirroring the dispatcher's emit shape. */
export function seedClarifyPending(
  brief: string,
  asked: readonly string[],
  round: number,
  overrides: Partial<PendingAction> = {},
): PendingAction {
  const now = Date.now();
  return {
    id: 'cv2_prior-turn',
    scenario_id: HARNESS_SCENARIO_ID,
    chip_id: 'cv2_proceed_default',
    action: { kind: 'clarify_v2_round', brief, asked_dimensions: asked, round },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: new Date(now + 60_000).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
    ...overrides,
  } as PendingAction;
}

/**
 * A live confirmation-expecting hold (`proposed_concept`) — the F-HELD
 * lapse-notice + hold-survival probe. `expires_at_turn_count: 1` makes it
 * lapse AT the next commit's carry-forward (the A7 on-the-wire probe);
 * pass a higher count for plain survival probes.
 */
export function seedProposedConceptHold(
  overrides: Partial<PendingAction> = {},
): PendingAction {
  const now = Date.now();
  return {
    id: 'pc_prior-turn',
    scenario_id: HARNESS_SCENARIO_ID,
    chip_id: 'pc_chip-1',
    action: {
      kind: 'proposed_concept',
      concept: 'a churn-risk factor',
      preferred_kind: 'factor',
      public_label: 'Add churn risk',
      public_message: 'Yes, add the churn-risk factor.',
    },
    preconditions: {},
    expires_at_turn_count: 3,
    expires_at_iso: new Date(now + 60_000).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
    ...overrides,
  } as PendingAction;
}
