/**
 * Context Fabric — Route Profiles
 *
 * Five route profiles governing context assembly behaviour.
 * RUN_ANALYSIS is excluded — it bypasses context assembly (passthrough to PLoT).
 */

import type { ContextFabricRoute, RouteProfile, TokenBudget } from "./types.js";

// ============================================================================
// Deep Freeze Utility
// ============================================================================

/**
 * Recursively freeze an object and all its nested objects/arrays.
 * Returns the same reference, now deeply immutable.
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  const proto = Object.getPrototypeOf(obj) as unknown;
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      !Object.isFrozen(value) &&
      // Only freeze plain objects and arrays, not class instances
      (Array.isArray(value) || Object.getPrototypeOf(value) === proto || Object.getPrototypeOf(value) === Object.prototype)
    ) {
      deepFreeze(value);
    }
  }
  return obj;
}

// ============================================================================
// Route Profiles
// ============================================================================

const PROFILES: Readonly<Record<ContextFabricRoute, RouteProfile>> = deepFreeze({
  CHAT: {
    route: "CHAT",
    max_turns: 3,
    include_graph_summary: true,
    include_full_graph: false,
    include_analysis_summary: true,
    include_full_analysis: false,
    include_archetypes: false,
    include_selected_elements: false,
    token_budget: 8000,
  },
  DRAFT_GRAPH: {
    route: "DRAFT_GRAPH",
    max_turns: 2,
    include_graph_summary: false,
    include_full_graph: false,
    include_analysis_summary: false,
    include_full_analysis: false,
    include_archetypes: true,
    include_selected_elements: false,
    token_budget: 12000,
  },
  EDIT_GRAPH: {
    route: "EDIT_GRAPH",
    max_turns: 3,
    include_graph_summary: true,
    include_full_graph: false,
    include_analysis_summary: false,
    include_full_analysis: false,
    include_archetypes: false,
    include_selected_elements: true,
    token_budget: 10000,
  },
  EXPLAIN_RESULTS: {
    route: "EXPLAIN_RESULTS",
    max_turns: 3,
    include_graph_summary: true,
    include_full_graph: false,
    include_analysis_summary: true,
    include_full_analysis: false,
    include_archetypes: false,
    include_selected_elements: false,
    token_budget: 10000,
  },
  GENERATE_BRIEF: {
    route: "GENERATE_BRIEF",
    max_turns: 2,
    include_graph_summary: true,
    include_full_graph: false,
    include_analysis_summary: true,
    include_full_analysis: false,
    include_archetypes: false,
    include_selected_elements: false,
    token_budget: 10000,
  },
});

/**
 * Zone 2 token allocation per route.
 */
const ZONE2_TOKENS: Readonly<Record<ContextFabricRoute, number>> = deepFreeze({
  CHAT: 500,
  DRAFT_GRAPH: 2000,
  EDIT_GRAPH: 1000,
  EXPLAIN_RESULTS: 1500,
  GENERATE_BRIEF: 1000,
});

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the route profile for a context-fabric route.
 * Compile-time safe: only accepts ContextFabricRoute values.
 * Runtime guard: throws if an invalid value bypasses TypeScript.
 */
export function getProfile(route: ContextFabricRoute): RouteProfile {
  const profile = PROFILES[route];
  if (!profile) {
    throw new Error(`Unknown context-fabric route: ${String(route)}`);
  }
  return profile;
}

/**
 * Get the Zone 2 token allocation for a route.
 */
export function getZone2Tokens(route: ContextFabricRoute): number {
  return ZONE2_TOKENS[route];
}

/**
 * Compute a zone-based token budget for a route profile.
 *
 * @param profile - The route profile
 * @param zone1Tokens - Estimated tokens for rendered Zone 1 content
 * @returns TokenBudget with zone allocations
 * @throws Error if zone3 would be negative (configuration error)
 */
export function computeBudget(profile: RouteProfile, zone1Tokens: number): TokenBudget {
  const effective_total = Math.floor(profile.token_budget * 0.9);
  const safety_margin = profile.token_budget - effective_total;
  const zone2 = ZONE2_TOKENS[profile.route];
  const zone3 = effective_total - zone1Tokens - zone2;

  if (zone3 < 0) {
    throw new Error(
      `Context budget error: zone3 is negative (${zone3}) for route ${profile.route}. ` +
      `effective_total=${effective_total}, zone1=${zone1Tokens}, zone2=${zone2}. ` +
      `Zone 1 (system prompt) has grown too large for the configured token_budget.`,
    );
  }

  return {
    zone1: zone1Tokens,
    zone2,
    zone3,
    safety_margin,
    effective_total,
  };
}

// Export deepFreeze for testing only
export { deepFreeze as _deepFreeze };
