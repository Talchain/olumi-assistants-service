import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_ROUTING_LOG_PATH,
  ROUTING_LOG_FIELD_POLICY,
  buildRoutingLog,
  writeRoutingLog,
  type RoutingLogInput,
} from '../routing-log.js';
import { isDecisionContentField } from '../../../utils/logger-config.js';

function baseInput(overrides: Partial<RoutingLogInput> = {}): RoutingLogInput {
  // Construct a complete RoutingLogInput — every required field
  // populated with a documented default. The previous fixture used a
  // type cast (`as RoutingLogInput`) which silently hid missing fields
  // and let regressions through; this shape satisfies the interface
  // structurally so any future required-field addition fails fast at
  // compile time.
  const input: RoutingLogInput = {
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
    graph_node_count: overrides.graph_node_count ?? 0,
    graph_edge_count: overrides.graph_edge_count ?? 0,
    graph_hash: overrides.graph_hash ?? null,
    graph_mapped_nodes: overrides.graph_mapped_nodes ?? 0,
    graph_dropped_by_unknown_kind: overrides.graph_dropped_by_unknown_kind ?? 0,
    graph_dropped_by_missing_id: overrides.graph_dropped_by_missing_id ?? 0,
    graph_lookup_outcome: overrides.graph_lookup_outcome ?? 'no_graph',
    cqe_message_length: overrides.cqe_message_length ?? 0,
    cqe_result_count: overrides.cqe_result_count ?? 0,
    cqe_match_count: overrides.cqe_match_count ?? 0,
    cqe_compromise_match_count: overrides.cqe_compromise_match_count ?? 0,
    cqe_patterns_matched: overrides.cqe_patterns_matched ?? [],
    cqe_duration_ms: overrides.cqe_duration_ms ?? 0,
    cqe_timeout: overrides.cqe_timeout ?? false,
    cqe_degraded: overrides.cqe_degraded ?? false,
    cqe_message_too_long: overrides.cqe_message_too_long ?? false,
    cqe_word_range_missed: overrides.cqe_word_range_missed ?? false,
    cqe_ambiguous_phrasing_detected:
      overrides.cqe_ambiguous_phrasing_detected ?? false,
    coaching_signal_id: overrides.coaching_signal_id ?? null,
    // V5 product-state continuity (foamy-bee tranche).
    recent_changes_count: overrides.recent_changes_count ?? 0,
    prior_mutation_fact_count: overrides.prior_mutation_fact_count ?? 0,
    state_query_guard_outcome:
      overrides.state_query_guard_outcome ?? 'not_evaluated',
    ...(overrides.label_tier ? { label_tier: overrides.label_tier } : {}),
  };
  return input;
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

  it('defaults coaching_signal_id to null and preserves it in both branches', () => {
    // V5 Group 1 Task C: Step 5 coaching pass emits coaching_signal_id.
    const nullLog = buildRoutingLog(baseInput());
    expect(nullLog.coaching_signal_id).toBeNull();

    const firedLog = buildRoutingLog(
      baseInput({ coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE' }),
    );
    expect(firedLog.coaching_signal_id).toBe('FIRST_ANALYSIS_COMPLETE');

    // Redacted path preserves the signal (not a user-supplied field, so it
    // crosses the privacy boundary).
    const redacted = buildRoutingLog(
      baseInput({ coaching_signal_id: 'STALE_ANALYSIS_AFTER_EDIT', redacted: true }),
    );
    expect(redacted.coaching_signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    expect(redacted.redacted).toBe(true);
  });

  describe('V5 product-state continuity (foamy-bee tranche) fields', () => {
    it('defaults the three new fields to safe values when not supplied', () => {
      const log = buildRoutingLog(baseInput());
      expect(log.recent_changes_count).toBe(0);
      expect(log.prior_mutation_fact_count).toBe(0);
      expect(log.state_query_guard_outcome).toBe('not_evaluated');
    });

    it('preserves the three new fields through the non-redacted branch', () => {
      const log = buildRoutingLog(
        baseInput({
          recent_changes_count: 3,
          prior_mutation_fact_count: 7,
          state_query_guard_outcome: 'with_recent_change',
          redacted: false,
        }),
      );
      expect(log.recent_changes_count).toBe(3);
      expect(log.prior_mutation_fact_count).toBe(7);
      expect(log.state_query_guard_outcome).toBe('with_recent_change');
    });

    it('preserves the three new fields through the redacted branch (none of them are user-supplied data)', () => {
      // recent_changes_count, prior_mutation_fact_count, and
      // state_query_guard_outcome are derived counters / categoricals
      // — they cross the privacy boundary the same way coaching_signal_id
      // does (no raw user content). Redaction must NOT drop them or
      // dashboards lose the misroute observability.
      const log = buildRoutingLog(
        baseInput({
          recent_changes_count: 2,
          prior_mutation_fact_count: 5,
          state_query_guard_outcome: 'no_recent_changes',
          redacted: true,
        }),
      );
      expect(log.redacted).toBe(true);
      expect(log.recent_changes_count).toBe(2);
      expect(log.prior_mutation_fact_count).toBe(5);
      expect(log.state_query_guard_outcome).toBe('no_recent_changes');
    });

    it('accepts every state_query_guard_outcome categorical value', () => {
      const outcomes: ReadonlyArray<
        'unmatched' | 'with_recent_change' | 'no_recent_changes' | 'not_evaluated'
      > = ['unmatched', 'with_recent_change', 'no_recent_changes', 'not_evaluated'];
      for (const outcome of outcomes) {
        const log = buildRoutingLog(
          baseInput({ state_query_guard_outcome: outcome }),
        );
        expect(log.state_query_guard_outcome).toBe(outcome);
      }
    });
  });

  describe('field-policy redaction (14-Jul PII ruling — fail-loud, sentinel-proven)', () => {
    // High-entropy sentinel: cannot collide with structural vocabulary.
    const SENTINEL = 'SENTINEL-4be1d9a2-relocate-hq-to-lisbon';

    it('SENTINEL: redacted=true keeps decision content out of the serialized record', () => {
      const record = buildRoutingLog(
        baseInput({
          redacted: true,
          raw_user_message: SENTINEL,
          sonnet_text: `${SENTINEL} with trailing prose`,
        }),
      );
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain(SENTINEL);
      expect(record.raw_user_message).toBeNull();
      expect(record.sonnet_text).toBeNull();
      expect(record.sonnet_text_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('POSITIVE CONTROL: redacted=false shows the same sentinel — the assertion above can see a presence', () => {
      const record = buildRoutingLog(
        baseInput({
          redacted: false,
          raw_user_message: SENTINEL,
          sonnet_text: `${SENTINEL} with trailing prose`,
        }),
      );
      const serialized = JSON.stringify(record);
      // Same harness, same fields, redaction off → sentinel visible.
      // Without this, the absence assertion above would be vacuous.
      expect(serialized).toContain(SENTINEL);
    });

    it('FAIL-LOUD: a field with no policy entry throws in test envs (never silent passthrough)', () => {
      const rogue = {
        ...baseInput({ redacted: true }),
        brand_new_field: SENTINEL,
      } as unknown as RoutingLogInput;
      expect(() => buildRoutingLog(rogue)).toThrowError(
        /brand_new_field.*ROUTING_LOG_FIELD_POLICY/s,
      );
    });

    it('FAIL-CLOSED: in production (non-test env) an unknown field is DROPPED, not passed through', () => {
      // Simulate the production env-check window only for this call.
      const savedNodeEnv = process.env.NODE_ENV;
      const savedVitest = process.env.VITEST;
      delete process.env.NODE_ENV;
      delete process.env.VITEST;
      try {
        const rogue = {
          ...baseInput({ redacted: true }),
          brand_new_field: SENTINEL,
        } as unknown as RoutingLogInput;
        const record = buildRoutingLog(rogue);
        const serialized = JSON.stringify(record);
        expect(serialized).not.toContain('brand_new_field');
        expect(serialized).not.toContain(SENTINEL);
      } finally {
        if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
        if (savedVitest !== undefined) process.env.VITEST = savedVitest;
      }
    });

    it('POLICY COHERENCE: every content-classified routing field is in the logger-boundary DECISION_CONTENT_FIELDS list', () => {
      // The pino boundary (src/utils/logger-config.ts) and this policy
      // must agree on what counts as decision content — otherwise a
      // field nulled here could still leak through a pino log site
      // under the same name.
      const contentFields = Object.entries(ROUTING_LOG_FIELD_POLICY)
        .filter(([, policy]) => policy === 'content_null' || policy === 'content_hash')
        .map(([field]) => field);
      expect(contentFields.length).toBeGreaterThanOrEqual(2);
      for (const field of contentFields) {
        expect(isDecisionContentField(field), `${field} missing from DECISION_CONTENT_FIELDS`).toBe(true);
      }
    });

    it('the output record is built ONLY from the policy: key set = policy fields + derived hash siblings', () => {
      const record = buildRoutingLog(baseInput({ redacted: true }));
      const expectedKeys = new Set<string>();
      for (const [field, policy] of Object.entries(ROUTING_LOG_FIELD_POLICY)) {
        expectedKeys.add(field);
        if (policy === 'content_hash') expectedKeys.add(`${field}_hash`);
      }
      expect(new Set(Object.keys(record))).toEqual(expectedKeys);
    });
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
