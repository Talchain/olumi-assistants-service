/**
 * Daily token budget enforcement for LLM calls.
 *
 * In-memory map keyed by user key (JWT sub or IP fallback).
 * Lazy reset at midnight UTC.
 *
 * Budget is checked at the adapter boundary (before every LLM call),
 * not at the HTTP handler level. This catches multi-call flows that
 * exceed the budget mid-request.
 *
 * Fail-open: if budget tracking errors, a structured warning is logged
 * and the request proceeds.
 */

import type { FastifyRequest } from 'fastify';
import { extractJwtSub, resolveUserKey } from '../utils/jwt-extract.js';
import { getRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DAILY_TOKEN_BUDGET = Number(process.env.CEE_DAILY_TOKEN_BUDGET) || 500_000;
const BUDGET_ENABLED = (process.env.CEE_TOKEN_BUDGET_ENABLED ?? 'true') !== 'false';

/** Whether budget enforcement is enabled. */
export function isBudgetEnabled(): boolean {
  return BUDGET_ENABLED;
}

// ---------------------------------------------------------------------------
// Request context — richer than a simple user-key mapping
// ---------------------------------------------------------------------------

/** Per-request context stored for the duration of the request. */
export interface RequestContext {
  /** Bucket key for budget/rate-limit (prefixed, e.g. "sub:alice" or "ip:1.2.3.4") */
  userKey: string;
  /** Raw user identifier for llm_usage logs (JWT sub value or null) */
  userId: string | null;
  /** Scenario identifier from request body (orchestrator only, null otherwise) */
  scenarioId: string | null;
  /** Handler-level task name derived from URL path */
  task: string | null;
}

/** Request→context mapping — set in preHandler, read by adapter wrapper. Exported for testing. */
export const _requestContextMap = new Map<string, RequestContext>();

// ---------------------------------------------------------------------------
// In-memory budget store
// ---------------------------------------------------------------------------

interface BudgetEntry {
  tokens: number;
  resetAt: number;   // epoch ms — next midnight UTC
}

/** Daily token store — keyed by user key. Exported for testing. */
export const _budgetStore = new Map<string, BudgetEntry>();

/** Reset stores (testing only). */
export function _resetStores(): void {
  _budgetStore.clear();
  _requestContextMap.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Calculate milliseconds until midnight UTC. */
function msUntilMidnightUTC(now: number = Date.now()): number {
  const d = new Date(now);
  const midnight = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return midnight.getTime() - now;
}

/** Get next midnight UTC epoch ms. */
function nextMidnightUTC(now: number = Date.now()): number {
  return now + msUntilMidnightUTC(now);
}

/** Map URL path to canonical task name for llm_usage logs. */
function taskFromUrl(url: string): string | null {
  if (url.startsWith('/assist/v1/draft-graph')) return 'draft_graph';
  if (url.startsWith('/assist/v1/options')) return 'suggest_options';
  if (url.startsWith('/assist/v1/bias-check')) return 'bias_check';
  if (url.startsWith('/assist/v1/explain-graph')) return 'explain_graph';
  if (url.startsWith('/assist/v1/evidence-helper')) return 'evidence_helper';
  if (url.startsWith('/assist/v1/sensitivity-coach')) return 'sensitivity_coach';
  if (url.startsWith('/assist/v1/team-perspectives')) return 'team_perspectives';
  if (url.startsWith('/assist/v1/graph-readiness')) return 'graph_readiness';
  if (url.startsWith('/assist/v1/key-insight')) return 'key_insight';
  if (url.startsWith('/assist/v1/elicit-belief')) return 'elicit_belief';
  if (url.startsWith('/assist/v1/suggest-utility-weights')) return 'suggest_utility_weights';
  if (url.startsWith('/assist/v1/elicit-risk-tolerance')) return 'elicit_risk_tolerance';
  if (url.startsWith('/assist/v1/suggest-edge-function')) return 'suggest_edge_function';
  if (url.startsWith('/assist/v1/generate-recommendation')) return 'generate_recommendation';
  if (url.startsWith('/assist/v1/narrate-conditions')) return 'narrate_conditions';
  if (url.startsWith('/assist/v1/explain-policy')) return 'explain_policy';
  if (url.startsWith('/assist/v1/elicit-preferences')) return 'elicit_preferences';
  if (url.startsWith('/assist/v1/explain-tradeoff')) return 'explain_tradeoff';
  if (url.startsWith('/assist/v1/isl-synthesis')) return 'isl_synthesis';
  if (url.startsWith('/assist/v1/ask')) return 'ask';
  if (url.startsWith('/assist/v1/review')) return 'review';
  if (url.startsWith('/assist/v1/decision-review')) return 'decision_review';
  if (url.startsWith('/assist/v1/edit-graph')) return 'edit_graph';
  if (url.startsWith('/assist/v1/health')) return 'health';
  if (url.startsWith('/orchestrate/v1/turn')) return 'orchestrator';
  return null;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Register request context so the adapter wrapper can resolve
 * user key, userId, scenarioId, and task from a requestId.
 */
export function registerRequestContext(requestId: string, ctx: RequestContext): void {
  _requestContextMap.set(requestId, ctx);
}

/**
 * Remove the request context mapping (call in onResponse hook).
 */
export function unregisterRequestContext(requestId: string): void {
  _requestContextMap.delete(requestId);
}

/**
 * Get request context by requestId (returns undefined if not registered).
 */
export function getRequestContext(requestId: string): RequestContext | undefined {
  return _requestContextMap.get(requestId);
}

/**
 * Check whether the user has exceeded their daily token budget.
 * Returns remaining tokens and whether the budget is exceeded.
 */
export function checkBudget(userKey: string, now: number = Date.now()): {
  exceeded: boolean;
  used: number;
  limit: number;
  retryAfterSeconds: number;
} {
  if (!BUDGET_ENABLED) {
    return { exceeded: false, used: 0, limit: DAILY_TOKEN_BUDGET, retryAfterSeconds: 0 };
  }

  let entry = _budgetStore.get(userKey);

  // Lazy reset if past midnight UTC
  if (entry && now >= entry.resetAt) {
    entry = undefined;
    _budgetStore.delete(userKey);
  }

  const used = entry?.tokens ?? 0;
  const retryAfterSeconds = Math.max(1, Math.ceil(msUntilMidnightUTC(now) / 1000));

  return {
    exceeded: used >= DAILY_TOKEN_BUDGET,
    used,
    limit: DAILY_TOKEN_BUDGET,
    retryAfterSeconds,
  };
}

/**
 * Record token usage for a user, identified by requestId.
 * Looks up user key from the request context mapping.
 * No-op if the mapping is missing (e.g. internal/system calls).
 */
export function recordTokenUsage(requestId: string, totalTokens: number, now: number = Date.now()): void {
  const ctx = _requestContextMap.get(requestId);
  if (!ctx) return;

  let entry = _budgetStore.get(ctx.userKey);

  // Lazy reset if past midnight UTC
  if (entry && now >= entry.resetAt) {
    entry = undefined;
  }

  if (!entry) {
    entry = { tokens: 0, resetAt: nextMidnightUTC(now) };
    _budgetStore.set(ctx.userKey, entry);
  }

  entry.tokens += totalTokens;
}

// ---------------------------------------------------------------------------
// Fastify hooks — context registration only (budget check is at adapter boundary)
// ---------------------------------------------------------------------------

/**
 * Create a Fastify onRequest hook that registers request context.
 *
 * Extracts user key, userId, scenarioId, and task from the request
 * and stores them keyed by requestId for the adapter wrapper to read.
 *
 * Runs on all POST /assist/v1/* and /orchestrate/v1/* routes.
 * No budget check here — that happens at the adapter boundary.
 */
export function createContextRegistrationHook() {
  return async function contextRegistrationHook(
    request: FastifyRequest,
  ): Promise<void> {
    // Only register context for LLM-calling routes
    if (request.method !== 'POST') return;
    const url = request.url;
    if (!url.startsWith('/assist/v1/') && !url.startsWith('/orchestrate/v1/')) return;

    try {
      const requestId = getRequestId(request);
      const userKey = resolveUserKey(request);
      const rawSub = extractJwtSub(request.headers.authorization) ?? null;

      // Extract scenario_id from request body when available (orchestrator routes)
      let scenarioId: string | null = null;
      if (url.startsWith('/orchestrate/v1/') && request.body && typeof request.body === 'object') {
        const body = request.body as Record<string, unknown>;
        if (typeof body.scenario_id === 'string') {
          scenarioId = body.scenario_id;
        }
      }

      const task = taskFromUrl(url);

      registerRequestContext(requestId, { userKey, userId: rawSub, scenarioId, task });
    } catch (err: unknown) {
      // Fail open — don't block requests if context registration fails
      const requestId = getRequestId(request);
      log.warn({
        event: 'budget_tracker_error',
        request_id: requestId,
        route: request.url,
        error: err instanceof Error ? err.message : String(err),
      }, 'Context registration error — failing open');
    }
  };
}

/**
 * Create a Fastify onResponse hook that cleans up the request context.
 */
export function createContextCleanupHook() {
  return async function contextCleanupHook(request: FastifyRequest): Promise<void> {
    const requestId = getRequestId(request);
    unregisterRequestContext(requestId);
  };
}
