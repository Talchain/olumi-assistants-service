/** Z1b: word-family coverage on the full witnessed Z1 graph; shared assertions also run as offline Node probes. */
import { describe, it } from 'vitest';
import {
  NEW_UNITS, REFUSED_UNITS, R2_REFUSED_UNITS, DIRECTIONAL_UNITS, MONEY_METRICS, HELD_KINDS,
  checkReading, checkRepairAndApproval, checkConstruction,
  checkBriefFallback, checkAskChain, checkFrameAndMetricGuards, checkRefused, checkHeldGuard, checkApplyGuard,
  checkDirectionMismatch, checkApplyDirectionGuard, checkMissingSign, checkMoneyMetricFallback, checkCloudReduction,
} from './fixtures/relative-change-percent-checks.js';

describe('Z1b relative-change percent qualifier family', () => {
  it.each(NEW_UNITS)('shared grammar and change-own reading: %s', checkReading);
  it.each(NEW_UNITS)('witnessed repair holds the signed card without a write; approval writes once: %s', unit => checkRepairAndApproval(unit));
  it.each(NEW_UNITS)('construction retains the signed change without a guessed metric level: %s', checkConstruction);
  it.each(NEW_UNITS)('brief fallback uses the signed unit predicate: %s', checkBriefFallback);
  it.each(NEW_UNITS)('delivered ask, carry and answer share the reading: %s', checkAskChain);
  it.each(NEW_UNITS)('absolute/level frames and percentage metrics retain their units: %s', checkFrameAndMetricGuards);
  it.each(REFUSED_UNITS)('base/share, named metric, rate, points or invalid reference stays refused: %s', checkRefused);
  it.each(R2_REFUSED_UNITS)('last-period references and multiple directions keep their unit: %s', checkRefused);
  it.each(DIRECTIONAL_UNITS)('opposite sign keeps the unit on construction, card and ask paths: %s', checkDirectionMismatch);
  it.each(DIRECTIONAL_UNITS)('apply rechecks a changed sign: %s', checkApplyDirectionGuard);
  it.each(DIRECTIONAL_UNITS)('missing, zero or invalid sign fails closed: %s', checkMissingSign);
  it.each(MONEY_METRICS.flatMap(row => ['%', ...NEW_UNITS].map(unit => [unit, row] as const)))(
    'money fallback preserves percentage-like metric names: %s', checkMoneyMetricFallback);
  it.each([20, -20])('cloud-0 reduction agrees with signed raw change: %s', checkCloudReduction);
  it('neutral change accepts a decrease and reuses the down card', () => checkRepairAndApproval('% change from baseline', -0.1));
  it.each(HELD_KINDS.flatMap(kind => NEW_UNITS.map(unit => [unit, kind] as const)))(
    '%s never adopts over a held %s', checkHeldGuard);
  it.each(NEW_UNITS)('apply rechecks a percent size arriving after preparation: %s', checkApplyGuard);
});
