/**
 * Track 2, 23 Oct (served R2 on CEE 7b0af1a9: P01, P04, P07 and P08 had no "carry on" option, so the licence recorded no sent
 * threshold and goal_margins was absent; those replies named no input). The second route of `goalMarginsOf` takes every figure
 * from the selected Run's OWN retained inputs: its recorded question (bound by run id, revision, sent digest and the graph hash
 * it was computed against) whose dispatched threshold must be the target on the goal's own scale, today's level and each
 * option's one dispatched change, under the model's exact sum. The engine's rows and the licence's sides only have to agree.
 * The fixture is P01's served t3 read with every label, unit, id and quote renamed to synthetic words.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { goalMarginsOf } from '../goal-margins.js';
import { runFactsOf } from '../run-facts.js';
import { readRunEvidence } from '../run-evidence.js';
import { CORE_REPLY_INSTRUCTION } from '../../../routes/agent-v1-turn.js';

type Json = Record<string, any>;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/exact-no-carry-on-run.json', import.meta.url), 'utf8')) as Json;
const fresh = (): Json => structuredClone(fixture) as Json;
const marginsOf = (f: Json) =>
  goalMarginsOf(f.analysis_result, f.graph, true, readRunEvidence(f.analysis_run_evidence), f.analysis_run_evidence.run_id);
const snap = (f: Json): Json => f.analysis_run_evidence.input_snapshot;
const asked = (f: Json): Json => f.analysis_run_evidence.evaluated_question;
const licence = (f: Json): Json => f.analysis_result.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
const row = (f: Json, id: string): Json => f.analysis_result.enrichment.option_comparison.find((r: Json) => r.option_id === id);
const link = (f: Json, id: string): Json => f.graph.living_model.links.find((l: Json) => l.from === id);
const factor = (f: Json, id: string): Json => snap(f).factors.find((x: Json) => x.factor_id === id);
const setting = (f: Json, id: string): Json => snap(f).options.find((o: Json) => o.option_id === id).settings[0];
const SAID: Readonly<Record<string, string>> = { '>=': 'at_least', '>': 'above', '<=': 'at_most', '<': 'below' };
/** Every bound field moved together: a Run that really dispatched these figures, on the goal's own scale (÷ `per`). */
const shape = (f: Json, s: { today: number; target: number; op: string; changes: Readonly<Record<string, number>>; per?: number }): Json => {
  const per = s.per ?? 1125;
  const upward = s.op === '>=' || s.op === '>', strict = s.op === '>' || s.op === '<';
  Object.assign(snap(f).goal, { target_raw: s.target, operator: s.op, ...(upward ? {} : { direction: 'minimise' }) });
  for (const id of ['crate_goal', 'crate_goal_today']) Object.assign(factor(f, id), { raw: s.today, encoded: s.today / per });
  Object.assign(asked(f).calculated, { comparator: s.op, baseline: s.today, encoded_baseline: s.today / per, encoded_target: s.target / per });
  Object.assign(asked(f), { dispatched_goal_baseline: s.today / per, dispatched_goal_threshold: s.target / per });
  Object.assign(licence(f).target, { value: s.target, comparator: SAID[s.op] });
  for (const [id, x] of Object.entries(s.changes)) {
    Object.assign(setting(f, id), { raw: x, encoded: x });
    Object.assign(link(f, id).effect, { value: Math.abs(x), sign: x < 0 ? '-' : '+' });
    const level = s.today + x;
    Object.assign(row(f, id).outcome, { p10: level, p50: level, p90: level, mean: level, std: 0 });
    const margin = upward ? level - s.target : s.target - level;
    licence(f).withheld_reason_by_option[id].side = (strict ? margin > 0 : margin >= 0) ? 'meets' : 'falls_short';
  }
  return f;
};

describe('exact results with no "carry on" option: margins from the Run\'s own retained inputs', () => {
  it('the served P01 shape: each margin, and each own link\'s boundary, said as the model\'s figures (no static scope declared)', () => {
    const f = fresh();
    const facts = runFactsOf(f.analysis_result, f.graph, true, { runEvidence: readRunEvidence(f.analysis_run_evidence), selectedRunId: f.analysis_run_evidence.run_id });
    expect(facts.margins).toEqual({
      target: 900, comparator: '>=', unit: 'crates', baseline: 700, static_scope_declared: false,
      options: [
        { option_id: 'early_start', label: 'Early start', level: 960, margin: 60, meets: true, rests_on: { link_id: 'early_effect', saved: 260, boundary: 200 } },
        { option_id: 'extra_bench', label: 'Extra bench', level: 820, margin: -80, meets: false, rests_on: { link_id: 'bench_effect', saved: 120, boundary: 200 } },
      ],
    });
  });

  it('the performed threshold binds the target: a Run that dispatched 850 while the snapshot says 900 gets nothing', () => {
    const f = fresh();
    Object.assign(asked(f), { dispatched_goal_threshold: 850 / 1125 });
    asked(f).calculated.encoded_target = 850 / 1125;
    expect(marginsOf(f)).toBeUndefined();
  });

  it('the conversion is relative with no floor (Codex): a tiny scale dispatching 850 is refused, the same scale at 900 is not', () => {
    const tiny = (t: number, b = 7e-12) => { const f = fresh(); Object.assign(asked(f), { dispatched_goal_baseline: b, dispatched_goal_threshold: t });
      Object.assign(asked(f).calculated, { encoded_baseline: b, encoded_target: t }); return marginsOf(f); };
    expect(tiny(8.5e-12)).toBeUndefined();
    expect(tiny(9e-12)?.options.map((o) => o.margin)).toEqual([60, -80]);
    // Codex r1: a product that overflows is never "close" to a finite threshold (700 → 1.7e308 makes 900 × scale infinite).
    expect(tiny(1e300, 1.7e308)).toBeUndefined();
  });

  it('bound to THIS Run: another graph hash, a missing hash, another revision or another run id gets nothing', () => {
    const other = fresh(); other.analysis_result.computed_against_hash = 'ffffffffffffffff';
    const none = fresh(); delete none.analysis_result.computed_against_hash;
    const rev = fresh(); rev.analysis_run_evidence.occurrence.evaluated_scenario_revision = 4;
    const id = fresh(); asked(id).run_id = 'another-run';
    for (const f of [other, none, rev, id]) expect(marginsOf(f)).toBeUndefined();
  });

  it('the exact sum is required: without it, nothing, however well the rows agree', () => {
    const f = fresh();
    delete f.graph.nodes.find((n: Json) => n.id === 'crate_goal').nonlinear_identity;
    expect(marginsOf(f)).toBeUndefined();
  });

  it('agreement only: an engine row off the exact level, or a licence side that disagrees, gets nothing', () => {
    const r = fresh(); Object.assign(row(r, 'early_start').outcome, { p10: 961, p50: 961, p90: 961, mean: 961 });
    // Codex r2: a spread recorded as Infinity or NaN is not a zero spread.
    const inf = fresh(); row(inf, 'early_start').outcome.std = Infinity;
    const nan = fresh(); row(nan, 'early_start').outcome.std = Number.NaN;
    const s = fresh(); licence(s).withheld_reason_by_option.extra_bench.side = 'meets';
    const z = fresh(); licence(z).withheld_reason_by_option.extra_bench.reason = 'unearned_certainty';
    for (const f of [r, inf, nan, s, z]) expect(marginsOf(f)).toBeUndefined();
  });

  it('only the Run this route can read: a carry-on option that changes something, two settings, another unit, a moved change, a sent threshold not the dispatched one, another target shown, an option not in the Run', () => {
    const base = fresh(); snap(base).options[1].is_baseline = true;
    const two = fresh(); snap(two).options[0].settings.push({ ...setting(two, 'early_start'), factor_id: 'other' });
    const unit = fresh(); setting(unit, 'extra_bench').unit = 'boxes';
    const moved = fresh(); factor(moved, 'crate_goal__change').raw = 5;
    const sent = fresh(); licence(sent).sent_threshold = { frame: 'level', field: 'goal_threshold', value: 0.85, baseline: 700 / 1125 };
    const shown = fresh(); licence(shown).target.value = 950;
    const ghost = fresh(); licence(ghost).option_ids.push('ghost');
    const unsent = fresh(); snap(unsent).options_not_sent = [{ option_id: 'ghost' }];
    for (const f of [base, two, unit, moved, sent, shown, ghost, unsent]) expect(marginsOf(f)).toBeUndefined();
  });

  it('the person\'s link must be what the Run sent: a saved 250 against a dispatched 260 keeps the margin, names no input', () => {
    const f = fresh();
    link(f, 'early_start').effect.value = 250;
    const early = marginsOf(f)?.options.find((o) => o.option_id === 'early_start');
    expect(early).toEqual({ option_id: 'early_start', label: 'Early start', level: 960, margin: 60, meets: true });
  });

  it('equality under every comparator: at the target, "at least" and "at most" are met, "above" and "below" are not', () => {
    const at = (op: string) => marginsOf(shape(fresh(), { today: 700, target: 900, op, changes: { early_start: 200, extra_bench: 120 } }))
      ?.options.find((o) => o.option_id === 'early_start');
    expect([at('>='), at('>')].map((o) => [o?.margin, o?.meets])).toEqual([[0, true], [0, false]]);
    const down = (op: string) => marginsOf(shape(fresh(), { today: 180, target: 60, op, changes: { early_start: -120, extra_bench: -30 } }))
      ?.options.find((o) => o.option_id === 'early_start');
    expect([down('<='), down('<')].map((o) => [o?.margin, o?.meets])).toEqual([[0, true], [0, false]]);
  });

  it('the served P04 shape ("at most", minimise): margins 20 and −90, boundary −120; "minimise" with "at least" gets nothing', () => {
    const f = shape(fresh(), { today: 180, target: 60, op: '<=', changes: { early_start: -140, extra_bench: -30 } });
    expect(marginsOf(f)?.options.map((o) => [o.margin, o.meets, o.rests_on?.boundary])).toEqual([[20, true, -120], [-90, false, -120]]);
    const g = fresh(); snap(g).goal.direction = 'minimise';
    expect(marginsOf(g)).toBeUndefined();
  });

  it('the served P07 shape in decimals: 80 + 20.2 and 80 + 19.9 against 100 are exactly +0.2 and −0.1', () => {
    const f = shape(fresh(), { today: 80, target: 100, op: '>=', changes: { early_start: 20.2, extra_bench: 19.9 } });
    expect(marginsOf(f)?.options.map((o) => [o.level, o.margin, o.rests_on?.boundary])).toEqual([[100.2, 0.2, 20], [99.9, -0.1, 20]]);
  });

  // Codex: 8.00000000000001 + 1.000000000000001 is 9.000000000000011, which no number holds, so no figure is said (never a
  // float-scaled 9.000000000000012); 8.5 + 1.25 in the same shape is exactly 9.75.
  it('exact digits or nothing: a sum no number holds says nothing; an exact one says its digits', () => {
    const at = (today: number, x: number) => marginsOf(shape(fresh(), { today, target: 9, op: '>=', changes: { early_start: x, extra_bench: 0.5 } }));
    expect(at(8.00000000000001, 1.000000000000001)).toBeUndefined();
    expect(at(8.5, 1.25)?.options[0]).toMatchObject({ level: 9.75, margin: 0.75, meets: true });
  });

  it('the reply is told what an undeclared scope means: the model\'s figures as they stand, not a forecast to the goal\'s date', () => {
    expect(CORE_REPLY_INSTRUCTION).toContain('where goal_margins has static_scope_declared false, say once that these are the model\u2019s figures as they stand, not a forecast to the goal\u2019s date');
  });
});

/** Served R2 on CEE b921a8e2 (P01): a "carry on" option, but the engine's row 960.0000000000001 carries float noise, so the recorded
 * levels say nothing; the Run's own dispatched arithmetic still does, with the carry-on option at today's level. Renamed likewise. */
const noisy = JSON.parse(readFileSync(new URL('./fixtures/exact-carry-on-noise-run.json', import.meta.url), 'utf8')) as Json;
const freshNoisy = (): Json => structuredClone(noisy) as Json;

describe('exact results whose recorded levels carry float noise: the Run\'s dispatched arithmetic, carry-on included', () => {
  it('the served shape: 700 + 260 and 700 + 120 against 900, carry on at 700, never a test; the licence declared the static scope', () => {
    const f = freshNoisy();
    expect(row(f, 'early_start').outcome.p50).toBe(960.0000000000001);
    expect(marginsOf(f)).toEqual({
      target: 900, comparator: '>=', unit: 'crates', baseline: 700,
      options: [
        { option_id: 'early_start', label: 'Early start', level: 960, margin: 60, meets: true, rests_on: { link_id: 'early_effect', saved: 260, boundary: 200 } },
        { option_id: 'extra_bench', label: 'Extra bench', level: 820, margin: -80, meets: false, rests_on: { link_id: 'bench_effect', saved: 120, boundary: 200 } },
        { option_id: 'status_quo', label: 'Carry on as now', level: 700, margin: -200, meets: false },
      ],
    });
  });

  it('carry on only as itself: a carry-on that changes something, one without the licence\'s status-quo record, or a sent threshold not the dispatched one gets nothing', () => {
    const moves = freshNoisy(); setting(moves, 'status_quo').raw = 5;
    const unrecorded = freshNoisy(); delete licence(unrecorded).status_quo;
    const sent = freshNoisy(); licence(sent).sent_threshold.value = 0.85;
    for (const f of [moves, unrecorded, sent]) expect(marginsOf(f)).toBeUndefined();
  });
});
