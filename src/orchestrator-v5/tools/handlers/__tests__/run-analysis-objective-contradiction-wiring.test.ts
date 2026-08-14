/**
 * THE WIRING PIN for the objective-contradiction honesty surface.
 *
 * ⚠⚠ WHY THIS FILE EXISTS. The detector and its disclosure are unit-tested on
 * their own, and **every one of those tests stays GREEN if the run_analysis
 * handler never calls them**. That is this estate's chronic failure #1 — 42
 * roadmap items have been working code no user could reach — and its sharpest
 * recorded form is ROADMAP 2.466/2.491, where a fully-tested surface shipped
 * DARK twice in the same feature while seven render tests and five mutants all
 * agreed with each other about the wrong component.
 *
 * Modelled on `run-analysis-intake-wiring.drift.test.ts`, which pins the same
 * class of seam for ROADMAP 2.579, and carrying the same discipline: every
 * presence assertion has a PLANTED positive control measured RELATIVE to the
 * live text, so a control pinned to "current" cannot decay into a tautology
 * (trap 12b).
 *
 * ⚠ WHAT THIS PROVES AND DOES NOT PROVE, stated exactly.
 *   - It proves the handler SOURCE composes the seam, in the declared position.
 *   - It proves the composed summary survives the REAL egress allowlist, which
 *     is the difference between "the sentence exists" and "the user receives
 *     it" — a tail the allowlist rejects does not error, it silently replaces
 *     the whole summary with the locked template.
 *   - It does NOT execute the handler (that needs a PLoT envelope, a scenario
 *     reader and a live-ish snapshot), so it is not a wire witness and not a
 *     journey witness. Status ladder: CODE EXISTS / TESTED, nothing above.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  composeObjectiveContradictionDisclosure,
  readGoalLabel,
  readInterventionViews,
  readObjectiveOptionViews,
} from '../../../coaching/objective-contradiction.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { RUN_ANALYSIS_ASSISTANT_TEMPLATES } from '../run-analysis.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_ANALYSIS = resolve(HERE, '../run-analysis.ts');
const source = readFileSync(RUN_ANALYSIS, 'utf8');

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The REAL persisted pricing row — same fixture the L60 guard pins. */
const PRICING_GRAPH = JSON.parse(
  readFileSync(
    resolve(HERE, '../../../compose/__tests__/fixtures/l60/pricing-persisted-graph.json'),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * Raw `option_comparison[]` records, in the shape PLoT actually emits — read
 * by the handler through `readResultRecords`. Win shares are the investigation's
 * measured figures for this graph.
 */
const RECORDS_WITH_GOAL_PROBABILITY: ReadonlyArray<Record<string, unknown>> = [
  {
    option_id: 'opt_hold',
    option_label: 'Hold at £49 Per Seat (Status Quo)',
    win_probability: 0.7067,
    probability_of_goal: 0.0,
  },
  {
    option_id: 'opt_raise',
    option_label: 'Raise to £59 Per Seat',
    win_probability: 0.2782,
    probability_of_goal: 0.48,
  },
  {
    option_id: 'opt_tiers',
    option_label: 'Introduce £39 / £69 Two-Tier Pricing',
    win_probability: 0.0152,
    probability_of_goal: 0.11,
  },
];

/** The same run BEFORE F1 recovers a target: no `probability_of_goal` anywhere. */
const RECORDS_NO_GOAL_PROBABILITY = RECORDS_WITH_GOAL_PROBABILITY.map(
  ({ probability_of_goal: _dropped, ...rest }) => rest,
);

/** Compose exactly as the handler does at the `const summary = ...` line. */
function composeSummaryAsHandlerDoes(disclosure: string): string {
  return `${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT}${''}${''}${''}${disclosure}`;
}

// ============================================================================
// 1. THE HANDLER ACTUALLY CALLS IT
// ============================================================================

describe('wiring — the run_analysis handler consumes the objective-contradiction seam', () => {
  it('calls the composer', () => {
    expect(occurrences(source, 'composeObjectiveContradictionDisclosure(')).toBeGreaterThan(0);
  });

  it('BOUND TO ITS INPUTS BY IDENTITY — the persisted graph, the result records, and the headline permission', () => {
    // A composer fed something other than these three is a different claim
    // wearing the same call (trap 19: bind by identity, never by a predicate
    // another object could satisfy).
    const call = source.slice(source.indexOf('composeObjectiveContradictionDisclosure('));
    const args = call.slice(0, 260);
    expect(args).toContain('snapshot.rawPersistedGraph');
    expect(args).toContain('resultRecords');
    // The leader-permission argument: the tail NAMES options, so it may only
    // ship where the headline actually named one.
    expect(args).toContain('headline !== null');
  });

  it('appends the disclosure to the summary, LAST — the order the egress grammar admits', () => {
    // TAIL_PATTERN admits this slot only after the intake slot. A handler that
    // appended it earlier would compose a summary its OWN allowlist rejects,
    // and the user would silently receive the locked template with no error
    // anywhere in the system.
    expect(source).toContain(
      '${headline ?? template}${scaffoldDisclosure}${constraintGapDisclosure}${intakeDisclosure}${objectiveContradictionDisclosure}',
    );
  });

  it('POSITIVE CONTROL — these checks can see a change', () => {
    for (const needle of [
      'composeObjectiveContradictionDisclosure(',
      '${objectiveContradictionDisclosure}',
    ]) {
      const before = occurrences(source, needle);
      expect(before).toBeGreaterThan(0);
      const stripped = source.split(needle).join('__REMOVED__');
      expect(occurrences(stripped, needle)).toBe(0);
      expect(occurrences(`${source}\n// ${needle}`, needle)).toBe(before + 1);
    }
  });
});

// ============================================================================
// 2. IT REACHES THE WIRE — survives the REAL egress allowlist
// ============================================================================

describe('egress — the sentence actually reaches the user', () => {
  it('⭐ ARM B on the banked pricing shape: composed, and ADMITTED by the real allowlist', () => {
    const disclosure = composeObjectiveContradictionDisclosure(
      PRICING_GRAPH,
      RECORDS_WITH_GOAL_PROBABILITY,
      true,
    );
    expect(disclosure).toBe(
      ' Two different questions have two different answers here: “Hold at £49 Per Seat (Status Quo)”' +
        ' came out ahead most often, but “Raise to £59 Per Seat” is more likely to reach your stated' +
        ' target (48% against 0%). Coming out ahead counts how often an option scored highest on the' +
        ' goal, not whether your target was met.',
    );
    // THE LOAD-BEARING ASSERTION: without this, the tail is composed and then
    // silently discarded at egress, and the user gets the locked template.
    expect(isAllowedRunAnalysisAssistantText(composeSummaryAsHandlerDoes(disclosure))).toBe(true);
  });

  it('⭐ ARM A on the same real graph with a lever-directional aim: composed and ADMITTED', () => {
    const leverAimGraph = {
      ...PRICING_GRAPH,
      nodes: (PRICING_GRAPH.nodes as Array<Record<string, unknown>>).map((n) =>
        n.id === 'goal_mrr' ? { ...n, label: 'Increase our subscription price' } : n,
      ),
    };
    const disclosure = composeObjectiveContradictionDisclosure(
      leverAimGraph,
      RECORDS_NO_GOAL_PROBABILITY,
      true,
    );
    expect(disclosure).toBe(
      ' “Hold at £49 Per Seat (Status Quo)” came out ahead most often without moving' +
        ' “Seat Price Level” the way your goal asks. Among the options that do,' +
        ' “Raise to £59 Per Seat” came out ahead in 28% of runs.',
    );
    expect(isAllowedRunAnalysisAssistantText(composeSummaryAsHandlerDoes(disclosure))).toBe(true);
  });

  it('ARM B WINS when both arms would fire — exactly one sentence ships', () => {
    const leverAimGraph = {
      ...PRICING_GRAPH,
      nodes: (PRICING_GRAPH.nodes as Array<Record<string, unknown>>).map((n) =>
        n.id === 'goal_mrr' ? { ...n, label: 'Increase our subscription price' } : n,
      ),
    };
    // PRECONDITION PINNED IN-TEST (trap 13b): assert both arms genuinely fire on
    // this payload, so the outcome is the precedence rule's doing and not a
    // fixture that quietly stopped triggering one of them.
    const options = readObjectiveOptionViews(RECORDS_WITH_GOAL_PROBABILITY);
    expect(readGoalLabel(leverAimGraph)).toBe('Increase our subscription price');
    expect(readInterventionViews(leverAimGraph).some((v) => v.factor_id === 'fac_price_level')).toBe(
      true,
    );
    expect(options.some((o) => o.probability_of_goal !== undefined)).toBe(true);

    const disclosure = composeObjectiveContradictionDisclosure(
      leverAimGraph,
      RECORDS_WITH_GOAL_PROBABILITY,
      true,
    );
    expect(disclosure).toContain('is more likely to reach your stated target');
    expect(disclosure).not.toContain('the way your goal asks');
  });
});

// ============================================================================
// 3. THE SILENT CELLS, END TO END — zero new sentences on the wire path
// ============================================================================

describe('silence — a run with nothing honest to add changes the summary by ZERO bytes', () => {
  /**
   * ⚠ THE CELL THE WHOLE SURFACE IS JUDGED ON. Today the COMMON state is: no
   * goal target reached ISL (so no `probability_of_goal`), and the goal states
   * a direction over the METRIC rather than a lever. Both arms must be silent,
   * and the summary must be byte-identical to the one composed without this
   * feature at all.
   */
  it('⭐ no attainment data + a metric-direction goal ⇒ the summary is BYTE-IDENTICAL', () => {
    // Precondition pinned: this really is the banked goal, and it really does
    // carry a direction — so silence is the ARITHMETIC gate's doing, not a
    // fixture with no verb in it.
    expect(readGoalLabel(PRICING_GRAPH)).toBe('Grow MRR to £250,000');
    expect(readObjectiveOptionViews(RECORDS_NO_GOAL_PROBABILITY).length).toBe(3);

    const disclosure = composeObjectiveContradictionDisclosure(
      PRICING_GRAPH,
      RECORDS_NO_GOAL_PROBABILITY,
      true,
    );
    expect(disclosure).toBe('');
    expect(composeSummaryAsHandlerDoes(disclosure)).toBe(
      RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT,
    );
    expect(isAllowedRunAnalysisAssistantText(composeSummaryAsHandlerDoes(disclosure))).toBe(true);
  });

  it('a WITHHELD headline ships nothing, even when a contradiction exists', () => {
    // Positive control: there IS something to suppress.
    expect(
      composeObjectiveContradictionDisclosure(PRICING_GRAPH, RECORDS_WITH_GOAL_PROBABILITY, true),
    ).not.toBe('');
    expect(
      composeObjectiveContradictionDisclosure(PRICING_GRAPH, RECORDS_WITH_GOAL_PROBABILITY, false),
    ).toBe('');
  });

  it('no analysis, one option, or a junk graph ⇒ silence, never a throw', () => {
    expect(composeObjectiveContradictionDisclosure(PRICING_GRAPH, [], true)).toBe('');
    expect(
      composeObjectiveContradictionDisclosure(
        PRICING_GRAPH,
        [RECORDS_WITH_GOAL_PROBABILITY[0]!],
        true,
      ),
    ).toBe('');
    for (const junk of [null, undefined, 42, 'graph', [], {}]) {
      expect(composeObjectiveContradictionDisclosure(junk, RECORDS_NO_GOAL_PROBABILITY, true)).toBe(
        '',
      );
    }
  });
});

// ============================================================================
// 4. THE ADAPTERS READ THE REAL ROW
// ============================================================================

describe('adapters — bound to the real persisted shape, not to a hand-written one', () => {
  it('reads the goal label and the price interventions off the REAL L60 row', () => {
    expect(readGoalLabel(PRICING_GRAPH)).toBe('Grow MRR to £250,000');
    const price = readInterventionViews(PRICING_GRAPH).find(
      (v) => v.factor_id === 'fac_price_level',
    );
    expect(price).toBeDefined();
    expect(price!.factor_label).toBe('Seat Price Level');
    // The real values, from the real row.
    expect(price!.by_option.get('opt_hold')).toBe(0.49);
    expect(price!.by_option.get('opt_raise')).toBe(0.59);
    expect(price!.by_option.get('opt_tiers')).toBe(0.54);
  });

  it('handles the SEPARATE options[] shape as well as options-as-nodes', () => {
    const separate = {
      goal_node_id: 'goal_1',
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Increase price' },
        { id: 'fac_price', kind: 'factor', label: 'Price' },
      ],
      options: [
        { id: 'opt_a', label: 'A', interventions: { fac_price: { value: 0.4 } } },
        { id: 'opt_b', label: 'B', interventions: { fac_price: 0.6 } },
      ],
    };
    const price = readInterventionViews(separate).find((v) => v.factor_id === 'fac_price');
    expect(price!.by_option.get('opt_a')).toBe(0.4);
    // ...and a BARE numeric intervention, not just the { value } wrapper.
    expect(price!.by_option.get('opt_b')).toBe(0.6);
  });

  it('a factor with no resolvable LABEL is skipped — an id in prose is rejected at egress', () => {
    const noLabel = {
      goal_node_id: 'goal_1',
      nodes: [{ id: 'goal_1', kind: 'goal', label: 'Increase price' }],
      options: [{ id: 'opt_a', label: 'A', interventions: { fac_orphan: 0.4 } }],
    };
    expect(readInterventionViews(noLabel)).toEqual([]);
  });

  it('omits probability_of_goal and status when absent, rather than defaulting them', () => {
    const views = readObjectiveOptionViews([
      { option_id: 'opt_a', option_label: 'A', win_probability: 0.5 },
    ]);
    expect('probability_of_goal' in views[0]!).toBe(false);
    expect('status' in views[0]!).toBe(false);
    // ...and win_probability DOES default to 0, matching analysis-compact.ts.
    expect(readObjectiveOptionViews([{ option_id: 'opt_a' }])[0]!.win_probability).toBe(0);
  });
});
