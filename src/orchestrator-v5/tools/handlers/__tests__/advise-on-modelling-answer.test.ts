/**
 * The advise-on-modelling DESTINATION, at the composer and at the handler.
 *
 * WHAT THIS REPLACES, reproduced from the served capture (staging build
 * `1b50150`, request c55a2800-cae3-420f-b071-79cfed67aadd): the user asked
 * "How do you recommend we add the author event's effort level to the
 * decision?" and was served the whole-model structural recap below. The recap
 * is correct about the model and is not an answer to the question — and
 * `composeExplainFromStructureFallback` never reads the message, so the same
 * 632 characters answer every message that resolves no named factor.
 *
 * THE DISCRIMINATOR IS THE POINT: the structural path must reproduce that
 * recap BYTE-FOR-BYTE for a genuine structure question. It is pinned as a
 * literal below — a historical artefact, not a value re-derived from the code
 * under test (CLAUDE.md trap 12b).
 */

import { describe, expect, it } from 'vitest';

import { createExplainFromStructureHandler } from '../explain-from-structure.js';
import { composeExplainFromStructureFallback } from '../explanation-fallback.js';
import {
  containsMutationLanguage,
  containsStructuralSuccessClaim,
} from '../../../routing/mutation-language.js';
import { FORBIDDEN_USER_FACING_PHRASES } from '../../../compose/forbidden-user-facing-phrases.js';
import type { HandlerInvocation } from '../../registry.js';
import type { StructureProjectionSummary } from '../../../context/projection-summaries.js';

/**
 * The served recap, character for character, as
 * `composeExplainFromStructureFallback` produced it at `1b50150` for the
 * bookshop model. Pinned as a literal so a future change to the structural
 * path REDs here rather than silently redefining the baseline.
 */
const SERVED_RECAP =
  'Your decision around We want monthly revenue to reach £18,000 in six months is shaped by several causal mechanisms. ' +
  'extend Friday opening by two hours with an author event has the strongest visible direct influence on Friday Extended Hours via a very strong link, meaning changes here would have the most structural effect. ' +
  'Keep Current Schedule also contributes meaningfully through a very strong direct link to Friday Extended Hours, so it is worth keeping in view as a secondary lever. ' +
  'The model contains 3 factors and 3 options. ' +
  'Running the analysis would show how these structural relationships translate into option-level probabilities.';

const BOOKSHOP: StructureProjectionSummary = {
  relationship_detail_status: 'canonical_strict',
  goal_label: 'We want monthly revenue to reach £18,000 in six months',
  top_causal_links: [
    {
      label_from: 'extend Friday opening by two hours with an author event',
      label_to: 'Friday Extended Hours',
      edge_type: 'directed',
      strength: 0.95,
    },
    {
      label_from: 'Keep Current Schedule',
      label_to: 'Friday Extended Hours',
      edge_type: 'directed',
      strength: 0.95,
    },
  ],
  named_factor_pathways: [],
  factor_count: 3,
  option_count: 3,
};

/** The same model, with the message having resolved a real saved factor. */
const BOOKSHOP_WITH_NAMED_FACTOR: StructureProjectionSummary = {
  ...BOOKSHOP,
  named_factor_label: 'Friday Extended Hours',
  named_factor_pathways: [
    {
      label_from: 'extend Friday opening by two hours with an author event',
      label_to: 'Friday Extended Hours',
      edge_type: 'directed',
      strength: 0.95,
    },
  ],
};

describe('composeExplainFromStructureFallback — the advise-on-modelling arm', () => {
  it('DISCRIMINATOR: a genuine structure question still gets the served recap, byte for byte', () => {
    expect(composeExplainFromStructureFallback(BOOKSHOP, { canRunAnalysis: true })).toBe(
      SERVED_RECAP,
    );
  });

  it('an advise-on-modelling turn does NOT get the recap', () => {
    const answer = composeExplainFromStructureFallback(BOOKSHOP, {
      canRunAnalysis: true,
      adviseOnModelling: true,
    });
    expect(answer).not.toBe(SERVED_RECAP);
    // Not a truncation or a prefix of it either.
    expect(SERVED_RECAP.startsWith(answer)).toBe(false);
    expect(answer.length).toBeGreaterThan(80);
  });

  it('pairs the judgement with a concrete next step (coaching shape, not a bare refusal)', () => {
    const answer = composeExplainFromStructureFallback(BOOKSHOP, {
      canRunAnalysis: true,
      adviseOnModelling: true,
    });
    expect(answer).toMatch(/\bjudgement\b/i);
    expect(answer).toMatch(/Tell me what you expect it to affect/i);
  });

  it('BREAKS MESSAGE-INVARIANCE: a resolved named factor changes the answer', () => {
    const unanchored = composeExplainFromStructureFallback(BOOKSHOP, {
      adviseOnModelling: true,
    });
    const anchored = composeExplainFromStructureFallback(BOOKSHOP_WITH_NAMED_FACTOR, {
      adviseOnModelling: true,
    });
    expect(anchored).not.toBe(unanchored);
    expect(anchored).toContain('Friday Extended Hours');
    expect(unanchored).toContain('3 factors and 3 options');
    // Both are ADVICE answers — the variation is inside the destination, not a
    // fall-back to two different structural templates.
    expect(anchored).toMatch(/Tell me what you expect it to affect/i);
    expect(unanchored).toMatch(/Tell me what you expect it to affect/i);
  });

  /**
   * A withheld or trimmed snapshot can only UNDERSTATE a count ("trimming
   * removes, it never invents"), so the advice arm must not assert one. The
   * goal LABEL survives — the named-factor branch beside it already trusts
   * labels under the same status.
   */
  it('states no COUNT on a withheld or trimmed turn, and still answers', () => {
    const withheld: StructureProjectionSummary = {
      ...BOOKSHOP,
      relationship_detail_status: 'unavailable',
    };
    const answer = composeExplainFromStructureFallback(withheld, {
      adviseOnModelling: true,
    });
    expect(answer).not.toMatch(/\b3 factors\b/);
    expect(answer).not.toMatch(/\b3 options\b/);
    expect(answer).toContain('We want monthly revenue to reach £18,000 in six months');
    expect(answer).toMatch(/Tell me what you expect it to affect/i);
  });

  it('states no connection COUNT for a named factor on a withheld turn', () => {
    const withheldNamed: StructureProjectionSummary = {
      ...BOOKSHOP_WITH_NAMED_FACTOR,
      relationship_detail_status: 'unavailable',
    };
    const answer = composeExplainFromStructureFallback(withheldNamed, {
      adviseOnModelling: true,
    });
    expect(answer).toContain('Friday Extended Hours');
    expect(answer).not.toMatch(/recorded connection/i);
  });

  it('answers when the projection carries nothing licensed at all', () => {
    const empty: StructureProjectionSummary = {
      relationship_detail_status: 'unavailable',
      goal_label: null,
      top_causal_links: [],
      named_factor_pathways: [],
      factor_count: 0,
      option_count: 0,
    };
    const answer = composeExplainFromStructureFallback(empty, {
      adviseOnModelling: true,
    });
    expect(answer).toMatch(/judgement about your decision/i);
    expect(answer).toMatch(/Tell me what you expect it to affect/i);
    expect(answer).not.toMatch(/\b0 factors\b/);
  });

  it('the ambiguity refusal still outranks the advice arm', () => {
    const ambiguous: StructureProjectionSummary = {
      ...BOOKSHOP,
      named_factor_ambiguous: true,
    };
    expect(
      composeExplainFromStructureFallback(ambiguous, { adviseOnModelling: true }),
    ).toBe(composeExplainFromStructureFallback(ambiguous, {}));
  });

  /**
   * The composed text passes back through STEP 6.5 (mutation-language
   * telemetry) and STEP 6.6 (the ENFORCING structural-success swap). Copy that
   * tripped 6.6 would be replaced by the honest decline, so this is the
   * difference between shipping the answer and shipping a refusal.
   */
  it('is idempotent under the egress gates it will be re-evaluated by', () => {
    for (const projection of [BOOKSHOP, BOOKSHOP_WITH_NAMED_FACTOR]) {
      const answer = composeExplainFromStructureFallback(projection, {
        canRunAnalysis: true,
        adviseOnModelling: true,
      });
      expect(containsStructuralSuccessClaim(answer), answer).toBe(false);
      expect(containsMutationLanguage(answer), answer).toBe(false);
      for (const pattern of FORBIDDEN_USER_FACING_PHRASES) {
        expect(pattern.test(answer), `${pattern} matched: ${answer}`).toBe(false);
      }
      // TERMINOLOGY_MAP: never node / edge / graph in visible text.
      expect(answer).not.toMatch(/\b(?:node|nodes|edge|edges|graph)\b/i);
      // No em dash, no "recommend" family (DOCTRINE_VERDICT_PATTERNS).
      expect(answer).not.toContain('—');
      expect(answer).not.toMatch(/\brecommendations?\b|\brecommended\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Handler level
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeInvocation(
  overrides: Partial<HandlerInvocation> & { message: string },
): HandlerInvocation {
  const { message, ...rest } = overrides;
  return {
    context: {
      stage: 'frame',
      entity_registry: { option_ids: [], goal_id: 'goal_1' },
      capabilities: {},
      messages: [{ role: 'user', content: message }],
      session_id: SCENARIO_ID,
      request_id: 'req-advise',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message,
      turn_class: 'frame',
      stage: 'frame',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-advise',
    signal: new AbortController().signal,
    orientationText: 'Looking at the structure of your decision.',
    proposal: {
      handler_id: 'explain_from_structure',
      entity: {
        id: 'goal_1',
        kind: 'goal',
        label: 'Goal',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [],
      cited_context_fields: [],
      structure_query: { kind: 'general' },
    } as unknown as HandlerInvocation['proposal'],
    structureProjection: BOOKSHOP,
    // `canRunAnalysis` gates the recap's closing nudge; the served capture
    // carried it, so the baseline fixture must too.
    analysisReady: {
      status: 'ready',
      goal_node_id: 'goal_1',
      options: [
        { option_id: 'opt_1', label: 'Option 1', status: 'ready', interventions: { f: 1 } },
        { option_id: 'opt_2', label: 'Option 2', status: 'ready', interventions: { f: 1 } },
        { option_id: 'opt_3', label: 'Option 3', status: 'ready', interventions: { f: 1 } },
      ],
    } as unknown as HandlerInvocation['analysisReady'],
    ...rest,
  } as HandlerInvocation;
}

describe('explain_from_structure — the advise-on-modelling destination', () => {
  const handler = createExplainFromStructureHandler();

  it('serves the recap today for a structure question (baseline preserved)', async () => {
    const outcome = await handler(
      makeInvocation({ message: 'What most influences my decision?' }),
    );
    expect(outcome.assistant_text).toBe(SERVED_RECAP);
  });

  it('CAPTURED TURN: the advise question no longer gets the recap', async () => {
    const outcome = await handler(
      makeInvocation({
        message:
          "How do you recommend we add the author event's effort level to the decision?",
        adviseOnModelling: true,
        explanation: {
          // The measured rejection: a 974-char authored answer, discarded
          // for mutation_language_detected.
          answer_text: "I'd suggest adding a factor for the author event's effort.",
          answer_text_valid: false,
          answer_validation_error: 'mutation_language_detected',
        },
      }),
    );
    expect(outcome.assistant_text).not.toBe(SERVED_RECAP);
    expect(outcome.assistant_text).toMatch(/Tell me what you expect it to affect/i);
  });

  it('an authored answer that SURVIVED validation still outranks the advice arm', async () => {
    const authored =
      'Effort is a judgement you own. Start by asking what it changes about your Friday takings, then say what you expect to shift.';
    const outcome = await handler(
      makeInvocation({
        message:
          "How do you recommend we add the author event's effort level to the decision?",
        adviseOnModelling: true,
        explanation: { answer_text: authored, answer_text_valid: true },
      }),
    );
    expect(outcome.assistant_text).toBe(authored);
  });

  it('typed evidence carriers still outrank the advice arm', async () => {
    const outcome = await handler(
      makeInvocation({
        message: 'How do you recommend we handle Friday Extended Hours?',
        adviseOnModelling: true,
        selectedDependenciesEvidence: {
          status: 'resolved',
          selected_label: 'Friday Extended Hours',
          dependencies: [],
          bidirected: [],
        } as unknown as HandlerInvocation['selectedDependenciesEvidence'],
      }),
    );
    expect(outcome.assistant_text).not.toMatch(/Tell me what you expect it to affect/i);
  });

  it('reports the deterministic fallback source on the advice arm', async () => {
    const outcome = await handler(
      makeInvocation({
        message: 'What should we change about how effort is represented?',
        adviseOnModelling: true,
      }),
    );
    const fact = outcome.handler_facts[0] as {
      result: { answer_source: string; answer_text_length: number };
    };
    expect(fact.result.answer_source).toBe('deterministic_fallback');
    expect(fact.result.answer_text_length).toBe(outcome.assistant_text!.length);
  });
});
