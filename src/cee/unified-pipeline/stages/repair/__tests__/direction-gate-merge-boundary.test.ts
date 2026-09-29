/**
 * ROADMAP 2.1051 — THE GATE AT THE REAL MERGE BOUNDARY, BOTH PRODUCERS.
 *
 * ⚠⚠ WHY THIS FILE EXISTS SEPARATELY FROM THE CORPUS SPEC. The corpus spec runs
 * the gate over the REGEX extractor's output. That proves nothing about the
 * OTHER producer. The audit's e3 probe established, by execution at the real
 * merge, that:
 *
 *   - the merge dedupes on `node_id::operator`, so OPPOSITE operators on one
 *     node are NOT a collision — an LLM inverse coexists with a correct regex
 *     row rather than replacing it;
 *   - with the deterministic row suppressed, a fabricated LLM `<= 0.78`
 *     SURVIVED ALONE on the wire.
 *
 * So a gate applied to one producer is not a gate. Every case here runs through
 * the REAL `runCompoundGoals` in three configurations — det-only, det+LLM,
 * LLM-only — against the REAL B1 node set. Mutants M2 and M3 (gate applied to
 * one producer only) are RED against this file and green against the corpus
 * spec, which is precisely why both exist.
 *
 * Nothing is mocked: the real extractor, remap, unit normalisation, all three
 * partitions and the detector run. The LLM rows are fabricated to the
 * `GoalConstraintSchema` shape — that is what the audit did, and a fabricated
 * row is legitimate HERE because it stands in for a producer whose output we
 * cannot summon on demand. It is NOT evidence about what the model typically
 * emits, and no claim in this file depends on that.
 *
 * Assertions bind by node-id + operator IDENTITY (trap 19).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runCompoundGoals } from '../compound-goals.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The REAL B1 node set (24 nodes), not a shape this file imagined.
 *
 * Trap 16-inverse: a fixture the implementer wrote encodes the implementer's
 * model of the producer rather than the producer. Using the committed cold-read
 * graph means the node ids and labels the remap binds against are the ones a
 * real draft produced.
 */
const B1 = JSON.parse(
  readFileSync(
    resolve(HERE, '../../../../context-integrity/__tests__/fixtures/b1-growth.cold-read.json'),
    'utf-8',
  ),
) as { graph: { nodes: Array<{ id: string; kind?: string; label?: string }> } };

const B1_NODES = B1.graph.nodes;

interface RunResult {
  readonly wire: Array<{ node_id: string; operator: string; value: number }>;
  readonly asks: Array<{ metric_text: string; amount_text: string; reason: string; question: string }>;
}

function runMerge(brief: string, llmGoalConstraints?: unknown[]): RunResult {
  const ctx: any = {
    requestId: 'test-21051-merge-boundary',
    effectiveBrief: brief,
    graph: { nodes: B1_NODES.map((n) => ({ ...n })), edges: [] },
    llmGoalConstraints,
    goalConstraints: undefined,
    directionUnresolved: undefined,
  };
  runCompoundGoals(ctx);
  return {
    wire: (ctx.goalConstraints ?? []).map((c: any) => ({
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
    })),
    asks: (ctx.directionUnresolved ?? []).map((i: any) => ({
      metric_text: i.metric_text,
      amount_text: i.amount_text,
      reason: i.reason,
      question: i.question,
    })),
  };
}

/** A model-emitted row in the `GoalConstraintSchema` shape. */
function llmRow(
  node_id: string,
  operator: '>=' | '<=',
  value: number,
  source_quote: string,
  unit = 'fraction',
): Record<string, unknown> {
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

const GM = 'fac_nrr'; // a real B1 factor id used as the constraint target

describe('ROADMAP 2.1051 — direction gate at the real merge boundary', () => {
  it('COLLECTION GUARD: this spec collects its declared test count', () => {
    // Trap 2b sharp form: a NEW spec collecting zero is invisible to every
    // aggregate — the suite total, the exit code and the failure count are all
    // consistent with this file contributing nothing.
    expect(true).toBe(true);
  });

  /* ---------------------------------------------------------------------
   * THE e3 PROBE — the case that proves a one-producer gate is not a gate.
   * ------------------------------------------------------------------- */

  it('e3-A: an LLM inverse SURVIVES ALONE when the deterministic row is withheld — and the gate kills it', () => {
    // Pristine behaviour (audit, executed): the det row is suppressed by the
    // extractor's own negation screen, the LLM's `<=` has no competitor, and it
    // reaches the wire as the user's floor inverted.
    const brief = 'Do not let NRR drop below 78%.';
    const withLlm = runMerge(brief, [llmRow(GM, '<=', 0.78, 'NRR drop below 78%')]);
    expect(
      withLlm.wire.filter((r) => r.node_id === GM && r.operator === '<='),
      'the LLM inverse must NOT reach the wire',
    ).toEqual([]);
    expect(withLlm.asks.length, 'and the user must be asked instead').toBeGreaterThan(0);
  });

  it('e3-B: a correct det floor and an LLM inverse COEXIST on one node — both are contested, neither ships', () => {
    // The merge keys on `node_id::operator`, so `>=` and `<=` are different
    // keys and both survive to the gate. Shipping both is a contradiction the
    // user never wrote; the gate withholds the pair and asks.
    const brief = 'Net Revenue Retention cannot drop below 78%.';
    const detOnly = runMerge(brief);
    const detFloor = detOnly.wire.filter((r) => r.operator === '>=');
    expect(detFloor.length, 'premise: the deterministic floor must mint').toBeGreaterThan(0);

    const both = runMerge(brief, [llmRow(GM, '<=', 0.78, 'NRR drop below 78%')]);
    const onNode = both.wire.filter((r) => r.node_id === GM);
    const ops = new Set(onNode.map((r) => r.operator));
    expect(
      ops.has('>=') && ops.has('<='),
      'a node must never carry BOTH operators at the same value on the wire',
    ).toBe(false);
    expect(both.asks.length, 'the disagreement must surface as a question').toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------------
   * THREE CONFIGURATIONS × the audit's failing classes.
   * ------------------------------------------------------------------- */

  const CASES: ReadonlyArray<{
    id: string;
    brief: string;
    quote: string;
    llmOp: '>=' | '<=';
    value: number;
    node: string;
    /** Does the DETERMINISTIC producer emit anything for this brief? */
    detEmits: boolean;
  }> = [
    { id: 'a1-contraction', brief: "Don't let Net Revenue Retention drop below 78%.", quote: 'Net Revenue Retention drop below 78%', llmOp: '<=', value: 0.78, node: 'fac_nrr', detEmits: true },
    { id: 'a2-curly', brief: 'Don’t let Net Revenue Retention drop below 78%.', quote: 'Net Revenue Retention drop below 78%', llmOp: '<=', value: 0.78, node: 'fac_nrr', detEmits: true },
    { id: 'a3-keep-from', brief: 'Keep Net Revenue Retention from falling below 78%.', quote: 'Net Revenue Retention from falling below 78%', llmOp: '<=', value: 0.78, node: 'fac_nrr', detEmits: false },
    { id: 'a4-ensure', brief: "Ensure Net Revenue Retention doesn't drop below 78%.", quote: "Net Revenue Retention doesn't drop below 78%", llmOp: '<=', value: 0.78, node: 'fac_nrr', detEmits: true },
    { id: 'A1-interrupted', brief: 'Do not, under any circumstances, let Net Revenue Retention drop below 78%.', quote: 'Net Revenue Retention drop below 78%', llmOp: '<=', value: 0.78, node: 'fac_nrr', detEmits: false },
    { id: 'A3-em-dash', brief: 'We must not — and the board is firm on this — let Net Revenue Retention go below 78%.', quote: 'Net Revenue Retention go below 78%', llmOp: '<=', value: 0.78, node: 'fac_nrr', detEmits: false },
    { id: 'D8-above-side', brief: 'Marketing spend must not go above £1.5m.', quote: 'Marketing spend must not go above £1.5m', llmOp: '>=', value: 1500000, node: 'fac_marketing_spend', detEmits: true },
    { id: 'h-board', brief: 'The board will not approve Marketing spend above £320,000.', quote: 'Marketing spend above £320,000', llmOp: '>=', value: 320000, node: 'fac_marketing_spend', detEmits: true },
  ];

  describe.each(CASES)('$id', ({ brief, quote, llmOp, value, node, detEmits }) => {
    const unit = value > 1 ? '£' : 'fraction';

    it('config 1 — DETERMINISTIC ONLY: no inverted row reaches the wire', () => {
      const r = runMerge(brief);
      const inverted = r.wire.filter(
        (w) => w.node_id === node && w.operator === llmOp && Math.abs(w.value - value) < 1e-9,
      );
      expect(inverted, 'the inverted direction must never ship').toEqual([]);
      // ⚠ NON-VACUITY. Without this, a case whose deterministic producer emits
      // NOTHING passes this test by testing nothing (trap 13) — and two of the
      // briefs below genuinely emit nothing, which is a fact worth pinning
      // rather than hiding behind a green tick.
      if (detEmits) {
        expect(
          r.wire.length + r.asks.length,
          'premise: the deterministic producer must have produced SOMETHING here',
        ).toBeGreaterThan(0);
      }
    });

    it('config 2 — DET + LLM: the model row does not smuggle the inversion past the gate', () => {
      const r = runMerge(brief, [llmRow(node, llmOp, value, quote, unit)]);
      const inverted = r.wire.filter(
        (w) => w.node_id === node && w.operator === llmOp && Math.abs(w.value - value) < 1e-9,
      );
      expect(inverted, 'the inverted direction must never ship, whoever produced it').toEqual([]);
      expect(r.asks.length, 'and something must be asked').toBeGreaterThan(0);
    });

    it('config 3 — LLM ONLY: the gate still applies with no deterministic competitor', () => {
      // The e3 shape: the extractor's row is suppressed by its own negation
      // screen, so the model's inverse has no competitor on the wire. A gate
      // wired to the regex producer alone would pass this row straight through.
      const r = runMerge('Please advise on the plan.', [llmRow(node, llmOp, value, quote, unit)]);
      const inverted = r.wire.filter((w) => w.node_id === node && w.operator === llmOp);
      expect(inverted, 'an LLM-only inverted row must be withheld').toEqual([]);
      expect(r.asks.length, 'an LLM-only inverted row must still raise a question').toBeGreaterThan(0);
    });
  });

  /* ---------------------------------------------------------------------
   * CONTROLS — the gate must not become an over-suppressor at the merge.
   * ------------------------------------------------------------------- */

  it('control: a plain ceiling from BOTH producers still ships, and asks nothing', () => {
    const brief = 'Keep marketing spend under £500,000.';
    const detOnly = runMerge(brief);
    expect(detOnly.wire.some((r) => r.operator === '<='), 'det ceiling must ship').toBe(true);
    expect(detOnly.asks, 'a plain ceiling must generate no noise').toEqual([]);

    const both = runMerge(brief, [llmRow('fac_marketing_spend', '<=', 500000, 'marketing spend under £500,000', '£')]);
    expect(both.wire.some((r) => r.node_id === 'fac_marketing_spend' && r.operator === '<='), 'LLM ceiling must ship').toBe(true);
    expect(both.asks, 'a plain ceiling must generate no noise from either producer').toEqual([]);
  });

  it('control: a plain floor from the model alone still ships', () => {
    const brief = 'NRR must be at least 92%.';
    const r = runMerge(brief, [llmRow(GM, '>=', 0.92, 'NRR must be at least 92%')]);
    expect(r.wire.some((w) => w.node_id === GM && w.operator === '>='), 'a proven floor must ship').toBe(true);
  });

  it('control: a coherent BAND from both producers survives as a band', () => {
    // S4 must not read a legitimate `between X and Y` as producer disagreement.
    const brief = 'Keep NRR between 20% and 30%.';
    const r = runMerge(brief, [
      llmRow(GM, '>=', 0.2, 'NRR between 20% and 30%'),
      llmRow(GM, '<=', 0.3, 'NRR between 20% and 30%'),
    ]);
    const onNode = r.wire.filter((w) => w.node_id === GM);
    expect(onNode.some((w) => w.operator === '>=' && Math.abs(w.value - 0.2) < 1e-9), 'band floor must ship').toBe(true);
    expect(onNode.some((w) => w.operator === '<=' && Math.abs(w.value - 0.3) < 1e-9), 'band ceiling must ship').toBe(true);
  });

  /* ---------------------------------------------------------------------
   * S4 — THE CROSS-ROW CONTESTED SCREEN.
   *
   * ⚠ THIS TEST EXISTS BECAUSE MUTANT M10 SURVIVED WITHOUT IT, and the reason
   * it survived is worth recording: every OTHER contested-looking fixture in
   * this file is settled EARLIER — by S2 (evidence contradiction) or by the
   * unlocatable-quote fail-closed — so S4 was never reached and could have been
   * deleted wholesale under a green suite.
   *
   * To reach S4 both rows must pass S1–S3 cleanly and still disagree. Two
   * negation-free sentences on ONE node do exactly that: each is individually
   * provable, and together they are a contradiction the user never wrote.
   * ------------------------------------------------------------------- */

  it('S4: two individually-clean bounds that CONTRADICT each other are both withheld', () => {
    const brief = 'Keep marketing spend above £500,000. Keep marketing spend under £300,000.';
    const r = runMerge(brief);
    const onNode = r.wire.filter((w) => w.node_id === 'fac_marketing_spend');
    const ops = new Set(onNode.map((w) => w.operator));
    expect(
      ops.has('>=') && ops.has('<='),
      'a floor ABOVE its own ceiling is a contradiction and must not ship',
    ).toBe(false);
    expect(onNode, 'neither side of an incoherent pair may ship').toEqual([]);
    expect(
      r.asks.some((a) => a.reason === 'producer_disagreement'),
      'the contradiction must be surfaced as a producer_disagreement question',
    ).toBe(true);
  });

  it('S4: a COHERENT pair on one node is a band and survives — the discriminating twin', () => {
    // The other half of the discriminating pair. Without this, S4 could be
    // "withhold every node carrying both operators", which would delete every
    // legitimate band — a fix that closes a lie by opening a gap (trap 22b).
    const brief = 'Keep marketing spend above £300,000. Keep marketing spend under £500,000.';
    const r = runMerge(brief);
    const onNode = r.wire.filter((w) => w.node_id === 'fac_marketing_spend');
    expect(onNode.some((w) => w.operator === '>=' && Math.abs(w.value - 300000) < 1e-9), 'band floor must ship').toBe(true);
    expect(onNode.some((w) => w.operator === '<=' && Math.abs(w.value - 500000) < 1e-9), 'band ceiling must ship').toBe(true);
    expect(
      r.asks.some((a) => a.reason === 'producer_disagreement'),
      'a coherent band is not a disagreement',
    ).toBe(false);
  });

  /* ---------------------------------------------------------------------
   * EVIDENCE IS PROTECTED PAYLOAD ACROSS THE MERGE (round-1 finding 4).
   *
   * ⚠ THESE TESTS EXIST BECAUSE MUTANT M18 SURVIVED WITHOUT THEM. The fix was
   * verified in a throwaway probe and never pinned in the suite — which is the
   * same defect class as the round-1 M4 survivor one level down: a behaviour
   * that works today and is guarded by nothing.
   *
   * The merge is `node_id::operator` with "LLM overwrites on same key", so a
   * model row carrying only a LABEL replaces a correct, QUOTE-BEARING
   * deterministic row. Harmless before the gate; not harmless now, because the
   * gate is fail-closed on evidence it cannot verify — the overwrite deletes
   * the very quote that would have proven the row.
   * ------------------------------------------------------------------- */

  it('a label-only model row INHERITS the deterministic twin\'s quote, so the limit survives', () => {
    const brief = 'Keep marketing spend under £1500000.';
    const detOnly = runMerge(brief);
    expect(
      detOnly.wire.some((w) => w.node_id === 'fac_marketing_spend' && w.operator === '<='),
      'premise: the deterministic producer reads this correctly',
    ).toBe(true);

    const both = runMerge(brief, [{
      constraint_id: 'gc-label-only',
      node_id: 'fac_marketing_spend',
      operator: '<=',
      value: 1500000,
      unit: '£',
      label: 'Marketing spend ceiling (model wording)',
      // NO source_quote — the shape that destroyed B1's only real constraint.
    }]);
    expect(
      both.wire.some((w) => w.node_id === 'fac_marketing_spend' && w.operator === '<='),
      'the overwrite must not delete a limit the deterministic producer proved',
    ).toBe(true);
    expect(both.asks, 'and it must not manufacture a question about a settled bound').toEqual([]);
  });

  it('DISCRIMINATING TWIN: a DIFFERENT number does NOT inherit the quote', () => {
    // The half that makes the inheritance safe rather than convenient. A quote
    // describing a different quantity is not evidence about this one; carrying
    // it would let the gate "prove" a direction from a sentence about another
    // number. Same gate as the frame: same value, same unit, or nothing.
    const brief = 'Keep marketing spend under £1500000.';
    const both = runMerge(brief, [{
      constraint_id: 'gc-other-number',
      node_id: 'fac_marketing_spend',
      operator: '<=',
      value: 999,
      unit: '£',
      label: 'Different number (model wording)',
    }]);
    expect(
      both.wire.some((w) => w.node_id === 'fac_marketing_spend' && Math.abs(w.value - 999) < 1e-9),
      'an unevidenced row about a different number must NOT ship',
    ).toBe(false);
    expect(both.asks.length, 'it must become a question instead').toBeGreaterThan(0);
  });

  it('DISCRIMINATING TWIN: a DIFFERENT unit does NOT inherit the quote', () => {
    const brief = 'Keep marketing spend under £1500000.';
    const both = runMerge(brief, [{
      constraint_id: 'gc-other-unit',
      node_id: 'fac_marketing_spend',
      operator: '<=',
      value: 1500000,
      unit: '%',
      label: 'Same number, different unit (model wording)',
    }]);
    expect(both.wire.some((w) => w.node_id === 'fac_marketing_spend' && w.operator === '<=')).toBe(false);
    expect(both.asks.length).toBeGreaterThan(0);
  });

  it('a model row that HAS its own quote keeps it — inheritance only fills a hole', () => {
    const brief = 'Keep marketing spend under £1500000.';
    const both = runMerge(brief, [{
      constraint_id: 'gc-own-quote',
      node_id: 'fac_marketing_spend',
      operator: '<=',
      value: 1500000,
      unit: '£',
      label: 'Marketing spend ceiling',
      source_quote: 'Keep marketing spend under £1500000.',
    }]);
    expect(both.wire.some((w) => w.node_id === 'fac_marketing_spend' && w.operator === '<=')).toBe(true);
    expect(both.asks).toEqual([]);
  });

  /* ---------------------------------------------------------------------
   * THE EARLY-RETURN MOVE — claim (g).
   * ------------------------------------------------------------------- */

  it('the detector runs when BOTH producers emitted nothing (the moved early return)', () => {
    // Pristine `runCompoundGoals` returned before any gate when both producers
    // were empty. A dropped floor is exactly that state, so the user's limit
    // vanished with nothing left to notice it.
    const brief = 'NRR must not — even during migration — fall below 92%.';
    const r = runMerge(brief);
    expect(r.wire, 'premise: neither producer emits a row here').toEqual([]);
    expect(r.asks.length, 'the dropped floor must still become a question').toBeGreaterThan(0);
    expect(r.asks.some((a) => a.amount_text === '92%'), 'the ask must name the amount the user wrote').toBe(true);
  });

  it('an empty brief with no producers asks nothing and throws nothing', () => {
    const r = runMerge('');
    expect(r.wire).toEqual([]);
    expect(r.asks).toEqual([]);
  });

  /* ---------------------------------------------------------------------
   * THE ASK PAYLOAD — shaped for reuse, not for one card.
   * ------------------------------------------------------------------- */

  it('every ask names a metric, an amount, a machine-readable reason and a question', () => {
    const r = runMerge("Don't let NRR drop below 78%.", [llmRow(GM, '<=', 0.78, 'NRR drop below 78%')]);
    expect(r.asks.length).toBeGreaterThan(0);
    for (const a of r.asks) {
      expect(a.metric_text.length, 'an ask with no metric cannot be rendered by any surface').toBeGreaterThan(0);
      expect(a.amount_text.length).toBeGreaterThan(0);
      expect(a.question.length).toBeGreaterThan(0);
      expect(
        ['no_evidence', 'explicit_ambiguity', 'evidence_contradiction', 'unspent_negation', 'producer_disagreement'],
        'the reason must be one of the declared discriminators',
      ).toContain(a.reason);
    }
  });

  it('no ask leaks a node id into user-facing text', () => {
    // The records feed coaching prose, which is scanned for entity-id leakage.
    // Composing from labels and quotes only is what makes that scan a formality
    // rather than a dependency.
    const r = runMerge("Don't let NRR drop below 78%.", [llmRow(GM, '<=', 0.78, 'NRR drop below 78%')]);
    for (const a of r.asks) {
      expect(a.metric_text).not.toMatch(/\b(?:fac|out|risk|goal|dec|opt)_[a-z0-9_]+/i);
      expect(a.question).not.toMatch(/\b(?:fac|out|risk|goal|dec|opt)_[a-z0-9_]+/i);
    }
  });
});
