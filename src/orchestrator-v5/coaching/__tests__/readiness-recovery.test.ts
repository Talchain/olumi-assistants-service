import { describe, expect, it } from 'vitest';

import {
  buildReadinessEffectPending,
  buildReadinessRecoveryChip,
  projectReadinessRecovery,
} from '../readiness-recovery.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  parsePendingAction,
} from '../../session/pending-action.js';

const NODES = [
  { id: 'opt_fast', kind: 'option', label: 'Move quickly' },
  { id: 'fac_capacity', kind: 'factor', label: 'Delivery capacity' },
] as const;

const ASKED_READINESS = {
  status: 'needs_user_input',
  blockers: [{
    blocker_type: 'missing_value',
    option_id: 'opt_fast', option_label: 'Move quickly',
    factor_id: 'fac_capacity', factor_label: 'Delivery capacity',
  }],
};

const PENDING_INPUT = {
  analysisReady: ASKED_READINESS,
  nodes: NODES,
  scenarioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  graphHash: 'hash-of-persisted-graph',
  emittedAtIso: '2026-08-30T19:00:00.000Z',
};

describe('readiness effect pending producer', () => {
  it('round-trips the same asked pair with the existing pending lifecycle', () => {
    const pending = buildReadinessEffectPending(PENDING_INPUT);
    expect(parsePendingAction(pending)).toMatchObject({
      scenario_id: PENDING_INPUT.scenarioId,
      chip_id: 'chip_configure_option_clarify',
      action: {
        kind: 'elicit_option_effect', option_id: 'opt_fast', option_label: 'Move quickly',
        factor_id: 'fac_capacity', factor_label: 'Delivery capacity',
      },
      preconditions: { graph_hash: PENDING_INPUT.graphHash },
      expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
      emitted_at_iso: PENDING_INPUT.emittedAtIso,
      expires_at_iso: new Date(Date.parse(PENDING_INPUT.emittedAtIso) + PENDING_ACTION_DEFAULT_WALL_TTL_MS).toISOString(),
    });
  });

  it.each(['ready', 'blocked', 'needs_user_mapping', 'needs_encoding', 'unknown'])(
    'does not turn %s into a value question merely because blockers exist', (status) => {
      expect(buildReadinessEffectPending({
        ...PENDING_INPUT, analysisReady: { ...ASKED_READINESS, status },
      })).toBeNull();
    },
  );

  it('does not skip a non-value head to arm a later value blocker', () => {
    expect(buildReadinessEffectPending({
      ...PENDING_INPUT,
      analysisReady: { ...ASKED_READINESS, blockers: [
        { ...ASKED_READINESS.blockers[0], blocker_type: 'missing_connection' },
        ...ASKED_READINESS.blockers,
      ] },
    })).toBeNull();
  });

  it.each([
    ['absent endpoints', []],
    ['foreign option', NODES.filter((node) => node.kind !== 'option')],
    ['wrong kind', NODES.map((node) => ({ ...node, kind: 'factor' }))],
    ['duplicate ID', [...NODES, NODES[0]]],
    ['renamed endpoint', NODES.map((node) => ({ ...node, label: `New ${node.label}` }))],
  ])('fails weak on %s instead of licensing a stale or ambiguous pair', (_name, nodes) => {
    expect(buildReadinessEffectPending({ ...PENDING_INPUT, nodes })).toBeNull();
  });

  it('keeps exact identity with duplicate labels and ignores node ordering', () => {
    const pending = buildReadinessEffectPending({
      ...PENDING_INPUT,
      nodes: [{ ...NODES[0], id: 'other_option' }, ...[...NODES].reverse()],
    });
    expect(pending?.action).toMatchObject({ kind: 'elicit_option_effect', option_id: 'opt_fast' });
  });

  it('requires full typed head identity, not labels recovered from the graph alone', () => {
    expect(buildReadinessEffectPending({
      ...PENDING_INPUT,
      analysisReady: { status: 'needs_user_input', blockers: [{
        blocker_type: 'missing_value', option_id: 'opt_fast', factor_id: 'fac_capacity',
      }] },
    })).toBeNull();
  });

  it.each([
    { graphHash: '' }, { scenarioId: '' }, { emittedAtIso: 'invalid' },
    { analysisReady: undefined },
  ])('does not invent a missing persistence precondition: %j', (override) => {
    expect(buildReadinessEffectPending({ ...PENDING_INPUT, ...override })).toBeNull();
  });
});

describe('readiness recovery authority', () => {
  it('admits Run only for exact ready', () => {
    const recovery = projectReadinessRecovery({ status: 'ready' }, NODES);
    expect(recovery.kind).toBe('run');
    expect(recovery.nextStep).toContain('run the analysis');
    expect(buildReadinessRecoveryChip({ status: 'ready' }, NODES)).toBeNull();
  });

  it('keeps blocked authoritative over an incidental value blocker', () => {
    const readiness = {
      status: 'blocked',
      blockers: [{
        blocker_type: 'missing_value',
        option_id: 'opt_fast',
        factor_id: 'fac_capacity',
      }],
    };
    const recovery = projectReadinessRecovery(readiness, NODES);
    expect(recovery.kind).toBe('resolve_model_issue');
    expect(recovery.nextStep).toContain('resolve the model issue');
    expect(recovery.nextStep).not.toContain('effect value');
    expect(buildReadinessRecoveryChip(readiness, NODES)).toMatchObject({
      id: 'chip_prompt_resolve_model_issue',
      label: 'Resolve model issue',
    });
  });

  it('keeps needs_user_mapping authoritative over a factor-only missing_value blocker', () => {
    const readiness = {
      status: 'needs_user_mapping',
      blockers: [{ blocker_type: 'missing_value', factor_id: 'fac_capacity' }],
      options: [{ id: 'opt_fast', label: 'Move quickly', status: 'ready' }],
    };
    const recovery = projectReadinessRecovery(readiness, NODES);
    expect(recovery.kind).toBe('map_option');
    expect(recovery.nextStep).toContain('which option changes which factor');
    expect(recovery.nextStep).not.toContain('effect value');
    expect(buildReadinessRecoveryChip(readiness, NODES)).toMatchObject({
      id: 'chip_prompt_map_factor_to_option',
      label: 'Map "Delivery capacity" to an option',
    });
  });

  it('routes needs_encoding to the existing configure-option flow', () => {
    const readiness = {
      status: 'needs_encoding',
      options: [{ id: 'opt_fast', label: 'Move quickly', status: 'needs_encoding' }],
    };
    const recovery = projectReadinessRecovery(readiness, NODES);
    expect(recovery.kind).toBe('encode_option');
    expect(recovery.nextStep).toContain('represented on the effect scale');
    expect(buildReadinessRecoveryChip(readiness, NODES)).toMatchObject({
      id: 'chip_prompt_configure_option',
      label: 'Configure Move quickly',
    });
  });

  it('uses precise value recovery only for needs_user_input with both labelled endpoints', () => {
    const precise = {
      status: 'needs_user_input',
      blockers: [{
        blocker_type: 'missing_value',
        option_id: 'opt_fast',
        factor_id: 'fac_capacity',
      }],
    };
    expect(projectReadinessRecovery(precise, NODES)).toMatchObject({
      kind: 'provide_value',
      optionLabel: 'Move quickly',
      factorLabel: 'Delivery capacity',
    });

    const partial = {
      status: 'needs_user_input',
      blockers: [{ blocker_type: 'missing_value', factor_id: 'fac_capacity' }],
    };
    const fallback = projectReadinessRecovery(partial, NODES);
    expect(fallback.kind).toBe('configure_option');
    expect(fallback.nextStep).not.toContain('missing effect value');
  });

  it.each([
    ['missing', undefined],
    ['unknown', { status: 'future_status' }],
  ])('fails closed for %s readiness', (_name, readiness) => {
    const recovery = projectReadinessRecovery(readiness, NODES);
    expect(recovery.kind).toBe('review_model');
    expect(recovery.nextStep).not.toContain('run the analysis');
    expect(buildReadinessRecoveryChip(readiness, NODES)).toMatchObject({
      id: 'chip_prompt_review_model_gaps',
      label: 'Review model gaps',
    });
  });
});
