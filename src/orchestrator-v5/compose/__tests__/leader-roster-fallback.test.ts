/**
 * ⭐ BEFORE THIS FIX, THE WITHHELD-LEADER GATE STOOD DOWN ON 74% OF EXITS.
 *
 * THE HARM, reproduced at the module seam before this fix: on a turn whose
 * record correctly says `leader_claim {permitted:false, withheld_reason:
 * 'separation_unavailable'}`, the PROSE still named a leader — and BOTH rails
 * let it through:
 *
 *   · `enforceLeadingOptionClaimsAtWire` is the only rail that REMOVES bytes,
 *     and it derives its option roster from `opts.graph`. A null graph ⇒ empty
 *     roster ⇒ it stands down (loudly, `mode: 'roster_unavailable'`, but it
 *     stands down).
 *   · `guardLeadingOptionClaimsAtEgress` removes nothing BY DESIGN — `enforced:
 *     false` is a hardcoded constant. It is an alarm, not an enforcer.
 *
 * So the product logs `v5.invariant_violation` — its own words: "A user is being
 * told 'no option can be put forward yet' and shown which option leads, in one
 * response" — and ships it anyway.
 *
 * ── THE POPULATION, DERIVED NOT INHERITED ───────────────────────────────────
 * `enforceLeadingOptionClaimsAtWire` has EXACTLY ONE call site, inside
 * `sendFinalised200`. So the set of `sendFinalised200` exits IS the blast
 * radius. Measured at `0d070df0` with the same balanced-paren scan the repo's
 * own enumerator uses: 23 exits, 17 of them `graph: null`.
 *
 * ⚠ 17 IS A FLOOR, NOT THE RUNTIME RATE. The scan sees the LITERAL `graph:
 * null`; the six "armed" exits pass nullable expressions (`turnGraph` is
 * `GraphV3T | null` and is null when `run.effectiveGraph` is undefined AND the
 * request carried no parseable `graphState` — and the UI sends a turn, not a
 * graph). The true rate is >= 17/23.
 *
 * ── THE FIX: THE ROSTER, NOT THE VERDICT ────────────────────────────────────
 * The verdict is already correct — `permitted:false` is exactly right, and the
 * record is not what lied. What the enforcer lacks on a graph-less exit is
 * merely the LIST OF OPTION NAMES. `analysis_ready.options[].label` is that
 * list, it is already threaded into `sendFinalised200`, and reading it invents
 * no authority: it answers "which options exist", never "which one leads".
 *
 * Applied at the ONE call site, so a 24th exit inherits it by construction
 * rather than by anyone remembering. The population assertions below exist so
 * that stops being true LOUDLY if it ever stops being true.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

vi.mock('../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock('../../../config/index.js', () => ({
  config: { cee: {}, features: {} },
  isProduction: () => false,
}));

import {
  composeAnalysisStateV1,
  readFinalLeaderClaimEgressPolicy,
  WITHHELD_SEPARATION_UNAVAILABLE,
} from '../analysis-state-v1.js';
import {
  enforceLeadingOptionClaimsAtWire,
  optionRosterFromGraph,
  optionRosterFromAnalysisReady,
  textNamesAnOption,
} from '../leading-option-wire-enforcement.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_V2 = resolve(HERE, '../../../orchestrator/route-v2.ts');

/** Prose that BOTH asserts a lead AND names a real option. */
const LEADER_PROSE =
  "'go through a reseller partner' currently leads, with a probability of 76%.";

const GRAPH_WITH_ROSTER = {
  nodes: [
    { kind: 'option', label: 'go through a reseller partner' },
    { kind: 'option', label: 'stay enterprise-only' },
    { kind: 'goal', label: 'Maximise contribution' },
  ],
  edges: [],
};

/** The SAME option names, arriving by the payload the graph-less exits do carry. */
const ANALYSIS_READY = {
  status: 'needs_user_input',
  goal_node_id: 'goal_1',
  options: [
    { option_id: 'opt_a', label: 'go through a reseller partner', status: 'ready', interventions: {} },
    { option_id: 'opt_b', label: 'stay enterprise-only', status: 'needs_encoding', interventions: {} },
  ],
};

function responseWith(text: string): any {
  return {
    response_version: 2,
    assistant_text: text,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  };
}

/** The repo's own balanced-paren scan, so two guards cannot disagree about the population. */
function enumerateSendCalls(source: string): Array<{ graphIsNullLiteral: boolean }> {
  const calls: Array<{ graphIsNullLiteral: boolean }> = [];
  for (const m of source.matchAll(/sendFinalised200\(/g)) {
    const start = m.index!;
    if (/function\s+$/.test(source.slice(Math.max(0, start - 20), start))) continue;
    const open = start + m[0].length - 1;
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push({ graphIsNullLiteral: /\bgraph:\s*null\b/.test(source.slice(open, j + 1)) });
  }
  return calls;
}

describe('withheld-leader enforcement — the roster must survive a graph-less exit', () => {
  // ── INSTRUMENT FIRST. An unvalidated instrument makes every verdict below noise.
  it('INSTRUMENT: the roster readers actually discriminate', () => {
    expect(optionRosterFromGraph(GRAPH_WITH_ROSTER)).toContain('go through a reseller partner');
    expect(optionRosterFromGraph(null)).toHaveLength(0);
    expect(textAssertsLeadingOption(LEADER_PROSE)).toBe(true);
    expect(textAssertsLeadingOption('the weather is fine')).toBe(false);
  });

  // ── PRECONDITIONS PINNED, from the REAL record composer. Without these the
  //    behavioural assertions can pass on a payload that never reached the branch.
  it('PRECONDITION: entitled + separation-unknown really yields separation_unavailable', () => {
    const canonical: any = {
      status: 'ready',
      usableForProse: true,
      usableForChips: true,
      usableForFollowupContext: true,
      requiresRerun: false,
      blockedUnusable: false,
      contradictions: [],
    };
    const state: any = composeAnalysisStateV1({
      canonical,
      mayNameLeadingOption: true,
      rawRobustness: null,
    } as any);
    expect(state.leader_claim.permitted).toBe(false);
    expect(state.leader_claim.withheld_reason).toBe(WITHHELD_SEPARATION_UNAVAILABLE);
    expect(state.leader_claim.withheld_reason).toBe('separation_unavailable');
  });

  it('PRECONDITION: the prose genuinely asserts a leader and names a rostered option', () => {
    expect(textAssertsLeadingOption(LEADER_PROSE)).toBe(true);
    expect(textNamesAnOption(LEADER_PROSE, optionRosterFromAnalysisReady(ANALYSIS_READY))).toBe(true);
  });

  // ── THE FIX ────────────────────────────────────────────────────────────────
  it('derives the roster from analysis_ready when the exit carries NO graph', () => {
    const roster = optionRosterFromAnalysisReady(ANALYSIS_READY);
    expect([...roster].sort()).toEqual(
      ['go through a reseller partner', 'stay enterprise-only'].sort(),
    );
  });

  /**
   * ⭐ THE TWO READERS MUST AGREE ON WHICH LABELS COUNT — caught by a surviving
   * mutant, not by inspection. Stripping `MIN_OPTION_LABEL_LENGTH` from the new
   * reader left the whole suite GREEN, so the "same normalisation" claim was
   * asserted in a comment and tested nowhere. Two roster readers that disagreed
   * about a label would be two authorities on "is this option named" — the exact
   * drift class the fallback was written to avoid.
   *
   * A short label is the discriminator: it must be dropped by BOTH, so a
   * scenario with an option called "AI" cannot have prose suppressed on one path
   * and shipped on the other.
   */
  it('both roster readers apply the SAME minimum label length', () => {
    const shortLabel = 'AI'; // below MIN_OPTION_LABEL_LENGTH
    const fromGraph = optionRosterFromGraph({
      nodes: [
        { kind: 'option', label: shortLabel },
        { kind: 'option', label: 'go through a reseller partner' },
      ],
    });
    const fromReady = optionRosterFromAnalysisReady({
      options: [
        { option_id: 'o1', label: shortLabel },
        { option_id: 'o2', label: 'go through a reseller partner' },
      ],
    });
    expect(fromGraph).not.toContain(shortLabel);
    expect(fromReady).not.toContain(shortLabel);
    // …and they agree on the whole roster, not merely on the exclusion.
    expect([...fromReady].sort()).toEqual([...fromGraph].sort());
  });

  it('THE HARM CLOSED: withheld record + null graph + analysis_ready ⇒ the leader claim is removed', () => {
    const result = enforceLeadingOptionClaimsAtWire(responseWith(LEADER_PROSE), {
      requestId: 'r-null-graph',
      exitPath: 'edit_graph',
      leaderClaimPolicy: 'designation_withheld',
      graph: null,
      analysisReady: ANALYSIS_READY,
    } as any);

    expect(result.changed).toBe(true);
    expect(result.editedFields).toContain('assistant_text');
    expect(textAssertsLeadingOption(String(result.response.assistant_text))).toBe(false);
  });

  it('FINAL LICENCE WINS: entitlement true cannot overrule a near-tie response', () => {
    const canonical: any = {
      status: 'ready',
      usableForProse: true,
      usableForChips: true,
      usableForFollowupContext: true,
      requiresRerun: false,
      blockedUnusable: false,
      contradictions: [],
    };
    const analysisState = composeAnalysisStateV1({
      canonical,
      mayNameLeadingOption: true,
      rawRobustness: { level: 'low', near_tie_is_tie: true },
    } as any);
    const mountedPhrase = 'go through a reseller partner is only just ahead.';
    const response = {
      ...responseWith(mountedPhrase),
      analysis_state: analysisState,
    };

    expect(analysisState?.leader_claim).toMatchObject({
      permitted: false,
      withheld_reason: 'options_do_not_separate',
      separation: 'near_tie',
    });
    expect(textAssertsLeadingOption(mountedPhrase)).toBe(true);

    const result = enforceLeadingOptionClaimsAtWire(response as any, {
      requestId: 'r-near-tie-final-licence',
      exitPath: 'turn_executor',
      // The route now reads this value from the final response rather than
      // reusing the earlier entitlement (`true`).
      leaderClaimPolicy: readFinalLeaderClaimEgressPolicy(response),
      graph: GRAPH_WITH_ROSTER,
    } as any);

    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).not.toContain('only just ahead');
  });

  // ── THE ARMED CONTROL. Without it a pass above is indistinguishable from an
  //    enforcer that fires on everything.
  it('ARMED CONTROL: a real graph still arms the gate (unchanged behaviour)', () => {
    const result = enforceLeadingOptionClaimsAtWire(responseWith(LEADER_PROSE), {
      requestId: 'r-real-graph',
      exitPath: 'turn_executor',
      leaderClaimPolicy: 'designation_withheld',
      graph: GRAPH_WITH_ROSTER,
    } as any);
    expect(result.changed).toBe(true);
  });

  /**
   * ⭐ GRAPH PRIMACY, PINNED BY CONTENTION — the ORDER of the ternary, not just
   * its members.
   *
   * Caught by a surviving mutant, not by inspection: preferring the readiness
   * roster whenever it is non-empty left BOTH suites fully green (13/13 here,
   * 59/59 in the sibling), while the cruder "readiness ONLY, graph reader
   * ignored" mutant REDs the armed control. The suite could see the graph
   * reader DELETED and not see it DEMOTED — and demotion is the realistic
   * drift: a reorder, or a later edit preferring the richer-looking payload.
   *
   * The cause was that NO case passed both sources. Every graph-bearing case
   * omitted `analysisReady`; every readiness case passed `graph: null`. A
   * ternary whose branches are never both live cannot have its order tested,
   * and the two existing fixtures carry IDENTICAL labels, so merely populating
   * both would still not discriminate.
   *
   * This case makes them CONTEND with DISJOINT rosters. Graph primacy is the
   * entire safety argument for the six already-armed exits being byte-unchanged
   * by this fix: if readiness ever won, an exit that has a real graph would
   * start deciding "which options exist" from a different source — the two
   * authorities on one question that the module docstring exists to prevent.
   */
  it('GRAPH PRIMACY: when BOTH sources are populated and disjoint, the GRAPH roster decides', () => {
    /** Deliberately shares NO label with `GRAPH_WITH_ROSTER`. */
    const DISJOINT_READY = {
      status: 'needs_user_input',
      goal_node_id: 'goal_1',
      options: [
        { option_id: 'opt_z', label: 'open a Bologna depot', status: 'ready', interventions: {} },
      ],
    };

    // PIN THE PRECONDITION IN-TEST. Without this the assertion below could pass
    // on a payload where the two sources never actually contended — which is
    // precisely how the gap this test closes came to exist.
    const graphRoster = optionRosterFromGraph(GRAPH_WITH_ROSTER);
    const readinessRoster = optionRosterFromAnalysisReady(DISJOINT_READY);
    expect(graphRoster.length).toBeGreaterThan(0);
    expect(readinessRoster.length).toBeGreaterThan(0);
    expect(graphRoster.some((label) => readinessRoster.includes(label))).toBe(false);
    // …and the prose names a GRAPH option and NO readiness option, so the two
    // sources give OPPOSITE answers to "does this text name a rostered option".
    expect(textNamesAnOption(LEADER_PROSE, graphRoster)).toBe(true);
    expect(textNamesAnOption(LEADER_PROSE, readinessRoster)).toBe(false);

    const result = enforceLeadingOptionClaimsAtWire(responseWith(LEADER_PROSE), {
      requestId: 'r-both-sources-disjoint',
      exitPath: 'turn_executor',
      leaderClaimPolicy: 'designation_withheld',
      graph: GRAPH_WITH_ROSTER,
      analysisReady: DISJOINT_READY,
    } as any);

    // Graph primary ⇒ roster is the graph's ⇒ the prose names one ⇒ removed.
    // Readiness preferred ⇒ roster is ['open a Bologna depot'] ⇒ the prose names
    // nothing on it ⇒ the gate stands down and the lie ships. That is the
    // inversion this test exists to RED.
    expect(result.changed).toBe(true);
    expect(result.editedFields).toContain('assistant_text');
    expect(textAssertsLeadingOption(String(result.response.assistant_text))).toBe(false);
  });

  it.each([
    ['malformed', { nodes: 'not-an-array' }],
    ['empty', { nodes: [], edges: [] }],
  ])('PRESENT %s graph cannot be repaired by a stale readiness roster', (_label, graph) => {
    const input = responseWith(LEADER_PROSE);
    const result = enforceLeadingOptionClaimsAtWire(input, {
      requestId: `r-present-${_label}-graph`,
      exitPath: 'turn_executor',
      leaderClaimPolicy: 'designation_withheld',
      graph,
      analysisReady: ANALYSIS_READY,
    } as any);

    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });

  it('ABSENT graph still uses readiness as the bounded fallback', () => {
    const result = enforceLeadingOptionClaimsAtWire(responseWith(LEADER_PROSE), {
      requestId: 'r-absent-graph-readiness-fallback',
      exitPath: 'turn_executor',
      leaderClaimPolicy: 'designation_withheld',
      graph: null,
      analysisReady: ANALYSIS_READY,
    } as any);

    expect(result.changed).toBe(true);
    expect(textAssertsLeadingOption(String(result.response.assistant_text))).toBe(false);
  });

  // ── THE OPPOSITE TWIN. A gate that withholds everything is not a fix, it is a
  //    different defect — and it is the failure mode that has bitten repeatedly.
  it('OPPOSITE TWIN: a PERMITTED claim keeps its leader, roster or no roster', () => {
    const permitted = enforceLeadingOptionClaimsAtWire(responseWith(LEADER_PROSE), {
      requestId: 'r-permitted',
      exitPath: 'turn_executor',
      leaderClaimPolicy: 'designation_permitted',
      graph: null,
      analysisReady: ANALYSIS_READY,
    } as any);
    expect(permitted.changed).toBe(false);
    expect(permitted.response.assistant_text).toBe(LEADER_PROSE);
  });

  it('STANDS DOWN STILL when neither source yields a roster — no blind suppression', () => {
    const result = enforceLeadingOptionClaimsAtWire(responseWith(LEADER_PROSE), {
      requestId: 'r-no-roster',
      exitPath: 'clarify_v2',
      leaderClaimPolicy: 'designation_withheld',
      graph: null,
      analysisReady: { status: 'blocked', goal_node_id: '', options: [] },
    } as any);
    expect(result.changed).toBe(false);
    expect(result.response.assistant_text).toBe(LEADER_PROSE);
  });

  it('does not suppress prose that names NO option, even with a roster', () => {
    const result = enforceLeadingOptionClaimsAtWire(
      responseWith('Sales leads improved across the quarter.'),
      {
        requestId: 'r-innocent',
        exitPath: 'edit_graph',
        leaderClaimPolicy: 'designation_withheld',
        graph: null,
        analysisReady: ANALYSIS_READY,
      } as any,
    );
    expect(result.changed).toBe(false);
  });

  // ── POPULATION. Behaviour alone would fix 17 cases; these close the CLASS.
  describe('the population this fix covers', () => {
    const source = readFileSync(ROUTE_V2, 'utf8');

    it('the enumerator SEES the exits (else every assertion here is vacuous)', () => {
      expect(enumerateSendCalls(source).length).toBeGreaterThanOrEqual(15);
    });

    it('the roster fix sits at the ONE call site every exit funnels through', () => {
      const calls = source.match(/enforceLeadingOptionClaimsAtWire\(/g) ?? [];
      // One CALL (the import line is not a call).
      expect(calls).toHaveLength(1);
      // …and it threads BOTH roster sources. A 24th exit inherits this by
      // construction; if this assertion ever fails, the class has reopened.
      const span = source.slice(source.indexOf('enforceLeadingOptionClaimsAtWire('));
      const args = span.slice(0, span.indexOf('});') + 3);
      expect(args).toContain('leaderClaimPolicy: finalLeaderClaimPolicy');
      expect(args).toContain("hasOwnProperty.call(wireFinaliserContext, 'reasoningGraph')");
      expect(args).toContain('wireFinaliserContext.reasoningGraph');
      expect(args).toContain(': ctx.graph');
      expect(args).toContain('wireFinaliserContext.exitReasoningGraph');
      expect(args).toContain('analysisReady: ctx.analysisReady');
    });

    it('TRIPWIRE: the exit population is 23 — a new exit must be looked at, not assumed', () => {
      const calls = enumerateSendCalls(source);
      // Not a mirror to keep green: if you added an exit, confirm it funnels
      // through sendFinalised200 (it must, or the guard above fails too) and
      // then update this number deliberately.
      expect(calls.length).toBe(23);
      // Both classes still exist, so the scan is genuinely classifying.
      expect(calls.some((c) => c.graphIsNullLiteral)).toBe(true);
      expect(calls.some((c) => !c.graphIsNullLiteral)).toBe(true);
    });
  });
});
