/**
 * ⭐⭐ THE ATTRIBUTION MARKER MUST NOT BE PAID FOR OUT OF THE COACHING.
 *
 * ── THE INTERACTION, AND ITS CURRENT STATE ─────────────────────────────────
 * #1468 appends `CEE_PROPOSED_MARKER` to every option the product invented
 * (`post-draft-narrative.ts:135`, applied at `:1307`). The SAME file spends a
 * 140-word budget (`post-draft-narrative.ts:116`) through a six-rung eviction
 * ladder (`assembleSectionedNarrative`, `post-draft-narrative.ts:2512`), and
 * the option inventory is INSIDE the measured string at five of those six
 * rungs — only the terminal rung drops it. So a marker that costs words does
 * not shed OTHER MARKERS when the budget tightens: it sheds COACHING.
 *
 * ⛔⛔ THIS FILE IS REGRESSION PREVENTION, NOT A FIX. THE MECHANISM CANNOT
 * CURRENTLY FIRE, AND THE MARGIN IS LARGE. Measured here, by execution, on the
 * frozen governed capture of real `claude-sonnet-4-6` production output: the
 * fattest of its 14 drafts prices at 90 words against the 140-word budget, and
 * the SMALLEST headroom across all 14 is 50 words against a marker cost that
 * cannot exceed 12. Nothing is being fixed. What is being bought is that a
 * future change to the marker, to the budget, or to the ladder FAILS LOUD
 * instead of silently deleting a coaching section.
 *
 * ── ⛔ WHY THE OBVIOUS ASSERTION IS WORTHLESS ON ITS OWN ────────────────────
 * `countWords(content) <= MAX_WORDS` is TRUE BY CONSTRUCTION at rungs 1-4:
 * the assembler evaluates exactly that expression and only returns when it
 * holds. A guard asserting it is a guard agreeing with itself — it can fail
 * only at the terminal rung, which takes no budget check at all. It is kept
 * below, labelled, for precisely that one case, and it is NOT what bites.
 *
 * ⭐ WHAT BITES IS THE RUNG. The load-bearing assertion is an A/B on ONE graph
 * with ONE variable — attribution on versus attribution off — asserting the
 * ladder lands on the SAME rung in both arms, and that the rung is one with
 * content still to lose. That question cannot be answered by the assembler
 * agreeing with itself, because the two arms are two different runs.
 *
 * ── ⛔ AND WHY A HAND-SET CEILING WAS REFUSED ───────────────────────────────
 * Every number here is read from the producer: `MAX_WORDS`, `MAX_NAMED_OPTIONS`
 * and `CEE_PROPOSED_MARKER` are imported, and the marker's COST is MEASURED by
 * running the product both ways rather than computed from its length. A guard
 * sized to a literal cannot see the constant it mirrors move, and a guard
 * counting CHARACTERS against a budget denominated in WORDS blesses the
 * regression it exists to catch.
 *
 * ── EVIDENCE CLASS, STATED PRECISELY ───────────────────────────────────────
 * The production arm reads the FROZEN GOVERNED CAPTURE, never a fixture written
 * here (trap 16-inverse: a self-authored input encodes the author's model of
 * the producer rather than the producer). Its nodes carry provenance NESTED
 * (`{ provenance_class, source_quote }`) while `collectOptions` reads a FLAT
 * `provenance` string plus a top-level `source_quote` — which is exactly why an
 * earlier measurement of these same graphs saw the marker fire ZERO times and
 * could report narrative SIZE on real output but not marker FIRING. `project()`
 * below performs that one flattening, and it is verified BY ITS EFFECT: the
 * controls assert the marker genuinely fires on real invented options in the ON
 * arm and on none in the OFF arm, so a wrong mapping REDs rather than quietly
 * measuring an unmarked draft.
 *
 * ⚠ WHAT THIS FILE DOES NOT COVER, stated so nobody reads more into it:
 *   · the capture is ONE frozen baseline of 14 cases, not a distribution;
 *   · `buildPostDraftNarrative` has two returns that never reach the assembler
 *     at all — the verbatim `coachingSummary` shortcut (the MAJORITY path; the
 *     producer records 542 of 688 replies taking a non-deterministic path) and
 *     the graphless return. Nothing here says anything about those;
 *   · a draft with a longer weighing block, a promoted stated-limit
 *     clarification or a completeness advisory sits higher than any case here.
 *     The synthetic fixture below exists to reach the marker's worst case,
 *     which no real capture case does.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  CEE_PROPOSED_MARKER,
  MAX_NAMED_OPTIONS,
  MAX_WORDS,
  buildPostDraftNarrative,
  countWords,
} from '../post-draft-narrative.js';
import {
  carriesDroppedFigureNotice,
  pricedWordCount,
  rungCensus,
  type RungCensus,
} from './support/narrative-budget.support.js';

/** The frozen governed baseline — real production model output. READ, never written. */
const GOVERNED_RUN =
  'tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json';

interface CaptureNode {
  readonly kind?: string;
  readonly label?: string;
  readonly provenance?: { provenance_class?: string; source_quote?: string } | string;
}
interface CaptureCase {
  readonly graph?: { nodes?: CaptureNode[]; edges?: unknown[] };
}

const CAPTURE_CASES: CaptureCase[] = (() => {
  const parsed = JSON.parse(fs.readFileSync(GOVERNED_RUN, 'utf8')) as {
    run?: { cases?: CaptureCase[] };
  };
  return parsed.run?.cases ?? [];
})();

/**
 * Flatten the capture's NESTED provenance onto the shape `collectOptions`
 * reads. `suppressAttribution` gives every otherwise-invented option a
 * `source_quote`, which is the conjunction's second signal — so the OFF arm is
 * the SAME graph with the marker withheld, and nothing else differs.
 */
function project(nodes: readonly CaptureNode[], suppressAttribution: boolean): unknown[] {
  return nodes.map((n) => {
    const p = n.provenance;
    if (p === null || typeof p !== 'object') return n;
    const quote = typeof p.source_quote === 'string' ? p.source_quote : undefined;
    return {
      ...n,
      provenance: p.provenance_class,
      ...(quote !== undefined ? { source_quote: quote } : {}),
      ...(suppressAttribution && quote === undefined
        ? { source_quote: 'withheld for the control arm' }
        : {}),
    };
  });
}

function narrativeFor(c: CaptureCase, suppressAttribution: boolean) {
  return buildPostDraftNarrative({
    graph: {
      nodes: project(c.graph?.nodes ?? [], suppressAttribution),
      edges: c.graph?.edges ?? [],
    } as never,
    analysisReady: { status: 'needs_user_input' } as never,
  });
}

function markerCount(text: string): number {
  return text.split(CEE_PROPOSED_MARKER).length - 1;
}

// ---------------------------------------------------------------------------
// Instrument controls — before any claim rests on the capture or the projection.
// ---------------------------------------------------------------------------

describe('marker/budget instrument controls', () => {
  it('ANTI-VACUITY: the capture holds BOTH option classes', () => {
    expect(CAPTURE_CASES.length, 'governed capture yielded no cases').toBeGreaterThan(0);
    let invented = 0;
    let stated = 0;
    for (const c of CAPTURE_CASES) {
      for (const n of c.graph?.nodes ?? []) {
        if (n.kind !== 'option') continue;
        const p = n.provenance;
        if (p === null || typeof p !== 'object') continue;
        if (p.provenance_class === 'ai_inferred' && p.source_quote === undefined) invented++;
        if (p.provenance_class === 'stated' && typeof p.source_quote === 'string') stated++;
      }
    }
    expect(invented, 'no CEE-invented options in the capture').toBeGreaterThan(0);
    expect(stated, 'no user-stated options in the capture').toBeGreaterThan(0);
  });

  it('⭐ THE PROJECTION REACHES THE PRODUCER: the marker genuinely fires on real invented options', () => {
    // Verifies `project()` BY ITS EFFECT. Were the flattening wrong, every ON
    // arm below would be an unmarked draft and the whole file would compare a
    // graph against itself.
    const firing = CAPTURE_CASES.filter((c) => markerCount(narrativeFor(c, false).text) > 0);
    expect(
      firing.length,
      'PRECONDITION: no real case fires the marker — the projection is not reaching collectOptions',
    ).toBeGreaterThan(0);
    // CONTRAST, same sweep: the OFF arm must fire NONE, or "attribution off" is
    // not what the control arm is doing.
    for (const c of CAPTURE_CASES) {
      expect(markerCount(narrativeFor(c, true).text), 'the OFF arm must carry no marker').toBe(0);
    }
  });

  it('⭐ NON-TERMINAL RUNG: every real case has content the budget could still shed', () => {
    // Without this the guarantee below is vacuous: a reply that is already down
    // to confirm + next step cannot demonstrate that nothing was evicted.
    for (const [i, c] of CAPTURE_CASES.entries()) {
      const census = rungCensus(narrativeFor(c, false));
      expect(census.hasOptions, `case ${i}: no option inventory to shed`).toBe(true);
      expect(census.hasWeighing, `case ${i}: no weighing block to shed`).toBe(true);
    }
  });

  it('the priced string excludes the fixed footers, and no case carries the second one', () => {
    for (const [i, c] of CAPTURE_CASES.entries()) {
      const { text } = narrativeFor(c, false);
      // Pinned so `pricedWordCount` below is EXACT with no extra footers passed.
      expect(
        carriesDroppedFigureNotice(text),
        `case ${i}: a dropped-figure notice would make the priced count overstated`,
      ).toBe(false);
      expect(pricedWordCount(text), `case ${i}: priced count must exclude the footers`).toBeLessThan(
        countWords(text),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The guarantee, on real production content.
// ---------------------------------------------------------------------------

function expectSameRung(a: RungCensus, b: RungCensus, label: string): void {
  expect(a, label).toEqual(b);
}

describe('attribution does not move the eviction ladder', () => {
  it('⭐⭐ on every real production draft, marking our own options evicts NOTHING', () => {
    for (const [i, c] of CAPTURE_CASES.entries()) {
      const on = narrativeFor(c, false);
      const off = narrativeFor(c, true);
      expectSameRung(
        rungCensus(on),
        rungCensus(off),
        `case ${i}: attribution moved the ladder — a coaching section was evicted to pay for the marker`,
      );
    }
  });

  it('the priced content stays within the producer’s own budget', () => {
    // ⚠ SELF-SATISFYING AT RUNGS 1-4 BY CONSTRUCTION — the assembler returns
    // only when this holds. It is kept because it is NOT self-satisfying at the
    // TERMINAL rung, which takes no budget check: if a draft ever falls all the
    // way through the ladder and still overruns, this is the line that says so.
    for (const [i, c] of CAPTURE_CASES.entries()) {
      expect(pricedWordCount(narrativeFor(c, false).text), `case ${i}`).toBeLessThanOrEqual(
        MAX_WORDS,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The mechanism: what BOUNDS the cost. Synthetic, because no real case reaches
// the marker's worst case.
// ---------------------------------------------------------------------------

const SYNTHETIC_LABELS = [
  'Outsource the rural routes to a partner',
  'Keep deliveries in house',
  'Introduce a rural surcharge',
  'Consolidate drops to alternate days',
  'Partner with a locker network',
  'Reduce the rural service area',
  'Shift rural drops to a weekly run',
  'Raise the free-delivery threshold',
];

/** No digits anywhere: no dropped-figure notice, and `thin` is not refuted. */
const SYNTHETIC_BRIEF =
  'We need to decide how to handle rural deliveries next year without hurting margin.';

function syntheticNarrative(optionCount: number, attributed: boolean) {
  const options = SYNTHETIC_LABELS.slice(0, optionCount).map((label, i) => ({
    id: `o${i + 1}`,
    kind: 'option',
    label,
    ...(attributed
      ? { provenance: 'ai_inferred' }
      : { provenance: 'from_brief', source_quote: label.toLowerCase() }),
  }));
  return buildPostDraftNarrative({
    graph: {
      nodes: [
        {
          id: 'g1',
          kind: 'goal',
          provenance: 'from_brief',
          source_quote: 'protect margin on rural deliveries',
          label: 'Protect margin on rural deliveries',
        },
        ...options,
        { id: 'f1', kind: 'factor', label: 'Rural delivery cost per drop' },
      ],
      edges: [],
    } as never,
    analysisReady: { status: 'needs_user_input' } as never,
    briefText: SYNTHETIC_BRIEF,
    wideningLog: { brief_completeness: 'thin' } as never,
  });
}

/** The marker's MEASURED cost at one option count: the product run both ways. */
function attributionCost(optionCount: number): number {
  return (
    pricedWordCount(syntheticNarrative(optionCount, true).text) -
    pricedWordCount(syntheticNarrative(optionCount, false).text)
  );
}

const OPTION_COUNTS = [1, 2, 3, 4, 5, 8];

describe('the attribution cost is CAPPED by the naming cap, and is not monotone', () => {
  it('⭐ the worst case is the naming cap, MEASURED — not computed from the marker’s length', () => {
    const costs = OPTION_COUNTS.map(attributionCost);
    const worst = Math.max(...costs);
    // Derived both sides: at most `MAX_NAMED_OPTIONS` bullets are NAMED, so at
    // most that many can carry the marker, each costing `countWords(marker)`.
    expect(
      worst,
      'the measured worst-case attribution cost no longer matches the naming cap × the marker',
    ).toBe(MAX_NAMED_OPTIONS * countWords(CEE_PROPOSED_MARKER));
  });

  it('⭐ the cost FALLS past the naming cap — it is bounded, not monotone in option count', () => {
    // Past the cap the inventory names only `MAX_LISTED_WHEN_OVER` options and
    // summarises the rest, so more options buy FEWER markers. A guard that
    // assumed "more options ⇒ more words" would be sized to a risk the product
    // does not have.
    const atCap = attributionCost(MAX_NAMED_OPTIONS);
    const wellOver = attributionCost(8);
    expect(atCap, 'PRECONDITION: the cap must be the peak').toBeGreaterThan(0);
    expect(wellOver, 'past the naming cap the attribution cost must not grow').toBeLessThan(atCap);
  });

  it('⭐⭐ AT THE MECHANISM’S WORST CASE the ladder still does not move', () => {
    const on = syntheticNarrative(MAX_NAMED_OPTIONS, true);
    const off = syntheticNarrative(MAX_NAMED_OPTIONS, false);
    // PRECONDITION (trap 13b): this fixture must actually be at the worst case,
    // or the assertion below is about an ordinary draft.
    expect(
      markerCount(on.text),
      'PRECONDITION: every named option must carry the marker here',
    ).toBe(MAX_NAMED_OPTIONS);
    expect(markerCount(off.text), 'PRECONDITION: the control arm carries none').toBe(0);
    // …and the fixture must have something to lose.
    const onCensus = rungCensus(on);
    expect(onCensus.hasOptions && onCensus.hasWeighing && onCensus.hasCompleteness).toBe(true);

    expectSameRung(
      onCensus,
      rungCensus(off),
      'at four invented options the marker evicted a coaching section',
    );
  });
});

// ---------------------------------------------------------------------------
// The margin. This is the early warning: it REDs while the product is still
// correct, rather than after a section has already been deleted.
// ---------------------------------------------------------------------------

describe('the margin between real drafts and the budget', () => {
  it('⭐ every real draft leaves room for the marker’s worst case, with the cost MEASURED', () => {
    const worstCost = Math.max(...OPTION_COUNTS.map(attributionCost));
    for (const [i, c] of CAPTURE_CASES.entries()) {
      const headroom = MAX_WORDS - pricedWordCount(narrativeFor(c, false).text);
      expect(
        headroom,
        `case ${i}: a real draft is now within ${worstCost} words of the budget — the next ` +
          'attribution marker will be paid for by evicting coaching',
      ).toBeGreaterThanOrEqual(worstCost);
    }
  });
});
