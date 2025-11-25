#!/usr/bin/env tsx
/**
 * Pre-deployment Configuration Validation Script
 *
 * Validates critical configuration settings before deployment.
 * Run as part of CI pipeline or before manual deployment.
 *
 * Usage:
 *   pnpm exec tsx scripts/validate-config.ts
 *   pnpm exec tsx scripts/validate-config.ts --strict
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - Critical validation failed (deployment should be blocked)
 *   2 - Warnings detected (deployment can proceed with --strict flag)
 */

import { parseTimeoutWithSource, parseMaxRetriesWithSource, type ConfigSource } from '../src/adapters/isl/config.js';

interface ValidationResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  source?: ConfigSource;
  value?: unknown;
}

const results: ValidationResult[] = [];
const isStrict = process.argv.includes('--strict');

function validate(result: ValidationResult): void {
  results.push(result);
  const icon = result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
  const sourceInfo = result.source ? ` [source: ${result.source}]` : '';
  const valueInfo = result.value !== undefined ? ` = ${result.value}` : '';
  console.log(`${icon} ${result.name}${valueInfo}${sourceInfo}: ${result.message}`);
}

console.log('\n=== Pre-deployment Configuration Validation ===\n');

// ISL Configuration Validation
console.log('--- ISL Configuration ---');

const islBaseUrl = process.env.ISL_BASE_URL;
if (process.env.CEE_CAUSAL_VALIDATION_ENABLED === 'true' || process.env.CEE_CAUSAL_VALIDATION_ENABLED === '1') {
  if (!islBaseUrl || islBaseUrl.trim().length === 0) {
    validate({
      name: 'ISL_BASE_URL',
      status: 'fail',
      message: 'ISL is enabled but ISL_BASE_URL is not configured',
    });
  } else {
    try {
      new URL(islBaseUrl);
      validate({
        name: 'ISL_BASE_URL',
        status: 'pass',
        message: 'Valid URL configured',
        value: islBaseUrl.replace(/:\/\/([^:\/]+)(:\d+)?/, '://$1:***'),
      });
    } catch {
      validate({
        name: 'ISL_BASE_URL',
        status: 'fail',
        message: 'Invalid URL format',
        value: islBaseUrl,
      });
    }
  }
} else {
  validate({
    name: 'CEE_CAUSAL_VALIDATION_ENABLED',
    status: 'pass',
    message: 'ISL causal validation is disabled (no ISL config required)',
    value: process.env.CEE_CAUSAL_VALIDATION_ENABLED || 'undefined',
  });
}

// ISL Timeout validation
const timeoutResult = parseTimeoutWithSource(process.env.ISL_TIMEOUT_MS, 5000);
if (timeoutResult.source === 'default') {
  validate({
    name: 'ISL_TIMEOUT_MS',
    status: 'warn',
    message: 'Using default value (consider setting explicitly for production)',
    value: timeoutResult.value,
    source: timeoutResult.source,
  });
} else if (timeoutResult.source === 'clamped') {
  validate({
    name: 'ISL_TIMEOUT_MS',
    status: 'warn',
    message: `Value was clamped to safe range (original: ${process.env.ISL_TIMEOUT_MS})`,
    value: timeoutResult.value,
    source: timeoutResult.source,
  });
} else {
  validate({
    name: 'ISL_TIMEOUT_MS',
    status: 'pass',
    message: 'Configured from environment',
    value: timeoutResult.value,
    source: timeoutResult.source,
  });
}

// ISL Max Retries validation
const retriesResult = parseMaxRetriesWithSource(process.env.ISL_MAX_RETRIES, 1);
if (retriesResult.source === 'default') {
  validate({
    name: 'ISL_MAX_RETRIES',
    status: 'warn',
    message: 'Using default value (consider setting explicitly for production)',
    value: retriesResult.value,
    source: retriesResult.source,
  });
} else if (retriesResult.source === 'clamped') {
  validate({
    name: 'ISL_MAX_RETRIES',
    status: 'warn',
    message: `Value was clamped to safe range (original: ${process.env.ISL_MAX_RETRIES})`,
    value: retriesResult.value,
    source: retriesResult.source,
  });
} else {
  validate({
    name: 'ISL_MAX_RETRIES',
    status: 'pass',
    message: 'Configured from environment',
    value: retriesResult.value,
    source: retriesResult.source,
  });
}

// LLM Configuration Validation
console.log('\n--- LLM Configuration ---');

const llmProvider = process.env.LLM_PROVIDER || 'anthropic';
validate({
  name: 'LLM_PROVIDER',
  status: 'pass',
  message: 'Provider configured',
  value: llmProvider,
});

if (llmProvider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
  validate({
    name: 'ANTHROPIC_API_KEY',
    status: llmProvider === 'fixtures' ? 'pass' : 'fail',
    message: llmProvider === 'fixtures' ? 'Not required for fixtures provider' : 'Missing Anthropic API key',
  });
} else if (llmProvider === 'anthropic') {
  validate({
    name: 'ANTHROPIC_API_KEY',
    status: 'pass',
    message: 'API key configured',
    value: '***redacted***',
  });
}

if (llmProvider === 'openai' && !process.env.OPENAI_API_KEY) {
  validate({
    name: 'OPENAI_API_KEY',
    status: 'fail',
    message: 'Missing OpenAI API key',
  });
} else if (llmProvider === 'openai') {
  validate({
    name: 'OPENAI_API_KEY',
    status: 'pass',
    message: 'API key configured',
    value: '***redacted***',
  });
}

// Auth Configuration Validation
console.log('\n--- Authentication Configuration ---');

const assistApiKeys = process.env.ASSIST_API_KEYS;
if (!assistApiKeys && !process.env.ASSIST_API_KEY) {
  validate({
    name: 'ASSIST_API_KEYS',
    status: 'warn',
    message: 'No API keys configured (auth may be disabled)',
  });
} else {
  const keyCount = assistApiKeys ? assistApiKeys.split(',').filter(k => k.trim()).length : 1;
  validate({
    name: 'ASSIST_API_KEYS',
    status: 'pass',
    message: `${keyCount} API key(s) configured`,
  });
}

// Summary
console.log('\n=== Validation Summary ===\n');

const failures = results.filter(r => r.status === 'fail');
const warnings = results.filter(r => r.status === 'warn');
const passes = results.filter(r => r.status === 'pass');

console.log(`✅ Passed: ${passes.length}`);
console.log(`⚠️  Warnings: ${warnings.length}`);
console.log(`❌ Failed: ${failures.length}`);

if (failures.length > 0) {
  console.log('\n❌ VALIDATION FAILED - Deployment blocked\n');
  console.log('Critical issues:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}

if (warnings.length > 0 && isStrict) {
  console.log('\n⚠️  STRICT MODE - Warnings treated as failures\n');
  console.log('Warnings:');
  warnings.forEach(w => console.log(`  - ${w.name}: ${w.message}`));
  process.exit(2);
}

if (warnings.length > 0) {
  console.log('\n⚠️  VALIDATION PASSED WITH WARNINGS\n');
  console.log('Recommended fixes:');
  warnings.forEach(w => console.log(`  - ${w.name}: ${w.message}`));
  console.log('\nRun with --strict flag to treat warnings as failures.');
} else {
  console.log('\n✅ ALL VALIDATIONS PASSED\n');
}

process.exit(0);
