/**
 * ROADMAP 2.1229 (CEE half) — brief + analysis-provenance projection.
 *
 * The USER OUTCOME this guards: a person who has run an analysis can send
 * their model to a colleague, and the colleague opens the link and sees it.
 * `create_shared_brief` refuses with 'No brief to share - generate a brief
 * first' whenever `scenarios.brief IS NULL`, and it has been NULL on 14,157
 * of 14,158 scenarios. These tests pin the projection that stops that.
 *
 * THE LOAD-BEARING PROPERTY IS ALL-FOUR-OR-NOTHING, and it is a property of
 * the CONSUMER, not of taste. `create_shared_brief` null-checks
 * `analysis_provenance` ONCE and then dereferences three keys out of it into
 * three NOT NULL columns of `shared_briefs` (graph_hash text, seed_used
 * bigint, response_hash text — read at the deployed database, not inferred).
 * A partial envelope therefore passes the function's own null check and dies
 * on a NOT NULL constraint, turning an honest 'run analysis first' into an
 * opaque 23502 at share time. So the projection emits the envelope WHOLE or
 * emits nothing.
 *
 * Field paths are pinned here BY IDENTITY because two of them were reported
 * wrong by an earlier pass (`result.meta.seed_used` / `result.meta
 * .response_hash`). Measured at the deployed `v5_handler_facts` over 7 days,
 * non-noop run_analysis, n=3,097:
 *   result.enrichment.decision_brief          3,078
 *   result.graph_hash_at_run                  3,097
 *   result.enrichment.decision_brief.seed     3,078  (jsonb number, max 2,146,549,360)
 *   result.enrichment.response_hash           3,078
 *   NEGATIVE CONTROL result.meta                  0  (and absent from
 *     RunAnalysisHandlerFactSchema entirely — a structural absence, not an
 *     empty one)
 *   NEGATIVE CONTROL result.enrichment.meta.response_hash  0
 * All four are present on exactly the 3,078 facts whose
 * enrichment.analysis_status is 'computed'; the other 19 are 'refused' and
 * carry none of them. `graph_hash_at_run` is the one key present on refused
 * facts too — which is why the envelope check, not the hash, does the work.
 */
import { describe, it, expect } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { buildBriefProvenanceWrite } from '../capture.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRAPH_HASH = 'abcdef0123456789';
const RESPONSE_HASH = 'sha256:9f8e7d6c';
const SEED = 2146549360; // the observed maximum, kept verbatim as a fixture
const BRIEF = {
  brief_id: 'brief_123',
  version: 3,
  headline: 'Option A leads on the stated goal.',
  seed: SEED,
  graph_hash: GRAPH_HASH,
};

/**
 * A successful run_analysis fact carrying a COMPLETE envelope. Overrides
 * replace `result.enrichment` wholesale so a case can remove exactly one of
 * the four without the fixture quietly re-supplying it.
 */
function makeFact(overrides?: {
  readonly enrichment?: Record<string, unknown> | undefined;
  readonly graphHashAtRun?: string | undefined;
}): RunAnalysisHandlerFact {
  const result: RunAnalysisHandlerFact['result'] = {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_a',
    summary: 'Option A currently leads.',
    computed_at: '2026-09-18T12:00:00.000Z',
    ...(overrides && 'enrichment' in overrides
      ? overrides.enrichment === undefined
        ? {}
        : { enrichment: overrides.enrichment }
      : {
          enrichment: {
            analysis_status: 'computed',
            response_hash: RESPONSE_HASH,
            decision_brief: BRIEF,
          },
        }),
    ...(overrides && 'graphHashAtRun' in overrides
      ? overrides.graphHashAtRun === undefined
        ? {}
        : { graph_hash_at_run: overrides.graphHashAtRun }
      : { graph_hash_at_run: GRAPH_HASH }),
  };
  return { fact_type: 'run_analysis', fact_version: 1, noop: false, result };
}

describe('buildBriefProvenanceWrite — complete envelope', () => {
  it('projects the EXACT write from the four verified paths', () => {
    const built = buildBriefProvenanceWrite(makeFact(), SCENARIO_ID);
    expect(built.kind).toBe('write');
    if (built.kind !== 'write') throw new Error('unreachable — narrowed above');
    expect(built.write).toEqual({
      scenario_id: SCENARIO_ID,
      brief: BRIEF,
      graph_hash: GRAPH_HASH,
      seed_used: SEED,
      response_hash: RESPONSE_HASH,
    });
  });

  it('carries the brief VERBATIM — the same object graph PLoT emitted, not a reshaping', () => {
    const built = buildBriefProvenanceWrite(makeFact(), SCENARIO_ID);
    if (built.kind !== 'write') throw new Error('expected a write');
    // Bound by identity of the KEY SET, not by a spot-check of one key: a
    // projection that dropped or added keys would still satisfy a
    // `headline` assertion.
    expect(Object.keys(built.write.brief).sort()).toEqual(
      ['brief_id', 'graph_hash', 'headline', 'seed', 'version'],
    );
  });

  it('takes the scenario_id from the COMMIT metadata, never from the fact body', () => {
    // The fact's own result.scenario_id could disagree with the scenario the
    // turn committed against; the row we update must be the committed one.
    const fact = makeFact();
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const built = buildBriefProvenanceWrite(fact, other);
    if (built.kind !== 'write') throw new Error('expected a write');
    expect(built.write.scenario_id).toBe(other);
    expect(fact.result.scenario_id).toBe(SCENARIO_ID);
  });
});

describe('buildBriefProvenanceWrite — ALL-FOUR-OR-NOTHING', () => {
  it('missing decision_brief → skip(no_brief), not a partial envelope', () => {
    const built = buildBriefProvenanceWrite(
      makeFact({ enrichment: { analysis_status: 'computed', response_hash: RESPONSE_HASH } }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_brief' });
  });

  it('missing graph_hash_at_run → skip(no_graph_hash)', () => {
    const built = buildBriefProvenanceWrite(makeFact({ graphHashAtRun: undefined }), SCENARIO_ID);
    expect(built).toEqual({ kind: 'skip', reason: 'no_graph_hash' });
  });

  it('missing decision_brief.seed → skip(no_seed)', () => {
    const { seed: _dropped, ...briefWithoutSeed } = BRIEF;
    const built = buildBriefProvenanceWrite(
      makeFact({
        enrichment: {
          analysis_status: 'computed',
          response_hash: RESPONSE_HASH,
          decision_brief: briefWithoutSeed,
        },
      }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_seed' });
  });

  it('missing response_hash → skip(no_response_hash)', () => {
    const built = buildBriefProvenanceWrite(
      makeFact({ enrichment: { analysis_status: 'computed', decision_brief: BRIEF } }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_response_hash' });
  });

  it('absent enrichment entirely → skip(no_brief)', () => {
    expect(buildBriefProvenanceWrite(makeFact({ enrichment: undefined }), SCENARIO_ID)).toEqual({
      kind: 'skip',
      reason: 'no_brief',
    });
  });

  it("a 'refused' fact carries graph_hash_at_run but no envelope → skip, never a partial write", () => {
    // The 19 refused facts in the measured window are exactly this shape:
    // the hash is present, the other three are not. Pinned because it is the
    // ONE real-world case where a naive "we have a hash, write something"
    // projection would produce the 23502 this design exists to prevent.
    const built = buildBriefProvenanceWrite(
      makeFact({ enrichment: { analysis_status: 'refused' } }),
      SCENARIO_ID,
    );
    expect(built.kind).toBe('skip');
  });
});

describe('buildBriefProvenanceWrite — value usability (the DB column types decide)', () => {
  it.each([
    ['a string seed', '2146549360'],
    ['a fractional seed', 12.5],
    // Expressed as an EXPRESSION, not a literal: the literal form of this
    // value cannot be written in JS source without losing precision, which
    // is the whole reason the projection refuses it (`no-loss-of-precision`
    // catches the literal, and a seed JS has already rounded is not the seed
    // PLoT used).
    ['an unsafe-integer seed', Number.MAX_SAFE_INTEGER + 1],
    ['a null seed', null],
    ['a NaN seed', Number.NaN],
  ])('%s is unusable as bigint → skip(no_seed)', (_label, seed) => {
    const built = buildBriefProvenanceWrite(
      makeFact({
        enrichment: {
          analysis_status: 'computed',
          response_hash: RESPONSE_HASH,
          decision_brief: { ...BRIEF, seed },
        },
      }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_seed' });
  });

  it('an empty-string graph_hash is not a hash → skip(no_graph_hash)', () => {
    expect(buildBriefProvenanceWrite(makeFact({ graphHashAtRun: '' }), SCENARIO_ID)).toEqual({
      kind: 'skip',
      reason: 'no_graph_hash',
    });
  });

  it('an empty-string response_hash → skip(no_response_hash)', () => {
    const built = buildBriefProvenanceWrite(
      makeFact({
        enrichment: { analysis_status: 'computed', response_hash: '', decision_brief: BRIEF },
      }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_response_hash' });
  });

  it('a non-object decision_brief (array) is not a jsonb object → skip(no_brief)', () => {
    const built = buildBriefProvenanceWrite(
      makeFact({
        enrichment: {
          analysis_status: 'computed',
          response_hash: RESPONSE_HASH,
          decision_brief: [BRIEF],
        },
      }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_brief' });
  });

  it('a null decision_brief (the contract admits null) → skip(no_brief)', () => {
    const built = buildBriefProvenanceWrite(
      makeFact({
        enrichment: {
          analysis_status: 'computed',
          response_hash: RESPONSE_HASH,
          decision_brief: null,
        },
      }),
      SCENARIO_ID,
    );
    expect(built).toEqual({ kind: 'skip', reason: 'no_brief' });
  });
});

describe('buildBriefProvenanceWrite — the paths an earlier pass got WRONG', () => {
  it('does NOT read seed_used / response_hash from result.meta (that key does not exist on the fact)', () => {
    // CONTRAST CONTROL, in the same case: the decoy envelope below is placed
    // at the refuted paths and at NO other path. If the projection read
    // `result.meta.*` it would return a write; it must skip. The positive
    // arm (the four real paths) is pinned by the happy-path suite above, so
    // the pair discriminates the PATH, not merely the presence of data.
    const fact = makeFact({ enrichment: { analysis_status: 'computed', decision_brief: BRIEF } });
    const withDecoy = {
      ...fact,
      result: {
        ...fact.result,
        meta: { seed_used: SEED, response_hash: RESPONSE_HASH },
      },
    } as RunAnalysisHandlerFact;
    expect(buildBriefProvenanceWrite(withDecoy, SCENARIO_ID)).toEqual({
      kind: 'skip',
      reason: 'no_response_hash',
    });
  });
});
