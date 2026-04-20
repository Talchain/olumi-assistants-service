import { describe, it, expect } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  composeDirectAnswerResponse,
  composeClarifyResponse,
  composeToolCallResponse,
} from '../compose.js';

describe('composeDirectAnswerResponse', () => {
  it('produces an OlumiResponseSchema-valid success envelope', () => {
    const env = composeDirectAnswerResponse({
      assistant_text: 'hello world',
      stage: 'frame',
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.response_version).toBe(2);
    expect(parsed.assistant_text).toBe('hello world');
    expect(parsed.blocks).toEqual([]);
    expect(parsed.suggested_actions).toEqual([]);
    expect(parsed.insights).toEqual([]);
    expect(parsed.stage_indicator).toBe('frame');
  });

  it('omits any session state / lineage fields not on the schema (constraint 6)', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    // .strict() rejects extra fields; verify none leaked.
    expect(Object.keys(env).sort()).toEqual(
      [
        'assistant_text',
        'blocks',
        'insights',
        'response_version',
        'stage_indicator',
        'suggested_actions',
      ].sort(),
    );
  });
});

describe('composeClarifyResponse (A2)', () => {
  it('produces an OlumiResponseSchema-valid clarify envelope', () => {
    const env = composeClarifyResponse({
      assistant_text: 'What decision are you weighing?',
      stage: 'frame',
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.response_version).toBe(2);
    expect(parsed.assistant_text).toBe('What decision are you weighing?');
    expect(parsed.blocks).toEqual([]);
    expect(parsed.suggested_actions).toEqual([]);
    expect(parsed.insights).toEqual([]);
    expect(parsed.stage_indicator).toBe('frame');
  });

  it('produces the same field set as direct_answer (structural parity)', () => {
    const ans = composeDirectAnswerResponse({ assistant_text: 'a', stage: 'frame' });
    const clar = composeClarifyResponse({ assistant_text: 'c', stage: 'frame' });
    expect(Object.keys(ans).sort()).toEqual(Object.keys(clar).sort());
  });
});

describe('composeToolCallResponse (V5 Group 1 Task B)', () => {
  const baseInput = {
    orientation: 'Running the analysis.',
    confirmation: 'Ran analysis on your current scenario.',
    coaching: null as string | null,
    stage: 'analyse' as const,
  };

  function runAnalysisFact(enrichment?: Record<string, unknown>): HandlerFact {
    return {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 'scen-a',
        leading_option_id: 'opt-1',
        summary: 'Ran analysis on your current scenario.',
        ...(enrichment !== undefined ? { enrichment } : {}),
      },
    };
  }

  it('emits no blocks when no handlerFacts are supplied (backward compatible)', () => {
    const env = composeToolCallResponse(baseInput);
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.blocks).toEqual([]);
  });

  it('emits an analysis_result block for a run_analysis fact without enrichment (thin content)', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [runAnalysisFact()],
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.blocks).toHaveLength(1);
    const block = parsed.blocks[0];
    expect(block.type).toBe('analysis_result');
    if (block.type !== 'analysis_result') throw new Error('narrowing');
    expect(block.summary).toBe('Ran analysis on your current scenario.');
    expect(block.leading_option_id).toBe('opt-1');
    expect(block.enrichment).toBeUndefined();
  });

  it('emits an analysis_result block with enrichment.decision_review when Task B completed', () => {
    const enrichment = {
      meta: { seed_used: 1, n_samples: 100, response_hash: 'h' },
      results: [{ option_id: 'opt-1', win_probability: 0.7 }],
      decision_review: {
        narrative_summary: 'option A wins',
        story_headlines: ['A ahead'],
      },
    };
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [runAnalysisFact(enrichment)],
    });
    const parsed = OlumiResponseSchema.parse(env);
    const block = parsed.blocks[0];
    if (block.type !== 'analysis_result') throw new Error('narrowing');
    expect(block.enrichment?.decision_review).toEqual(enrichment.decision_review);
    expect(block.enrichment?.results).toEqual(enrichment.results);
  });

  it('produces the same shape whether decision_review enrichment is present or absent (regression guard)', () => {
    const withoutDR = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [runAnalysisFact({ results: [{ option_id: 'opt-1' }] })],
    });
    const withDR = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [
        runAnalysisFact({
          results: [{ option_id: 'opt-1' }],
          decision_review: { narrative_summary: 'x' },
        }),
      ],
    });
    // Both parse against the boundary schema:
    OlumiResponseSchema.parse(withoutDR);
    OlumiResponseSchema.parse(withDR);
    // Both have exactly one analysis_result block; only enrichment.decision_review differs:
    expect(withoutDR.blocks).toHaveLength(1);
    expect(withDR.blocks).toHaveLength(1);
    const blockA = withoutDR.blocks[0];
    const blockB = withDR.blocks[0];
    if (blockA.type !== 'analysis_result' || blockB.type !== 'analysis_result') {
      throw new Error('narrowing');
    }
    expect(blockA.enrichment?.decision_review).toBeUndefined();
    expect(blockB.enrichment?.decision_review).toEqual({ narrative_summary: 'x' });
  });

  it('appends coaching text to assistant_text (Task C preview)', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      coaching: 'This is your first analysis.',
    });
    expect(env.assistant_text).toContain('Running the analysis.');
    expect(env.assistant_text).toContain('Ran analysis');
    expect(env.assistant_text).toContain('This is your first analysis.');
  });
});
