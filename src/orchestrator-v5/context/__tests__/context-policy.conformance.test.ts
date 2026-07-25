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
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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
  POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
  POLICY_EDIT_GRAPH_JSON_CAP,
  POLICY_EDIT_CONVERSATION_CAP,
  type ContextCallSite,
  type ContextPolicyTripwireLogger,
} from '../context-policy.js';
import { projectDecisionRecords } from '../../decision-records/project.js';
import { DRAFT_ATTACHMENT_MAX_BYTES } from '../../../adapters/llm/draft-attachment.js';

import { runStageCoachingPass } from '../../../cee/unified-pipeline/stages/coaching-pass.js';
import * as telemetry from '../../../utils/telemetry.js';
import type { StageContext } from '../../../cee/unified-pipeline/types.js';

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
  EDIT_CONTEXT_GRAPH_JSON_DEFAULT_BYTES,
  EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS,
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
  // egress-F5 (2026-07-24): the two edit-cap replicas were docstring-claimed to
  // equal the serialise defaults but NOT pinned — a fail-silent telemetry_only
  // mirror. Now pinned to the exported single source.
  it('POLICY_EDIT_GRAPH_JSON_CAP === EDIT_CONTEXT_GRAPH_JSON_DEFAULT_BYTES', () => {
    expect(POLICY_EDIT_GRAPH_JSON_CAP).toBe(EDIT_CONTEXT_GRAPH_JSON_DEFAULT_BYTES);
  });
  it('POLICY_EDIT_CONVERSATION_CAP === EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS', () => {
    expect(POLICY_EDIT_CONVERSATION_CAP).toBe(EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS);
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

  it('draft_graph maps to draft_structural; brief stays uncapped but attached_document is enforced (D-59-7)', () => {
    // P4 mapped draft_graph → draft_structural. brief is telemetry_only (char_budget
    // null → not in the derived view). D-59-7 added attached_document — the ONLY
    // enforced draft section, DERIVED from DRAFT_ATTACHMENT_MAX_BYTES (the same
    // fail-closed cap), so the derived view now carries exactly that one bound.
    expect(derived.draft_graph).toEqual({
      sections: { attached_document: DRAFT_ATTACHMENT_MAX_BYTES },
      total: null,
    });
  });

  it('draft_coaching (the post-draft pass) is instrumented-only too', () => {
    expect(derived.draft_coaching).toEqual({ sections: {}, total: null });
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
// coach_converse older_relevant_facts (P6) — knowledge-over-time read slice
// ---------------------------------------------------------------------------

describe('coach_converse older_relevant_facts — the P6 read slice is declared, enforced, derived', () => {
  const section = CONTEXT_POLICY.coach_converse.sections.find((s) => s.name === 'older_relevant_facts');

  it('is a MODEL-FACING, ENFORCED section (no longer an unpopulated reservation)', () => {
    expect(section).toBeDefined();
    expect(section!.model_facing).toBe(true);
    expect(section!.enforcement).toBe('enforced');
    expect(section!.source).toBe('decision_records');
  });

  it('its budget is DERIVED from the SAME constant the projection cuts at (derive-don\'t-mirror)', () => {
    // The policy row and projectDecisionRecords both key on this ONE constant,
    // so the declared ceiling and the live cut can never drift.
    expect(section!.char_budget).toBe(POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET);
    // Proof the projection actually honours it (the enforced cut discriminates):
    const many = Array.from({ length: 8 }, (_, i) => ({
      record_id: `r${i}`,
      scenario_id: 'scen',
      created_at: `2026-07-0${i + 1}T00:00:00Z`,
      decision: { chosen_option_label: `Option ${i}`, chosen_option_id: 'o', graph_hash: 'x' },
      prediction: { statement: 'z'.repeat(400), confidence_source: 'model_derived' },
    }));
    const projected = projectDecisionRecords(many, POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET, many.length)!;
    expect(projected.text.length).toBeLessThanOrEqual(POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET);
    expect(projected.truncated).toBe(true); // the cut fired
    // ...but be precise about WHICH cut: at 8 records the RATIONALE cap is the
    // only thing that can fire (RATIONALE_LINE_CHAR_CAP bounds each line, so 8
    // records cannot overflow 3000 chars on rationale alone). Asserting
    // `truncated` here without naming the cut is how a blind control reads as
    // green — the measurement lane's C1 finding, 2026-07-25.
    expect(projected.includedCount).toBe(8);
    expect(projected.totalCount).toBe(8);
    expect(projected.text).not.toContain('INCOMPLETE'); // no RECORD was dropped
    expect(projected.text).toContain('…'); // a rationale WAS cut
  });

  it('it is declared ABOVE conversation_summary among model-facing sections (facts beat summary)', () => {
    const modelFacing = CONTEXT_POLICY.coach_converse.sections.filter((s) => s.model_facing).map((s) => s.name);
    expect(modelFacing.indexOf('older_relevant_facts')).toBeLessThan(modelFacing.indexOf('conversation_summary'));
  });

  it('OBSERVED — a pack WITH the read slice serialises older_relevant_facts among declared keys; WITHOUT it the key is ABSENT (byte-identity)', () => {
    const withFacts = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: 'scen-p6', message: 'what should I do?' }),
      priorTurns: [],
      priorFacts: [],
      analysis: ANCHOR_ANALYSIS,
      brief: ANCHOR_BRIEF,
      olderRelevantFacts: 'Prior decisions recorded on this scenario (most recent first):\n- [2026-07-01] Chose "Bootstrap": keep runway',
    });
    const observedWith = observeSerialisedKeys(buildUserMessage(withFacts, 'what should I do?'));
    expect(observedWith).toContain('older_relevant_facts');
    // still a subsequence of the declared model-facing order
    expect(isSubsequence(observedWith, modelFacingSectionKeys('coach_converse'))).toBe(true);

    // WITHOUT records → the pack key is absent (record-less scenarios byte-identical).
    const withoutFacts = assembleAnchorPack();
    const observedWithout = observeSerialisedKeys(buildUserMessage(withoutFacts, 'what should I do?'));
    expect(observedWithout).not.toContain('older_relevant_facts');
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

  it('F10 — chip_run declares its conditional decision_review delegation; clarify is unconditionally deterministic', () => {
    // chip_run's dispatch is deterministic, but under the await flag it delegates
    // ONE decision_review child call — declared so llm:false is honest across config.
    expect(CONTEXT_POLICY.chip_run.conditional_llm_delegation).toEqual({
      flag: 'V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW',
      child_call_site: 'decision_review',
    });
    // The delegated child MUST be a real, llm:true call site.
    expect(CONTEXT_POLICY[CONTEXT_POLICY.chip_run.conditional_llm_delegation!.child_call_site].llm).toBe(true);
    // clarify has no such delegation — it is unconditionally zero-LLM.
    expect(CONTEXT_POLICY.clarify.conditional_llm_delegation).toBeUndefined();
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
      missing_sections: [],
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

  it('draft_graph (now → draft_structural) is silent on its declared uncapped brief', () => {
    // P4 mapped it: an uncapped brief of ANY size is declared telemetry_only,
    // so it never flags — but a section the policy does not declare IS seen.
    expect(
      findContextPolicyDivergences('draft_graph', { brief: 500_000 }),
    ).toEqual({ unknown_sections: [], over_budget_sections: [], missing_sections: [] });
    expect(
      findContextPolicyDivergences('draft_graph', { brief: 1_000, mystery: 42 }).unknown_sections,
    ).toEqual(['mystery']); // POSITIVE CONTROL — a stray section on the draft site is seen
  });

  it('draft_coaching is silent on its declared brief + graph, but sees a stray', () => {
    expect(
      findContextPolicyDivergences('draft_coaching', { brief: 400_000, graph: 90_000 }),
    ).toEqual({ unknown_sections: [], over_budget_sections: [], missing_sections: [] });
    expect(
      findContextPolicyDivergences('draft_coaching', { brief: 10, graph: 10, causal: 5 }).unknown_sections,
    ).toEqual(['causal']);
  });

  it('a truly unmapped call site yields no divergence', () => {
    expect(findContextPolicyDivergences('some_future_site', { anything: 9_999 })).toEqual({
      unknown_sections: [],
      over_budget_sections: [],
      missing_sections: [],
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

  it('POSITIVE CONTROL (egress-F3) — an always_expected section that went dark (under-emit) is SEEN', () => {
    // edit_graph declares graph_json always_expected (a graph is always present
    // on an edit turn). Present → clean.
    expect(
      findContextPolicyDivergences('edit_graph', {
        brief: 500,
        graph_json: 1_200,
        conversation: 300,
      }).missing_sections,
    ).toEqual([]);
    // Suppress graph_json (the section silently stopped being emitted) → under-emit fires.
    expect(
      findContextPolicyDivergences('edit_graph', { brief: 500, conversation: 300 }).missing_sections,
    ).toEqual(['graph_json']);
    // A legitimately-conditional absence (conversation on a first edit) stays SILENT —
    // only always_expected sections are absence-checked.
    expect(
      findContextPolicyDivergences('edit_graph', { brief: 500, graph_json: 1_200 }).missing_sections,
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

  it('POSITIVE CONTROL (egress-F3) — fires an UNDER-emit event when an always_expected section is absent, silent when present', () => {
    // Suppress graph_json on an edit turn → one under-emit event.
    const { calls, logger } = fakeLogger();
    emitContextPolicyDivergence('edit_graph', { brief: 500, conversation: 300 }, 800, 'req-x', 'scn-x', logger);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.missing_section_count).toBe(1);
    expect(calls[0].payload.missing_sections).toEqual(['graph_json']);
    // Revert: include graph_json → clean, silent (the divergence clears).
    const { calls: calls2, logger: logger2 } = fakeLogger();
    emitContextPolicyDivergence(
      'edit_graph',
      { brief: 500, graph_json: 1_200, conversation: 300 },
      2_000,
      'req-y',
      'scn-y',
      logger2,
    );
    expect(calls2).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// Namesake-twin kill (P4) — exactly ONE exported assembleContextPack repo-wide
// ---------------------------------------------------------------------------

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'); // → src/

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Matches an EXPORTED definition of `assembleContextPack` (function or const),
 *  not a re-export/alias/import — the DEFINITION is the symbol's identity. */
const EXPORT_ASSEMBLE_DEF_RE =
  /^export\s+(?:async\s+)?function\s+assembleContextPack\b|^export\s+const\s+assembleContextPack\b/m;

describe('namesake-twin kill — assembleContextPack resolves to exactly ONE exported symbol', () => {
  it('exactly one exported assembleContextPack DEFINITION exists in src/ (the V5 model-facing one)', () => {
    const defs = walkTsFiles(SRC_ROOT)
      .filter((f) => EXPORT_ASSEMBLE_DEF_RE.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(f.indexOf('/src/') + 1).replace(/\\/g, '/'));
    // RED at c930f05c (two defs: the V5 assembler + the draft-provenance twin);
    // GREEN after the twin was renamed to assembleDraftProvenanceDescriptor.
    // A future re-collision (a second exported def) turns this RED again.
    expect(defs).toEqual(['src/orchestrator-v5/context/context-pack-assembler.ts']);
  });

  it('the draft-provenance builder is exported under its DISAMBIGUATED name only', () => {
    const draftFile = join(SRC_ROOT, 'context/context-pack.ts');
    const body = readFileSync(draftFile, 'utf8');
    expect(body).toContain('export function assembleDraftProvenanceDescriptor');
    expect(body).toContain('export interface DraftProvenanceDescriptor');
    expect(body).not.toMatch(/export\s+(?:async\s+)?function\s+assembleContextPack\b/);
    expect(body).not.toMatch(/export\s+interface\s+ContextPackV1\b/);
    // egress-F4 (2026-07-24): the draft-side INPUT type must not resurrect the
    // `AssembleContextPackInput` name (the V5 assembler owns it); it carries the
    // disambiguated `AssembleDraftProvenanceInput`.
    expect(body).toContain('export interface AssembleDraftProvenanceInput');
    expect(body).not.toMatch(/export\s+interface\s+AssembleContextPackInput\b/);
  });

  it('exactly one exported AssembleContextPackInput DEFINITION exists in src/ (the V5 assembler)', () => {
    // egress-F4 (2026-07-24): pin the input-type name to a single owner, the same
    // way the function name is pinned — a second same-named exported interface is
    // the type-twin the #662 P4 kill claimed to close but left open.
    const INPUT_DEF_RE = /^export\s+interface\s+AssembleContextPackInput\b/m;
    const defs = walkTsFiles(SRC_ROOT)
      .filter((f) => INPUT_DEF_RE.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(f.indexOf('/src/') + 1).replace(/\\/g, '/'));
    expect(defs).toEqual(['src/orchestrator-v5/context/context-pack-assembler.ts']);
  });
});

// ---------------------------------------------------------------------------
// Draft rows (P4) — structural + coaching are declared, telemetry_only, observed
// ---------------------------------------------------------------------------

describe('draft rows — declared, no false enforced, memory-window-less', () => {
  for (const site of ['draft_structural', 'draft_coaching'] as const) {
    it(`${site} is an LLM row with NO conversation window and NO total budget`, () => {
      const row = CONTEXT_POLICY[site];
      expect(row.llm).toBe(true);
      expect(row.memory_window).toBeNull();
      expect(row.total_char_budget).toBeNull();
      // The draft prose sections (brief / graph) are the least-budgeted assembler:
      // no per-section prose cut site, so none may claim a false `enforced`. The
      // ONE exception is draft_structural's attached_document — it has a REAL
      // fail-closed cut site (DRAFT_ATTACHMENT_MAX_BYTES), so `enforced` there is
      // TRUE, not theatre. Every OTHER section stays telemetry_only + null.
      for (const s of row.sections) {
        if (s.name === 'attached_document') continue;
        expect(s.enforcement).toBe('telemetry_only');
        expect(s.char_budget).toBeNull();
      }
    });
  }

  it('draft_structural.attached_document is a TRUE enforced section derived from the fail-closed cap (D-59-7)', () => {
    const doc = CONTEXT_POLICY.draft_structural.sections.find((s) => s.name === 'attached_document');
    expect(doc).toBeDefined();
    // Enforced because buildDraftDocumentBlock throws a 4xx on oversize BEFORE the
    // call — a real cut site — and the budget is the SAME constant (derive, not mirror).
    expect(doc?.enforcement).toBe('enforced');
    expect(doc?.char_budget).toBe(DRAFT_ATTACHMENT_MAX_BYTES);
    expect(doc?.model_facing).toBe(true);
    // CONDITIONAL: absent on a brief-only draft, so it must NOT be always_expected
    // (else a healthy no-document draft would false-fire the under-emit tripwire).
    expect(doc?.always_expected).not.toBe(true);
  });

  it('draft_structural declares the structural emit key (brief), matching draft-graph-dispatch:489', () => {
    const declared = declaredSectionNames('draft_structural');
    expect(declared.has('brief')).toBe(true);
  });

  it('draft_coaching declares the coaching-pass emit keys (brief + structure-only graph)', () => {
    const declared = declaredSectionNames('draft_coaching');
    for (const key of ['brief', 'graph']) {
      expect(declared.has(key), `${key} emitted by the coaching pass but not declared`).toBe(true);
    }
  });
});

describe('draft_coaching — OBSERVED against the live coaching-pass emit', () => {
  it('the real runStageCoachingPass emits section_chars whose keys == the declared draft_coaching sections', async () => {
    const captured: Array<{ event: unknown; payload: Record<string, unknown> }> = [];
    const emitSpy = vi
      .spyOn(telemetry, 'emit')
      .mockImplementation((event: unknown, payload: unknown) => {
        captured.push({ event, payload: payload as Record<string, unknown> });
      });

    const brief = 'Should we hire locally or offshore? Budget £250k.';
    // A node carrying a NON-structural field: the structure-only projection must
    // DROP it, so the observed `graph` chars are strictly less than the full graph.
    const graph = {
      nodes: [
        { id: 'dec', kind: 'decision', label: 'Hire?', rationale: 'x'.repeat(500) },
        { id: 'goal', kind: 'goal', label: 'Revenue' },
      ],
      edges: [{ from: 'dec', to: 'goal', weight: 0.7, belief: 0.9 }],
    };
    let seenUserMessage = '';
    const fakeAdapter = {
      chat: async (args: { userMessage: string }) => {
        seenUserMessage = args.userMessage;
        return {
          content: '{"coaching":null,"causal_claims":[]}',
          model: 'test-coaching-model',
          usage: { input_tokens: 20, output_tokens: 8 },
        };
      },
    };
    const ctx = {
      coaching: undefined,
      draftAdapter: fakeAdapter,
      graph,
      opts: { requestStartMs: Date.now(), signal: undefined },
      start: Date.now(),
      effectiveBrief: brief,
      requestId: 'req-draft-coaching-conformance',
      input: { scenario_id: 'scen-draft-coaching' },
      pipelineOutcome: {},
    } as unknown as StageContext;

    await runStageCoachingPass(ctx);
    emitSpy.mockRestore();

    const budgetEvents = captured.filter(
      (c) => (c.payload as { call_site?: string }).call_site === 'draft_coaching',
    );
    expect(budgetEvents).toHaveLength(1);
    const sectionChars = budgetEvents[0].payload.section_chars as Record<string, number>;

    // OBSERVED keys == DECLARED keys (derive-don't-mirror: the emit is the source).
    const declared = declaredSectionNames('draft_coaching');
    for (const key of Object.keys(sectionChars)) {
      expect(declared.has(key), `emitted ${key} not declared`).toBe(true);
    }
    expect(new Set(Object.keys(sectionChars))).toEqual(new Set(['brief', 'graph']));

    // brief chars are the verbatim brief; graph chars are the STRUCTURE-ONLY
    // projection (< the full graph JSON — the 500-char rationale was dropped).
    expect(sectionChars.brief).toBe(brief.length);
    expect(sectionChars.graph).toBeLessThan(JSON.stringify(graph).length);
    // POSITIVE CONTROL: the actual message the model saw carries BRIEF + GRAPH
    // markers and NOT the dropped non-structural field.
    expect(seenUserMessage).toContain('BRIEF:');
    // F11 (2026-07-24): the graph header now carries the untrusted-data note;
    // assert the stable prefix so the conformance is not coupled to the wording.
    expect(seenUserMessage).toContain('GRAPH (structure only');
    expect(seenUserMessage).toContain('[BEGIN_UNTRUSTED_GRAPH_DATA]');
    expect(seenUserMessage).not.toContain('rationale');

    // And a realistic emit produces ZERO policy divergence (acceptance (1)).
    expect(findContextPolicyDivergences('draft_coaching', sectionChars)).toEqual({
      unknown_sections: [],
      over_budget_sections: [],
      missing_sections: [],
    });
  });
});

// ---------------------------------------------------------------------------
// No false `enforced` anywhere (P5 budget-honesty invariant, all rows)
// ---------------------------------------------------------------------------

describe('budget honesty — every `enforced` section is backed by an importable/pinned ceiling', () => {
  it('no section claims `enforced` without a non-null char_budget (a false guarantee)', () => {
    for (const site of Object.keys(CONTEXT_POLICY) as ContextCallSite[]) {
      for (const s of CONTEXT_POLICY[site].sections) {
        if (s.enforcement === 'enforced') {
          expect(
            s.char_budget,
            `${site}.${s.name} is enforced but carries no budget ceiling`,
          ).not.toBeNull();
        }
      }
    }
  });
});
