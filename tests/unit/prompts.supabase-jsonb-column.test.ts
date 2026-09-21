/**
 * Supabase prompt store — JSONB column decode guard.
 *
 * INCIDENT (P0, ~2.5h prompt-store outage): `cee_prompt_versions.test_cases`
 * came back from PostgREST as a JS ARRAY (`[]`) rather than the string `"[]"`
 * that `VersionRow` declared. An empty array is TRUTHY, so `x || '[]'` did NOT
 * substitute the fallback; `JSON.parse([])` coerces via `String([]) === ''` and
 * throws `SyntaxError: Unexpected end of JSON input`.
 *
 * Blast radius was TOTAL for the task: `list({ taskId })` decodes EVERY version
 * row before any version pointer is consulted, so one poisoned row disabled
 * every version of `draft_graph` and a staging-pointer rollback could not help.
 *
 * WHY THE EXISTING SUITE WAS GREEN: every fixture in the corpus spells
 * `test_cases: '[]'` — the STRING form. A corpus that omits a value class the
 * column admits cannot certify the code over that class. These cases exercise
 * the ARRAY form and RETAIN the string form; both must pass.
 *
 * The sibling `stores/postgres.ts` has carried the `typeof === 'string'` guard
 * all along. This pins the same contract on the Supabase store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

function createMockChain() {
  const chain: any = { data: null, error: null };
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'order', 'limit', 'single', 'neq'];
  methods.forEach((method) => {
    chain[method] = vi.fn(() => chain);
  });
  return chain;
}

let mockChain = createMockChain();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => mockChain),
  })),
}));

vi.mock('../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: { PromptStoreError: 'prompt.store.error' },
}));

const PROMPT_ROW = {
  id: 'prompt-draft-graph',
  name: 'Draft graph',
  description: null,
  task_id: 'draft_graph',
  status: 'production',
  active_version: 2,
  staging_version: null,
  design_version: null,
  model_config: null,
  tags: [],
  created_at: '2026-08-31T00:00:00.000Z',
  updated_at: '2026-08-31T00:00:00.000Z',
};

function versionRow(version: number, overrides: Record<string, unknown>) {
  return {
    prompt_id: PROMPT_ROW.id,
    version,
    content: 'Draft a graph for {{brief}}',
    variables: '[]',
    created_by: 'system',
    created_at: '2026-08-31T00:00:00.000Z',
    change_note: null,
    content_hash: 'abc123',
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    test_cases: '[]',
    ...overrides,
  };
}

describe('SupabasePromptStore — JSONB column decode guard', () => {
  let SupabasePromptStore: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockChain = createMockChain();
    const module = await import('../../src/prompts/stores/supabase.js');
    SupabasePromptStore = module.SupabasePromptStore;
  });

  async function makeStore() {
    const store = new SupabasePromptStore({
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
    });
    mockChain.error = null;
    await store.initialize();
    return store;
  }

  /** Drive `list({ taskId })` against a fixed set of version rows. */
  async function listWith(versions: Array<Record<string, unknown>>) {
    const store = await makeStore();
    mockChain.data = [PROMPT_ROW];
    mockChain.error = null;
    mockChain.order.mockImplementation(() => Promise.resolve({ data: versions, error: null }));
    return store.list({ taskId: 'draft_graph' });
  }

  describe('list() — the incident path (toPromptDefinition)', () => {
    // RED at pristine: JSON.parse([]) → SyntaxError: Unexpected end of JSON input
    it('decodes test_cases delivered as a JS ARRAY (the poisoned-row shape) without throwing', async () => {
      const result = await listWith([versionRow(1, { test_cases: [] })]);

      expect(result).toHaveLength(1);
      expect(result[0].versions[0].testCases).toEqual([]);
    });

    it('decodes variables delivered as a JS ARRAY without throwing', async () => {
      const result = await listWith([versionRow(1, { variables: [] })]);

      expect(result[0].versions[0].variables).toEqual([]);
    });

    it('passes a NON-EMPTY array column through as parsed data, not re-parsed', async () => {
      const testCases = [{ name: 'tc-1', variables: { brief: 'x' } }];
      const variables = [{ name: 'brief', required: true }];

      const result = await listWith([versionRow(1, { test_cases: testCases, variables })]);

      expect(result[0].versions[0].testCases).toEqual(testCases);
      expect(result[0].versions[0].variables).toEqual(variables);
    });

    it('treats a NULL column as the empty list', async () => {
      const result = await listWith([versionRow(1, { test_cases: null, variables: null })]);

      expect(result[0].versions[0].testCases).toEqual([]);
      expect(result[0].versions[0].variables).toEqual([]);
    });

    // RETAINED: the string form the whole existing corpus uses must keep working.
    it('RETAINS the STRING form — "[]" and a populated JSON string still parse', async () => {
      const result = await listWith([
        versionRow(1, { test_cases: '[]', variables: '[]' }),
        versionRow(2, {
          test_cases: '[{"name":"tc-1"}]',
          variables: '[{"name":"brief","required":true}]',
        }),
      ]);

      expect(result[0].versions[0].testCases).toEqual([]);
      expect(result[0].versions[0].variables).toEqual([]);
      expect(result[0].versions[1].testCases).toEqual([{ name: 'tc-1' }]);
      expect(result[0].versions[1].variables).toEqual([{ name: 'brief', required: true }]);
    });

    it('treats an EMPTY STRING column as the empty list (the || \'[]\' case, retained)', async () => {
      const result = await listWith([versionRow(1, { test_cases: '', variables: '' })]);

      expect(result[0].versions[0].testCases).toEqual([]);
      expect(result[0].versions[0].variables).toEqual([]);
    });

    /**
     * The blast-radius pin. `list()` decodes every version row up front, so at
     * pristine ONE array-form row took down all three versions of the task —
     * which is why a staging-pointer rollback could not recover the incident.
     * Bind by IDENTITY (the version numbers), not by a count another set could
     * satisfy.
     */
    it('one array-form row does NOT take down the sibling versions of the same prompt', async () => {
      const result = await listWith([
        versionRow(1, { test_cases: '[]' }),
        versionRow(2, { test_cases: [] }), // the poisoned row
        versionRow(3, { test_cases: '[{"name":"tc-3"}]' }),
      ]);

      expect(result[0].versions.map((v: any) => v.version)).toEqual([1, 2, 3]);
      expect(result[0].versions[1].testCases).toEqual([]);
      expect(result[0].versions[2].testCases).toEqual([{ name: 'tc-3' }]);
    });
  });

  describe('getCompiled() — the identical latent defect on versionVariables', () => {
    async function getCompiledWith(version: Record<string, unknown>) {
      const store = await makeStore();
      mockChain.limit.mockImplementation(() => Promise.resolve({ data: [PROMPT_ROW], error: null }));
      mockChain.single.mockImplementation(() => Promise.resolve({ data: version, error: null }));
      return store.getCompiled('draft_graph', { brief: 'launch plan' });
    }

    // RED at pristine: same SyntaxError, one call frame further up.
    it('decodes version variables delivered as a JS ARRAY without throwing', async () => {
      const compiled = await getCompiledWith(versionRow(2, { variables: [] }));

      expect(compiled).not.toBeNull();
      expect(compiled.version).toBe(2);
      expect(compiled.content).toBe('Draft a graph for launch plan');
    });

    it('RETAINS the STRING form for version variables', async () => {
      const compiled = await getCompiledWith(
        versionRow(2, { variables: '[{"name":"brief","required":true}]' }),
      );

      expect(compiled.content).toBe('Draft a graph for launch plan');
    });

    it('treats a NULL version-variables column as the empty list', async () => {
      const compiled = await getCompiledWith(versionRow(2, { variables: null }));

      expect(compiled.content).toBe('Draft a graph for launch plan');
    });
  });
});
