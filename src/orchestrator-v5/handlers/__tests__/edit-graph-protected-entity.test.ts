/**
 * F-3 negation guard — protected-entity demotion at the referee gate
 * (S-AUDIT-2026-07-20 probe-edit-lane.md P8/P9, F-3 ESCALATED).
 *
 * The live probe proved the edit LLM is negation-blind: A5/A6 adversarial
 * phrasings ("… the configuration of Cloud-Native CRM shouldn't change" /
 * "Configure nothing on Cloud-Native CRM; …") produced a would_apply
 * update_node_field op TARGETING the protected option, which auto-applied
 * (DB-verified twice, 0.58→0.5→0.52). #581's "the LLM reads negation for
 * itself" rationale is REFUTED on the wire; the containment must be a
 * deterministic MECHANISM at the one seam every edit-lane op passes through
 * post-LLM (the referee gate), per the standing edit-target demotion ruling:
 * option-configuration redirects go propose_and_confirm, never auto-apply.
 *
 * Pins (RED-first from the probe's EXACT phrasings):
 *  - A5/A6: the op targeting the protected option is DEMOTED
 *    would_apply → held (propose_and_confirm surface: pending + confirm
 *    chip), copy NAMES the protected entity, blockApply=true — nothing
 *    auto-applies;
 *  - the legitimate half is NOT stalled: an op in the same batch that does
 *    NOT target a protected entity keeps its would_apply verdict
 *    (batch governing goes held, so the whole batch rides the ONE confirm
 *    tap — the stated conservative bias — but the verdict tally proves the
 *    guard discriminates per-op);
 *  - positive controls stay green: P12 ("Set CRM Platform Cost to 45000
 *    pounds.") and T12 ("Configure Cloud-Native CRM: set its …") carry no
 *    protection cue and proceed byte-identically;
 *  - the gm_held_resume path (confirm) does not re-demote: no userMessage
 *    is threaded at resume, so a confirmed hold still executes;
 *  - protected-hold copy survives the egress guards (no success claim, no
 *    forbidden phrase).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import * as telemetry from '../../../utils/telemetry.js';

// ── fixtures — the probe scenario's entities (60d8618f) ─────────────────────

const GRAPH = {
  nodes: [
    { id: 'g-roi', kind: 'goal', label: '3-Year ROI Realised' },
    { id: 'd-crm', kind: 'decision', label: 'Which CRM' },
    { id: 'fac_feature_depth', kind: 'factor', label: 'CRM Feature Depth', observed_state: { value: 0.5 } },
    { id: 'fac_cost', kind: 'factor', label: 'CRM Platform Cost', observed_state: { value: 0.4 } },
    {
      id: 'opt_cloud_native',
      kind: 'option',
      label: 'Cloud-Native CRM',
      interventions: { fac_cost: { value: 0.58 } },
    },
  ],
  edges: [
    { from: 'd-crm', to: 'opt_cloud_native', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_cloud_native', to: 'fac_cost', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_feature_depth', to: 'g-roi', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_cost', to: 'g-roi', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

/** The op the edit LLM actually emitted on P8/P9: an interventions write
 *  TARGETING the protected option (update_node_field after projection). */
const PROTECTED_OPTION_OP = {
  op: 'update_node',
  path: 'opt_cloud_native',
  value: { interventions: { fac_cost: { value: 0.5 } } },
  old_value: { interventions: { fac_cost: { value: 0.58 } } },
};

/** The legitimate half the LLM dropped: a factor write NOT targeting the
 *  protected option (description is field-allowlist-safe and tunable). */
const FACTOR_OP = {
  op: 'update_node',
  path: 'fac_cost',
  value: { description: 'Total platform cost over three years' },
};

/** Probe P8 (A5) — DB-verified wrong-entity auto-apply on staging b3d3742. */
const A5_MESSAGE =
  "Set CRM Platform Cost to 0.5 - the configuration of Cloud-Native CRM shouldn't change.";
/** Probe P9 (A6) — same escalation, second phrasing. */
const A6_MESSAGE =
  'Configure nothing on Cloud-Native CRM; just set CRM Platform Cost to 0.52.';
/** "but do NOT touch X" class from the brief. */
const BUT_NOT_MESSAGE =
  'Set CRM Platform Cost to 0.5 but do NOT touch Cloud-Native CRM.';
/** Probe P12 positive control — deterministic factor set, no protection cue. */
const P12_MESSAGE = 'Set CRM Platform Cost to 45000 pounds.';
/** Probe P4 (T12) positive control — compound configure, no protection cue. */
const T12_MESSAGE =
  'Configure Cloud-Native CRM: set its CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55.';

function baseInput(overrides: Partial<Parameters<typeof evaluateEditGraphMutations>[0]> = {}) {
  const hash = hashOf(GRAPH);
  return {
    mode: 'live' as const,
    operations: [PROTECTED_OPTION_OP],
    currentGraph: GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none' as const,
    scenarioId: 'scn-f3',
    turnId: 'turn-f3',
    requestId: 'req-f3',
    ...overrides,
  };
}

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

// ── the A5/A6 escalation: protected-target ops must never auto-apply ────────

describe('F-3 guard — probe A5/A6 phrasings hold instead of auto-applying', () => {
  it.each([
    ['A5', A5_MESSAGE],
    ['A6', A6_MESSAGE],
    ['but-not', BUT_NOT_MESSAGE],
  ])('%s: op targeting the protected option is demoted to held with a real pending', (_name, message) => {
    const decision = evaluateEditGraphMutations(baseInput({ userMessage: message }));
    expect(decision.governing).toBe('held');
    expect(decision.blockApply).toBe(true);
    // propose_and_confirm surface: a real pending + confirm chip exist.
    expect(decision.pendingActions).not.toBeNull();
    expect(decision.pendingActions).toHaveLength(1);
    expect(decision.suggestedActions).not.toBeNull();
    expect(decision.suggestedActions!.length).toBeGreaterThan(0);
    // The copy NAMES the protected entity and is not success/forbidden prose.
    expect(decision.assistantText).toContain('Cloud-Native CRM');
    expect(findSuccessClaimHit(decision.assistantText ?? '')).toBeNull();
    expect(findForbiddenPhraseHit(decision.assistantText ?? '')).toBeNull();
    // The demotion is visible in the redacted public reason.
    expect(decision.publicReason?.blocker_code).toBe('USER_PROTECTED_ENTITY');
    // Verdict accounting: the single op was demoted, nothing would_apply.
    expect(decision.verdictCounts.would_apply ?? 0).toBe(0);
    expect(decision.verdictCounts.held).toBe(1);
  });

  it('telemetry emits the held verdict (frozen event name, no silent outcome)', () => {
    evaluateEditGraphMutations(baseInput({ userMessage: A5_MESSAGE }));
    const heldEvents = emitSpy.mock.calls.filter(
      (c: readonly unknown[]) => c[0] === telemetry.TelemetryEvents.V5CandidateMutationHeld,
    );
    expect(heldEvents).toHaveLength(1);
    expect((heldEvents[0]![1] as Record<string, unknown>).blocker_code).toBe(
      'USER_PROTECTED_ENTITY',
    );
    // And no would_apply event fired for the demoted op.
    const waEvents = emitSpy.mock.calls.filter(
      (c: readonly unknown[]) => c[0] === telemetry.TelemetryEvents.V5CandidateMutationWouldApply,
    );
    expect(waEvents).toHaveLength(0);
  });

  it('shadow mode: demotion is telemetry-visible but NEVER blocks (A3 observe contract)', () => {
    const decision = evaluateEditGraphMutations(
      baseInput({ mode: 'shadow', userMessage: A5_MESSAGE }),
    );
    expect(decision.blockApply).toBe(false);
    expect(decision.verdictCounts.held).toBe(1);
  });
});

// ── the legitimate half is not demoted (per-op discrimination) ──────────────

describe('F-3 guard — ops NOT targeting a protected entity keep would_apply', () => {
  it('A6 with both halves emitted: factor op stays would_apply, option op holds', () => {
    const decision = evaluateEditGraphMutations(
      baseInput({
        operations: [PROTECTED_OPTION_OP, FACTOR_OP],
        userMessage: A6_MESSAGE,
      }),
    );
    // Governing is held (whole batch rides one confirm tap — conservative
    // bias, stated), but the tally proves per-op discrimination: the
    // legitimate factor op was NOT demoted.
    expect(decision.governing).toBe('held');
    expect(decision.verdictCounts.held).toBe(1);
    expect(decision.verdictCounts.would_apply).toBe(1);
  });

  it('A5: the factor named only in the SET clause is not treated as protected', () => {
    const decision = evaluateEditGraphMutations(
      baseInput({ operations: [FACTOR_OP], userMessage: A5_MESSAGE }),
    );
    // The op targets fac_cost ("CRM Platform Cost"), which the user asked to
    // SET, not to protect — the dash-separated protection clause names only
    // Cloud-Native CRM. No demotion; proceeds.
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
  });
});

// ── P1 (adversarial review 2026-07-20): protected FACTOR reached through ────
// ── ANOTHER node's interventions map. The write's direct node is the OPTION,
// ── so the protected FACTOR never appeared in the target set and the write
// ── AUTO-APPLIED (the guard's whole point). envelopeTargetNodeIds must yield
// ── the factor id via the interventions key — from BOTH the whole-map shape
// ── and the canonical slash-keyed `data/interventions/<factor>` shape. ──────

/** The op writes the OPTION, configuring the FACTOR via the interventions
 *  map (whole-map spelling). Direct node_id = the option; factor = the key. */
const CONFIGURE_FACTOR_VIA_OPTION_MAP_OP = {
  op: 'update_node',
  path: 'opt_cloud_native',
  value: { interventions: { fac_cost: { value: 0.5 } } },
  old_value: { interventions: { fac_cost: { value: 0.58 } } },
};

/** Same reach, canonical slash-keyed field spelling
 *  (`data/interventions/<factor>` — candidate-graph.ts setTunableFieldPath). */
const CONFIGURE_FACTOR_VIA_OPTION_SLASH_OP = {
  op: 'update_node',
  path: 'opt_cloud_native',
  value: { 'data/interventions/fac_cost': { value: 0.5 } },
  old_value: { 'data/interventions/fac_cost': { value: 0.58 } },
};

/** Protects the FACTOR (CRM Platform Cost) while the OPTION is left
 *  configurable — the "but do NOT touch X" class, X = the factor. The option
 *  is named only in the non-protective clause before the "but" seam, so ONLY
 *  the factor is protected; the demotion can therefore ONLY fire if the
 *  factor is extracted from the interventions key. */
const PROTECT_FACTOR_MESSAGE =
  'Reconfigure Cloud-Native CRM to be cheaper, but do not touch CRM Platform Cost.';

describe('F-3 guard P1 — protected FACTOR reached via an option interventions map', () => {
  it.each([
    ['whole-map', CONFIGURE_FACTOR_VIA_OPTION_MAP_OP],
    ['slash-keyed', CONFIGURE_FACTOR_VIA_OPTION_SLASH_OP],
  ])('%s: writing the protected factor through the option holds, naming the factor', (_name, op) => {
    const decision = evaluateEditGraphMutations(
      baseInput({ operations: [op], userMessage: PROTECT_FACTOR_MESSAGE }),
    );
    // Without the interventions-key extraction the target set is just the
    // OPTION, the protected FACTOR never matches, and this auto-applies.
    expect(decision.governing).toBe('held');
    expect(decision.blockApply).toBe(true);
    expect(decision.verdictCounts.would_apply ?? 0).toBe(0);
    expect(decision.verdictCounts.held).toBe(1);
    // The hold NAMES the protected factor, not the option carrying the map.
    expect(decision.assistantText).toContain('CRM Platform Cost');
    expect(findSuccessClaimHit(decision.assistantText ?? '')).toBeNull();
    expect(findForbiddenPhraseHit(decision.assistantText ?? '')).toBeNull();
    expect(decision.publicReason?.blocker_code).toBe('USER_PROTECTED_ENTITY');
  });

  it('no protection cue: the same option-configure write auto-applies (no over-hold)', () => {
    const decision = evaluateEditGraphMutations(
      baseInput({
        operations: [CONFIGURE_FACTOR_VIA_OPTION_MAP_OP],
        userMessage: 'Make Cloud-Native CRM cheaper by setting CRM Platform Cost to 0.5.',
      }),
    );
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
    expect(decision.verdictCounts.would_apply).toBe(1);
  });
});

// ── positive controls (probe P12 / T12) — no cue, byte-identical proceed ────

describe('F-3 guard — positive controls stay green', () => {
  it.each([
    ['P12', P12_MESSAGE],
    ['T12', T12_MESSAGE],
  ])('%s: no protection cue, tunable op proceeds', (_name, message) => {
    const decision = evaluateEditGraphMutations(
      baseInput({ userMessage: message }),
    );
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
    expect(decision.verdictCounts.would_apply).toBe(1);
  });

  it('no userMessage threaded (gm_held_resume confirm path): no demotion, executes', () => {
    const decision = evaluateEditGraphMutations(
      baseInput({ dispatchPath: 'gm_held_resume' as const }),
    );
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
  });
});
