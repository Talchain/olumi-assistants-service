/**
 * Configure-option intent detector, on both measured phrasing families of the
 * captured wrong-entity-write turn.
 *
 * The outcome guard whose configured-option domain this file once diagnosed
 * (`configure-option-outcome.ts`) had no production importer and was deleted
 * (O2 orphan deletion), together with the check that read only fixture bytes.
 * What stays runs kept code: the detector recognises both live phrasings.
 */
import { describe, expect, it } from 'vitest';
import {
  detectConfigureOptionIntent,
  projectOptionLabels,
} from '../configure-option-intent.js';
import { WRONG_ENTITY_WRITE_CAPTURE } from './wrong-entity-write-capture.fixture.js';

const CAPTURE = WRONG_ENTITY_WRITE_CAPTURE;
const { turn_message: MESSAGE } = CAPTURE.provenance;

describe('configure-option intent detector — the captured wrong-entity-write turn', () => {
  it('the intent detector matches both measured phrasing families', () => {
    const labels = projectOptionLabels(CAPTURE.before.nodes as never);

    const captured = detectConfigureOptionIntent(MESSAGE, labels);
    expect(captured.matched).toBe(true);
    expect(captured.matched && captured.trigger).toBe('option_value_set');

    // The family the defect was first reported under, same graph.
    const effectPhrasing =
      "Set the Hold Price at £49 (Status Quo) option's effect on Pro Plan Monthly Price to 79%";
    const effect = detectConfigureOptionIntent(effectPhrasing, labels);
    expect(effect.matched).toBe(true);
    expect(effect.matched && effect.trigger).toBe('effect_vocab');
  });
});
