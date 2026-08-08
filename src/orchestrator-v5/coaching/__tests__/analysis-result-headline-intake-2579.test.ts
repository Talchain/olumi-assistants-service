/**
 * ROADMAP 2.579 — THE MEASURED HARM, AT THE SURFACE IT WAS MEASURED ON.
 *
 * Codex expert session, 5 Aug 2026, deployed staging, CEE `e82738b`
 * (`PHASE0-EVIDENCE-2026-07-28/expert-session-2026-08-05-raw/run3/`): a brief
 * that enumerated FIVE options produced a FOUR-option graph, and the analysis
 * shipped "Energy-Efficiency Retrofit currently leads by 9 percentage points"
 * over a candidate set it was missing a candidate from. `a new retail
 * concession` never got a chance to win.
 *
 * ⚠ THE DISCRIMINATING PAIR IS THE POINT OF THIS FILE, not the withhold on its
 * own (CLAUDE.md trap 19). Every `expect(text).toBeNull()` in the estate can be
 * satisfied by a headline builder that has simply stopped working. So each
 * withhold below is paired with a POSITIVE CONTROL that runs the SAME
 * enrichment through the SAME builder with the intake complete, and asserts the
 * leader is named BY NAME. A single green assertion proves nothing; the pair
 * proves the withhold is caused by the intake gap and by nothing else.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
  isAllowedRunAnalysisAssistantText,
  RUN_ANALYSIS_LOCKED_TEMPLATES,
} from '../analysis-result-headline.js';
import { buildIntakeOptionDisclosure } from '../intake-option-disclosure.js';
import {
  applyIntakeToLeaderPermission,
  deriveIntakeOptionReconciliation,
  readGraphOptionLabels,
} from '../../../orchestrator/context/intake-option-reconciliation.js';

/** Verbatim from the capture's driver (`expert-pass.mjs:5`). */
const BAKERY_BRIEF =
  'We are a UK regional bakery group choosing which single capital project to fund this year. ' +
  'The options are a second production oven line, an automated packing cell, refrigerated ' +
  'delivery vans, a new retail concession, or an energy-efficiency retrofit. The goal is to ' +
  'raise operating profit by at least 8 percent within 18 months.';

/**
 * The FOUR-option graph the drafter actually produced, in the PLoT-shape the
 * run_analysis handler forwards. Labels read out of the session's own wire
 * capture (`run3/wire.json`), not invented here.
 */
const FOUR_OPTION_GRAPH = {
  options: [
    { id: 'opt_oven', option_id: 'opt_oven', label: 'Second Production Oven Line' },
    { id: 'opt_pack', option_id: 'opt_pack', label: 'Automated Packing Cell' },
    { id: 'opt_vans', option_id: 'opt_vans', label: 'Refrigerated Delivery Vans' },
    { id: 'opt_retro', option_id: 'opt_retro', label: 'Energy-Efficiency Retrofit' },
  ],
};

/** The same graph with the option the brief listed and the drafter dropped. */
const FIVE_OPTION_GRAPH = {
  options: [
    ...FOUR_OPTION_GRAPH.options,
    { id: 'opt_conc', option_id: 'opt_conc', label: 'New Retail Concession' },
  ],
};

/** A 9-percentage-point lead for the retrofit, as in the capture. */
const BAKERY_ENRICHMENT: Record<string, unknown> = {
  results: [
    { option_id: 'opt_retro', option_label: 'Energy-Efficiency Retrofit', win_probability: 0.42 },
    { option_id: 'opt_pack', option_label: 'Automated Packing Cell', win_probability: 0.33 },
    { option_id: 'opt_oven', option_label: 'Second Production Oven Line', win_probability: 0.15 },
    { option_id: 'opt_vans', option_label: 'Refrigerated Delivery Vans', win_probability: 0.1 },
  ],
};

function headlineInputFor(graph: unknown, brief: string | undefined) {
  const intake = deriveIntakeOptionReconciliation(brief, readGraphOptionLabels(graph));
  return {
    intake,
    input: {
      enrichment: BAKERY_ENRICHMENT,
      leading_option_id: 'opt_retro',
      status_kind: 'ok' as const,
      intake_options_missing: intake.state === 'options_missing',
    },
  };
}

describe('2.579 — the ranking is withheld when the intake lost an option', () => {
  it('WITHHOLDS the leader headline on the real four-of-five bakery case', () => {
    const { intake, input } = headlineInputFor(FOUR_OPTION_GRAPH, BAKERY_BRIEF);

    // PRECONDITION PINNED IN-TEST (CLAUDE.md trap 13b). Without this the
    // withhold below could be caused by a fixture that stopped reproducing the
    // gap — a discriminator whose discrimination is unguarded at rest.
    expect(intake.state).toBe('options_missing');
    expect(intake.missing.map((m) => m.text)).toEqual(['a new retail concession']);

    expect(buildAnalysisResultHeadline(input)).toBeNull();
    expect(describeAnalysisHeadline(input).reason).toBe('intake_options_missing');
  });

  it('POSITIVE CONTROL — the SAME result names the leader once all five are on the graph', () => {
    const { intake, input } = headlineInputFor(FIVE_OPTION_GRAPH, BAKERY_BRIEF);
    expect(intake.state).toBe('reconciled');
    expect(input.intake_options_missing).toBe(false);

    const text = buildAnalysisResultHeadline(input);
    // BOUND BY IDENTITY, not by a value predicate another option could satisfy
    // (trap 19): the control has to name THE RETROFIT. `expect(text).not
    // .toBeNull()` would be satisfied by a headline naming any of the four.
    expect(text).toContain('Energy-Efficiency Retrofit');
    expect(text).toContain('currently leads');
  });

  it('POSITIVE CONTROL — the SAME result names the leader when the brief never enumerated', () => {
    // The second half of the control: it is the INTAKE GAP that withholds, not
    // merely "a brief was present". A brief with no explicit enumeration must
    // leave the product byte-identical to its pre-2.579 behaviour.
    const { intake, input } = headlineInputFor(
      FOUR_OPTION_GRAPH,
      'We want to grow operating profit by 8 percent within 18 months. Advise us.',
    );
    expect(intake.state).toBe('not_applicable');
    expect(buildAnalysisResultHeadline(input)).toContain('Energy-Efficiency Retrofit');
  });

  it('POSITIVE CONTROL — no brief at all leaves the leader named', () => {
    const { intake, input } = headlineInputFor(FOUR_OPTION_GRAPH, undefined);
    expect(intake.state).toBe('not_applicable');
    expect(buildAnalysisResultHeadline(input)).toContain('Energy-Efficiency Retrofit');
  });
});

describe('2.579 — the withhold reaches the persisted permission, not only the prose', () => {
  it('removes the ratified leader permission (row 1.215 seam)', () => {
    const { intake } = headlineInputFor(FOUR_OPTION_GRAPH, BAKERY_BRIEF);
    // The capture measured `may_name_leading_option: true` on 6/6 wire
    // occurrences with provenance `scenario_fact`. This is that byte.
    const persisted = applyIntakeToLeaderPermission(
      { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      intake,
    );
    expect(persisted.may_name_leading_option).toBe(false);
  });

  it('POSITIVE CONTROL — leaves the permission alone when the intake reconciles', () => {
    const { intake } = headlineInputFor(FIVE_OPTION_GRAPH, BAKERY_BRIEF);
    const persisted = applyIntakeToLeaderPermission(
      { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      intake,
    );
    expect(persisted.may_name_leading_option).toBe(true);
  });
});

describe('2.579 — the user is told WHICH option and WHAT to do, at the wire', () => {
  it('composes a summary that names the gap AND survives the egress allowlist', () => {
    const { intake } = headlineInputFor(FOUR_OPTION_GRAPH, BAKERY_BRIEF);
    // Mirrors the handler's composition order exactly:
    //   `${headline ?? template}${scaffold}${constraintGap}${intake}`
    const template = [...RUN_ANALYSIS_LOCKED_TEMPLATES][0] as string;
    const summary = `${template}${buildIntakeOptionDisclosure(intake)}`;

    expect(summary).toContain('“a new retail concession”');
    expect(summary).toContain('confirm you meant to leave it out');
    // The integration property a builder unit test cannot see: rejected here,
    // the user receives the bare template and never learns which option went
    // missing — which is how the sibling constraint disclosure shipped dark.
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
    // And the summary must not itself name a leader on a withheld turn.
    expect(summary).not.toContain('Energy-Efficiency Retrofit');
  });
});
