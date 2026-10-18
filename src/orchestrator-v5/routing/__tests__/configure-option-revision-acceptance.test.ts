/**
 * Configure-option intent detector, on the captured wrong-entity-write turn.
 *
 * The deliberate-edit guard this file once joined to its outcome
 * (`configure-option-outcome.ts`) had no production importer and was deleted
 * (O2 orphan deletion). The arms that only mutated test-local clones of the
 * fixture went with it. What stays is the part that runs kept code: the
 * detector recognises the captured revision message, and an explicit
 * link-strength edit that names the option.
 */
import { describe, expect, it } from 'vitest';
import { detectConfigureOptionIntent, projectOptionLabels } from '../configure-option-intent.js';
import { WRONG_ENTITY_WRITE_CAPTURE } from './wrong-entity-write-capture.fixture.js';

const CAPTURE = WRONG_ENTITY_WRITE_CAPTURE;
const {
  option_label: OPTION_LABEL,
  turn_message: MESSAGE,
} = CAPTURE.provenance;

describe('configure-option intent detector — the captured revision turn', () => {
  it('recognises the captured revision message', () => {
    const labels = projectOptionLabels(CAPTURE.before.nodes as never);
    expect(detectConfigureOptionIntent(MESSAGE, labels).matched).toBe(true);
  });

  it('recognises an explicit link-strength edit naming the option', () => {
    const explicitLinkEdit =
      `For the ${OPTION_LABEL} option, the link to Pro Plan Monthly Price is too strong `
      + '— set its strength to 79%.';

    expect(
      detectConfigureOptionIntent(
        explicitLinkEdit,
        projectOptionLabels(CAPTURE.before.nodes as never),
      ).matched,
    ).toBe(true);
  });
});
