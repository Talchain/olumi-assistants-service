/**
 * Coach/converse answer channel — schema-pressure layer (layer A) unit tests.
 *
 * The coach/converse `answer_text` channel (PR #380 / ROADMAP 1.38) is now
 * SUPERSEDED by the mandatory answer_shape (ROADMAP 1.132, F2 — unconditional
 * since the F1 flag deletion): coach/converse MUST carry a valid answer_shape,
 * and `answer_text` is DERIVED from it (single source of truth). So for
 * coach/converse the governing schema-pressure rule is now "answer_shape
 * required" — a missing shape is rejected (and its derived text is non-blank
 * by construction, so the legacy answer_text-required rule can never
 * independently govern a coach/converse call). The shape contract itself lives
 * in `tool-schema-answer-shape-enforced.test.ts`.
 *
 * This file retains the still-live answer_text-FORBIDDEN pins for
 * execute/clarify (those carry their answer via action.explanation.answer_text
 * / clarification.question). The REPAIR_ONCE retry integration lives in
 * `route-with-tool-use-answer-shape-repair.test.ts`; the compose-layer guard
 * (layer B) lives in
 * `../../__tests__/turn-executor-answer-text-compose-guard.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { ToolCallParseError, parseToolCallResponse } from '../tool-schema.js';
import { deriveAnswerTextFromShape } from '../answer-shape.js';

const VALID_SHAPE = {
  headline: 'The complete answer in one sentence.',
  bullets: ['A supporting point.'],
  detail: 'The full supporting explanation carrying the rest of the answer.',
};

describe('RawToolCallSchema — coach/converse answer channel (shape-governed)', () => {
  it('rejects a coach tool call with NO answer_shape (the shape requirement governs)', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'coach', coaching_mode: 'reframe' }),
    ).toThrow(ToolCallParseError);
    expect(() =>
      parseToolCallResponse({ intent_class: 'coach', coaching_mode: 'reframe' }),
    ).toThrow(/answer_shape is required when intent_class === "coach"/);
  });

  it('rejects a converse tool call with NO answer_shape', () => {
    expect(() => parseToolCallResponse({ intent_class: 'converse' })).toThrow(ToolCallParseError);
    expect(() => parseToolCallResponse({ intent_class: 'converse' })).toThrow(
      /answer_shape is required when intent_class === "converse"/,
    );
  });

  it('rejects a coach tool call whose ONLY answer channel is a (now-ignored) answer_text — the shape is still required', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_text: 'prose only, no shape',
      }),
    ).toThrow(/answer_shape is required/);
  });

  it('accepts a coach tool call with a valid shape; answer_text is DERIVED (non-blank by construction)', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_shape: VALID_SHAPE,
    });
    expect(result.intent_class).toBe('coach');
    if (result.intent_class === 'coach') {
      expect(result.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
      expect(result.answer_text?.trim().length).toBeGreaterThan(0);
    }
  });

  it('accepts a converse tool call with a valid shape; answer_text is DERIVED', () => {
    const result = parseToolCallResponse({
      intent_class: 'converse',
      answer_shape: VALID_SHAPE,
    });
    expect(result.intent_class).toBe('converse');
    if (result.intent_class === 'converse') {
      expect(result.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    }
  });

  it('does NOT affect execute — still rejects execute carrying a stray answer_text, still accepts execute without one', () => {
    const validExecute = {
      intent_class: 'execute' as const,
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'scen-abc',
          kind: 'option' as const,
          resolution_status: 'resolved' as const,
          resolution_method: 'id_match' as const,
        },
        parameters: [],
        cited_context_fields: [],
      },
    };
    expect(() => parseToolCallResponse(validExecute)).not.toThrow();
    expect(() =>
      parseToolCallResponse({ ...validExecute, answer_text: 'stray body' }),
    ).toThrow(/answer_text is forbidden/);
  });

  it('does NOT affect clarify — still rejects clarify carrying a stray answer_text, still accepts clarify without one', () => {
    const validClarify = {
      intent_class: 'clarify' as const,
      clarification: { ambiguity_type: 'entity' as const, question: 'Which one?' },
    };
    expect(() => parseToolCallResponse(validClarify)).not.toThrow();
    expect(() =>
      parseToolCallResponse({ ...validClarify, answer_text: 'stray body' }),
    ).toThrow(/answer_text is forbidden/);
  });
});
