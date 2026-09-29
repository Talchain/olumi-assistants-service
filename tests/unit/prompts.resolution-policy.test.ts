/**
 * Prompt resolution policy — PR1 observability classifier.
 *
 * Pure-function coverage of the decision matrix + the thin emit/log glue.
 * PR1 is observability-only: the classifier never changes what content is
 * served, it only decides how loudly to surface a resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CeeTaskId } from '../../src/prompts/schema.js';
import type { RuntimeEnv } from '../../src/config/env-resolver.js';
import {
  classifyPromptResolution,
  isCriticalKey,
  isDeployedEnv,
  recordPromptResolutionObservation,
} from '../../src/prompts/resolution-policy.js';
import { setTestSink, TelemetryEvents } from '../../src/utils/telemetry.js';

const ROUTING = 'routing' as CeeTaskId;
const NON_CRITICAL = 'suggest_options' as CeeTaskId;
// 'orchestrator' is a real task_id but NOT a tracked/critical key — this is the
// exact distinction behind the staging routing-vs-orchestrator confusion.
const ORCHESTRATOR = 'orchestrator' as CeeTaskId;

describe('isCriticalKey', () => {
  it('routing is critical', () => {
    expect(isCriticalKey('routing')).toBe(true);
  });

  it('the other four tracked keys are critical', () => {
    for (const k of ['edit_graph', 'draft_graph', 'decision_review', 'repair_graph']) {
      expect(isCriticalKey(k)).toBe(true);
    }
  });

  it('orchestrator and narrate/aux keys are NOT critical', () => {
    expect(isCriticalKey('orchestrator')).toBe(false);
    expect(isCriticalKey('suggest_options')).toBe(false);
    expect(isCriticalKey('direct_answer_narrate')).toBe(false);
  });
});

describe('isDeployedEnv', () => {
  it('staging and prod are deployed', () => {
    expect(isDeployedEnv('staging')).toBe(true);
    expect(isDeployedEnv('prod')).toBe(true);
  });
  it('local and test are not deployed', () => {
    expect(isDeployedEnv('local')).toBe(false);
    expect(isDeployedEnv('test')).toBe(false);
  });
});

describe('classifyPromptResolution', () => {
  it('store source → pms_success, not degraded, info', () => {
    for (const env of ['local', 'test', 'staging', 'prod'] as RuntimeEnv[]) {
      expect(classifyPromptResolution({ key: ROUTING, runtimeEnv: env, resolvedSource: 'store' })).toEqual(
        { outcome: 'pms_success', degraded: false, logLevel: 'info' },
      );
    }
  });

  it('non-critical key on default → default_allowed, quiet, anywhere', () => {
    for (const env of ['local', 'test', 'staging', 'prod'] as RuntimeEnv[]) {
      expect(
        classifyPromptResolution({ key: NON_CRITICAL, runtimeEnv: env, resolvedSource: 'default' }),
      ).toEqual({ outcome: 'default_allowed', degraded: false, logLevel: 'debug' });
    }
    // orchestrator behaves like a non-critical key — it must NOT be flagged
    // even on default in prod.
    expect(
      classifyPromptResolution({ key: ORCHESTRATOR, runtimeEnv: 'prod', resolvedSource: 'default' }),
    ).toEqual({ outcome: 'default_allowed', degraded: false, logLevel: 'debug' });
  });

  it('critical key on default in local/test → default_allowed but logged at warn', () => {
    for (const env of ['local', 'test'] as RuntimeEnv[]) {
      expect(
        classifyPromptResolution({ key: ROUTING, runtimeEnv: env, resolvedSource: 'default' }),
      ).toEqual({ outcome: 'default_allowed', degraded: false, logLevel: 'warn' });
    }
  });

  it('critical key on default in staging/prod → default_on_critical_deployed, degraded, error', () => {
    for (const env of ['staging', 'prod'] as RuntimeEnv[]) {
      expect(
        classifyPromptResolution({ key: ROUTING, runtimeEnv: env, resolvedSource: 'default' }),
      ).toEqual({ outcome: 'default_on_critical_deployed', degraded: true, logLevel: 'error' });
    }
  });
});

describe('recordPromptResolutionObservation (emit + log glue)', () => {
  let captured: Array<{ event: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    captured = [];
    setTestSink((event, data) => captured.push({ event, data }));
  });
  afterEach(() => setTestSink(null));

  function policyEvents() {
    return captured
      .filter((e) => e.event === TelemetryEvents.V5PromptResolutionPolicy)
      .map((e) => e.data);
  }

  it('emits exactly one v5.prompt_resolution_policy with the loud outcome for a deployed critical default', () => {
    const obs = recordPromptResolutionObservation({
      key: ROUTING,
      runtimeEnv: 'staging',
      resolvedSource: 'default',
      fallbackReason: 'not_found',
      trigger: 'startup',
    });
    expect(obs.outcome).toBe('default_on_critical_deployed');
    expect(obs.degraded).toBe(true);

    const events = policyEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      key: 'routing',
      outcome: 'default_on_critical_deployed',
      degraded: true,
      source: 'default',
      fallback_reason: 'not_found',
      runtime_env: 'staging',
      trigger: 'startup',
    });
  });

  it('emits pms_success (source=pms) and never throws on the happy path', () => {
    const obs = recordPromptResolutionObservation({
      key: ROUTING,
      runtimeEnv: 'staging',
      resolvedSource: 'store',
    });
    expect(obs.outcome).toBe('pms_success');
    const events = policyEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ key: 'routing', outcome: 'pms_success', source: 'pms', degraded: false });
  });

  it('defaults fallback_reason to none when unspecified', () => {
    recordPromptResolutionObservation({ key: ROUTING, runtimeEnv: 'local', resolvedSource: 'default' });
    expect(policyEvents()[0].fallback_reason).toBe('none');
  });
});
