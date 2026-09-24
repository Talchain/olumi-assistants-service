/**
 * Read construction-witness captures (`<label>-turns.jsonl`, one line per turn:
 * {sc, turn, at, http, request_id, json, text}) and derive each turn's
 * conversation context from the turns AROUND it in the same scenario.
 *
 * Only the capture label, scenario letter, turn label and the response payload
 * are used. `request_id`, `at` and every id inside the payload are ignored.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { domainFromScenario, userActionFromLabel, type RerunKind, type UserAction } from './classify.js';
import { scoreView, type ScoreContext, type TurnScore } from './score.js';
import { ranAnalysisThisTurn, viewOf, type ReplyView } from './wire.js';

export interface CapturedLine {
  readonly sc: string;
  readonly turn: string;
  readonly http: number | null;
  readonly json: unknown;
}

export interface Capture {
  readonly label: string;
  readonly build: string;
  /** From `<label>-summary.json`: the served build did not change during the run. */
  readonly sameBuild: boolean | null;
  readonly lines: readonly CapturedLine[];
}

export function readCapture(path: string): Capture {
  const label = basename(path).replace(/-turns\.jsonl$/, '');
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .map((d) => ({ sc: String(d.sc ?? ''), turn: String(d.turn ?? ''), http: typeof d.http === 'number' ? d.http : null, json: d.json ?? null }));
  const summaryPath = join(dirname(path), `${label}-summary.json`);
  let build = label.split('-').pop() ?? 'unknown';
  let sameBuild: boolean | null = null;
  if (existsSync(summaryPath)) {
    const s = JSON.parse(readFileSync(summaryPath, 'utf8')) as { build?: unknown; same_build?: unknown };
    if (typeof s.build === 'string' && s.build !== '') build = s.build;
    if (typeof s.same_build === 'boolean') sameBuild = s.same_build;
  }
  return { label, build, sameBuild, lines };
}

interface Seq {
  readonly line: CapturedLine;
  readonly view: ReplyView;
  readonly action: UserAction;
  readonly index: number;
}

/** Did the model change since the previous run in this conversation? Graph hash first, turn sequence second. */
function rerunKindOf(seq: readonly Seq[], i: number): RerunKind | null {
  let j = i - 1;
  while (j >= 0 && !ranAnalysisThisTurn(seq[j]!.view) && seq[j]!.action !== 'run' && seq[j]!.action !== 'rerun') j -= 1;
  if (j < 0) return null;
  const now = seq[i]!.view.graphHash;
  const then = seq[j]!.view.graphHash;
  if (now !== null && then !== null) return now === then ? 'no_change' : 'after_edit';
  return seq.slice(j + 1, i).some((s) => s.action === 'edit' || s.view.toolCalls.some((t) => t.mutated === true)) ? 'after_edit' : 'no_change';
}

/** The next approval in this conversation: did it run the analysis? null when none was captured. */
function nextApprovalRanOf(seq: readonly Seq[], i: number): boolean | null {
  const next = seq.slice(i + 1).find((s) => s.action === 'approve_chip' || s.action === 'approve_typed');
  return next === undefined ? null : ranAnalysisThisTurn(next.view);
}

export function scoreCapture(capture: Capture): TurnScore[] {
  const byScenario = new Map<string, Seq[]>();
  capture.lines.forEach((line, index) => {
    const seq = byScenario.get(line.sc) ?? [];
    seq.push({ line, view: viewOf(line.json, line.http), action: userActionFromLabel(line.turn), index });
    byScenario.set(line.sc, seq);
  });
  const out: TurnScore[] = [];
  for (const [sc, seq] of byScenario) {
    seq.forEach((s, i) => {
      const ctx: ScoreContext = {
        userAction: s.action,
        domain: domainFromScenario(sc),
        rerunKind: s.action === 'rerun' ? rerunKindOf(seq, i) : null,
        nextApprovalRan: nextApprovalRanOf(seq, i),
      };
      out.push(scoreView(s.view, { capture: capture.label, build: capture.build, scenario: sc, turn: s.line.turn, index: s.index }, ctx));
    });
  }
  return out.sort((a, b) => a.key.index - b.key.index);
}
