/**
 * ⭐ RECOVERY BATCH E (DL ruling, 12 Oct; ruling A and Paul's #87: a win share is never the headline; score run 4 C3 FAIL):
 * NO CEE TEXT A RUN EMITS STATES AN OPTION'S SHARE OF RUNS. The share of runs in which an option came out on top
 * (`win_probability`) is not the chance of meeting the goal, and CEE wrote it in many places: the lead ladder
 * ("… gave the highest weekly support capacity in 88% of runs of this model …"), its "(each supported by under 1% of runs)"
 * tail, the objective-contradiction arms, the explanation fallback, the close-call sentence, coaching cards and lenses,
 * the decision review's crowning sentence, and the Agent's own prose.
 *
 * One rule, applied LAST on each exit (the V5 route's wire body, the Agent's final and replay egress) and at the one
 * `analysis_result` builder: every sentence that states a share of runs is removed. No word is added. The per-option goal chance and its licence words never match, so they stay
 * untouched. The structured `win_probability` fields are data, not text, and are not edited here.
 *
 * The census pattern is the DL's, verbatim (`RUN_SHARE_CENSUS`); removal also covers the plural and ranking forms CEE
 * writes that it does not spell out ("the most runs", "scored highest", "came out lowest").
 */
import { summaryWithoutLeadSentence } from '../coaching/analysis-result-headline.js';
import { log } from '../../utils/telemetry.js';

/** The DL's census, verbatim (12 Oct): no CEE text a Run emits may match it. */
export const RUN_SHARE_CENSUS = /\d+% of runs|supported by .* runs|more runs than|gave the highest|gave the lowest|out on top/i;
const RUN_SHARE_SENTENCE = new RegExp([
  RUN_SHARE_CENSUS.source,
  String.raw`\bmost runs\b`, String.raw`\bmore of the runs\b`, String.raw`\bmore runs\b`, String.raw`\bnext most runs\b`,
  String.raw`\bscor(?:ed|es) highest\b`, String.raw`\bcame out (?:ahead|lowest|highest|top)\b`, String.raw`\bcomes? out ahead\b`,
].join('|'), 'i');

/** Members never edited: the user's model bytes, the Agent's sidecar, diagnostics and identities. */
const SKIPPED_KEYS: ReadonlySet<string> = new Set(['draft_graph', 'graph', '_agent', '_diagnostic_trace', '_provider_calls', 'id', 'type',
  'option_id', 'leading_option_id', 'computed_against_hash', 'graph_hash', 'scenario_id', 'turn_id']);
const MAX_DEPTH = 40;

/** `text` without any sentence that states a share of runs; the lead ladder's sentence is read by its own grammar first. */
export function withoutRunShareSentences(text: string): string {
  if (typeof text !== 'string' || text === '') return text;
  const led = summaryWithoutLeadSentence(text);
  if (!RUN_SHARE_SENTENCE.test(led)) return led;
  const lines = led.split('\n').map((line) => {
    if (!RUN_SHARE_SENTENCE.test(line)) return line;
    const bullet = /^(\s*(?:[•\-*]|\d+\.)\s+)/.exec(line)?.[1] ?? '';
    const kept = line.slice(bullet.length).split(/(?<=[.!?…])\s+/).filter((s) => !RUN_SHARE_SENTENCE.test(s)).join(' ').trim();
    return kept === '' ? null : `${bullet}${kept}`;
  });
  return lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** True when `text` states a share of runs (the removal rule, wider than the census). */
export function statesRunShare(text: unknown): boolean {
  return typeof text === 'string' && RUN_SHARE_SENTENCE.test(text);
}

function edit(value: unknown, path: string, depth: number, changed: string[]): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') {
    if (!statesRunShare(value)) return value;
    changed.push(path);
    return withoutRunShareSentences(value);
  }
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    value.forEach((item, i) => {
      const next = edit(item, `${path}[${i}]`, depth + 1, changed);
      if (next !== item) { out ??= [...value]; out[i] = next; }
    });
    return out ?? value;
  }
  if (value !== null && typeof value === 'object') {
    let out: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SKIPPED_KEYS.has(k)) continue;
      const next = edit(v, `${path}.${k}`, depth + 1, changed);
      if (next !== v) { out ??= { ...(value as Record<string, unknown>) }; out[k] = next; }
    }
    return out ?? value;
  }
  return value;
}

/**
 * The wire body without any share-of-runs sentence, by reference when there is none. A chip whose label is left empty is
 * dropped. Logs the edited paths, never prose.
 */
export function withoutRunShareTextAtEgress<T extends object>(body: T, opts: { readonly requestId?: string; readonly exitPath: string }): T {
  const changed: string[] = [];
  const out = edit(body, '$', 0, changed);
  if (out === body) return body;
  const next: Record<string, unknown> = { ...(out as Record<string, unknown>) };
  if (Array.isArray(next.suggested_actions)) {
    next.suggested_actions = (next.suggested_actions as unknown[]).filter((c) =>
      !(c !== null && typeof c === 'object' && typeof (c as { label?: unknown }).label === 'string' && (c as { label: string }).label.trim() === ''));
  }
  log.info({ event: 'cee.run_share_text.removed', request_id: opts.requestId, exit_path: opts.exitPath, paths: changed.slice(0, 40), count: changed.length },
    'egress: a sentence stating a share of runs was removed');
  return next as T;
}
