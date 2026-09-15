import {
  assertedLeaderNamesItsOwnSubject,
  optionLabelPattern,
  textAssertsLeadingOption,
  textAssertsImplicitLeadingOption,
  textAssertsOnlyImplicitLeadingOptions,
} from './leading-option-egress-guard.js';
import { replaceAssertingUnits, splitIntoRedactableUnits } from './redactable-units.js';
import type { WireEnforcementMode } from './leading-option-wire-enforcement.js';

// The wire guard's existing algorithm, shared with pre-commit conversation
// projection. Callers supply their already-authorised disclosure text. This
// neither grants claim permission nor changes the option-identity classifier.
export function textNamesAnOption(value: string, roster: readonly string[]): boolean {
  if (typeof value !== 'string' || value.length === 0 || roster.length === 0) return false;
  return roster.some((label) => optionLabelPattern(label).test(value));
}

// Exact option tokens only. Short forms and paraphrases remain an explicit
// limitation; fuzzy identity matching would suppress unrelated reasoning.
export function projectLeadingOptionProse(
  value: string,
  roster: readonly string[],
  replacement: string,
): { text: string; mode: WireEnforcementMode } | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const context = { optionLabels: roster };
  const asserts = (text: string): boolean => textAssertsLeadingOption(text, context);
  if (!asserts(value)) return null;
  const namesOption = textNamesAnOption(value, roster);
  if (!namesOption && !textAssertsImplicitLeadingOption(value, context)) return null;
  const units = splitIntoRedactableUnits(value).filter((unit) => !/^\s+$/.test(unit));
  const someAssertionBorrowsItsName = units.some(
    (unit) => asserts(unit) && !assertedLeaderNamesItsOwnSubject(unit, context),
  );
  const needsNameEscalation =
    namesOption &&
    !textAssertsOnlyImplicitLeadingOptions(value, context) &&
    someAssertionBorrowsItsName;

  // If an assertion borrows its subject from another sentence, removing only
  // the predicate would leave the naming half of the same recommendation.
  const isClean = (candidate: string): boolean =>
    !asserts(candidate) &&
    (!needsNameEscalation || !textNamesAnOption(candidate, roster));

  const surgical = replaceAssertingUnits(
    value,
    asserts,
    replacement,
  );
  if (isClean(surgical)) return { text: surgical, mode: 'surgical' };
  const escalated = replaceAssertingUnits(
    value,
    (unit) => asserts(unit) || textNamesAnOption(unit, roster),
    replacement,
  );
  if (isClean(escalated)) return { text: escalated, mode: 'surgical_escalated' };

  return { text: replacement, mode: 'whole_field' };
}
