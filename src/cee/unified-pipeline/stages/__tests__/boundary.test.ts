/**
 * Stage 6 (Boundary) — fail-closed tests
 *
 * Verifies the MC-29 fix: the strict-mode and Zod validation soft-gates
 * are replaced with ctx.earlyReturn carrying HTTP 502 and a typed error
 * envelope. Behaviour for valid responses and the dev escape hatch
 * (CEE_BOUNDARY_ALLOW_INVALID) is preserved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (must precede imports) ────────────────────────────────────────

const mockV3Body: Record<string, unknown> = {
  // Intentionally missing required fields; the Zod safeParse will fail
  // unless a test overrides its behaviour via the schema mock below.
  graph: { nodes: [], edges: [] },
};

let strictShouldThrow = false;
let zodShouldSucceed = true;

vi.mock('../../../transforms/schema-v3.js', () => ({
  transformResponseToV3: vi.fn(() => mockV3Body),
  validateStrictModeV3: vi.fn(() => {
    if (strictShouldThrow) throw new Error('strict-mode invariant broken');
  }),
}));

vi.mock('../../../transforms/schema-v2.js', () => ({
  transformResponseToV2: vi.fn((x: unknown) => x),
}));

vi.mock('../../../transforms/analysis-ready.js', () => ({
  mapMutationsToAdjustments: vi.fn(() => []),
  extractConstraintDropBlockers: vi.fn(() => []),
}));

vi.mock('../../../../schemas/cee-v3.js', () => ({
  CEEGraphResponseV3: {
    safeParse: vi.fn(() => {
      if (zodShouldSucceed) {
        return { success: true, data: mockV3Body };
      }
      return {
        success: false,
        error: {
          issues: [
            { path: ['nodes'], message: 'required', code: 'invalid_type' },
            { path: ['meta'], message: 'required', code: 'invalid_type' },
          ],
        },
      };
    }),
  },
  warnOnUnknownV3Fields: vi.fn(),
}));

vi.mock('../../../../schemas/llmExtraction.js', () => ({
  extractZodIssues: vi.fn((_err: unknown, n: number) =>
    Array.from({ length: n }, (_, i) => ({ path: ['x', i], message: 'missing' })),
  ),
}));

vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: { CeeBoundaryBlocked: 'CeeBoundaryBlocked' },
}));

let mockBoundaryAllowInvalid = false;

vi.mock('../../../../config/index.js', () => ({
  config: {
    get cee() {
      return { boundaryAllowInvalid: mockBoundaryAllowInvalid };
    },
  },
}));

vi.mock('../../../../config/env-resolver.js', () => ({
  getRuntimeEnv: vi.fn(() => 'test'),
}));

vi.mock('../../../transforms/graph-data-integrity.js', () => ({
  runGraphDataIntegrityChecks: vi.fn(() => ({
    scale_consistency_repairs: [],
    edge_field_repairs: [],
    intercept_population_repairs: [],
    // This mock is a hand-maintained mirror of IntegrityRepairSummary
    // (trap 12) — the stage reads `.length` on every arm, so an omitted key
    // here is a TypeError, not a silent pass. That is the intended direction:
    // it fails loud the next time the summary grows. (The 2.714 honour arms
    // were removed with the capability on 8 Aug 2026.)
  })),
}));

vi.mock('../../../observability/diagnostic-checks.js', () => ({
  computeDiagnosticChecks: vi.fn(() => ({})),
}));

// buildCeeErrorResponse — return a recognisable shape so tests can assert on it
vi.mock('../../../validation/pipeline.js', () => ({
  buildCeeErrorResponse: vi.fn((code: string, message: string, opts: Record<string, unknown>) => ({
    error: { code, message, ...opts },
  })),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────

import { runStageBoundary } from '../boundary.js';
import type { StageContext } from '../../types.js';

// ── Test helpers ────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<StageContext>): StageContext {
  return {
    input: { brief: 'test' },
    rawBody: {},
    request: {} as StageContext['request'],
    requestId: 'req-1',
    opts: { schemaVersion: 'v3', strictMode: false, requestStartMs: Date.now() } as StageContext['opts'],
    start: Date.now(),
    ceeResponse: { some: 'response' } as unknown as StageContext['ceeResponse'],
    pipelineOutcome: { status: 'success', coaching_status: 'complete', warnings: [] } as StageContext['pipelineOutcome'],
    finalResponse: undefined,
    earlyReturn: undefined,
    // unused fields filled with stub defaults to satisfy the type
    graph: undefined,
    rationales: [],
    draftCost: 0,
    draftAdapter: undefined,
    llmMeta: undefined,
    confidence: undefined,
    effectiveBrief: '',
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 0,
    draftDurationMs: 0,
    strpResult: null,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentResult: null,
    hadCycles: false,
    nodeRenames: new Map(),
    goalConstraints: null,
    constraintStrpResult: null,
    structuralMeta: null,
    validationSummary: null,
    quality: undefined,
    archetype: null,
    draftWarnings: [],
    pipelineTrace: null,
    collector: { add: vi.fn(), addByStage: vi.fn() },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    ...overrides,
  } as StageContext;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('runStageBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    strictShouldThrow = false;
    zodShouldSucceed = true;
    mockBoundaryAllowInvalid = false;
  });

  describe('happy path', () => {
    it('valid V3 response sets finalResponse and does not set earlyReturn', async () => {
      zodShouldSucceed = true;
      const ctx = makeCtx();
      await runStageBoundary(ctx);
      expect(ctx.earlyReturn).toBeUndefined();
      expect(ctx.finalResponse).toEqual(mockV3Body);
    });
  });

  describe('strict mode fail-closed', () => {
    it('sets earlyReturn with 502 and CEE_EGRESS_CONTRACT_VIOLATION envelope on strict-mode failure', async () => {
      strictShouldThrow = true;
      const ctx = makeCtx({
        opts: { schemaVersion: 'v3', strictMode: true, requestStartMs: Date.now() } as StageContext['opts'],
      });
      await runStageBoundary(ctx);
      expect(ctx.earlyReturn).toBeDefined();
      expect(ctx.earlyReturn!.statusCode).toBe(502);
      const body = ctx.earlyReturn!.body as { error: Record<string, unknown> };
      expect(body.error.code).toBe('CEE_EGRESS_CONTRACT_VIOLATION');
      expect(body.error.reason).toBe('egress_contract_violation');
      expect(body.error.retryable).toBe(false);
      const details = body.error.details as Record<string, unknown>;
      expect(details.validator).toBe('strict_mode_v3');
      expect(details.boundary).toBe('B1');
      expect(details.direction).toBe('response');
    });

    it('does not set finalResponse on strict-mode failure', async () => {
      strictShouldThrow = true;
      const ctx = makeCtx({
        opts: { schemaVersion: 'v3', strictMode: true, requestStartMs: Date.now() } as StageContext['opts'],
      });
      await runStageBoundary(ctx);
      expect(ctx.finalResponse).toBeUndefined();
    });

    it('records a blocked PipelineWarning (degraded=false, blocked=true)', async () => {
      strictShouldThrow = true;
      const ctx = makeCtx({
        opts: { schemaVersion: 'v3', strictMode: true, requestStartMs: Date.now() } as StageContext['opts'],
      });
      await runStageBoundary(ctx);
      const warnings = ctx.pipelineOutcome.warnings;
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        stage: 'boundary_strict_mode',
        degraded: false,
        blocked: true,
      });
    });
  });

  describe('Zod validation fail-closed', () => {
    it('sets earlyReturn with 502 and includes validation_issues on Zod failure', async () => {
      zodShouldSucceed = false;
      const ctx = makeCtx();
      await runStageBoundary(ctx);
      expect(ctx.earlyReturn).toBeDefined();
      expect(ctx.earlyReturn!.statusCode).toBe(502);
      const body = ctx.earlyReturn!.body as { error: Record<string, unknown> };
      expect(body.error.code).toBe('CEE_EGRESS_CONTRACT_VIOLATION');
      expect(body.error.reason).toBe('egress_contract_violation');
      const details = body.error.details as Record<string, unknown>;
      expect(details.validator).toBe('zod_v3');
      expect(details.issue_count).toBe(2);
      expect(Array.isArray(details.validation_issues)).toBe(true);
    });

    it('does not set finalResponse on Zod failure', async () => {
      zodShouldSucceed = false;
      const ctx = makeCtx();
      await runStageBoundary(ctx);
      expect(ctx.finalResponse).toBeUndefined();
    });

    it('records a blocked PipelineWarning on Zod failure', async () => {
      zodShouldSucceed = false;
      const ctx = makeCtx();
      await runStageBoundary(ctx);
      const warnings = ctx.pipelineOutcome.warnings;
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        stage: 'boundary_v3_validation',
        degraded: false,
        blocked: true,
      });
    });
  });

  describe('dev escape hatch', () => {
    it('boundaryAllowInvalid=true bypasses fail-closed and sets finalResponse', async () => {
      zodShouldSucceed = false;
      mockBoundaryAllowInvalid = true;
      const ctx = makeCtx();
      await runStageBoundary(ctx);
      expect(ctx.earlyReturn).toBeUndefined();
      expect(ctx.finalResponse).toEqual(mockV3Body);
    });
  });

  describe('non-V3 paths', () => {
    it('V2 path unaffected by strict-mode / Zod logic', async () => {
      const ctx = makeCtx({
        opts: { schemaVersion: 'v2', strictMode: true, requestStartMs: Date.now() } as StageContext['opts'],
      });
      await runStageBoundary(ctx);
      expect(ctx.earlyReturn).toBeUndefined();
      expect(ctx.finalResponse).toBeDefined();
    });

    it('V1 path unaffected', async () => {
      const ctx = makeCtx({
        opts: { schemaVersion: 'v1', strictMode: true, requestStartMs: Date.now() } as StageContext['opts'],
      });
      await runStageBoundary(ctx);
      expect(ctx.earlyReturn).toBeUndefined();
      expect(ctx.finalResponse).toBeDefined();
    });
  });
});

// ===========================================================================
// REPAIR_CODE_TO_ADJUSTMENT — fail loud on drift, never assume-good
// ===========================================================================
//
// The allowlist's failure mode is SILENCE: a repair code nobody adds is absent
// from `model_adjustments` with no error, and the omission is indistinguishable
// from a deliberate exclusion. That is trap 12's hand-maintained mirror, and the
// PR that added two new repair codes hit it immediately — both were dropped.
//
// This guard DERIVES the codes the deterministic sweep can emit from the sweep's
// own source, so a new code cannot appear without being classified. It is not a
// completeness proof (trap 12d: derivation catches drift between copies, never a
// short list) — it proves only that every emitted code has been ADJUDICATED.
describe('REPAIR_CODE_TO_ADJUSTMENT drift guard', () => {
  // Codes deliberately NOT surfaced as model_adjustments, each with its reason.
  // Adding a code here is a DECISION and should be reviewed as one.
  const ADJUDICATED_EXCLUDED = new Set<string>([
    // Mechanical numeric/structural fixes the user does not need to review.
    'NAN_VALUE', 'SIGN_MISMATCH', 'CATEGORY_MISMATCH', 'INVALID_EDGE_REF',
    'FORBIDDEN_EDGE_AUTO_FIXED', 'FACTOR_GOAL_EDGE_SPLIT', 'CYCLE_DETECTED',
    'COMPLEXITY_CAP_PRUNE', 'GOAL_THRESHOLD_STRIPPED_NO_RAW',
    'GOAL_THRESHOLD_POSSIBLY_INFERRED', 'STATUS_QUO_FACTOR_WIRED',
    'STATUS_QUO_WIRED', 'STATUS_QUO_NO_TARGETS', 'STATUS_QUO_STILL_INVALID',
    'DISCONNECTED_OBSERVABLE_PRUNED', 'UNREACHABLE_FACTOR_RETAINED',
    'UNREACHABLE_FACTOR_WIRED_TO_GOAL', 'INVALID_INTERVENTION_REF',
    'CONTROLLABLE_MISSING_DATA', 'OBSERVABLE_MISSING_DATA', 'EXTERNAL_HAS_DATA',
    'OBSERVABLE_EXTRA_DATA', 'STRUCTURAL_EDGE_NOT_CANONICAL_ERROR',
    'GOAL_HAS_OUTGOING', 'DECISION_HAS_INCOMING', 'INVALID_EDGE_TYPE',
    'NODE_LIMIT_EXCEEDED', 'EDGE_LIMIT_EXCEEDED',
    // `ModelAdjustment.code` is a CLOSED contract enum whose only candidate
    // member is `category_reclassified`, which neither of these is. They reach
    // the user via `deterministic_repairs[]` instead. See boundary.ts.
    'DUPLICATE_CAUSAL_EDGE_SUPPRESSED', 'CONFLICTING_CAUSAL_DIRECTION',
    // Not a Repair at all — a VALIDATION code the sweep raises as a violation
    // (`violationCodes` / `remainingErrors`). It can never reach the repair
    // allowlist, and is listed only because the derivation below deliberately
    // over-collects; see the note there.
    'NO_PATH_TO_GOAL',
  ]);

  it('classifies every repair code the sweep can emit', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sweepPath = fileURLToPath(
      new URL('../repair/deterministic-sweep.ts', import.meta.url),
    );
    const source = readFileSync(sweepPath, 'utf8');

    // ⚠ DELIBERATELY A SUPERSET. This matches every `code: "..."` literal in the
    // sweep, which includes VALIDATION codes as well as Repair codes. Narrowing
    // it to Repair pushes would need to track object shape across a 2,000-line
    // file and would fail SILENTLY when it drifted — and a guard that
    // under-collects lets exactly the code nobody classified slip through, which
    // is the whole defect. Over-collection costs one line in
    // ADJUDICATED_EXCLUDED and errs toward asking the question.
    const emitted = new Set(
      [...source.matchAll(/\bcode:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]!),
    );

    // POSITIVE CONTROL — a derivation that silently matches nothing would make
    // every assertion below vacuous, and would look exactly like a clean pass.
    expect(emitted.size).toBeGreaterThan(10);
    expect(emitted.has('FACTOR_GOAL_EDGE_SPLIT')).toBe(true);
    // CONTRAST CONTROL — proves the regex discriminates rather than matching all.
    expect(emitted.has('NOT_A_REAL_REPAIR_CODE')).toBe(false);

    const { REPAIR_CODE_TO_ADJUSTMENT } = await import('../boundary.js');
    const unclassified = [...emitted].filter(
      (c) => !(c in REPAIR_CODE_TO_ADJUSTMENT) && !ADJUDICATED_EXCLUDED.has(c),
    );

    expect(
      unclassified,
      `Unclassified repair code(s): ${unclassified.join(', ')}. A new sweep repair ` +
        'code is invisible in model_adjustments by default. Decide deliberately: add ' +
        'it to REPAIR_CODE_TO_ADJUSTMENT (boundary.ts) or to ADJUDICATED_EXCLUDED here.',
    ).toEqual([]);
  });

  it('still maps the one code that IS user-reviewable', async () => {
    const { REPAIR_CODE_TO_ADJUSTMENT } = await import('../boundary.js');
    expect(REPAIR_CODE_TO_ADJUSTMENT.UNREACHABLE_FACTOR_RECLASSIFIED).toBe(
      'category_reclassified',
    );
  });
});
