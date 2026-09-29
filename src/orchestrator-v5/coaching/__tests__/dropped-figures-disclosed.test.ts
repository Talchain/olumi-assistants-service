/**
 * A FIGURE THE USER STATED AND THE MODEL DID NOT CARRY IS NAMED, NOT DROPPED
 * SILENTLY.
 *
 * ── THE ACCEPTANCE CLAUSE THIS SATISFIES ───────────────────────────────────
 * `TEAM-TEST-MVP.md`, criterion 2: *"Material facts stated in the brief are
 * either preserved in the model or explicitly disclosed as not modelled.
 * Silent omission fails this."*
 *
 * Note the OR. This takes the SECOND branch. Nothing here writes a stated
 * figure into the model — forcing a number into a slot it may not belong in is
 * the fabrication class the estate bans, and it is strictly worse than an
 * absence the user can see (`money-invariant.ts`: *"a wrong number the user can
 * SEE flagged is recoverable; a wrong number written in silently is not"*).
 *
 * ── THE MEASURED DEFECT ────────────────────────────────────────────────────
 * The 15-journey measurement against deployed CEE `df3e542` failed every run of
 * the only brief class carrying real figures, on one clause: the user's stated
 * `240000` and `65000` appeared in NEITHER the model NOR any disclosure.
 *
 * The mechanism is NOT a missing capability. `deriveNotModelledManifest`
 * already classifies every stated quantity `in_model` / `prose_only` /
 * `absent`, and `composeBriefAuditAnswer` already renders it — but only
 * through `state-query-guard.ts`, which fires ONLY when the user ASKS a
 * brief-audit question. On the draft turn, where the user reads the narrative
 * and has no reason to think to ask, the capability is silent. It was built and
 * never plugged in.
 *
 * ── THE OPPOSITE-DIRECTION TWIN, AND WHY IT IS THE HALF THAT MATTERS ───────
 * Two harms, one predicate, and they cannot share a window: a notice that
 * cries wolf on figures the model DID carry is worse than silence, because it
 * teaches the reader to ignore it. The twin is therefore mandatory here and is
 * asserted on the SAME brief with the SAME figures, differing only in whether
 * the graph carries them.
 *
 * The discrimination is not this test's own invention: it is
 * `deriveNotModelledManifest`'s existing, corpus-tested `verdict` axis. Only
 * `absent` is disclosed. `in_model` AND `prose_only` are both withheld —
 * `prose_only` means the figure IS somewhere the user can read it, so naming it
 * as un-found would be the cry-wolf direction.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPostDraftNarrative } from '../post-draft-narrative.js';
import {
  composeDroppedFigureNotice,
  composeBriefAuditAnswer,
  MAX_FIGURES_IN_DRAFT_NOTICE,
} from '../../../cee/context-integrity/brief-audit-answer.js';
import { deriveNotModelledManifest } from '../../../cee/context-integrity/not-modelled-manifest.js';

/** The brief class the Monday measurement failed on: real figures, stated plainly. */
const BRIEF =
  'We have a budget of £240,000 for the next financial year and we need to decide ' +
  'whether to hire two senior engineers at £65,000 each or to retain our current ' +
  'contractor arrangement. The board wants a decision before the end of Q3.';

/** A drafted model that DROPS both figures — the measured failure. */
function graphOmittingBothFigures(): unknown {
  return {
    nodes: [
      { id: 'goal_capacity', kind: 'goal', label: 'Increase engineering capacity' },
      { id: 'dec_hiring', kind: 'decision', label: 'How to add engineering capacity' },
      { id: 'opt_hire', kind: 'option', label: 'Hire two senior engineers' },
      { id: 'opt_contract', kind: 'option', label: 'Retain the contractor arrangement' },
      {
        id: 'fac_capacity',
        kind: 'factor',
        label: 'Delivery capacity',
        observed_state: { value: 0.5, source: 'cee_hypothesis' },
      },
      {
        id: 'fac_cost',
        kind: 'factor',
        label: 'Annual cost',
        observed_state: { value: 0.5, source: 'cee_hypothesis' },
      },
    ],
    edges: [],
    options: [
      { id: 'opt_hire', label: 'Hire two senior engineers', status: 'ready', interventions: {} },
      {
        id: 'opt_contract',
        label: 'Retain the contractor arrangement',
        status: 'ready',
        interventions: {},
      },
    ],
  };
}

/** The SAME brief, drafted into a model that DOES carry both figures. */
function graphCarryingBothFigures(): any {
  const g = graphOmittingBothFigures() as any;
  g.nodes[5].observed_state = {
    value: 0.65,
    source: 'brief_extraction',
    unit: '£',
    cap: 100000,
    raw_value: 65000,
  };
  g.nodes.push({
    id: 'fac_budget',
    kind: 'factor',
    label: 'Budget available',
    observed_state: {
      value: 0.24,
      source: 'brief_extraction',
      unit: '£',
      cap: 1000000,
      raw_value: 240000,
    },
    display_value: '£240,000',
  });
  return g;
}

function narrativeFor(graph: unknown): string {
  return buildPostDraftNarrative({
    graph: graph as never,
    analysisReady: { status: 'ready' } as never,
    briefText: BRIEF,
  }).text;
}

describe('a stated figure the model did not carry is disclosed on the draft turn', () => {
  /**
   * RED-first. At pristine this is the measured defect: both of the user's
   * figures are absent from the model AND from every word the product says.
   */
  it('names both figures the model dropped', () => {
    const text = narrativeFor(graphOmittingBothFigures());
    expect(text).toContain('£240,000');
    expect(text).toContain('£65,000');
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN. Same brief, same two figures, a model that
   * carries them. A disclosure here would be a false alarm, and a notice that
   * fires on a faithful model trains the reader to ignore the one that matters.
   */
  it('says nothing about a figure the model DID carry', () => {
    const text = narrativeFor(graphCarryingBothFigures());
    expect(text).not.toContain('could not find');
    expect(text).not.toContain('£240,000');
    expect(text).not.toContain('£65,000');
  });

  /**
   * The twin is only meaningful if the two arms genuinely differ in the
   * verdict — otherwise both could pass because the notice never fires at all
   * (a guard agreeing with itself). Pin the precondition IN-TEST.
   */
  it('the two arms really do differ in the underlying verdict', () => {
    const dropped = deriveNotModelledManifest(BRIEF, graphOmittingBothFigures());
    const carried = deriveNotModelledManifest(BRIEF, graphCarryingBothFigures());

    const verdictOf = (m: ReturnType<typeof deriveNotModelledManifest>, literal: string) =>
      m.quantities?.items.find((i) => i.literal === literal)?.verdict;

    expect(verdictOf(dropped, '£240,000')).toBe('absent');
    expect(verdictOf(dropped, '£65,000')).toBe('absent');
    expect(verdictOf(carried, '£240,000')).toBe('in_model');
    expect(verdictOf(carried, '£65,000')).toBe('in_model');
  });
});

describe('the disclosure rides BOTH narrative paths', () => {
  /**
   * ⭐⭐ THE VERBATIM-SUMMARY SHORTCUT IS THE MAJORITY PATH — 146 of 688
   * replies took the deterministic opener in the 18 Aug live capture, so the
   * other 542 took this one. A disclosure wired only into the sectioned
   * builder would be DARK for most users while the acceptance clause read as
   * closed: this estate's single most repeated failure, and the exact reason
   * `MODEL_VARIANCE_NOTE`'s own comment says it must ride both.
   *
   * Bound to the shortcut BY IDENTITY, not by inference: the summary's own
   * bytes must still be present verbatim and the deterministic opener absent,
   * so this cannot silently start measuring the sectioned builder instead.
   */
  const SUMMARY =
    'The routes here weigh delivery speed against quality risk. One assumption worth ' +
    'checking is whether the team can absorb extra coordination overhead in the first ' +
    'quarter. Next, run the analysis to see how the options compare under stress.';

  it('discloses on the verbatim-summary shortcut too', () => {
    const result = buildPostDraftNarrative({
      graph: graphOmittingBothFigures() as never,
      analysisReady: { status: 'ready' } as never,
      coachingSummary: SUMMARY,
      briefText: BRIEF,
    });
    // Pin the path: we are measuring the shortcut, not the sectioned builder.
    expect(result.telemetry.assumption_source).toBe('coaching_summary');
    expect(result.text).toContain(SUMMARY);
    expect(result.text).not.toContain("I've built a first decision model");

    expect(result.text).toContain('£240,000');
    expect(result.text).toContain('£65,000');
  });

  it('stays silent on the shortcut when the model carried the figures', () => {
    const result = buildPostDraftNarrative({
      graph: graphCarryingBothFigures() as never,
      analysisReady: { status: 'ready' } as never,
      coachingSummary: SUMMARY,
      briefText: BRIEF,
    });
    expect(result.telemetry.assumption_source).toBe('coaching_summary');
    expect(result.text).not.toContain('could not find');
  });
});

describe('the notice states only what the search established', () => {
  it('claims a failed SEARCH, never a fact about the model', () => {
    const notice = composeDroppedFigureNotice(
      deriveNotModelledManifest(BRIEF, graphOmittingBothFigures()),
    );
    expect(notice).not.toBeNull();
    // `stated-amounts.ts` declares its false-negative set incomplete and every
    // miss points the same way — toward calling a PRESENT figure missing. The
    // copy may therefore report the search, never the model.
    expect(notice!).toContain('could not find');
    expect(notice!).not.toContain('not in the model');
    expect(notice!).not.toContain('is missing from');
  });

  it('returns null when the manifest could not look', () => {
    // "Nothing was dropped" on a scenario we know nothing about is a NEW lie
    // carrying the authority of a measurement.
    expect(composeDroppedFigureNotice(deriveNotModelledManifest(null, {}))).toBeNull();
    expect(composeDroppedFigureNotice(deriveNotModelledManifest(BRIEF, null))).toBeNull();
  });

  it('returns null when every stated figure was carried', () => {
    const brief = 'Our budget is £250,000.';
    const graph = {
      nodes: [
        {
          id: 'fac_budget',
          kind: 'factor',
          label: 'Budget',
          observed_state: {
            value: 0.25,
            source: 'brief_extraction',
            unit: '£',
            cap: 1000000,
            raw_value: 250000,
          },
        },
      ],
      edges: [],
    };
    expect(composeDroppedFigureNotice(deriveNotModelledManifest(brief, graph))).toBeNull();
  });
});

describe('a dense brief is capped honestly rather than truncated silently', () => {
  /**
   * Measured on the four real deployed cold-read captures: `absent` runs to
   * 17, 17 and 23 figures. A chat footer cannot carry those, and a silently
   * short list is the same lie as an empty one (`not-modelled-manifest.ts`,
   * `MAX_ITEMS`). So the remainder is COUNTED and the ordering DISCLOSED.
   */
  const HERE = join(
    process.cwd(),
    'src/cee/context-integrity/__tests__/fixtures',
  );

  it('names the cap, the true remainder, and that the order is positional', () => {
    const capture = JSON.parse(
      readFileSync(join(HERE, 'b3-product-bet.cold-read.json'), 'utf8'),
    );
    const manifest = deriveNotModelledManifest(capture.brief_text, capture.graph);
    // The disclosable set is absent MAGNITUDES — temporal kinds are the
    // full audit's business, not this footer's (see the composer's header).
    const disclosable = manifest.quantities!.items.filter(
      (i) => i.verdict === 'absent' && i.kind !== 'date' && i.kind !== 'period',
    );
    expect(disclosable.length).toBeGreaterThan(MAX_FIGURES_IN_DRAFT_NOTICE);

    const notice = composeDroppedFigureNotice(manifest)!;
    expect(notice).not.toBeNull();
    expect(notice).toContain(
      `${disclosable.length - MAX_FIGURES_IN_DRAFT_NOTICE} more`,
    );
    expect(notice).toContain('not a ranking');
  });

  /**
   * ⚠ THE EXCLUSION IS PINNED, NOT LEFT TO BE REDISCOVERED. `14 May 2027` is
   * `absent` on this capture and the 2026-08-08 trace graded losing it SEVERE.
   * It is deliberately NOT in the pushed footer — the model has no temporal
   * slot to "add it" to — and it MUST still be in the full pulled account.
   * If either half of that ever changes, this REDs.
   */
  it('a dropped DEADLINE stays out of the footer and stays in the full audit', () => {
    const capture = JSON.parse(
      readFileSync(join(HERE, 'b3-product-bet.cold-read.json'), 'utf8'),
    );
    const manifest = deriveNotModelledManifest(capture.brief_text, capture.graph);
    expect(
      manifest.quantities!.items.some(
        (i) => i.literal === '14 May 2027' && i.verdict === 'absent',
      ),
    ).toBe(true);

    expect(composeDroppedFigureNotice(manifest)!).not.toContain('14 May 2027');
    expect(composeBriefAuditAnswer(manifest)!).toContain('14 May 2027');
  });
});
