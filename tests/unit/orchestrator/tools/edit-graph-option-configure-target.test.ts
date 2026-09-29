/**
 * POC-BOARD 5c — option-configuration target resolution (Step-0 capture
 * T12b, 2026-07-17): "Configure the Cloud-Native CRM option: set CRM
 * Feature Depth to 0.7, set CRM Platform Cost to 0.55." DID reach the edit
 * lane, but `resolveEditTarget`'s exact-label stage treated the named
 * FACTORS as competing targets with the option, went ambiguous, and the
 * clarifier asked "Which option should I update: CRM Feature Depth or CRM
 * Platform Cost or Cloud-Native CRM?" — offering factors as options.
 *
 * Doctrine pinned here: in an option-configuration edit, factor labels in
 * the message are the FIELDS being configured, not candidate targets. When
 * exactly one OPTION is named, it is the target (high confidence). When
 * several options are named, the ambiguity set contains ONLY options.
 * Structural intents are excluded (an add-option request must not resolve
 * to an existing option), and factor-only edits keep today's behaviour.
 */
import { describe, it, expect } from 'vitest';

import {
  classifyEditIntent,
  resolveEditTarget,
} from '../../../../src/orchestrator/tools/edit-graph.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';

function makeCrmContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'dec_crm', kind: 'decision', label: 'CRM Platform Selection' },
        { id: 'opt_cloud', kind: 'option', label: 'Cloud-Native CRM' },
        { id: 'opt_onprem', kind: 'option', label: 'On-Prem Suite' },
        { id: 'fac_depth', kind: 'factor', label: 'CRM Feature Depth' },
        { id: 'fac_cost', kind: 'factor', label: 'CRM Platform Cost' },
        { id: 'goal_roi', kind: 'goal', label: 'Maximise 3-Year ROI' },
      ],
      edges: [],
    } as unknown as ConversationContext['graph'],
  } as unknown as ConversationContext;
}

describe('resolveEditTarget — option-configuration target preference (5c / T12b)', () => {
  it('T12b: the configure-option message resolves to the OPTION, not an ambiguity with its factors', () => {
    const message =
      'Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7, set CRM Platform Cost to 0.55.';
    const intent = classifyEditIntent(message);
    expect(intent).toBe('option_configuration');

    const resolution = resolveEditTarget(message, makeCrmContext(), intent);
    expect(resolution.resolved_target?.label).toBe('Cloud-Native CRM');
    expect(resolution.resolved_target?.type).toBe('option');
    expect(resolution.match_type).not.toBe('ambiguous');
    expect(resolution.confidence).toBe('high');
    expect(resolution.alternatives).toHaveLength(0);
  });

  it('T12: "Configure {option}: set {factor} to N" (no "option" word) still resolves to the option', () => {
    const message =
      'Configure Cloud-Native CRM: set its CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55.';
    const resolution = resolveEditTarget(message, makeCrmContext(), classifyEditIntent(message));
    expect(resolution.resolved_target?.label).toBe('Cloud-Native CRM');
    expect(resolution.resolved_target?.type).toBe('option');
    expect(resolution.match_type).not.toBe('ambiguous');
  });

  it("T15: the assistant's own suggested format resolves to the option", () => {
    const message =
      'Set CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55 for the Cloud-Native CRM option.';
    const intent = classifyEditIntent(message);
    expect(intent).toBe('option_configuration');

    const resolution = resolveEditTarget(message, makeCrmContext(), intent);
    expect(resolution.resolved_target?.label).toBe('Cloud-Native CRM');
    expect(resolution.resolved_target?.type).toBe('option');
    expect(resolution.match_type).not.toBe('ambiguous');
  });

  it('several named options stay ambiguous, but the alternatives list contains ONLY options', () => {
    const message =
      'Configure the Cloud-Native CRM option and the On-Prem Suite option: set CRM Feature Depth to 0.7.';
    const resolution = resolveEditTarget(message, makeCrmContext(), classifyEditIntent(message));
    expect(resolution.match_type).toBe('ambiguous');
    const alternativeLabels = resolution.alternatives.map((a) => a.label).sort();
    expect(alternativeLabels).toEqual(['Cloud-Native CRM', 'On-Prem Suite']);
  });

  it('regression pin: a factor-only value edit keeps resolving to the factor', () => {
    const message = 'Set CRM Feature Depth to 0.7.';
    const resolution = resolveEditTarget(message, makeCrmContext(), classifyEditIntent(message));
    expect(resolution.resolved_target?.label).toBe('CRM Feature Depth');
    expect(resolution.resolved_target?.type).toBe('factor');
  });

  it('regression pin: a structural add-option request never snaps to an existing option target', () => {
    const message = 'Add a new option called Hybrid CRM and connect it to CRM Feature Depth.';
    const intent = classifyEditIntent(message);
    expect(intent).toBe('structural');

    const resolution = resolveEditTarget(message, makeCrmContext(), intent);
    // The factor named in the message may resolve; the existing OPTION must not
    // be forced in as the single target by the option-preference rule.
    expect(resolution.resolved_target?.type === 'option').toBe(false);
  });
});
