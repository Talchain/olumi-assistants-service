/**
 * Shared Test Assertion Helpers
 *
 * Provides common assertion patterns used across test files for
 * checking validation results, errors, and warnings.
 *
 * Usage:
 *   import { hasError, hasWarning, findIssue } from '../utils/assertions.js';
 *   expect(hasError(result, 'INVALID_NODE')).toBe(true);
 */

import type { ValidationIssue } from '../../src/validators/graph-validator.types.js';

/**
 * Check if a validation result contains an error with the given code.
 */
export function hasError(
  result: { errors: Array<{ code: string }> },
  code: string
): boolean {
  return result.errors.some((e) => e.code === code);
}

/**
 * Check if a validation result contains a warning with the given code.
 */
export function hasWarning(
  result: { warnings: Array<{ code: string }> },
  code: string
): boolean {
  return result.warnings.some((w) => w.code === code);
}

/**
 * Find an issue by code in a list of validation issues.
 * Returns undefined if not found.
 */
export function findIssue(
  issues: ValidationIssue[],
  code: string
): ValidationIssue | undefined {
  return issues.find((i) => i.code === code);
}

/**
 * Check if issues contain a specific code.
 */
export function hasIssue(issues: Array<{ code: string }>, code: string): boolean {
  return issues.some((i) => i.code === code);
}

/**
 * Get all error codes from a validation result.
 */
export function getErrorCodes(result: { errors: Array<{ code: string }> }): string[] {
  return result.errors.map((e) => e.code);
}

/**
 * Get all warning codes from a validation result.
 */
export function getWarningCodes(result: { warnings: Array<{ code: string }> }): string[] {
  return result.warnings.map((w) => w.code);
}

/**
 * Assert that a validation result is valid (no errors).
 * Throws with descriptive message if invalid.
 */
export function assertValid(result: { valid: boolean; errors: Array<{ code: string; message: string }> }): void {
  if (!result.valid) {
    const errorSummary = result.errors.map((e) => `${e.code}: ${e.message}`).join('\n  ');
    throw new Error(`Expected valid result but got errors:\n  ${errorSummary}`);
  }
}

/**
 * Assert that a validation result is invalid (has errors).
 * Throws with descriptive message if valid.
 */
export function assertInvalid(result: { valid: boolean }): void {
  if (result.valid) {
    throw new Error('Expected invalid result but got valid');
  }
}

/**
 * Count occurrences of a specific issue code.
 */
export function countIssues(issues: Array<{ code: string }>, code: string): number {
  return issues.filter((i) => i.code === code).length;
}
