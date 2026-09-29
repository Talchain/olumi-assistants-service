/**
 * M1 — the option-targeted counterfactual, at the HANDLER seam.
 *
 * Proves the wiring, not just the composers: which answer the handler actually
 * returns, on both the Sonnet path and the deterministic path, and that turns
 * with no named option are left exactly as they were.
 */
import { describe, it, expect } from 'vitest';

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { createWhatWouldFlipHandler } from '../../what-would-flip.js';
import type { HandlerInvocation } from '../../../registry.js';
import type { AnalysisProjectionSummary } from '../../../../context/projection-summaries.js';
import type { FlipEntry, FlipSummary } from '../../../../compose/flip-proposal.js';
import type { TargetOption } from '../resolve-target-option.js';

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GOAL_ID = 'goal_node_1';

const OFFSHORE: TargetOption = { id: 'opt_offshore', label: 'Engage Offshore Partner' };
const HIRE: TargetOption = { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' };

const ANALYSIS_FACT: RunAnalysisHandlerFact = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_status_quo',
    summary: 'Analysis complete.',
  },
};

const PROJECTION: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Maintain Current Team (Status Quo)', probability: 0.52 },
  runner_up: { label: 'Hire Two Senior Engineers Locally', probability: 0.31 },
  margin_pp: 21,
  robustness_band: 'moderate',
  top_drivers: [{ factor_label: 'Engineering Capacity', sensitivity_value: 0.42 }],
} as unknown as AnalysisProjectionSummary;

function flipEntry(over: Partial<FlipEntry> = {}): FlipEntry {
  return {
    factor_id: 'fac_eng_capacity',
    factor_label: 'Engineering Capacity',
    flip_value: 0.62,
    direction: 'increase',
    unit: null,
    value_scale: 'model',
    flip_reason: null,
    margin_supports_flip: true,
    alternative_winner_id: 'opt_hire_local',
    alternative_winner_label: 'Hire Two Senior Engineers Locally',
    ...over,
  };
}

const FLIPS_TO_HIRE: FlipSummary = {
  overall_status: 'concrete',
  margin_supports_flip: true,
  entries: [flipEntry()],
};

const SONNET_ANSWER =
  'Sonnet wrote this answer about whatever it felt like, at sufficient length to pass the side-band validator without difficulty.';

function makeInvocation(over: {
  flipTargetOption?: TargetOption | null;
  flipSummary?: FlipSummary | null;
  sonnetValid?: boolean;
  message?: string;
  /** Defaults to a PERMITTING verdict with a leader that is neither target. */
  mayNameLeadingOption?: boolean;
  leadingOptionId?: string | null;
}): HandlerInvocation {
  const priorFacts: readonly HandlerFact[] = [ANALYSIS_FACT];
  const message = over.message ?? 'What would make Engage Offshore Partner win?';
  return {
    context: {
      stage: 'decide',
      entity_registry: { option_ids: [], goal_id: GOAL_ID },
      capabilities: {},
      messages: [{ role: 'user', content: message }],
      session_id: SCENARIO_ID,
      request_id: 'req-m1',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: priorFacts,
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message,
      turn_class: 'decide',
      stage: 'decide',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-m1',
    signal: new AbortController().signal,
    orientationText: '',
    analysisReady: {
      options: [
        { option_id: 'opt_offshore', label: OFFSHORE.label, status: 'ready', interventions: { f: 1 } },
        { option_id: 'opt_hire_local', label: HIRE.label, status: 'ready', interventions: { f: 1 } },
      ],
      goal_node_id: GOAL_ID,
      status: 'ready',
    } as unknown as HandlerInvocation['analysisReady'],
    explanation: over.sonnetValid
      ? { answer_text: SONNET_ANSWER, answer_text_valid: true }
      : { answer_text: '', answer_text_valid: false, answer_validation_error: 'too_short' },
    analysisProjection: PROJECTION,
    flipSummary: over.flipSummary === undefined ? FLIPS_TO_HIRE : over.flipSummary,
    flipTargetOption: over.flipTargetOption ?? null,
    mayNameLeadingOption: over.mayNameLeadingOption ?? true,
    analysisLeadingOptionId:
      over.leadingOptionId === undefined ? 'opt_status_quo' : over.leadingOptionId,
  } as unknown as HandlerInvocation;
}

const handler = createWhatWouldFlipHandler();

describe('what_would_flip — the answer addresses the option the user named', () => {
  it('DEFECT PIN: nothing flips to the named option ⇒ the typed refusal, naming it', async () => {
    const out = await handler(makeInvocation({ flipTargetOption: OFFSHORE }));
    expect(out.assistant_text).toContain('Engage Offshore Partner');
    // The pre-fix answer named the OTHER option as the one that would lead.
    expect(out.assistant_text).not.toContain('would lead instead');
    expect(out.assistant_text).not.toContain('Hire Two Senior Engineers Locally');
    // And it is not the generic prose either.
    expect(out.assistant_text).not.toContain('currently leads');
  });

  it('the named option IS the one that flips ⇒ an addressed answer', async () => {
    const out = await handler(makeInvocation({ flipTargetOption: HIRE }));
    expect(out.assistant_text).toContain('Hire Two Senior Engineers Locally would lead instead');
    expect(out.assistant_text).toContain('Engineering Capacity');
  });

  it('the targeted answer OUTRANKS a valid Sonnet answer', async () => {
    // This is the safety-bearing case: asked "what would make X win?" when
    // nothing does, free prose invents a threshold. The deterministic refusal
    // owns the turn.
    const out = await handler(
      makeInvocation({ flipTargetOption: OFFSHORE, sonnetValid: true }),
    );
    expect(out.assistant_text).not.toContain('Sonnet wrote this answer');
    expect(out.assistant_text).toContain('Engage Offshore Partner');
    const fact = out.handler_facts[0] as { result: Record<string, unknown> };
    // Honest provenance: a deterministic string, and no invented failure reason.
    expect(fact.result.answer_source).toBe('deterministic_fallback');
    expect(fact.result.fallback_reason).toBeNull();
  });

  it('a genuine Sonnet FAILURE still reports its reason when targeted', async () => {
    const out = await handler(
      makeInvocation({ flipTargetOption: OFFSHORE, sonnetValid: false }),
    );
    const fact = out.handler_facts[0] as { result: Record<string, unknown> };
    expect(fact.result.answer_source).toBe('deterministic_fallback');
    expect(fact.result.fallback_reason).not.toBeNull();
    expect(out.assistant_text).toContain('Engage Offshore Partner');
  });
});

describe('F1 at the HANDLER — the target may be the option that already won', () => {
  it('VISIBLE run, user names the CURRENT LEADER ⇒ told so, not refused', async () => {
    const out = await handler(
      makeInvocation({
        flipTargetOption: HIRE,
        // No row can ever name the leader as alternative winner, so without the
        // leader check this turn refused about the option that had already won.
        flipSummary: { ...FLIPS_TO_HIRE, entries: [] as FlipSummary['entries'] },
        leadingOptionId: HIRE.id,
        mayNameLeadingOption: true,
        sonnetValid: true,
      }),
    );
    expect(out.assistant_text).toContain('is already the leading option');
    expect(out.assistant_text).not.toContain('in favour of');
    expect(out.assistant_text).not.toContain('Testing two or more factors together');
  });

  it('WITHHELD run, user names the HIDDEN LEADER ⇒ places it nowhere (the 1/N case)', async () => {
    const out = await handler(
      makeInvocation({
        flipTargetOption: HIRE,
        flipSummary: { ...FLIPS_TO_HIRE, entries: [] as FlipSummary['entries'] },
        leadingOptionId: HIRE.id,
        mayNameLeadingOption: false,
        sonnetValid: true,
      }),
    );
    // Neither asserts it trails …
    expect(out.assistant_text).not.toContain('in favour of');
    // … nor confirms it leads.
    expect(out.assistant_text).not.toContain('is already the leading option');
    expect(out.assistant_text).toContain(
      'cannot say where Hire Two Senior Engineers Locally stands',
    );
  });

  it('WITHHELD run: naming the hidden leader is INDISTINGUISHABLE from naming a no-flip option', async () => {
    const emptyRows = { ...FLIPS_TO_HIRE, entries: [] as FlipSummary['entries'] };
    const asLeader = await handler(
      makeInvocation({
        flipTargetOption: HIRE,
        flipSummary: emptyRows,
        leadingOptionId: HIRE.id,
        mayNameLeadingOption: false,
      }),
    );
    const asNonLeader = await handler(
      makeInvocation({
        flipTargetOption: HIRE,
        flipSummary: emptyRows,
        leadingOptionId: 'opt_status_quo',
        mayNameLeadingOption: false,
      }),
    );
    expect(asLeader.assistant_text).toBe(asNonLeader.assistant_text);
  });
});

describe('NO named option ⇒ existing behaviour, untouched', () => {
  it('Sonnet keeps the answer verbatim', async () => {
    const out = await handler(makeInvocation({ flipTargetOption: null, sonnetValid: true }));
    expect(out.assistant_text).toContain('Sonnet wrote this answer');
    const fact = out.handler_facts[0] as { result: Record<string, unknown> };
    expect(fact.result.answer_source).toBe('sonnet');
  });

  it('the deterministic composer keeps the generic prose', async () => {
    const out = await handler(makeInvocation({ flipTargetOption: null, sonnetValid: false }));
    expect(out.assistant_text).toContain('currently leads');
    expect(out.assistant_text).toContain('would lead instead');
  });
});

describe('NO flip evidence ⇒ existing behaviour, even with a named option', () => {
  it('a named option with no flip data does not manufacture an answer', async () => {
    const withTarget = await handler(
      makeInvocation({ flipTargetOption: OFFSHORE, flipSummary: null, sonnetValid: true }),
    );
    const without = await handler(
      makeInvocation({ flipTargetOption: null, flipSummary: null, sonnetValid: true }),
    );
    expect(withTarget.assistant_text).toBe(without.assistant_text);
    expect(withTarget.assistant_text).toContain('Sonnet wrote this answer');
  });
});
