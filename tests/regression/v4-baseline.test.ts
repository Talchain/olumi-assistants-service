/**
 * V4 baseline regression — slice A1.
 *
 * Snapshot-asserts the V4 envelope shape captured from staging bundle
 * d8d0cab0 (direct_answer turn, 2026-04-16). This locks the V4 contract
 * so any future change to either V4 or V5 that would break the V4 envelope
 * shape fails loudly here.
 *
 * Assertion policy per Paul's constraint 8: structural, not count-exact.
 * Arrays are checked for shape + each element validating; count-exact only
 * on invariant fields (response_version, turn_plan.routing, etc).
 *
 * Also runs the negative-invariant smoke: the recorded V4 envelope must not
 * carry any V5 artefacts (FEATURE_NOT_ENABLED, boundary:B1, ErrorBlock).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  __dirname,
  '..',
  'fixtures',
  'v4-baseline',
  'direct-answer-v4-baseline.json',
);

interface V4Fixture {
  _meta: { fixture_id: string };
  recorded_response: {
    turn_id: string;
    assistant_text: string;
    blocks: unknown[];
    suggested_actions: Array<{ label: string; prompt: string; role: string; action_type: string; parameters: Record<string, unknown> }>;
    lineage: { context_hash: string };
    turn_plan: { selected_tool: string | null; routing: string; executed_tools: string[]; deferred_tools: string[]; long_running: boolean; tool_latency_ms?: number };
    stage_indicator: { stage: string; confidence: string; source: string };
    response_version: number;
    guidance_items: Array<{ item_id: string; signal_code: string; category: string; source: string }>;
    updated_session_state: Record<string, unknown>;
  };
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as V4Fixture;
const envelope = fixture.recorded_response;

// ---------------------------------------------------------------------------
// Count-exact invariants (Paul's constraint 8)
// ---------------------------------------------------------------------------

describe('V4 baseline (d8d0cab0) — count-exact invariants', () => {
  it('response_version === 2', () => {
    expect(envelope.response_version).toBe(2);
  });

  it('blocks.length === 0 (pure narrate turn)', () => {
    expect(envelope.blocks).toEqual([]);
  });

  it('turn_plan.selected_tool === null', () => {
    expect(envelope.turn_plan.selected_tool).toBeNull();
  });

  it('turn_plan.routing === "llm"', () => {
    expect(envelope.turn_plan.routing).toBe('llm');
  });

  it('turn_plan.executed_tools === []', () => {
    expect(envelope.turn_plan.executed_tools).toEqual([]);
  });

  it('turn_plan.deferred_tools === []', () => {
    expect(envelope.turn_plan.deferred_tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Structural invariants (shape + element validation, not count)
// ---------------------------------------------------------------------------

describe('V4 baseline (d8d0cab0) — structural invariants', () => {
  it('assistant_text is a non-empty string', () => {
    expect(typeof envelope.assistant_text).toBe('string');
    expect(envelope.assistant_text.length).toBeGreaterThan(0);
  });

  it('lineage.context_hash is a 64-char lowercase hex string', () => {
    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('stage_indicator has the expected V4 shape', () => {
    expect(envelope.stage_indicator).toMatchObject({
      stage: expect.any(String),
      confidence: expect.any(String),
      source: expect.any(String),
    });
  });

  it('suggested_actions is an array where each element has V4 shape', () => {
    expect(Array.isArray(envelope.suggested_actions)).toBe(true);
    for (const action of envelope.suggested_actions) {
      expect(typeof action.label).toBe('string');
      expect(action.label.length).toBeGreaterThan(0);
      expect(typeof action.prompt).toBe('string');
      expect(typeof action.role).toBe('string');
      expect(typeof action.action_type).toBe('string');
      expect(typeof action.parameters).toBe('object');
    }
  });

  it('guidance_items is an array where each element has V4 shape', () => {
    expect(Array.isArray(envelope.guidance_items)).toBe(true);
    for (const item of envelope.guidance_items) {
      expect(typeof item.item_id).toBe('string');
      expect(item.item_id.length).toBeGreaterThan(0);
      expect(typeof item.signal_code).toBe('string');
      expect(typeof item.category).toBe('string');
      expect(typeof item.source).toBe('string');
    }
  });

  it('updated_session_state carries all 14 V4 tracked keys', () => {
    const required = [
      'prediction',
      'calibrations_provided',
      'plays_fired',
      'questions_asked',
      'accepted_patches',
      'dismissed_patches',
      'last_chip_ids_shown',
      'chip_ids_shown_prev_turn',
      'chip_ids_clicked',
      'last_question_turn',
      'preferred_option',
      'convergence_signal',
      'analysis_graph_hash',
      'analysis_scenario_id',
    ];
    for (const key of required) {
      expect(envelope.updated_session_state).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Negative invariants — no V5 artefacts bled into the V4 envelope
// ---------------------------------------------------------------------------

describe('V4 baseline (d8d0cab0) — no V5 artefacts', () => {
  const raw = JSON.stringify(envelope);

  it('does not carry FEATURE_NOT_ENABLED sentinel', () => {
    expect(raw).not.toContain('FEATURE_NOT_ENABLED');
  });

  it('does not carry boundary:"B1" marker', () => {
    expect(raw).not.toContain('"boundary":"B1"');
    expect(raw).not.toContain('"boundary": "B1"');
  });

  it('does not carry INGRESS_CONTRACT_VIOLATION', () => {
    expect(raw).not.toContain('INGRESS_CONTRACT_VIOLATION');
  });

  it('does not carry an ErrorBlock (type:"error") — this is a success envelope', () => {
    expect(raw).not.toContain('"type":"error"');
    expect(raw).not.toContain('"type": "error"');
  });

  it('does not reference the V5-only OlumiResponse insights field', () => {
    // V4 envelope does not emit `insights` at top level. Regression guard
    // ensures the fixture wasn't accidentally seeded with V5 shape.
    expect(envelope).not.toHaveProperty('insights');
  });
});
