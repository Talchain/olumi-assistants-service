/**
 * ROADMAP 2.117 — the needs-encoding copy must not PREDICT A BLOCK that
 * option scaffolding now clears.
 *
 * Live-captured on 28 Jul (THREE-SURFACE-PROOF §P3, JOURNEY-PROOF steps 2/3),
 * both halves of the first-session add-option journey asserted a block:
 *
 *   hold  → "…has no effect values yet, so the analysis will stay blocked
 *            after this is applied until you set them."
 *   apply → "…does not have effect values yet, so the analysis cannot run
 *            until they are set."
 *
 * Post-#747 both are FALSE for exactly this shape: readiness reports
 * `will_scaffold_options: true`, the run gate stays enabled, and the option is
 * scored with disclosed placeholder values. The results panel already discloses
 * placeholder reliance honestly, so the chat copy also CONTRADICTED it.
 *
 * ── What this suite pins, and why it is not a frozen string ────────────────
 *
 * The claim under test is conditional, so it is anchored to the gate's own
 * truth rather than to today's wording:
 *
 *   IF `computeScaffoldPlan` — the ONE shared predicate the readiness endpoint
 *   and `run_analysis` both read — says this option WILL be scaffolded,
 *   THEN neither copy site may tell the user the analysis is blocked / cannot
 *   run / must wait until values are set.
 *
 * `computeScaffoldPlan` is evaluated here, not assumed (trap 12: derive, don't
 * mirror). A future change that makes this shape genuinely unscaffoldable
 * fails the antecedent loudly instead of silently hollowing the pin out
 * (trap 12b) — the antecedent is asserted, not skipped.
 *
 * The historical sentences are pinned verbatim as PERMANENT fixtures, kept
 * separate from whatever the builders emit today, so the detector's positive
 * control cannot decay into a tautology when the live copy moves again.
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

/** The hold-side sentence as captured live on 28 Jul 2026 (journey step 2). */
const HISTORICAL_HOLD_COPY =
  "Heads up: 'Partner with Specialist Consultancy to Extend Current System' has no effect " +
  'values yet, so the analysis will stay blocked after this is applied until you set them. ' +
  'You can tell me what it changes once it is added.';

/** The apply-side sentence as captured live on 28 Jul 2026 (journey step 3). */
const HISTORICAL_APPLY_COPY =
  "Note: 'Partner with Specialist Consultancy to Extend Current System' does not have effect " +
  'values yet, so the analysis cannot run until they are set. ' +
  "Say 'configure the Partner with Specialist Consultancy to Extend Current System option' " +
  "and tell me what it changes, and I'll write it in.";

// ---------------------------------------------------------------------------
// The block-assertion detector.
// ---------------------------------------------------------------------------

/**
 * Phrasings that tell the user the analysis will not run. "until … set" is
 * matched only in its RUN-PRECONDITION form (a run/analysis verb on the left),
 * so honest remedy copy ("tell me what it changes and I'll write in the real
 * numbers") is never caught.
 */
const BLOCK_ASSERTIONS: ReadonlyArray<readonly [string, RegExp]> = [
  ['blocked', /\bblock(ed|s|ing)?\b/i],
  ['cannot / will not run', /\b(cannot|can ?not|can't|won't|will not|unable to)\s+(be\s+)?run\b/i],
  ['not run until', /\bnot\s+run\b[^.]*\buntil\b/i],
  [
    'run-precondition "until … set"',
    /\b(run|analys|analyz)[a-z]*\b[^.]*\buntil\b[^.]*\b(set|configur|enter|provid)/i,
  ],
  ['stays unavailable', /\b(unavailable|disabled)\b/i],
  ["won't be included", /\b(won't|will not|cannot|can't)\s+(be\s+)?(includ|scor|count)/i],
];

function blockAssertionsIn(copy: string): string[] {
  return BLOCK_ASSERTIONS.filter(([, re]) => re.test(copy)).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Positive control (trap 13) — an absence assertion is vacuous unless the
// mechanism provably SEES a presence.
// ---------------------------------------------------------------------------

describe('block-assertion detector — positive control', () => {
  it('fires on the historical hold-side sentence', () => {
    expect(blockAssertionsIn(HISTORICAL_HOLD_COPY)).toContain('blocked');
  });

  it('fires on the historical apply-side sentence', () => {
    const hits = blockAssertionsIn(HISTORICAL_APPLY_COPY);
    expect(hits).toContain('cannot / will not run');
    expect(hits).toContain('run-precondition "until … set"');
  });

  it('does NOT fire on honest placeholder + remedy copy (no false positives)', () => {
    expect(
      blockAssertionsIn(
        "Heads up: 'X' has no effect values yet, so Olumi will include it using provisional " +
          "placeholder values. Tell me what it changes and I'll write in the real numbers.",
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The antecedent — this fixture IS scaffoldable, per the SHARED predicate.
// ---------------------------------------------------------------------------

/**
 * The #747 wire shape, verbatim in substance from
 * `tests/integration/cee.graph-readiness.test.ts` ("F4 #2 RED-first"): an
 * option added by chat with status `needs_encoding`, `interventions: {}`, and
 * NO `raw_interventions` — i.e. no user intervention intent to protect.
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

describe('antecedent — the gate itself says this option WILL be scaffolded', () => {
  it('computeScaffoldPlan reports will_scaffold_options for the #747 shape', () => {
    const plan = computeScaffoldPlan({
      options: SCAFFOLDABLE_OPTIONS,
      graph: SCAFFOLDABLE_GRAPH,
      rawPersistedGraph: SCAFFOLDABLE_GRAPH,
      scaleNetEnabled: true,
    });
    // Asserted, never assumed: if this ever flips, the pins below are
    // reasoning from a false premise and must fail here FIRST.
    expect(plan.will_scaffold_options).toBe(true);
    expect(plan.scaffolded_option_ids).toContain('opt_b');
  });
});

// ---------------------------------------------------------------------------
// The consequent — neither surface may predict a block.
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

describe('HOLD side — the consent ask must not predict a block', () => {
  const notice = () => buildNeedsEncodingAddNotice(ADD_SCAFFOLDABLE_OPTION_OPS, SCAFFOLDABLE_GRAPH);

  it('still discloses that the option has no effect values (the disclosure is not dropped)', () => {
    const copy = notice();
    expect(copy).not.toBeNull();
    expect(copy).toContain("'Partner with a specialist consultancy'");
    expect(copy).toContain('no effect values yet');
  });

  it('asserts NO block for an option the scaffold plan says will be included', () => {
    expect(blockAssertionsIn(notice()!)).toEqual([]);
  });

  it('says what actually happens — the option is included on placeholder values', () => {
    const copy = notice()!;
    expect(copy).toMatch(/placeholder/i);
    // …and still names the remedy, so "fixing" this by deleting the sentence
    // cannot pass.
    expect(copy).toMatch(/tell me what it changes/i);
  });
});

describe('APPLY side — the applied receipt must not predict a block', () => {
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

  it('asserts NO block, in the notice or in the full receipt', () => {
    expect(blockAssertionsIn(buildUnconfiguredOptionsNotice(labels())!)).toEqual([]);
    expect(
      blockAssertionsIn(buildGmHeldAppliedReceipt(["add 'Partner with a…'"], labels())),
    ).toEqual([]);
  });

  it('says what actually happens — included on placeholder values', () => {
    expect(buildUnconfiguredOptionsNotice(labels())!).toMatch(/placeholder/i);
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
