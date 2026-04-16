import { describe, it, expect } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import {
  composeDirectAnswerResponse,
  composeClarifyResponse,
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
