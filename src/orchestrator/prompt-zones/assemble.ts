/**
 * Zone 2 Assembly — deterministic prompt construction from block registry.
 *
 * Assembles Zone 1 (static identity prompt) with Zone 2 blocks (dynamic
 * context) into a complete system prompt. Assembly is deterministic:
 * same inputs → identical output string.
 *
 * Budget trimming priority (most expendable first):
 * event_log → recent_turns → conversation_summary → graph_state → bil_context
 *
 * Never trimmed: Zone 1, stage_context, analysis_state, hints.
 */

import type { TurnContext, Zone2Block } from "./zone2-blocks.js";
import type { TurnProfile } from "./profiles.js";
import { selectProfile, getProfileBlocks } from "./profiles.js";
import { ZONE2_BLOCKS } from "./zone2-blocks.js";

// ============================================================================
// Budget constants
// ============================================================================

export const BUDGET_WARN_RATIO = 0.8;
export const BUDGET_ERROR_RATIO = 0.95;
export const BUDGET_MAX_CHARS = 120_000;

// ============================================================================
// Output types
// ============================================================================

export interface BlockMetadata {
  name: string;
  version: string;
  owner: string;
  chars_rendered: number;
}

export interface AssembledPrompt {
  system_prompt: string;
  zone1_id: string;
  profile: TurnProfile;
  active_blocks: BlockMetadata[];
  total_chars: number;
  trimmed_blocks: string[];
  selection_reason: string;
  /** Blocks that activated but rendered empty content. */
  empty_blocks: string[];
}

// ============================================================================
// Trim priority — most expendable first
// Never trimmed: stage_context, analysis_state, hints
// ============================================================================

const TRIM_ORDER: readonly string[] = Object.freeze([
  'event_log',
  'recent_turns',
  'conversation_summary',
  'graph_state',
  'bil_context',
]);

const NEVER_TRIM: ReadonlySet<string> = new Set([
  'stage_context',
  'analysis_state',
  'bil_hint',
  'analysis_hint',
]);

// ============================================================================
// Assembly
// ============================================================================

/**
 * Assemble the full prompt from Zone 1 + Zone 2 blocks.
 *
 * 1. Filter registry to profile's active block list AND activation(ctx) true
 * 2. Sort by order ascending
 * 3. Each block renders (pure) and self-trims to maxChars
 * 4. Data blocks rendered with XML wrapper tags after Zone 1
 * 5. Hint blocks merged into single <CONTEXT_HINTS> wrapper after data blocks
 * 6. If total exceeds budget, trim in priority order
 */
export function assembleFullPrompt(
  zone1: string,
  zone1Id: string,
  ctx: TurnContext,
  registry: readonly Zone2Block[] = ZONE2_BLOCKS,
): AssembledPrompt {
  const { profile, reason } = selectProfile(ctx);
  const profileBlocks = getProfileBlocks(profile);

  // Filter: in profile AND activation passes
  const activeBlocks = registry
    .filter((block) => profileBlocks.includes(block.name) && block.activation(ctx))
    .sort((a, b) => a.order - b.order);

  // Render each block — track empty renders for diagnostics
  const rendered: Array<{ block: Zone2Block; content: string }> = [];
  const emptyBlocks: string[] = [];
  for (const block of activeBlocks) {
    const content = block.render(ctx);
    if (content.length > 0) {
      rendered.push({ block, content });
    } else {
      emptyBlocks.push(block.name);
    }
  }

  // Separate data blocks and hint blocks
  const dataBlocks = rendered.filter((r) => r.block.scope === 'data');
  const hintBlocks = rendered.filter((r) => r.block.scope === 'hint');

  // Build Zone 2 string
  const zone2Parts: string[] = [];

  // Data blocks with XML wrappers
  for (const { block, content } of dataBlocks) {
    zone2Parts.push(`<${block.xmlTag}>\n${content}\n</${block.xmlTag}>`);
  }

  // Hints merged into single wrapper
  if (hintBlocks.length > 0) {
    const hintContent = hintBlocks.map((r) => r.content).join('\n');
    zone2Parts.push(`<CONTEXT_HINTS>\n${hintContent}\n</CONTEXT_HINTS>`);
  }

  const zone2 = zone2Parts.join('\n\n');
  let systemPrompt = zone1 + '\n\n' + zone2;
  let totalChars = systemPrompt.length;

  // Budget trimming
  const trimmedBlocks: string[] = [];
  if (totalChars > BUDGET_MAX_CHARS) {
    for (const trimName of TRIM_ORDER) {
      if (totalChars <= BUDGET_MAX_CHARS) break;

      const idx = rendered.findIndex(
        (r) => r.block.name === trimName && !NEVER_TRIM.has(r.block.name),
      );
      if (idx >= 0) {
        trimmedBlocks.push(rendered[idx].block.name);
        rendered.splice(idx, 1);

        // Rebuild
        const rebuiltDataBlocks = rendered.filter((r) => r.block.scope === 'data');
        const rebuiltHintBlocks = rendered.filter((r) => r.block.scope === 'hint');
        const rebuiltParts: string[] = [];
        for (const { block, content } of rebuiltDataBlocks) {
          rebuiltParts.push(`<${block.xmlTag}>\n${content}\n</${block.xmlTag}>`);
        }
        if (rebuiltHintBlocks.length > 0) {
          const rebuiltHintContent = rebuiltHintBlocks.map((r) => r.content).join('\n');
          rebuiltParts.push(`<CONTEXT_HINTS>\n${rebuiltHintContent}\n</CONTEXT_HINTS>`);
        }
        systemPrompt = zone1 + '\n\n' + rebuiltParts.join('\n\n');
        totalChars = systemPrompt.length;
      }
    }
  }

  // Build metadata
  const activeBlocksMeta: BlockMetadata[] = rendered.map(({ block, content }) => ({
    name: block.name,
    version: block.version,
    owner: block.owner,
    chars_rendered: content.length,
  }));

  return {
    system_prompt: systemPrompt,
    zone1_id: zone1Id,
    profile,
    active_blocks: activeBlocksMeta,
    total_chars: totalChars,
    trimmed_blocks: trimmedBlocks,
    empty_blocks: emptyBlocks,
    selection_reason: reason,
  };
}

/**
 * Convenience: assemble with automatic profile selection and Zone 1 source.
 */
export async function assembleWithZone1(
  getZone1: () => Promise<string>,
  zone1Id: string,
  ctx: TurnContext,
  registry: readonly Zone2Block[] = ZONE2_BLOCKS,
): Promise<AssembledPrompt> {
  const zone1 = await getZone1();
  return assembleFullPrompt(zone1, zone1Id, ctx, registry);
}
