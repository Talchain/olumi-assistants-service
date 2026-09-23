/**
 * P2 — "no single factor we tested would change the order" is VACUOUS when every
 * option sets every tested factor, so it must not be stated as a finding.
 *
 * ## The defect (Paul's manual test, 23 Sep 2026, scenario `58af9704`)
 *
 * `NOT_ROBUST_NO_FLIP_SENTENCE` (2.278) is chosen when every flip row attests no
 * flip. A flip row sweeps ONE factor's value. If every option sets that factor
 * itself, no option ever reads the swept value, so the sweep cannot move the
 * winner — the "no flip" is a property of the model's shape, not a finding
 * about how settled the result is.
 *
 * ## The flip rows and interventions are a CAPTURE, not invented
 *
 * `v5-turn.run-analysis.staging.json` (cee-staging `3bb151b`, 2026-04-30): four
 * options, each intervening on the same three factors, and all three flip rows
 * `no_effect_within_bounds` with `iterations_used: 0` — the sweep never ran a
 * step. Only the robustness VERDICT is set here (`is_robust: false`), because
 * the tail rides on a not-robust run and that capture happened to be robust.
 *
 * ## RED-first at staging `c3e3f187` — MEASURED
 *
 * The base ignores `factorIdsSetByEveryOption` (vitest does not typecheck), so
 * the RED-FIRST case fails there on `expected '…no single factor we tested
 * would change the order…' not to contain 'no single factor'`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  isAllowedRunAnalysisAssistantText,
} from '../analysis-result-headline.js';
import { collectFactorIdsSetByEveryOption } from '../../context/intervention-controlled-drivers.js';

const capture = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/cross-service/v5-turn.run-analysis.staging.json', import.meta.url),
    'utf8',
  ),
) as { blocks: Array<{ enrichment: Record<string, unknown> }> };
const captured = capture.blocks[0]!.enrichment;
const FLIP_ROWS = captured.flip_thresholds as Array<Record<string, unknown>>;
const ISL_OPTIONS = ((captured._meta as Record<string, unknown>).payloads as Record<string, unknown>)
  .isl_request as { options: Array<Record<string, unknown>> };

/** Carrier only (see 2.278's spec): a weak but clear leader, so Case E renders and the tail rides. */
const RESULTS = [
  { option_id: 'opt_hire_local', option_label: 'Hire locally', win_probability: 0.34 },
  { option_id: 'opt_offshore', option_label: 'Offshore', win_probability: 0.22 },
  { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.22 },
  { option_id: 'opt_tiered_pricing', option_label: 'Tiered pricing', win_probability: 0.22 },
];

const NO_FLIP_CLAIM = 'no single factor we tested would change the order';

/**
 * ⚠ MEASURED, PRE-EXISTING: `isAllowedRunAnalysisAssistantText` takes 1.5–2.8 s
 * PER CALL on a summary carrying the 2.278 no-flip sentence (0 ms on the
 * not-robust sentence), measured with tsx at load ~35 on 23 Sep 2026. Not this
 * change's cost; the budget below keeps the egress assertion from timing out
 * under load rather than dropping it.
 */
const GRAMMAR_BUDGET_MS = 30_000;

/**
 * The capture's every-option set, written out so the RED-FIRST case runs at the
 * base (where the collector does not exist). The PRECONDITION derives it from
 * the capture with the real collector and requires equality — so this literal
 * cannot drift from what the product computes.
 */
const EVERY_OPTION_SET: ReadonlySet<string> = new Set(['fac_eng_capacity', 'fac_hiring_cost', 'fac_offshore']);

function headline(factorIdsSetByEveryOption?: ReadonlySet<string>): string {
  return buildAnalysisResultHeadline({
    enrichment: {
      results: RESULTS,
      robustness: { is_robust: false, level: 'low' },
      flip_thresholds: FLIP_ROWS,
    },
    leading_option_id: 'opt_hire_local',
    status_kind: 'ok',
    ...(factorIdsSetByEveryOption ? { factorIdsSetByEveryOption } : {}),
  } as Parameters<typeof buildAnalysisResultHeadline>[0]) as string;
}

describe('P2 — a vacuous no-flip attestation is not stated as a finding', () => {
  it('PRECONDITION — the capture really is the vacuous shape', () => {
    // Every flip row attests no flip…
    expect(FLIP_ROWS.map((r) => r.flip_reason)).toEqual([
      'no_effect_within_bounds',
      'no_effect_within_bounds',
      'no_effect_within_bounds',
    ]);
    // …and every tested factor is set by EVERY option (derived, not typed).
    const everyOption = collectFactorIdsSetByEveryOption({ options: ISL_OPTIONS.options });
    expect([...everyOption].sort()).toEqual([...EVERY_OPTION_SET].sort());
    for (const row of FLIP_ROWS) expect(everyOption.has(row.factor_id as string)).toBe(true);
    // Positive control (trap 13): without the set, the base behaviour names the claim.
    expect(headline()).toContain(NO_FLIP_CLAIM);
  });

  it('RED-FIRST: every tested factor set by every option ⇒ the no-flip claim is withheld', () => {
    const out = headline(EVERY_OPTION_SET);
    expect(out).not.toContain('no single factor');
    // The TRUE caveat survives — the robustness verdict is not suppressed with the reason.
    expect(out).toContain('The result is not yet robust');
    // And the honest alternative is the file's own sentence for "no conclusive
    // flip evidence", so it passes the egress grammar (else the user gets the
    // locked template instead).
    expect(out).toContain('small changes could flip it');
    expect(isAllowedRunAnalysisAssistantText(out)).toBe(true);
  }, GRAMMAR_BUDGET_MS);

  it('DISCRIMINATING TWIN: one tested factor NOT set by every option ⇒ the finding stands', () => {
    // Same rows, same options, except `fac_offshore` is left free by one option:
    // sweeping it now moves that option, so the attestation is a real finding.
    const options = ISL_OPTIONS.options.map((o, i) => {
      if (i !== 2) return o;
      const { fac_offshore: _dropped, ...rest } = o.interventions as Record<string, number>;
      return { ...o, interventions: rest };
    });
    const set = collectFactorIdsSetByEveryOption({ options });
    expect(set.has('fac_offshore')).toBe(false);
    expect(set.has('fac_eng_capacity')).toBe(true);

    const out = headline(set);
    expect(out).toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(out)).toBe(true);
  }, GRAMMAR_BUDGET_MS);
});

describe('collectFactorIdsSetByEveryOption', () => {
  it('intersects across options and unions each option\'s own locations', () => {
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', interventions: { fac_x: 1 }, data: { interventions: { fac_y: 2 } } },
        { id: 'opt_b', kind: 'option', 'data/interventions/fac_x': 3, data: { interventions: { fac_y: 1 } } },
        { id: 'fac_x', kind: 'factor' },
      ],
    };
    expect([...collectFactorIdsSetByEveryOption(graph)].sort()).toEqual(['fac_x', 'fac_y']);
  });

  it('an option that sets nothing empties the set', () => {
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', interventions: { fac_x: 1 } },
        { id: 'opt_b', kind: 'option' },
      ],
    };
    expect(collectFactorIdsSetByEveryOption(graph).size).toBe(0);
  });

  it('the same option in nodes[] and options[] is ONE option, not two', () => {
    const graph = {
      nodes: [{ id: 'opt_a', kind: 'option', interventions: { fac_x: 1 } }],
      options: [
        { id: 'opt_a', interventions: { fac_y: 1 } },
        { id: 'opt_b', interventions: { fac_x: 1, fac_y: 1 } },
      ],
    };
    expect([...collectFactorIdsSetByEveryOption(graph)].sort()).toEqual(['fac_x', 'fac_y']);
  });

  it('no options, or a malformed graph, yields the empty set (no suppression)', () => {
    expect(collectFactorIdsSetByEveryOption(null).size).toBe(0);
    expect(collectFactorIdsSetByEveryOption({ nodes: [{ id: 'f', kind: 'factor' }] }).size).toBe(0);
  });
});
