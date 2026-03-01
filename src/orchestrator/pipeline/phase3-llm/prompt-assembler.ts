/**
 * Prompt Assembler (V2)
 *
 * Composes the system prompt for the LLM call with enriched context.
 *
 * Zone 1: Static orchestrator prompt from prompt store.
 *         // F.2: Zone 1 will be replaced with science-powered prompt. Using existing cf-v4.0.5 for now.
 * Zone 2: Dynamic enriched context (stage, intent, archetype, DSK placeholder).
 * Zone 3: Tool definitions (reuse existing).
 */

import { getSystemPrompt } from "../../../adapters/llm/prompt-loader.js";
import type { EnrichedContext } from "../types.js";

/**
 * Assemble the system prompt with enriched context.
 *
 * Builds on the existing Zone 1 + Zone 2 pattern from prompt-assembly.ts
 * but injects the richer V2 enriched context fields.
 */
export async function assembleV2SystemPrompt(
  enrichedContext: EnrichedContext,
): Promise<string> {
  // Zone 1: Static orchestrator prompt (from prompt store / cache / defaults)
  // F.2: Zone 1 will be replaced with science-powered prompt. Using existing cf-v4.0.5 for now.
  const zone1 = await getSystemPrompt('orchestrator');

  // Zone 2: Dynamic enriched context
  const zone2Sections: string[] = [];

  // Stage indicator
  const si = enrichedContext.stage_indicator;
  zone2Sections.push(`Current stage: ${si.stage}${si.substate ? ` (${si.substate})` : ''}`);
  zone2Sections.push(`Stage confidence: ${si.confidence} (${si.source})`);

  // Decision goal
  const goal = enrichedContext.framing?.goal;
  if (goal) {
    zone2Sections.push(`Decision goal: ${goal}`);
  }

  // Intent classification
  zone2Sections.push(`User intent: ${enrichedContext.intent_classification}`);

  // Decision archetype (if detected)
  const archetype = enrichedContext.decision_archetype;
  if (archetype.type) {
    zone2Sections.push(`Decision archetype: ${archetype.type} (${archetype.confidence} confidence, evidence: ${archetype.evidence})`);
  }

  // Stuck state
  if (enrichedContext.stuck.detected) {
    zone2Sections.push('User appears stuck — consider offering rescue routes.');
  }

  // DSK context placeholder
  zone2Sections.push('<!-- DSK claims will appear here when A.9 is active -->');

  // Specialist advice placeholder
  zone2Sections.push('<!-- Specialist advice will appear here when Phase 2 is active -->');

  const zone2 = zone2Sections.join('\n');

  return `${zone1}\n\n${zone2}`;
}
