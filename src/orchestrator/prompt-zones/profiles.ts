/**
 * Turn Profiles — deterministic profile selection for Zone 2 assembly.
 *
 * Each profile defines which Zone 2 blocks are active for a given turn type.
 * Profile selection is deterministic: same TurnContext → same profile.
 */

import type { TurnContext } from "./zone2-blocks.js";

// ============================================================================
// Profile types
// ============================================================================

export type TurnProfile = 'framing' | 'ideation' | 'post_analysis' | 'parallel_coaching';

export interface ProfileSelection {
  profile: TurnProfile;
  reason: string;
}

// ============================================================================
// Profile → active block mapping
// ============================================================================

const PROFILE_BLOCKS: Readonly<Record<TurnProfile, readonly string[]>> = Object.freeze({
  framing: Object.freeze([
    'stage_context',
    'bil_context',
    'conversation_summary',
    'recent_turns',
    'bil_hint',
  ]),
  ideation: Object.freeze([
    'stage_context',
    'graph_state',
    'bil_context',
    'conversation_summary',
    'recent_turns',
    'event_log',
    'bil_hint',
  ]),
  post_analysis: Object.freeze([
    'stage_context',
    'graph_state',
    'analysis_state',
    'conversation_summary',
    'recent_turns',
    'event_log',
    'analysis_hint',
  ]),
  parallel_coaching: Object.freeze([
    'stage_context',
    'bil_context',
    'bil_hint',
  ]),
});

// ============================================================================
// Profile selection — deterministic, precedence order
// ============================================================================

/**
 * Select the turn profile based on context state.
 *
 * Precedence (highest wins):
 * 1. generateModel === true → parallel_coaching
 * 2. hasAnalysis → post_analysis
 * 3. hasGraph → ideation
 * 4. Default → framing
 */
export function selectProfile(ctx: TurnContext): ProfileSelection {
  if (ctx.generateModel) {
    return { profile: 'parallel_coaching', reason: 'generateModel flag set' };
  }
  if (ctx.hasAnalysis) {
    return { profile: 'post_analysis', reason: 'analysis data present' };
  }
  if (ctx.hasGraph) {
    return { profile: 'ideation', reason: 'graph present, no analysis' };
  }
  return { profile: 'framing', reason: 'default — no graph or analysis' };
}

/**
 * Get the list of block names active for a given profile.
 */
export function getProfileBlocks(profile: TurnProfile): readonly string[] {
  return PROFILE_BLOCKS[profile];
}
