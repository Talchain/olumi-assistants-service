/**
 * ⭐⭐ ONE PREFIX, TWO COUNTERS — the `semantic_` id space collides, and the
 * colliding ids are what a user's answer is resolved by.
 *
 * ── MEASURED, NOT REASONED ─────────────────────────────────────────────────
 * Paul's manual session `95b92672` (21 Sep 2026) shipped this in its
 * `analysis_ready.repair_proposal`:
 *
 *     issue_ids: ["semantic_1", "semantic_3", "semantic_5", "semantic_4", "semantic_5"]
 *
 * `semantic_5` names TWO different unresolved inputs of TWO different kinds:
 *
 *     {issue_id: "semantic_5", kind: "option_effect_value",
 *      option: "AI Tool + Limited Budget Test", factor: "Founder Time Commitment"}
 *     {issue_id: "semantic_5", kind: "option_mapping",
 *      option: "Hire a Marketing Manager"}
 *
 * ── THE MECHANISM, DERIVED AT THE CALL SITE ────────────────────────────────
 * `appendSemanticIssues` mints from the SAME `semantic_` prefix through TWO
 * different counters:
 *
 *   blocker loop  `blockerIssue(blocker, out.length + index, …)`  → `ordinal + 1`
 *   option loop   `issue_id: \`semantic_${out.length + 1}\``
 *
 * `out.length` already advances by one on every push, so adding `index` again
 * DOUBLE-COUNTS: the blocker arm emits a sparse odd sequence (1, 3, 5, …) that
 * overruns into the range the option arm is about to use. Reproduced exactly on
 * the capture's shape — 2 ready options, 1 option linked to three factors with
 * no values, 2 options awaiting a mapping.
 *
 * Every other mint in this authority is already sound: `carrier_` counts its own
 * array, `structural_` its own ordinal, `numeric_` its own prefix. `semantic_` is
 * the only prefix fed by two counters, and the fix is at ONE call site — the
 * function's two other production callers (`compose/analysis-state-v1.ts:521`,
 * `routing/readiness-summary.ts:174`) pass a plain per-list index, and the former
 * drops `issue_id` outright.
 *
 * ── WHY IT IS NOT COSMETIC: THE READER CHAIN, CORRECTED TWICE ──────────────
 *
 * ⛔ THIS PARAGRAPH ASSERTED THE WRONG CHAIN, THEN I WITHDREW TOO MUCH, AND A
 * REVIEWER MEASURED THE TRUE ONE. Both errors are kept visible because the
 * shape is the lesson, not the conclusion.
 *
 * ~~`handlers/readiness-value-batch-resume.ts:78,114` resolves the user's
 * answer BY `issue_id`, so an answer to one question can bind to the other.~~
 * **FALSE.** Those sites are pure VALIDATORS. Every identity operation in the
 * value batch is `cellKey(option_id, factor_id)` — measured, and it is why I
 * withdrew the answer-binding claim.
 *
 * ⚠ But I then concluded there was NO consumer at all, and that was also
 * wrong. My sweep asked *"is `issue_id` a Map/Set key, or inside
 * `find`/`filter`/`some`?"* — **and a React key is none of those.** The real
 * chain, measured by the reviewer:
 *
 *   CEE `routing/readiness-answer-chips.ts:178,184` → `suggested_actions[].id`
 *     → UI `ChatThread.tsx:349`   `<SuggestedChips>`      ← production render
 *     → UI `SuggestedChips.tsx:364`  `key={chip.id ?? …}` ← REACT KEY
 *
 * Measured over a K×M grid, staging vs this head: with an option edge-linked
 * to exactly two unvalued factors plus at least one option awaiting a mapping,
 * **two chips of DIFFERENT KINDS land in one row under one key.**
 * **Duplicate `issue_id`: 8 of 12 shapes at staging, 0 of 12 here.**
 *
 * ⭐ The durable lesson is about the SWEEP, not the bug: an absence claim is
 * only as wide as the consumption patterns you thought to ask about. A
 * framework key, a telemetry join and a render prop are all consumers that no
 * collection-membership grep can see.
 *
 * ── THE ASSERTION IS DERIVED, NEVER A LITERAL SEQUENCE ─────────────────────
 * Pinning the expected ids would be a hand-maintained mirror of the minting
 * order (trap 12) and would go red on any harmless reordering. The invariant is
 * UNIQUENESS, so that is what is asserted — and the fixture PINS ITS OWN
 * PRECONDITION (trap 13b): if the graph ever stops producing both arms, the
 * precondition assertions fail rather than letting a vacuous uniqueness check
 * pass over a list that never had two counters in it.
 */
import { describe, expect, it } from 'vitest';
import { assessCanonicalAnalysisReadiness } from '../analysis-ready-helper.js';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.6, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

const FACTORS = ['fac_quality', 'fac_budget', 'fac_time'] as const;

/**
 * The captured shape, with the session's own labels and synthetic figures.
 * `cee.analysis_ready.built` on this graph reports the capture's census:
 * optionCount 5 · readyOptionsCount 2 · optionsNeedingEncoding 1 ·
 * optionsNeedingMapping 2 · blockerCount 3.
 */
const NODES = [
  { id: 'dec_q', kind: 'decision', label: 'Question' },
  { id: 'goal_g', kind: 'goal', label: 'Plan the Campaign' },
  { id: 'fac_quality', kind: 'factor', label: 'Campaign Strategic Quality' },
  { id: 'fac_budget', kind: 'factor', label: 'Advertising Budget Allocated' },
  { id: 'fac_time', kind: 'factor', label: 'Founder Time Commitment' },
  {
    id: 'opt_base',
    kind: 'option',
    label: 'Freelance + AI (Status Quo)',
    data: { interventions: { fac_quality: 0.65, fac_budget: 0.5, fac_time: 0.2 } },
  },
  {
    id: 'opt_ads',
    kind: 'option',
    label: 'AI Tool + Increased Ad Spend',
    data: { interventions: { fac_quality: 0.5, fac_budget: 0.7, fac_time: 0.25 } },
  },
  // Added mid-session, edge-linked to all three factors and carrying no value
  // for any of them — three `missing_value` blockers, the arm that over-counts.
  { id: 'opt_new', kind: 'option', label: 'AI Tool + Limited Budget Test' },
  // Two options that never received a mapping — the arm the over-count runs into.
  { id: 'opt_raw', kind: 'option', label: 'use an AI tool to plan the campaign and spend more on advertising' },
  { id: 'opt_hire', kind: 'option', label: 'Hire a Marketing Manager' },
];

const EDGES = [
  ...['opt_base', 'opt_ads', 'opt_new', 'opt_raw', 'opt_hire'].map((o) => edge('dec_q', o)),
  ...['opt_base', 'opt_ads', 'opt_new'].flatMap((o) => FACTORS.map((f) => edge(o, f))),
  ...FACTORS.map((f) => edge(f, 'goal_g')),
];

const CAPTURED_SHAPE = { nodes: NODES, edges: EDGES };

const semanticIds = (ids: readonly string[]): string[] =>
  ids.filter((id) => id.startsWith('semantic_'));

describe('canonical readiness — issue_id is an identity, so it must be unique', () => {
  it('mints both semantic arms on the captured shape (precondition, not a result)', () => {
    const { issues } = assessCanonicalAnalysisReadiness(CAPTURED_SHAPE);

    // Without BOTH arms present there are not two counters in play and a
    // uniqueness assertion below would pass by testing nothing.
    const values = issues.filter((i) => i.code === 'MISSING_OPTION_VALUE');
    const mappings = issues.filter((i) => i.code === 'OPTION_NEEDS_MAPPING');
    expect(values.length, 'blocker arm must mint at least two issues').toBeGreaterThanOrEqual(2);
    expect(mappings.length, 'option arm must mint at least two issues').toBeGreaterThanOrEqual(2);
    expect(semanticIds(issues.map((i) => i.issue_id)).length).toBe(
      values.length + mappings.length,
    );
  });

  it('never mints one issue_id for two different issues', () => {
    const { issues } = assessCanonicalAnalysisReadiness(CAPTURED_SHAPE);
    const ids = issues.map((i) => i.issue_id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `duplicate issue_id(s) minted: ${duplicates.join(', ')}`).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never gives two issues of DIFFERENT kinds the same id', () => {
    // The harm is not the repeated string; it is that a resolver keyed on the id
    // cannot tell an effect-value question from a mapping question.
    const { issues } = assessCanonicalAnalysisReadiness(CAPTURED_SHAPE);
    const byId = new Map<string, Set<string>>();
    for (const issue of issues) {
      const kinds = byId.get(issue.issue_id) ?? new Set<string>();
      kinds.add(`${issue.category}/${issue.code}`);
      byId.set(issue.issue_id, kinds);
    }
    const conflicted = [...byId.entries()]
      .filter(([, kinds]) => kinds.size > 1)
      .map(([id, kinds]) => `${id} => ${[...kinds].join(' + ')}`);
    expect(conflicted).toEqual([]);
  });

  it("the repair proposal's issue_ids carry no duplicate", () => {
    // `issue_ids` is the list the repair loop hands downstream, and it is a
    // straight map over the same issues — the capture's own duplicate arrived here.
    const { repairProposal } = assessCanonicalAnalysisReadiness(CAPTURED_SHAPE);
    expect(repairProposal, 'fixture must produce a repair proposal').not.toBeNull();
    const ids = repairProposal!.issue_ids;
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size, `issue_ids: ${JSON.stringify(ids)}`).toBe(ids.length);
  });
});
