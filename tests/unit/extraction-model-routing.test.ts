import { describe, expect, it } from 'vitest';
import { resolveExtractionAssignment } from '../../src/adapters/llm/extraction.js';
import { AUXILIARY_MODEL_DEFAULTS } from '../../src/config/model-routing.js';

describe('extraction model authority', () => {
  it('lands on the checked-in GPT-4.1 assignment and its provider when env is absent', () => {
    expect(resolveExtractionAssignment('anthropic', undefined, undefined)).toEqual({
      model: AUXILIARY_MODEL_DEFAULTS.extraction,
      provider: 'openai',
      source: 'task_default',
    });
  });

  it('lets the dedicated env model win and follows it across providers', () => {
    expect(
      resolveExtractionAssignment('openai', undefined, 'claude-haiku-4-5'),
    ).toEqual({
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
      source: 'env_var',
    });
  });

  it('gives an explicit override precedence over the env assignment', () => {
    expect(
      resolveExtractionAssignment(
        'anthropic',
        'gpt-4.1-2025-04-14',
        'claude-haiku-4-5',
      ),
    ).toEqual({
      model: 'gpt-4.1-2025-04-14',
      provider: 'openai',
      source: 'per_call',
    });
  });

  it('keeps the fixture adapter hermetic while preserving resolved-model evidence', () => {
    expect(resolveExtractionAssignment('fixtures', undefined, undefined)).toEqual({
      model: AUXILIARY_MODEL_DEFAULTS.extraction,
      provider: 'fixtures',
      source: 'task_default',
    });
  });
});
