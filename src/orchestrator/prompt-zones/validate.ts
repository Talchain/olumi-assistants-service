/**
 * Assembly Validation — non-blocking checks on assembled prompts.
 *
 * Checks for banned terms, tool/routing instructions leaking into Zone 2,
 * imperative language in data blocks, duplicate block names, budget
 * thresholds, hint length, and XML tag balance.
 *
 * Returns ValidationWarning[]. Never throws. Logs warnings, never blocks.
 */

import type { AssembledPrompt } from "./assemble.js";
import { BUDGET_WARN_RATIO, BUDGET_ERROR_RATIO, BUDGET_MAX_CHARS } from "./assemble.js";
import type { Zone2Block } from "./zone2-blocks.js";

// ============================================================================
// ValidationWarning contract (Fix #11)
// ============================================================================

export interface ValidationWarning {
  code: string;
  block_name: string;
  message: string;
  severity: 'warn' | 'error';
}

// ============================================================================
// Banned terms from cf-v7/v8 lines 366-370
// ============================================================================

const BANNED_INTERNAL_TERMS: readonly string[] = Object.freeze([
  'headline_type',
  'readiness',
  'canonical_state',
  'exists_probability',
  'voi',
  'attribution_stability',
  'rank_flip_rate',
  'model_critiques',
  'elasticity',
  'factor_sensitivity',
  'recommendation_stability',
]);

// ============================================================================
// Tool/routing instruction patterns
// ============================================================================

const TOOL_INSTRUCTION_PATTERNS: readonly RegExp[] = Object.freeze([
  /select\s+tool/i,
  /invoke\s+tool/i,
  /output\s+format/i,
  /response\s+priority/i,
  /safety\s+policy/i,
  /security\s+policy/i,
  /coaching\s+heuristic/i,
  /role\s+definition/i,
]);

// ============================================================================
// Imperative patterns in data blocks
// ============================================================================

const IMPERATIVE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bYou must\b/i,
  /\bAlways\b/,
  /\bNever\b/,
  /\bDo not\b/i,
]);

// ============================================================================
// Validation functions
// ============================================================================

function checkBannedTerms(assembled: AssembledPrompt, zone1Length: number): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  // Only check Zone 2 content (after Zone 1)
  const zone2Content = assembled.system_prompt.slice(zone1Length);

  for (const term of BANNED_INTERNAL_TERMS) {
    if (zone2Content.includes(term)) {
      warnings.push({
        code: 'BANNED_TERM',
        block_name: '_zone2',
        message: `Banned term "${term}" found in Zone 2 content`,
        severity: 'warn',
      });
    }
  }
  return warnings;
}

function checkToolInstructions(assembled: AssembledPrompt, zone1Length: number): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const zone2Content = assembled.system_prompt.slice(zone1Length);

  for (const pattern of TOOL_INSTRUCTION_PATTERNS) {
    if (pattern.test(zone2Content)) {
      warnings.push({
        code: 'TOOL_INSTRUCTION',
        block_name: '_zone2',
        message: `Tool/routing instruction pattern found in Zone 2: ${pattern.source}`,
        severity: 'warn',
      });
    }
  }
  return warnings;
}

function checkImperatives(assembled: AssembledPrompt, registry: readonly Zone2Block[]): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  for (const meta of assembled.active_blocks) {
    const block = registry.find((b) => b.name === meta.name);
    if (!block || block.scope !== 'data') continue;

    // Find the rendered block content in the assembled prompt
    const tagOpen = `<${block.xmlTag}>`;
    const tagClose = `</${block.xmlTag}>`;
    const startIdx = assembled.system_prompt.indexOf(tagOpen);
    const endIdx = assembled.system_prompt.indexOf(tagClose);
    if (startIdx < 0 || endIdx < 0) continue;

    const blockContent = assembled.system_prompt.slice(startIdx + tagOpen.length, endIdx);

    for (const pattern of IMPERATIVE_PATTERNS) {
      if (pattern.test(blockContent)) {
        warnings.push({
          code: 'IMPERATIVE_IN_DATA',
          block_name: meta.name,
          message: `Imperative pattern "${pattern.source}" in data block "${meta.name}"`,
          severity: 'warn',
        });
      }
    }
  }
  return warnings;
}

function checkDuplicateNames(assembled: AssembledPrompt): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const seen = new Set<string>();

  for (const meta of assembled.active_blocks) {
    if (seen.has(meta.name)) {
      warnings.push({
        code: 'DUPLICATE_BLOCK',
        block_name: meta.name,
        message: `Duplicate block name: "${meta.name}"`,
        severity: 'error',
      });
    }
    seen.add(meta.name);
  }
  return warnings;
}

function checkBudget(assembled: AssembledPrompt): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const ratio = assembled.total_chars / BUDGET_MAX_CHARS;

  if (ratio >= BUDGET_ERROR_RATIO) {
    warnings.push({
      code: 'BUDGET_ERROR',
      block_name: '_assembly',
      message: `Assembled prompt at ${(ratio * 100).toFixed(1)}% of budget (${assembled.total_chars}/${BUDGET_MAX_CHARS} chars)`,
      severity: 'error',
    });
  } else if (ratio >= BUDGET_WARN_RATIO) {
    warnings.push({
      code: 'BUDGET_WARN',
      block_name: '_assembly',
      message: `Assembled prompt at ${(ratio * 100).toFixed(1)}% of budget (${assembled.total_chars}/${BUDGET_MAX_CHARS} chars)`,
      severity: 'warn',
    });
  }
  return warnings;
}

function checkHintLength(assembled: AssembledPrompt, registry: readonly Zone2Block[]): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  for (const meta of assembled.active_blocks) {
    const block = registry.find((b) => b.name === meta.name);
    if (!block || block.scope !== 'hint') continue;

    // Hints should be ≤ 2 sentences (rough check: ≤ 2 periods)
    const hintsStart = assembled.system_prompt.indexOf('<CONTEXT_HINTS>');
    const hintsEnd = assembled.system_prompt.indexOf('</CONTEXT_HINTS>');
    if (hintsStart < 0 || hintsEnd < 0) continue;

    // Check individual hint content via rendered chars
    if (meta.chars_rendered > block.maxChars) {
      warnings.push({
        code: 'HINT_TOO_LONG',
        block_name: meta.name,
        message: `Hint block "${meta.name}" exceeds maxChars (${meta.chars_rendered}/${block.maxChars})`,
        severity: 'warn',
      });
    }
  }
  return warnings;
}

function checkXmlBalance(assembled: AssembledPrompt): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const content = assembled.system_prompt;

  // Find all opening and closing XML tags in Zone 2 content
  const openTags = content.match(/<([A-Z][A-Z_]+)>/g) ?? [];
  const closeTags = content.match(/<\/([A-Z][A-Z_]+)>/g) ?? [];

  const openNames = openTags.map((t) => t.replace(/[<>]/g, ''));
  const closeNames = closeTags.map((t) => t.replace(/[<>/]/g, ''));

  for (const name of openNames) {
    if (!closeNames.includes(name)) {
      warnings.push({
        code: 'XML_UNBALANCED',
        block_name: '_assembly',
        message: `Unclosed XML tag: <${name}>`,
        severity: 'error',
      });
    }
  }
  return warnings;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate an assembled prompt. Returns warnings, never throws.
 *
 * @param assembled - The assembled prompt output
 * @param registry - The block registry (for scope/tag lookups)
 * @param zone1Length - Length of Zone 1 content (to isolate Zone 2 checks)
 */
export function validateAssembly(
  assembled: AssembledPrompt,
  registry: readonly Zone2Block[],
  zone1Length: number = 0,
): ValidationWarning[] {
  return [
    ...checkBannedTerms(assembled, zone1Length),
    ...checkToolInstructions(assembled, zone1Length),
    ...checkImperatives(assembled, registry),
    ...checkDuplicateNames(assembled),
    ...checkBudget(assembled),
    ...checkHintLength(assembled, registry),
    ...checkXmlBalance(assembled),
  ];
}
