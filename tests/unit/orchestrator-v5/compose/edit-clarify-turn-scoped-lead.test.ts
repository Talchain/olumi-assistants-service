/**
 * S12 — the edit-clarify lead sentence must be TURN-scoped, not SESSION-scoped.
 *
 * WHY THIS EXISTS (journey-witnessed 26 Aug 2026, guest, UI 08a30ab9 / CEE 9220c12):
 * a provenance question was routed to the edit lane and the product replied
 * "The model is unchanged so far." — while TWO edits were already committed in
 * that session and the product's OWN Model tab said so (`User edited`, `1 change`).
 *
 * The routing mis-classification is a separate, rowed problem. THIS defect is the
 * COPY: the branch that emits this sentence is reached from
 * `edit-graph.ts` (V4 edit_graph LLM no-op) and from the two route-level
 * intercepts, and NONE of them is given any session or prior-mutation state —
 * `buildEditClarifyFallbackParts` takes graph NODES ONLY. Derived at the bytes:
 * zero references to RecentMutation / recentChanges / priorMutation /
 * sessionMutation in edit-graph.ts (contrast: 3 references to
 * buildEditClarifyFallbackParts in the same file, same sweep).
 *
 * So the sentence is TRUE ABOUT THE TURN and the falsity lives entirely in the
 * words "so far", which read session-scoped over a turn-scoped fact. The composer
 * cannot know what happened earlier in the session, so it must not speak about it.
 *
 * ⚠ The natural repairs are BANNED at egress as state-mutation denials
 * (`forbidden-user-facing-phrases.ts`). This suite pins that constraint by
 * MEASUREMENT — it runs the real `findForbiddenPhraseHit` over the composed
 * text — rather than by inspection.
 */

import { describe, it, expect } from 'vitest';
import {
  composeEditClarifyResponse,
  buildEditClarifyFallbackParts,
  type EditClarifyComposerNode,
} from '../../../../src/orchestrator-v5/compose/edit-clarify-response.js';
import { findForbiddenPhraseHit } from '../../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';

const NODES: readonly EditClarifyComposerNode[] = Object.freeze([
  { id: 'f_churn', kind: 'factor', label: 'Annual Churn Rate' },
  { id: 'f_reseller', kind: 'factor', label: 'Reseller Partner Channel Active' },
  { id: 'opt_a', kind: 'option', label: 'go through a reseller partner' },
]);

/**
 * Every producer/configuration that can reach the user with this lead.
 * Constraint: the claim must be true on ALL of them, not just the witnessed one.
 */
function everyEmittedText(): ReadonlyArray<{ readonly path: string; readonly text: string }> {
  return [
    {
      path: 'composeEditClarifyResponse/chip_simplify',
      text: composeEditClarifyResponse({ reason: 'chip_simplify', stage: 'analyse', nodes: NODES })
        .assistant_text,
    },
    {
      path: 'composeEditClarifyResponse/vague_edit',
      text: composeEditClarifyResponse({ reason: 'vague_edit', stage: 'analyse', nodes: NODES })
        .assistant_text,
    },
    {
      path: 'composeEditClarifyResponse/vague_edit+fresh',
      text: composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: 'analyse',
        nodes: NODES,
        priorAnalysisIsFresh: true,
      }).assistant_text,
    },
    {
      path: 'buildEditClarifyFallbackParts (edit-graph.ts:2454 no-op branch)',
      text: buildEditClarifyFallbackParts(NODES).text,
    },
  ];
}

describe('edit-clarify lead sentence is turn-scoped', () => {
  it('collects every emitting path (guards against a vacuous suite)', () => {
    const emitted = everyEmittedText();
    expect(emitted).toHaveLength(4);
    for (const { path, text } of emitted) {
      expect(text.length, `${path} produced empty text`).toBeGreaterThan(20);
    }
  });

  /**
   * THE RED. "so far" is a session-scoped temporal qualifier on a branch that is
   * given no session state. It is the exact word that made the witnessed
   * sentence contradict the product's own Model tab.
   */
  it('makes no session-scoped claim about the model on any emitting path', () => {
    for (const { path, text } of everyEmittedText()) {
      expect(text, `${path} carries a session-scoped qualifier`).not.toMatch(/\bso far\b/i);
      expect(text, `${path} claims the whole model is unchanged`).not.toMatch(
        /\bthe\s+model\s+is\s+unchanged\b/i,
      );
    }
  });

  /**
   * Constraint pinned by MEASUREMENT, not inspection: the replacement must not be
   * a banned state-mutation denial. Runs the real egress guard.
   */
  it('passes the real egress forbidden-phrase guard on every emitting path', () => {
    for (const { path, text } of everyEmittedText()) {
      const hit = findForbiddenPhraseHit(text);
      expect(hit, `${path} tripped the egress guard with: ${String(hit)}`).toBeNull();
    }
  });

  /**
   * The lead must be IDENTICAL across producers — one claim, not a family of
   * near-variants that can drift apart (the estate's hand-maintained-mirror defect).
   */
  it('emits the same lead sentence from both producers', () => {
    const viaComposer = composeEditClarifyResponse({
      reason: 'vague_edit',
      stage: 'analyse',
      nodes: NODES,
    }).assistant_text;
    const viaFallback = buildEditClarifyFallbackParts(NODES).text;
    expect(viaFallback).toBe(viaComposer);
  });

  /**
   * ⭐ The freshness asymmetry is LOAD-BEARING: it is what discriminated which
   * producer emitted the witnessed sentence (the live text carried NO freshness
   * suffix even on a turn where analysis was fresh => the fallback path).
   * Do not flatten it.
   */
  it('preserves the freshness asymmetry between the two producers', () => {
    const fresh = composeEditClarifyResponse({
      reason: 'vague_edit',
      stage: 'analyse',
      nodes: NODES,
      priorAnalysisIsFresh: true,
    }).assistant_text;
    const notFresh = composeEditClarifyResponse({
      reason: 'vague_edit',
      stage: 'analyse',
      nodes: NODES,
      priorAnalysisIsFresh: false,
    }).assistant_text;
    expect(fresh).toContain('Your last analysis is still current.');
    expect(notFresh).not.toContain('still current');
    // The fallback producer NEVER carries it — this is the discriminator.
    expect(buildEditClarifyFallbackParts(NODES).text).not.toContain('still current');
  });

  /**
   * The lead must still set up the existing closing ask, so the reply remains
   * actionable rather than a bare refusal.
   */
  it('still asks the user for the specific thing to change', () => {
    for (const { path, text } of everyEmittedText()) {
      expect(text, `${path} lost the closing ask`).toContain(
        "Tell me the specific factor, edge, option, or value to change, and I'll apply it directly.",
      );
    }
  });
});
