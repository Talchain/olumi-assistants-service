/**
 * Trust-spine board #1 (CEE half) — COACH EGRESS test (adversarial-review P1).
 *
 * The round-1 defect class this file exists to kill: the winner flag + honest
 * note were set on the compact summary but BOTH coach serializers rebuilt
 * field-picked objects that dropped them, so with the gate ON the coach
 * received NOTHING and still framed the constraint-violating winner cleanly.
 * The compact-level tests passed green over a dead surface because no test
 * asserted the ACTUAL serialized coach input.
 *
 * This test asserts the real egress bytes on BOTH pipelines:
 *   V5: compactAnalysis → assembleContextPack (STRICT ContextPackSchema —
 *       throws in test mode on drift) → buildUserMessage — the exact string
 *       sent as the routing/coach user message.
 *   V4: compactAnalysis → serialiseCompactAnalysis — the exact zone-2 text
 *       assembleV2SystemPrompt embeds. (NOT dead on the live estate:
 *       CEE_PIPELINE_V4_ENABLED is false on staging — V1 routes 410 — but
 *       PROD inherits the code default `true`, FLAG-INVENTORY 2026-07-16.)
 *
 * Gate discipline: flag ON via the REAL config path (env +
 * _resetConfigCache; compactAnalysis called with NO opts override) so the
 * test also proves the env wiring. Flag OFF: zero occurrences of the flag /
 * note substrings anywhere in the serialized output (key-absence
 * byte-identity doctrine).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compactAnalysis } from '../../../orchestrator/context/analysis-compact.js';
import { serialiseCompactAnalysis } from '../../../orchestrator/pipeline/phase3-llm/prompt-assembler.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

// LIVE doctrine-B wire shape (the real staging capture's structure): object
// constraint_probabilities, joint 0 — the over-budget leader (C1 hard
// violation, "does not satisfy" copy).
const LIVE_WIRE_INFEASIBLE_LEADER = {
  analysis_status: 'ok',
  constraints_status: 'computed',
  option_comparison: [
    {
      option_id: 'opt_premium',
      option_label: 'Premium Vendor',
      id: 'opt_premium',
      label: 'Premium Vendor',
      win_probability: 1,
      probability_of_joint_goal: 0,
      constraint_probabilities: { c_budget: 0 },
      status: 'computed',
    },
    {
      option_id: 'opt_budget',
      option_label: 'Budget Vendor',
      id: 'opt_budget',
      label: 'Budget Vendor',
      win_probability: 0,
      probability_of_joint_goal: 1,
      constraint_probabilities: { c_budget: 1 },
      status: 'computed',
    },
  ],
} as unknown as V2RunResponseEnvelope;

let priorGate: string | undefined;

async function setGate(value: string | undefined): Promise<void> {
  if (value === undefined) delete process.env.CEE_CONSTRAINT_INFEASIBLE_GATE;
  else process.env.CEE_CONSTRAINT_INFEASIBLE_GATE = value;
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

beforeEach(() => {
  priorGate = process.env.CEE_CONSTRAINT_INFEASIBLE_GATE;
});
afterEach(async () => {
  await setGate(priorGate);
});

describe('V5 coach egress — the serialized routing prompt carries the flag + note', () => {
  it('flag ON: the ACTUAL buildUserMessage string contains the note and the winner flag', async () => {
    await setGate('true');
    // REAL config path — no opts override.
    const summary = compactAnalysis(LIVE_WIRE_INFEASIBLE_LEADER)!;
    // Positive control at the source (if this fails the egress assertions
    // below would be vacuous).
    expect(summary.winner.constraint_infeasible).toBe(true);

    // assembleContextPack runs the STRICT ContextPackSchema in test mode and
    // THROWS on drift — so this call also proves the schema carries the new
    // keys (the class of silent-strip failure).
    const pack = assembleContextPack({
      payload: makeMessagePayload(),
      priorTurns: [],
      analysis: summary,
    });

    // Raw handler-facing slot: the projected winner carries the typed flag.
    expect(pack.analysis?.leading_option?.constraint_infeasible).toBe(true);
    // LLM-facing display slot: flag + verbatim note.
    const display = pack.display_analysis as Record<string, unknown>;
    expect((display.leading_option as Record<string, unknown>).constraint_infeasible).toBe(true);
    expect(display.constraint_infeasible_note).toBe(summary.constraint_infeasible_note);

    // THE EGRESS BYTES: the exact prompt string the coach receives.
    const prompt = buildUserMessage(pack, 'Which option should I take?');
    expect(prompt).toContain('does not satisfy a hard constraint of this decision');
    expect(prompt).toContain('"constraint_infeasible": true');
    // The note names the flagged winner.
    expect(prompt).toContain('Premium Vendor leads on outcome');
  });

  it('flag OFF: zero constraint_infeasible occurrences anywhere in the pack or prompt (byte-identity by key absence)', async () => {
    await setGate('false');
    const summary = compactAnalysis(LIVE_WIRE_INFEASIBLE_LEADER)!;
    expect(summary.winner.constraint_infeasible).toBeUndefined();

    const pack = assembleContextPack({
      payload: makeMessagePayload(),
      priorTurns: [],
      analysis: summary,
    });
    const prompt = buildUserMessage(pack, 'Which option should I take?');

    expect(JSON.stringify(pack)).not.toContain('constraint_infeasible');
    expect(prompt).not.toContain('constraint_infeasible');
    expect(prompt).not.toContain('hard constraint of this decision');
  });
});

describe('V4 prompt egress — serialiseCompactAnalysis carries the flag + note', () => {
  it('flag ON: the zone-2 analysis text contains the status line and the verbatim note', async () => {
    await setGate('true');
    const summary = compactAnalysis(LIVE_WIRE_INFEASIBLE_LEADER)!;
    expect(summary.winner.constraint_infeasible).toBe(true);

    const text = serialiseCompactAnalysis(summary);
    expect(text).toContain('Winner constraint status: flagged constraint-infeasible');
    expect(text).toContain(`Constraint note: ${summary.constraint_infeasible_note}`);
  });

  it('flag OFF: byte-identical zone-2 text — no constraint status line', async () => {
    await setGate('false');
    const summary = compactAnalysis(LIVE_WIRE_INFEASIBLE_LEADER)!;
    const text = serialiseCompactAnalysis(summary);
    expect(text).not.toContain('constraint-infeasible');
    expect(text).not.toContain('Constraint note:');
  });
});
