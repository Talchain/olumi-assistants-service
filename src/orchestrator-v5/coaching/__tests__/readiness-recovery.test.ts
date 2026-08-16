import { describe, expect, it } from 'vitest';

import {
  buildReadinessRecoveryChip,
  projectReadinessRecovery,
} from '../readiness-recovery.js';

const NODES = [
  { id: 'opt_fast', kind: 'option', label: 'Move quickly' },
  { id: 'fac_capacity', kind: 'factor', label: 'Delivery capacity' },
] as const;

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
