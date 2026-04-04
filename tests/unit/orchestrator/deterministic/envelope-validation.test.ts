/**
 * Tests for the v4 response envelope validation layer.
 * Validates that validateEnvelope catches contract violations without blocking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateEnvelope } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

function buildValidEnvelope(): Record<string, unknown> {
  return {
    turn_id: 'turn-123',
    assistant_text: 'Here is some text.',
    blocks: [
      { block_id: 'blk_1', block_type: 'commentary', data: {} },
    ],
    turn_plan: { routing: 'deterministic', selected_tool: 'run_analysis' },
    stage_indicator: 'evaluate',
    response_version: 2,
    guidance_items: [],
  };
}

describe("validateEnvelope", () => {
  let logWarn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { log } = await import("../../../../src/utils/telemetry.js");
    logWarn = log.warn as ReturnType<typeof vi.fn>;
    logWarn.mockClear();
  });

  it("no warnings for a valid envelope", () => {
    validateEnvelope(buildValidEnvelope(), 'turn-123');
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("accepts assistant_text: null without warning", () => {
    const env = buildValidEnvelope();
    env.assistant_text = null;
    validateEnvelope(env, 'turn-123');
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("warns on empty assistant_text", () => {
    const env = buildValidEnvelope();
    env.assistant_text = '';
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('assistant_text'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("warns on whitespace-only assistant_text", () => {
    const env = buildValidEnvelope();
    env.assistant_text = '   ';
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalled();
  });

  it("warns on undefined assistant_text", () => {
    const env = buildValidEnvelope();
    delete env.assistant_text;
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('undefined'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("warns when blocks is not an array", () => {
    const env = buildValidEnvelope();
    env.blocks = 'not-an-array';
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('blocks is not an array'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("warns on block missing block_type", () => {
    const env = buildValidEnvelope();
    env.blocks = [{ block_id: 'blk_1', data: {} }];
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('block_type'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("warns on block missing block_id", () => {
    const env = buildValidEnvelope();
    env.blocks = [{ block_type: 'commentary', data: {} }];
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('block_id'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("warns on invalid turn_plan.routing", () => {
    const env = buildValidEnvelope();
    env.turn_plan = { routing: 'invalid', selected_tool: null };
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('routing'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("warns on missing stage_indicator", () => {
    const env = buildValidEnvelope();
    delete env.stage_indicator;
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('stage_indicator'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("warns on non-string stage_indicator", () => {
    const env = buildValidEnvelope();
    env.stage_indicator = { stage: 'evaluate', confidence: 'high' };
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('stage_indicator is object'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("warns on invalid stage name", () => {
    const env = buildValidEnvelope();
    env.stage_indicator = 'research';
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('"research"'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("accepts all valid stage names", () => {
    for (const stage of ['frame', 'ideate', 'evaluate', 'decide', 'optimise']) {
      logWarn.mockClear();
      const env = buildValidEnvelope();
      env.stage_indicator = stage;
      validateEnvelope(env, 'turn-123');
      expect(logWarn, `stage "${stage}" should be valid`).not.toHaveBeenCalled();
    }
  });

  it("warns on wrong response_version", () => {
    const env = buildValidEnvelope();
    env.response_version = 1;
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.stringContaining('response_version'),
        ]),
      }),
      'v4.envelope_validation_warnings',
    );
  });

  it("collects multiple violations in a single call", () => {
    const env = buildValidEnvelope();
    env.assistant_text = '';
    env.blocks = 'bad';
    env.response_version = 99;
    validateEnvelope(env, 'turn-123');
    expect(logWarn).toHaveBeenCalledTimes(1);
    const violations = logWarn.mock.calls[0][0].violations as string[];
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts routing: 'llm' as valid", () => {
    const env = buildValidEnvelope();
    (env.turn_plan as Record<string, unknown>).routing = 'llm';
    validateEnvelope(env, 'turn-123');
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("includes observed values in warnings", () => {
    const env = buildValidEnvelope();
    env.blocks = 42;
    validateEnvelope(env, 'turn-123');
    const violations = logWarn.mock.calls[0][0].violations as string[];
    expect(violations[0]).toContain('number');
  });
});
