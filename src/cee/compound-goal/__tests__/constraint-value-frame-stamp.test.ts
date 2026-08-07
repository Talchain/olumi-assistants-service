/**
 * ROADMAP 2.855 — CEE's half of the `value_frame` chain (row 2.798:
 * ISL declares -> CEE stamps -> PLoT forwards -> a result is delivered).
 *
 * WHY THE STAMP IS PER-BRANCH, AND WHY THAT *IS* THE CONTRACT.
 * `@talchain/schemas` 0.38.0's own block comment on
 * `DraftGoalConstraintSchema.value_frame` prescribes that "CEE stamps it as a
 * CODE CONSTANT at its constraint mint siteS (never LLM-derivable — the frame
 * is a property of the minting arithmetic)". Read whole, "code constant"
 * contrasts with LLM-DERIVED, and the very next clause instructs deriving the
 * frame from the ARITHMETIC — which is exactly what this file pins. An earlier
 * revision of this comment claimed the first clause "does not follow"; that
 * manufactured a disagreement with the contract that is not there, and it was
 * refuted in review (PR #862, 2026-08-07). THIS CHANNEL OBEYS THE CONTRACT.
 *
 * What is genuinely different from the goal-threshold channel is only that the
 * constant is not the SAME constant at every site. That channel has one mint
 * branch, `raw / cap`, an absolute level by construction. This one does not:
 * `extractReductionConstraints` deliberately mints `{ operator: '<=',
 * value: -N }` and its own comment states the semantics in the SAMPLE frame
 * ("the samples must reach `-value` or lower"). That is a DELTA. A blanket
 * 'level' there would hand ISL a change-from-origin number attested as an
 * absolute level; ISL would convert it against the target's baseline and
 * return a CONFIDENT WRONG probability — the fabrication class 2.258/2.266
 * exist to kill. So each site states its own arithmetic's frame, per the
 * contract's second clause.
 *
 * Producers whose arithmetic is NOT known to CEE (the `add_constraint`
 * handler, whose number the ROUTING MODEL computed; the draft LLM's own
 * `goal_constraints` array; the client ingress array) stamp NOTHING and ISL
 * fails closed — guarded in `constraint-value-frame-unattested.test.ts`,
 * which also holds the DERIVED completeness guard over the stamp SITES.
 *
 * Assertions bind to their constraint by node id / operator IDENTITY, never by
 * a value predicate another constraint could satisfy (trap 19).
 */

import { describe, it, expect } from 'vitest';
import { GoalThresholdFrame } from '@talchain/schemas';

import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
} from '../extractor.js';
import {
  mapQualitativeToProxy,
  QUALITATIVE_PROXY_MAPPINGS,
} from '../qualitative-proxy.js';
import { GoalConstraintSchema } from '../../../schemas/assist.js';

/** Mint via the real extractor, then run the real downstream carry. */
function mintFromBrief(brief: string) {
  const extraction = extractCompoundGoals(brief);
  return toGoalConstraints(normaliseConstraintUnits(extraction.constraints));
}

/**
 * Bind by IDENTITY (node id + operator), never by value — two constraints on
 * one target differ only by operator, and a value predicate would let the
 * wrong one satisfy the assertion (trap 19).
 */
function pick(rows: ReturnType<typeof mintFromBrief>, nodeId: string, operator: '>=' | '<=') {
  const hits = rows.filter((r) => r.node_id === nodeId && r.operator === operator);
  expect(
    hits,
    `expected exactly one ${operator} constraint on '${nodeId}'; got ${JSON.stringify(rows)}`,
  ).toHaveLength(1);
  return hits[0]!;
}

describe('2.855 — the frame is stamped from the MINTING ARITHMETIC, per branch', () => {
  it('the contract enum is the single vocabulary (no local literal union — trap 12)', () => {
    // Derived from the vendored package, so a contract change fails loud here
    // rather than drifting silently against a hand-copied union.
    expect(GoalThresholdFrame.options.slice().sort()).toEqual(['delta', 'level']);
  });

  it("REDUCTION ('reduce X by N%') mints a DELTA and is stamped 'delta'", () => {
    const rows = mintFromBrief('We need to reduce marketing cost by 15% this year.');
    const row = pick(rows, 'fac_marketing_cost', '<=');

    // The arithmetic that makes this a delta, pinned in the same assertion so
    // the frame claim is bound to the number it describes rather than floating
    // free: the extractor flips the naive "+N" reading to a negative value.
    expect(row.value).toBeLessThan(0);
    expect(row.value_frame).toBe('delta');
  });

  it("UPPER BOUND ('keep X under N') mints an absolute LEVEL and is stamped 'level'", () => {
    const rows = mintFromBrief('Keep churn under 5% for the year.');
    const row = pick(rows, 'fac_churn', '<=');

    expect(row.value).toBeGreaterThan(0);
    expect(row.value_frame).toBe('level');
  });

  it("LOWER BOUND ('X at least N') mints an absolute LEVEL and is stamped 'level'", () => {
    const rows = mintFromBrief('Retention must be at least 90%.');
    const row = pick(rows, 'fac_retention', '>=');

    expect(row.value).toBeGreaterThan(0);
    expect(row.value_frame).toBe('level');
  });

  it('BETWEEN mints two absolute LEVELS and stamps BOTH (the pair is one branch)', () => {
    const rows = mintFromBrief('Keep headcount between 20 and 30.');

    // Both limbs, bound by operator identity — a single-limb stamp would pass
    // a "some row is level" assertion while leaving the other limb dark.
    expect(pick(rows, 'fac_keep_headcount', '>=').value_frame).toBe('level');
    expect(pick(rows, 'fac_keep_headcount', '<=').value_frame).toBe('level');
  });

  it('EVERY minted row carries a frame — no branch is silently unstamped', () => {
    // The completeness half that a per-branch assertion cannot provide (12d):
    // a new extractor branch added without a stamp reddens HERE, where a
    // branch-by-branch corpus would simply not mention it.
    const rows = mintFromBrief(
      'Reduce marketing cost by 15%, keep churn under 5%, retention must be at least 90%, ' +
        'keep headcount between 20 and 30, and deliver within 6 months.',
    );
    expect(rows.length).toBeGreaterThan(0);

    const unstamped = rows.filter((r) => r.value_frame === undefined);
    expect(
      unstamped,
      `every extractor-minted constraint must carry a frame; unstamped: ${JSON.stringify(unstamped)}`,
    ).toEqual([]);
  });

  it('the stamp SURVIVES GoalConstraintSchema.parse (a plain z.object STRIPS unknown keys)', () => {
    // The goal_threshold_frame trap, one channel later: GoalConstraintSchema
    // is a plain `z.object` explicitly commented "strip unknown fields", so an
    // UNDECLARED value_frame is deleted silently one hop before the PLoT
    // payload and the stamp reaches nothing, with no error anywhere. This is
    // the positive control that the declaration is load-bearing, not decorative.
    const rows = mintFromBrief('We need to reduce marketing cost by 15% this year.');
    const row = pick(rows, 'fac_marketing_cost', '<=');
    expect(row.value_frame).toBe('delta');

    const parsed = GoalConstraintSchema.parse(row);
    expect(
      parsed.value_frame,
      'value_frame was stripped by GoalConstraintSchema — the field is undeclared',
    ).toBe('delta');
  });

  it('the schema REJECTS a frame outside the contract enum (not merely stripped)', () => {
    const rows = mintFromBrief('Keep churn under 5% for the year.');
    const row = pick(rows, 'fac_churn', '<=');

    const bad = GoalConstraintSchema.safeParse({ ...row, value_frame: 'normalised' });
    expect(bad.success).toBe(false);
  });
});

/**
 * THE QUALITATIVE-PROXY TABLE. `qualitative-proxy.ts` names THIS FILE as the
 * home of a "table-wide guard" on its stamp. Until PR #862's review that claim
 * was false — the file had zero proxy references — so the comment was a
 * guarantee with no machinery behind it. This block is the machinery.
 *
 * The proxy stamp is the ONE stamp in this channel that is a JUDGEMENT rather
 * than a derivation: nothing in the arithmetic forces it, because the value is
 * a table constant rather than a number parsed out of the user's own sentence.
 * So it gets the strongest form available (trap 12d — ship BOTH kinds):
 *   - DERIVED over the exported table, so a new mapping cannot escape;
 *   - a CORPUS that drives every mapping through the real matcher, with its own
 *     completeness checked AGAINST the table, so "the table is short" and "the
 *     matcher stopped matching" are both visible.
 */
describe('2.855 — the qualitative-proxy TABLE mints levels, table-wide', () => {
  /**
   * One brief per mapping. Hand-written on purpose: a corpus derived from the
   * patterns would only prove the patterns match themselves. Completeness is
   * asserted against the exported table below, which is the half a corpus
   * cannot provide for itself.
   */
  const PROXY_CORPUS: ReadonlyArray<readonly [nodeId: string, brief: string]> = [
    ['fac_nps_score', 'We want to improve customer satisfaction.'],
    ['fac_retention_rate', 'We want to improve retention.'],
    ['fac_churn_rate', 'We want to reduce churn.'],
    ['fac_team_velocity', 'We want to increase team velocity.'],
    ['fac_code_coverage', 'We want to improve code quality.'],
    ['fac_defect_rate', 'We want to reduce defect rate.'],
    ['fac_cost_reduction', 'We want to reduce operating costs.'],
    ['fac_market_share', 'We want to grow market share.'],
    ['fac_enps_score', 'We want to improve employee engagement.'],
    ['fac_time_to_market', 'We want to reduce time-to-market.'],
    ['fac_conversion_rate', 'We want to improve conversion.'],
    ['fac_uptime', 'We want to improve system uptime.'],
  ];

  it('the corpus covers EVERY mapping in the exported table (completeness, 12d)', () => {
    const tableIds = QUALITATIVE_PROXY_MAPPINGS.map((m) => m.targetNodeId).sort();
    expect(tableIds.length, 'the proxy table is empty').toBeGreaterThan(0);
    expect(
      PROXY_CORPUS.map(([id]) => id).sort(),
      'a mapping was added to QUALITATIVE_PROXY_MAPPINGS without a corpus brief; ' +
        'the table-wide claim in qualitative-proxy.ts would then be unproven for it',
    ).toEqual(tableIds);
  });

  it('EVERY mapping mints a POSITIVE threshold — no table entry is a change-from-origin', () => {
    // Derived over the table itself, so a new mapping cannot escape. This is
    // the arithmetic property that makes the 'level' stamp honest: unlike the
    // reduction branch, no proxy mapping flips a sign.
    for (const m of QUALITATIVE_PROXY_MAPPINGS) {
      expect(
        m.defaultValue,
        `proxy mapping '${m.targetNodeId}' mints a non-positive default; a negative ` +
          'default would be a change-from-origin and the level stamp would be false',
      ).toBeGreaterThan(0);
    }
  });

  it("EVERY mapping's minted constraint is stamped 'level' with its value unflipped", () => {
    const byId = new Map(QUALITATIVE_PROXY_MAPPINGS.map((m) => [m.targetNodeId, m]));
    let asserted = 0;

    for (const [nodeId, brief] of PROXY_CORPUS) {
      const result = mapQualitativeToProxy(brief);
      // Bind by node IDENTITY, never by a value predicate another mapping could
      // satisfy (trap 19) — several mappings share a default of 0.05/0.85.
      const hits = result.constraints.filter((c) => c.targetNodeId === nodeId);
      expect(hits, `brief for '${nodeId}' matched no proxy mapping`).toHaveLength(1);

      const mapping = byId.get(nodeId)!;
      expect(hits[0]!.valueFrame, `proxy '${nodeId}' is not stamped 'level'`).toBe('level');
      expect(
        hits[0]!.value,
        `proxy '${nodeId}' altered the table default; the frame claim describes ` +
          "the table's number, so a transformed value would make it false",
      ).toBe(mapping.defaultValue);
      asserted += 1;
    }

    // Positive control: the loop really ran the whole table (trap 13).
    expect(asserted).toBe(QUALITATIVE_PROXY_MAPPINGS.length);
  });

  it('the proxy path is OFF by default, and the pair proves the gate is what does it', () => {
    // The proxy stamp is a judgement, and one mapping's level reading is
    // genuinely contested — `fac_cost_reduction` ("reduce operating costs" ->
    // `>= 0.10`) reads as a REDUCTION AMOUNT, i.e. arguably a delta. It is not
    // a live defect only because the sole production call site
    // (`stages/repair/compound-goals.ts`) passes `includeProxies: false`. That
    // darkness is load-bearing, so it is pinned here rather than left to a
    // comment: lighting the proxy path reddens this test, and the contested
    // frame has to be settled at that point rather than shipped by default.
    const brief = 'We want to reduce operating costs.';

    const off = extractCompoundGoals(brief);
    expect(off.constraints.filter((c) => c.targetNodeId === 'fac_cost_reduction')).toEqual([]);

    // The discriminating half: the SAME brief DOES mint it when proxies are
    // on, so the absence above is the GATE's doing and not the brief failing to
    // match (trap 13b — an absence assertion must pin its own precondition).
    const on = extractCompoundGoals(brief, { includeProxies: true });
    const minted = on.constraints.filter((c) => c.targetNodeId === 'fac_cost_reduction');
    expect(minted, 'the proxy brief matches nothing even with proxies ON — the ' +
      'absence assertion above proves nothing').toHaveLength(1);
    expect(minted[0]!.valueFrame).toBe('level');
  });
});
