/**
 * R2 — auto-run provisional analysis after a fresh draft (Paul's ruling,
 * 2026-08-16): the scheduler core.
 *
 * ## What these specs pin
 *
 * 1. ADMISSION-GATED, NEVER FABRICATED. The auto-run fires iff
 *    `resolveRunAdmission(draftGraph).willProceed` — the SAME two-term
 *    authority (#998) the run path and the readiness panel share. These specs
 *    deliberately do NOT mock `resolveRunAdmission`: the gate under test is
 *    the real predicate, so a mutant that makes the auto-run fire on an
 *    inadmissible graph goes RED here (the brief's explicit mutant
 *    obligation), and a mutant that stops it firing on an admissible graph
 *    goes RED on the twin. One direction alone would be a corpus watching one
 *    door (CLAUDE.md trap 22b).
 *
 * 2. FRESH DRAFTS ONLY — the "already analysed for this graph state" negative.
 *    A successful (noop:false) run_analysis fact whose `graph_hash_at_run`
 *    equals the fresh draft's analysis-affecting hash suppresses the auto-run.
 *    The guard binds by HASH IDENTITY, pinned with a discriminating pair
 *    (matching hash → skip; different hash → dispatch), so it cannot pass on
 *    the wrong object (trap 19).
 *
 * 3. OFF THE CRITICAL PATH. `scheduleAutoRunAfterFreshDraft` returns
 *    synchronously without invoking the dispatch; the work happens on a later
 *    tick. Draft delivery latency (#995) must be untouched by construction.
 *
 * 4. NON-BLOCKING CONTRACT. Like the commit-seam hooks (rolling summary,
 *    decision records), every failure is caught and reported as an outcome —
 *    nothing propagates.
 *
 * The graph fixtures replicate `run-admission-two-term.test.ts`'s measured
 * arms (deployed CEE `2988eac`): MIXED (2 of 4 configured) is the state a
 * fresh draft lands in and MUST auto-run; NONE_CONFIGURED must not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  runAutoRunAfterFreshDraft,
  scheduleAutoRunAfterFreshDraft,
  type AutoRunDispatchFn,
  type AutoRunPriorFactsReader,
} from '../auto-run-after-draft.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRAFT_TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-auto-run-test';
const DRAFT_GRAPH_HASH = 'aag_v1:deadbeefdeadbeefdeadbeefdeadbeef';

// ── Graph fixtures (the measured admission arms) ────────────────────────────

const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const baseNodes = () => [
  { id: 'goal', kind: 'goal', label: 'Bridge the sales/engineering gap' },
  { id: 'decision', kind: 'decision', label: 'Hiring' },
  {
    id: 'fac_velocity',
    kind: 'factor',
    label: 'Engineering Delivery Velocity',
    category: 'controllable',
    observed_state: { value: 0.5, cap: 1 },
  },
];

const option = (id: string, label: string, interventions?: Record<string, number>) => ({
  id,
  kind: 'option',
  label,
  ...(interventions ? { interventions } : {}),
});

function graphWith(configuredCount: number, unconfiguredCount: number) {
  const options: ReturnType<typeof option>[] = [];
  for (let i = 0; i < configuredCount; i += 1) {
    options.push(option(`opt_c${i}`, `Configured ${i}`, { fac_velocity: 0.3 + i * 0.2 }));
  }
  for (let i = 0; i < unconfiguredCount; i += 1) {
    options.push(option(`opt_u${i}`, `Unconfigured ${i}`));
  }
  return {
    version: '1',
    nodes: [...baseNodes(), ...options],
    edges: [
      ...options.map((o, i) => v3Edge(`ed${i}`, 'decision', o.id)),
      ...options.map((o, i) => v3Edge(`ef${i}`, o.id, 'fac_velocity')),
      v3Edge('eg', 'fac_velocity', 'goal'),
    ],
  };
}

/** The witnessed fresh-draft state: some options valued, some not. ADMITS. */
const MIXED = graphWith(2, 2);
/** Fully configured — strictly ready. ADMITS. */
const FULLY_CONFIGURED = graphWith(4, 0);
/** Nothing configured — the exclusion cannot save it. REFUSES. */
const NONE_CONFIGURED = graphWith(0, 4);
/** Structurally broken (no goal). REFUSES. */
const GOALLESS = {
  version: '1',
  nodes: [option('opt_a', 'A', { fac: 0.4 }), option('opt_b', 'B', { fac: 0.2 })],
  edges: [],
};

function runFact(overrides: {
  readonly graphHash?: string;
  readonly noop?: boolean;
}): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: overrides.noop ?? false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_c0',
      summary: 'Done.',
      ...(overrides.graphHash !== undefined
        ? { graph_hash_at_run: overrides.graphHash }
        : {}),
    },
  } as HandlerFact;
}

// ── Test seams ──────────────────────────────────────────────────────────────

const dispatchMock = vi.fn();
const readPriorFactsMock = vi.fn();

function params(overrides: Partial<Parameters<typeof runAutoRunAfterFreshDraft>[0]> = {}) {
  return {
    scenarioId: SCENARIO_ID,
    draftTurnId: DRAFT_TURN_ID,
    draftGraph: MIXED,
    draftGraphHash: DRAFT_GRAPH_HASH,
    requestId: REQUEST_ID,
    dispatchRunAnalysis: dispatchMock as unknown as AutoRunDispatchFn,
    readPriorFacts: readPriorFactsMock as unknown as AutoRunPriorFactsReader,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readPriorFactsMock.mockResolvedValue({ status: 'ok', facts: [] });
  dispatchMock.mockResolvedValue({ outcome: 'ok', commitPerformed: true });
});

// ── 1. Admission gating (the mutant obligation) ─────────────────────────────

describe('runAutoRunAfterFreshDraft — admission gate (real resolveRunAdmission)', () => {
  it('fixture sanity: the arms discriminate under the REAL admission authority', () => {
    // The gate under test must be able to answer differently across the arms —
    // an admission probe that returns the same verdict for every fixture is
    // reporting on itself (trap 20). No mocks anywhere in this spec file for
    // resolveRunAdmission: this is the production predicate.
    expect(resolveRunAdmission(MIXED).willProceed).toBe(true);
    expect(resolveRunAdmission(FULLY_CONFIGURED).willProceed).toBe(true);
    expect(resolveRunAdmission(NONE_CONFIGURED).willProceed).toBe(false);
    expect(resolveRunAdmission(GOALLESS).willProceed).toBe(false);
  });

  it('does NOT dispatch on an inadmissible graph (none configured) — and does not fabricate anything', async () => {
    const out = await runAutoRunAfterFreshDraft(params({ draftGraph: NONE_CONFIGURED }));
    expect(out).toEqual({ outcome: 'skipped', reason: 'not_admissible' });
    expect(dispatchMock).not.toHaveBeenCalled();
    // No fabrication: the skip path must not even read prior facts, let alone
    // synthesise a result.
    expect(readPriorFactsMock).not.toHaveBeenCalled();
  });

  it('does NOT dispatch on a structurally broken graph (no goal)', async () => {
    const out = await runAutoRunAfterFreshDraft(params({ draftGraph: GOALLESS }));
    expect(out).toEqual({ outcome: 'skipped', reason: 'not_admissible' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('DISPATCHES on the witnessed fresh-draft state (mixed arm, admitted via exclusion)', async () => {
    const out = await runAutoRunAfterFreshDraft(params({ draftGraph: MIXED }));
    expect(out.outcome).toBe('dispatched');
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('DISPATCHES on a strictly-ready graph', async () => {
    const out = await runAutoRunAfterFreshDraft(params({ draftGraph: FULLY_CONFIGURED }));
    expect(out.outcome).toBe('dispatched');
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('synthesises a chip-click-shaped run_analysis payload with a FRESH turn id and the autoRun trigger', async () => {
    await runAutoRunAfterFreshDraft(params());
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const call = dispatchMock.mock.calls[0][0];
    expect(call.payload.kind).toBe('message');
    expect(call.payload.scenario_id).toBe(SCENARIO_ID);
    expect(call.payload.stage).toBe('analyse');
    expect(call.payload.source).toBe('chip_click');
    expect(call.payload.chip?.action_type).toBe('run_analysis');
    // A server-initiated follow-up turn is a NEW turn, never a reuse of the
    // draft's turn id (append_turn_atomic identity).
    expect(call.payload.turn_id).not.toBe(DRAFT_TURN_ID);
    expect(call.payload.turn_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // The trigger param is what makes the dispatch commit honestly (no
    // fabricated user message) and stamp provenance.
    expect(call.autoRun).toEqual({ draftTurnId: DRAFT_TURN_ID });
  });
});

// ── 2. Already-analysed negative (hash-identity bound) ──────────────────────

describe('runAutoRunAfterFreshDraft — already-analysed suppression', () => {
  it('SKIPS when a successful run_analysis fact exists for the SAME graph hash', async () => {
    readPriorFactsMock.mockResolvedValue({
      status: 'ok',
      facts: [runFact({ graphHash: DRAFT_GRAPH_HASH })],
    });
    const out = await runAutoRunAfterFreshDraft(params());
    expect(out).toEqual({ outcome: 'skipped', reason: 'already_analysed' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('DISPATCHES when the prior successful fact is for a DIFFERENT graph hash (identity pair twin)', async () => {
    readPriorFactsMock.mockResolvedValue({
      status: 'ok',
      facts: [runFact({ graphHash: 'aag_v1:00000000000000000000000000000000' })],
    });
    const out = await runAutoRunAfterFreshDraft(params());
    expect(out.outcome).toBe('dispatched');
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('DISPATCHES when the matching-hash fact is a noop (a noop run is not an existing analysis)', async () => {
    readPriorFactsMock.mockResolvedValue({
      status: 'ok',
      facts: [runFact({ graphHash: DRAFT_GRAPH_HASH, noop: true })],
    });
    const out = await runAutoRunAfterFreshDraft(params());
    expect(out.outcome).toBe('dispatched');
  });

  it('DISPATCHES when the draft hash is null (no hash → the guard cannot bind, and the run path owns admission)', async () => {
    readPriorFactsMock.mockResolvedValue({
      status: 'ok',
      facts: [runFact({ graphHash: DRAFT_GRAPH_HASH })],
    });
    const out = await runAutoRunAfterFreshDraft(params({ draftGraphHash: null }));
    expect(out.outcome).toBe('dispatched');
  });

  it('DISPATCHES on a degraded prior-fact read (a duplicate rerun is the cheaper harm than silently never running)', async () => {
    readPriorFactsMock.mockResolvedValue({ status: 'degraded', facts: [] });
    const out = await runAutoRunAfterFreshDraft(params());
    expect(out.outcome).toBe('dispatched');
  });
});

// ── 3. Non-blocking contract ────────────────────────────────────────────────

describe('runAutoRunAfterFreshDraft — non-blocking contract', () => {
  it('a throwing dispatch is reported as failed, never propagated', async () => {
    dispatchMock.mockRejectedValue(new Error('PLoT unreachable'));
    const out = await runAutoRunAfterFreshDraft(params());
    expect(out).toEqual({ outcome: 'failed' });
  });

  it('a throwing prior-facts reader is contained (proceeds or fails, never throws)', async () => {
    readPriorFactsMock.mockRejectedValue(new Error('store down'));
    await expect(runAutoRunAfterFreshDraft(params())).resolves.toBeDefined();
  });
});

// ── 4. Off-the-critical-path scheduling ─────────────────────────────────────

describe('scheduleAutoRunAfterFreshDraft — never on the draft critical path', () => {
  it('returns synchronously WITHOUT invoking the dispatch; the work runs on a later tick', async () => {
    scheduleAutoRunAfterFreshDraft(params());
    // Synchronous window: nothing has run yet. This is the latency property —
    // the draft response is handed to the transport before any auto-run work.
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(readPriorFactsMock).not.toHaveBeenCalled();
    // Flush the scheduled macrotask.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when the core rejects unexpectedly', async () => {
    dispatchMock.mockRejectedValue(new Error('boom'));
    expect(() => scheduleAutoRunAfterFreshDraft(params())).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  });
});
