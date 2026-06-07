/**
 * V5 chip-suppression contract — defensive validation pass on chip egress.
 *
 * Background: V5 source code never assigns `action_type: null`, but the
 * V5 golden-path baseline observed it on a Step 5 chip from an earlier
 * deploy. The brief's policy is "dead or misleading chips are worse than
 * missing chips" — we suppress any chip that cannot map to a registered
 * handler rather than fabricating a fallback action_type.
 *
 * Rules:
 *   - chip with action_type=null → dropped
 *   - chip with action_type pointing at an unregistered handler → dropped
 *   - chip with no action_type field (prompt chip) → kept as-is
 *   - chip with action_type for a registered handler → kept as-is
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const logWarnMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/telemetry.js')>(
    '../../../utils/telemetry.js',
  );
  return { ...actual, log: { ...actual.log, warn: logWarnMock } };
});

import { validateAndFilterChips } from '../chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { SuggestedAction } from '../types.js';

const REGISTRY = HANDLER_VALIDATION_REGISTRY;

const promptChip: SuggestedAction = {
  id: 'chip_prompt_explain_result',
  label: 'Explain the result',
  message: 'Please explain the analysis result in plain language.',
};

const registeredActionChip: SuggestedAction = {
  id: 'chip_action_run_analysis',
  label: 'Run analysis',
  message: 'Run analysis.',
  action_type: 'run_analysis',
};

const nullActionChip = {
  id: 'chip_action_null',
  label: 'Mystery chip',
  message: 'Mystery chip.',
  action_type: null as unknown as 'run_analysis',
};

const unregisteredActionChip = {
  id: 'chip_action_unmapped',
  label: 'Edit factor',
  message: 'Edit factor.',
  // 'edit_factor' is in V5ActionType but NOT registered in the
  // validation registry on this branch.
  action_type: 'edit_factor' as unknown as 'run_analysis',
};

describe('validateAndFilterChips — V5 chip-suppression contract', () => {
  beforeEach(() => {
    logWarnMock.mockClear();
  });

  it('drops a chip with literal null action_type', () => {
    const out = validateAndFilterChips(
      [registeredActionChip, nullActionChip],
      REGISTRY,
    );
    expect(out.map((c) => c.id)).toEqual(['chip_action_run_analysis']);
  });

  it('drops a chip whose action_type points at an unregistered handler', () => {
    const out = validateAndFilterChips(
      [registeredActionChip, unregisteredActionChip],
      REGISTRY,
    );
    expect(out.map((c) => c.id)).toEqual(['chip_action_run_analysis']);
  });

  it('keeps a prompt chip with no action_type field', () => {
    const out = validateAndFilterChips([promptChip], REGISTRY);
    expect(out).toEqual([promptChip]);
  });

  it('keeps a chip with action_type for a registered handler', () => {
    const out = validateAndFilterChips([registeredActionChip], REGISTRY);
    expect(out).toEqual([registeredActionChip]);
  });

  it('preserves order and mixes pass-through with suppression', () => {
    const out = validateAndFilterChips(
      [promptChip, nullActionChip, registeredActionChip, unregisteredActionChip],
      REGISTRY,
    );
    expect(out.map((c) => c.id)).toEqual([
      'chip_prompt_explain_result',
      'chip_action_run_analysis',
    ]);
  });

  it('does not invent a fallback action_type — suppressed chips are not transformed', () => {
    const out = validateAndFilterChips([nullActionChip], REGISTRY);
    expect(out).toEqual([]);
  });

  it('returns empty array on empty input', () => {
    expect(validateAndFilterChips([], REGISTRY)).toEqual([]);
  });

  it('emits structured telemetry for null action_type drops (event=v5.chip.suppressed, reason=null_action_type)', () => {
    validateAndFilterChips([nullActionChip], REGISTRY);
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    const [meta] = logWarnMock.mock.calls[0];
    expect(meta).toMatchObject({
      event: 'v5.chip.suppressed',
      action_type: null,
      reason: 'null_action_type',
    });
    // Content-free telemetry: no user-facing chip copy in logs.
    expect(meta).not.toHaveProperty('chip_label');
  });

  it('emits structured telemetry for unregistered-handler drops (reason=unregistered_handler)', () => {
    validateAndFilterChips([unregisteredActionChip], REGISTRY);
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    const [meta] = logWarnMock.mock.calls[0];
    expect(meta).toMatchObject({
      event: 'v5.chip.suppressed',
      action_type: 'edit_factor',
      reason: 'unregistered_handler',
    });
    // Content-free telemetry: no user-facing chip copy in logs.
    expect(meta).not.toHaveProperty('chip_label');
  });

  it('does NOT emit telemetry when prompt chips or registered chips pass through', () => {
    validateAndFilterChips([promptChip, registeredActionChip], REGISTRY);
    expect(logWarnMock).not.toHaveBeenCalled();
  });
});
