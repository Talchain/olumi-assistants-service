/**
 * Task D: the visible-reply simulator is proved against the route's own output, and every new check is
 * proved to fire AND to pass on a minimal pair (a check that passes both, or flags both, measures nothing).
 * No network: fetch is replaced by a stub that refuses every host except api.openai.com (and nothing here calls it).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scoreWire } from '../../src/score.js';
import {
  checkLeaderHonestySplit,
  checkNextMove,
  checkProposalFigures,
  checkQuestionLimit,
  checkStructure,
  checkToolAction,
  checkUngroundedFigures,
  checkWinPctWhileWithheld,
  numbersOfJson,
  sameAtPrecision,
  type ExtraContext,
} from '../extra-checks.js';
import { BASE, leakHits, listReps, mulberry32, outsideReplies, scoreRep, shuffled } from '../score-paired.js';
import { conversationToolsFromInput, fp3ToolsFromInput, simulateVisible, textOfOutput } from '../simulate-visible.js';

const realFetch = globalThis.fetch;
const guardLog: string[] = [];
beforeAll(() => {
  for (const k of Object.keys(process.env)) if (/ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY') delete process.env[k];
  expect(Object.keys(process.env).filter((k) => /ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY')).toEqual([]);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    guardLog.push(url);
    throw new Error(`network guard: no network in this test (${url})`);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  expect(guardLog).toEqual([]);
});

const SHAPES = join(BASE, 'shapes');
const j = (p: string): Record<string, any> => JSON.parse(readFileSync(join(SHAPES, p), 'utf8'));

const TURNS = [
  ['hiring-construction/construction', '05', 'conversation'],
  ['pricing-construction/construction', '05', 'conversation'],
  ['heldout-ed-triage-construction/construction', '06', 'conversation'],
  ['pricing-run-complete/explicit-run', '01', 'fp3'],
  ['hiring-run-blocked/explicit-run', '01', 'fp3'],
] as const;

describe('visible-reply simulator = the 57f903c route, byte for byte', () => {
  it.each(TURNS)('%s: the captured model output, post-processed, equals the route’s assistant_text', (dir, call, kind) => {
    const req = j(`${dir}/call-${call}.request.json`);
    const raw = textOfOutput(j(`${dir}/call-${call}.response.json`).output);
    const route = j(`${dir}/route-response.json`).body;
    const tools = kind === 'fp3' ? fp3ToolsFromInput(req.body.input) : conversationToolsFromInput(req.body.input);
    expect(simulateVisible(raw, tools).visible).toBe(route.assistant_text);
    // tool calls recovered from the input are the route's own _agent.tool_calls
    expect(tools.toolCalls).toEqual(route._agent.tool_calls);
  });
  it('discriminates: raw text ≠ route text on construction turns (the server status paragraph), and treating a construction turn as an explicit Run breaks the match', () => {
    for (const [dir, call, kind] of TURNS.filter((t) => t[2] === 'conversation')) {
      const req = j(`${dir}/call-${call}.request.json`);
      const raw = textOfOutput(j(`${dir}/call-${call}.response.json`).output);
      const route = j(`${dir}/route-response.json`).body;
      expect(raw).not.toBe(route.assistant_text);
      const tools = conversationToolsFromInput(req.body.input);
      expect(simulateVisible(raw, { ...tools, kind: 'fp3' }).visible).not.toBe(route.assistant_text);
      expect(kind).toBe('conversation');
    }
  });
  it('removes a model-authored completion claim on a construction turn (narrateWriteOutcome is live), and keeps it on an explicit Run', () => {
    const req = j('pricing-construction/construction/call-05.request.json');
    const tools = conversationToolsFromInput(req.body.input);
    const sim = simulateVisible('Saved all four assumptions as version 2.\n\nThe comparison is next.', tools);
    expect(sim.stripped).toEqual(['Saved all four assumptions as version 2.']);
    expect(sim.visible.startsWith('The comparison is next.')).toBe(true);
    const fp3 = fp3ToolsFromInput(j('pricing-run-complete/explicit-run/call-01.request.json').body.input);
    expect(simulateVisible('Saved all four assumptions as version 2.', fp3).visible).toBe('Saved all four assumptions as version 2.');
  });
  it('refuses empty text rather than guessing the route’s fallback line', () => {
    const fp3 = fp3ToolsFromInput(j('hiring-run-blocked/explicit-run/call-01.request.json').body.input);
    expect(() => simulateVisible('  ', fp3)).toThrow(/fallback/);
  });
});

// ---------------------------------------------------------------------------

const PRICING_FP3_OPTIONS = ['Keep Pro at £49', 'Raise Pro to £59 at release', 'Phase Pro price increase'];
const WP = { 'Keep Pro at £49': 0.1538999999999994, 'Phase Pro price increase': 0.01329999999999994, 'Raise Pro to £59 at release': 0.8327999999999954 };
const ctx = (o: Partial<ExtraContext>): ExtraContext => ({
  turn: 'fp3', leaderPermitted: false, winProbabilities: {}, proposedFigures: [], optionLabels: PRICING_FP3_OPTIONS, otherLabels: ['Monthly churn rate'],
  chips: [], nextApprovalRan: null, inputNumbers: [], ...o,
});
const APPROVE = { id: 'agent-approve-proposal:prop_abc123', label: 'Use as starting assumptions', actionType: null };
const RUNCHIP = { id: 'agent-run-analysis', label: 'Run analysis', actionType: 'run_analysis' };

describe('WIN_PCT_WHILE_WITHHELD', () => {
  it('FAILS the served explicit-Run reply (present control from the served capture)', () => {
    const served = j('pricing-run-complete/explicit-run/route-response.json').body.assistant_text as string;
    const r = checkWinPctWhileWithheld(served, ctx({ winProbabilities: WP }));
    expect(r.verdict).toBe('FAIL');
    expect(r.findings[0]!.excerpt).toContain('83.28');
  });
  it('FAILS a rounded win % ("83.3%"); PASSES a % that is not a win probability ("84%"), and when the leader is permitted', () => {
    expect(checkWinPctWhileWithheld('It led in 83.3% of simulations.', ctx({ winProbabilities: WP })).verdict).toBe('FAIL');
    expect(checkWinPctWhileWithheld('It led in 84% of simulations.', ctx({ winProbabilities: WP })).verdict).toBe('PASS');
    const p = checkWinPctWhileWithheld('It led in 83.28% of simulations.', ctx({ winProbabilities: WP, leaderPermitted: true }));
    expect([p.verdict, p.vacuous]).toEqual(['PASS', true]);
  });
  it('sameAtPrecision reads the written precision', () => {
    expect(sameAtPrecision({ value: 83, text: '83', decimals: 0, index: 0, end: 2, currency: null }, 83.28)).toBe(true);
    expect(sameAtPrecision({ value: 83.2, text: '83.2', decimals: 1, index: 0, end: 4, currency: null }, 83.28)).toBe(false);
  });
});

describe('LEADER_HONESTY_SPLIT — the scorer’s rule on hyphen-split sentences', () => {
  const hy = 'The £59-at-release path produces the highest MRR outcome in this model.';
  const plain = 'The £59 at release path produces the highest MRR outcome in this model.';
  const wire = (text: string) => ({
    assistant_text: text,
    analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    draft_graph: { nodes: PRICING_FP3_OPTIONS.map((label, i) => ({ id: `o${i}`, kind: 'option', label })) },
    blocks: [{ type: 'analysis_result' }],
    _agent: { tool_calls: [{ name: 'run_analysis', ok: true, mutated: false }] },
    _diagnostic_trace: { fast_path: 'run' },
    _provider_calls: [{}],
  });
  const scorer = (text: string) => scoreWire(wire(text), 200, { capture: 't', build: 't', scenario: 't', turn: 't', index: 0 }, { userAction: 'run', domain: 'pricing', rerunKind: null, nextApprovalRan: null }).checks.LEADER_HONESTY.verdict;
  it('the gap is real: the copied scorer PASSES the hyphenated sentence and FAILS the same sentence unhyphenated', () => {
    expect(scorer(hy)).toBe('PASS');
    expect(scorer(plain)).toBe('FAIL');
  });
  it('FAILS the hyphenated sentence; PASSES the unhyphenated one (already the scorer’s — never counted twice) and a negated one', () => {
    expect(checkLeaderHonestySplit(hy, ctx({})).verdict).toBe('FAIL');
    expect(checkLeaderHonestySplit(plain, ctx({})).verdict).toBe('PASS');
    expect(checkLeaderHonestySplit('The £59-at-release path does not lead on this evidence.', ctx({})).verdict).toBe('PASS');
  });
});

describe('PROPOSAL_PROVENANCE and PROPOSAL_UNITS', () => {
  const figs = [
    { factor: 'Monthly churn', option: null, value: 3, unit: '%' },
    { factor: 'Pro subscriber count', option: null, value: 250, unit: 'subscribers' },
    { factor: 'Tech lead hires', option: null, value: 1, unit: 'hires' },
    { factor: 'Onboarding demand', option: null, value: 0, unit: 'additional hires being onboarded' },
  ];
  const c = ctx({ turn: 'construction', proposedFigures: figs, optionLabels: [] });
  it('FAILS an Olumi figure called the user’s; PASSES it attributed as Olumi’s assumption', () => {
    expect(checkProposalFigures('Monthly churn is 3%, the figure you gave.', c)[0]!.findings.map((f) => f.kind)).toContain('olumi_figure_called_users');
    expect(checkProposalFigures('Monthly churn: 3% — my starting assumption, not a measurement.', c)[0]!.verdict).toBe('PASS');
  });
  it('FAILS an Olumi figure quoted with no attribution anywhere in the reply', () => {
    expect(checkProposalFigures('Monthly churn: 3%.', c)[0]!.findings.map((f) => f.kind)).toEqual(['olumi_figures_unattributed']);
  });
  it('FAILS a non-zero figure without its unit; PASSES it with the unit; exempts zero and a unit the label names', () => {
    expect(checkProposalFigures('Monthly churn: 3 (assumed).', c)[1]!.verdict).toBe('FAIL');
    expect(checkProposalFigures('Monthly churn: 3% (assumed).', c)[1]!.verdict).toBe('PASS');
    // the factor label already names what is counted ("Pro subscriber count" / unit "subscribers")
    expect(checkProposalFigures('Pro subscriber count: 250 (assumed).', c)[1]!.verdict).toBe('PASS');
    expect(checkProposalFigures('Onboarding demand: 0 (assumed).', c)[1]!.verdict).toBe('PASS');
    expect(checkProposalFigures('Tech lead hires: 1 (assumed).', c)[1]!.verdict).toBe('PASS');
  });
});

describe('TOOL_ACTION', () => {
  it('FAILS an acting tool on the discussion card; PASSES a read-only one', () => {
    expect(checkToolAction(['run_analysis'], ctx({ turn: 'discussion' })).verdict).toBe('FAIL');
    expect(checkToolAction(['authorise_change'], ctx({ turn: 'discussion' })).verdict).toBe('FAIL');
    expect(checkToolAction(['get_canonical_state'], ctx({ turn: 'discussion' })).verdict).toBe('PASS');
  });
});

describe('soft proxies', () => {
  it('QUESTION_LIMIT: two questions FAIL, one PASSES', () => {
    expect(checkQuestionLimit('Is churn 3%? Is price £49?').verdict).toBe('FAIL');
    expect(checkQuestionLimit('Is churn 3%?').verdict).toBe('PASS');
  });
  it('STRUCTURE: four bullets or a bullet first FAIL; lead sentence + three bullets PASSES', () => {
    expect(checkStructure('Lead.\n- a\n- b\n- c\n- d').verdict).toBe('FAIL');
    expect(checkStructure('- a\n- b').findings.map((f) => f.kind)).toEqual(['no_lead_sentence']);
    expect(checkStructure('Lead.\n- a\n- b\n- c').verdict).toBe('PASS');
  });
  it('NEXT_MOVE: a run promised on approval is unsupported; a plain approval with a chip is supported; two move types FAIL; approval with no chip is unsupported', () => {
    const cons = ctx({ turn: 'construction', chips: [APPROVE, RUNCHIP], nextApprovalRan: false });
    expect(checkNextMove('If you approve these, I’ll save them and run the comparison.', cons).check.findings.map((f) => f.kind)).toEqual(['unsupported_next_move']);
    expect(checkNextMove('Approve these starting assumptions.', cons).check.verdict).toBe('PASS');
    expect(checkNextMove('Do you approve these starting assumptions?', cons).distinctTypes).toEqual(['approve']);
    expect(checkNextMove('Approve these assumptions. Then press Run analysis.', cons).check.findings.map((f) => f.kind)).toEqual(['more_than_one_next_move']);
    expect(checkNextMove('Approve these assumptions.', ctx({ chips: [] })).check.findings.map((f) => f.kind)).toEqual(['unsupported_next_move']);
    const none = checkNextMove('The comparison is incomplete.', cons).check;
    expect([none.verdict, none.vacuous]).toEqual(['PASS', true]);
  });
});

describe('UNGROUNDED_FIGURE (proxy)', () => {
  const input = JSON.parse(readFileSync(join(BASE, 'runs/pricing-construction/M/rep-1.request.json'), 'utf8')).body.input;
  const pool = numbersOfJson(input);
  it('the pool is the request input: the brief’s £49 and the proposal’s 250 are in it; 37 is not (precondition)', () => {
    expect(pool).toContain(49);
    expect(pool).toContain(250);
    expect(pool.some((p) => Number(p.toFixed(0)) === 37 || Number((p * 100).toFixed(0)) === 37)).toBe(false);
  });
  it('FAILS a figure found nowhere in the input; PASSES one that is', () => {
    const c = ctx({ turn: 'construction', inputNumbers: pool });
    expect(checkUngroundedFigures('Churn could reach 37% after the rise.', c).verdict).toBe('FAIL');
    expect(checkUngroundedFigures('The Pro price is £49 today, with 250 subscribers.', c).verdict).toBe('PASS');
  });
});

describe('real reps (pinned verdicts on the recorded outputs)', () => {
  const reps = listReps();
  it('finds all 44 recorded reps', () => expect(reps).toHaveLength(44));
  const get = (c: string, a: string, r: number) => scoreRep(c, a, r, reps.find((x) => x.caseId === c && x.arm === a && x.rep === r)!.dir);
  it('explicit-Run pricing, M rep-1: names the leader and quotes win % while withheld', () => {
    const s = get('pricing-run-complete', 'M', 1);
    expect(s.raw_text_equals_text_txt).toBe(true);
    expect(s.visible!.hardViolations).toEqual(expect.arrayContaining(['LEADER_HONESTY', 'WIN_PCT_WHILE_WITHHELD']));
  });
  it('explicit-Run pricing, C1 rep-2: no hard violation', () => {
    expect(get('pricing-run-complete', 'C1', 2).visible!.hardViolations).toEqual([]);
  });
  it('hiring construction, M rep-1: the approve-then-run promise; C1 rep-1: none', () => {
    const m = get('hiring-construction', 'M', 1);
    expect(m.visible!.checks.ACTION_TRUTH.findings.map((f) => f.kind)).toContain('promises_run_after_approval');
    expect(m.visible!.words).toBeGreaterThan(m.raw!.words);
    expect(get('hiring-construction', 'C1', 1).visible!.hardViolations).toEqual([]);
  });
  it('discussion card: a read-only tool call, no text, TOOL_ACTION PASS', () => {
    const d = get('pricing-discussion-card', 'C1', 1);
    expect([d.visible_text, d.function_calls]).toEqual([null, ['get_canonical_state']]);
    expect(d.raw!.extras.find((e) => e.name === 'TOOL_ACTION')!.verdict).toBe('PASS');
  });
});

describe('blinding helpers', () => {
  it('mulberry32 is deterministic and the shuffle is a permutation', () => {
    const a = shuffled(['M', 'C1', 'C2'], mulberry32(924026));
    const b = shuffled(['M', 'C1', 'C2'], mulberry32(924026));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(['C1', 'C2', 'M']);
  });
  it('the leak probe is a case-insensitive substring probe (it sees “harm”), and outsideReplies masks only fenced replies', () => {
    expect(leakHits('no harm done').map((h) => h.token)).toEqual(['arm']);
    expect(leakHits('Reply A')).toEqual([]);
    const pack = 'Intro.\n~~~~text\nA working baseline.\n~~~~\nRubric.';
    expect(leakHits(pack)).toHaveLength(1);
    expect(leakHits(outsideReplies(pack))).toHaveLength(0);
  });
});
