import { describe, it, expect } from 'vitest';
import { rejectsSamplingParams, MODEL_REGISTRY } from '../models.js';

describe('rejectsSamplingParams', () => {
  it('is true for Sonnet 5 (registry entry)', () => {
    expect(MODEL_REGISTRY['claude-sonnet-5']?.rejectsSamplingParams).toBe(true);
    expect(rejectsSamplingParams('claude-sonnet-5')).toBe(true);
  });

  it('is false for Sonnet 4.6 (accepts temperature)', () => {
    expect(rejectsSamplingParams('claude-sonnet-4-6')).toBe(false);
  });

  it('falls back to pattern matching for unregistered affected families', () => {
    expect(rejectsSamplingParams('claude-opus-4-8')).toBe(true);
    expect(rejectsSamplingParams('claude-fable-5')).toBe(true);
    expect(rejectsSamplingParams('claude-opus-4-7-20260101')).toBe(true);
  });

  it('is false for OpenAI / older models that accept sampling params', () => {
    expect(rejectsSamplingParams('gpt-4o')).toBe(false);
    expect(rejectsSamplingParams('claude-sonnet-4-5-20250929')).toBe(false);
  });

  it('registers claude-sonnet-5 as an enabled anthropic quality model', () => {
    const m = MODEL_REGISTRY['claude-sonnet-5'];
    expect(m?.provider).toBe('anthropic');
    expect(m?.enabled).toBe(true);
    expect(m?.tier).toBe('quality');
  });
});
