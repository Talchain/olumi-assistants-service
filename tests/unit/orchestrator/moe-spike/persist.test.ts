import { describe, it, expect, afterEach } from 'vitest';
import { persistSpikeComparison, redactSpikeResult } from '../../../../src/orchestrator/moe-spike/persist.js';
import type { MoeSpikeResult, MoeSpikeComparison } from '../../../../src/orchestrator/moe-spike/schemas.js';
import { MOE_SPIKE_VERSION } from '../../../../src/orchestrator/moe-spike/schemas.js';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const RESULTS_DIR = join(process.cwd(), 'tools', 'moe-spike', 'results');

function makeSpikeResult(): MoeSpikeResult {
  return {
    version: MOE_SPIKE_VERSION,
    framing_quality: 'moderate',
    diversity_assessment: 'diverse',
    stakeholder_completeness: 'partial',
    bias_signals: [
      { bias_type: 'anchoring', signal: 'Over-reliance on initial price point as the anchor', claim_id: null, confidence: 0.8 },
      { bias_type: 'sunk_cost', signal: 'Already invested heavily in the current platform', claim_id: null, confidence: 0.7 },
    ],
    missing_elements: ['time_horizon'],
  };
}

function makeComparison(): MoeSpikeComparison {
  return {
    version: MOE_SPIKE_VERSION,
    brief_hash: 'test12345678',
    bias_agreed: ['anchoring'],
    bias_spike_only: ['sunk_cost'],
    bias_bil_only: [],
    framing_agrees: true,
    diversity_agrees: true,
    missing_elements_spike_only: [],
    missing_elements_bil_only: [],
    spike_bias_count: 2,
    bil_bias_count: 1,
    verdict: 'equivalent',
  };
}

afterEach(async () => {
  // Clean up test artifacts
  try {
    await rm(join(RESULTS_DIR, 'test12345678.json'), { force: true });
  } catch {
    // ignore
  }
});

describe('redactSpikeResult', () => {
  it('strips signal strings and claim_id from bias_signals', () => {
    const result = makeSpikeResult();
    const redacted = redactSpikeResult(result);

    const signals = redacted.bias_signals as Array<Record<string, unknown>>;
    for (const s of signals) {
      expect(s).not.toHaveProperty('signal');
      expect(s).not.toHaveProperty('claim_id');
      expect(s).toHaveProperty('bias_type');
      expect(s).toHaveProperty('confidence');
    }
  });

  it('preserves enum fields and missing_elements', () => {
    const result = makeSpikeResult();
    const redacted = redactSpikeResult(result);

    expect(redacted.framing_quality).toBe('moderate');
    expect(redacted.diversity_assessment).toBe('diverse');
    expect(redacted.stakeholder_completeness).toBe('partial');
    expect(redacted.missing_elements).toEqual(['time_horizon']);
  });
});

describe('persistSpikeComparison', () => {
  it('persisted file contains no rationale or signal strings', async () => {
    const comparison = makeComparison();
    const spikeResult = makeSpikeResult();

    await persistSpikeComparison(comparison, spikeResult);

    const filePath = join(RESULTS_DIR, 'test12345678.json');
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Verify redaction — no signal text in the persisted spike_redacted
    const signals = parsed.spike_redacted.bias_signals;
    for (const s of signals) {
      expect(s).not.toHaveProperty('signal');
      expect(s).not.toHaveProperty('claim_id');
    }

    // Full content string should not contain the actual signal text
    expect(content).not.toContain('Over-reliance on initial price point');
    expect(content).not.toContain('Already invested heavily');

    // Comparison data should be present
    expect(parsed.comparison.verdict).toBe('equivalent');
    expect(parsed.comparison.brief_hash).toBe('test12345678');
  });

  it('never throws even on write failure', async () => {
    // Use an impossible path to trigger failure
    const badComparison = { ...makeComparison(), brief_hash: '/\0invalid' };
    await expect(
      persistSpikeComparison(badComparison, makeSpikeResult()),
    ).resolves.toBeUndefined();
  });
});
