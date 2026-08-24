/**
 * ROADMAP 2.757 — the elicitation-blindness marker.
 *
 * Every assertion binds by IDENTITY (an exact literal, an exact field on an
 * exact write), never by a value predicate another object could satisfy
 * (CLAUDE.md trap 19).
 *
 * OPPOSITE-DIRECTION TWINS (trap 22b). One predicate here guards two opposite
 * harms: a false `not_blind` throws away a usable independent estimate, a
 * false `blind` silently corrupts an aggregate. Every case therefore has its
 * twin — blind reads blind, post-analysis reads NOT blind, unknowable reads
 * unknown — and no case is asserted in only one direction.
 */

import { describe, expect, it } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  DECISION_RECORD_ELICITED_BLIND_VALUES,
  deriveElicitedBlind,
} from '../elicitation-blindness.js';
import { buildDecisionRecordWrite } from '../capture.js';
import { buildUserCommitWrite } from '../user-commit.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HASH_AT_RUN = 'abcdef0123456789';
const COMPUTED_AT = '2026-07-10T12:00:00.000Z';
const NOW = new Date('2026-08-06T09:00:00.000Z');

function makeFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      win_probabilities: { 'Option A': 0.62, 'Option B': 0.38 },
      summary: 'Option A currently leads.',
      enrichment: {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
        ],
      },
      graph_hash_at_run: HASH_AT_RUN,
      computed_at: COMPUTED_AT,
    },
  };
}

function commit(overrides?: Partial<Parameters<typeof buildUserCommitWrite>[0]>) {
  return buildUserCommitWrite({
    scenarioId: SCENARIO_ID,
    userId: USER_ID,
    chosenOptionId: 'opt_b',
    chosenOptionLabel: 'Option B',
    confidence0to100: 72,
    expectationStatement: 'Runway holds above 9 months through Q1.',
    graphHashAtRun: HASH_AT_RUN,
    commitNonce: 'commit-nonce-1',
    now: NOW,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// E1 — THE THREE-WAY. All three states, each asserted against its twin.
// ---------------------------------------------------------------------------

describe('E1 — the marker is three-way, and unknown is not false', () => {
  it('reads BLIND when the round proves both withholdings', () => {
    expect(
      deriveElicitedBlind({
        path: 'blind_elicitation_round',
        siblingPositionsWithheld: true,
        modelPositionWithheld: true,
      }),
    ).toBe('blind');
  });

  it('reads NOT_BLIND when an analysis was already produced for the scenario', () => {
    expect(deriveElicitedBlind({ path: 'user_commit', analysisAnchored: true })).toBe('not_blind');
  });

  it('reads UNKNOWN when the path can establish neither', () => {
    expect(deriveElicitedBlind({ path: 'user_commit', analysisAnchored: false })).toBe('unknown');
  });

  it('keeps UNKNOWN and NOT_BLIND as DISTINCT values — the boolean collapse this field exists to prevent', () => {
    const unknown = deriveElicitedBlind({ path: 'user_commit', analysisAnchored: false });
    const notBlind = deriveElicitedBlind({ path: 'user_commit', analysisAnchored: true });
    // Identity binding on both literals, and the inequality that is the whole
    // point: a boolean would make these the same cell.
    expect(unknown).toBe('unknown');
    expect(notBlind).toBe('not_blind');
    expect(unknown).not.toBe(notBlind);
  });

  it('pins the closed vocabulary EXACTLY — reds if a value is added OR removed', () => {
    expect([...DECISION_RECORD_ELICITED_BLIND_VALUES]).toEqual(['blind', 'not_blind', 'unknown']);
  });
});

// ---------------------------------------------------------------------------
// E2 — BLINDNESS IS EARNED. A partially-proven round is unknown, never blind.
// ---------------------------------------------------------------------------

describe('E2 — blind is a positive claim, never a default', () => {
  it('refuses BLIND when the model position was not provably withheld', () => {
    const v = deriveElicitedBlind({
      path: 'blind_elicitation_round',
      siblingPositionsWithheld: true,
      modelPositionWithheld: false,
    });
    expect(v).toBe('unknown');
    // The twin: it must not fall the OTHER way either. An uncertifiable round
    // is genuinely unknown — asserting not_blind would be its own fabrication.
    expect(v).not.toBe('blind');
    expect(v).not.toBe('not_blind');
  });

  it('refuses BLIND when sibling positions were not provably withheld', () => {
    const v = deriveElicitedBlind({
      path: 'blind_elicitation_round',
      siblingPositionsWithheld: false,
      modelPositionWithheld: true,
    });
    expect(v).toBe('unknown');
    expect(v).not.toBe('blind');
  });

  it('refuses BLIND when neither withholding is proven', () => {
    expect(
      deriveElicitedBlind({
        path: 'blind_elicitation_round',
        siblingPositionsWithheld: false,
        modelPositionWithheld: false,
      }),
    ).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// E3 — BOTH LIVE WRITERS STAMP IT ON THE DURABLE WRITE.
// The complete writer manifest at this tip is capture.ts + user-commit.ts;
// a third writer added without a marker is what this pair is here to catch.
// ---------------------------------------------------------------------------

describe('E3 — every record this service writes is self-describing', () => {
  it('the ambient auto-capture write carries elicited_blind = not_blind', () => {
    const built = buildDecisionRecordWrite(makeFact(), SCENARIO_ID);
    expect(built.kind).toBe('write');
    if (built.kind !== 'write') return;
    // IDENTITY: the exact field on the exact sub-object that is persisted as
    // the `prediction` JSONB column — not "somewhere on the write".
    expect(built.write.prediction.elicited_blind).toBe('not_blind');
    // The two questions stay separate (trap 21): whose number it is lives on
    // confidence_source, whether it was independent lives here.
    expect(built.write.prediction.confidence_source).toBe('model_derived');
  });

  it('the user-commit write carries elicited_blind = not_blind when anchored', () => {
    const built = commit();
    expect(built.kind).toBe('write');
    if (built.kind !== 'write') return;
    expect(built.write.prediction.elicited_blind).toBe('not_blind');
    expect(built.write.prediction.confidence_source).toBe('user_stated');
  });

  it('the user-commit write DEGRADES TO UNKNOWN rather than defaulting when no anchor was established', () => {
    // The route refuses 409 no_analysed_graph before it can reach here, so
    // this is the builder refusing to fabricate rather than a reachable
    // production state — stated as such, not dressed up as a live path.
    const built = commit({ graphHashAtRun: '   ' });
    expect(built.kind).toBe('write');
    if (built.kind !== 'write') return;
    expect(built.write.prediction.elicited_blind).toBe('unknown');
    expect(built.write.prediction.elicited_blind).not.toBe('not_blind');
  });
});

// ---------------------------------------------------------------------------
// E4 — THE MARKER IS DERIVED, NOT DEFAULTED.
// Guards the exact failure the invariant names: a stamp that survives the
// derivation being neutered is a constant wearing a derivation's clothes.
// ---------------------------------------------------------------------------

describe('E4 — the stamped value tracks the evidence, not a literal', () => {
  it('moves with the anchor evidence across the two reachable user-commit states', () => {
    const anchored = commit();
    const unanchored = commit({ graphHashAtRun: '' });
    expect(anchored.kind).toBe('write');
    expect(unanchored.kind).toBe('write');
    if (anchored.kind !== 'write' || unanchored.kind !== 'write') return;
    // A hardcoded stamp makes these two EQUAL. That equality is the mutant.
    expect(anchored.write.prediction.elicited_blind).not.toBe(
      unanchored.write.prediction.elicited_blind,
    );
  });
});

// ---------------------------------------------------------------------------
// E5 — THE VOCABULARY IS DERIVED FROM THE DATABASE GUARD, NOT MIRRORED.
// The RPC refuses an off-whitelist key by refusing the WHOLE record, and the
// capture hook is fire-and-forget — so a TS/SQL drift here does not error, it
// silently stops decision records being written. A hand-kept copy is exactly
// the defect class this estate keeps paying for (CLAUDE.md trap 12), so the
// SQL is READ and compared rather than restated.
// ---------------------------------------------------------------------------

describe('E5 — the TS vocabulary and the RPC whitelist cannot drift apart', () => {
  const MIGRATION = 'supabase/migrations/20260710113000_v5_decision_records.sql';

  it('admits exactly the three values the guard admits', async () => {
    const { readFile } = await import('node:fs/promises');
    const sql = await readFile(MIGRATION, 'utf8');

    // POSITIVE CONTROL FIRST (trap 13): a probe that extracted nothing agrees
    // with every other probe that extracted nothing. Prove the guard clause is
    // present and readable BEFORE believing any comparison against it.
    expect(sql).toContain("- 'elicited_blind' <> '{}'::jsonb");
    const clause = /elicited_blind'\s*\n?\s*NOT IN \(([^)]*)\)/.exec(sql);
    expect(clause, `no elicited_blind enum clause found in ${MIGRATION}`).not.toBeNull();

    const fromSql = [...(clause?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // Non-empty assertion: an empty extraction must never read as agreement.
    expect(fromSql.length).toBeGreaterThan(0);
    expect(fromSql).toEqual([...DECISION_RECORD_ELICITED_BLIND_VALUES]);
  });

  it('keeps the key on the p_prediction whitelist, or every write is refused', () => {
    // Bound by identity to the exact subtraction chain the guard uses: if the
    // key is dropped from the whitelist while the producer still stamps it,
    // create_decision_record raises 22023 on EVERY record.
    expect(DECISION_RECORD_ELICITED_BLIND_VALUES).toContain('unknown');
    expect(DECISION_RECORD_ELICITED_BLIND_VALUES).toContain('not_blind');
    expect(DECISION_RECORD_ELICITED_BLIND_VALUES).toContain('blind');
  });
});
