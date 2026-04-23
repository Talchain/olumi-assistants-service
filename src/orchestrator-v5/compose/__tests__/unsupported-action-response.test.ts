/**
 * Tests for composeUnsupportedActionResponse — the graceful 200 fallback
 * for "Sonnet proposed a handler that isn't registered in this deployment".
 *
 * The key contract this composer upholds:
 *   - Returns a clean OlumiResponse body (NO error block) so the UI doesn't
 *     render the generic "Something went wrong" fallback.
 *   - Text is contextual and never contains developer terminology.
 *   - Chips come from the live registry (via curatedHandlerChips) — if
 *     run_analysis is registered it lands as the action chip; otherwise a
 *     text-prompt chip keeps the "every path yields a chip" invariant.
 */

import { describe, it, expect } from 'vitest';

import { composeUnsupportedActionResponse } from '../unsupported-action-response.js';
import type { ComposeContext } from '../types.js';
import type { HandlerValidationRegistry } from '../../routing/validator.js';

const DEFAULT_REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
};

const CTX: ComposeContext = { handlerRegistry: DEFAULT_REGISTRY };

const FORBIDDEN_DEV_TERMS = /\b(feature|enabled|environment|handler_id|registry|session)\b/i;

describe('composeUnsupportedActionResponse', () => {
  it('returns a clean OlumiResponse without an error block', () => {
    const { response } = composeUnsupportedActionResponse({
      handlerId: 'add_option',
      context: CTX,
      stage: 'analyse',
      hasAnalysis: false,
    });
    expect(response.blocks.filter((b) => b.type === 'error')).toHaveLength(0);
    expect(response.response_version).toBe(2);
    expect(response.assistant_text.length).toBeGreaterThan(0);
    expect(response.stage_indicator).toBe('analyse');
  });

  it('offers a run_analysis chip when the registry has run_analysis', () => {
    const { response } = composeUnsupportedActionResponse({
      handlerId: 'add_option',
      context: CTX,
      stage: 'analyse',
      hasAnalysis: false,
    });
    expect(response.suggested_actions).toHaveLength(1);
    expect(response.suggested_actions[0]!.action_type).toBe('run_analysis');
    expect(response.suggested_actions[0]!.label).toBe('Run analysis');
  });

  it('falls back to a text-prompt chip when the registry is empty', () => {
    const { response } = composeUnsupportedActionResponse({
      handlerId: 'add_option',
      context: { handlerRegistry: {} },
      stage: 'frame',
      hasAnalysis: false,
    });
    expect(response.suggested_actions).toHaveLength(1);
    expect(response.suggested_actions[0]!.action_type).toBeUndefined();
  });

  describe('category-specific coaching text', () => {
    it('structural handlers point the user at the canvas', () => {
      const { response, category, templateId } = composeUnsupportedActionResponse({
        handlerId: 'add_option',
        context: CTX,
        stage: 'analyse',
        hasAnalysis: false,
      });
      expect(category).toBe('structural');
      expect(templateId).toBe('unsupported_action_structural');
      expect(response.assistant_text).toMatch(/canvas/i);
      expect(response.assistant_text).toMatch(/add option/i);
    });

    it('value-change handlers point the user at the inspector', () => {
      const { response, category } = composeUnsupportedActionResponse({
        handlerId: 'set_factor_value',
        context: CTX,
        stage: 'analyse',
        hasAnalysis: false,
      });
      expect(category).toBe('value_change');
      expect(response.assistant_text).toMatch(/inspector/i);
    });

    it('analysis-dependent handlers with no analysis ask the user to run it first', () => {
      const { response, category } = composeUnsupportedActionResponse({
        handlerId: 'explain_result',
        context: CTX,
        stage: 'analyse',
        hasAnalysis: false,
      });
      expect(category).toBe('analysis_dep');
      expect(response.assistant_text).toMatch(/analysis/i);
      expect(response.assistant_text).toMatch(/run the analysis/i);
    });

    it('analysis-dependent handlers with analysis available suggest a follow-up', () => {
      const { response, category } = composeUnsupportedActionResponse({
        handlerId: 'explain_result',
        context: CTX,
        stage: 'analyse',
        hasAnalysis: true,
      });
      expect(category).toBe('analysis_dep');
      // Must not tell the user to re-run analysis — it already has results.
      expect(response.assistant_text).not.toMatch(/run the analysis/i);
      expect(response.assistant_text).toMatch(/follow-up/i);
    });

    it('unknown handlers fall through to generic coaching', () => {
      const { response, category } = composeUnsupportedActionResponse({
        handlerId: 'some_unrecognised_action',
        context: CTX,
        stage: 'frame',
        hasAnalysis: false,
      });
      expect(category).toBe('generic');
      expect(response.assistant_text.length).toBeGreaterThan(0);
    });
  });

  describe('user-facing quality bar', () => {
    // "Must not contain: feature, enabled, environment, session, any
    //  developer-facing terminology." — from the brief's §1b quality bar.
    const TEST_HANDLERS: readonly string[] = [
      'add_option',
      'edit_graph',
      'add_factor',
      'remove_factor',
      'set_factor_value',
      'adjust_edge_strength',
      'add_constraint',
      'explain_result',
      'compare_options',
      'what_would_flip',
      'some_unknown',
    ];
    for (const handlerId of TEST_HANDLERS) {
      for (const hasAnalysis of [true, false]) {
        it(`${handlerId} (hasAnalysis=${hasAnalysis}) avoids developer terminology`, () => {
          const { response } = composeUnsupportedActionResponse({
            handlerId,
            context: CTX,
            stage: 'analyse',
            hasAnalysis,
          });
          expect(response.assistant_text).not.toMatch(FORBIDDEN_DEV_TERMS);
        });
      }
    }

    it('the proposed handler_id is referenced in the response (minus underscore)', () => {
      const { response } = composeUnsupportedActionResponse({
        handlerId: 'add_option',
        context: CTX,
        stage: 'analyse',
        hasAnalysis: false,
      });
      // Underscores are replaced with spaces for readability; the
      // human-facing form of the handler_id should appear in the text.
      expect(response.assistant_text).toMatch(/add option/i);
    });
  });
});
