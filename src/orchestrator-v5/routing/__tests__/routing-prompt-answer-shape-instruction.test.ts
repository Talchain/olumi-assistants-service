/**
 * Answer-shape PROMPT-CONTRACT test (#611 de-fixture — the green-by-fixture
 * gap, same class as bias #541).
 *
 * WHY THIS EXISTS
 * The four existing #611 answer_shape tests all prove the SCHEMA-pressure
 * layer: given a hand-built valid `answer_shape`, the tool definition
 * advertises it, Zod enforces it, and REPAIR_ONCE retries a malformed one.
 * Every one of them INJECTS the shape via a mock adapter —
 * route-with-tool-use-answer-shape-repair.test.ts even scripts the mock to
 * RETURN the valid shape on the repair call, hard-coding the exact model
 * compliance the live model does NOT reliably produce. So the whole suite
 * stays green while the live wire intermittently ships coach/converse turns
 * with NO shape (relying on a repair round-trip that itself depends on the
 * model eventually complying).
 *
 * The missing coverage: nothing asserts that the SERVED routing/orchestrator
 * system prompt actually INSTRUCTS the model to produce the shape. The tool
 * property is descriptive-only (see answer-shape.ts / tool-schema.ts headers)
 * — the hard pressure is Zod + REPAIR_ONCE, and a model that is never told to
 * emit `answer_shape` in the first place burns a repair round-trip (or fails
 * it) on every coach/converse turn.
 *
 * WHAT THIS TEST DOES
 * It reads the SERVED routing prompt through the SAME production accessor the
 * live routing call uses (`buildRoutingPromptSnapshot()` → PMS-with-default
 * fallback; in CI, the in-repo `routing` default = `Prompts/v40.txt`, which
 * IS the in-repo artifact that governs the operator-managed `orchestrator`
 * prompt — the served PMS content is admin-only and not readable here) and
 * asserts it contains the `answer_shape` production instruction.
 *
 * EXPECTED STATE
 *   - RED today: v40 (== the current PMS v117 orchestrator prompt) instructs
 *     the model on `answer_shape` NOWHERE.
 *   - GREEN once the answer_shape production instruction is added to the
 *     served prompt (the v118 promotion) — and to the in-repo governing
 *     artifact so CI can see it.
 *
 * This is a fail-loud gap alarm, not a schema test: it must NOT be satisfied
 * by the tool-schema property (that is in a different file and always
 * present). It is satisfied only by the PROMPT telling the model to fill the
 * shape.
 *
 * Positive control (doctrine: an absence assertion must first prove it can
 * SEE a presence): the test asserts the served text is the full ~21k-char
 * routing prompt before asserting the instruction is absent/present — so a
 * loader returning '' can never make the instruction-absence pass vacuously.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRoutingPromptSnapshot,
  __resetRoutingPromptSnapshotForTests,
  EXPECTED_SYSTEM_CHARS_MIN,
} from '../prompt-loader.js';

async function servedRoutingPromptText(): Promise<string> {
  __resetRoutingPromptSnapshotForTests();
  const snapshot = await buildRoutingPromptSnapshot();
  return snapshot.text;
}

describe('routing prompt — answer_shape production instruction (#611 de-fixture)', () => {
  beforeEach(() => {
    __resetRoutingPromptSnapshotForTests();
  });
  afterEach(() => {
    __resetRoutingPromptSnapshotForTests();
  });

  it('POSITIVE CONTROL: the served routing prompt loads as the full prompt (not an empty/placeholder string)', async () => {
    const text = await servedRoutingPromptText();
    // If this fails, every instruction assertion below is testing nothing.
    expect(text.length).toBeGreaterThan(EXPECTED_SYSTEM_CHARS_MIN);
  });

  it('names the answer_shape contract field the model must populate on coach/converse turns', async () => {
    const text = await servedRoutingPromptText();
    // The stable contract identifier. A prompt that instructs the model to
    // emit the structured answer references the field by name — the same
    // `answer_shape` the tool schema and AnswerShapeSchema use. Its total
    // absence is the #611 gap: the model is never told to produce the shape,
    // so the live wire relies entirely on a REPAIR_ONCE round-trip that the
    // model must then satisfy unprompted.
    expect(
      /answer_shape/i.test(text),
      'The served routing prompt does not mention `answer_shape` anywhere. ' +
        'Coach/converse turns are never instructed to produce the structured ' +
        'answer, so the shape only ever arrives via a repair retry (or not at ' +
        'all). Add the answer_shape production instruction to the served ' +
        'prompt (v118 promotion) and to Prompts/v40.txt so CI sees it.',
    ).toBe(true);
  });

  it('describes the structured answer format (headline / bullets / detail) so the model knows the shape to emit', async () => {
    const text = await servedRoutingPromptText();
    // A real production instruction enumerates the three sub-fields the model
    // must fill. This is what turns "the field exists in the tool schema"
    // (descriptive) into "produce your answer in this shape" (instructive).
    const describesHeadline = /headline/i.test(text);
    const describesBullets = /bullets?/i.test(text);
    const describesDetail = /\bdetail\b/i.test(text);
    expect(
      describesHeadline && describesBullets && describesDetail,
      'The served routing prompt does not describe the answer_shape structure ' +
        `(headline: ${describesHeadline}, bullets: ${describesBullets}, ` +
        `detail: ${describesDetail}). The model cannot reliably produce a shape ` +
        'it was never told the form of.',
    ).toBe(true);
  });
});
