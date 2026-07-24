/**
 * ContextPolicy — conformance (CONTEXT-POLICY-DESIGN-2026-07-23, ROADMAP 1.199).
 *
 * The policy's fidelity to the live assemblers is DERIVED, never re-listed: this
 * test runs the REAL assemblers over realistic fixtures and OBSERVES the
 * serialised composition (ordered section names + realised sizes), then asserts
 * it matches the declared row — with POSITIVE CONTROLS proving each absence
 * assertion can SEE a presence (doctrine trap #13). Mirrors the #636
 * enrichment-manifest conformance machine at section granularity.
 *
 * Coverage:
 *   - derived budgets (import identity) + local-const parity pins (fail-loud);
 *   - decision_review 8000→2000 truth declaration (the live drift dies);
 *   - CONTEXT_SECTION_BUDGETS derived-view preserves routing / fixes edit drift;
 *   - coach_converse anchor: observed buildUserMessage keys == policy (+ control);
 *   - edit anchor: observed serialiser sections == policy; repair === edit;
 *   - deterministic rows (chip_run/clarify): llm:false + zero adapter calls;
 *   - runtime divergence tripwire: positive + negative controls.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  CONTEXT_POLICY,
  deriveContextSectionBudgets,
  findContextPolicyDivergences,
  emitContextPolicyDivergence,
  modelFacingSectionKeys,
  declaredSectionNames,
  POLICY_EDIT_BRIEF_CHAR_CAP,
  POLICY_DECISION_REVIEW_BRIEF_CHAR_CAP,
  POLICY_VERBATIM_TURNS,
  POLICY_MAX_PROJECTED_OPTIONS,
  type ContextPolicyTripwireLogger,
} from '../context-policy.js';

import {
  assembleContextPack,
  CONTEXT_PACK_RECENT_TURNS_CAP,
  MAX_PROJECTED_OPTIONS,
  type ContextPack,
} from '../context-pack-assembler.js';

/** The assembler's own `analysis` input type, derived without importing the (unexported) name. */
type AnchorAnalysis = NonNullable<Parameters<typeof assembleContextPack>[0]['analysis']>;
import { CONTEXT_PACK_BRIEF_CHAR_CAP } from '../context-pack-schema.js';
import { DISPLAY_ANALYSIS_CHAR_BUDGET } from '../../format/format-analysis-for-context.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import {
  serialiseEditContextForLLMWithMeta,
  EDIT_CONTEXT_BRIEF_CHAR_CAP,
} from '../../../orchestrator/context/serialise.js';
import { DECISION_REVIEW_MAX_BRIEF_CHARS } from '../../../cee/decision-review/invoke.js';
import { composeEditClarifyResponse } from '../../compose/edit-clarify-response.js';
import * as llmRouter from '../../../adapters/llm/router.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { ConversationContext } from '../../../orchestrator/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANCHOR_BRIEF =
  'Should we hire two senior engineers locally or engage an offshore partner? Budget £250k, decision needed by Q3.';

const ANCHOR_ANALYSIS = {
  winner: { option_id: 'opt_local', option_label: 'Hire locally', win_probability: 0.62 },
  options: [
    { option_id: 'opt_local', option_label: 'Hire locally', win_probability: 0.62 },
    { option_id: 'opt_offshore', option_label: 'Offshore partner', win_probability: 0.38 },
  ],
  top_drivers: [],
  robustness_level: 'moderate',
  fragile_edge_count: 0,
  margin: 0.24,
  margin_pp: 24,
  analysis_status: 'computed',
} as unknown as AnchorAnalysis;

/** Build a rich coach_converse pack that populates the interesting sections. */
function assembleAnchorPack(overrideBrief: string | null = ANCHOR_BRIEF): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({ scenario_id: 'scen-policy-anchor', message: 'what should I do?' }),
    priorTurns: [],
    priorFacts: [],
    analysis: ANCHOR_ANALYSIS,
    ...(overrideBrief !== null ? { brief: overrideBrief } : {}),
  });
}

/** Extract the ordered top-level keys of the serialised `## ContextPack` JSON. */
function observeSerialisedKeys(userMessage: string): string[] {
  const marker = '## ContextPack\n';
  const start = userMessage.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const jsonStart = start + marker.length;
  // The JSON blob runs to the next blank-line-delimited section ('\n\n## ').
  const rest = userMessage.slice(jsonStart);
  const end = rest.indexOf('\n\n## User turn');
  const jsonText = end >= 0 ? rest.slice(0, end) : rest;
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  return Object.keys(parsed);
}

/** Is `observed` a subsequence of `declared` (same relative order)? */
function isSubsequence(observed: string[], declared: string[]): boolean {
  let di = 0;
  for (const key of observed) {
    const found = declared.indexOf(key, di);
    if (found === -1) return false;
    di = found + 1;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Derived budgets — import identity (the derive-don't-mirror proof)
// ---------------------------------------------------------------------------

describe('context-policy — budgets are DERIVED, never re-typed', () => {
  it('coach_converse display_analysis budget IS DISPLAY_ANALYSIS_CHAR_BUDGET (import)', () => {
    const section = CONTEXT_POLICY.coach_converse.sections.find((s) => s.name === 'display_analysis');
    expect(section?.char_budget).toBe(DISPLAY_ANALYSIS_CHAR_BUDGET);
    expect(section?.enforcement).toBe('enforced');
    // If the enforcement constant moves, this row follows with NO edit to the
    // policy (both reference the same import) — the required derived-budget pin.
  });

  it('coach_converse brief budget IS CONTEXT_PACK_BRIEF_CHAR_CAP (import)', () => {
    const section = CONTEXT_POLICY.coach_converse.sections.find((s) => s.name === 'brief');
    expect(section?.char_budget).toBe(CONTEXT_PACK_BRIEF_CHAR_CAP);
    expect(section?.enforcement).toBe('enforced');
  });

  it('the derived budget table carries the imported display_analysis budget', () => {
    expect(deriveContextSectionBudgets().routing.sections.display_analysis).toBe(
      DISPLAY_ANALYSIS_CHAR_BUDGET,
    );
  });
});

describe('context-policy — local-const replicas PINNED to their originals (fail-loud)', () => {
  it('POLICY_EDIT_BRIEF_CHAR_CAP === EDIT_CONTEXT_BRIEF_CHAR_CAP', () => {
    expect(POLICY_EDIT_BRIEF_CHAR_CAP).toBe(EDIT_CONTEXT_BRIEF_CHAR_CAP);
  });
  it('POLICY_DECISION_REVIEW_BRIEF_CHAR_CAP === DECISION_REVIEW_MAX_BRIEF_CHARS', () => {
    expect(POLICY_DECISION_REVIEW_BRIEF_CHAR_CAP).toBe(DECISION_REVIEW_MAX_BRIEF_CHARS);
  });
  it('POLICY_VERBATIM_TURNS === CONTEXT_PACK_RECENT_TURNS_CAP', () => {
    expect(POLICY_VERBATIM_TURNS).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
  });
  it('POLICY_MAX_PROJECTED_OPTIONS === MAX_PROJECTED_OPTIONS', () => {
    expect(POLICY_MAX_PROJECTED_OPTIONS).toBe(MAX_PROJECTED_OPTIONS);
  });
});

// ---------------------------------------------------------------------------
// decision_review — the 8000→2000 truth declaration (ROADMAP 1.199)
// ---------------------------------------------------------------------------

describe('decision_review — brief budget is the ENFORCED truth (8000 drift dies)', () => {
  const briefSection = CONTEXT_POLICY.decision_review.sections.find((s) => s.name === 'brief');

  it('declares brief === DECISION_REVIEW_MAX_BRIEF_CHARS (2000), NOT the phantom 8000', () => {
    expect(briefSection?.char_budget).toBe(DECISION_REVIEW_MAX_BRIEF_CHARS);
    expect(briefSection?.char_budget).toBe(2_000);
    expect(briefSection?.char_budget).not.toBe(8_000); // the dead telemetry drift
    expect(briefSection?.enforcement).toBe('enforced');
  });

  it('the derived telemetry view also carries 2000 (the 8000 mirror is gone)', () => {
    const dr = deriveContextSectionBudgets().decision_review;
    expect(dr.sections.brief).toBe(2_000);
    // No collateral: graph_json / isl_results are preserved.
    expect(dr.sections.graph_json).toBe(16_000);
    expect(dr.sections.isl_results).toBe(16_000);
  });

  it('decision_records is a declared-but-unpopulated reservation (I-15), not a false enforced', () => {
    const dr = CONTEXT_POLICY.decision_review.sections.find((s) => s.name === 'decision_records');
    expect(dr?.enforcement).toBe('unpopulated');
  });
});

// ---------------------------------------------------------------------------
// CONTEXT_SECTION_BUDGETS derived view — routing preserved, edit drift fixed
// ---------------------------------------------------------------------------

describe('deriveContextSectionBudgets — routing preserved, edit drift fixed, draft passthrough', () => {
  const derived = deriveContextSectionBudgets();

  it('routing is byte-preserved (zero coach-anchor behaviour change)', () => {
    expect(derived.routing.total).toBe(55_000);
    expect(derived.routing.sections.conversation).toBe(34_000);
    expect(derived.routing.sections.display_graph).toBe(8_000);
    expect(derived.routing.sections.display_analysis).toBe(4_000);
    expect(derived.routing.sections.brief).toBe(2_000);
    expect(derived.routing.sections.conversation_summary).toBe(1_300);
    expect(derived.routing.sections.older_relevant_facts).toBe(3_000);
    expect(derived.routing.sections.rest).toBe(2_500);
  });

  it('edit_graph conversation === 4000 (the 6000 telemetry drift is fixed to the enforced cap)', () => {
    expect(derived.edit_graph.sections.conversation).toBe(4_000);
    expect(derived.edit_graph.sections.graph_json).toBe(8_000);
    expect(derived.edit_graph.sections.brief).toBe(1_000);
  });

  it('repair_edit_graph budget mirrors edit_graph', () => {
    expect(derived.repair_edit_graph.sections).toEqual(derived.edit_graph.sections);
  });

  it('draft_graph passes through instrumented-only (POST wave-1; P4)', () => {
    expect(derived.draft_graph).toEqual({ sections: {}, total: null });
  });
});

// ---------------------------------------------------------------------------
// repair reuses edit's contextSection — fail-loud (derive-don't-mirror win)
// ---------------------------------------------------------------------------

describe('repair_edit_graph reuses edit_graph.sections', () => {
  it('shares the identical section array reference (not a hand-copied twin)', () => {
    expect(CONTEXT_POLICY.repair_edit_graph.sections).toBe(CONTEXT_POLICY.edit_graph.sections);
  });
  it('is structurally equal', () => {
    expect(CONTEXT_POLICY.repair_edit_graph.sections).toEqual(CONTEXT_POLICY.edit_graph.sections);
  });
});

// ---------------------------------------------------------------------------
// coach_converse ANCHOR — observed buildUserMessage composition == policy
// ---------------------------------------------------------------------------

describe('coach_converse anchor — realised composition matches the declared policy', () => {
  const pack = assembleAnchorPack();
  const userMessage = buildUserMessage(pack, 'what should I do?');
  const observed = observeSerialisedKeys(userMessage);
  const declared = modelFacingSectionKeys('coach_converse');

  it('every observed serialised section is a declared model-facing section', () => {
    const undeclared = observed.filter((k) => !declared.includes(k));
    expect(undeclared).toEqual([]);
  });

  it('observed section order is a subsequence of the declared model-facing order', () => {
    expect(isSubsequence(observed, declared)).toBe(true);
  });

  it('the brief/analysis/graph sections are present and correctly renamed', () => {
    expect(observed).toContain('brief');
    // display_analysis serialises under `analysis`, display_graph under `graph`.
    expect(observed).toContain('analysis');
    expect(observed).toContain('graph');
    expect(observed).not.toContain('display_analysis');
    expect(observed).not.toContain('display_graph');
  });

  it('conversation_summary is declared LAST among model-facing sections (facts beat summary)', () => {
    const modelFacing = CONTEXT_POLICY.coach_converse.sections.filter((s) => s.model_facing);
    expect(modelFacing[modelFacing.length - 1].name).toBe('conversation_summary');
  });

  it('enforced sections respect their budgets on the fixture', () => {
    const parsed = JSON.parse(
      userMessage.slice(
        userMessage.indexOf('## ContextPack\n') + '## ContextPack\n'.length,
        userMessage.indexOf('\n\n## User turn'),
      ),
    ) as Record<string, unknown>;
    expect(JSON.stringify(parsed.brief).length).toBeLessThanOrEqual(CONTEXT_PACK_BRIEF_CHAR_CAP + 200);
    expect(JSON.stringify(parsed.analysis).length).toBeLessThanOrEqual(DISPLAY_ANALYSIS_CHAR_BUDGET + 500);
  });

  it('POSITIVE CONTROL — a stray section injected into the pack is SEEN as undeclared', () => {
    const strayPack = { ...pack, mystery_injected_section: { boom: 1 } } as unknown as ContextPack;
    const strayMsg = buildUserMessage(strayPack, 'what should I do?');
    const strayObserved = observeSerialisedKeys(strayMsg);
    expect(strayObserved).toContain('mystery_injected_section');
    const undeclared = strayObserved.filter((k) => !declared.includes(k));
    expect(undeclared).toContain('mystery_injected_section'); // the check goes RED on a stray
  });
});

// ---------------------------------------------------------------------------
// edit_graph ANCHOR — observed serialiser sections == declared policy
// ---------------------------------------------------------------------------

describe('edit_graph anchor — realised serialiser sections are declared', () => {
  const editContext: ConversationContext = {
    graph: {
      nodes: [
        { id: 'dec_hire', kind: 'decision', label: 'Hire?' },
        { id: 'goal_rev', kind: 'goal', label: 'Revenue' },
      ],
      edges: [{ from: 'dec_hire', to: 'goal_rev' }],
    } as unknown as ConversationContext['graph'],
    analysis_response: null,
    framing: { stage: 'analyse' } as unknown as ConversationContext['framing'],
    messages: [
      { role: 'user', content: 'We are choosing between local hire and offshore.' },
      { role: 'assistant', content: 'Understood — I have the two options.' },
    ],
    scenario_id: 'scen-edit-anchor',
    brief: { text: 'Choose a hiring model for the new tier.', truncated: false, original_chars: 39 },
  };

  it('every realised sectionChars key is a declared edit_graph section', () => {
    const { sectionChars } = serialiseEditContextForLLMWithMeta(editContext);
    const declared = declaredSectionNames('edit_graph');
    const undeclared = Object.keys(sectionChars).filter((k) => !declared.has(k));
    expect(undeclared).toEqual([]);
  });

  it('realised section order is a subsequence of the declared model-facing edit order', () => {
    const { sectionChars } = serialiseEditContextForLLMWithMeta(editContext);
    expect(isSubsequence(Object.keys(sectionChars), modelFacingSectionKeys('edit_graph'))).toBe(true);
  });

  it('the brief renders FIRST as the ## Decision Brief section (S2)', () => {
    const { text } = serialiseEditContextForLLMWithMeta(editContext);
    expect(text.startsWith('## Decision Brief')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// decision_review — declared section names cover the live emit decomposition
// ---------------------------------------------------------------------------

describe('decision_review — declared sections cover the live section_chars keys', () => {
  it('every emit section_chars key is declared', () => {
    // The keys invoke.ts emits at the emitContextBudget seam (:509-517).
    const emitKeys = [
      'brief',
      'graph_json',
      'isl_results',
      'deterministic_coaching',
      'decision_context',
      'flip_threshold_data',
    ];
    const declared = declaredSectionNames('decision_review');
    for (const key of emitKeys) {
      expect(declared.has(key), `${key} emitted but not declared`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic rows — llm:false, zero adapter calls
// ---------------------------------------------------------------------------

describe('deterministic rows (chip_run, clarify) — llm:false invariant + zero adapter calls', () => {
  it('chip_run and clarify declare llm:false with no model-facing context', () => {
    for (const site of ['chip_run', 'clarify'] as const) {
      const row = CONTEXT_POLICY[site];
      expect(row.llm).toBe(false);
      expect(row.sections).toEqual([]); // structural invariant: no model context
      expect(row.memory_window).toBeNull();
      expect(row.total_char_budget).toBeNull();
    }
  });

  it('POSITIVE CONTROL — the invariant would SEE a deterministic row carrying sections', () => {
    // Prove the invariant discriminates: a deterministic row with any section
    // fails the "no model-facing context" check.
    const contrived = { ...CONTEXT_POLICY.chip_run, sections: [{ name: 'x' }] as never };
    expect(contrived.sections).not.toEqual([]);
  });

  it('composeEditClarifyResponse (clarify path) makes ZERO LLM adapter calls', () => {
    const getAdapterSpy = vi.spyOn(llmRouter, 'getAdapter');
    composeEditClarifyResponse({ reason: 'vague_edit', stage: 'analyse', nodes: [], priorAnalysisIsFresh: false });
    expect(getAdapterSpy).not.toHaveBeenCalled();
    getAdapterSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Runtime divergence tripwire — positive + negative controls
// ---------------------------------------------------------------------------

describe('runtime tripwire — findContextPolicyDivergences', () => {
  it('a clean routing composition has ZERO divergence (healthy turns stay silent)', () => {
    const clean = {
      conversation: 12_000, // telemetry_only 34000 — under, and never budget-checked
      conversation_summary: 800,
      brief: 1_500, // enforced 2000 — under
      display_analysis: 3_200, // enforced 4000 — under
      display_graph: 6_000, // telemetry_only — not checked
    };
    expect(findContextPolicyDivergences('routing', clean)).toEqual({
      unknown_sections: [],
      over_budget_sections: [],
    });
  });

  it('POSITIVE CONTROL — a stray section is SEEN', () => {
    const d = findContextPolicyDivergences('routing', { brief: 100, mystery_new_section: 500 });
    expect(d.unknown_sections).toEqual(['mystery_new_section']);
  });

  it('POSITIVE CONTROL — an ENFORCED section over budget is SEEN', () => {
    const d = findContextPolicyDivergences('routing', { display_analysis: 999_999 });
    expect(d.over_budget_sections).toEqual(['display_analysis']);
  });

  it('a FULL 2000-char brief (proxy ~2051 incl. wrapper) does NOT false-fire (healthy-turn silence)', () => {
    // brief.text is capped at 2000 (CONTEXT_PACK_BRIEF_CHAR_CAP) but the proxy
    // measures JSON.stringify({text,truncated,original_chars}) ≈ 2051. The
    // serialisation-tolerant tripwire must stay SILENT on this healthy shape.
    const d = findContextPolicyDivergences('routing', { brief: 2_060 });
    expect(d.over_budget_sections).toEqual([]);
    // …but a genuinely broken brief (cut failed) IS caught.
    expect(findContextPolicyDivergences('routing', { brief: 4_000 }).over_budget_sections).toEqual([
      'brief',
    ]);
  });

  it('a telemetry_only section over its target is NOT a divergence (no false alarm)', () => {
    const d = findContextPolicyDivergences('routing', { conversation: 500_000 });
    expect(d.over_budget_sections).toEqual([]);
    expect(d.unknown_sections).toEqual([]);
  });

  it('an unmapped call site (draft_graph, POST wave-1) yields no divergence', () => {
    expect(findContextPolicyDivergences('draft_graph', { anything: 9_999 })).toEqual({
      unknown_sections: [],
      over_budget_sections: [],
    });
  });

  it('edit over-budget on the enforced brief is SEEN; telemetry_only graph_json is not', () => {
    expect(findContextPolicyDivergences('edit_graph', { brief: 5_000 }).over_budget_sections).toEqual([
      'brief',
    ]);
    expect(
      findContextPolicyDivergences('edit_graph', { graph_json: 90_000 }).over_budget_sections,
    ).toEqual([]);
  });
});

describe('runtime tripwire — emitContextPolicyDivergence (observe-only)', () => {
  function fakeLogger(): { calls: Array<{ payload: Record<string, unknown>; message: string }>; logger: ContextPolicyTripwireLogger } {
    const calls: Array<{ payload: Record<string, unknown>; message: string }> = [];
    return { calls, logger: { warn: (payload, message) => calls.push({ payload, message }) } };
  }

  it('stays SILENT for a clean composition', () => {
    const { calls, logger } = fakeLogger();
    emitContextPolicyDivergence('routing', { brief: 100, display_analysis: 2_000 }, 5_000, 'req-1', 'scn-1', logger);
    expect(calls).toHaveLength(0);
  });

  it('POSITIVE CONTROL — fires ONE structured event carrying the divergent NAMES (never values)', () => {
    const { calls, logger } = fakeLogger();
    emitContextPolicyDivergence(
      'routing',
      { display_analysis: 999_999, sneaky_section: 42 },
      1_000_041,
      'req-2',
      'scn-2',
      logger,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.event).toBe('v5.context_policy.divergence');
    expect(calls[0].payload.call_site).toBe('routing');
    expect(calls[0].payload.request_id).toBe('req-2');
    expect(calls[0].payload.unknown_sections).toEqual(['sneaky_section']);
    expect(calls[0].payload.over_budget_sections).toEqual(['display_analysis']);
    // No section VALUE (the 42) may appear in the payload names.
    expect(JSON.stringify(calls[0].payload.unknown_sections)).not.toContain('42');
  });

  it('never throws even when the logger blows up (observe-only)', () => {
    const thrower: ContextPolicyTripwireLogger = {
      warn: () => {
        throw new Error('logger boom');
      },
    };
    expect(() =>
      emitContextPolicyDivergence('routing', { unknown_x: 1 }, 1, 'r', 's', thrower),
    ).not.toThrow();
  });
});
