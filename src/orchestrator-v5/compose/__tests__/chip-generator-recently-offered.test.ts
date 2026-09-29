/**
 * ROADMAP 1.20(b) — chip-sameness guard.
 *
 * Live evidence: 5/5 consecutive turns offered IDENTICAL chips regardless
 * of turn content. `generateChips` is a pure deterministic function of
 * structured turn state (stage/analysis/facts/readiness) by design (see
 * this module's file header — chips must never be derived from parsing
 * response text). When that structured state is unchanged across turns
 * (a common case for consecutive converse turns with no new analysis),
 * the SAME chip set is mechanically re-offered every time, with no signal
 * distinguishing "still the right suggestion" from "the user already saw
 * this and it didn't help".
 *
 * Fix: `recentlyOfferedChipIds` — chip ids offered on the immediately
 * prior turn — when EVERY candidate chip this turn computed is already in
 * that set, ship `[]` instead of repeating the identical offer.
 */
import { describe, expect, it } from 'vitest';

import { generateChips } from '../chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { ContextPackAnalysis } from '../../context/context-pack-assembler.js';

const REGISTRY = HANDLER_VALIDATION_REGISTRY;

function analysisAt(band: string): ContextPackAnalysis {
  return {
    status: 'complete',
    leading_option: { label: 'Option A', probability: 0.6 },
    runner_up: { label: 'Option B', probability: 0.4 },
    margin_pp: 20,
    robustness_band: band,
    top_drivers: [],
    fragile_edges: [],
  };
}

describe('generateChips: chip-sameness guard (ROADMAP 1.20(b))', () => {
  it('RED baseline (no recentlyOfferedChipIds threaded): two consecutive turns with IDENTICAL structured state produce byte-identical chip sets — the defect this guard closes', () => {
    const input = {
      stage: 'decide' as const,
      handlerFacts: [],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    };
    const turn1 = generateChips(input);
    const turn2 = generateChips(input);
    expect(turn1.length).toBeGreaterThan(0);
    expect(turn2).toEqual(turn1);
  });

  it('GREEN: when every candidate chip was offered on the immediately-prior turn, ships [] instead of repeating it', () => {
    const input = {
      stage: 'decide' as const,
      handlerFacts: [],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    };
    const turn1 = generateChips(input);
    expect(turn1.length).toBeGreaterThan(0);

    const turn2 = generateChips({
      ...input,
      recentlyOfferedChipIds: new Set(turn1.map((c) => c.id)),
    });
    expect(turn2).toEqual([]);
  });

  it('a chip NOT in the recently-offered set survives — partial overlap only drops the repeated ones', () => {
    // decide + fragile emits pre-mortem + flip prompts (two chips).
    const input = {
      stage: 'decide' as const,
      handlerFacts: [],
      analysis: analysisAt('fragile'),
      validationRegistry: REGISTRY,
    };
    const turn1 = generateChips(input);
    expect(turn1.length).toBeGreaterThanOrEqual(2);

    const turn2 = generateChips({
      ...input,
      // Only the FIRST chip was "offered before" — the rest should survive.
      recentlyOfferedChipIds: new Set([turn1[0]!.id]),
    });
    expect(turn2).toEqual(turn1.slice(1));
  });

  it('when the underlying state DIFFERS (fresh analysis instead of stale/repeat), the chip set is allowed to differ — not exercising the guard at all', () => {
    const stage = 'decide' as const;
    const turnStable = generateChips({
      stage,
      handlerFacts: [],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    });
    const turnFragile = generateChips({
      stage,
      handlerFacts: [],
      analysis: analysisAt('fragile'),
      validationRegistry: REGISTRY,
    });
    expect(turnFragile).not.toEqual(turnStable);
  });

  it('omitting recentlyOfferedChipIds entirely is byte-identical to before (backward compatible)', () => {
    const input = {
      stage: 'decide' as const,
      handlerFacts: [],
      analysis: analysisAt('stable'),
      validationRegistry: REGISTRY,
    };
    const withField = generateChips({ ...input, recentlyOfferedChipIds: undefined });
    const withoutField = generateChips(input);
    expect(withField).toEqual(withoutField);
  });
});
