/**
 * Markdown baseline report over scored turns. Deterministic: no clock, no host
 * paths — the same captures produce the same bytes.
 */
import { CHECK_NAMES, type CheckName } from './checks.js';
import { CASE_CLASSES, type CaseClass } from './classify.js';
import { DEFAULT_WORDS_SOFT, type TurnScore } from './score.js';

export interface CaptureMeta {
  readonly label: string;
  readonly build: string;
  readonly sameBuild: boolean | null;
  readonly turns: number;
  readonly scenarios: readonly string[];
}

export interface ReportInput {
  readonly scores: readonly TurnScore[];
  readonly captures: readonly CaptureMeta[];
  readonly currentBuild: string;
  readonly command: string;
  readonly capturesLocation: string;
  /** Contrast control for the control-reference zero: control vocabulary in the scored replies' prose. */
  readonly controlVocabulary: { readonly hits: number; readonly turnsWithHits: number; readonly turns: number };
}

const SHORT: Record<CheckName, string> = {
  CONTROL_REFERENCE: 'Ctl',
  LEADER_HONESTY: 'Ldr',
  ACTION_TRUTH: 'Act',
  OPTION_NAME_FIDELITY: 'Opt',
  UNITS: 'Unt',
  PROVENANCE_WORDING: 'Prv',
  CAVEAT: 'Cav',
  INTERNAL_ID: 'Id',
};

function quantile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}
const fmt = (n: number | null): string => (n === null ? '–' : String(n));
const pct = (k: number, n: number): string => (n === 0 ? '–' : `${Math.round((100 * k) / n)}% (${k})`);
const count = (xs: readonly TurnScore[], f: (t: TurnScore) => boolean): number => xs.filter(f).length;
const verdicts = (xs: readonly TurnScore[], c: CheckName, v: 'PASS' | 'FAIL' | 'NOT_DECIDABLE') => count(xs, (t) => t.checks[c].verdict === v);

function byClass(scores: readonly TurnScore[]): [CaseClass, TurnScore[]][] {
  return CASE_CLASSES.map((c) => [c, scores.filter((s) => s.cls === c)] as [CaseClass, TurnScore[]]).filter(([, xs]) => xs.length > 0);
}

function lengthTable(scores: readonly TurnScore[]): string[] {
  const rows = [
    `| Class | n | Median words (final) | p90 words (final) | Over ~${DEFAULT_WORDS_SOFT} words (final) | Median model words (EST.) | Over ~${DEFAULT_WORDS_SOFT} (model EST.) | Server status/disclosure present | >1 question (final) | >1 question (model EST.) | Turns with ≥1 chip |`,
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [cls, xs] of byClass(scores)) {
    if (cls === 'no_reply') {
      rows.push(`| ${cls} | ${xs.length} | – | – | – | – | – | – | – | – | – |`);
      continue;
    }
    const fw = xs.map((t) => t.metrics.finalWords);
    const mw = xs.map((t) => t.metrics.modelWordsEstimate);
    rows.push(
      `| ${cls} | ${xs.length} | ${fmt(quantile(fw, 0.5))} | ${fmt(quantile(fw, 0.9))} | ${pct(count(xs, (t) => t.metrics.finalWords > DEFAULT_WORDS_SOFT), xs.length)} | ${fmt(quantile(mw, 0.5))} | ${pct(count(xs, (t) => t.metrics.modelWordsEstimate > DEFAULT_WORDS_SOFT), xs.length)} | ${count(xs, (t) => t.metrics.serverStatusPresent)} | ${count(xs, (t) => t.metrics.finalQuestions > 1)} | ${count(xs, (t) => t.metrics.modelQuestionsEstimate > 1)} | ${count(xs, (t) => t.metrics.chipCount > 0)} |`,
    );
  }
  return rows;
}

/** Column order of the checks table; the FAIL and NOT_DECIDABLE columns both follow it. */
const TABLE_ORDER: readonly CheckName[] = ['LEADER_HONESTY', 'ACTION_TRUTH', 'CAVEAT', 'CONTROL_REFERENCE', 'OPTION_NAME_FIDELITY', 'UNITS', 'PROVENANCE_WORDING', 'INTERNAL_ID'];
const FAIL_HEADER: Record<CheckName, string> = {
  LEADER_HONESTY: 'Leader-honesty FAIL',
  ACTION_TRUTH: 'Action-truth FAIL',
  CAVEAT: 'Caveat miss',
  CONTROL_REFERENCE: 'Control-ref FAIL',
  OPTION_NAME_FIDELITY: 'Option-name FAIL',
  UNITS: 'Units FAIL',
  PROVENANCE_WORDING: 'Provenance FAIL',
  INTERNAL_ID: 'Internal-id FAIL',
};

function checksRow(label: string, xs: readonly TurnScore[]): string {
  const fails = TABLE_ORDER.map((c) => verdicts(xs, c, 'FAIL')).join(' | ');
  const nd = TABLE_ORDER.map((c) => verdicts(xs, c, 'NOT_DECIDABLE')).join('/');
  return `| ${label} | ${xs.length} | ${fails} | ${nd} |`;
}

function checksTable(scores: readonly TurnScore[]): string[] {
  const rows = [
    `| Class | n | ${TABLE_ORDER.map((c) => FAIL_HEADER[c]).join(' | ')} | NOT_DECIDABLE (${TABLE_ORDER.map((c) => SHORT[c]).join('/')}) |`,
    `|---|---:|${TABLE_ORDER.map(() => '---:').join('|')}|---|`,
  ];
  for (const [cls, xs] of byClass(scores)) rows.push(checksRow(cls, xs));
  rows.push(checksRow('**all scored**', scores.filter((s) => s.cls !== 'no_reply')));
  return rows;
}

function verdictTally(scores: readonly TurnScore[]): string[] {
  const rows = ['| Check | PASS (checked) | PASS (vacuous: nothing to check) | FAIL | NOT_DECIDABLE |', '|---|---:|---:|---:|---:|'];
  const xs = scores.filter((s) => s.cls !== 'no_reply');
  for (const c of CHECK_NAMES) {
    rows.push(
      `| ${c} | ${count(xs, (t) => t.checks[c].verdict === 'PASS' && !t.checks[c].vacuous)} | ${count(xs, (t) => t.checks[c].verdict === 'PASS' && t.checks[c].vacuous)} | ${verdicts(xs, c, 'FAIL')} | ${verdicts(xs, c, 'NOT_DECIDABLE')} |`,
    );
  }
  return rows;
}

function excerpts(scores: readonly TurnScore[], check: CheckName, max: number): string[] {
  // One excerpt per turn, so two excerpts show two replies rather than two sentences of one.
  const out: string[] = [];
  for (const t of scores) {
    const f = t.checks[check].findings[0];
    if (f === undefined) continue;
    if (out.length >= max) break;
    out.push(`- \`${t.key.capture}\` ${t.key.turn} (${t.cls}, ${t.checks[check].reason.replace(/^.*?while /, '')}) [${f.where}]: “${f.excerpt}”`);
  }
  return out;
}

function findingKinds(scores: readonly TurnScore[], check: CheckName): string {
  const kinds = new Map<string, number>();
  for (const t of scores) for (const f of t.checks[check].findings) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
  return [...kinds.entries()].map(([k, n]) => `${k} ×${n}`).join(', ') || 'none';
}

function section(title: string, scores: readonly TurnScore[]): string[] {
  const turns = scores.length;
  const noReply = count(scores, (t) => t.cls === 'no_reply');
  return [
    `## ${title}`,
    '',
    `${turns} turns${noReply > 0 ? ` (${noReply} with no reply body — HTTP error or empty text — counted as \`no_reply\` and excluded from length figures)` : ''}.`,
    '',
    '### Length, questions, status line, chips',
    '',
    ...lengthTable(scores),
    '',
    '### Checks by class',
    '',
    ...checksTable(scores),
    '',
    '### Verdict tally',
    '',
    ...verdictTally(scores),
    '',
    `### Leader-honesty FAIL excerpts (first ${Math.min(2, count(scores, (t) => t.checks.LEADER_HONESTY.verdict === 'FAIL'))} of ${count(scores, (t) => t.checks.LEADER_HONESTY.verdict === 'FAIL')} failing turns; verbatim, emphasis markers dropped)`,
    '',
    ...(excerpts(scores, 'LEADER_HONESTY', 2).length > 0 ? excerpts(scores, 'LEADER_HONESTY', 2) : ['- none']),
    '',
    `Finding kinds — action truth: ${findingKinds(scores, 'ACTION_TRUTH')}; option names: ${findingKinds(scores, 'OPTION_NAME_FIDELITY')}; units: ${findingKinds(scores, 'UNITS')}; provenance: ${findingKinds(scores, 'PROVENANCE_WORDING')}; control references: ${findingKinds(scores, 'CONTROL_REFERENCE')}.`,
    '',
    '### Served behaviour seen in the same captures (not wording)',
    '',
    `- Approval or canvas-edit turns that ran the analysis: ${count(scores, (t) => t.observations.analysisRanOnApprovalOrEdit)}${scores
      .filter((t) => t.observations.analysisRanOnApprovalOrEdit)
      .map((t) => ` — \`${t.key.capture}\` ${t.key.turn}`)
      .join(';')}.`,
    `- Turns where the analysis_result block's own \`summary\` names a leader while \`leader_claim.permitted=false\`: ${count(scores, (t) => t.observations.blockSummaryNamesLeaderWhileWithheld === true)} of ${count(scores, (t) => t.observations.blockSummaryNamesLeaderWhileWithheld !== null)} such blocks. Whether the UI renders that summary is not in a capture.`,
    `- Turns where the leader was permitted by \`leader_claim\` but Runtime PR-B's \`leader_may_be_named\` rule (permitted AND \`permitted_analysis_mode = comparative_leader\`) would withhold it: ${count(scores, (t) => t.facets.leaderPermitted === true && t.facets.leaderMayBeNamedPrB === false)}.`,
    '',
  ];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function medianOf(xs: readonly TurnScore[], f: (t: TurnScore) => number): number | null {
  return quantile(xs.map(f), 0.5);
}

function verdictLines(input: ReportInput, scored: readonly TurnScore[]): string[] {
  const withheld = scored.filter((t) => t.facets.leaderPermitted === false);
  const ldrFailTurns = withheld.filter((t) => t.checks.LEADER_HONESTY.verdict === 'FAIL');
  const reportingWithheld = withheld.filter((t) => t.facets.ranAnalysis || ['challenge', 'uncertainty_followup'].includes(t.cls));
  const ldrFailReporting = reportingWithheld.filter((t) => t.checks.LEADER_HONESTY.verdict === 'FAIL');
  const ldrWhere = new Set(ldrFailTurns.flatMap((t) => t.checks.LEADER_HONESTY.findings.map((f) => f.where)));
  const promiseFail = count(scored, (t) => t.checks.ACTION_TRUTH.findings.some((f) => f.kind === 'promises_run_after_approval'));
  const promiseNd = count(scored, (t) => t.checks.ACTION_TRUTH.verdict === 'NOT_DECIDABLE' && /promises the analysis will run/.test(t.checks.ACTION_TRUTH.reason));
  const otherActionFail = count(scored, (t) => t.checks.ACTION_TRUTH.findings.some((f) => f.kind !== 'promises_run_after_approval'));
  const ranOnApproval = scored.filter((t) => t.observations.analysisRanOnApprovalOrEdit);
  const modelTurns = scored.filter((t) => t.metrics.splitBasis === 'trailing_server_paragraphs' || t.metrics.splitBasis === 'no_server_paragraph');
  const over = count(modelTurns, (t) => t.metrics.modelWordsEstimate > DEFAULT_WORDS_SOFT);
  const builds = scored.filter((t) => t.cls.startsWith('build_'));
  const results = scored.filter((t) => t.facets.ranAnalysis && !t.facets.runBlocked);
  const caveatOwed = count(scored, (t) => t.checks.CAVEAT.verdict !== 'NOT_DECIDABLE' && !t.checks.CAVEAT.vacuous);
  const caveatMiss = verdicts(scored, 'CAVEAT', 'FAIL');
  const ctlFail = verdicts(scored, 'CONTROL_REFERENCE', 'FAIL');
  const ctlNd = verdicts(scored, 'CONTROL_REFERENCE', 'NOT_DECIDABLE');
  const optFail = verdicts(scored, 'OPTION_NAME_FIDELITY', 'FAIL');
  const unitFail = verdicts(scored, 'UNITS', 'FAIL');
  const provNd = verdicts(scored, 'PROVENANCE_WORDING', 'NOT_DECIDABLE');
  const classSizes = byClass(scored).map(([, xs]) => xs.length);
  return [
    `- **Leader honesty:** ${ldrFailTurns.length} of ${withheld.length} scored turns with \`leader_claim.permitted=false\` name an option as leading. Of the ${reportingWithheld.length} that report an analysis result, ${ldrFailReporting.length} do; of the other ${withheld.length - reportingWithheld.length} (build, approval, edit, blocked-run and similar turns), ${ldrFailTurns.length - ldrFailReporting.length} do. Findings sit in the ${[...ldrWhere].join(' and ') || '—'} text.`,
    `- **Promised run on approval:** ${plural(promiseFail, 'reply promises', 'replies promise')} that approving will run the comparison and the next captured approval in that conversation ran nothing (FAIL); ${promiseNd} more could not be checked (no later approval captured). Other action-truth FAILs: ${otherActionFail}.`,
    `- **Length:** ${over} of ${modelTurns.length} replies with model-written text exceed ~${DEFAULT_WORDS_SOFT} model words (ESTIMATE). Median model words: build turns ${fmt(medianOf(builds, (t) => t.metrics.modelWordsEstimate))}, turns that ran an analysis ${fmt(medianOf(results, (t) => t.metrics.modelWordsEstimate))}.`,
    `- **Caveats:** owed on ${caveatOwed} turns, missing on ${caveatMiss}. **Controls:** ${plural(ctlFail, 'reply names', 'replies name')} a control that was not shown (${ctlNd} NOT_DECIDABLE); contrast control — ${input.controlVocabulary.hits} control-vocabulary hits in prose across ${input.controlVocabulary.turnsWithHits} of ${input.controlVocabulary.turns} scored replies (all builds), so the probe had material to see.`,
    `- **Option names:** ${plural(optFail, 'reply quotes', 'replies quote')} an option under a name that is not its label. **Units:** ${plural(unitFail, 'reply quotes', 'replies quote')} a model figure without its unit. **Provenance wording:** NOT_DECIDABLE on ${provNd} of ${scored.length} (see below).`,
    `- **Served behaviour, not wording:** ${plural(ranOnApproval.length, 'approval/edit turn', 'approval/edit turns')} ran the analysis${ranOnApproval.map((t) => ` (\`${t.key.capture}\` ${t.key.turn})`).join('')}.`,
    `- **Sample size:** ${scored.length} scored turns on this build, ${Math.min(...classSizes)}–${Math.max(...classSizes)} per class — a baseline to compare against, not a rate estimate.`,
  ];
}

export function renderReport(input: ReportInput): string {
  const current = input.scores.filter((s) => s.key.build === input.currentBuild);
  const older = input.scores.filter((s) => s.key.build !== input.currentBuild);
  const scored = current.filter((s) => s.cls !== 'no_reply');
  return [
    `# Agent-reply baseline — served build \`${input.currentBuild}\``,
    '',
    'Deterministic scoring of CAPTURED Agent-lane replies (`/proxy/v5/turn` → `agent_lane_v1`). No model was called to produce this report.',
    'Three things are reported separately and must not be conflated: **authored tests** (the scorer’s own self-tests), **matched model outputs** (none here — see the FP3 replay, prepared but not run), and **served behaviour** (these captures).',
    '',
    '## Verdict (current build only)',
    '',
    ...verdictLines(input, scored),
    '',
    '## Captures scored',
    '',
    `Source: ${input.capturesLocation}. Build = the served CEE \`/healthz\` build recorded by the witness in \`<label>-summary.json\`; “same build” = the witness saw no deploy during the run.`,
    '',
    '| Capture | Build | Same build throughout | Scenarios | Turns |',
    '|---|---|---|---|---:|',
    ...input.captures.map((c) => `| \`${c.label}\` | \`${c.build}\` | ${c.sameBuild === null ? 'not recorded' : c.sameBuild ? 'yes' : '**no**'} | ${c.scenarios.join(' ')} | ${c.turns} |`),
    '',
    'Scenario letters are the witness’s: A/D/E/O send the hiring brief, B/W the pricing brief, G one held-out brief per capture.',
    '',
    ...section(`Current build \`${input.currentBuild}\``, current),
    ...section('Older builds (for trend only — different prompts and routes)', older),
    '## What these captures cannot establish',
    '',
    '- **Raw model text.** The server removes every sentence that claims a completed write (`write-outcome.ts`) and rewrites proposal ids before the text exists; “model words” here are the final text minus the server’s own trailing paragraphs, an ESTIMATE labelled as such. Zero-model-call turns (typed-chip approvals, forwarded canvas edits) are exact: every word is the server’s.',
    '- **Grounding.** Whether a figure, driver or sensitivity in the reply is what the analysis actually returned needs the tool RESULTS the model saw; captures carry tool names with ok/mutated/refusal only. No grounding verdict is given.',
    '- **Provenance accuracy.** `user_override` marks both a value the user typed and an Olumi proposal the user adopted, so “your figure” vs “my assumption” is decidable only for `brief_extraction` values (and unattributed `ai_inferred` ones, which these captures barely contain). Everything else is NOT_DECIDABLE. The server’s own `analysis_admission` also counts adopted proposals as user-stated, which a reply cannot be checked against from here.',
    '- **The model’s inputs.** Instructions, history and the claim permissions actually handed to the interpreter are not captured; a leader-honesty FAIL is judged against the post-turn `analysis_state.leader_claim` on the same response, which is the authority the interpreter is given on the fast Run path.',
    '- **What the user saw on screen.** Chips are what the response offered (`suggested_actions`); whether the UI rendered them, and whether the persistent Run control was visible, is not in a capture (Run references with no Run chip are NOT_DECIDABLE).',
    '- **Replayed turns** (`exact_retry_replay`) carry no tool calls of their own, so their action truth is NOT_DECIDABLE.',
    '',
    '## How the checks decide (short form; the code is the definition)',
    '',
    '- Every check returns PASS / FAIL / NOT_DECIDABLE with a reason; a PASS that had nothing to check is marked vacuous and tallied apart.',
    '- **Leader honesty:** only when `leader_claim.permitted === false`; a clause naming an option (draft_graph labels, their short form, or a figure unique to one option) with a ranking cue (leads / ahead / wins / in the lead / % of runs / highest … chance) and no negation, condition or modal BEFORE the cue (“does not lead”, “would only lead if”); one after it (“leads, which could change”) does not un-assert the ranking. Preference words (favours, strongest) count only in a sentence about the model’s result.',
    '- **Action truth:** save claims use the production detector `assertsCompletedWrite` plus a few forms it does not cover; support = a write tool with `mutated: true` (or a forwarded canvas edit with a graph patch). Run claims need a successful `run_analysis` with a result. Proposal/“approve this” claims need an approve chip or a successful proposer. A promise that approval will run the analysis is judged by the NEXT captured approval in that conversation; with none captured it is NOT_DECIDABLE.',
    `- **Control reference:** a quoted/bold known chip label, or click/press/tap + a quoted name, or “… button/chip”. Contrast control: ${input.controlVocabulary.hits} control-vocabulary hits (click, press, tap, button, chip, a chip label, or the word Run) in the prose of ${input.controlVocabulary.turnsWithHits} scored replies, and the self-tests flag a crafted “press **Run analysis**” with no Run chip — so a zero here is not a blind probe.`,
    '- **Option names:** bold or quoted spans that share ≥ 2 content tokens and Jaccard ≥ 0.5 with an option label, but are not that label (inflected leading verb and dropped leading verb allowed). Quantity phrases and other node labels are skipped.',
    '- **Units:** a number bound to a factor/option (nearest number within 40 characters of its label) must carry that value’s unit, and must not be the normalised value.',
    '- **Caveat:** owed when the turn reports an analysis and it is blocked, low/very-low robustness, a near tie, or leader-withheld; satisfied by any caveat cue in the reply.',
    '- **Questions:** the harness’s PQ2 definition — a count of `?` characters. A request phrased without a question mark (“Let me know if…”, “Would you like… .”) is not counted; a `?` inside a quotation is.',
    '',
    '## Known limits of the checks (lexicon-based: a FAIL count is a lower bound, a zero means “none recognised”)',
    '',
    'An adversarial review probe (24 Sep) ran crafted replies through every check. The forms below are still NOT recognised; a reply that uses them passes that check.',
    '',
    '- **Leader honesty:** a ranking with no ranking cue next to an option name — “the analysis points to X”, “the model prefers X”, “X looks better than Y”; a ranking that names no option (“it leads”, “the first option wins”). A role noun beside a cue can false-positive (“the Tech Lead role is ahead of schedule”).',
    '- **Action truth:** a promise to run with no approval context (“I’ll run the comparison now”) is not scored as a claim.',
    '- **Control reference:** an unquoted control name, or one introduced by “select” / “choose” / “use” rather than click / press / tap.',
    '- **Option names:** a rename by synonym (“Hire Two Engineers”, “Two Devs”) — it shares fewer than two content tokens with the label.',
    '- **Caveat:** any caveat cue satisfies it, including a negated one (“there is no uncertainty here”).',
    '',
    '## Reproduce',
    '',
    '```bash',
    input.command,
    '```',
    '',
  ].join('\n');
}
