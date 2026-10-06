/**
 * ⭐ SD-1 Slice R writer (schemas 0.78 `delivered_record`; DL ruling #87, 6 Oct). The record must hold the bytes the user
 * SAW. The builder applies the wire's own sanitiser, and records a turn only when no Phase 3 prose asserts a leading
 * option — on those turns the leader-withheld rewording is the identity whatever the licence, so stored == wire by
 * construction. Rows bind the claim to the REAL wire functions (`enforceLeadingOptionClaimsAtWire`,
 * `sanitiseOlumiResponseForEgress`), with a precondition row proving the omission rule is load-bearing.
 */
import { describe, expect, it } from 'vitest';
import { RunDeliveredRecordSchema, type OlumiResponse } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { maximalReviewCardBlock, maximalCoachingBlock, maximalTextBlock } from '@talchain/schemas/fixtures';

import { buildRunDeliveredRecord, stampDeliveredRecord } from '../run-delivered-record.js';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';
import { sanitiseOlumiResponseForEgress } from '../output-safety.js';

type Rec = Record<string, unknown>;
const GRAPH = {
  nodes: [
    { id: 'opt_hire', kind: 'option', label: 'Hire a marketing manager' },
    { id: 'opt_hold', kind: 'option', label: 'Hold headcount' },
    { id: 'fac_spend', kind: 'factor', label: 'Marketing spend' },
    { id: 'out_rev', kind: 'outcome', label: 'Revenue' },
  ],
  edges: [],
} as never;
const ANALYSIS_READY = {
  status: 'ready',
  goal_node_id: 'out_rev',
  options: [
    { option_id: 'opt_hire', label: 'Hire a marketing manager', status: 'ready', interventions: { fac_spend: 0.6 } },
    { option_id: 'opt_hold', label: 'Hold headcount', status: 'ready', interventions: {} },
  ],
} as never;
const card = (body: string) => ({ ...(maximalReviewCardBlock as unknown as Rec), body });
const NEUTRAL = 'Most of this result rests on a single factor. Arguing the case against it shows whether it survives.';
const runFact = (over: Rec = {}): HandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: '11111111-1111-4111-8111-111111111111', leading_option_id: null, summary: 's', run_id: 'run_b', graph_hash_at_run: 'gh_b', ...over },
} as unknown as HandlerFact);
const response = (blocks: unknown[]): OlumiResponse => ({ assistant_text: '', suggested_actions: [], insights: [], blocks } as unknown as OlumiResponse);
const build = (blocks: unknown[], over: Partial<Parameters<typeof buildRunDeliveredRecord>[0]> = {}) => buildRunDeliveredRecord({
  response: response(blocks), handlerFacts: [runFact()], graph: GRAPH, analysisReady: ANALYSIS_READY,
  authorityUnavailable: false, requestId: 'req-1', exitPath: 'test', ...over,
});
/** The wire's leader projection under the MOST restrictive licence (withheld, separation unknown). */
const wireWithheld = (blocks: unknown[]) => enforceLeadingOptionClaimsAtWire(response(blocks), {
  requestId: 'req-1', exitPath: 'test', mayNameLeadingOption: false, separationEstablished: false,
  graph: GRAPH, analysisReady: ANALYSIS_READY,
} as never);

describe('the delivered record holds what the wire would ship', () => {
  it('⭐ RED: a Run turn with neutral Phase 3 cards is recorded, contract-valid, bound to its Run', () => {
    const out = build([card(NEUTRAL), maximalCoachingBlock, maximalTextBlock]);
    expect(out.kind).toBe('recorded');
    const record = (out as { record: Rec }).record;
    expect(RunDeliveredRecordSchema.safeParse(record).success).toBe(true);
    expect(record.run_id).toBe('run_b');
    expect(record.graph_hash).toBe('gh_b');
    // Only the Phase 3 subset, in delivered order — the text block is not recorded.
    expect((record.phase3_blocks as Rec[]).map((b) => b.type)).toEqual(['review_card', 'coaching']);
    expect(record.analysis_ready_options).toEqual([
      { option_id: 'opt_hire', label: 'Hire a marketing manager', status: 'ready', interventions: { fac_spend: 0.6 } },
      { option_id: 'opt_hold', label: 'Hold headcount', status: 'ready', interventions: {} },
    ]);
  });

  it('⭐ STORED == WIRE: the withheld-leader rewording changes nothing on a recorded turn', () => {
    const out = build([card(NEUTRAL), maximalCoachingBlock]);
    const record = (out as { record: Rec }).record;
    const wire = wireWithheld(record.phase3_blocks as unknown[]);
    expect(wire.changed).toBe(false);
    expect(wire.response.blocks).toEqual(record.phase3_blocks);
  });

  it('the stored blocks are the wire SANITISER\'s output (the same pure function, the same graph)', () => {
    const composed = [card(NEUTRAL)];
    const record = (build(composed) as { record: Rec }).record;
    const sanitised = sanitiseOlumiResponseForEgress(response(composed), { graph: GRAPH, requestId: 'req-1', exitPath: 'test' }).blocks;
    expect(record.phase3_blocks).toEqual(sanitised);
  });

  it('the sanitiser\'s entity-id scrub reaches the record (a leaked node id is stored as its label, as the wire ships it)', () => {
    const record = (build([card('Most of this result rests on fac_spend.')]) as { record: Rec }).record;
    expect((record.phase3_blocks as Rec[])[0]!.body).toBe('Most of this result rests on Marketing spend.');
  });
});

describe('a turn whose cards assert a leader records NOTHING — never a guess at the rewording', () => {
  const NAMING = 'Hire a marketing manager leads on the current model; test it before you act.';

  it('PRECONDITION: the wire DOES rewrite that card under a withheld licence (so the rule is load-bearing)', () => {
    expect(wireWithheld([card(NAMING)]).changed).toBe(true);
  });

  it('→ omitted, reason asserts_leader', () => {
    expect(build([card(NEUTRAL), card(NAMING)])).toEqual({ kind: 'omitted', reason: 'asserts_leader' });
  });

  it('a claim only the roster-free (lexical) reader catches is still omitted ("May leads…")', () => {
    expect(build([card('May leads on the current model.')])).toEqual({ kind: 'omitted', reason: 'asserts_leader' });
  });
});

describe('omit, never truncate', () => {
  it.each([
    ['no Run fact', { handlerFacts: [] }, 'no_run_fact'],
    ['two Run facts', { handlerFacts: [runFact(), runFact({ run_id: 'run_c' })] }, 'several_run_facts'],
    ['a Run without its id', { handlerFacts: [runFact({ run_id: undefined })] }, 'unbound_run'],
    ['a Run without the graph it ran against', { handlerFacts: [runFact({ graph_hash_at_run: undefined })] }, 'unbound_run'],
    ['the analysis authority unavailable (the wire ships no blocks)', { authorityUnavailable: true }, 'authority_unavailable'],
  ] as const)('%s', (_name, over, reason) => {
    expect(build([card(NEUTRAL)], over as never)).toEqual({ kind: 'omitted', reason });
  });

  it('an option setting a non-finite number is refused by the contract → nothing recorded', () => {
    const bad = { status: 'ready', goal_node_id: 'out_rev', options: [{ option_id: 'opt_hire', label: 'Hire', status: 'ready', interventions: { fac_spend: Number.NaN } }] };
    expect(build([card(NEUTRAL)], { analysisReady: bad as never })).toEqual({ kind: 'omitted', reason: 'schema_refused' });
  });

  it('more than 16 Phase 3 blocks → nothing recorded (never the first 16)', () => {
    expect(build(Array.from({ length: 17 }, () => card(NEUTRAL)))).toEqual({ kind: 'omitted', reason: 'schema_refused' });
  });
});

describe('stamping binds the record to its ONE Run fact', () => {
  const record = (build([card(NEUTRAL)]) as { record: Rec }).record as never;
  const parses = (f: unknown) => RunAnalysisHandlerFactSchema.safeParse(f).success;

  it('the matching Run fact carries it; other facts are untouched', () => {
    const other = { fact_type: 'edit_graph', noop: false, result: {} } as unknown as HandlerFact;
    const facts = [other, runFact()];
    const stamped = stampDeliveredRecord(facts, record, () => true);
    expect(stamped[0]).toBe(other);
    expect((stamped[1]!.result as Rec).delivered_record).toBe(record);
  });

  it('no matching run_id → the facts are returned unchanged (by reference)', () => {
    const facts = [runFact({ run_id: 'run_other' })];
    expect(stampDeliveredRecord(facts, record, () => true)).toBe(facts);
  });

  it('a stamped fact the contract would refuse is never written', () => {
    const facts = [runFact()];
    expect(stampDeliveredRecord(facts, record, () => false)).toBe(facts);
  });

  /** A Run fact the real 0.78 schema accepts (the shape the auto-run commits; cf. the analysis-read route test). */
  const validRunFact = (): HandlerFact => runFact({
    computed_at: '2026-10-06T03:00:00.000Z',
    win_probabilities: { opt_hire: 0.6, opt_hold: 0.4 },
    constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'unevaluated' },
  });

  it('the REAL 0.78 Run-fact schema: a valid Run fact still parses once stamped, and carries the record', () => {
    expect(parses(validRunFact())).toBe(true); // precondition: the base fact parses without a record
    const stamped = stampDeliveredRecord([validRunFact()], record, parses);
    expect(parses(stamped[0])).toBe(true);
    expect((stamped[0]!.result as Rec).delivered_record).toEqual(record);
  });

  it('the REAL schema refuses a record with an unknown key → the facts are returned unchanged (by reference)', () => {
    const facts = [validRunFact()];
    const widened = { ...(record as unknown as Rec), carried_extra: 1 } as never;
    expect(stampDeliveredRecord(facts, widened, parses)).toBe(facts);
  });
});
