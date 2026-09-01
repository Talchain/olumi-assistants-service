/**
 * Supabase prompt store — JSONB column decode DEGRADATION must be observable.
 *
 * THE DEFECT THIS PINS. PR #1288 replaced three `JSON.parse(x || '[]')` sites
 * with `parseJsonColumn`, which is correct about not throwing — but its
 * `catch { return [] }` and its trailing `return []` EMIT NOTHING. A row whose
 * `test_cases` column holds `{}` therefore degrades to `[]` with a clean health
 * surface and no log at any level. Because nothing throws, `loadPrompt` never
 * reaches its catch, `fallbackReason` never becomes `fetch_error`, and the same
 * PR's new `critical_prompt_fetch_error` alarm is structurally unable to fire
 * for the class it now tolerates.
 *
 * That converts a crash into a SILENT DEGRADATION — which is the exact failure
 * mode the PR was written to end (`draft_graph` served the bundled default for
 * ~2.5h while `/healthz` reported `prompts_ready: true`). A guard that logs
 * nothing and continues is the same outage with better manners.
 *
 * THE GOVERNING INVARIANT (standing doctrine):
 *
 *   > Failure to know is not knowledge that nothing exists.
 *
 * Three outcomes must stay DISTINGUISHABLE, and only the first may author `[]`:
 *   - `known_empty`           — read successfully, genuinely nothing there
 *   - `known_with_survivors`  — read partially, these specific items survived
 *   - `unavailable`           — could not establish what was there
 *
 * `known_with_survivors` is NOT REACHABLE for this helper: a JSON list decodes
 * whole or not at all; there is no per-item salvage here. It is named and
 * excluded deliberately rather than silently — and the "telemetry must not lie"
 * block below makes it structurally impossible for this event to ever claim
 * survivors it did not have (a sibling PR is currently emitting "recovered the
 * readable survivors" alongside `recovered_count: 0`).
 *
 * WHY THE PR'S OWN CORPUS COULD NOT SEE THIS. Its fixtures cover array, string,
 * empty string and null — every one of them a DECODABLE class. It excludes
 * `object`, `number`, `boolean`, the string `'null'`, and malformed strings, so
 * the `catch` branch and the trailing `return []` had ZERO coverage. Check what
 * a corpus EXCLUDES, not what it covers.
 *
 * ABSENCE DISCIPLINE. Every "no event was emitted" assertion below is an
 * absence claim about telemetry, and an absence probe with no positive control
 * is vacuous. `describe('positive control')` proves this file's spy can SEE a
 * real emitted event on this very module before any absence is believed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase client mock
// ---------------------------------------------------------------------------

function createMockChain() {
  const chain: any = { data: null, error: null };
  const methods = [
    'select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'order', 'limit',
    'single', 'neq',
  ];
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

/**
 * Telemetry mock, spread over `importOriginal`.
 *
 * DERIVED, NOT MIRRORED. A `vi.mock` factory REPLACES the module, so a
 * hand-listed `TelemetryEvents` object silently drops every key it forgets —
 * this estate's dominant defect class, and the sibling spec
 * `prompts.supabase-jsonb-column.test.ts` carries exactly that hand-list
 * (`{ PromptStoreError: 'prompt.store.error' }`, which is not even the real
 * value: the registry says `prompt.store_error`). Spreading the original keeps
 * the REAL registry, so every event-name assertion below binds to the shipped
 * string and a rename REDs here instead of passing against a local copy.
 */
vi.mock('../../src/utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/telemetry.js')>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/**
 * The event name is asserted as a LITERAL here and cross-checked against the
 * shipped registry in its own test below. A test that reads the name out of the
 * registry and then asserts the emit used the registry is a guard agreeing with
 * itself — it would stay green through a rename to anything at all.
 */
const DEGRADED_EVENT = 'prompt.store.jsonb_column_degraded';

describe('SupabasePromptStore — JSONB column degradation is observable', () => {
  let SupabasePromptStore: any;
  let telemetry: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockChain = createMockChain();
    telemetry = await import('../../src/utils/telemetry.js');
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
    // Clear whatever initialisation logged/emitted so every assertion below is
    // about the DECODE, not about store setup.
    vi.clearAllMocks();
    return store;
  }

  /** Drive `list({ taskId })` — the PRODUCTION serving path (see below). */
  async function listWith(versions: Array<Record<string, unknown>>) {
    const store = await makeStore();
    mockChain.data = [PROMPT_ROW];
    mockChain.error = null;
    mockChain.order.mockImplementation(() => Promise.resolve({ data: versions, error: null }));
    return store.list({ taskId: 'draft_graph' });
  }

  /** Every `emit()` call for the degradation event, by exact event name. */
  function degradationEvents(): Array<Record<string, any>> {
    return telemetry.emit.mock.calls
      .filter((call: unknown[]) => call[0] === DEGRADED_EVENT)
      .map((call: unknown[]) => call[1] as Record<string, any>);
  }

  // =========================================================================
  // POSITIVE CONTROL — prove the probe can SEE a presence.
  // =========================================================================

  describe('positive control (the absence assertions are worthless without it)', () => {
    /**
     * `initialize()` failure emits `TelemetryEvents.PromptStoreError` from this
     * very module through this very `emit` spy. If this test fails, EVERY
     * "no event was emitted" assertion in this file is vacuous and none of the
     * results below may be believed.
     */
    it('the emit spy observes a REAL event emitted by this module', async () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });
      mockChain.error = { message: 'connection refused' };

      await expect(store.initialize()).rejects.toThrow();

      const storeErrors = telemetry.emit.mock.calls.filter(
        (call: unknown[]) => call[0] === telemetry.TelemetryEvents.PromptStoreError,
      );
      expect(storeErrors).toHaveLength(1);
      expect(storeErrors[0][1]).toMatchObject({ operation: 'initialize' });
      // And the spy is bound to the REAL registry value, not a local copy.
      expect(telemetry.TelemetryEvents.PromptStoreError).toBe('prompt.store_error');
    });

    /**
     * CONTRAST CONTROL for the filter itself. A filter that silently matches
     * nothing returns the same empty array as a genuine absence — so prove the
     * filter discriminates: it must find `PromptStoreError` and NOT find the
     * degradation event on the same call log.
     */
    it('the degradation-event filter DISCRIMINATES rather than matching nothing', async () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });
      mockChain.error = { message: 'connection refused' };
      await expect(store.initialize()).rejects.toThrow();

      expect(telemetry.emit.mock.calls.length).toBeGreaterThan(0);
      expect(degradationEvents()).toHaveLength(0);
    });
  });

  // =========================================================================
  // THE DEFECT — undecodable columns must NOT degrade silently.
  // =========================================================================

  /**
   * The classes the PR's corpus EXCLUDES. Every one of these reaches either the
   * `catch` or the trailing `return []`, both of which are uncovered at
   * pristine. `'null'` and `'{"a":1}'` are the sharp ones: they parse
   * SUCCESSFULLY and then fail the `Array.isArray` check, so they never touch
   * the `catch` — a corpus built only from "malformed JSON" would miss them.
   */
  const UNDECODABLE = [
    { label: 'a JSONB OBJECT (`{}`) — the reviewers\' named case', value: {}, valueType: 'object', reason: 'jsonb_not_array' },
    { label: 'a populated JSONB object', value: { a: 1 }, valueType: 'object', reason: 'jsonb_not_array' },
    { label: 'a NUMBER', value: 42, valueType: 'number', reason: 'jsonb_not_array' },
    { label: 'a BOOLEAN', value: true, valueType: 'boolean', reason: 'jsonb_not_array' },
    { label: 'the string "null" (parses cleanly, is not a list)', value: 'null', valueType: 'string', reason: 'jsonb_not_array' },
    { label: 'a JSON OBJECT string (parses cleanly, is not a list)', value: '{"a":1}', valueType: 'string', reason: 'jsonb_not_array' },
    { label: 'a malformed JSON string (hits the catch)', value: '[1,2', valueType: 'string', reason: 'jsonb_unparseable' },
    { label: 'a non-JSON string (hits the catch)', value: 'not json at all', valueType: 'string', reason: 'jsonb_unparseable' },
  ] as const;

  describe('an undecodable column emits a degradation event', () => {
    it.each(UNDECODABLE)(
      'test_cases: $label',
      async ({ value, valueType, reason }) => {
        const result = await listWith([versionRow(7, { test_cases: value })]);

        // It still does not throw — the PR's blast-radius fix is retained.
        expect(result[0].versions[0].testCases).toEqual([]);

        const events = degradationEvents();
        expect(events).toHaveLength(1);
        // Bind by IDENTITY: the exact column, prompt and version — never a
        // value predicate another column or row could satisfy.
        expect(events[0]).toMatchObject({
          column: 'test_cases',
          prompt_id: 'prompt-draft-graph',
          version: 7,
          reason,
          value_type: valueType,
          outcome: 'unavailable',
        });
      },
    );

    it.each(UNDECODABLE)(
      'variables: $label',
      async ({ value, valueType, reason }) => {
        const result = await listWith([versionRow(7, { variables: value })]);

        expect(result[0].versions[0].variables).toEqual([]);

        const events = degradationEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          column: 'variables',
          prompt_id: 'prompt-draft-graph',
          version: 7,
          reason,
          value_type: valueType,
          outcome: 'unavailable',
        });
      },
    );

    /**
     * LEVEL IS LOAD-BEARING. `emit()` logs via `log.info` (telemetry.ts), so an
     * event alone lands at level 30 and cannot trip level-based alerting —
     * exactly why five `prompt.loader.error` events fired per probe during the
     * incident and nothing paged, and exactly why this PR's own `loader.ts`
     * change was to raise a `log.warn` to `log.error`. A degradation that only
     * `emit()`s repeats the defect one layer down.
     */
    it('ALSO logs at ERROR level, so a level filter can see it', async () => {
      await listWith([versionRow(7, { test_cases: {} })]);

      expect(telemetry.log.error).toHaveBeenCalledTimes(1);
      expect(telemetry.log.error.mock.calls[0][0]).toMatchObject({
        event: DEGRADED_EVENT,
        column: 'test_cases',
        prompt_id: 'prompt-draft-graph',
        version: 7,
      });
    });

    /**
     * The event name is part of the contract an operator's alert rule binds to.
     * Pin it as a literal AND assert the registry agrees, so a rename cannot
     * silently orphan a dashboard.
     */
    it('is registered in TelemetryEvents under the exact shipped name', () => {
      expect(telemetry.TelemetryEvents.PromptStoreJsonColumnDegraded).toBe(DEGRADED_EVENT);
    });
  });

  // =========================================================================
  // THE TELEMETRY MUST NOT LIE — both directions.
  // =========================================================================

  describe('the event never lies about what was read', () => {
    /**
     * Direction 1: an `unavailable` verdict may never ship alongside data.
     * This is the structural pin against the sibling defect ("recovered the
     * readable survivors" emitted with `recovered_count: 0"). Here there is no
     * salvage path at all, so the event must carry NO survivor/recovery
     * vocabulary — asserted over the payload's KEYS, which makes the lie
     * impossible to add later without reddening this test.
     */
    it('carries no survivor/recovery vocabulary it could not honour', async () => {
      const result = await listWith([versionRow(7, { test_cases: { a: 1 } })]);

      const [payload] = degradationEvents();
      expect(payload).toBeDefined();

      const dishonest = Object.keys(payload).filter((k) =>
        /recover|surviv|salvag|partial|parsed_count|item_count/i.test(k),
      );
      expect(dishonest).toEqual([]);

      // And the verdict matches the value actually returned: nothing.
      expect(payload.outcome).toBe('unavailable');
      expect(result[0].versions[0].testCases).toEqual([]);
    });

    /**
     * Direction 2 — the inverse lie, and the one a one-directional corpus never
     * sees. A DECODABLE column must emit NOTHING. An alarm that also fires on
     * healthy shapes is a permanent amber light, i.e. no alarm at all; this is
     * the same reasoning the PR itself used to scope `critical_prompt_fetch_error`
     * away from `all_pms`.
     */
    const DECODABLE = [
      { label: 'an already-parsed empty ARRAY (the incident shape)', value: [] as unknown },
      { label: 'an already-parsed populated ARRAY', value: [{ name: 'tc-1' }] as unknown },
      { label: 'the STRING "[]"', value: '[]' as unknown },
      { label: 'a populated JSON ARRAY string', value: '[{"name":"tc-1"}]' as unknown },
      { label: 'an EMPTY STRING', value: '' as unknown },
      { label: 'a whitespace-only string', value: '   ' as unknown },
      { label: 'NULL', value: null as unknown },
      { label: 'undefined (column absent from the row)', value: undefined as unknown },
    ] as const;

    it.each(DECODABLE)('$label emits NOTHING and logs no error', async ({ value }) => {
      await listWith([versionRow(7, { test_cases: value, variables: value })]);

      expect(degradationEvents()).toEqual([]);
      expect(telemetry.log.error).not.toHaveBeenCalled();
      expect(telemetry.log.warn).not.toHaveBeenCalled();
    });

    /**
     * `known_empty` and `unavailable` must be DISTINGUISHABLE from outside.
     * Both return `[]`, so the returned value alone cannot tell them apart —
     * the telemetry is the only discriminator, and this asserts it discriminates
     * on ONE call log rather than across two runs (which a blind spy could fake).
     */
    it('distinguishes known_empty from unavailable on the SAME call log', async () => {
      const result = await listWith([
        versionRow(1, { test_cases: [] }),           // known_empty
        versionRow(2, { test_cases: {} }),           // unavailable
        versionRow(3, { test_cases: '[{"name":"tc-3"}]' }), // known, populated
      ]);

      // Every version still decodes — the blast-radius fix is retained.
      expect(result[0].versions.map((v: any) => v.version)).toEqual([1, 2, 3]);
      expect(result[0].versions[0].testCases).toEqual([]);
      expect(result[0].versions[1].testCases).toEqual([]);
      expect(result[0].versions[2].testCases).toEqual([{ name: 'tc-3' }]);

      // …but exactly ONE of the two empty results is reported as unavailable,
      // and it is version 2 BY IDENTITY, not "one of them".
      const events = degradationEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ version: 2, column: 'test_cases' });
    });

    /**
     * Both columns undecodable on one row: two independent readings, two
     * independent events. A single coalesced event would under-report the
     * damage, and a shared counter would be the "one number for two questions"
     * shape this estate keeps paying for.
     */
    it('reports each undecodable column separately, bound to its own name', async () => {
      await listWith([versionRow(7, { test_cases: {}, variables: 'not json' })]);

      const events = degradationEvents();
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.column).sort()).toEqual(['test_cases', 'variables']);
      expect(events.find((e) => e.column === 'variables')!.reason).toBe('jsonb_unparseable');
      expect(events.find((e) => e.column === 'test_cases')!.reason).toBe('jsonb_not_array');
    });
  });

  // =========================================================================
  // getCompiled — the raw-adapter path carries the same helper.
  // =========================================================================

  describe('getCompiled() — the same helper, the same obligation', () => {
    async function getCompiledWith(version: Record<string, unknown>) {
      const store = await makeStore();
      mockChain.limit.mockImplementation(() => Promise.resolve({ data: [PROMPT_ROW], error: null }));
      mockChain.single.mockImplementation(() => Promise.resolve({ data: version, error: null }));
      return store.getCompiled('draft_graph', { brief: 'launch plan' });
    }

    it('emits the degradation event for an undecodable variables column', async () => {
      const compiled = await getCompiledWith(versionRow(2, { variables: { a: 1 } }));

      expect(compiled).not.toBeNull();
      const events = degradationEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        column: 'variables',
        prompt_id: 'prompt-draft-graph',
        version: 2,
        reason: 'jsonb_not_array',
        outcome: 'unavailable',
      });
    });

    it('emits NOTHING for a decodable variables column', async () => {
      await getCompiledWith(versionRow(2, { variables: '[{"name":"brief","required":true}]' }));

      expect(degradationEvents()).toEqual([]);
      expect(telemetry.log.error).not.toHaveBeenCalled();
    });
  });
});
