/** Z1b: word-family coverage on the full witnessed Z1 graph; shared assertions also run as offline Node probes. */
import { describe, it } from 'vitest';
import {
  NEW_UNITS, REFUSED_UNITS, HELD_KINDS, checkReading, checkRepairAndApproval, checkConstruction,
  checkBriefFallback, checkAskChain, checkFrameAndMetricGuards, checkRefused, checkHeldGuard, checkApplyGuard,
} from './fixtures/relative-change-percent-checks.js';

describe('Z1b relative-change percent qualifier family', () => {
  it.each(NEW_UNITS)('shared grammar and change-own reading: %s', checkReading);
  it.each(NEW_UNITS)('witnessed repair holds the card without a write; approval writes once: %s', checkRepairAndApproval);
  it.each(NEW_UNITS)('construction retains +10% without a guessed metric level: %s', checkConstruction);
  it.each(NEW_UNITS)('brief fallback uses the same change-own predicate: %s', checkBriefFallback);
  it.each(NEW_UNITS)('delivered ask, carry and answer share the reading: %s', checkAskChain);
  it.each(NEW_UNITS)('absolute/level frames and percentage metrics retain their units: %s', checkFrameAndMetricGuards);
  it.each(REFUSED_UNITS)('base/share, named metric, rate, points or invalid reference stays refused: %s', checkRefused);
  it.each(HELD_KINDS.flatMap(kind => NEW_UNITS.map(unit => [unit, kind] as const)))(
    '%s never adopts over a held %s', checkHeldGuard);
  it.each(NEW_UNITS)('apply rechecks a percent size arriving after preparation: %s', checkApplyGuard);
});
