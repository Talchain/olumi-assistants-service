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
   * THE KNOWN GAPS — pinned as an EXACT set, so the suite is green for
   * the right reason and REDs if the set either grows OR shrinks.
   * (Trap 22f: a gap recorded in the suite is honest; a gap invisible to
   * it is how four rounds of the same defect happened.)
   * ----------------------------------------------------------------- */

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
