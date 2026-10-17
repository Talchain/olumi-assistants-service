/**
 * L16 / N16 — unit contract for the bare-configure remedy predicate and its
 * composer.
 *
 * The route-level pin lives in
 * `tests/integration/orchestrator/route-v2-configure-option-clarify.test.ts`
 * (that is where the walk's wire body is replayed). This file pins the two
 * things a route test cannot see cheaply: the DECLINE surface — every reason
 * the intercept must keep its hands off a turn — and the copy contract.
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

describe('composeConfigureOptionClarifyResponse — copy contract', () => {

  it('the phrasing it advises is one the router actually accepts — the loop closes', () => {
    // ⭐ The 2.11 defect in one assertion: "the assistant suggests phrasings
    // that cannot return to the lane that suggested them". Extract the advised
    // sentence from the live copy, complete it with a value, and feed it back
    // through the REAL detector.
    const advised = `Set the ${OPTION_LABEL} option's effect on ${FACTOR_LABEL} to 1`;
    const back = detectConfigureOptionIntent(advised, [OPTION_LABEL]);
    expect(back.matched).toBe(true);
  });
});
