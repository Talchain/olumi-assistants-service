/**
 * ROADMAP 2.117 round 2 — the needs-encoding consent copy is PREDICTION-FREE
 * BY DESIGN. It states facts that are true at proposal time. It does not
 * forecast the analysis outcome in EITHER direction.
 *
 * ── Why this pin exists in the shape it does ──────────────────────────────
 *
 * Two generations of this copy have now been falsified live, in opposite
 * directions, by the same mistake — an UNCONDITIONAL claim about a
 * CONDITIONAL outcome:
 *
 *   gen 1 (pre-#748)  "…so the analysis will stay blocked after this is
 *                      applied until you set them."
 *                     FALSE post-#747: the option is scaffolded, the gate
 *                     stays enabled, the analysis runs (THREE-SURFACE-PROOF
 *                     §P3 — the added option scored #2 at 18%).
 *
 *   gen 2 (#748)      "…so Olumi will include it using provisional
 *                      placeholder values."
 *                     FALSE on the very next live re-capture: the value-free
 *                     option scaffolds onto the baseline, becomes identical
 *                     to "Defer Replacement (Status Quo)", and the engine
 *                     removes it — `IDENTICAL_OPTIONS_DEDUPED`. It was not
 *                     scored at all.
 *
 * Note the direction of the second failure: #748 replaced a false NEGATIVE
 * prediction with a false POSITIVE one. Both were predictions. The outcome is
 * DRAFT-DEPENDENT — it turns on whether the draft yields a baseline option the
 * value-free option can collapse onto — and at least three independent
 * mechanisms can suppress inclusion (no projectable neutral target; no
 * configured sibling; post-scaffold dedup against the baseline). Consent copy
 * cannot know any of them at proposal time.
 *
 * So the rule pinned here is symmetric and absolute: **no outcome clause in
 * either direction.** What actually happened — scored-with-placeholders, or
 * deduped — is the ANALYSIS RESULT's job to disclose, and it does.
 *
 * Both historical generations are pinned verbatim below as PERMANENT
 * fixtures, kept separate from the live builders, so the detector's positive
 * controls cannot decay into tautologies when the copy moves again
 * (trap 12b — a control pinned to "current" expires the moment "current"
 * changes; #748's own sentence is now history and is treated as such).
 */

import { describe, it, expect } from 'vitest';

import { buildNeedsEncodingAddNotice } from '../edit-graph-referee-gate.js';
import {
  buildGmHeldAppliedReceipt,
  buildUnconfiguredOptionsNotice,
  deriveUnconfiguredOptionLabels,
} from '../gm-held-execute.js';
import { computeScaffoldPlan } from '../../tools/handlers/scaffold-unconfigured-options.js';
import { detectConfigureOptionIntent } from '../../routing/configure-option-intent.js';

// ---------------------------------------------------------------------------
// Historical artefacts — PINNED, never re-derived from the live builders.
// ---------------------------------------------------------------------------

/** GEN 1, captured live 28 Jul (journey step 2) — the block prediction. */
const GEN1_HOLD_COPY =
  "Heads up: 'Partner with Specialist Consultancy to Extend Current System' has no effect " +
  'values yet, so the analysis will stay blocked after this is applied until you set them. ' +
  'You can tell me what it changes once it is added.';

/** GEN 1, captured live 28 Jul (journey step 3) — the block prediction. */
const GEN1_APPLY_COPY =
  "Note: 'Partner with Specialist Consultancy to Extend Current System' does not have effect " +
  'values yet, so the analysis cannot run until they are set. ' +
  "Say 'configure the Partner with Specialist Consultancy to Extend Current System option' " +
  "and tell me what it changes, and I'll write it in.";

/** GEN 2 (#748), falsified by the re-capture — the inclusion promise. */
const GEN2_HOLD_COPY =
  "Heads up: 'Partner with Specialist Consultancy to Extend Current System' has no effect " +
  'values yet, so Olumi will include it using provisional placeholder values. ' +
  "Tell me what it changes and I'll write in the real numbers.";

/** GEN 2 (#748), falsified by the re-capture — the inclusion promise. */
const GEN2_APPLY_COPY =
  "Note: 'Partner with Specialist Consultancy to Extend Current System' does not have effect " +
  'values yet, so Olumi will include it using provisional placeholder values. ' +
  "Say 'configure the Partner with Specialist Consultancy to Extend Current System option' " +
  "and tell me what it changes, and I'll write in the real numbers.";

// ---------------------------------------------------------------------------
// The OUTCOME-assertion detector — symmetric by construction.
// ---------------------------------------------------------------------------

/**
 * Any clause that forecasts what the ANALYSIS will do with the option.
 *
 * Deliberately symmetric: the exclusion half alone is what let #748 through,
 * so the inclusion half carries equal weight. Both halves are matched only in
 * PREDICTIVE form (a modal — will / won't / cannot / going to), so honest
 * present-tense remedy copy is never caught. "I'll write in the real numbers"
 * is a promise about ME, not a forecast of the analysis outcome, and is
 * intended to survive.
 */
const OUTCOME_ASSERTIONS: ReadonlyArray<readonly [string, RegExp]> = [
  // ── exclusion half (gen 1) ───────────────────────────────────────────────
  ['blocked', /\bblock(ed|s|ing)?\b/i],
  ['cannot / will not run', /\b(cannot|can ?not|can't|won't|will not|unable to)\s+(be\s+)?run\b/i],
  ['not run until', /\bnot\s+run\b[^.]*\buntil\b/i],
  [
    'run-precondition "until … set"',
    /\b(run|analys|analyz)[a-z]*\b[^.]*\buntil\b[^.]*\b(set|configur|enter|provid)/i,
  ],
  ['stays unavailable / disabled', /\b(unavailable|disabled)\b/i],
  ["won't be included / scored", /\b(won't|will not|cannot|can't)\s+(be\s+)?(includ|scor|count)/i],
  // ── inclusion half (gen 2) — the direction #748 got wrong ────────────────
  [
    'will include / score / count it',
    /\b(will|'ll|going to|shall)\s+(still\s+|then\s+|also\s+)?(be\s+)?(includ|scor|count|rank|compar)/i,
  ],
  [
    'predictive placeholder clause',
    /\b(will|'ll|going to)\b[^.]*\b(placeholder|provisional)\b/i,
  ],
  [
    'analysis will run / proceed anyway',
    /\banalys[a-z]*\b[^.]*\b(will|'ll)\s+(still\s+)?(run|proceed|complete|continue)/i,
  ],
];

function outcomeAssertionsIn(copy: string): string[] {
  return OUTCOME_ASSERTIONS.filter(([, re]) => re.test(copy)).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Positive controls (trap 13) — an absence assertion is vacuous unless the
// mechanism provably SEES a presence. BOTH generations must trip it.
// ---------------------------------------------------------------------------

describe('outcome-assertion detector — positive controls (both historical generations)', () => {
  it('GEN 1 hold — fires on the block prediction', () => {
    expect(outcomeAssertionsIn(GEN1_HOLD_COPY)).toContain('blocked');
  });

  it('GEN 1 apply — fires on the block prediction', () => {
    const hits = outcomeAssertionsIn(GEN1_APPLY_COPY);
    expect(hits).toContain('cannot / will not run');
    expect(hits).toContain('run-precondition "until … set"');
  });

  it('GEN 2 hold (#748) — fires on the INCLUSION promise', () => {
    const hits = outcomeAssertionsIn(GEN2_HOLD_COPY);
    expect(hits).toContain('will include / score / count it');
    expect(hits).toContain('predictive placeholder clause');
  });

  it('GEN 2 apply (#748) — fires on the INCLUSION promise', () => {
    const hits = outcomeAssertionsIn(GEN2_APPLY_COPY);
    expect(hits).toContain('will include / score / count it');
    expect(hits).toContain('predictive placeholder clause');
  });

  it('the detector is SYMMETRIC — neither generation escapes it', () => {
    for (const copy of [GEN1_HOLD_COPY, GEN1_APPLY_COPY, GEN2_HOLD_COPY, GEN2_APPLY_COPY]) {
      expect(outcomeAssertionsIn(copy).length).toBeGreaterThan(0);
    }
  });

  it('false-positive control — prediction-free copy passes cleanly', () => {
    expect(
      outcomeAssertionsIn(
        "Heads up: 'X' has no effect values yet. Tell me what it changes and I'll write in " +
          'the real numbers.',
      ),
    ).toEqual([]);
    expect(
      outcomeAssertionsIn(
        "Note: 'X' does not have effect values yet. Say 'configure the X option' and tell me " +
          "what it changes, and I'll write in the real numbers.",
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The readiness/gate premise — still guarded, but no longer a premise the
// COPY depends on.
// ---------------------------------------------------------------------------

/**
 * The #747 wire shape, in substance from
 * `tests/integration/cee.graph-readiness.test.ts` ("F4 #2 RED-first"):
 * `needs_encoding`, `interventions: {}`, no `raw_interventions`.
 *
 * ⚠ ROUND 2 — read this before reasoning from it. This antecedent is retained
 * because it guards the #747 readiness↔run premise, which is real and must not
 * regress. It is NO LONGER the justification for any sentence: the copy now
 * claims the outcome in NEITHER direction, so it is correct whether this plan
 * says scaffold or not — and, as the live re-capture proved, `will_scaffold`
 * true does not even imply the option survives to be scored
 * (`IDENTICAL_OPTIONS_DEDUPED` removes it downstream of the scaffold).
 * Scaffolding is a step, not the outcome.
 */
const SCAFFOLDABLE_GRAPH = {
  version: '1',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Increase revenue' },
    { id: 'decision', kind: 'decision', label: 'Pricing' },
    {
      id: 'fac_price',
      kind: 'factor',
      label: 'Price',
      category: 'controllable',
      prior: { distribution: 'uniform', range_min: 10, range_max: 30 },
    },
    { id: 'opt_a', kind: 'option', label: 'Premium' },
    { id: 'opt_b', kind: 'option', label: 'Partner with a specialist consultancy' },
  ],
  edges: [
    { id: 'e1', from: 'decision', to: 'opt_a' },
    { id: 'e2', from: 'decision', to: 'opt_b' },
    { id: 'e3', from: 'opt_a', to: 'fac_price' },
    { id: 'e4', from: 'opt_b', to: 'fac_price' },
  ],
};

const SCAFFOLDABLE_OPTIONS = [
  { id: 'opt_a', label: 'Premium', status: 'ready', interventions: { fac_price: 0.9 } },
  {
    id: 'opt_b',
    label: 'Partner with a specialist consultancy',
    status: 'needs_encoding',
    interventions: {},
  },
];

describe('readiness premise — #747 still holds (guarded, not relied on by the copy)', () => {
  it('computeScaffoldPlan reports will_scaffold_options for the #747 shape', () => {
    const plan = computeScaffoldPlan({
      options: SCAFFOLDABLE_OPTIONS,
      graph: SCAFFOLDABLE_GRAPH,
      rawPersistedGraph: SCAFFOLDABLE_GRAPH,
      scaleNetEnabled: true,
    });
    expect(plan.will_scaffold_options).toBe(true);
    expect(plan.scaffolded_option_ids).toContain('opt_b');
  });
});

// ---------------------------------------------------------------------------
// The rule — neither surface may forecast the outcome, in either direction.
// ---------------------------------------------------------------------------

/** The live A2 hold batch: add the option, with NO interventions requested. */
const ADD_SCAFFOLDABLE_OPTION_OPS = [
  {
    op: 'add_node',
    path: 'opt_b',
    value: { id: 'opt_b', kind: 'option', label: 'Partner with a specialist consultancy' },
  },
  {
    op: 'add_edge',
    path: 'decision::opt_b',
    value: {
      from: 'decision',
      to: 'opt_b',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
  },
];

describe('HOLD side — the consent ask states a fact, not an outcome', () => {
  const notice = () => buildNeedsEncodingAddNotice(ADD_SCAFFOLDABLE_OPTION_OPS, SCAFFOLDABLE_GRAPH);

  it('still discloses that the option has no effect values (the disclosure is not dropped)', () => {
    const copy = notice();
    expect(copy).not.toBeNull();
    expect(copy).toContain("'Partner with a specialist consultancy'");
    expect(copy).toContain('no effect values yet');
  });

  it('asserts NO outcome, in either direction', () => {
    expect(outcomeAssertionsIn(notice()!)).toEqual([]);
  });

  it('still names the remedy — deleting the sentence must not pass', () => {
    expect(notice()!).toMatch(/tell me what it changes/i);
    expect(notice()!).toMatch(/real numbers/i);
  });
});

describe('APPLY side — the applied receipt states a fact, not an outcome', () => {
  const READINESS_AFTER_APPLY = {
    status: 'needs_encoding',
    options: [
      { option_id: 'opt_a', label: 'Premium', status: 'ready' },
      {
        option_id: 'opt_b',
        label: 'Partner with a specialist consultancy',
        status: 'needs_encoding',
      },
    ],
  };

  const labels = () => deriveUnconfiguredOptionLabels(READINESS_AFTER_APPLY);

  it('still discloses the missing effect values', () => {
    const copy = buildUnconfiguredOptionsNotice(labels());
    expect(copy).not.toBeNull();
    expect(copy).toContain("'Partner with a specialist consultancy'");
    expect(copy).toContain('does not have effect values yet');
  });

  it('asserts NO outcome, in the notice or in the full receipt', () => {
    expect(outcomeAssertionsIn(buildUnconfiguredOptionsNotice(labels())!)).toEqual([]);
    expect(
      outcomeAssertionsIn(buildGmHeldAppliedReceipt(["add 'Partner with a…'"], labels())),
    ).toEqual([]);
  });

  it('KEEPS the deterministic configure-option exemplar the detector must match', () => {
    // The advised phrasing is load-bearing: it is what routes a user who
    // echoes it into the deterministic edit lane, with NO LLM router.
    const copy = buildUnconfiguredOptionsNotice(labels())!;
    const exemplar = /\bsay\b[,:]?\s+'([^']+)'/i.exec(copy)?.[1];
    expect(exemplar).toBeDefined();
    expect(detectConfigureOptionIntent(exemplar!, []).matched).toBe(true);
  });
});
