/**
 * LLM-judge quality dim (conversation-harness — ROADMAP 1.70 v1, OPT-IN).
 *
 * The property-based dims (prompt-dims.ts) can't judge "is this coaching actually
 * BETTER" — only whether it's grounded, coherent, and guard-clean. This adds a
 * rubric-scored judge: for each matched turn, a model (default claude-opus-4-8)
 * scores the assistant text on four criteria (specificity, actionability,
 * coaching_depth, no_generic_filler), independently per side, N>=3 times, and
 * ab-verdict-style deltas are reported with per-criterion MEAN and VARIANCE.
 *
 * Scoring each response INDEPENDENTLY (not pairwise) removes position bias and
 * composes with the same baseline-vs-candidate delta framing as the other dims.
 *
 * DISCIPLINE: this makes LIVE model calls, so it is OPT-IN and NOT part of the
 * default hermetic pipeline. Enable with LLM_JUDGE=1 and credentials present
 * (ANTHROPIC_API_KEY or an `ant` profile). The pure prompt-building, response
 * parsing, and aggregation are separated out and self-tested; the live call is a
 * thin dynamic-import wrapper so this module loads (and its logic is testable)
 * even where the SDK/credentials are absent.
 *
 * Usage:
 *   LLM_JUDGE=1 BASELINE_DIR=runs/base CANDIDATE_DIR=runs/cand \
 *     pnpm exec tsx tools/conversation-harness/scorer/llm-judge.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const JUDGE_CRITERIA = ['specificity', 'actionability', 'coaching_depth', 'no_generic_filler'] as const;
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];
export type JudgeScores = Record<JudgeCriterion, number>;

export const JUDGE_MODEL = process.env.LLM_JUDGE_MODEL ?? 'claude-opus-4-8';

const JUDGE_SYSTEM = [
  'You are a strict evaluator of DECISION-COACHING messages produced by an assistant that helps a user reason about a decision graph and its analysis.',
  'Score ONE assistant message on four criteria, each an integer 1-5 (1 = poor, 5 = excellent):',
  '- specificity: cites the specific options, factors, and numbers from THIS decision rather than generic prose.',
  '- actionability: tells the user something they can act on or decide next, not vague encouragement.',
  '- coaching_depth: explains WHY (drivers, trade-offs, what would change the result), not just WHAT.',
  '- no_generic_filler: free of hedging boilerplate ("it depends", "many factors", "consider your assumptions").',
  'Judge only the message text shown. Do NOT reward length. Respond with ONLY a JSON object of the four integer scores, no prose.',
].join('\n');

/** Build the judge request for one assistant message. Pure. */
export function buildJudgePrompt(assistantText: string, graphFacts?: string): { system: string; user: string } {
  const facts = graphFacts ? `\nDecision facts (for grounding):\n${graphFacts}\n` : '';
  return {
    system: JUDGE_SYSTEM,
    user: `${facts}\nAssistant message to score:\n"""\n${assistantText}\n"""\n\nReturn JSON: {"specificity":N,"actionability":N,"coaching_depth":N,"no_generic_filler":N}`,
  };
}

/** Extract the four scores from a model response. Defensive: finds the first
 * JSON object, clamps each score to 1-5, returns null if unparseable. Pure. */
export function parseJudgeScores(text: string): JudgeScores | null {
  const match = text.match(/\{[^}]*\}/);
  if (!match) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const out = {} as JudgeScores;
  for (const c of JUDGE_CRITERIA) {
    const v = Number(obj[c]);
    if (!Number.isFinite(v)) return null;
    out[c] = Math.min(5, Math.max(1, Math.round(v)));
  }
  return out;
}

export interface JudgeAggregate {
  n: number;
  perCriterion: Record<JudgeCriterion, { mean: number; stdev: number }>;
  overallMean: number;
  overallStdev: number;
}

function meanStdev(xs: number[]): { mean: number; stdev: number } {
  if (xs.length === 0) return { mean: 0, stdev: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean: Number(mean.toFixed(3)), stdev: Number(Math.sqrt(variance).toFixed(3)) };
}

/** Aggregate N judge runs into per-criterion + overall mean/stdev. Pure. */
export function aggregateJudge(scoresList: JudgeScores[]): JudgeAggregate {
  const perCriterion = {} as JudgeAggregate['perCriterion'];
  for (const c of JUDGE_CRITERIA) perCriterion[c] = meanStdev(scoresList.map((s) => s[c]));
  const overalls = scoresList.map((s) => JUDGE_CRITERIA.reduce((a, c) => a + s[c], 0) / JUDGE_CRITERIA.length);
  const o = meanStdev(overalls);
  return { n: scoresList.length, perCriterion, overallMean: o.mean, overallStdev: o.stdev };
}

export interface JudgeDelta {
  criterion: JudgeCriterion | 'overall';
  baseline: number;
  candidate: number;
  delta: number;
  baselineStdev: number;
  candidateStdev: number;
  /** delta is meaningful only if it clears the combined rerun noise. */
  aboveNoise: boolean;
}

/** Per-criterion baseline→candidate delta + overall call. Pure. A delta counts
 * as real only if it exceeds the summed rerun stdev of the two sides (so a swing
 * inside judge variance is reported as flat). Higher is better for all criteria. */
export function judgeDelta(baseline: JudgeAggregate, candidate: JudgeAggregate): {
  perCriterion: JudgeDelta[];
  overall: JudgeDelta;
  call: 'better' | 'worse' | 'mixed' | 'no-change';
} {
  const row = (c: JudgeCriterion | 'overall', b: { mean: number; stdev: number }, cd: { mean: number; stdev: number }): JudgeDelta => {
    const delta = Number((cd.mean - b.mean).toFixed(3));
    return { criterion: c, baseline: b.mean, candidate: cd.mean, delta, baselineStdev: b.stdev, candidateStdev: cd.stdev, aboveNoise: Math.abs(delta) > b.stdev + cd.stdev };
  };
  const perCriterion = JUDGE_CRITERIA.map((c) => row(c, baseline.perCriterion[c], candidate.perCriterion[c]));
  const overall = row('overall', { mean: baseline.overallMean, stdev: baseline.overallStdev }, { mean: candidate.overallMean, stdev: candidate.overallStdev });
  const up = perCriterion.filter((d) => d.aboveNoise && d.delta > 0).length;
  const down = perCriterion.filter((d) => d.aboveNoise && d.delta < 0).length;
  const call = up > 0 && down === 0 ? 'better' : down > 0 && up === 0 ? 'worse' : up > 0 && down > 0 ? 'mixed' : 'no-change';
  return { perCriterion, overall, call };
}

// ---------- live call (opt-in, dynamic import) ----------

/** Score one message N times via the model. Returns the raw score list.
 * Isolated so the pure logic above stays testable without the SDK. */
export async function judgeMessage(assistantText: string, opts: { reruns?: number; graphFacts?: string } = {}): Promise<JudgeScores[]> {
  const reruns = opts.reruns ?? 3;
  // Dynamic import via a variable specifier so this module loads (and lints/
  // typechecks) without the SDK statically resolvable — the optional runtime
  // dep resolves from the repo's node_modules at call time. Deliberately no
  // ts-suppression comment: the ignore directive is lint-banned, and the
  // expect-error directive would itself error in-repo where the import
  // resolves cleanly.
  const sdkSpecifier = '@anthropic-ai/sdk';
  const mod: any = await import(sdkSpecifier).catch(() => {
    throw new Error('@anthropic-ai/sdk not resolvable — run from the repo with deps installed');
  });
  const Anthropic = mod.default ?? mod.Anthropic;
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ant profile
  const { system, user } = buildJudgePrompt(assistantText, opts.graphFacts);
  const scores: JudgeScores[] = [];
  for (let i = 0; i < reruns; i += 1) {
    const res = await client.messages.create({ model: JUDGE_MODEL, max_tokens: 256, system, messages: [{ role: 'user', content: user }] });
    const text = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const parsed = parseJudgeScores(text);
    if (parsed) scores.push(parsed);
  }
  return scores;
}

/** Read per-turn assistant text from a scored run dir (scores.json rows). */
function turnsFromRun(runDir: string): { turn: string; text: string }[] {
  const parsed = JSON.parse(readFileSync(join(runDir, 'scores.json'), 'utf-8')) as { rows?: { turn: string; text?: string; turn_class_hint?: string | null }[] };
  return (parsed.rows ?? [])
    .filter((r) => (r.turn_class_hint ?? '') === 'coach' && (r.text ?? '').trim().length > 0)
    .map((r) => ({ turn: r.turn, text: String(r.text) }));
}

// ---------- entrypoint ----------

const isMain = process.argv[1] && process.argv[1].endsWith('llm-judge.ts');
if (isMain) {
  if (process.env.LLM_JUDGE !== '1') {
    throw new Error('LLM-judge is opt-in and makes LIVE model calls — set LLM_JUDGE=1 to run');
  }
  const baselineDir = process.env.BASELINE_DIR ?? '';
  const candidateDir = process.env.CANDIDATE_DIR ?? '';
  if (!baselineDir || !candidateDir) throw new Error('set BASELINE_DIR and CANDIDATE_DIR');
  const reruns = Number(process.env.LLM_JUDGE_RERUNS ?? 3);
  const run = async () => {
    const baseTurns = turnsFromRun(baselineDir);
    const candTurns = turnsFromRun(candidateDir);
    const baseScores: JudgeScores[] = [];
    const candScores: JudgeScores[] = [];
    for (const t of baseTurns) baseScores.push(...(await judgeMessage(t.text, { reruns })));
    for (const t of candTurns) candScores.push(...(await judgeMessage(t.text, { reruns })));
    if (baseScores.length === 0 || candScores.length === 0) throw new Error('no coach turns scored on one/both sides');
    const delta = judgeDelta(aggregateJudge(baseScores), aggregateJudge(candScores));
    const out = { generated_at: new Date().toISOString(), model: JUDGE_MODEL, reruns, baseline_dir: baselineDir, candidate_dir: candidateDir, ...delta };
    writeFileSync(join(candidateDir, 'llm-judge.json'), JSON.stringify(out, null, 2));
    console.log(`LLM-judge (${JUDGE_MODEL}): ${delta.call.toUpperCase()}  overall Δ${delta.overall.delta} -> ${join(candidateDir, 'llm-judge.json')}`);
    for (const d of delta.perCriterion) console.log(`  ${d.criterion}: ${d.baseline} -> ${d.candidate} (Δ${d.delta}${d.aboveNoise ? '' : ', within noise'})`);
  };
  run().catch((e) => {
    console.error(`llm-judge failed: ${String(e).slice(0, 300)}`);
    process.exit(1);
  });
}
