/**
 * Golden-Journey Harness v1 — in-memory SessionStore test double.
 *
 * Implements the full `SessionStore` interface so `buildTurnContext` can run
 * in-process with ZERO Supabase access — this is what lets the A2
 * (AI-facing context completeness) assertion be proven without booting the
 * service or touching the network. Only the read methods on the
 * `buildTurnContext` path carry real behaviour; the write/invalidation
 * methods are inert (the harness never mutates through this store).
 */

import { randomUUID } from 'node:crypto';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type {
  SessionStore,
  SessionTurnWrite,
} from '../../../src/orchestrator-v5/session/store.js';
import type { SessionTurnWithContent } from '../../../src/orchestrator-v5/session/conversation-content.js';
import type { HandlerFactWithTurn } from '../../../src/orchestrator-v5/types/handler-fact.js';
import type { PendingAction } from '../../../src/orchestrator-v5/session/pending-action.js';
import type {
  InvalidationResult,
  InvalidationScope,
} from '../../../src/orchestrator-v5/session/invalidation.js';

export interface SeedTurn {
  readonly user_message: string;
  readonly assistant_message: string;
  readonly turn_class?: 'direct_answer' | 'clarify' | 'handler' | 'unhandled';
}

export interface InMemorySeed {
  readonly scenarioId: string;
  readonly graph: unknown;
  readonly briefText?: string | null;
  /** Oldest-first; the store returns them newest-first to mirror Supabase. */
  readonly turns?: readonly SeedTurn[];
  readonly facts?: readonly HandlerFact[];
  readonly pendingActions?: readonly PendingAction[];
}

/** A schema-shaped SessionTurnWithContent row built from a seed. */
function buildTurn(scenarioId: string, seed: SeedTurn, index: number): SessionTurnWithContent {
  const turnClass = seed.turn_class ?? 'direct_answer';
  return {
    id: randomUUID(),
    scenario_id: scenarioId,
    user_id: null,
    turn_id: `seed-${index}`,
    turn_class: turnClass,
    handler_id: null,
    request_hash: `hash-${index}`,
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 10,
    created_at: new Date(Date.UTC(2026, 5, 21, 9, 0, index)).toISOString(),
    user_message: seed.user_message,
    assistant_message: seed.assistant_message,
  };
}

export class InMemorySessionStore implements SessionStore {
  private readonly scenarioId: string;
  private graph: unknown;
  private readonly briefText: string | null;
  /** Oldest-first internally. */
  private readonly turns: SessionTurnWithContent[];
  private readonly factsByTurnId = new Map<string, HandlerFact[]>();
  private readonly allFacts: HandlerFact[];
  private readonly pendingActions: readonly PendingAction[];

  constructor(seed: InMemorySeed) {
    this.scenarioId = seed.scenarioId;
    this.graph = seed.graph;
    this.briefText = seed.briefText ?? null;
    this.turns = (seed.turns ?? []).map((t, i) => buildTurn(seed.scenarioId, t, i));
    this.allFacts = [...(seed.facts ?? [])];
    this.pendingActions = seed.pendingActions ?? [];
    // Attribute all seeded facts to the most recent turn (newest), if any.
    const newest = this.turns[this.turns.length - 1];
    if (newest) this.factsByTurnId.set(newest.id, [...this.allFacts]);
  }

  async append(write: SessionTurnWrite): Promise<{ id: string }> {
    const id = randomUUID();
    this.turns.push({
      id,
      scenario_id: write.scenario_id,
      user_id: null,
      turn_id: write.turn_id,
      turn_class: write.turn_class,
      handler_id: write.handler_id,
      request_hash: write.request_hash,
      response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used,
      duration_ms: write.duration_ms,
      created_at: new Date(Date.UTC(2026, 5, 21, 9, 30, this.turns.length)).toISOString(),
      user_message: write.userMessage ?? null,
      assistant_message: write.assistantMessage ?? null,
    });
    if (write.graph !== undefined) this.graph = write.graph;
    if (write.handler_facts.length > 0) this.factsByTurnId.set(id, [...write.handler_facts]);
    return { id };
  }

  async readRecent(_scenarioId: string, limit = 20): Promise<readonly SessionTurnWithContent[]> {
    // Newest-first, mirroring Supabase `created_at DESC`.
    return [...this.turns].reverse().slice(0, limit);
  }

  async readFactsFor(rowIds: readonly string[]): Promise<readonly HandlerFact[]> {
    return rowIds.flatMap((id) => this.factsByTurnId.get(id) ?? []);
  }

  async readFactsWithTurnFor(rowIds: readonly string[]): Promise<readonly HandlerFactWithTurn[]> {
    const out: HandlerFactWithTurn[] = [];
    for (const id of rowIds) {
      const turn = this.turns.find((t) => t.id === id);
      for (const fact of this.factsByTurnId.get(id) ?? []) {
        out.push({
          ...(fact as object),
          v5_conversation_turn_id: id,
          fact_created_at: turn?.created_at ?? new Date(Date.UTC(2026, 5, 21, 9, 0, 0)).toISOString(),
        } as unknown as HandlerFactWithTurn);
      }
    }
    return out;
  }

  async invalidateScoped(_scenarioId: string, _scope: InvalidationScope): Promise<InvalidationResult> {
    return {} as unknown as InvalidationResult;
  }

  async invalidateAll(_scenarioId: string): Promise<InvalidationResult> {
    return {} as unknown as InvalidationResult;
  }

  async storeDraftGraph(_scenarioId: string, graph: unknown): Promise<void> {
    this.graph = graph;
  }

  async loadGraph(_scenarioId: string): Promise<unknown | null> {
    return this.graph ?? null;
  }

  async loadGraphAndBriefText(
    _scenarioId: string,
  ): Promise<{ readonly graph: unknown | null; readonly briefText: string | null }> {
    return { graph: this.graph ?? null, briefText: this.briefText };
  }

  async ensureScenarioExists(
    _scenarioId: string,
    userId: string | null,
  ): Promise<{ user_id: string | null }> {
    return { user_id: userId };
  }

  async readMostRecentPendingActions(_scenarioId: string): Promise<readonly PendingAction[]> {
    return this.pendingActions;
  }

  async readMostRecentCoachingState(): Promise<null> {
    return null;
  }

  async hasPriorTurns(_scenarioId: string): Promise<boolean> {
    return this.turns.length > 0;
  }
}
