/**
 * CEE_ANSWER_TEXT_REQUIRED — schema-pressure layer (layer A) unit tests.
 *
 * Belt-and-braces hardening for the coach/converse `answer_text` channel
 * (PR #380 / ROADMAP 1.38). Sequenced behind the prompt track's prompt-only
 * fix for the same Sonnet-5 empty-orientation defect — see
 * Docs/lanes/LANE-ANSWER-TEXT-HARDENING.md. Flag default OFF
 * (config/index.ts `features.answerTextRequired`).
 *
 * This file covers ONLY the Zod-schema layer (`RawToolCallSchema` via
 * `parseToolCallResponse`). The REPAIR_ONCE retry integration lives in
 * `route-with-tool-use-answer-text-repair.test.ts`; the compose-layer
 * guard (layer B) lives in
 * `../../__tests__/turn-executor-answer-text-compose-guard.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolCallParseError, parseToolCallResponse } from '../tool-schema.js';

let priorFlag: string | undefined;

async function setFlag(value: 'true' | undefined) {
  priorFlag = process.env.CEE_ANSWER_TEXT_REQUIRED;
  if (value === undefined) {
    delete process.env.CEE_ANSWER_TEXT_REQUIRED;
  } else {
    process.env.CEE_ANSWER_TEXT_REQUIRED = value;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_ANSWER_TEXT_REQUIRED;
  } else {
    process.env.CEE_ANSWER_TEXT_REQUIRED = priorFlag;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

describe('RawToolCallSchema — CEE_ANSWER_TEXT_REQUIRED flag OFF (default)', () => {
  beforeEach(async () => {
    await setFlag(undefined);
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('accepts a coach tool call with NO answer_text (byte-identical to pre-hardening)', () => {
    const result = parseToolCallResponse({ intent_class: 'coach', coaching_mode: 'reframe' });
    expect(result.intent_class).toBe('coach');
    if (result.intent_class === 'coach') {
      expect(result.answer_text).toBeUndefined();
    }
  });

  it('accepts a converse tool call with NO answer_text (byte-identical to pre-hardening)', () => {
    const result = parseToolCallResponse({ intent_class: 'converse' });
    expect(result.intent_class).toBe('converse');
    if (result.intent_class === 'converse') {
      expect(result.answer_text).toBeUndefined();
    }
  });

  it('accepts a coach tool call with whitespace-only answer_text (flag off — no requirement enforced)', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'coach', coaching_mode: 'reframe', answer_text: '   ' }),
    ).not.toThrow();
  });
});

describe('RawToolCallSchema — CEE_ANSWER_TEXT_REQUIRED flag ON', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('rejects a coach tool call with NO answer_text', () => {
    expect(() => parseToolCallResponse({ intent_class: 'coach', coaching_mode: 'reframe' })).toThrow(
      ToolCallParseError,
    );
    expect(() => parseToolCallResponse({ intent_class: 'coach', coaching_mode: 'reframe' })).toThrow(
      /answer_text is required when intent_class === "coach"/,
    );
  });

  it('rejects a converse tool call with NO answer_text', () => {
    expect(() => parseToolCallResponse({ intent_class: 'converse' })).toThrow(ToolCallParseError);
    expect(() => parseToolCallResponse({ intent_class: 'converse' })).toThrow(
      /answer_text is required when intent_class === "converse"/,
    );
  });

  it('rejects a coach tool call with whitespace-only answer_text (trimmed-truthiness, matches the compose-layer fallback rule)', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'coach', coaching_mode: 'reframe', answer_text: '   ' }),
    ).toThrow(/answer_text is required/);
  });

  it('rejects a converse tool call with whitespace-only answer_text', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'converse', answer_text: '\n\t ' }),
    ).toThrow(/answer_text is required/);
  });

  it('accepts a coach tool call with non-blank answer_text', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_text: 'The full coaching answer.',
    });
    expect(result.intent_class).toBe('coach');
    if (result.intent_class === 'coach') {
      expect(result.answer_text).toBe('The full coaching answer.');
    }
  });

  it('accepts a converse tool call with non-blank answer_text', () => {
    const result = parseToolCallResponse({
      intent_class: 'converse',
      answer_text: 'The full conversational answer.',
    });
    expect(result.intent_class).toBe('converse');
    if (result.intent_class === 'converse') {
      expect(result.answer_text).toBe('The full conversational answer.');
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
