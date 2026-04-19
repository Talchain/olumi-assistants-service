import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_ROUTING_LOG_PATH,
  buildRoutingLog,
  writeRoutingLog,
  type RoutingLogInput,
} from '../routing-log.js';

function baseInput(overrides: Partial<RoutingLogInput> = {}): RoutingLogInput {
  return {
    turn_id: overrides.turn_id ?? 't-001',
    scenario_id: overrides.scenario_id ?? 'scen-abc',
    stage: overrides.stage ?? 'analyse',
    intent_class: overrides.intent_class ?? 'execute',
    handler_id: overrides.handler_id ?? 'run_analysis',
    coaching_mode: overrides.coaching_mode ?? null,
    resolution_status: overrides.resolution_status ?? 'resolved',
    routing_error_cause: overrides.routing_error_cause ?? null,
    validation_error_code: overrides.validation_error_code ?? null,
    compound_detected: overrides.compound_detected ?? false,
    compound_pattern_matched: overrides.compound_pattern_matched ?? null,
    raw_user_message: overrides.raw_user_message ?? 'run the analysis',
    sonnet_text: overrides.sonnet_text ?? 'Running analysis...',
    redacted: overrides.redacted ?? false,
    created_at: overrides.created_at ?? '2026-04-19T02:00:00Z',
    ...(overrides.label_tier ? { label_tier: overrides.label_tier } : {}),
  };
}

describe('buildRoutingLog', () => {
  it('preserves raw_user_message + sonnet_text when redacted=false', () => {
    const log = buildRoutingLog(baseInput({ redacted: false }));
    expect(log.raw_user_message).toBe('run the analysis');
    expect(log.sonnet_text).toBe('Running analysis...');
    expect(log.sonnet_text_hash).toBeNull();
    expect(log.redacted).toBe(false);
  });

  it('drops raw_user_message + hashes sonnet_text when redacted=true', () => {
    const log = buildRoutingLog(baseInput({ redacted: true, sonnet_text: 'secret routing output' }));
    expect(log.raw_user_message).toBeNull();
    expect(log.sonnet_text).toBeNull();
    expect(log.sonnet_text_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('label_tier defaults to "unreviewed"', () => {
    const log = buildRoutingLog(baseInput());
    expect(log.label_tier).toBe('unreviewed');
  });

  it('label_tier respects explicit override', () => {
    const log = buildRoutingLog(baseInput({ label_tier: 'gold' }));
    expect(log.label_tier).toBe('gold');
  });

  it('preserves turn_id for linkage back to v5_conversation_turns', () => {
    const log = buildRoutingLog(baseInput({ turn_id: 't-0042' }));
    expect(log.turn_id).toBe('t-0042');
  });

  it('preserves coaching_mode and intent_class as emitted by routing', () => {
    const log = buildRoutingLog(baseInput({ intent_class: 'coach', coaching_mode: 'challenge' }));
    expect(log.intent_class).toBe('coach');
    expect(log.coaching_mode).toBe('challenge');
  });

  it('preserves compound fields', () => {
    const log = buildRoutingLog(
      baseInput({ compound_detected: true, compound_pattern_matched: 'then' }),
    );
    expect(log.compound_detected).toBe(true);
    expect(log.compound_pattern_matched).toBe('then');
  });
});

describe('writeRoutingLog', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'v5-routing-log-test-'));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends a JSONL line to the chosen path', async () => {
    const filePath = join(tempDir, 'routing.jsonl');
    const log = buildRoutingLog(baseInput());
    await writeRoutingLog(log, filePath);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(JSON.parse(content.trim())).toMatchObject({ turn_id: 't-001', redacted: false });
  });

  it('appends multiple lines without truncating earlier records', async () => {
    const filePath = join(tempDir, 'routing.jsonl');
    await writeRoutingLog(buildRoutingLog(baseInput({ turn_id: 't-a' })), filePath);
    await writeRoutingLog(buildRoutingLog(baseInput({ turn_id: 't-b' })), filePath);
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).turn_id).toBe('t-a');
    expect(JSON.parse(lines[1]!).turn_id).toBe('t-b');
  });

  it('exports DEFAULT_ROUTING_LOG_PATH under logs/', () => {
    expect(DEFAULT_ROUTING_LOG_PATH).toContain('logs');
    expect(DEFAULT_ROUTING_LOG_PATH).toContain('v5-routing-logs.jsonl');
  });
});
