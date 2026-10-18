/**
 * L16 / N16 — unit contract for the bare-configure value-payload predicate,
 * and for the configure-option phrasing the detector accepts.
 *
 * The clarify intercept and its composer had no production importer and were
 * deleted (O2 orphan deletion); their decline and copy rows went with them.
 */

import { describe, it, expect } from 'vitest';
import { carriesConfigureOptionValuePayload, detectConfigureOptionIntent } from '../configure-option-intent.js';
import { buildConfigureOptionChip } from '../../configure-option-chip-text.js';

const OPTION_LABEL = 'Launch Customer Retention Programme';
const FACTOR_LABEL = 'Customer Retention Investment';

describe('carriesConfigureOptionValuePayload — derived from the router\'s own VALUE_SET_PAYLOAD', () => {
  it('is false for the bare shapes and true for the writable ones', () => {
    expect(carriesConfigureOptionValuePayload(`Configure ${OPTION_LABEL}`)).toBe(false);
    expect(carriesConfigureOptionValuePayload(buildConfigureOptionChip(OPTION_LABEL).message)).toBe(
      false,
    );
    expect(
      carriesConfigureOptionValuePayload(`Under ${OPTION_LABEL}, set ${FACTOR_LABEL} to 1`),
    ).toBe(true);
    expect(
      carriesConfigureOptionValuePayload(`Set ${FACTOR_LABEL} to £40,000`),
    ).toBe(true);
  });
});

describe('detectConfigureOptionIntent — the option-effect phrasing', () => {

  it('accepts a hand-written "Set the <option> option\'s effect on <factor> to <value>" sentence', () => {
    // The 2.11 defect was a suggested phrasing that could not return to the
    // lane that suggested it. The composer is gone; this keeps the phrasing
    // itself pinned against the REAL detector.
    const advised = `Set the ${OPTION_LABEL} option's effect on ${FACTOR_LABEL} to 1`;
    const back = detectConfigureOptionIntent(advised, [OPTION_LABEL]);
    expect(back.matched).toBe(true);
  });
});
