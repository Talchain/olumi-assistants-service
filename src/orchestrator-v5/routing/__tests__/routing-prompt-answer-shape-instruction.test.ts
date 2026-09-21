/**
 * Answer-shape FALLBACK-PROMPT-CONTRACT test (#611 de-fixture — the
 * green-by-fixture gap, same class as bias #541).
 *
 * ┌─ WHAT THIS TEST GUARDS — READ THIS BEFORE TRUSTING IT ────────────────┐
 * │ This guards the PMS-DOWN FALLBACK path only, NOT the served prompt.   │
 * │ In CI, `buildRoutingPromptSnapshot()` resolves the in-repo `routing`  │
 * │ default (`Prompts/v40.txt`) because PMS is disabled. That file is the │
 * │ prompt the model receives when — and ONLY when — the PMS lookup fails │
 * │ (`fallback_reason: pms_disabled`). The prompt actually SERVED in       │
 * │ staging/prod is PMS-managed (`orchestrator_default`, v117 → v118) and │
 * │ is admin-only — it is NOT readable in CI, so no CI test can assert on  │
 * │ it. Do NOT mistake this test for a served-prompt check: that mistake  │
 * │ is exactly what let #611 ship green.                                  │
 * │                                                                        │
 * │ The SERVED-prompt guarantee lives OUTSIDE CI, in the v118 promotion   │
 * │ SERVE-VERIFY gate (real-turn `prompt_hash` == expected v118 hash +    │
 * │ 8/8 answer_shape acceptance on sampled live turns). See               │
 * │ `Docs/v5/answer-shape-served-prompt-guarantee.md` and                 │
 * │ `parallel-briefs/coach-prompt-v118-candidate/RUNBOOK.md`.             │
 * └───────────────────────────────────────────────────────────────────────┘
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
 * The missing coverage this test adds: nothing asserted that the routing/
 * orchestrator system prompt actually INSTRUCTS the model to produce the
 * shape. The tool property is descriptive-only (see answer-shape.ts /
 * tool-schema.ts headers) — the hard pressure is Zod + REPAIR_ONCE, and a
 * model that is never told to emit `answer_shape` in the first place burns a
 * repair round-trip (or fails it) on every coach/converse turn. If the PMS
 * lookup ever fails and the model falls back to `Prompts/v40.txt`, that
 * fallback prompt MUST still instruct the shape — otherwise a PMS outage
 * silently regresses F1 back to the #611 defect. This test is that alarm.
 *
 * WHAT THIS TEST DOES
 * It reads the FALLBACK routing prompt through the SAME production accessor
 * the live routing call uses (`buildRoutingPromptSnapshot()` → PMS-with-
 * default fallback). In CI, PMS is disabled, so the accessor returns the
 * in-repo `routing` default (`Prompts/v40.txt`). The test asserts that
 * fallback contains the `answer_shape` production instruction, so a
 * PMS-down deploy is CONSISTENT with the served v118 prompt and cannot
 * silently regress F1.
 *
 * EXPECTED STATE
 *   - RED if `Prompts/v40.txt` lacks the answer_shape production
 *     instruction (the pre-#613 state — the fallback would silently regress
 *     F1 on any PMS outage).
 *   - GREEN once the answer_shape production instruction is present in
 *     `Prompts/v40.txt` (added in #613, mirroring the v118 promotion delta).
 *
 * This is a fail-loud gap alarm, not a schema test: it must NOT be satisfied
 * by the tool-schema property (that is in a different file and always
 * present). It is satisfied only by the FALLBACK PROMPT telling the model to
 * fill the shape.
 *
 * Positive control (doctrine: an absence assertion must first prove it can
 * SEE a presence): the test asserts the fallback text is the full ~21k-char
 * routing prompt before asserting the instruction is present — so a loader
 * returning '' can never make the instruction assertion pass vacuously.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRoutingPromptSnapshot,
  __resetRoutingPromptSnapshotForTests,
  EXPECTED_SYSTEM_CHARS_MIN,
} from '../prompt-loader.js';

async function fallbackRoutingPromptText(): Promise<string> {
  __resetRoutingPromptSnapshotForTests();
  const snapshot = await buildRoutingPromptSnapshot();
  return snapshot.text;
}

describe('routing FALLBACK prompt — answer_shape production instruction (#611 de-fixture; PMS-down path, NOT the served prompt)', () => {
  beforeEach(() => {
    __resetRoutingPromptSnapshotForTests();
  });
  afterEach(() => {
    __resetRoutingPromptSnapshotForTests();
  });

  it('POSITIVE CONTROL: the fallback routing prompt loads as the full prompt (not an empty/placeholder string)', async () => {
    const text = await fallbackRoutingPromptText();
    // If this fails, every instruction assertion below is testing nothing.
    expect(text.length).toBeGreaterThan(EXPECTED_SYSTEM_CHARS_MIN);
  });

  it('names the answer_shape contract field the model must populate on coach/converse turns', async () => {
    const text = await fallbackRoutingPromptText();
    // The stable contract identifier. A prompt that instructs the model to
    // emit the structured answer references the field by name — the same
    // `answer_shape` the tool schema and AnswerShapeSchema use. Its total
    // absence is the #611 gap: the model is never told to produce the shape,
    // so the live wire relies entirely on a REPAIR_ONCE round-trip that the
    // model must then satisfy unprompted. This asserts the FALLBACK cannot
    // silently regress to that state on a PMS outage.
    expect(
      /answer_shape/i.test(text),
      'The fallback routing prompt (Prompts/v40.txt) does not mention ' +
        '`answer_shape` anywhere. On a PMS outage the model would fall back ' +
        'to this prompt and never be instructed to produce the structured ' +
        'answer, silently regressing F1 to the #611 defect. Add the ' +
        'answer_shape production instruction to Prompts/v40.txt (mirror the ' +
        'v118 promotion). NOTE: this guards the PMS-down FALLBACK only — the ' +
        'SERVED-prompt guarantee is the v118 SERVE-VERIFY gate, not CI.',
    ).toBe(true);
  });

  it('describes the structured answer format (headline / bullets / detail) so the model knows the shape to emit', async () => {
    const text = await fallbackRoutingPromptText();
    // A real production instruction enumerates the three sub-fields the model
    // must fill. This is what turns "the field exists in the tool schema"
    // (descriptive) into "produce your answer in this shape" (instructive).
    const describesHeadline = /headline/i.test(text);
    const describesBullets = /bullets?/i.test(text);
    const describesDetail = /\bdetail\b/i.test(text);
    expect(
      describesHeadline && describesBullets && describesDetail,
      'The fallback routing prompt (Prompts/v40.txt) does not describe the ' +
        `answer_shape structure (headline: ${describesHeadline}, bullets: ` +
        `${describesBullets}, detail: ${describesDetail}). The model cannot ` +
        'reliably produce a shape it was never told the form of.',
    ).toBe(true);
  });
});
