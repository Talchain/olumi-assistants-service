/**
 * REVIEW-573 C-1/C-2 — consent demotion for option-preferred resolutions.
 *
 * The adversarial review of PR #573 (parallel-briefs/REVIEW-573-2026-07-20.md)
 * proved `preferOptionTargetForOptionConfiguration` is negation/governance-
 * blind: phrasings where the user explicitly PROTECTED the option still
 * resolved it as the edit target at high confidence and — being single-clause
 * and non-compound — reached `auto_apply`. The exact wrong-entity-write class
 * 5c exists to kill, minus the clarifier that used to catch it.
 *
 * Ruling (coordinator, 2026-07-20): a heuristically REDIRECTED target never
 * auto-applies. `resolveEditTarget` flags the redirect
 * (`option_target_preferred`) and `determineEditResolutionMode` demotes it to
 * `propose_and_confirm` — the held-proposal consent flow names the resolved
 * entity, so a wrong pick is visible and declinable. Both preference arms are
 * demoted: the probes below prove the exposure is shared (A5/A6 land via the
 * configure-vocab arm; the third probe lands the SAME auto-apply via the
 * option_configuration-intent arm with no configure vocabulary at all).
 *
 * The adversarial phrasings are verbatim from the review — do not paraphrase.
 */
import { describe, it, expect } from 'vitest';

import {
  classifyEditIntent,
  determineEditResolutionMode,
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

function modeFor(message: string): string {
  const context = makeCrmContext();
  const intent = classifyEditIntent(message);
  const resolution = resolveEditTarget(message, context, intent);
  return determineEditResolutionMode(message, context, intent, resolution);
}

describe('option-preference consent demotion (REVIEW-573 C-1)', () => {
  it('A5: option protected by negation — NEVER auto_apply (configure-vocab arm)', () => {
    const mode = modeFor(
      "Set CRM Platform Cost to 0.55 - the configuration of Cloud-Native CRM shouldn't change.",
    );
    expect(mode).not.toBe('auto_apply');
    expect(['clarify', 'propose_and_confirm']).toContain(mode);
  });

  it('A6: "Configure nothing on {option}" — NEVER auto_apply (configure-vocab arm)', () => {
    const mode = modeFor('Configure nothing on Cloud-Native CRM; just set CRM Platform Cost to 0.55.');
    expect(mode).not.toBe('auto_apply');
    expect(['clarify', 'propose_and_confirm']).toContain(mode);
  });

  it('shared exposure: the option_configuration-INTENT arm is demoted too', () => {
    // No configure vocabulary anywhere — "change" + "option" classifies the
    // intent, the preference resolves the PROTECTED option, and pre-demotion
    // this single-clause non-compound message reached auto_apply.
    const message = "The Cloud-Native CRM option shouldn't change. Set CRM Platform Cost to 0.55.";
    expect(classifyEditIntent(message)).toBe('option_configuration');
    const mode = modeFor(message);
    expect(mode).not.toBe('auto_apply');
    expect(['clarify', 'propose_and_confirm']).toContain(mode);
  });

  it('a genuine non-compound option-configure goes through consent, not auto-apply', () => {
    // The +1-turn trade the ruling accepts: even a clean single-clause
    // configure confirms first, because the target was heuristically chosen.
    const mode = modeFor('Set CRM Feature Depth to 0.7 for the Cloud-Native CRM option.');
    expect(mode).toBe('propose_and_confirm');
  });

  it('regression pin: the captured T12b journey stays consent-first (compound → propose_and_confirm)', () => {
    const mode = modeFor(
      'Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7, set CRM Platform Cost to 0.55.',
    );
    expect(mode).toBe('propose_and_confirm');
  });

  it('regression pin: the demotion does not over-reach — a plain factor edit keeps auto_apply', () => {
    const message = 'Set CRM Feature Depth to 0.7.';
    const context = makeCrmContext();
    const intent = classifyEditIntent(message);
    const resolution = resolveEditTarget(message, context, intent);
    expect(resolution.resolved_target?.type).toBe('factor');
    expect(resolution.option_target_preferred).toBeUndefined();
    expect(determineEditResolutionMode(message, context, intent, resolution)).toBe('auto_apply');
  });
});
