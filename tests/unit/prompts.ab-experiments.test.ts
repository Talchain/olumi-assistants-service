/**
 * Tests for Prompt A/B Experiments and Staging Support
 *
 * Verifies:
 * - Experiment registration and removal
 * - Bucket assignment consistency
 * - Variant assignment based on percentage
 * - Staging flag handling
 * - Force variant override
 * - Experiment telemetry
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerExperiment,
  removeExperiment,
  getActiveExperiment,
  getActiveExperiments,
  getSystemPromptAsync,
  clearPromptCache,
  type PromptLoadContext,
} from '../../src/adapters/llm/prompt-loader.js';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import { setTestSink } from '../../src/utils/telemetry.js';

// Track emitted telemetry events
let emittedEvents: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  // Reset module state
  clearPromptCache();
  registerAllDefaultPrompts();

  // Reset experiments
  removeExperiment('draft_graph');
  removeExperiment('suggest_options');
  removeExperiment('critique_graph');

  // Set up telemetry capture
  emittedEvents = [];
  setTestSink((event, data) => {
    emittedEvents.push({ event, data });
  });
});

describe('Experiment Registration', () => {
  it('registers an experiment for a task', () => {
    registerExperiment({
      name: 'test-experiment',
      taskId: 'draft_graph',
      treatmentPercent: 50,
      treatmentUsesStaging: true,
    });

    const experiment = getActiveExperiment('draft_graph');
    expect(experiment).toBeDefined();
    expect(experiment?.name).toBe('test-experiment');
    expect(experiment?.treatmentPercent).toBe(50);
  });

  it('removes an experiment', () => {
    registerExperiment({
      name: 'removable-experiment',
      taskId: 'suggest_options',
      treatmentPercent: 30,
      treatmentUsesStaging: false,
    });

    expect(getActiveExperiment('suggest_options')).toBeDefined();

    removeExperiment('suggest_options');

    expect(getActiveExperiment('suggest_options')).toBeUndefined();
  });

  it('lists all active experiments', () => {
    registerExperiment({
      name: 'exp-1',
      taskId: 'draft_graph',
      treatmentPercent: 10,
      treatmentUsesStaging: true,
    });
    registerExperiment({
      name: 'exp-2',
      taskId: 'critique_graph',
      treatmentPercent: 25,
      treatmentUsesStaging: false,
    });

    const experiments = getActiveExperiments();
    expect(experiments).toHaveLength(2);
    expect(experiments.map((e) => e.name).sort()).toEqual(['exp-1', 'exp-2']);
  });

  it('replaces existing experiment for same task', () => {
    registerExperiment({
      name: 'original',
      taskId: 'draft_graph',
      treatmentPercent: 50,
      treatmentUsesStaging: true,
    });

    registerExperiment({
      name: 'replacement',
      taskId: 'draft_graph',
      treatmentPercent: 75,
      treatmentUsesStaging: false,
    });

    const experiment = getActiveExperiment('draft_graph');
    expect(experiment?.name).toBe('replacement');
    expect(experiment?.treatmentPercent).toBe(75);
  });
});

describe('Experiment Assignment', () => {
  beforeEach(() => {
    registerExperiment({
      name: 'assignment-test',
      taskId: 'draft_graph',
      treatmentPercent: 50,
      treatmentUsesStaging: true,
    });
  });

  it('assigns variant based on user ID', async () => {
    const context1: PromptLoadContext = { userId: 'user-a' };
    const context2: PromptLoadContext = { userId: 'user-b' };

    const result1 = await getSystemPromptAsync('draft_graph', context1);
    const result2 = await getSystemPromptAsync('draft_graph', context2);

    // Both should have experiment metadata
    expect(result1.experimentName).toBe('assignment-test');
    expect(result2.experimentName).toBe('assignment-test');

    // Variants should be assigned (control or treatment)
    expect(['control', 'treatment']).toContain(result1.experimentVariant);
    expect(['control', 'treatment']).toContain(result2.experimentVariant);
  });

  it('produces consistent assignment for same user', async () => {
    const context: PromptLoadContext = { userId: 'consistent-user-123' };

    const result1 = await getSystemPromptAsync('draft_graph', context);
    const result2 = await getSystemPromptAsync('draft_graph', context);
    const result3 = await getSystemPromptAsync('draft_graph', context);

    // Same user should always get same variant
    expect(result1.experimentVariant).toBe(result2.experimentVariant);
    expect(result2.experimentVariant).toBe(result3.experimentVariant);
  });

  it('falls back to keyId when userId not provided', async () => {
    const context: PromptLoadContext = { keyId: 'api-key-xyz' };

    const result = await getSystemPromptAsync('draft_graph', context);

    expect(result.experimentVariant).toBeDefined();
    expect(['control', 'treatment']).toContain(result.experimentVariant);
  });

  it('falls back to requestId when keyId not provided', async () => {
    const context: PromptLoadContext = { requestId: 'req-12345' };

    const result = await getSystemPromptAsync('draft_graph', context);

    expect(result.experimentVariant).toBeDefined();
    expect(['control', 'treatment']).toContain(result.experimentVariant);
  });

  it('respects forceVariant override', async () => {
    const controlContext: PromptLoadContext = {
      userId: 'any-user',
      forceVariant: 'control',
    };
    const treatmentContext: PromptLoadContext = {
      userId: 'any-user',
      forceVariant: 'treatment',
    };

    const controlResult = await getSystemPromptAsync('draft_graph', controlContext);
    const treatmentResult = await getSystemPromptAsync('draft_graph', treatmentContext);

    expect(controlResult.experimentVariant).toBe('control');
    expect(treatmentResult.experimentVariant).toBe('treatment');
  });
});

describe('Staging Support', () => {
  it('sets isStaging flag when useStaging is true', async () => {
    const context: PromptLoadContext = { useStaging: true };

    const result = await getSystemPromptAsync('draft_graph', context);

    expect(result.isStaging).toBe(true);
  });

  it('sets isStaging flag when treatment uses staging', async () => {
    registerExperiment({
      name: 'staging-experiment',
      taskId: 'draft_graph',
      treatmentPercent: 100, // 100% treatment
      treatmentUsesStaging: true,
    });

    const context: PromptLoadContext = { userId: 'test-user' };

    const result = await getSystemPromptAsync('draft_graph', context);

    expect(result.experimentVariant).toBe('treatment');
    expect(result.isStaging).toBe(true);
  });

  it('does not set isStaging when in control group', async () => {
    registerExperiment({
      name: 'control-test',
      taskId: 'draft_graph',
      treatmentPercent: 0, // 0% treatment = all control
      treatmentUsesStaging: true,
    });

    const context: PromptLoadContext = { userId: 'test-user' };

    const result = await getSystemPromptAsync('draft_graph', context);

    expect(result.experimentVariant).toBe('control');
    expect(result.isStaging).toBe(false);
  });
});

describe('Telemetry', () => {
  it('emits experiment assignment event', async () => {
    registerExperiment({
      name: 'telemetry-test',
      taskId: 'draft_graph',
      treatmentPercent: 50,
      treatmentUsesStaging: true,
    });

    const context: PromptLoadContext = {
      userId: 'telemetry-user',
      requestId: 'req-123',
      keyId: 'key-abc',
    };

    await getSystemPromptAsync('draft_graph', context);

    const assignmentEvent = emittedEvents.find(
      (e) => e.event === 'prompt.experiment.assigned'
    );
    expect(assignmentEvent).toBeDefined();
    expect(assignmentEvent?.data.experimentName).toBe('telemetry-test');
    expect(assignmentEvent?.data.taskId).toBe('draft_graph');
    expect(assignmentEvent?.data.requestId).toBe('req-123');
    expect(assignmentEvent?.data.keyId).toBe('key-abc');
    expect(['control', 'treatment']).toContain(assignmentEvent?.data.variant);
  });

  it('emits staging used event when staging is enabled', async () => {
    const context: PromptLoadContext = {
      useStaging: true,
      requestId: 'staging-req',
    };

    await getSystemPromptAsync('draft_graph', context);

    const stagingEvent = emittedEvents.find(
      (e) => e.event === 'prompt.staging.used'
    );
    expect(stagingEvent).toBeDefined();
    expect(stagingEvent?.data.taskId).toBe('draft_graph');
    expect(stagingEvent?.data.requestId).toBe('staging-req');
  });
});

describe('No Active Experiment', () => {
  it('works without any experiment registered', async () => {
    // No experiment registered
    const result = await getSystemPromptAsync('suggest_options');

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.experimentVariant).toBeUndefined();
    expect(result.experimentName).toBeUndefined();
    expect(result.isStaging).toBe(false);
  });

  it('returns default prompt content', async () => {
    const result = await getSystemPromptAsync('critique_graph');

    expect(result.source).toBe('default');
    expect(result.content).toContain('BLOCKER');
    expect(result.content).toContain('IMPROVEMENT');
  });
});

describe('Distribution Validation', () => {
  it('produces roughly expected distribution over many assignments', async () => {
    registerExperiment({
      name: 'distribution-test',
      taskId: 'draft_graph',
      treatmentPercent: 30, // 30% treatment
      treatmentUsesStaging: false,
    });

    let treatmentCount = 0;
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const context: PromptLoadContext = { userId: `user-${i}` };
      const result = await getSystemPromptAsync('draft_graph', context);
      if (result.experimentVariant === 'treatment') {
        treatmentCount++;
      }
    }

    const treatmentPercent = (treatmentCount / iterations) * 100;

    // Should be within reasonable range of 30% (±5%)
    // Note: This is a statistical test, may occasionally fail
    expect(treatmentPercent).toBeGreaterThan(20);
    expect(treatmentPercent).toBeLessThan(40);
  });
});
