/**
 * ============================================================================
 *  PHASE 2A LANDED — RED-STATE BASELINE PARTIALLY RETIRED
 * ============================================================================
 *  This file was authored in Phase 1 with six `it.fails(...)` tests
 *  encoding Phase 2 deliverables. Phase 2A (safe coaching defaults +
 *  additive telemetry) landed in this diff, flipping six contracts:
 *
 *    A4   — new "legacy_array_wrapped" event emits with metadata
 *    A4b  — both old and new events emit additively
 *    A5   — coaching populated with safe defaults
 *    A6   — coaching is non-null and jargon-free
 *    D1   — assistantText contains the safe coaching default
 *    D2   — completion telemetry has has_coaching=true
 *
 *  Per the `.fails` removal checklist:
 *    1. Each test was run under `.fails` and observed UNEXPECTED PASS.
 *    2. Each assertion was verified to pass for the INTENDED reason
 *       (not coincidentally) — see the per-test report in the Phase 2A
 *       summary.
 *    3. `.fails` modifiers removed only after step 2.
 *    4. Two paired *-green tests (A4-green, A6-green) pinned obsolete
 *       pre-Phase-2A contracts and were REMOVED in the same diff —
 *       their assertions are now subsumed by A4 and A5/A6 respectively.
 *    5. Four paired *-green tests retained (A4b-green, A5-green,
 *       D1-green, D2-green) because their invariants remain valid
 *       post-Phase-2A.
 *
 *  Phase 2A scope explicitly DID NOT include:
 *    - the captured-payload regression (A7 — still it.todo, gated by
 *      DL-5)
 *    - V5 integration acceptance (DL-7: receipt/recent_changes,
 *      handler facts, prior_facts contract test)
 *    - prompt-patch upload, model-routing changes, PMS edits
 *
 *  Full edit_graph v9 completion remains blocked by DL-5 (incident
 *  closure) and DL-7 (V5 integration acceptance). See
 *  Docs/edit_graph_v9_deferred_items.md.
 * ============================================================================
 *
 * edit_graph v9 — Phase 1 failing tests + Phase 2A safe-defaults landed.
 * Bare-array safe-envelope wrapping and malformed-operation Zod behaviour.
 *
 * Scope:
 *  - Production-pattern gold case: top-level operations array with
 *    otherwise well-formed operations.
 *
 *    Phase 2A landed (commit `13dd9b4d`, deployed 2026-05-09). The
 *    bare-array branch of parseEditGraphResponse now populates safe
 *    coaching defaults (when length > 0) and emits the additive
 *    `legacy_array_wrapped` telemetry alongside the preserved
 *    `legacy_array_response`. The synthetic gold case mutates
 *    successfully end-to-end with a non-null assistantText
 *    containing "Proposed graph edit." (D1 + D2). For an EMPTY
 *    bare-array (`[]`), Phase 2A polish (added in response to a
 *    review finding) gates coaching=null so the existing empty-ops
 *    fallback at edit-graph.ts:1637 fires the literal "No changes
 *    were needed for this request." instead of the safe coaching
 *    string (A8 / A8b / D3-no-op).
 *
 *    KNOWN GAP — DL-5: exact production parse/validation failure
 *    payload is NOT AVAILABLE. The synthetic case reproduces the
 *    user-facing coaching gap that Phase 2A fixed, but does NOT
 *    exercise whatever hard parse or structural failure was seen in
 *    production. A7 below remains `it.todo` until a captured payload
 *    arrives; that is the DL-5 incident-closure gate.
 *
 *  - Markdown-wrapped JSON: assertions encode CURRENT parser policy
 *    (extractJson at src/orchestrator/tools/edit-graph.ts:2576), not
 *    desired future policy. Sharp edges (greedy {[\s\S]*},
 *    single-fence-only) are documented as DL-3 findings.
 *
 *  - old_value: tests assert CURRENT validator behaviour (optional on
 *    every op in src/orchestrator/patch-validation.ts:74,81,88,95,
 *    102,109). Stricter enforcement is a separate proposal.
 *
 * Status of `.fails` markers: ALL Phase 2A `.fails` markers were
 * removed in the Phase 2A diff per the per-test removal checklist.
 * No test in this file currently uses `.fails`. Two paired *-green
 * tests (A4-green, A6-green) were also removed in that diff because
 * their pre-Phase-2A invariants flipped and the assertions were
 * subsumed by their post-Phase-2A siblings (A4 and A5/A6
 * respectively).
 *
 * FULL-PHASE-2 ENTRY GATE (still open) — Phase 2A landed but does NOT
 * close the captured-payload incident. DO NOT begin full Phase 2 code
 * changes (V5 receipt emission, recent_changes wiring, prior_facts
 * contract test, etc.) until either:
 *   (a) a captured production payload is available (turn_id, sanitised
 *       Render/Datadog log, or raw LLM output with sensitive content
 *       removed) and A7 below is fleshed out and run; OR
 *   (b) Paul explicitly authorises a narrower DL-7 V5-integration
 *       tranche per Docs/edit_graph_v9_dl7_v5_integration_design.md.
 *
 * The synthetic gold case proves the user-facing coaching/defaults gap
 * that Phase 2A fixed. It does NOT reproduce the original hard parse or
 * structural-validation failure observed in production. The production
 * incident remains "not fully reproduced" — see DL-5 in
 * Docs/edit_graph_v9_deferred_items.md.
 */

/**
 * Phase 2A safe-default user-facing coaching summary for non-empty
 * bare-array responses. Pinned here so any change to the default
 * surfaces as a test diff rather than a silent copy edit.
 *
 * Empty bare-arrays (`[]`) deliberately do NOT receive this default —
 * they fall through to the existing empty-ops fallback ("No changes
 * were needed for this request.") at edit-graph.ts:1637. See A8 / A8b
 * / D3-no-op for the empty-case contract.
 */
const SAFE_COACHING_SUMMARY = 'Proposed graph edit.';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: 'edit_graph',
    source: 'default',
    prompt_version: 'test',
    prompt_hash: 'test-hash',
    cache_status: 'miss',
  }),
}));

vi.mock('../../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 1;
              if (ceeProp === 'patchPreValidationEnabled') return false;
              if (ceeProp === 'patchBudgetEnabled') return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import {
  parseEditGraphResponse,
  handleEditGraph,
} from '../../../../src/orchestrator/tools/edit-graph.js';
import {
  PatchOperationSchema,
  PatchOperationsArraySchema,
} from '../../../../src/orchestrator/patch-validation.js';
import { log } from '../../../../src/utils/telemetry.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';
import type { PLoTClient, ValidatePatchResult } from '../../../../src/orchestrator/plot-client.js';

// ============================================================================
// Helpers
// ============================================================================

function makeContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'fac_price', kind: 'factor', label: 'Price' },
      ],
      edges: [
        {
          from: 'fac_price',
          to: 'goal_revenue',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      ],
    } as unknown as ConversationContext['graph'],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'phase1-bare-array',
  };
}

function makeAdapter(rawContent: string): LLMAdapter {
  return {
    name: 'test',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({ content: rawContent }),
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
}

function makePlotClientSuccess(): PLoTClient {
  // Mirror the post-edit graph PLoT would return after applying the gold ops.
  // edit-graph.ts:2140 reads applied_graph and graph_hash from data; without
  // them the success path leaves appliedGraph=null even though the patch is
  // accepted.
  const appliedGraph = {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price (revised)' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
  const result: ValidatePatchResult = {
    kind: 'success',
    data: {
      verdict: 'accepted',
      applied_graph: appliedGraph,
      graph_hash: 'test-graph-hash',
    },
  };
  return {
    run: vi.fn().mockResolvedValue({}),
    validatePatch: vi.fn().mockResolvedValue(result),
  } as unknown as PLoTClient;
}

/**
 * Smallest representative gold case for the known production failure pattern:
 * a bare top-level operations array with otherwise well-formed update_node ops.
 *
 * NOTE: exact production payload is NOT AVAILABLE. Replace this fixture with a
 * captured production payload if/when one becomes available.
 */
const GOLD_BARE_ARRAY_PAYLOAD = [
  {
    op: 'update_node',
    path: 'fac_price',
    value: { label: 'Price (revised)' },
  },
];

const VALID_ENVELOPE_PAYLOAD = {
  operations: [
    {
      op: 'update_node',
      path: 'fac_price',
      value: { label: 'Price (revised)' },
    },
  ],
  removed_edges: [],
  warnings: [],
  coaching: { summary: 'Renamed price factor.', rerun_recommended: false },
};

// ============================================================================
// Group A — Parser-level shape detection and safe defaults
// ============================================================================

describe('edit_graph v9 Phase 1 — bare-array safe-envelope (parser level)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // A1. Regression guard: valid v2 envelope still parses unchanged.
  // -------------------------------------------------------------------------
  it('A1 [regression] valid v2 object envelope parses with operations + coaching preserved', () => {
    const result = parseEditGraphResponse(JSON.stringify(VALID_ENVELOPE_PAYLOAD));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].op).toBe('update_node');
    expect(result.coaching).not.toBeNull();
    expect(result.coaching!.summary).toBe('Renamed price factor.');
    expect(result.coaching!.rerun_recommended).toBe(false);
  });

  // -------------------------------------------------------------------------
  // A2. Regression guard: bare top-level array is still parseable. The
  //     production failure pattern; current code already accepts it.
  //     This test pins that behaviour so Phase 2 cannot regress it.
  // -------------------------------------------------------------------------
  it('A2 [regression] bare top-level operations array (gold representative) parses successfully', () => {
    const result = parseEditGraphResponse(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].op).toBe('update_node');
    expect(result.operations[0].path).toBe('fac_price');
  });

  // -------------------------------------------------------------------------
  // A3. Markdown-wrapped JSON — assertion encodes CURRENT parser policy.
  //
  //     extractJson (edit-graph.ts:2576) strips a single ```...``` fence
  //     and JSON.parse the contents. If parse fails, falls back to extracting
  //     the FIRST {...} (greedy) then the FIRST [...].
  //
  //     CURRENT POLICY (verified by reading code, not desired behaviour):
  //       - Single fence around valid JSON: parses.
  //       - No fence + plain JSON: parses.
  //       - Object preferred over array if both regex-match the cleaned text.
  //
  //     Known sharp edges (FINDING — not fixed by this workstream):
  //       - Greedy {[\s\S]*} can over-capture across multiple JSON blocks.
  //       - Multi-fence responses use only the first fence.
  //     These are flagged as a separate proposal, not patched here.
  // -------------------------------------------------------------------------
  it('A3 [regression] markdown-fenced bare-array parses per current extractJson policy', () => {
    const wrapped = '```json\n' + JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD) + '\n```';
    const result = parseEditGraphResponse(wrapped);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].path).toBe('fac_price');
  });

  // -------------------------------------------------------------------------
  // A4. RED — new telemetry event name MUST be emitted on the bare-array
  //     wrap path. Phase 2 contract is ADDITIVE dual-emission for one
  //     transition window: keep the existing
  //     'edit_graph.legacy_array_response' AND emit
  //     'edit_graph.legacy_array_wrapped' alongside it. The old name is
  //     preserved so any uninspected cloud-side dashboard or saved log
  //     query (Datadog / Render filters / Grafana — none tracked in the
  //     repo, so cannot be audited from here) keeps working. The old name
  //     can be retired in a follow-up after a deliberate dashboards audit.
  //
  //     A4 covers the new event. A4b (below) covers the additive
  //     coexistence guarantee.
  // -------------------------------------------------------------------------
  // A4 (Phase 2A green): the new event must carry the SAME structured
  //     fields as the old one so dashboards that pivot on `format` /
  //     `operations_count` keep working when they migrate. Cf. existing
  //     emit at edit-graph.ts:2617-2620.
  //
  //     History: this test was authored as `it.fails` in Phase 1 paired
  //     with an `A4-green` invariant pinning the pre-Phase-2A contract
  //     ("new event does not emit today"). Phase 2A made both flip; the
  //     pre-Phase-2A invariant is now subsumed by A4 itself, so
  //     A4-green has been removed.
  it('A4 emits "legacy_array_wrapped" additively with format + operations_count', () => {
    parseEditGraphResponse(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));
    const wrappedCall = infoSpy.mock.calls.find((c) => c[1] === 'edit_graph.legacy_array_wrapped');
    expect(wrappedCall).toBeDefined();
    const fields = wrappedCall![0] as Record<string, unknown>;
    expect(fields.format).toBe('legacy_array');
    expect(fields.operations_count).toBe(GOLD_BARE_ARRAY_PAYLOAD.length);
  });

  // -------------------------------------------------------------------------
  // A4b-green. The OLD event 'edit_graph.legacy_array_response' MUST keep
  //            emitting today with its current structured payload. This
  //            protects against accidental removal during a Phase 2 dual-
  //            emission edit. Pinned as a normal green test so an unrelated
  //            regression here cannot hide under `it.fails`.
  // -------------------------------------------------------------------------
  it('A4b-green old telemetry event still emits with format + operations_count', () => {
    parseEditGraphResponse(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));
    const responseCall = infoSpy.mock.calls.find((c) => c[1] === 'edit_graph.legacy_array_response');
    expect(responseCall).toBeDefined();
    const oldFields = responseCall![0] as Record<string, unknown>;
    expect(oldFields.format).toBe('legacy_array');
    expect(oldFields.operations_count).toBe(GOLD_BARE_ARRAY_PAYLOAD.length);
  });

  // -------------------------------------------------------------------------
  // A4b. RED — additive dual-emission contract. Phase 2 MUST emit the new
  //      event ALONGSIDE the old one (the old-event invariant lives in
  //      A4b-green above). Both must carry equivalent structured payload so
  //      existing dashboards keep working while operators migrate.
  //
  //      Narrowed to ONLY the new-event expectation under .fails — the
  //      old-event regression is caught by A4b-green's normal assertion.
  // -------------------------------------------------------------------------
  it('A4b additive dual-emission: both events emit with consistent payload metadata', () => {
    parseEditGraphResponse(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));
    const wrappedCall = infoSpy.mock.calls.find((c) => c[1] === 'edit_graph.legacy_array_wrapped');
    expect(wrappedCall).toBeDefined();
    const newFields = wrappedCall![0] as Record<string, unknown>;
    expect(newFields.format).toBe('legacy_array');
    expect(newFields.operations_count).toBe(GOLD_BARE_ARRAY_PAYLOAD.length);
  });

  // -------------------------------------------------------------------------
  // A5 (Phase 2A green): safe wrapper defaults for the parameter-update
  //     gold case. The bare-array wrap path produces:
  //       removed_edges: []                (pinned by A5-green)
  //       warnings:      []                (pinned by A5-green)
  //       coaching.summary: SAFE_COACHING_SUMMARY
  //       coaching.rerun_recommended: false  (conservative invariant)
  //
  //     Conservative-invariant rationale: this gold case is a single
  //     parameter update on one factor — a re-run is not warranted.
  //     Pinning `false` for THIS case does NOT prohibit a future tranche
  //     from deriving `rerun_recommended` from operation impact for
  //     higher-impact bare-array shapes (e.g. add_node + add_edge).
  //     A high-impact counterpart test should be added before any
  //     derivation logic lands.
  //
  //     Empty bare-arrays do NOT receive these defaults (coaching stays
  //     null) — see A8 / A8b for the empty-case contract.
  // -------------------------------------------------------------------------
  // A5-green: removed_edges and warnings are [] on the bare-array wrap
  //           path. Pinned as a normal green test so an accidental
  //           change to those defaults surfaces immediately.
  it('A5-green bare-array wrap defaults removed_edges and warnings to []', () => {
    const result = parseEditGraphResponse(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));
    expect(result.removed_edges).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  // A5: coaching shape pinned by Phase 2A. Empty bare-arrays excluded
  //     by parser gate — see A8.
  it('A5 bare-array wrap populates coaching with safe defaults', () => {
    const result = parseEditGraphResponse(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));
    expect(result.coaching).not.toBeNull();
    expect(result.coaching!.summary).toBe(SAFE_COACHING_SUMMARY);
    // Conservative invariant for the parameter-update gold case only.
    expect(result.coaching!.rerun_recommended).toBe(false);
  });

  // -------------------------------------------------------------------------
  // A6 (Phase 2A green): coaching is non-null with non-empty user-facing
  //     summary AND that summary contains no technical jargon ("legacy",
  //     "repair", "normalise", "envelope", "wrapped") or model-routing
  //     details. Telemetry is operator-only.
  //
  //     History: this test was authored as `it.fails` in Phase 1 paired
  //     with an `A6-green` invariant pinning the pre-Phase-2A contract
  //     ("coaching === null"). Phase 2A made both flip; the pre-Phase-2A
  //     invariant is now subsumed by A5 (which asserts the populated
  //     coaching shape directly), so A6-green was removed.
  // -------------------------------------------------------------------------
  it('A6 returns non-null coaching with no technical jargon', () => {
    const result = parseEditGraphResponse(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));
    // Precondition: coaching must be populated for the jargon check to be
    // meaningful. Phase 2A populates it for non-empty bare-arrays
    // (compare A8: empty bare-arrays keep coaching=null).
    expect(result.coaching).not.toBeNull();
    expect(result.coaching!.summary).toBeTruthy();

    const userFacing = [
      ...(result.warnings ?? []),
      result.coaching!.summary,
    ].join(' ').toLowerCase();
    expect(userFacing).not.toContain('legacy');
    expect(userFacing).not.toContain('repair');
    expect(userFacing).not.toContain('normalise');
    expect(userFacing).not.toContain('normalize');
    expect(userFacing).not.toContain('envelope');
    expect(userFacing).not.toContain('wrapped');
    expect(userFacing).not.toContain('gpt-');
    expect(userFacing).not.toContain('claude');
  });

  // -------------------------------------------------------------------------
  // A8. Phase 2A polish — empty bare-array MUST NOT receive the safe
  //     coaching default. Rationale: the empty-ops branch in
  //     handleEditGraph at edit-graph.ts:1625 has its own correct
  //     no-op fallback ("No changes were needed for this request.").
  //     Populating coaching for parsed.length === 0 leaks
  //     "Proposed graph edit." into a response that proposed nothing —
  //     misleading to the user.
  //
  //     Asserts at three layers:
  //       - parser: coaching === null on empty bare-array
  //       - telemetry: both events still emit with operations_count: 0
  //                    (an empty bare-array IS still a bare-array shape;
  //                    operators want the signal regardless of length)
  //       - end-to-end: assistantText falls back to "No changes were
  //                     needed for this request." (handled in Group D
  //                     via D3-no-op below — kept here close to the
  //                     parser assertion so the reviewer can find both
  //                     surfaces in one search).
  // -------------------------------------------------------------------------
  it('A8 empty bare-array gets coaching=null so the empty-ops fallback fires', () => {
    const result = parseEditGraphResponse(JSON.stringify([]));
    expect(result.operations).toHaveLength(0);
    expect(result.removed_edges).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.coaching).toBeNull();
  });

  it('A8b empty bare-array still emits both telemetry events with operations_count: 0', () => {
    parseEditGraphResponse(JSON.stringify([]));
    const responseCall = infoSpy.mock.calls.find((c) => c[1] === 'edit_graph.legacy_array_response');
    const wrappedCall = infoSpy.mock.calls.find((c) => c[1] === 'edit_graph.legacy_array_wrapped');
    expect(responseCall).toBeDefined();
    expect(wrappedCall).toBeDefined();
    expect((responseCall![0] as Record<string, unknown>).format).toBe('legacy_array');
    expect((responseCall![0] as Record<string, unknown>).operations_count).toBe(0);
    expect((wrappedCall![0] as Record<string, unknown>).format).toBe('legacy_array');
    expect((wrappedCall![0] as Record<string, unknown>).operations_count).toBe(0);
  });
});

// ============================================================================
// Group B — Operation-level Zod validation (no repair, specific reasons)
// ============================================================================

describe('edit_graph v9 Phase 1 — malformed-op Zod validation (no silent repair)', () => {
  // -------------------------------------------------------------------------
  // B1. Missing path → Zod rejects with a path-specific error.
  //     Schema: every op type sets `path: z.string().min(1)`.
  // -------------------------------------------------------------------------
  it('B1 missing path on update_node fails Zod with a path-specific reason', () => {
    const op = {
      op: 'update_node',
      // path: missing
      value: { label: 'X' },
    };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(false);
    if (!result.success) {
      const pathIssue = result.error.issues.find((i) => i.path.includes('path'));
      expect(pathIssue).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // B2. Missing value on update_node → Zod rejects with a value-specific
  //     error referencing the value field.
  //     Schema: UpdateNodeOp requires UpdateNodeValue (record with ≥1 key).
  // -------------------------------------------------------------------------
  it('B2 missing value on update_node fails Zod with a value-specific reason', () => {
    const op = {
      op: 'update_node',
      path: 'fac_price',
      // value: missing
    };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(false);
    if (!result.success) {
      const valueIssue = result.error.issues.find((i) => i.path.includes('value'));
      expect(valueIssue).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // B3. CURRENT BEHAVIOUR ASSERTION: missing old_value on update_node passes
  //     Zod. Schema sets `old_value: z.unknown().optional()` on every op
  //     (patch-validation.ts:74,81,88,95,102,109).
  //
  //     This test pins the current contract. Stricter old_value enforcement
  //     (prompt-required diff context) is documented as a separate proposal
  //     in the v9 prompt patch and is NOT landed by this workstream.
  // -------------------------------------------------------------------------
  it('B3 [current behaviour] missing old_value on update_node passes Zod (optional today)', () => {
    const op = {
      op: 'update_node',
      path: 'fac_price',
      value: { label: 'Y' },
      // old_value: missing
    };
    const result = PatchOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // B4. Whole-array Zod gate: an array containing one valid + one malformed op
  //     fails as a whole, with a specific issue path pointing at the bad index.
  //     Confirms no silent recovery / drop of the malformed op.
  // -------------------------------------------------------------------------
  it('B4 array with one malformed op fails with index-specific issue (no silent drop)', () => {
    const ops = [
      { op: 'update_node', path: 'fac_price', value: { label: 'A' } },
      { op: 'update_node', /* missing path */ value: { label: 'B' } },
    ];
    const result = PatchOperationsArraySchema.safeParse(ops);
    expect(result.success).toBe(false);
    if (!result.success) {
      const indexedIssue = result.error.issues.find((i) => i.path[0] === 1);
      expect(indexedIssue).toBeDefined();
    }
  });
});

// ============================================================================
// Group C — Repair-loop boundedness (no repeated/unbounded repair)
// ============================================================================

describe('edit_graph v9 Phase 1 — repair-loop boundedness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // C1. With maxRepairRetries=1 (mocked), an adapter that twice returns
  //     malformed ops MUST be invoked at most 2 times — 1 initial + 1 repair.
  //     No silent additional retries.
  // -------------------------------------------------------------------------
  it('C1 maxRepairRetries=1 + persistently malformed ops → adapter.chat called ≤ 2 times', async () => {
    const malformed = [
      { op: 'update_node' /* missing path AND value */ },
    ];
    const adapter = makeAdapter(JSON.stringify(malformed));

    try {
      await handleEditGraph(
        makeContext(),
        'Update price label',
        adapter,
        'req-bound-1',
        'turn-1',
        { plotClient: makePlotClientSuccess(), maxRetries: 1 },
      );
    } catch {
      // The handler may throw a TOOL_EXECUTION_FAILED on terminal failure.
      // The boundedness assertion below is what matters.
    }

    const chatMock = adapter.chat as unknown as ReturnType<typeof vi.fn>;
    expect(chatMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// Group A7 — Captured-payload regression (PENDING — Phase 2 entry gate)
// ============================================================================

/**
 * A7. Captured-payload regression test — placeholder pending the actual
 *     production payload (turn_id, sanitised Render/Datadog dump, or raw
 *     LLM output with sensitive content removed).
 *
 *     When the payload is available:
 *       - Replace the .todo with .it
 *       - Inline the captured payload as a const (sanitised; no PII, no
 *         customer brief content) — or load from
 *         tests/fixtures/edit-graph/captured-prod-YYYY-MM-DD.json
 *       - Assert ALL of the following on a single run:
 *
 *         1. Safe parse OR safe-specific failure
 *            (parseEditGraphResponse either returns an EditGraphLLMResult
 *            OR throws an Error whose message names the offending shape —
 *            no silent fallback, no generic "validation failed").
 *
 *         2. No unsafe mutation
 *            (handleEditGraph either applies a valid patch via PLoT, or
 *            rejects with `wasRejected === true`. Never silently mutates
 *            the graph in a way the user didn't request.)
 *
 *         3. No unbounded repair loop
 *            (adapter.chat invocation count <= maxRetries + 1).
 *
 *         4. Specific validation reason if malformed
 *            (lastValidationResult.zodErrors OR referentialErrors contains
 *            an issue with a meaningful path/message — not a placeholder).
 *
 *         5. Safe assistant text
 *            (result.assistantText is non-null and contains no leaked entity
 *            IDs, no model names, no jargon from the A6 list. Empty string
 *            is acceptable for hard-rejection cases; null is NOT.)
 *
 *         6. Expected telemetry
 *            (the appropriate edit_graph.* event fires for the captured
 *            shape: legacy_array_response + legacy_array_wrapped if bare
 *            array, edit_graph.parse_error if extractJson fails, etc.)
 *
 *     This is the entry gate for Phase 2 implementation. The synthetic gold
 *     case (D1) proves the safe-defaults gap; A7 proves the production
 *     incident is closed.
 */
describe('edit_graph v9 Phase 1 — A7 captured-payload regression (PENDING)', () => {
  it.todo(
    'A7 captured production payload: safe parse/fail, no unsafe mutation, bounded repair, specific reason if malformed, safe assistant text, expected telemetry',
  );
});

// ============================================================================
// Group D — End-to-end gold case (production failure pattern)
// ============================================================================

describe('edit_graph v9 Phase 1 — end-to-end gold case (bare-array LLM output)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // D1 (Phase 2A green): production-pattern gold case. LLM returns a bare
  //     top-level array of well-formed update_node ops; PLoT mocked as
  //     accepted.
  //
  //     Phase 2A's safe coaching defaults make the success-path text
  //     builder (edit-graph.ts:2341) render the populated coaching.summary,
  //     so assistantText is non-null and contains SAFE_COACHING_SUMMARY.
  //
  //     Success contract asserted here:
  //       - exactly one LLM call (no repair)
  //       - wasRejected === false
  //       - appliedGraph populated
  //       - assistantText contains SAFE_COACHING_SUMMARY (concrete, not
  //         just "truthy" — protects against vague copy edits)
  //
  //     CAVEAT: synthetic payload, not captured production. Passing D1
  //     does NOT prove the original production parse/validation failure
  //     is fixed. See DL-5 / A7.
  // -------------------------------------------------------------------------
  // D1-green: handler mechanics. These invariants protect against
  //           unrelated regressions in the bare-array success path
  //           (parser → Zod → PLoT). Pinned as a normal green test so
  //           regressions surface immediately.
  it('D1-green bare-array gold case: handler succeeds first-attempt with success-shape result', async () => {
    const adapter = makeAdapter(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));

    const result = await handleEditGraph(
      makeContext(),
      'Rename price factor',
      adapter,
      'req-gold-green',
      'turn-1',
      { plotClient: makePlotClientSuccess(), maxRetries: 1 },
    );

    const chatMock = adapter.chat as unknown as ReturnType<typeof vi.fn>;
    expect(chatMock.mock.calls.length).toBe(1);
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
  });

  // D1: only the user-facing assistantText fallback copy is red today.
  it('D1 bare-array gold case: assistantText contains the safe coaching default', async () => {
    const adapter = makeAdapter(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));

    const result = await handleEditGraph(
      makeContext(),
      'Rename price factor',
      adapter,
      'req-gold-1',
      'turn-1',
      { plotClient: makePlotClientSuccess(), maxRetries: 1 },
    );

    // Precondition: assistantText must be a string before .toContain runs.
    // Without this, today's null assistantText raises a TypeError — under
    // .fails any throw counts as expected failure, masking the diagnostic.
    expect(result.assistantText).not.toBeNull();
    expect(typeof result.assistantText).toBe('string');
    expect(result.assistantText).toContain(SAFE_COACHING_SUMMARY);
  });

  // -------------------------------------------------------------------------
  // D2 (Phase 2A green) — operator-visibility check. The completion log
  //     line at edit-graph.ts:2290 emits `has_coaching: !!llmResult.coaching`.
  //     Pre-Phase-2A the bare-array path made this `false` (coaching=null),
  //     hiding the success-path quality gap from anyone watching telemetry.
  //     Phase 2A's safe-defaults fix makes coaching non-null for non-empty
  //     bare-arrays so `has_coaching` is `true` here. The empty-bare-array
  //     no-op path (D3-no-op) keeps `has_coaching: false` because coaching
  //     is intentionally null on that branch.
  // -------------------------------------------------------------------------
  // D2-green: the completion log line is emitted with the has_coaching
  //           field today. Pinning this as a normal green test means an
  //           accidental removal of the log line or the field would
  //           surface immediately rather than hiding under .fails (where
  //           an absent log line would still produce a thrown assertion
  //           on completionCall and count as expected failure).
  it('D2-green completion telemetry "edit_graph completed" emits with has_coaching field', async () => {
    const adapter = makeAdapter(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));

    await handleEditGraph(
      makeContext(),
      'Rename price factor',
      adapter,
      'req-gold-2-green',
      'turn-1',
      { plotClient: makePlotClientSuccess(), maxRetries: 1 },
    );

    const completionCall = infoSpy.mock.calls.find((c) => c[1] === 'edit_graph completed');
    expect(completionCall).toBeDefined();
    const fields = completionCall![0] as Record<string, unknown>;
    expect(fields).toHaveProperty('has_coaching');
    expect(typeof fields.has_coaching).toBe('boolean');
  });

  // D2: the value of has_coaching is what Phase 2A flipped from false to
  //     true (because coaching becomes non-null per A5).
  it('D2 success-path completion telemetry has has_coaching=true on bare-array path', async () => {
    const adapter = makeAdapter(JSON.stringify(GOLD_BARE_ARRAY_PAYLOAD));

    await handleEditGraph(
      makeContext(),
      'Rename price factor',
      adapter,
      'req-gold-2',
      'turn-1',
      { plotClient: makePlotClientSuccess(), maxRetries: 1 },
    );

    const completionCall = infoSpy.mock.calls.find((c) => c[1] === 'edit_graph completed');
    expect(completionCall).toBeDefined();
    const completionFields = completionCall![0] as Record<string, unknown>;
    expect(completionFields.has_coaching).toBe(true);
  });

  // -------------------------------------------------------------------------
  // D3-no-op. Phase 2A polish — empty bare-array (`[]`) must produce the
  //     forward-looking no-op fallback and NOT the safe coaching default.
  //     This is the end-to-end pair to A8 / A8b.
  //
  //     The fix lives in parseEditGraphResponse: coaching is gated on
  //     `parsed.length > 0`. With coaching=null, the empty-ops branch
  //     at edit-graph.ts:1637 falls through to its forward-looking
  //     NO_OP_FALLBACK_TEXT (V5 H5 update: was "No changes were needed
  //     for this request.", but that phrasing matched the egress
  //     forbidden-phrase denial regex and was being rewritten to the
  //     generic neutral fallback. Forward-looking text passes both
  //     guards intact).
  // -------------------------------------------------------------------------
  it('D3-no-op empty bare-array yields the forward-looking no-op fallback, not "Proposed graph edit."', async () => {
    const adapter = makeAdapter(JSON.stringify([]));

    const result = await handleEditGraph(
      makeContext(),
      'Maybe change something',
      adapter,
      'req-noop-1',
      'turn-1',
      { plotClient: makePlotClientSuccess(), maxRetries: 1 },
    );

    expect(result.assistantText).toMatch(/Tell me the specific factor/i);
    expect(result.assistantText).not.toContain('Proposed graph edit.');
    expect(result.assistantText).not.toMatch(/\bno changes were\b/i);
    expect(result.appliedGraph).toBeNull();
    expect(result.wasRejected).toBe(false);

    // Completion telemetry should NOT report has_coaching=true on the
    // no-op path (coaching is null per the gated parser).
    const completionCall = infoSpy.mock.calls.find((c) => c[1] === 'edit_graph returned empty operations (no-op)');
    expect(completionCall).toBeDefined();
    expect((completionCall![0] as Record<string, unknown>).has_coaching).toBe(false);
  });
});
