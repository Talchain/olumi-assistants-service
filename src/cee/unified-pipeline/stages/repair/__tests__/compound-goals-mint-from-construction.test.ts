/**
 * ROADMAP 2.1051 (limb 2) — MINT FROM THE CONSTRUCTION VERDICT.
 *
 * ⚠⚠ THE DEFECT THIS FILE PINS, WITNESSED ON DEPLOYED STAGING (build 32f06dd,
 * 2026-08-10). A board-level hard limit —
 *
 *     "Do not let CSAT drop below 85% — that is a hard limit for the board"
 *
 * — reaches the wire as NOTHING. Every hop is individually correct:
 *
 *   · the direction gate's construction table PROVES the direction
 *     (`findT1Matches` -> T1-2, floor, subject "CSAT", 0.85);
 *   · the extractor's `suppressionWindow` correctly refuses to mint the
 *     INVERTED ceiling reading its `below` pattern would otherwise produce;
 *   · and `NEGATION_LEAD` does not contain `do not` / `don't` / `does not`,
 *     so `NEGATED_FLOOR_PATTERNS` mints nothing either.
 *
 * Net output is SILENCE with the anti-lie property intact. The machinery to
 * handle the sentence already exists and already works — it had nowhere to
 * project. This file pins the projection.
 *
 * ⭐ WHY NOT WIDEN `NEGATION_LEAD`. Ruled out (trap 22f: the predicate is
 * unwinnable by lexicon rounds) and unsafe: `NEGATION_LEAD` is BIDIRECTIONAL —
 * it also drives `suppressionWindow` — so widening it reopens the
 * over-suppression class that dropped 13 of 14 legitimate ceilings. The mint
 * reuses the corpus-hardened T1 table instead of growing a second, weaker
 * lexicon beside it.
 *
 * ⭐ FIXTURES ARE CAPTURED, NOT AUTHORED. The node sets come from three fresh
 * guest sessions against deployed staging with the build pinned at both ends.
 * A self-authored node set encodes the author's model of the producer rather
 * than the producer (trap 16-inverse) — and it would have hidden the binding
 * defect this file's `out_csat` assertions exist to prevent.
 *
 * Every assertion binds by node-id IDENTITY, never by a value predicate another
 * row could satisfy (trap 19).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runCompoundGoals } from '../compound-goals.js';
import {
  hasExplicitAmbiguity,
  hasUnspentNegation,
  findT1Matches,
  findProvenUncoveredBounds,
} from '../../../../compound-goal/direction-gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Captured {
  readonly draft_message: string;
  readonly intake_message: string;
  readonly runs: Record<string, { nodes: Array<{ id: string; kind?: string; label?: string }> }>;
}

const CAPTURED = JSON.parse(
  readFileSync(resolve(HERE, '../../../../compound-goal/__tests__/fixtures/live-4day-week.captured.json'), 'utf-8'),
) as Captured;

/** The sentence the live browser witness proved is lost. */
const LIVE_BRIEF = CAPTURED.draft_message;
const RUN_IDS = ['live_r1', 'live_r2', 'live_r3'] as const;

interface RunResult {
  readonly wire: Array<{ node_id: string; operator: string; value: number; unit?: string; quote?: string; frame?: string }>;
  readonly asks: Array<{ metric_text: string; amount_text: string; reason: string }>;
}

function run(brief: string, nodes: ReadonlyArray<{ id: string; kind?: string; label?: string }>, llm?: unknown[]): RunResult {
  const ctx: any = {
    requestId: 'test-mint-from-construction',
    effectiveBrief: brief,
    graph: { nodes: nodes.map((n) => ({ ...n })), edges: [] },
    llmGoalConstraints: llm,
    goalConstraints: undefined,
    directionUnresolved: undefined,
  };
  runCompoundGoals(ctx);
  return {
    wire: (ctx.goalConstraints ?? []).map((c: any) => ({
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      unit: c.unit,
      quote: c.source_quote,
      frame: c.value_frame,
    })),
    asks: (ctx.directionUnresolved ?? []).map((i: any) => ({
      metric_text: i.metric_text,
      amount_text: i.amount_text,
      reason: i.reason,
    })),
  };
}

/** A model-emitted row in the `GoalConstraintSchema` shape. */
function llmRow(node_id: string, operator: '>=' | '<=', value: number, source_quote: string, unit = 'fraction') {
  return {
    constraint_id: `llm_${node_id}_${operator === '>=' ? 'min' : 'max'}`,
    node_id,
    operator,
    value,
    unit,
    label: `${operator === '>=' ? 'At or above' : 'At or below'} ${value}`,
    source_quote,
    confidence: 0.85,
    provenance: 'explicit',
  };
}

describe('ROADMAP 2.1051 limb 2 — mint the bound the construction table already proves', () => {
  it('COLLECTION GUARD: this spec collects a non-zero test count', () => {
    // Trap 2b, sharp form: a NEW spec collecting zero is invisible to the suite
    // total, the exit code AND the failure count simultaneously.
    expect(RUN_IDS.length).toBe(3);
  });

  /* -------------------------------------------------------------------
   * THE LIVE SENTENCE — the whole point of the change.
   * ----------------------------------------------------------------- */

  it.each(RUN_IDS)(
    'LIVE WITNESS (%s): the CSAT floor reaches the wire as >= 0.85 bound to out_csat',
    (runId) => {
      const r = run(LIVE_BRIEF, CAPTURED.runs[runId]!.nodes);

      // Bound BY IDENTITY to the resolved node, not by "some row with 0.85".
      const csat = r.wire.filter((w) => w.node_id === 'out_csat');
      expect(csat, 'the user\'s CSAT floor must reach the wire on out_csat').toHaveLength(1);
      expect(csat[0]!.operator).toBe('>=');
      expect(csat[0]!.value).toBeCloseTo(0.85, 10);
      // The frame is what stops ISL refusing the whole constraint block.
      expect(csat[0]!.frame).toBe('level');
      // The quote must still support the row it is attached to.
      expect(String(csat[0]!.quote).toLowerCase()).toContain('csat');

      // ⭐ THE MIS-BINDING GUARD. `goal_4day_success` carries "CSAT" in its
      // LLM-authored label in every captured run, and the shared fuzzy matcher
      // will happily bind a `fac_`-prefixed candidate to it (measured). A
      // percentage floor welded onto the goal node is the unit-mismatch class
      // that put the temporal gate at the top of compound-goals.ts. It must
      // never happen, and this assertion is the reason the mint restricts its
      // candidate nodes to measurable kinds.
      expect(
        r.wire.filter((w) => w.node_id === 'goal_4day_success'),
        'a metric bound must never be welded onto the goal node',
      ).toEqual([]);
    },
  );

  it.each(RUN_IDS)(
    'LIVE WITNESS (%s): the CSAT floor is no longer merely ASKED about once it is captured',
    (runId) => {
      const r = run(LIVE_BRIEF, CAPTURED.runs[runId]!.nodes);
      expect(
        r.asks.filter((a) => /csat/i.test(a.metric_text)),
        'a captured limit is an answer, not a question',
      ).toEqual([]);
    },
  );

  it.each(RUN_IDS)(
    'CEILING TWIN (%s): the £250,000 ceiling is untouched by the mint',
    (runId) => {
      // The opposite-direction twin of the case being fixed (trap 22b). This
      // row is minted by the ordinary extractor and must stay exactly as it
      // was — a fix that captures floors by corrupting ceilings is a trade,
      // not a fix.
      const r = run(LIVE_BRIEF, CAPTURED.runs[runId]!.nodes);
      const spend = r.wire.filter((w) => w.node_id === 'fac_impl_spend');
      expect(spend).toHaveLength(1);
      expect(spend[0]!.operator).toBe('<=');
      expect(spend[0]!.value).toBe(250000);
    },
  );

  it('the LIVE brief yields EXACTLY the two limits the user stated — no third row invented', () => {
    const r = run(LIVE_BRIEF, CAPTURED.runs.live_r1!.nodes);
    expect(
      r.wire.map((w) => `${w.node_id}${w.operator}${w.value}`).sort(),
      'the brief states two limits; the wire must carry two',
    ).toEqual(['fac_impl_spend<=250000', 'out_csat>=0.85']);
  });

  /* -------------------------------------------------------------------
   * THE ANTI-LIE PROPERTY — what must still be WITHHELD.
   * ----------------------------------------------------------------- */

  it('ANTI-LIE: an explicitly ambiguous sentence still ASKS and mints NOTHING', () => {
    // S1 outranks the mint exactly as it outranks the construction verdict in
    // the partition. A user who said they had not decided gets a question.
    const brief = 'We are unsure whether 85% is a floor or a ceiling for CSAT.';
    const r = run(brief, CAPTURED.runs.live_r1!.nodes);
    expect(r.wire.filter((w) => w.node_id === 'out_csat'), 'nothing may be minted from a declared unknown').toEqual([]);
    expect(r.asks.length, 'and the user must be asked').toBeGreaterThan(0);
  });

  it('ANTI-LIE: ambiguity outranks a PROVEN construction in the same sentence', () => {
    // ⚠⚠ ADDED AFTER A SURVIVING MUTANT. The case above cannot see this rule at
    // all: its sentence carries NO T1 construction, so the mint declines for a
    // reason that has nothing to do with S1, and a mutant bypassing the
    // ambiguity screen entirely survived it (trap 13b — a guard whose
    // discrimination depends on a fixture that never exercises the path).
    //
    // This sentence carries BOTH, which is what makes it discriminating.
    const brief = 'We are still deciding the target, so do not let CSAT drop below 85% for now.';

    // PRECONDITION PINNED IN-TEST: the outcome below is only the ambiguity
    // screen's doing if the construction really is proven here. Without this,
    // a change that broke T1 on this sentence would leave the test passing for
    // entirely the wrong reason.
    expect(hasExplicitAmbiguity(brief), 'fixture must declare its own ambiguity').toBe(true);
    expect(
      findT1Matches(brief).map((m) => `${m.id}:${m.direction}`),
      'fixture must ALSO carry a proven construction, or this proves nothing',
    ).toContain('T1-2:floor');

    const r = run(brief, CAPTURED.runs.live_r1!.nodes);
    expect(r.wire.filter((w) => w.node_id === 'out_csat'), 'a declared unknown is asked, never minted').toEqual([]);
    expect(r.asks.length).toBeGreaterThan(0);
  });

  it('ANTI-LIE: a bare comparator with NO construction verdict mints nothing new', () => {
    // "…could rise above 3%" is a RISK, not a requirement. The mint fires only
    // on a PROVEN construction; a sentence the T1 table does not recognise must
    // leave the existing behaviour exactly as it was.
    const brief = 'Do not proceed if morale suffers. CSAT could fall below 85% during the transition.';
    const r = run(brief, CAPTURED.runs.live_r1!.nodes);
    expect(r.wire.filter((w) => w.node_id === 'out_csat')).toEqual([]);
  });

  it('ANTI-LIE: a bound with no resolvable node mints nothing (fail closed, the ask survives)', () => {
    // "gross margin" names no node in this captured graph. Binding by identity
    // means no identity, no row — and the question stays.
    const brief = 'Do not let gross margin drop below 78%.';
    const r = run(brief, CAPTURED.runs.live_r1!.nodes);
    expect(r.wire, 'no node named gross margin exists, so no row may be minted').toEqual([]);
    expect(r.asks.length, 'the clarification is what the user gets instead').toBeGreaterThan(0);
  });

  it('ANTI-LIE: the mint NEVER overwrites a producer row on the same node+operator', () => {
    // A producer row that covers the bound is the row that ships, whatever the
    // construction table thinks. The mint fills a HOLE; it does not compete.
    const r = run(LIVE_BRIEF, CAPTURED.runs.live_r1!.nodes, [
      llmRow('out_csat', '>=', 0.85, 'Do not let CSAT drop below 85%', '%'),
    ]);
    const csat = r.wire.filter((w) => w.node_id === 'out_csat' && w.operator === '>=');
    expect(csat).toHaveLength(1);
    expect(csat[0]!.quote, 'the producer row survives, not a minted duplicate').toBe(
      'Do not let CSAT drop below 85%',
    );
  });

  it('ANTI-LIE: the mint never REPLACES a producer limit that shares its node and operator', () => {
    // ⚠⚠ ADDED AFTER A SURVIVING MUTANT, AND THE SURVIVOR WAS A CORPUS HOLE,
    // NOT AN EQUIVALENT MUTANT (trap 13c: a survivor is a claim either way, and
    // this one had to be settled by a discriminating fixture rather than by
    // argument).
    //
    // The `merged.has(key)` guard looks redundant beside the coverage check —
    // and it is NOT, because the two are keyed on different things. Coverage is
    // by VALUE; the merge key is NODE + OPERATOR. So a producer holding
    // `out_csat >= 0.90` does not cover a brief that states 0.85: the mint
    // fires, produces `out_csat >= 0.85`, and lands on the producer's own key.
    // Without the guard it OVERWRITES a stricter limit with a looser one, and
    // the user silently loses the tighter constraint they were given.
    //
    // PRECONDITION PINNED IN-TEST: the mint must genuinely still be firing at
    // 0.85 given 0.90 is taken, or this asserts nothing.
    // The producer's quote must be VERIFIABLE in the brief, or the gate
    // withholds its row for want of evidence and the collision never happens —
    // a fixture that cannot reach the code path proves nothing about it.
    const brief = 'CSAT must stay at or above 90%. Do not let CSAT drop below 85%.';
    expect(
      findProvenUncoveredBounds(brief, [0.9]).map((b) => b.value),
      'the 0.85 bound must still be uncovered when a producer holds 0.90',
    ).toEqual([0.85]);

    const r = run(brief, CAPTURED.runs.live_r1!.nodes, [
      llmRow('out_csat', '>=', 0.9, 'CSAT must stay at or above 90%', '%'),
    ]);
    const floors = r.wire.filter((w) => w.node_id === 'out_csat' && w.operator === '>=');
    expect(floors, 'one row on this key, not two').toHaveLength(1);
    expect(floors[0]!.value, 'the PRODUCER\'s limit survives — the mint must not replace it').toBeCloseTo(0.9, 10);
  });

  it('ANTI-LIE: an LLM INVERSE on the same bound is still withheld, and the mint does not rescue it', () => {
    // The e3 case. A fabricated `<=` on a floor must not reach the wire, and
    // the mint must not quietly supply the `>=` that makes the contradiction
    // look resolved — the pair is contested and the user is asked.
    const r = run(LIVE_BRIEF, CAPTURED.runs.live_r1!.nodes, [
      llmRow('out_csat', '<=', 0.85, 'Do not let CSAT drop below 85%', '%'),
    ]);
    expect(
      r.wire.filter((w) => w.node_id === 'out_csat' && w.operator === '<='),
      'the inverse must never reach the wire',
    ).toEqual([]);
  });

  /* -------------------------------------------------------------------
   * THE CONTRACTION / APOSTROPHE FORMS the old lexicon could not reach.
   * ----------------------------------------------------------------- */

  it.each([
    ['straight apostrophe', "Don't let CSAT drop below 85%."],
    ['curly apostrophe', 'Don’t let CSAT drop below 85%.'],
    ['does not', 'Ensure CSAT doesn’t drop below 85%.'],
    ['prevention construction', 'Keep CSAT from falling below 85%.'],
  ])('CONTRACTION FORM (%s) now reaches the wire as a floor on out_csat', (_name, brief) => {
    const r = run(brief, CAPTURED.runs.live_r1!.nodes);
    const csat = r.wire.filter((w) => w.node_id === 'out_csat');
    expect(csat).toHaveLength(1);
    expect(csat[0]!.operator).toBe('>=');
    expect(csat[0]!.value).toBeCloseTo(0.85, 10);
  });

  /* -------------------------------------------------------------------
   * OUTER NEGATION — the mint must never assert a limit the user REVOKED.
   *
   * ⚠⚠ ROUND-1 REVIEW BLOCKER. The first cut of this change ASSERTED on all
   * four of these while `origin/staging` correctly ASKED — a regression against
   * the deployed build, in the mint-a-lie direction, which is the one thing
   * this gate exists to make impossible.
   *
   * MECHANISM: the mint applied S1 but never S3 (`hasUnspentNegation`), and S3
   * is unreachable for these rows BY DESIGN — a row carrying its own T1 verdict
   * is decided by S2 and never reaches it. That is correct for a producer's row
   * (the row is evidence in its own right) and wrong for a mint (which has no
   * row and manufactures one from the construction alone).
   * ----------------------------------------------------------------- */

  it.each([
    ['do not need to', 'We do not need to keep CSAT from falling below 85%.'],
    ['there is no requirement', 'There is no requirement that CSAT must not drop below 85%.'],
    ['never agreed', 'We never agreed to keep CSAT from falling below 85%.'],
    ['no longer requiring', 'We are no longer requiring that CSAT does not drop below 85%.'],
  ])('OUTER NEGATION (%s): the mint asserts NOTHING and the ask stands', (_name, brief) => {
    // PRECONDITION PINNED IN-TEST: the construction really is proven here, so
    // the empty wire below is the outer-negation screen's doing and not a T1
    // miss. Without this the test would pass for entirely the wrong reason.
    expect(
      findT1Matches(brief).length,
      'fixture must carry a proven construction, or this proves nothing',
    ).toBeGreaterThan(0);

    const r = run(brief, CAPTURED.runs.live_r1!.nodes);
    expect(
      r.wire.filter((w) => w.node_id === 'out_csat'),
      'a revoked limit must never be asserted',
    ).toEqual([]);
    expect(r.asks.length, 'the user is asked, exactly as the deployed build does').toBeGreaterThan(0);
  });

  it('OUTER NEGATION does not suppress a legitimate metric whose NAME contains a negation token', () => {
    // The opposite-direction twin (trap 22b). `no-show rate` is a compound, not
    // a negation, and the hardened predicate knows it: `no(?=\s)` matches only
    // before whitespace. A hand-rolled `\bno\b` would have suppressed this —
    // which is precisely the defect that lexicon's own comment records.
    expect(hasUnspentNegation('Keep no-show rate'), 'the compound must not read as a negation').toBe(false);
    const nodes = [
      { id: 'goal_x', kind: 'goal', label: 'Reduce waste' },
      { id: 'fac_no_show_rate', kind: 'factor', label: 'No-show rate' },
    ];
    const r = run('Keep no-show rate from rising above 3%.', nodes);
    const rows = r.wire.filter((w) => w.node_id === 'fac_no_show_rate');
    expect(rows, 'a legitimate ceiling on a no-prefixed metric must still ship').toHaveLength(1);
    expect(rows[0]!.operator).toBe('<=');
  });

  /* -------------------------------------------------------------------
   * THE TWO BINDING GUARDS — each is the ONLY thing preventing a wrong
   * row, and each survived the first mutant round unpinned.
   * ----------------------------------------------------------------- */

  it('M-C: a subject that resolves in TWO node families mints NOTHING', () => {
    // The exactly-one-node rule. This graph carries BOTH `fac_csat` and
    // `out_csat`, so the two candidate families resolve to two different nodes
    // and the mint cannot tell which the user meant. Without the guard it takes
    // whichever family was tried last — a hard limit bound to a node chosen by
    // loop order. An ambiguity is a question, not a row.
    const twoFamily = [
      { id: 'goal_x', kind: 'goal', label: 'Ship the thing' },
      { id: 'fac_csat', kind: 'factor', label: 'CSAT driver' },
      { id: 'out_csat', kind: 'outcome', label: 'Customer Satisfaction Score' },
    ];
    // PRECONDITION: both candidates must genuinely resolve, or the guard is
    // never exercised and this test passes by testing nothing.
    expect(twoFamily.filter((n) => /^(fac|out)_csat$/.test(n.id)), 'both families must be present').toHaveLength(2);

    const r = run('Do not let CSAT drop below 85%.', twoFamily);
    expect(r.wire, 'two candidate nodes is an ambiguity, and an ambiguity is asked').toEqual([]);
    expect(r.asks.length).toBeGreaterThan(0);
  });

  it('M-F: contradictory directions on ONE quantity mint NOTHING, at UNEQUAL match lengths', () => {
    // ⚠ FOUND BY MEASUREMENT, AND IT WIDENED THE GUARD. The original rule only
    // declined an EQUAL-LENGTH tie, and this sentence is not one:
    //   T1-5:ceiling(19), T1-5b:ceiling(23), T1-7b:floor(24) — all on 0.85.
    // "Longest wins" therefore handed the user a FLOOR, one side of a
    // contradiction they wrote, chosen by four characters of regex. The rule is
    // now ANY disagreement on one quantity.
    const brief = 'CSAT must stay above 85% and must not exceed 85%.';

    // PRECONDITION PINNED IN-TEST: the disagreement must be real AND the
    // lengths must be UNEQUAL, or this pins the old rule rather than the new one.
    const onValue = findT1Matches(brief).filter((m) => Math.abs(m.value - 0.85) < 1e-9);
    expect(new Set(onValue.map((m) => m.direction)).size, 'the fixture must actually disagree').toBe(2);
    const longest = onValue.reduce((a, b) => (b.length > a.length ? b : a));
    expect(
      onValue.some((m) => m.length === longest.length && m.direction !== longest.direction),
      'the lengths must be UNEQUAL — an equal-length tie would pin the OLD rule',
    ).toBe(false);

    expect(
      findProvenUncoveredBounds(brief, []),
      'a contradiction is withheld, never resolved by match length',
    ).toEqual([]);
    const r = run(brief, CAPTURED.runs.live_r1!.nodes);
    expect(r.wire.filter((w) => w.node_id === 'out_csat')).toEqual([]);
  });

  it('CONTROL: agreeing constructions of unequal length still mint (the guard is not a blanket refusal)', () => {
    // The positive control for the rule above: `must not exceed` matches T1-5
    // AND T1-5b at different lengths, both CEILING. Agreement at unequal length
    // must still mint, or the widened guard would simply have stopped the mint
    // working and every assertion above would be vacuous.
    //
    // ⚠ THE SENTENCE IS THE CAPTURED BRIEF'S OWN, and picking it was not
    // cosmetic. The first draft of this control used the shortened "Spend must
    // not exceed £250,000." and FAILED — not because the guard over-suppressed,
    // but because `deriveMetricText` lists a bare `spend` as a subject NOISE
    // word, so the metric cleaned away to nothing and the mint declined for an
    // unrelated reason. A control that fails for the wrong reason would have
    // sent this round chasing a phantom oscillation.
    const brief = 'Total implementation spend must not exceed £250,000.';
    const onValue = findT1Matches(brief).filter((m) => m.value === 250000);
    expect(new Set(onValue.map((m) => m.length)).size, 'lengths must differ').toBeGreaterThan(1);
    expect(new Set(onValue.map((m) => m.direction)).size, 'and directions must agree').toBe(1);
    expect(findProvenUncoveredBounds(brief, []).map((b) => b.direction)).toEqual(['ceiling']);
  });

  /* -------------------------------------------------------------------
   * THE KNOWN GAPS — pinned as an EXACT set, so the suite is green for
   * the right reason and REDs if the set either grows OR shrinks.
   * (Trap 22f: a gap recorded in the suite is honest; a gap invisible to
   * it is how four rounds of the same defect happened.)
   * ----------------------------------------------------------------- */

  it('KNOWN GAP — outer negation over the EXTRACTOR path, pinned as an EXACT set', () => {
    // ⚠⚠ THESE ARE NOT THIS LANE'S TO FIX, AND THE SUITE SAYS SO OUT LOUD.
    //
    // Measured on `origin/staging` (32f06dd) with an identical probe: these four
    // sentences ALREADY assert a limit the user revoked, via the extractor's own
    // `must not` / `cannot` path — `NEGATION_LEAD` mints a floor and nothing
    // screens the outer negation, exactly as the mint did before its S3 screen.
    // This PR neither introduces nor changes them; the wire is byte-identical to
    // baseline on all four.
    //
    // Fixing them means screening the EXTRACTOR's own negated-floor branch,
    // which changes minting for every brief in the estate and is a separate,
    // re-briefed piece of work. Recorded here so it is visible in the suite
    // rather than invisible (trap 22f: a gap recorded is honest; a gap the suite
    // cannot see is how four rounds of the same defect happened).
    //
    // Asserted as an EXACT SET so it REDs if the set GROWS (a new leak) or
    // SHRINKS (someone fixed it and this note went stale).
    const OUTER_NEGATION_STILL_ASSERTED_BY_THE_EXTRACTOR = [
      'It is not true that we must not let CSAT drop below 85%.',
      'Nobody said we must not let CSAT drop below 85%.',
      'I would not say we must not let CSAT drop below 85%.',
      "Don't assume we must not let CSAT drop below 85%.",
    ] as const;

    const stillAsserting = OUTER_NEGATION_STILL_ASSERTED_BY_THE_EXTRACTOR.filter((brief) => {
      const r = run(brief, CAPTURED.runs.live_r1!.nodes);
      return r.wire.length > 0;
    });
    expect(
      [...stillAsserting].sort(),
      'the known-leak set must not grow (a new leak) or shrink (a stale note)',
    ).toEqual([...OUTER_NEGATION_STILL_ASSERTED_BY_THE_EXTRACTOR].sort());

    // And the row they leak is the EXTRACTOR's, on the goal node — never the
    // mint's. If one of these ever lands on `out_csat`, the mint has started
    // contributing to the leak and that is this lane's problem again.
    for (const brief of OUTER_NEGATION_STILL_ASSERTED_BY_THE_EXTRACTOR) {
      const r = run(brief, CAPTURED.runs.live_r1!.nodes);
      expect(r.wire.map((w) => w.node_id), `${brief} must not leak via the mint`).toEqual(['goal_4day_success']);
    }
  });

  it('KNOWN GAP — an INTERRUPTED construction is not proven, so it is ASKED, not minted', () => {
    // T1 is ADJACENCY-BOUND by ruling: no window constants, no clause
    // discrimination — the two things trap 22f closed. A parenthetical between
    // the negation and the verb therefore breaks the construction, and the
    // honest output is the question the detector already raises.
    //
    // This is a DELIBERATE limit of the mint, not an oversight. If a later
    // change makes T1 span interruptions, this test REDs and the change gets
    // the review the widening deserves.
    const brief = 'Do not, under any circumstances, let CSAT drop below 85%.';
    const r = run(brief, CAPTURED.runs.live_r1!.nodes);
    expect(r.wire.filter((w) => w.node_id === 'out_csat'), 'no proven verdict, so no row').toEqual([]);
    expect(r.asks.length, 'and the user is asked instead — the bound is never silent').toBeGreaterThan(0);
  });

  it('KNOWN GAP (pre-existing, NOT changed by this lane): `must not` binds to the GOAL node', () => {
    // ⚠⚠ MEASURED, AND IT IS THE SHARPER HALF OF THE LIVE DEFECT.
    //
    // `must not` IS in `NEGATION_LEAD`, so the ordinary extractor mints a row —
    // and the shared remap binds it to `goal_4day_success`, because that node's
    // LLM-authored label contains "CSAT Floor" and `fuzzyMatchNodeId` REFUSES
    // TO CROSS NODE FAMILIES (`fac_csat` can never reach `out_csat`). The
    // correctly-measured node is right there, unreached.
    //
    // The mint cannot repair this: a producer row already carries 0.85, so the
    // bound is COVERED and the mint deliberately stands down rather than
    // compete with a producer. Fixing it means changing the shared matcher's
    // family rule, which moves the binding of EVERY producer row in the estate
    // — out of this lane's scope and re-briefed rather than smuggled in.
    //
    // Pinned so the residue is visible in the suite. A future fix to the
    // matcher REDs this test, which is exactly when someone should look.
    const r = run('We must not let CSAT drop below 85%.', CAPTURED.runs.live_r1!.nodes);
    const floors = r.wire.filter((w) => w.operator === '>=');
    expect(floors, 'the floor is still captured — no regression').toHaveLength(1);
    expect(floors[0]!.value).toBeCloseTo(0.85, 10);
    expect(floors[0]!.node_id, 'still the goal node: this lane did not change it').toBe('goal_4day_success');
  });

  it('CONTROL: the mint produces a BETTER binding than the path it stands in for', () => {
    // The positive control that makes the gap above legible. The identical
    // limit, phrased so the extractor's lexicon cannot see it, is minted by
    // this change and lands on the MEASURED node rather than the goal.
    const viaMint = run("Don't let CSAT drop below 85%.", CAPTURED.runs.live_r1!.nodes);
    const viaExtractor = run('We must not let CSAT drop below 85%.', CAPTURED.runs.live_r1!.nodes);
    expect(viaMint.wire.map((w) => w.node_id)).toEqual(['out_csat']);
    expect(viaExtractor.wire.map((w) => w.node_id)).toEqual(['goal_4day_success']);
  });

  /* -------------------------------------------------------------------
   * DETERMINISM — the decision is a function of the row, not a sample.
   * ----------------------------------------------------------------- */

  it('the outcome is a FUNCTION of the input: 50 identical runs give one identical answer', () => {
    // A parallel lane reported run-to-run variance in this area. Measured here:
    // with the input held byte-identical the pipeline is deterministic, so any
    // observed variance lives upstream in the LLM-authored GRAPH, not here.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const r = run(LIVE_BRIEF, CAPTURED.runs.live_r1!.nodes);
      seen.add(JSON.stringify(r.wire.map((w) => `${w.node_id}${w.operator}${w.value}`).sort()));
    }
    expect([...seen]).toHaveLength(1);
  });
});
