/**
 * THE CONDITIONAL OPTION FLOOR — pinned against the WITNESSED capture, with a
 * discriminating twin that must keep its options.
 *
 * ── WHAT THE FIXTURE IS, AND WHY IT IS NOT A SELF-AUTHORED ONE ─────────────
 * `fixtures/diagnosis-hypotheses-as-options-1287.json` is reconstructed from the
 * canonical-state capture banked in issue #1287 (fresh guest, 31 Aug 2026, CEE
 * `d0544243`, served `draft_graph` v201 / `fab9aa27bb82`). A fixture you wrote
 * yourself is not evidence about the wire (platform trap 16-inverse), so the
 * reconstruction is checked against the producer rather than asserted: the
 * projector's CONTENT-ADDRESSED ids come out identical to the captured ones for
 * four of the five nodes the issue tables — options `b83e6409`, `dc2b4f19`,
 * `fcf60fe7`, `34ff4863` and factor `6c1aebc3`. Those ids are a hash of the
 * user's own words; reproducing them from an invented record set is not
 * something that happens by accident. The fifth (the migration-backlog option,
 * `d6d8938d` here vs `02cad5b1` there) differs only in which dash codepoint the
 * brief carried, which the issue's markdown cannot disclose. That divergence is
 * stated rather than hidden, and no assertion below depends on it.
 *
 * ── ⚠ THE TWO ARMS ARE BOTH LOAD-BEARING, AND THE SECOND IS THE DANGEROUS ONE
 * The defect arm is easy to satisfy by suppressing options generally. The
 * DISCRIMINATING TWIN — a brief that genuinely names alternatives — is what
 * proves the fix was not bought that way, and it is measured against the same
 * predicate, the same guard and the same seam. A corpus that tests one direction
 * is a guard watching one door (platform trap 22b).
 *
 * ── ⚠ ASSERTIONS BIND BY IDENTITY ─────────────────────────────────────────
 * Every claim about a node names its MINTED ID or its exact quote, never a value
 * predicate another node could satisfy (platform trap 19). `optionIds` is sorted
 * and compared whole, so an option appearing OR disappearing REDs.
 */
import { describe, expect, it } from 'vitest';

import { projectRecordsToGraph } from '../../../src/cee/draft/records/projector.js';
import {
  CAUSE_FRAMING_WARNING_ID,
  NO_COMPARISON_WARNING_ID,
  causeFramingWarnings,
  isStatedCauseFraming,
  reconcileDraftCauseFraming,
} from '../../../src/cee/draft/records/cause-framing.js';
import { optionFramingRecovery } from '../../../src/cee/draft/records/option-framing-recovery.js';
import { isDecisionFreeGraph } from '../../../src/validators/decision-free-shape.js';
import { MIN_OPTIONS } from '../../../src/validators/graph-validator.types.js';
import type { DraftRecordSet } from '../../../src/cee/draft/records/grammar.js';
import capture from './diagnosis-hypotheses-as-options-1287.json';

const WITNESSED: DraftRecordSet = JSON.parse(capture.raw_text);
const BRIEF: string = capture.brief;

/** The four hypothesis options, by the minted id each of their quotes hashes to. */
const HYPOTHESIS_IDS = ['b83e6409', 'd6d8938d', 'dc2b4f19', 'fcf60fe7'] as const;
/** The one genuine action in the capture — model-proposed, and it must survive the guard itself. */
const GENUINE_ACTION_ID = '34ff4863';

const kindIds = (graph: { nodes: readonly { id: string; kind: string }[] }, kind: string): string[] =>
  graph.nodes.filter((node) => node.kind === kind).map((node) => node.id).sort();

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. THE PREDICATE, AGAINST A CORPUS FROM OUTSIDE THIS AUTHOR'S HEAD
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every positive is a span the DEPLOYED PRODUCT put on the canvas as an option
 * in the #1287 capture — four labels the user never offered as choices.
 */
const WITNESSED_CAUSES = [
  'the price rise we pushed through in January',
  'The Price Rise We Pushed Through in January',
  'the migration backlog — we still have about 40 accounts stuck on the old platform',
  'the migration backlog - we still have about 40 accounts stuck on the old platform',
  "the competitor's new analytics module is genuinely better than ours",
  'we simply stopped doing exec-level QBRs after the reorg',
] as const;

/**
 * Every negative is a `kind: "option"` span already present in THIS REPO's
 * fixtures, or an option span the records instruction itself uses as an example
 * — so the must-not-break arm is drawn from the estate, not from this author.
 * The last four are the adjacent constructions a wider predicate would eat.
 */
const GENUINE_OPTION_SPANS = [
  'hire more support staff',
  'buy a triage tool',
  'open a second warehouse in Leeds',
  'open a second warehouse',
  'opening a second warehouse',
  'stay with one warehouse',
  'raise prices 15%',
  'Raise Café prices 15%',
  'reducing prices 5%',
  'Keep prices unchanged',
  'Keep Café prices unchanged',
  'hold current strategy',
  'improve delivery reliability',
  'cut delivery time',
  'cutting our burn rate by 30%',
  'partnering with a fulfilment provider',
  'double down on enterprise sales (higher margins but longer cycles)',
  'Resolve support overwhelm',
  'Run a structured churn analysis across all four hypotheses before committing budget',
  // The instruction's own example of a legitimate bare noun-phrase option.
  'the events budget',
  // Genuine action spans from `option-framing.test.ts`'s own must-not-break list.
  // ⭐ THE FIRST IS LOAD-BEARING AND WAS ADDED BECAUSE A MUTANT SURVIVED WITHOUT
  // IT: it is VERB-HEADED and carries a copula, so it is the only shape that can
  // observe the subject-head conjunct. Deleting the conjunct left the whole first
  // corpus green — a corpus containing no member of the class a rule protects
  // cannot certify that rule (platform trap 12d).
  'Assess whether churn is price-related',
  'Survey customers about whether to raise prices',
  'Hold prices while deciding whether to restructure',
  'Hire a researcher to figure out customer demand',
  'Launch the campaign named Why Pay More?',
  // The constructions closest to the positives, kept explicitly:
  'our best move is to cut prices',      // copular frame naming an ACTION
  'the pricing change we are planning',  // progressive, not a state assertion
  'we could keep prices unchanged',      // modal, not a report of what happened
  // ⭐ ALSO ADDED AFTER A SURVIVING MUTANT: the only shapes that exercise
  // NON_PAST_ED. Both are ordinary ways a user phrases an option, and both are
  // withdrawn as "something that already happened" without that exclusion.
  'we speed up the migration',
  'we proceed with the Leeds warehouse',
] as const;

/**
 * ⭐ THE GAP, PINNED EXACTLY (platform trap 22f's honest-gap rule). These ARE
 * causes and this predicate deliberately does NOT match them: a bare noun phrase
 * asserts nothing, and separating it from `the events budget` needs knowledge of
 * the world that no punctuation rule supplies. A gap recorded in the suite is
 * honest; a gap invisible to it is how a predicate oscillates for four rounds.
 * This list REDs if it GROWS or SHRINKS — either is a change worth reviewing.
 */
const KNOWN_NOT_CAUGHT = [
  'the migration backlog',
  'the price rise',
  'the competitor analytics module',
  'exec-level QBRs',
] as const;

describe('a stated CAUSE is discriminated from a course of action', () => {
  it.each(WITNESSED_CAUSES)('recognises the witnessed cause: %s', (text) => {
    expect(isStatedCauseFraming(text)).toBe(true);
  });

  it.each(GENUINE_OPTION_SPANS)('preserves a genuine option span: %s', (text) => {
    expect(isStatedCauseFraming(text)).toBe(false);
  });

  it('pins the KNOWN gap exactly — no more, no fewer', () => {
    const caught = KNOWN_NOT_CAUGHT.filter((text) => isStatedCauseFraming(text));
    expect(caught).toEqual([]);
    expect(KNOWN_NOT_CAUGHT).toHaveLength(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. THE WITNESSED DEFECT ARM
// ───────────────────────────────────────────────────────────────────────────

describe('the #1287 capture: the hypotheses leave the comparison, and nothing is invented', () => {
  /** Preconditions, pinned in-test: the fixture really does reproduce the defect. */
  function pristine() {
    const projection = projectRecordsToGraph(WITNESSED, BRIEF);
    expect(kindIds(projection.graph, 'option')).toEqual(
      [...HYPOTHESIS_IDS, GENUINE_ACTION_ID].sort(),
    );
    expect(kindIds(projection.graph, 'decision')).toHaveLength(1);
    // The second modelling of the same four concepts, as the issue reports it.
    expect(projection.graph.nodes.find((node) => node.id === '6c1aebc3')?.label)
      .toBe('Migration backlog size');
    return projection;
  }

  it('withdraws exactly the four hypotheses, each by its minted id', () => {
    const result = reconcileDraftCauseFraming(WITNESSED, pristine());
    const causes = result.withdrawn
      .filter((entry) => entry.reason === 'cause_framing_not_an_option')
      .map((entry) => entry.node_id)
      .sort();
    expect(causes).toEqual([...HYPOTHESIS_IDS].sort());
  });

  it('falls the rest of the way to the mapping shape rather than to an invalid count', () => {
    const result = reconcileDraftCauseFraming(WITNESSED, pristine());
    // Withdrawing four of five leaves ONE option and a minted decision — the
    // cell every validator refuses. The honest completion is zero of both.
    expect(result.fellToMappingShape).toBe(true);
    expect(kindIds(result.projection.graph, 'option')).toEqual([]);
    expect(kindIds(result.projection.graph, 'decision')).toEqual([]);
    expect(isDecisionFreeGraph(result.projection.graph as never)).toBe(true);
    expect(MIN_OPTIONS).toBe(2);
  });

  it('keeps every hypothesis in the model as a factor — retained, not deleted', () => {
    const result = reconcileDraftCauseFraming(WITNESSED, pristine());
    expect(kindIds(result.projection.graph, 'factor')).toEqual(
      ['6c1aebc3', '6a2f55fd', '6b2e6010', '80e43e0a', 'd6f31d34'].sort(),
    );
    expect(kindIds(result.projection.graph, 'goal')).toEqual(['646fde87']);
    expect(kindIds(result.projection.graph, 'outcome')).toEqual(['d4f95ef9']);
  });

  it('invents nothing: no node is added, renamed or reclassified', () => {
    const before = projectRecordsToGraph(WITNESSED, BRIEF);
    const beforeById = new Map(before.graph.nodes.map((node) => [node.id, node]));
    const result = reconcileDraftCauseFraming(WITNESSED, before);
    for (const node of result.projection.graph.nodes) {
      const original = beforeById.get(node.id);
      expect(original, `node ${node.id} was not in the pristine projection`).toBeDefined();
      expect(node.label).toBe(original!.label);
      expect(node.kind).toBe(original!.kind);
      expect(node.data).toEqual(original!.data);
    }
    // Every surviving edge existed before; none was drawn to keep the graph valid.
    const beforeEdgeIds = new Set(before.graph.edges.map((edge) => edge.id));
    for (const edge of result.projection.graph.edges) expect(beforeEdgeIds.has(edge.id)).toBe(true);
  });

  it('reports the withdrawal, and never as a demand for two alternatives', () => {
    const result = reconcileDraftCauseFraming(WITNESSED, pristine());
    const warnings = causeFramingWarnings(result.withdrawn);
    expect(warnings.filter((w) => w.id === CAUSE_FRAMING_WARNING_ID)).toHaveLength(4);
    expect(warnings.filter((w) => w.id === NO_COMPARISON_WARNING_ID)).toHaveLength(1);

    // ⭐ TRAP 21, PINNED. `optionFramingRecovery` answers a DIFFERENT question —
    // "the user IS choosing and the model put the QUESTION on the graph" — and
    // its recovery asks for two courses of action. On THIS class that demand is
    // the exact fabrication pressure the ruling forbids, so it must stay silent.
    expect(
      optionFramingRecovery(result.projection.graph.nodes as never, result.withdrawn, 'req-1287'),
    ).toBeUndefined();
  });

  it('is pure and idempotent — records and the input projection are untouched', () => {
    const records = freeze(structuredClone(WITNESSED));
    const projection = freeze(projectRecordsToGraph(records, BRIEF));
    const recordBytes = JSON.stringify(records);
    const projectionBytes = JSON.stringify(projection);

    const once = reconcileDraftCauseFraming(records, projection);
    const twice = reconcileDraftCauseFraming(records, freeze(once.projection));

    expect(JSON.stringify(records)).toBe(recordBytes);
    expect(JSON.stringify(projection)).toBe(projectionBytes);
    expect(twice.withdrawn).toEqual([]);
    expect(twice.fellToMappingShape).toBe(false);
    expect(JSON.stringify(twice.projection)).toBe(JSON.stringify(once.projection));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. THE DISCRIMINATING TWIN — a brief that IS choosing keeps its options
// ───────────────────────────────────────────────────────────────────────────

/**
 * Spans taken from this repo's own option fixtures. Note the SAME
 * attributed-disagreement shape as the diagnosis brief — different people
 * pushing different things — so a predicate keyed on attribution or on
 * disagreement would destroy this brief. It must survive untouched.
 */
const DECISION_BRIEF =
  'Fulfilment is straining. Ops want to open a second warehouse in Leeds, '
  + 'finance would rather we stay with one warehouse and raise prices 15%, and the '
  + 'founder thinks the competitor has better coverage than we do. '
  + 'We have to pick one before the peak season.';

const DECISION_RECORDS = {
  stated_items: [
    { kind: 'goal', source_quote: 'Fulfilment is straining', role: 'baseline' },
    { kind: 'option', source_quote: 'open a second warehouse in Leeds', is_baseline: false },
    { kind: 'option', source_quote: 'stay with one warehouse', is_baseline: true },
    { kind: 'option', source_quote: 'raise prices 15%', is_baseline: false },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Warehouse capacity', basis: [1] },
    { claim_kind: 'factor', label: 'List price level', basis: [3] },
    { claim_kind: 'outcome', label: 'Order fulfilment reliability', basis: [] },
    { claim_kind: 'causal_link', label: 'Leeds sets capacity', from_stated: 1, to_claim: 0, sets_to: 2, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'one warehouse sets capacity', from_stated: 2, to_claim: 0, sets_to: 1, effect: 'negative' },
    { claim_kind: 'causal_link', label: 'price rise sets price level', from_stated: 3, to_claim: 1, sets_to: 15, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'capacity drives reliability', from_claim: 0, to_claim: 2, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'price level drives reliability', from_claim: 1, to_claim: 2, effect: 'negative' },
    { claim_kind: 'causal_link', label: 'reliability reaches the goal', from_claim: 2, to_stated: 0, effect: 'positive' },
  ],
} as unknown as DraftRecordSet;

describe('the discriminating twin: a genuine decision keeps every alternative', () => {
  it('leaves the projection byte-identical and raises nothing', () => {
    const projection = projectRecordsToGraph(DECISION_RECORDS, DECISION_BRIEF);
    const options = kindIds(projection.graph, 'option');
    // Precondition pinned in-test: the twin really does carry a comparison, so
    // a GREEN below is the guard's doing and not the fixture's failure to build.
    expect(options.length).toBeGreaterThanOrEqual(MIN_OPTIONS);
    expect(kindIds(projection.graph, 'decision')).toHaveLength(1);

    const result = reconcileDraftCauseFraming(DECISION_RECORDS, projection);
    expect(result.withdrawn).toEqual([]);
    expect(result.fellToMappingShape).toBe(false);
    expect(result.projection).toBe(projection);
    expect(kindIds(result.projection.graph, 'option')).toEqual(options);
    expect(causeFramingWarnings(result.withdrawn)).toEqual([]);
  });

  it('does not touch an option the MODEL proposed, whatever its wording', () => {
    // The structural conjunct, exercised directly: `provenance_class` is the
    // half of the guard that no wording can defeat. An `option_refinement` whose
    // label reads exactly like one of the witnessed causes stays an option.
    const records = {
      stated_items: [
        { kind: 'goal', source_quote: 'Fulfilment is straining', role: 'baseline' },
        { kind: 'option', source_quote: 'open a second warehouse in Leeds', is_baseline: false },
      ],
      claims: [
        { claim_kind: 'option_refinement', label: 'we simply stopped doing exec-level QBRs after the reorg', basis: [] },
        { claim_kind: 'factor', label: 'Warehouse capacity', basis: [1] },
        { claim_kind: 'factor', label: 'Executive relationship coverage', basis: [] },
        { claim_kind: 'outcome', label: 'Order fulfilment reliability', basis: [] },
        { claim_kind: 'causal_link', label: 'Leeds sets capacity', from_stated: 1, to_claim: 1, sets_to: 2, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'QBR refinement sets coverage', from_claim: 0, to_claim: 2, sets_to: 1, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'capacity drives reliability', from_claim: 1, to_claim: 3, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'coverage drives reliability', from_claim: 2, to_claim: 3, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'reliability reaches the goal', from_claim: 3, to_stated: 0, effect: 'positive' },
      ],
    } as unknown as DraftRecordSet;

    const projection = projectRecordsToGraph(records, DECISION_BRIEF);
    const modelOption = projection.graph.nodes.find(
      (node) => node.kind === 'option'
        && node.label === 'we simply stopped doing exec-level QBRs after the reorg',
    );
    // The precondition that makes this test discriminating: the span really is
    // on the graph as an option, and really is one the MODEL authored.
    expect(modelOption, 'the model-authored option must be present to be spared').toBeDefined();
    expect(
      (projection.provenance[modelOption!.id] ?? modelOption!.provenance)?.provenance_class,
    ).toBe('ai_inferred');
    expect(isStatedCauseFraming(modelOption!.label)).toBe(true);

    const result = reconcileDraftCauseFraming(records, projection);
    expect(result.withdrawn).toEqual([]);
    expect(kindIds(result.projection.graph, 'option')).toContain(modelOption!.id);
  });
});
