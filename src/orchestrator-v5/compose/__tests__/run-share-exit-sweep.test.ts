/**
 * ⭐ THE WIN-SHARE CLASS — ONE EXIT-SWEEP PROPERTY TEST (DL ruling after the f5689c76 check FAIL, 12 Oct).
 *
 * Every exit — route-v2 (the executor's reply), the Agent's final exit, the Agent's replay, the explanation fallback — is an
 * adapter: its OWN evidence reader (`executorReplyRunEvidence`, `agentReplyRunEvidence`, `replayedRowRunEvidence`), the one
 * filter (`withRunShareFreeResult`), and for the fallback its REAL composer. Each adapter is swept over
 *   run evidence (every input flip of its reader, including the ones that must NOT count: a refused Run, a blocked Run, a
 *   run_analysis call that did not run, a model/provider call with no Run, a stale explanation, a replayed row with no proof)
 *   × share text (none, partial, all) × surface (reply, its shape, its chips, the analysis_result summary),
 * and judged by ONE property (`support/run-share-property.support.ts`) against the flip's GROUND TRUTH, never the evidence
 * the exit computed. The route rows (`route-v2-run-share-exits.route.test.ts`, `agent-run-share-exits.route.test.ts`) bind
 * the same property to the real exits.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import {
  RUN_RESULT_TEMPLATE, RUN_SHARE_QUALIFIER, executorReplyRunEvidence, statesRunShare, withRunShareFreeResult, type ReplyRunEvidence,
} from '../run-share-text.js';
import { agentReplyRunEvidence, replayedRowRunEvidence, type AgentTurnRunFacts } from '../../agent-lane/run-share-evidence.js';
import { RUN_RESULT_READY_TEXT } from '../../agent-lane/run-explanation.js';
import { buildAnalysisRefusalFact } from '../../context/analysis-refusal-continuity.js';
import { composeExplainResultsFallback } from '../../tools/handlers/explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import {
  CLEAN_SUMMARY, SHARED_SUMMARY, SHARE_FLIPS, SHARE_TEXT, runShareViolations, type RunShareTruth, type ShareFlip,
} from './support/run-share-property.support.js';

type Rec = Record<string, unknown>;
const NONE: RunShareTruth = { ran: false, explains: false };
const RAN: RunShareTruth = { ran: true, explains: false };
const EXPLAINS: RunShareTruth = { ran: false, explains: true };

/** A V5 body whose every result-capable surface carries the flip's share text (or none). */
function bodyWith(text: string, share: ShareFlip): Rec {
  return {
    response_version: 2,
    assistant_text: text,
    blocks: [{ type: 'analysis_result', summary: share === 'none' ? CLEAN_SUMMARY : SHARED_SUMMARY, leading_option_id: 'opt_raise',
      win_probabilities: { opt_raise: 0.62, opt_hold: 0.38 } }],
    suggested_actions: [
      { id: 'chip-check', label: 'Check the conversion rate', message: 'Check the conversion rate' },
      ...(share === 'none' ? [] : [{ id: 'chip-share', label: 'Why was ‘Raise to £59’ supported by the most runs?',
        message: 'Why was it supported by the most runs?' }]),
    ],
    insights: [],
    stage_indicator: 'analyse',
  };
}
const shapeOf = (text: string) => ({ headline: text.split(/(?<=\.)\s+/)[0]!, bullets: [], detail: '' });

interface Flip { readonly name: string; readonly truth: RunShareTruth }
interface Exit<F extends Flip> {
  readonly exit: string;
  readonly flips: readonly F[];
  /** The reply's words before the exit, for this flip and share text. */
  readonly text: (flip: F, share: ShareFlip) => string;
  /** The exit's own evidence reader on this flip's inputs. */
  readonly evidence: (flip: F) => ReplyRunEvidence;
}

// ── route-v2: the executor's own handler facts ─────────────────────────────────────────────────────────────────────────
const fact = (f: Rec) => f as unknown as HandlerFact;
const RUN_FACT = fact({ fact_type: 'run_analysis', fact_version: 1, noop: false, result: { scenario_id: 's', leading_option_id: 'opt_raise',
  summary: 'x', enrichment: { analysis_status: 'completed' } } });
const REFUSED_FACT = buildAnalysisRefusalFact({ scenarioId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', reasonCode: 'not_admissible' }) as HandlerFact;
const NOOP_RUN_FACT = fact({ ...(RUN_FACT as unknown as Rec), noop: true });
const EXPLAIN_FACT = fact({ fact_type: 'explain_results', fact_version: 1, noop: true, result: { precondition_unmet: false } });
const EXPLAIN_UNMET_FACT = fact({ fact_type: 'explain_results', fact_version: 1, noop: true, result: { precondition_unmet: true } });
const FLIP_FACT = fact({ fact_type: 'what_would_flip', fact_version: 1, noop: true, result: {} });
type RouteFlip = Flip & { readonly facts: readonly HandlerFact[] };
const ROUTE_V2: Exit<RouteFlip> = {
  exit: 'route-v2',
  flips: [
    { name: 'run_analysis ran', truth: RAN, facts: [RUN_FACT] },
    { name: 'run_analysis ran beside a chained explanation', truth: RAN, facts: [RUN_FACT, EXPLAIN_FACT] },
    { name: 'the refusal marker (a run_analysis fact that did not run)', truth: NONE, facts: [REFUSED_FACT] },
    { name: 'a noop run_analysis fact', truth: NONE, facts: [NOOP_RUN_FACT] },
    { name: 'explain_results answered', truth: EXPLAINS, facts: [EXPLAIN_FACT] },
    { name: 'explain_results precondition unmet', truth: NONE, facts: [EXPLAIN_UNMET_FACT] },
    { name: 'what_would_flip (reasoning)', truth: NONE, facts: [FLIP_FACT] },
    { name: 'a converse turn (no facts)', truth: NONE, facts: [] },
  ],
  text: (_f, share) => SHARE_TEXT[share],
  evidence: (f) => executorReplyRunEvidence(f.facts),
};

// ── the explanation fallback: the REAL composer's words on route-v2 ────────────────────────────────────────────────────
const PROJECTION = {
  status: 'completed', leading_option: { label: 'Raise to £59', probability: 0.62 }, runner_up: { label: 'Hold at £49', probability: 0.38 },
  margin_pp: 24, robustness_band: 'moderate', top_drivers: [{ factor_label: 'Conversion rate', influence: 0.42 }],
  fragile_edges: [{ from_label: 'Price', to_label: 'Conversion rate' }],
} as unknown as AnalysisProjectionSummary;
const FALLBACK_TEXT = composeExplainResultsFallback(PROJECTION, null, null);
const EXPLAIN_FALLBACK: Exit<RouteFlip> = {
  exit: 'explain fallback',
  flips: ROUTE_V2.flips.filter((f) => f.facts.length === 0 || f.facts.includes(EXPLAIN_FACT) || f.facts.includes(EXPLAIN_UNMET_FACT)),
  // The composer's own words (the partial case); none/all are the flip texts on the same exit.
  text: (_f, share) => (share === 'partial' ? FALLBACK_TEXT : SHARE_TEXT[share]),
  evidence: (f) => executorReplyRunEvidence(f.facts),
};

// ── the Agent's final exit: this turn's own results ────────────────────────────────────────────────────────────────────
type AgentFlip = Flip & { readonly turn: AgentTurnRunFacts };
const turn = (t: Partial<AgentTurnRunFacts>): AgentTurnRunFacts => ({ fastPath: undefined, firstAnalysisRan: false, toolCalls: [],
  toolResults: [], explainsCurrentRun: false, ...t });
const AGENT_FINAL: Exit<AgentFlip> = {
  exit: 'Agent final',
  flips: [
    { name: 'the first analysis ran', truth: RAN, turn: turn({ firstAnalysisRan: true }) },
    { name: 'the typed Run ran', truth: RAN, turn: turn({ fastPath: 'run', toolResults: [{ ok: true, ran: true }] }) },
    { name: 'the Agent\'s run_analysis call ran', truth: RAN,
      turn: turn({ toolCalls: [{ name: 'propose_model_change' }, { name: 'run_analysis' }], toolResults: [{ ok: true }, { ok: true, ran: true }] }) },
    { name: 'the typed Run was blocked', truth: NONE, turn: turn({ fastPath: 'run', toolResults: [{ ok: true, ran: false }] }) },
    { name: 'a run_analysis call that did not run', truth: NONE, turn: turn({ toolCalls: [{ name: 'run_analysis' }], toolResults: [{ ok: false }] }) },
    { name: '`ran` on ANOTHER tool\'s result, beside a run_analysis call that did not run', truth: NONE,
      turn: turn({ toolCalls: [{ name: 'propose_model_change' }, { name: 'run_analysis' }], toolResults: [{ ok: true, ran: true }, { ok: false }] }) },
    { name: 'a model call with another tool and no Run (the f5689c76 blocker)', truth: NONE,
      turn: turn({ toolCalls: [{ name: 'propose_model_change' }], toolResults: [{ ok: true }] }) },
    { name: 'a plain model reply (no tool)', truth: NONE, turn: turn({}) },
    { name: 'Explain on the current Run', truth: EXPLAINS, turn: turn({ fastPath: 'explain', explainsCurrentRun: true }) },
    { name: 'Explain on a stale Run', truth: NONE, turn: turn({ fastPath: 'explain', explainsCurrentRun: false }) },
    { name: 'a what-changes press (reasoning)', truth: NONE, turn: turn({ fastPath: 'method' }) },
  ],
  text: (_f, share) => SHARE_TEXT[share],
  evidence: (f) => agentReplyRunEvidence(f.turn),
};

// ── the Agent's replay: the STORED ROW's own evidence ─────────────────────────────────────────────────────────────────
type ReplayFlip = Flip & { readonly row: 'ran' | 'explains' | 'plain'; readonly explainsCurrentRun: boolean; readonly rebuilt?: true };
const REPLAYED = (t: RunShareTruth): RunShareTruth => ({ ...t, replayed: true });
const AGENT_REPLAY: Exit<ReplayFlip> = {
  exit: 'Agent replay',
  flips: [
    { name: 'a stored Run reply (Olumi\'s fixed Run line)', truth: REPLAYED(RAN), row: 'ran', explainsCurrentRun: false },
    // The row proves a Run, but the words being replayed are only share sentences: filtered, never a new Run claim.
    { name: 'a stored Run row whose replayed words are only share sentences', truth: REPLAYED(RAN), row: 'ran', explainsCurrentRun: false, rebuilt: true },
    { name: 'a stored explanation of the Run still current', truth: REPLAYED(EXPLAINS), row: 'explains', explainsCurrentRun: true },
    { name: 'a stored explanation whose Run moved', truth: REPLAYED(NONE), row: 'explains', explainsCurrentRun: false },
    { name: 'a pre-rule row with no proof (today\'s turn ran nothing it can lend)', truth: REPLAYED(NONE), row: 'plain', explainsCurrentRun: false },
  ],
  text: (f, share) => (f.row === 'ran' && f.rebuilt !== true ? `${RUN_RESULT_READY_TEXT}\n\n${SHARE_TEXT[share]}` : SHARE_TEXT[share]),
  evidence: (f) => replayedRowRunEvidence({ storedText: f.row === 'ran' ? `${RUN_RESULT_READY_TEXT}\n\n${SHARE_TEXT.all}` : SHARE_TEXT.all,
    explainsCurrentRun: f.explainsCurrentRun }),
};

const EXITS = [ROUTE_V2, EXPLAIN_FALLBACK, AGENT_FINAL, AGENT_REPLAY] as const;

/** Each reply that has something besides its share sentences, and exactly what must ship of it (written out by hand). */
const SURVIVES = new Map<string, string>([
  [SHARE_TEXT.partial, 'Check the conversion rate before you commit.'],
  [FALLBACK_TEXT, 'The result is driven mainly by Conversion rate, which has little effect on the lead. This result looks fairly stable, '
    + 'but it is worth checking the main assumptions before deciding. Would you like to explore what would change this result?'],
  [`${RUN_RESULT_READY_TEXT}\n\n${SHARE_TEXT.partial}`, `${RUN_RESULT_READY_TEXT}\n\nCheck the conversion rate before you commit.`],
  [`${RUN_RESULT_READY_TEXT}\n\n${SHARE_TEXT.all}`, RUN_RESULT_READY_TEXT],
]);

describe.each(EXITS as readonly Exit<Flip>[])('the class property at $exit', (exit) => {
  const cases = exit.flips.flatMap((flip) => SHARE_FLIPS.flatMap((share) => [false, true].map((shaped) => ({ flip, share, shaped }))));
  it.each(cases)('$flip.name × share $share × shape $shaped', ({ flip, share, shaped }) => {
    const text = exit.text(flip, share);
    const before = { ...bodyWith(text, share), ...(shaped ? { _answer_shape: shapeOf(text) } : {}) };
    const frozen = JSON.stringify(before);
    const after = withRunShareFreeResult(before, { evidence: exit.evidence(flip), exitPath: `sweep:${exit.exit}` }) as Rec;
    expect(JSON.stringify(before), 'the exit never mutates its input').toBe(frozen);
    expect(runShareViolations(flip.truth, before, after)).toEqual([]);
    const textAfter = String(after.assistant_text);
    // The flips the property states in words (removal and the template are separate permissions):
    if (flip.truth.ran && flip.truth.replayed !== true && share === 'all') expect(textAfter).toBe(RUN_RESULT_TEMPLATE);
    // Anything else left: exactly those words ship (bound by identity, never by a pattern), never qualified or templated.
    if (share !== 'none' && (flip.truth.ran || flip.truth.explains) && SURVIVES.has(text)) expect(textAfter).toBe(SURVIVES.get(text));
    if ((flip.truth.explains || flip.truth.replayed === true) && (flip.truth.ran || flip.truth.explains) && text === SHARE_TEXT.all) {
      expect(textAfter, 'never a Run claim: the whole words and the qualifier').toBe(`${text}\n\n${RUN_SHARE_QUALIFIER}`);
    }
    if (!flip.truth.ran && !flip.truth.explains) expect(after.assistant_text).toBe(before.assistant_text);
    // An unchanged body ships BY REFERENCE (route-v2 re-finalises only an edit); every edited body is a valid V5 body.
    if (share === 'none' && !shaped) expect(after).toBe(before);
    const { _answer_shape: _s, ...v5 } = after;
    expect(OlumiResponseSchema.safeParse(v5).success, JSON.stringify(OlumiResponseSchema.safeParse(v5).error?.issues?.slice(0, 3))).toBe(true);
  });
});

describe('the sweep sees the class (non-vacuity) and the explanation fallback is the real composer', () => {
  it('every share flip but `none` states a share; the fallback\'s own words state one beside sentences that survive', () => {
    expect(SHARE_FLIPS.filter((s) => statesRunShare(SHARE_TEXT[s]))).toEqual(['partial', 'all']);
    expect(statesRunShare(SHARED_SUMMARY)).toBe(true);
    expect(FALLBACK_TEXT).toMatch(/was supported by 62% of runs/);
    // Every result-flip text with something left is in SURVIVES, so the exact-words row is never skipped.
    for (const text of [SHARE_TEXT.partial, FALLBACK_TEXT, `${RUN_RESULT_READY_TEXT}\n\n${SHARE_TEXT.partial}`, `${RUN_RESULT_READY_TEXT}\n\n${SHARE_TEXT.all}`]) {
      expect(SURVIVES.has(text)).toBe(true);
    }
    expect(FALLBACK_TEXT.split(/(?<=[.!?])\s+/).some((s) => !statesRunShare(s))).toBe(true);
  });
  it('every exit sweeps flips of all three kinds: a Run, an explanation, and evidence that must not count', () => {
    for (const exit of EXITS as readonly Exit<Flip>[]) {
      expect(exit.flips.some((f) => f.truth.ran) || exit.exit === 'explain fallback', exit.exit).toBe(true);
      expect(exit.flips.some((f) => f.truth.explains), exit.exit).toBe(true);
      expect(exit.flips.some((f) => !f.truth.ran && !f.truth.explains), exit.exit).toBe(true);
    }
  });
});
