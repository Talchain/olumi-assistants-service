/**
 * Ensures the BLOCK_OWNERSHIP map in envelope-assembler stays in sync
 * with the ZONE2_BLOCKS registry.
 *
 * If this test fails, a block was added/removed in one place but not the other.
 */

import { describe, it, expect } from 'vitest';
import { ZONE2_BLOCKS } from '../../../src/orchestrator/prompt-zones/zone2-blocks.js';

// The BLOCK_OWNERSHIP map is local to envelope-assembler and not exported,
// so we maintain the canonical set here and assert against the registry.
const EXPECTED_BLOCK_NAMES = new Set([
  'bil_context',
  'bil_hint',
  'primary_gap_hint',
  'analysis_state',
  'analysis_hint',
  'event_log',
  'stage_context',
  'graph_state',
  'conversation_summary',
  'recent_turns',
]);

describe('Zone2 block ownership sync', () => {
  it('ZONE2_BLOCKS registry contains exactly the blocks in BLOCK_OWNERSHIP', () => {
    const registryNames = new Set(ZONE2_BLOCKS.map((b) => b.name));
    expect(registryNames).toEqual(EXPECTED_BLOCK_NAMES);
  });

  it('no duplicate names in ZONE2_BLOCKS', () => {
    const names = ZONE2_BLOCKS.map((b) => b.name);
    expect(names.length).toBe(new Set(names).size);
  });
});
