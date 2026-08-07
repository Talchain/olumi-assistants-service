/**
 * ROADMAP 2.11 / P0-2 (deterministic half) — configure-option intent
 * detector.
 *
 * Live-proven dead-end (diagnosis brief add-option-2.11.md §2, scenario A,
 * staging 57959b2, 2026-07-16): after an option is added via chat with no
 * `interventions`, PLoT preflight 422s the WHOLE analysis
 * (`options_not_configured`), and every configure phrasing — including the
 * system's OWN recovery chip message "Help me configure {option}." — routed
 * to `adjust_edge_strength`, which writes edge strength (a field the
 * preflight ignores). Chip → edge tweak → still blocked → same chip:
 * an infinite loop.
 *
 * The detector is the deterministic route-v2 gate that sends this intent to
 * the EDIT LANE instead, where the served edit prompt (PMS edit_graph v11,
 * verified 2026-07-16: teaches `update_node` at
 * `/nodes/<opt>/data/interventions/<factor_id>` with a worked example)
 * emits the already-sanctioned `update_node` interventions vocabulary
 * (field-safety allowlist → would_apply → patch applier → readiness reader).
 *
 * The phrasings pinned here are the CAPTURED scenario-A shapes (A5/A7) plus
 * the exact chip messages the composer emits — the anti-mirror pin: chips
 * and detector share ONE builder, so chip copy can never drift out of the
 * deterministic route.
 */
import { describe, it, expect } from 'vitest';

import { detectConfigureOptionIntent } from '../configure-option-intent.js';
import {
  buildConfigureOptionChipMessage,
  buildConfigureOptionChip,
  CONFIGURE_OPTION_GENERIC_CHIP,
} from '../../configure-option-chip-text.js';

const SCENARIO_A_OPTION_LABELS = [
  'Open Berlin Office',
  'Partner with Local Distributor',
  'Acquire Small German Competitor',
  'Do Nothing',
  'Remote-First German Team',
];

describe('detectConfigureOptionIntent — captured scenario-A shapes', () => {
  it('A5: "Configure the effects of the … option: …" matches', () => {
    const detection = detectConfigureOptionIntent(
      'Configure the effects of the Acquire Small German Competitor option: ' +
        'it strongly increases hiring speed, setup cost and local presence.',
      SCENARIO_A_OPTION_LABELS,
    );
    expect(detection.matched).toBe(true);
  });

  it('A7: the system\'s own recovery-chip message "Help me configure {option}." matches', () => {
    const detection = detectConfigureOptionIntent(
      'Help me configure Acquire Small German Competitor.',
      SCENARIO_A_OPTION_LABELS,
    );
    expect(detection.matched).toBe(true);
  });

  it('the generic recovery-chip message matches', () => {
    const detection = detectConfigureOptionIntent(
      'Help me configure one of my options.',
      SCENARIO_A_OPTION_LABELS,
    );
    expect(detection.matched).toBe(true);
  });

  it('"set {option}\'s {factor} intervention to X" matches (option label anchor)', () => {
    const detection = detectConfigureOptionIntent(
      "Set the Acquire Small German Competitor's setup cost intervention to 0.8",
      SCENARIO_A_OPTION_LABELS,
    );
    expect(detection.matched).toBe(true);
  });

  it('"set intervention values" phrasing with the word option matches', () => {
    const detection = detectConfigureOptionIntent(
      'Set intervention values for my new option so the analysis can run',
      SCENARIO_A_OPTION_LABELS,
    );
    expect(detection.matched).toBe(true);
  });

  it('chip messages match even when the graph lookup yields no labels (chip prefix rule)', () => {
    // The chip is only ever emitted when options exist, but the detector
    // must not depend on the label round-trip surviving (id-shaped labels,
    // renamed options): the chip PREFIX is unambiguous configure intent.
    const detection = detectConfigureOptionIntent(
      'Help me configure Acquire Small German Competitor.',
      [],
    );
    expect(detection.matched).toBe(true);
  });
});

describe('detectConfigureOptionIntent — must NOT claim other intents', () => {
  it('a plain factor value edit does not match', () => {
    expect(
      detectConfigureOptionIntent('Set marketing spend to £40,000', SCENARIO_A_OPTION_LABELS)
        .matched,
    ).toBe(false);
  });

  it('a genuine edge-strength request does not match', () => {
    expect(
      detectConfigureOptionIntent(
        'Strengthen the link between price and revenue',
        SCENARIO_A_OPTION_LABELS,
      ).matched,
    ).toBe(false);
  });

  it('an analytical question about options does not match (no configure/intervention vocabulary)', () => {
    expect(
      detectConfigureOptionIntent('What are my options here?', SCENARIO_A_OPTION_LABELS).matched,
    ).toBe(false);
  });

  it('mentioning an option label without configure vocabulary does not match', () => {
    expect(
      detectConfigureOptionIntent(
        'Tell me more about Open Berlin Office',
        SCENARIO_A_OPTION_LABELS,
      ).matched,
    ).toBe(false);
  });

  it('empty message does not match', () => {
    expect(detectConfigureOptionIntent('', SCENARIO_A_OPTION_LABELS).matched).toBe(false);
  });

  it('question shapes never match (state query / analytical phrasing)', () => {
    for (const q of [
      'What did you just configure on my options?',
      'Could configuring an option help here?',
      'Which options still need intervention values?',
    ]) {
      expect(detectConfigureOptionIntent(q, SCENARIO_A_OPTION_LABELS).matched).toBe(false);
    }
  });
});

describe('anti-mirror pin — chips and detector share one builder', () => {
  it('every label-bearing chip message the composer can emit routes deterministically', () => {
    for (const label of [...SCENARIO_A_OPTION_LABELS, 'that option', 'an option']) {
      const message = buildConfigureOptionChipMessage(label);
      expect(detectConfigureOptionIntent(message, []).matched).toBe(true);
    }
  });

  it('the built chip carries the built message (no hand-written twin)', () => {
    const chip = buildConfigureOptionChip('Acquire Small German Competitor');
    expect(chip.message).toBe(
      buildConfigureOptionChipMessage('Acquire Small German Competitor'),
    );
    expect(chip.id).toBe('chip_prompt_configure_option');
    expect(chip.label).toBe('Configure Acquire Small German Competitor');
  });

  it('the generic chip message routes deterministically', () => {
    expect(detectConfigureOptionIntent(CONFIGURE_OPTION_GENERIC_CHIP.message, []).matched).toBe(
      true,
    );
    expect(CONFIGURE_OPTION_GENERIC_CHIP.id).toBe('chip_prompt_configure_option_generic');
  });
});

describe('anti-mirror pin — the options_not_configured composer uses the shared builder', () => {
  it('label branch chip message === shared builder output', async () => {
    const { composeHandlerFailureBody } = await import(
      '../../compose/handler-failure-responses.js'
    );
    const branch = composeHandlerFailureBody({
      name: 'HandlerInvocationFailedError',
      message: 'options_not_configured',
      cause_kind: 'options_not_configured',
      retryable: true,
      details: { first_option_label: 'Acquire Small German Competitor' },
    } as never);
    const chip = branch.body.suggested_actions[0]!;
    expect(chip.message).toBe(
      buildConfigureOptionChipMessage('Acquire Small German Competitor'),
    );
    // And the wire chip routes into the deterministic edit-lane gate.
    expect(detectConfigureOptionIntent(chip.message, []).matched).toBe(true);
  });

  it('generic branch chip === shared generic chip', async () => {
    const { composeHandlerFailureBody } = await import(
      '../../compose/handler-failure-responses.js'
    );
    const branch = composeHandlerFailureBody({
      name: 'HandlerInvocationFailedError',
      message: 'options_not_configured',
      cause_kind: 'options_not_configured',
      retryable: true,
      details: {},
    } as never);
    const chip = branch.body.suggested_actions[0]!;
    expect(chip.message).toBe(CONFIGURE_OPTION_GENERIC_CHIP.message);
    expect(detectConfigureOptionIntent(chip.message, []).matched).toBe(true);
  });
});
