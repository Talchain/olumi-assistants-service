/**
 * The store factory. Small, but it decides whether the flag half-works.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_REPLACEMENT_STATE, type ReplacementStateStore } from '../turn-entry.js';
import {
  ReplacementNotConfiguredError,
  getReplacementStateStore,
  setReplacementStateStore,
} from '../wiring.js';

const fake: ReplacementStateStore = {
  load: async () => ({ state: EMPTY_REPLACEMENT_STATE, revision: null }),
  save: async () => 'rev-1',
};

afterEach(() => {
  setReplacementStateStore(null);
  vi.unstubAllEnvs();
});

describe('unconfigured is visible, never a quiet degradation', () => {
  it('returns null when the environment cannot supply a store', () => {
    setReplacementStateStore(null);
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(getReplacementStateStore()).toBeNull();
  });

  it('needs BOTH variables — one alone is not a configuration', () => {
    setReplacementStateStore(null);
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(getReplacementStateStore()).toBeNull();
  });

  it('the refusal names the flag, the variables, and why process-local is not an option', () => {
    const e = new ReplacementNotConfiguredError();
    expect(e.message).toContain('CEE_REPLACEMENT_COACH_ENABLED');
    expect(e.message).toContain('SUPABASE_URL');
    expect(e.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(e.message).toContain('never saw the offer');
    expect(e.name).toBe('ReplacementNotConfiguredError');
  });
});

describe('an explicit store wins, and clearing it leaves nothing behind', () => {
  it('returns the installed store without touching the environment', () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    setReplacementStateStore(fake);
    expect(getReplacementStateStore()).toBe(fake);
  });

  it('null clears the override AND the cache, so one test cannot leak into the next', () => {
    setReplacementStateStore(fake);
    expect(getReplacementStateStore()).toBe(fake);
    setReplacementStateStore(null);
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(getReplacementStateStore()).toBeNull();
  });
});

describe('with both variables it builds one, and reuses it', () => {
  it('constructs a store and returns the SAME instance on a second call', () => {
    setReplacementStateStore(null);
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-test-only');
    const first = getReplacementStateStore();
    expect(first).not.toBeNull();
    // Contrast with the null cases above: the same function, different env,
    // genuinely different answer — so those nulls mean something.
    expect(getReplacementStateStore()).toBe(first);
  });
});
