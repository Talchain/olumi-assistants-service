/**
 * Wave 5F-3 — direct unit tests for the chip-click resume-intent
 * detector at the route boundary.
 *
 * The detector is a pure function exported from route-v2.ts. The
 * route handler invokes it once per ingress and threads the result
 * into runTurnExecutor's `chipClickResumeIntent` option. This test
 * pins the boundary contract: which ingress shapes set the flag
 * vs which fall through. The integration of "helper output →
 * runTurnExecutor option" is a single literal pass-through and
 * trusted on the same basis as the existing run_analysis
 * chip-click dispatcher in this same file.
 *
 * Together with src/orchestrator-v5/__tests__/short-confirm-route-level.test.ts
 * (which proves runTurnExecutor's behaviour given the typed flag)
 * this closes the chip-click route-boundary acceptance gap from
 * ChatGPT's fourth review.
 */

import { describe, expect, it } from 'vitest';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { detectChipClickResumeIntent, detectChipClickForcedIntent } from '../route-v2.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function chipClick(
  action_type: string | undefined,
  message: string = 'Explore what would change the result.',
): OrchestratorTurnPayload {
  return {
    kind: 'message',
    scenario_id: SCENARIO_ID,
    turn_id: 't-1',
    stage: 'analyse',
    message,
    turn_class: 'analyse',
    source: 'chip_click',
    ...(action_type !== undefined
      ? { chip: { id: 'chip-x', label: 'X', action_type } }
      : {}),
  } as unknown as OrchestratorTurnPayload;
}

function plainMessage(message: string): OrchestratorTurnPayload {
  return {
    kind: 'message',
    scenario_id: SCENARIO_ID,
    turn_id: 't-1',
    stage: 'analyse',
    message,
    turn_class: 'analyse',
    source: 'composer',
  } as unknown as OrchestratorTurnPayload;
}

describe('detectChipClickResumeIntent — route boundary contract', () => {
  it('returns "what_would_flip" for chip_click + action_type=what_would_flip', () => {
    expect(detectChipClickResumeIntent(chipClick('what_would_flip'))).toBe(
      'what_would_flip',
    );
  });

  it('returns undefined for chip_click + action_type=run_analysis (handled by separate dispatcher upstream)', () => {
    expect(detectChipClickResumeIntent(chipClick('run_analysis'))).toBeUndefined();
  });

  it('returns undefined for chip_click without an action_type (prompt-only chip)', () => {
    expect(detectChipClickResumeIntent(chipClick(undefined))).toBeUndefined();
  });

  it.each(['set_factor_value', 'add_constraint', 'adjust_edge_strength', 'explain_results'])(
    'returns undefined for chip_click with non-what_would_flip action_type "%s"',
    (action_type) => {
      expect(detectChipClickResumeIntent(chipClick(action_type))).toBeUndefined();
    },
  );

  it('returns undefined for plain composer messages (source !== chip_click)', () => {
    expect(detectChipClickResumeIntent(plainMessage('yes'))).toBeUndefined();
    expect(
      detectChipClickResumeIntent(plainMessage('Explore what would change the result.')),
    ).toBeUndefined();
  });

  it('returns undefined for system_event payloads', () => {
    const sysEvent = {
      kind: 'system_event',
      scenario_id: SCENARIO_ID,
      turn_id: 't-1',
      stage: 'analyse',
      event: { type: 'graph_loaded' },
    } as unknown as OrchestratorTurnPayload;
    expect(detectChipClickResumeIntent(sysEvent)).toBeUndefined();
  });
});

describe('detectChipClickForcedIntent — F2 forced explanation-intent contract', () => {
  it('maps a chip_click explain_results pill to the forced explain_results intent', () => {
    expect(detectChipClickForcedIntent(chipClick('explain_results'))).toBe('explain_results');
  });

  it('maps a chip_click what_would_flip pill to the forced what_would_flip intent', () => {
    expect(detectChipClickForcedIntent(chipClick('what_would_flip'))).toBe('what_would_flip');
  });

  // HAZARD 3 — the singular `explain_result` alias is NOT a registered handler
  // id; it must be canonicalised to `explain_results` at the typed door so it
  // pins to a real handler instead of 400ing as UNSUPPORTED_ACTION downstream.
  it('canonicalises the singular explain_result alias to explain_results', () => {
    expect(detectChipClickForcedIntent(chipClick('explain_result'))).toBe('explain_results');
  });

  it('returns undefined for run_analysis (stays deterministic) and other non-explanation chips', () => {
    expect(detectChipClickForcedIntent(chipClick('run_analysis'))).toBeUndefined();
    expect(detectChipClickForcedIntent(chipClick('set_factor_value'))).toBeUndefined();
    expect(detectChipClickForcedIntent(chipClick('analysis_readiness'))).toBeUndefined();
    expect(detectChipClickForcedIntent(chipClick(undefined))).toBeUndefined();
  });

  it('returns undefined when the analytical copy arrives as free text (source !== chip_click) — no regex routing', () => {
    expect(detectChipClickForcedIntent(plainMessage('Please explain the analysis result.'))).toBeUndefined();
  });

  it('returns undefined for system_event payloads', () => {
    const sysEvent = {
      kind: 'system_event',
      scenario_id: SCENARIO_ID,
      turn_id: 't-1',
      stage: 'analyse',
      event: { type: 'graph_loaded' },
    } as unknown as OrchestratorTurnPayload;
    expect(detectChipClickForcedIntent(sysEvent)).toBeUndefined();
  });
});
