import { describe, it, expect } from 'vitest';
import { rejectsSamplingParams, anthropicTemperatureFor, MODEL_REGISTRY } from '../models.js';

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

// FINAL-SWEEP F2 — the single-sourced temperature policy that replaced the 5
// hand-copied `rejectsSamplingParams(model) ? undefined : (thinking ? 1 : req)`
// ternaries. Pins every rule + the exact input shapes of the 5 former call sites,
// so the helper is BYTE-IDENTICAL to what each site produced.
describe('anthropicTemperatureFor', () => {
  it('OMITS temperature (undefined) for a model that rejects sampling params — gate wins over thinking', () => {
    expect(anthropicTemperatureFor('claude-sonnet-5', { requested: 0, thinking: false })).toBeUndefined();
    expect(anthropicTemperatureFor('claude-sonnet-5', { thinking: true })).toBeUndefined();
    expect(anthropicTemperatureFor('claude-opus-4-8', { requested: 0.7, thinking: false })).toBeUndefined();
  });

  it('returns 1 when extended thinking is active (non-rejecting model)', () => {
    expect(anthropicTemperatureFor('claude-sonnet-4-6', { thinking: true })).toBe(1);
    expect(anthropicTemperatureFor('claude-sonnet-4-6', { requested: 0.5, thinking: true })).toBe(1);
  });

  it('returns the caller-requested temperature (default 0) otherwise', () => {
    // draft-site shape: no `requested` → default 0
    expect(anthropicTemperatureFor('claude-sonnet-4-6', { thinking: false })).toBe(0);
    // chat/stream/admin shape: requested ?? 0
    expect(anthropicTemperatureFor('claude-sonnet-4-6', { requested: 0.3, thinking: false })).toBe(0.3);
    expect(anthropicTemperatureFor('claude-sonnet-4-6', { requested: null, thinking: false })).toBe(0);
    expect(anthropicTemperatureFor('claude-sonnet-4-6', { requested: undefined, thinking: false })).toBe(0);
  });
});
