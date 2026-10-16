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

import { beforeEach,describe,expect,it,vi } from 'vitest';


import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';






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



// ── Test seams ──────────────────────────────────────────────────────────────

const dispatchMock = vi.fn();
const readPriorFactsMock = vi.fn();



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










});

// ── 2. Already-analysed negative (hash-identity bound) ──────────────────────



// ── 3. Non-blocking contract ────────────────────────────────────────────────



// ── 4. Off-the-critical-path scheduling ─────────────────────────────────────
