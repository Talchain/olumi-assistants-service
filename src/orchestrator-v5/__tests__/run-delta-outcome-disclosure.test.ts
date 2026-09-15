/**
 * THE RUN-DELTA OUTCOME MUST NAME *WHICH* PRECONDITION FAILED.
 *
 * ⛔ THE DEFECT THIS PINS. `attachRunDelta` (response-finaliser.ts) called a
 * producer that returns a DISCRIMINATED refusal — `{ kind: 'none', reason }` —
 * and then threw `reason` away with a bare `if (built.kind !== 'ok') return
 * response;`. Nothing on the path logged, counted or emitted anything
 * (re-derived 15 Sep 2026 with a CONTRAST CONTROL: 0 logger/telemetry/console
 * calls in `response-finaliser.ts` and `coaching/build-run-delta.ts`, while the
 * same sweep reads 15 / 26 / 188 in `tools/handlers/run-analysis.ts` /
 * `orchestrator/plot-client.ts` / `turn-executor.ts` — so the zero is real
 * absence, not a blind probe).
 *
 * Consequence: all five `RunDeltaRefusal` reasons, PLUS `priorFacts` absent,
 * PLUS the identity-unbound strip, PLUS "it emitted and something downstream
 * dropped it" produced BYTE-IDENTICAL SILENCE. Seven probes into the dark
 * outcome clause failed on exactly this, and an eighth would have too.
 *
 * ⭐ THIS COMPLETES A CONTRACT THE PRODUCER ALREADY DECLARED. `RunDeltaRefusal`'s
 * own docblock says the reason exists because "the caller emits it as telemetry
 * (this module stays pure)". The producer kept its half; the caller never kept
 * its. So nothing here mints a taxonomy for the five — they pass through — and
 * only the three the CALLER owns are added.
 *
 * ⛔ REDACTION. Reason code and STRUCTURAL COUNTS only. No label, quote or id:
 * entity ids in this estate are slug renderings of user labels
 * (`fac_delivery_cost`), so an id IS user content. The leak arm is the
 * load-bearing half and carries a POSITIVE CONTROL proving the token really was
 * in the input.
 *
 * ⚠ FIXTURES ARE THE SHARED ONES (`context/__tests__/run-delta-fixtures.js`).
 * A private copy of the pair would be a hand-maintained mirror of the
 * definition two other suites already read — identical today, silently
 * divergent the moment either is edited.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { finaliseV5Response } from '../response-finaliser.js';
import { buildAnalysisResultBlock } from '../compose.js';
import { sanitiseOlumiResponseForEgress } from '../compose/output-safety.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { PRESENT_PAIR, REFUSED_PAIR } from '../context/__tests__/run-delta-fixtures.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const GRAPH: GraphStateIngress = {
  nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }],
  edges: [],
} as unknown as GraphStateIngress;
const HASH_NEWEST = computeAnalysisAffectingGraphHash(GRAPH)!;
const HASH_OLDER = computeAnalysisAffectingGraphHash({
  ...GRAPH,
  nodes: [{ ...(GRAPH as unknown as { nodes: unknown[] }).nodes[0]!, goal_threshold: 0.8 }],
} as unknown as GraphStateIngress)!;

let events: Array<{ name: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  events = [];
  setTestSink((name, data) => {
    events.push({ name, data: data as Record<string, unknown> });
  });
});

afterAll(() => {
  setTestSink(null);
});

function outcomeEvents(): Array<Record<string, unknown>> {
  return events
    .filter((e) => e.name === TelemetryEvents.V5RunDeltaOutcome)
    .map((e) => e.data);
}

/**
 * Stamp the identity fields the composer needs to CONFIRM a run.
 *
 * The shared fixture deliberately omits them — its two consumers pin the
 * producer, which never reads them. Adding them here (rather than editing the
 * shared fixture, or copying it) keeps one definition and lets this suite reach
 * past the identity gate to the producer underneath.
 */
function bindable(fact: HandlerFact, index: number): HandlerFact {
  const clone = structuredClone(fact) as unknown as { result: Record<string, unknown> };
  clone.result.scenario_id = SCENARIO_ID;
  clone.result.summary = 'Synthetic run.';
  clone.result.leading_option_id = index === 0 ? 'opt-b' : 'opt-a';
  // The fixture's `hash-a` / `hash-b` are legible placeholders, and the composer
  // rejects them as `unsupported_hash_representation` before it can confirm an
  // identity. Real hashes, still DIFFERENT per side, so the pair remains "the
  // leader flipped across an edit" exactly as the fixture intends.
  clone.result.graph_hash_at_run = index === 0 ? HASH_NEWEST : HASH_OLDER;
  return clone as unknown as HandlerFact;
}

/** Drop ONE producer echo, leaving everything else identical. */
function withoutSeedEcho(fact: HandlerFact): HandlerFact {
  const clone = structuredClone(fact) as unknown as {
    result: { enrichment: { meta: Record<string, unknown> } };
  };
  delete clone.result.enrichment.meta.seed_used;
  return clone as unknown as HandlerFact;
}

const BOUND_PAIR: readonly HandlerFact[] = PRESENT_PAIR.map(bindable);
const BOUND_SINGLE: readonly HandlerFact[] = REFUSED_PAIR.map(bindable);

function response(run: HandlerFact | null): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'You can explore the model assumptions next.',
    stage_indicator: 'analyse',
    suggested_actions: [],
    insights: [],
    blocks: run === null ? [] : [buildAnalysisResultBlock(run as RunAnalysisHandlerFact)],
  } as unknown as OlumiResponse;
}

/**
 * Finalise with the identity gate BOUND, so the producer is actually reached.
 * `newest` is both the block's subject and the freshness selection at its own
 * hash — the construction `c2-analysis-interpretation-composition` uses.
 */
function finalise(priorFacts: readonly HandlerFact[] | undefined, newest: HandlerFact | null) {
  const hash = (newest as unknown as { result?: { graph_hash_at_run?: string } })?.result
    ?.graph_hash_at_run;
  return finaliseV5Response(response(newest), {
    scenarioId: SCENARIO_ID,
    ...(priorFacts === undefined ? {} : { priorFacts }),
    mayNameLeadingOption: true,
    ...(newest === null
      ? {}
      : { freshness: deriveAnalysisFreshness([newest as RunAnalysisHandlerFact], hash!) }),
  });
}

describe('run_delta outcome disclosure', () => {
  it('names echoes_incomplete when a producer echo is absent — once per finalise', () => {
    // The NEWEST keeps its echoes (so identity binds); the older loses one, which
    // is precisely the state `readRunEchoes` refuses on.
    const newest = BOUND_PAIR[0]!;
    const pair = [newest, withoutSeedEcho(BOUND_PAIR[1]!)];

    finalise(pair, newest);

    const got = outcomeEvents();
    // ONE finalise call ⇒ one event. NOT a claim about a turn: `sendFinalised200`
    // re-finalises once per enabled debug surface, so a turn can legitimately
    // produce N identical events (see the event's docblock in telemetry.ts).
    expect(got).toHaveLength(1);
    // Bind by the IDENTITY of the reason, never "some refusal happened" — a bare
    // length check passes on every one of the other seven causes.
    expect(got[0].outcome).toBe('refused');
    expect(got[0].reason).toBe('echoes_incomplete');
    expect(got[0].scenario_id).toBe(SCENARIO_ID);
    expect(got[0].run_analysis_facts_count).toBe(2);
  });

  it('names insufficient_runs — a DIFFERENT reason, so the two are distinguishable', () => {
    const only = BOUND_SINGLE[0]!;

    finalise(BOUND_SINGLE, only);

    const got = outcomeEvents();
    expect(got).toHaveLength(1);
    expect(got[0].outcome).toBe('refused');
    expect(got[0].reason).toBe('insufficient_runs');
    expect(got[0].run_analysis_facts_count).toBe(1);
  });

  it('names prior_facts_absent — the caller-owned cause the producer cannot see', () => {
    finalise(undefined, BOUND_PAIR[0]!);

    const got = outcomeEvents();
    expect(got).toHaveLength(1);
    expect(got[0].outcome).toBe('skipped');
    expect(got[0].reason).toBe('prior_facts_absent');
    // Honest null, not 0: "no facts in scope" and "an empty list was supplied"
    // are different facts about the exit.
    expect(got[0].prior_facts_count).toBeNull();
  });

  it('names run_identity_unconfirmed — the producer is never even called', () => {
    // No freshness and no block: the composer cannot confirm the two runs share
    // a subject, so the delta is stripped BEFORE `buildRunDelta` runs.
    finaliseV5Response(response(null), {
      scenarioId: SCENARIO_ID,
      priorFacts: BOUND_PAIR,
      mayNameLeadingOption: true,
    });

    const got = outcomeEvents();
    expect(got).toHaveLength(1);
    expect(got[0].outcome).toBe('skipped');
    expect(got[0].reason).toBe('run_identity_unconfirmed');
    // The counts still travel, so "unconfirmed with a pair in hand" is
    // distinguishable from "unconfirmed with nothing in hand".
    expect(got[0].run_analysis_facts_count).toBe(2);
  });

  it('records the EMITTED case positively, so "it shipped" is not inferred from silence', () => {
    const finalised = finalise(BOUND_PAIR, BOUND_PAIR[0]!);

    const got = outcomeEvents();
    expect(got).toHaveLength(1);
    expect(got[0].outcome).toBe('emitted');
    expect(got[0].reason).toBeNull();
    // The positive record must agree with the wire, or it is a second lie.
    expect('run_delta' in finalised).toBe(true);
  });

  it('emits an honest null scenario_id rather than a placeholder', () => {
    finaliseV5Response(response(null), {});

    const got = outcomeEvents();
    expect(got).toHaveLength(1);
    expect(got[0].scenario_id).toBeNull();
  });

  /**
   * ⭐ THE DISCLOSURE WOULD BE WORSE THAN USELESS IF `run_delta` DID NOT REACH
   * THE WIRE. Telemetry saying `emitted` while the UI shows nothing is a NEW
   * two-way ambiguity — smaller than the eight this PR closes, the same shape,
   * and on the very seam the disclosure was built for.
   *
   * ⚠ NOTE THE LEVEL. `run_delta` is a TOP-LEVEL ENVELOPE key; the deep-strip
   * that removes `meta`/`_meta` operates on `blocks[i].enrichment` inside
   * `buildAnalysisResultBlock`. Different levels — which is exactly why this
   * must be executed rather than reasoned about, in both directions.
   */
  it('WIRE SURVIVAL: run_delta survives the egress chokepoint AND the strict wire schema', () => {
    const finalised = finalise(BOUND_PAIR, BOUND_PAIR[0]!);
    expect('run_delta' in finalised).toBe(true);

    // Hop 1 — the real V5 egress chokepoint every 200-OK exit funnels through.
    const egressed = sanitiseOlumiResponseForEgress(finalised, {
      graph: null,
      requestId: 'req-wire-survival',
      exitPath: 'turn_executor_finalise',
      userMessage: 'anything',
      mayNameLeadingOption: true,
    } as unknown as Parameters<typeof sanitiseOlumiResponseForEgress>[1]);
    expect(egressed.run_delta).toBeDefined();

    // Hop 2 — the strict wire schema DGAI parses against.
    const parsed = OlumiResponseSchema.parse(egressed);
    expect(parsed.run_delta).toBeDefined();
    // Survives byte-identical, not merely present-in-some-form.
    expect(parsed.run_delta).toEqual(finalised.run_delta);

    // CONTRAST CONTROL. The schema is `.strict()`, so it genuinely discriminates:
    // an undeclared sibling key THROWS. Without this, "run_delta survived" would
    // be equally consistent with a parser that passes everything through.
    expect(() =>
      OlumiResponseSchema.parse({ ...egressed, __not_a_declared_key__: 1 }),
    ).toThrow();
  });

  it('LEAK GUARD: no user label, quote or id reaches the event', () => {
    const SECRET = 'acme_q4_redundancy_programme';
    const newest = BOUND_PAIR[0]!;
    const leaky = structuredClone(withoutSeedEcho(BOUND_PAIR[1]!)) as unknown as {
      result: { enrichment: { results: Array<Record<string, unknown>> } };
    };
    // Plant the token where user content really lives on this path.
    leaky.result.enrichment.results = [{ option_id: `opt_${SECRET}`, option_label: SECRET }];

    finalise([newest, leaky as unknown as HandlerFact], newest);

    const got = outcomeEvents();
    expect(got).toHaveLength(1);
    // POSITIVE CONTROL — the token really was in the input, so a clean pass
    // below means the masking worked, not that there was nothing to leak.
    expect(JSON.stringify(leaky)).toContain(SECRET);
    const serialised = JSON.stringify(got[0]);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('acme');
  });
});
