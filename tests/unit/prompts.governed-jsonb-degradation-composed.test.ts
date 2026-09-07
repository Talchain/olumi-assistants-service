/**
 * COMPOSED control: real Supabase decoding → real governed election → loader →
 * readiness coverage. Only the PostgREST client boundary is substituted.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT IS *NOT* FOR.
 *
 * The two sibling specs each bind one half and neither composes them:
 *   - `prompts.supabase-jsonb-column-degradation.test.ts` drives the REAL
 *     `SupabasePromptStore.list()` but stops at the raw adapter — it never
 *     instantiates `governPromptStore(...)`, never calls `loadPrompt()`, and
 *     never inspects coverage.
 *   - `prompts.store-failure-fail-loud.test.ts` drives `loadPrompt()` and
 *     coverage, but replaces `getPromptStore()` with a hand-written
 *     throwing/null stub — a DIFFERENT failure class, and a fixture the author
 *     wrote, which is not evidence about the real adapter.
 *
 * So the composition was unpinned in both directions, and the PR's claim is a
 * claim ABOUT the composition. This file closes exactly that gap.
 *
 * ⚠ THIS IS A CONTRACT PIN, NOT AN ASPIRATION. #1288 delivers an
 * ATTRIBUTABLE degradation, deliberately NOT a PREVENTABLE one. The assertions
 * below therefore pin the CURRENT, NARROWED contract in BOTH directions —
 * including the uncomfortable half:
 *
 *   - the malformed row DOES raise the ERROR/event signal;
 *   - a valid row does NOT;
 *   - the substituted `[]` DOES reach governed compilation as an ordinary
 *     empty list;
 *   - `loadPrompt` DOES still report `source: 'store'`, and the
 *     `critical_prompt_fetch_error` health reason DOES stay absent.
 *
 * The last two are asserted precisely BECAUSE they are the limitation. If a
 * later change makes the failure preventable — propagating `unavailable` past
 * the decoder, or flipping health — those assertions go RED. That is the point:
 * the contract then changes by a CONSCIOUS decision with a visible diff, not by
 * release prose quietly claiming a guarantee the code never had. A capability
 * this file forbids is a capability nobody can claim by accident.
 *
 * ⚠ AND THE SEMANTIC POINT IT PINS. `malformed` / `unavailable` / `known-empty`
 * are three distinct states. `PromptVersionSchema` types both columns as
 * ordinary `z.array(...).default([])`, so past the governed Zod boundary
 * substituted-empty and genuinely-empty are BYTE-IDENTICAL. The
 * `byte-identical at the governed boundary` test below asserts that directly,
 * so nobody can read this PR as having built a channel for "unknown". It did
 * not, and this file says so in executable form.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// PostgREST client boundary — the ONLY substitution. Everything above it
// (decoder, adapter, governed election, loader, readiness) is the real module.
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

// ---------------------------------------------------------------------------
// Telemetry — `importOriginal` spread, never a hand-listed factory. A bare
// factory REPLACES the module and silently drops every symbol added since
// (this estate's dominant defect class).
// ---------------------------------------------------------------------------

const logSpies = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const emitSpy = vi.fn();

vi.mock('../../src/utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/telemetry.js')>();
  return { ...actual, log: logSpies, emit: emitSpy };
});

// ---------------------------------------------------------------------------
// Store resolution — the REAL Supabase adapter behind the REAL governed store.
// This is the production construction (`store.ts` builds
// `governPromptStore(new SupabasePromptStore(...))`), not a stub.
// ---------------------------------------------------------------------------

const { SupabasePromptStore } = await import('../../src/prompts/stores/supabase.js');
const { governPromptStore } = await import('../../src/prompts/stores/governed.js');

let governedStore: any = null;

vi.mock('../../src/prompts/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/prompts/store.js')>();
  return {
    ...actual,
    isDbBackedStoreHealthy: () => true,
    getPromptStore: () => governedStore,
  };
});

const { registerAllDefaultPrompts } = await import('../../src/prompts/defaults.js');
const { loadPrompt } = await import('../../src/prompts/loader.js');
const {
  getCriticalPromptCoverage,
  promptStoreDegradationReasons,
  __resetPromptsReadyCacheForTests,
} = await import('../../src/prompts/readiness.js');
const { __resetRoutingLiveStatusProviderForTests } = await import(
  '../../src/prompts/routing-live-status.js'
);

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

function versionRow(version: number, overrides: Record<string, unknown> = {}) {
  return {
    prompt_id: PROMPT_ROW.id,
    version,
    content: 'Draft a graph.',
    variables: '[]',
    created_by: 'system',
    created_at: '2026-08-31T00:00:00.000Z',
    change_note: null,
    // `PromptDefinitionSchema` requires an EXACT 64-char hash. The governed
    // `list()` boundary parses through it, so a short fixture hash fails there
    // while the `getCompiled()` path never notices — which is itself worth
    // knowing: the two governed entry points do not validate alike.
    content_hash: 'a'.repeat(64),
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    test_cases: '[]',
    ...overrides,
  };
}

/**
 * The event name is asserted as a LITERAL. Reading it out of the registry and
 * then asserting the emit used the registry is a guard agreeing with itself —
 * it stays green through a rename to anything at all.
 */
const DEGRADED_EVENT = 'prompt.store.jsonb_column_degraded';

/** The elected version. A valid SIBLING at v1 must survive every case below. */
const ELECTED_VERSION = 2;

function degradationEvents(): Array<Record<string, any>> {
  return emitSpy.mock.calls
    .filter((call: unknown[]) => call[0] === DEGRADED_EVENT)
    .map((call: unknown[]) => call[1] as Record<string, any>);
}

/**
 * Seed the PostgREST boundary and build the production store construction.
 * `versions` are the rows `cee_prompt_versions` returns for this prompt.
 */
async function composeWith(versions: Array<Record<string, unknown>>) {
  const raw = new SupabasePromptStore({
    url: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
  });
  mockChain.error = null;
  await raw.initialize();
  governedStore = governPromptStore(raw);

  mockChain.data = [PROMPT_ROW];
  mockChain.error = null;
  mockChain.order.mockImplementation(() =>
    Promise.resolve({ data: versions, error: null }),
  );

  // Clear whatever store setup logged/emitted, so every assertion below is
  // about the DECODE and the composition, never about initialisation.
  vi.clearAllMocks();
  mockChain.order.mockImplementation(() =>
    Promise.resolve({ data: versions, error: null }),
  );
}

/** A row whose `test_cases` cannot be established as a list. */
const MALFORMED = versionRow(ELECTED_VERSION, { test_cases: '[' });
/** Its decodable twin: genuinely, positively, an empty list. */
const KNOWN_EMPTY = versionRow(ELECTED_VERSION, { test_cases: '[]' });
/** Its decodable twin, populated — the ordinary healthy row. */
const POPULATED = versionRow(ELECTED_VERSION, {
  test_cases: JSON.stringify([{ name: 'case-a', variables: { brief: 'x' } }]),
});
/** The valid sibling that must remain intact through every case. */
const VALID_SIBLING = versionRow(1, { test_cases: '[]' });

beforeAll(() => {
  registerAllDefaultPrompts();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockChain = createMockChain();
  governedStore = null;
  __resetPromptsReadyCacheForTests();
  __resetRoutingLiveStatusProviderForTests();
});

// ===========================================================================
// 1. The malformed row raises the attributable signal — through the REAL
//    governed composition, not the raw adapter.
// ===========================================================================

describe('composed: an undecodable column is attributable through governed election', () => {
  it('emits the degradation event and logs at ERROR when loadPrompt serves the row', async () => {
    await composeWith([VALID_SIBLING, MALFORMED]);

    await loadPrompt('draft_graph', { trigger: 'status', useStaging: false });

    const events = degradationEvents();
    expect(events).toHaveLength(1);
    // Bind by IDENTITY — column, reason and the elected version — never by a
    // value predicate another row could satisfy.
    expect(events[0]).toMatchObject({
      column: 'test_cases',
      reason: 'jsonb_unparseable',
      prompt_id: PROMPT_ROW.id,
      version: ELECTED_VERSION,
      outcome: 'unavailable',
    });

    // LEVEL IS LOAD-BEARING. `emit()` writes via `log.info`; during the
    // incident five level-30 events fired per probe and nothing paged.
    const errorCalls = logSpies.error.mock.calls.filter(
      (call: any[]) => call[0]?.event === DEGRADED_EVENT,
    );
    expect(errorCalls).toHaveLength(1);
  });

  it('raises the signal for a decoded NON-LIST too, with a distinct reason', async () => {
    // `'{}'` parses CLEANLY and is still not a list — it never touches the
    // decoder's catch, which is why a corpus of malformed JSON alone cannot
    // cover this branch.
    await composeWith([VALID_SIBLING, versionRow(ELECTED_VERSION, { test_cases: {} })]);

    await loadPrompt('draft_graph', { trigger: 'status', useStaging: false });

    const events = degradationEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      column: 'test_cases',
      reason: 'jsonb_not_array',
      version: ELECTED_VERSION,
    });
  });
});

// ===========================================================================
// 2. Valid rows do NOT raise it.
//
//    ABSENCE DISCIPLINE: these are absence claims about telemetry, and an
//    absence probe with no positive control is vacuous. The two tests above
//    are this file's positive control — they prove THIS spy, on THIS
//    composition, can see a real emitted degradation event. Neither absence
//    below is believable without them, and if they ever go red these are void.
// ===========================================================================

describe('composed: decodable rows raise nothing', () => {
  it('a genuinely empty serialized list emits no degradation event', async () => {
    await composeWith([VALID_SIBLING, KNOWN_EMPTY]);
    await loadPrompt('draft_graph', { trigger: 'status', useStaging: false });
    expect(degradationEvents()).toEqual([]);
  });

  it('a populated serialized list emits no degradation event', async () => {
    await composeWith([VALID_SIBLING, POPULATED]);
    await loadPrompt('draft_graph', { trigger: 'status', useStaging: false });
    expect(degradationEvents()).toEqual([]);
  });

  it('an already-parsed JS array — the incident shape — emits no degradation event', async () => {
    // The P0 row: PostgREST delivered a JS ARRAY where the row type asserted a
    // string. This must be decodable, silently and correctly.
    await composeWith([VALID_SIBLING, versionRow(ELECTED_VERSION, { test_cases: [] })]);
    await loadPrompt('draft_graph', { trigger: 'status', useStaging: false });
    expect(degradationEvents()).toEqual([]);
  });
});

// ===========================================================================
// 3. The substitution REACHES governed compilation as `[]` — and the elected
//    prompt still serves. This is the limitation, pinned deliberately.
// ===========================================================================

describe('composed: the substituted [] passes the governed boundary as an ordinary list', () => {
  it('governed list() hands the elected version testCases: [] for an undecodable column', async () => {
    await composeWith([VALID_SIBLING, MALFORMED]);

    const definitions = await governedStore.list({ taskId: 'draft_graph' });
    expect(definitions).toHaveLength(1);

    const elected = definitions[0].versions.find(
      (v: any) => v.version === ELECTED_VERSION,
    );
    expect(elected).toBeDefined();
    // The undecodable column arrives as a normal empty array. Nothing in the
    // published type can express "unknown" — see the docblock in supabase.ts.
    expect(elected.testCases).toEqual([]);

    // THE VALID SIBLING MUST REMAIN INTACT. One poisoned row must not disable
    // every version of the task — that blast radius WAS the P0.
    const sibling = definitions[0].versions.find((v: any) => v.version === 1);
    expect(sibling).toBeDefined();
    expect(sibling.testCases).toEqual([]);
    expect(sibling.content).toBe('Draft a graph.');
  });

  it('byte-identical at the governed boundary: substituted-empty vs known-empty', async () => {
    // ⚠ THE SEMANTIC PIN. If this test ever goes RED, someone has built a
    // channel for "unknown" past the decoder — which is a real improvement,
    // and MUST be a conscious, visible change rather than an assumed one.
    // #1288 explicitly does not build it, and must not be read as having done.
    await composeWith([VALID_SIBLING, MALFORMED]);
    const fromMalformed = await governedStore.list({ taskId: 'draft_graph' });
    const malformedVersion = fromMalformed[0].versions.find(
      (v: any) => v.version === ELECTED_VERSION,
    );

    vi.clearAllMocks();
    mockChain = createMockChain();
    await composeWith([VALID_SIBLING, KNOWN_EMPTY]);
    const fromEmpty = await governedStore.list({ taskId: 'draft_graph' });
    const emptyVersion = fromEmpty[0].versions.find(
      (v: any) => v.version === ELECTED_VERSION,
    );

    expect(malformedVersion.testCases).toEqual(emptyVersion.testCases);
    expect(JSON.stringify(malformedVersion.testCases)).toBe(
      JSON.stringify(emptyVersion.testCases),
    );
  });
});

// ===========================================================================
// 4. Loader source stays `store` and the fetch-error health reason stays
//    ABSENT. This is the narrowed claim's boundary, asserted as such.
// ===========================================================================

describe('composed: the degradation does NOT reach loader source or health', () => {
  it('loadPrompt still reports source: store for an undecodable column', async () => {
    await composeWith([VALID_SIBLING, MALFORMED]);

    const loaded = await loadPrompt('draft_graph', {
      trigger: 'status',
      useStaging: false,
    });

    // The prompt BODY is unaffected — this is ancillary list metadata. The
    // store read genuinely succeeded, so `store` is the honest answer.
    expect(loaded.source).toBe('store');
    expect(loaded.version).toBe(ELECTED_VERSION);
    expect(loaded.content).toBe('Draft a graph.');
  });

  it('critical_prompt_fetch_error CANNOT fire for this class', async () => {
    await composeWith([VALID_SIBLING, MALFORMED]);

    // Prove the degradation really did occur on this composition first —
    // otherwise the absence below is an assertion about nothing.
    await loadPrompt('draft_graph', { trigger: 'status', useStaging: false });
    expect(degradationEvents().length).toBeGreaterThan(0);

    __resetPromptsReadyCacheForTests();
    const coverage = await getCriticalPromptCoverage('status');

    // Nothing threw, so `loadPrompt`'s catch never ran, so `fallbackReason`
    // never became `fetch_error`, so the offender list is empty, so the alarm
    // is structurally unable to fire. Every link of that chain is the
    // NARROWED contract #1288 ships — attributable, not preventable.
    expect(coverage.fetch_error).toEqual([]);
    expect(promptStoreDegradationReasons(coverage)).toEqual([]);
  });
});
