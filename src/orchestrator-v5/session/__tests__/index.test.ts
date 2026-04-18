/**
 * getSessionStore() factory + env-parsing unit tests (slice B).
 *
 * Call-time env read is load-bearing — these tests assert that behaviour
 * (a future maintainer who "optimises" back to module-load will break them).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  SESSION_CACHE_MAX_SCENARIOS_DEFAULT,
  SESSION_CACHE_MAX_TURNS_PER_SCENARIO_DEFAULT,
  SESSION_READ_WINDOW_DEFAULT,
  getSessionStore,
  resetSessionStoreForTests,
} from '../index.js';

const ORIGINAL_ENV = { ...process.env };

describe('getSessionStore', () => {
  beforeEach(() => {
    resetSessionStoreForTests();
    // Start each test from a clean env — explicitly unset all session vars
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SESSION_READ_WINDOW_TURNS;
    delete process.env.SESSION_CACHE_MAX_SCENARIOS;
    delete process.env.SESSION_CACHE_MAX_TURNS_PER_SCENARIO;
  });

  afterEach(() => {
    resetSessionStoreForTests();
    process.env = { ...ORIGINAL_ENV };
  });

  it('throws when SUPABASE_URL is missing', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
    expect(() => getSessionStore()).toThrow(/SUPABASE_URL/);
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    expect(() => getSessionStore()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('returns a singleton (same instance on repeated calls)', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
    const a = getSessionStore();
    const b = getSessionStore();
    expect(a).toBe(b);
  });

  it('resetSessionStoreForTests allows a fresh instance to be constructed', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
    const a = getSessionStore();
    resetSessionStoreForTests();
    const b = getSessionStore();
    expect(a).not.toBe(b);
  });

  it('reads env AT CALL TIME, not at module load (vi.stubEnv equivalence)', () => {
    // First call without env should throw; setting env then calling again
    // should succeed. This would fail if env were captured at module load.
    expect(() => getSessionStore()).toThrow();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
    expect(() => getSessionStore()).not.toThrow();
  });
});

describe('getSessionStore env defaults', () => {
  beforeEach(() => {
    resetSessionStoreForTests();
    delete process.env.SESSION_READ_WINDOW_TURNS;
    delete process.env.SESSION_CACHE_MAX_SCENARIOS;
    delete process.env.SESSION_CACHE_MAX_TURNS_PER_SCENARIO;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
  });

  afterEach(() => {
    resetSessionStoreForTests();
    process.env = { ...ORIGINAL_ENV };
  });

  it('exposes the documented defaults', () => {
    expect(SESSION_READ_WINDOW_DEFAULT).toBe(20);
    expect(SESSION_CACHE_MAX_SCENARIOS_DEFAULT).toBe(100);
    expect(SESSION_CACHE_MAX_TURNS_PER_SCENARIO_DEFAULT).toBe(50);
  });

  it('does not throw when session-bound env vars are absent (falls back to defaults)', () => {
    // Missing SESSION_* env — the factory must still succeed using defaults.
    expect(() => getSessionStore()).not.toThrow();
  });

  it('does not throw when SESSION_READ_WINDOW_TURNS is malformed (falls back)', () => {
    process.env.SESSION_READ_WINDOW_TURNS = 'not-a-number';
    expect(() => getSessionStore()).not.toThrow();
  });

  it('does not throw when SESSION_CACHE_MAX_SCENARIOS is zero or negative (falls back)', () => {
    process.env.SESSION_CACHE_MAX_SCENARIOS = '0';
    expect(() => getSessionStore()).not.toThrow();
    resetSessionStoreForTests();
    process.env.SESSION_CACHE_MAX_SCENARIOS = '-5';
    expect(() => getSessionStore()).not.toThrow();
  });
});
