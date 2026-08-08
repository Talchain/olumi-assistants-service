/**
 * ROADMAP 2.973 — the anti-drift guard.
 *
 * #871 moved the draft/edit task defaults to claude-sonnet-5. Nothing was RED,
 * because model capabilities lived in hand-maintained literals that no test tied
 * to the models actually reachable. The only signal was a log line in production.
 *
 * This suite makes that class of drift a RED TEST instead:
 *   - every reachable Anthropic model carries an EXPLICIT capability verdict;
 *   - the derived sets can never be silently empty;
 *   - the strict-tool POLICY set stays frozen (it has no env gate).
 */

import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODEL_CAPABILITIES,
  STRUCTURED_OUTPUTS_CAPABLE_MODELS,
  THINKING_CAPABLE_MODELS,
  STRICT_TOOL_CALLING_MODELS,
  findUnclassifiedModels,
} from '../anthropic-model-capabilities.js';
import { MODEL_REGISTRY } from '../../../config/models.js';
import { TASK_MODEL_DEFAULTS } from '../../../config/model-routing.js';

/**
 * DERIVED, never mirrored: the Anthropic models a live call can actually land on.
 * Task defaults ∪ enabled Anthropic registry entries.
 */
function reachableAnthropicModels(): string[] {
  const fromDefaults = Object.values(TASK_MODEL_DEFAULTS).filter((m) =>
    String(m).startsWith('claude-'),
  );
  const fromRegistry = Object.values(MODEL_REGISTRY)
    .filter((m) => m.provider === 'anthropic' && m.enabled)
    .map((m) => m.id);
  return [...new Set([...fromDefaults, ...fromRegistry])];
}

describe('Anthropic model capabilities — drift guard (ROADMAP 2.973)', () => {
  it('the derived reachable set is NON-EMPTY (anti-vacuity: an empty sweep must never read as "no drift")', () => {
    const reachable = reachableAnthropicModels();
    expect(
      reachable.length,
      'derived ZERO reachable Anthropic models — the derivation is broken, not the estate clean',
    ).toBeGreaterThan(0);
    // Bind by IDENTITY to the models the deployed staging env actually serves
    // (CEE_MODEL_DRAFT_GRAPH / EDIT_GRAPH / ORCHESTRATOR, Render API 2026-08-08),
    // so this guard cannot pass on an unrelated population.
    expect(reachable).toContain('claude-sonnet-5');
  });

  it('every reachable Anthropic model carries an explicit capability verdict', () => {
    const unclassified = findUnclassifiedModels(reachableAnthropicModels());
    expect(
      unclassified,
      `Unclassified Anthropic model(s): ${unclassified.join(', ')}. A model became ` +
        'reachable without a live-probed capability verdict — this is exactly how ' +
        '#871 silently dropped structured outputs. Probe it and add it to ' +
        'ANTHROPIC_MODEL_CAPABILITIES.',
    ).toEqual([]);
  });

  it('findUnclassifiedModels actually discriminates (a guard that never fires is not a guard)', () => {
    // Positive control: the guard must REPORT an unclassified model, not just
    // return [] for everything handed to it.
    expect(findUnclassifiedModels(['claude-not-a-real-model'])).toEqual(['claude-not-a-real-model']);
    expect(findUnclassifiedModels(['claude-sonnet-5'])).toEqual([]);
  });

  it('claude-sonnet-5 is structured-outputs capable and NOT thinking-enabled capable (live-probed 2026-08-08)', () => {
    const caps = ANTHROPIC_MODEL_CAPABILITIES['claude-sonnet-5'];
    expect(caps).toBeDefined();
    expect(caps!.structuredOutputs).toBe(true);
    // The API returns HTTP 400 for thinking:{type:'enabled'} on this model.
    // Forcing it true would 400 every draft turn that requests thinking.
    expect(caps!.thinkingEnabled).toBe(false);
    expect(STRUCTURED_OUTPUTS_CAPABLE_MODELS.has('claude-sonnet-5')).toBe(true);
    expect(THINKING_CAPABLE_MODELS.has('claude-sonnet-5')).toBe(false);
  });

  it('every verdict is dated with the probe that established it', () => {
    for (const [id, caps] of Object.entries(ANTHROPIC_MODEL_CAPABILITIES)) {
      expect(caps.probedOn, `${id} has no probe date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('derived capability sets are non-empty and agree with the evidence map', () => {
    expect(STRUCTURED_OUTPUTS_CAPABLE_MODELS.size).toBeGreaterThan(0);
    expect(THINKING_CAPABLE_MODELS.size).toBeGreaterThan(0);
    for (const [id, caps] of Object.entries(ANTHROPIC_MODEL_CAPABILITIES)) {
      expect(STRUCTURED_OUTPUTS_CAPABLE_MODELS.has(id), `SO set disagrees for ${id}`).toBe(
        caps.structuredOutputs,
      );
      expect(THINKING_CAPABLE_MODELS.has(id), `thinking set disagrees for ${id}`).toBe(
        caps.thinkingEnabled,
      );
    }
  });

  it('the strict-tool-calling POLICY set is frozen to its pre-2.973 membership (no env gate — must not move)', () => {
    // MUST-NOT-CHANGE fixture. buildStrictAnthropicTools consults this on EVERY
    // live turn with no flag. Restoring the draft grammar must not widen it.
    expect([...STRICT_TOOL_CALLING_MODELS].sort()).toEqual([
      'claude-opus-4-20250514',
      'claude-opus-4-5-20251101',
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-6',
    ]);
    // The whole point of the concept split: sonnet-5 gains structured outputs
    // WITHOUT gaining strict tool calling.
    expect(STRICT_TOOL_CALLING_MODELS.has('claude-sonnet-5')).toBe(false);
    expect(STRUCTURED_OUTPUTS_CAPABLE_MODELS.has('claude-sonnet-5')).toBe(true);
  });

  it('MODEL_REGISTRY.extendedThinking is NOT the source of truth (it was measured wrong in both directions)', () => {
    // Regression fixture for the trap that would have been introduced by naively
    // "deriving" thinking support from the registry.
    // Registry says true, API says 400:
    expect(MODEL_REGISTRY['claude-sonnet-5']?.extendedThinking).toBe(true);
    expect(THINKING_CAPABLE_MODELS.has('claude-sonnet-5')).toBe(false);
    // Registry says false, API says 200 with a thinking block:
    expect(MODEL_REGISTRY['claude-sonnet-4-6']?.extendedThinking).toBe(false);
    expect(THINKING_CAPABLE_MODELS.has('claude-sonnet-4-6')).toBe(true);
  });
});
