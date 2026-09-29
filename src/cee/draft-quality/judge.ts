/**
 * THE SEMANTIC-COVERAGE JUDGE.
 *
 * ONE LLM call that reads the BRIEF and the DRAFTED MODEL and answers a single
 * question: does the model capture the materially important causal dimensions
 * the brief actually states?
 *
 * ## Three properties, all load-bearing
 *
 * 1. **REJECT-ONLY.** The output type (`DraftQualityVerdict`) has no field
 *    through which content could arrive. The judge may say "this does not cover
 *    the brief" with CODED grounds; it may not say what is missing, and it
 *    cannot propose a node, an edge or a label. An enriching pass invents
 *    causal authority the user never asserted, and this estate has already
 *    refused one such patch. The prompt says so too, but the TYPE is what
 *    makes it structural — a future prompt edit cannot open the channel.
 *
 * 2. **FAIL OPEN, LOUDLY.** Every timeout, transport error, unparseable body,
 *    unconfigured model and unprovisioned prompt returns
 *    `{ kind: 'unavailable', reason }`, and the caller ships the draft
 *    unchanged. This function never throws. The reason is CODED and always
 *    emitted: a fail-open that is silent converts a measurable problem into an
 *    unmeasurable one, which is worse than the defect.
 *
 * 3. **BOUNDED.** A headroom gate refuses to start when the remaining request
 *    budget cannot absorb the call — the same primitive the coaching pass and
 *    the draft retry gate use (`remainingRequestBudgetMs`), never a re-derived
 *    copy of that arithmetic (the 2026-07-20 staging outage).
 *
 * ## Model choice, and why it is cross-provider
 *
 * `draft_quality_review` defaults to an OpenAI model while `draft_graph` is
 * Anthropic. That follows the `validate_graph` precedent (ROADMAP 2.146)
 * verbatim and for the same reason: a judge drawn from the drafter's own family
 * is a weaker independent check, and leaving the judge's identity to fall
 * through to the global provider makes independence an accident of deployment
 * env. It is a fast, non-reasoning model on purpose — `validate_graph`'s
 * o4-mini takes 10-28s, which the pipeline hides behind the coaching pass; this
 * call cannot be hidden, because a redraw decision depends on it.
 */

import { getSystemPrompt } from '../../adapters/llm/prompt-loader.js';
import { getAdapterWithResolution } from '../../adapters/llm/router.js';
import { config } from '../../config/index.js';
import { DRAFT_QUALITY_TIMEOUT_MS, remainingRequestBudgetMs } from '../../config/timeouts.js';
import { log } from '../../utils/telemetry.js';
import { readGraph } from './coverage.js';
import {
  IMPOVERISHMENT_GROUNDS,
  type DraftQualityVerdict,
  type ImpoverishmentGround,
} from './types.js';

/** Default output ceiling. The verdict is a handful of tokens; this is a guard
 *  against a runaway, not a working budget. */
const DEFAULT_JUDGE_MAX_TOKENS = 512;

/** Reserved for the redraw decision + telemetry after the call returns. */
const POST_JUDGE_HEADROOM_MS = 1_000;

/** What the judge is handed. Never the whole pipeline body — only the brief and
 *  a compact projection of the model. */
export interface JudgeInput {
  readonly graph: unknown;
  readonly brief: string;
  readonly requestId: string;
  /** Milliseconds spent on this REQUEST so far (from request entry, not draft
   *  start) — the same baseline the retry gate uses. */
  readonly elapsedMs: number;
}

export interface JudgeCallResult {
  readonly verdict: DraftQualityVerdict;
  readonly latencyMs: number;
  readonly tokens: { readonly in: number; readonly out: number } | null;
  readonly model: string | null;
}

/**
 * Compact, label-bearing projection of the model for the judge.
 *
 * ⚠ THIS CARRIES USER-DERIVED LABELS, DELIBERATELY, and that is safe HERE and
 * would not be safe in the retry directive. The difference is where the text
 * lands: this projection goes in the USER MESSAGE, inside the adapter's
 * untrusted-content markers, exactly like the brief itself. The retry directive
 * lands in the SYSTEM-AUTHORITY region and therefore carries codes and counts
 * only (see `directive.ts`). Conflating the two is how a prompt-injection
 * carrier gets opened by a well-meaning refactor.
 */
function serialiseGraphForJudging(graph: unknown): string | null {
  const read = readGraph(graph);
  if (read === null) return null;
  const labelById = new Map<string, string>();
  const raw = graph as Record<string, unknown>;
  const nodeSource = Array.isArray(raw.nodes)
    ? raw.nodes
    : Array.isArray((raw.graph as Record<string, unknown> | undefined)?.nodes)
      ? ((raw.graph as Record<string, unknown>).nodes as unknown[])
      : [];
  for (const n of nodeSource) {
    if (!n || typeof n !== 'object') continue;
    const rec = n as Record<string, unknown>;
    if (typeof rec.id === 'string' && typeof rec.label === 'string') {
      labelById.set(rec.id, rec.label);
    }
  }
  const lines: string[] = ['NODES:'];
  for (const node of read.nodes) {
    lines.push(`  ${node.id} [${node.kind}] ${labelById.get(node.id) ?? ''}`.trimEnd());
  }
  lines.push('EDGES:');
  for (const edge of read.edges) {
    lines.push(`  ${edge.from} -> ${edge.to}`);
  }
  return lines.join('\n');
}

function isTimeoutShaped(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
    return /timed?\s*out/i.test(err.message);
  }
  return false;
}

/**
 * Parse the judge's output into a verdict.
 *
 * Strict by construction and unforgiving on purpose: anything that is not an
 * exact, recognised shape becomes `parse_failed`, which fails OPEN. The
 * asymmetry matters — a garbled output must never be readable as
 * "impoverished", because that would spend a redraw on noise.
 *
 * ⭐ Note what is NOT accepted: any key other than `verdict` and `grounds` is
 * ignored, and `grounds` members outside the fixed enum are dropped. There is
 * no path by which model-authored free text reaches the caller.
 */
export function parseJudgeOutput(content: string): DraftQualityVerdict {
  let parsed: unknown;
  try {
    // Tolerate a fenced block; refuse anything else.
    const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(stripped);
  } catch {
    return { kind: 'unavailable', reason: 'parse_failed' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'unavailable', reason: 'parse_failed' };
  }
  const rec = parsed as Record<string, unknown>;
  const verdict = rec.verdict;
  if (verdict === 'adequate') return { kind: 'adequate' };
  if (verdict !== 'impoverished') return { kind: 'unavailable', reason: 'parse_failed' };

  const rawGrounds = Array.isArray(rec.grounds) ? rec.grounds : [];
  const grounds: ImpoverishmentGround[] = [];
  for (const g of rawGrounds) {
    if (typeof g !== 'string') continue;
    if (!(IMPOVERISHMENT_GROUNDS as readonly string[]).includes(g)) continue;
    if (!grounds.includes(g as ImpoverishmentGround)) grounds.push(g as ImpoverishmentGround);
  }
  // An "impoverished" verdict with no recognised ground is not actionable and
  // is not a reason to spend a redraw. Fail open rather than guess.
  if (grounds.length === 0) return { kind: 'unavailable', reason: 'parse_failed' };
  return { kind: 'impoverished', grounds };
}

/**
 * Ask the judge. Never throws.
 */
export async function judgeDraftCoverage(input: JudgeInput): Promise<JudgeCallResult> {
  const unavailable = (reason: Parameters<typeof buildUnavailable>[0]): JudgeCallResult =>
    buildUnavailable(reason);

  if (typeof input.brief !== 'string' || input.brief.trim().length === 0) {
    return unavailable('brief_unavailable');
  }

  const serialised = serialiseGraphForJudging(input.graph);
  if (serialised === null) return unavailable('graph_unreadable');

  // Headroom gate — same primitive as the coaching-pass and retry gates.
  if (remainingRequestBudgetMs(input.elapsedMs) < DRAFT_QUALITY_TIMEOUT_MS + POST_JUDGE_HEADROOM_MS) {
    return unavailable('insufficient_headroom');
  }

  let system: string;
  try {
    system = await getSystemPrompt('draft_quality_review');
  } catch {
    return unavailable('prompt_unavailable');
  }
  if (typeof system !== 'string' || system.trim().length === 0) {
    return unavailable('prompt_unavailable');
  }

  let adapter;
  let resolvedModel: string | null = null;
  try {
    const resolution = getAdapterWithResolution('draft_quality_review');
    adapter = resolution.adapter;
    resolvedModel = resolution.resolution.resolved_model;
  } catch (err) {
    log.warn(
      { request_id: input.requestId, err: err instanceof Error ? err.message : String(err) },
      'draft-quality judge: model resolution failed — draft ships unjudged',
    );
    return unavailable('model_not_resolved');
  }

  const userMessage = [
    'DECISION BRIEF:',
    input.brief,
    '',
    'DRAFTED MODEL:',
    serialised,
  ].join('\n');

  const startedAt = Date.now();
  try {
    const result = await adapter.chat(
      {
        system,
        userMessage,
        temperature: 0,
        maxTokens: config.cee.maxTokens.draft_quality ?? DEFAULT_JUDGE_MAX_TOKENS,
        // Deliberately no `outputSchema`: only the Anthropic adapter implements
        // it, and pinning this call to that provider would defeat the
        // cross-provider independence the model default exists for. The parser
        // is strict and every failure fails OPEN, so a loose transport is safe
        // here in a way it would not be on a mutating path.
      },
      { requestId: input.requestId, timeoutMs: DRAFT_QUALITY_TIMEOUT_MS },
    );
    const latencyMs = Date.now() - startedAt;
    const verdict = parseJudgeOutput(result.content ?? '');
    return {
      verdict,
      latencyMs,
      tokens: readTokens(result),
      model: result.model ?? resolvedModel,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const reason = isTimeoutShaped(err) ? 'timeout' : 'llm_error';
    log.warn(
      {
        request_id: input.requestId,
        reason,
        latency_ms: latencyMs,
        err: err instanceof Error ? err.message : String(err),
      },
      'draft-quality judge unavailable — draft ships unjudged (fail open)',
    );
    return { verdict: { kind: 'unavailable', reason }, latencyMs, tokens: null, model: resolvedModel };
  }
}

function buildUnavailable(
  reason: Extract<DraftQualityVerdict, { kind: 'unavailable' }>['reason'],
): JudgeCallResult {
  return { verdict: { kind: 'unavailable', reason }, latencyMs: 0, tokens: null, model: null };
}

/** Adapter usage shapes differ by provider; read defensively and report null
 *  rather than a fabricated zero. A zero would be indistinguishable from "the
 *  call was free", which is the kind of quiet lie the cost report exists to
 *  avoid. */
function readTokens(result: unknown): { in: number; out: number } | null {
  if (!result || typeof result !== 'object') return null;
  const usage = (result as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const input = typeof u.inputTokens === 'number' ? u.inputTokens
    : typeof u.input_tokens === 'number' ? u.input_tokens
    : typeof u.promptTokens === 'number' ? u.promptTokens
    : null;
  const output = typeof u.outputTokens === 'number' ? u.outputTokens
    : typeof u.output_tokens === 'number' ? u.output_tokens
    : typeof u.completionTokens === 'number' ? u.completionTokens
    : null;
  if (input === null || output === null) return null;
  return { in: input, out: output };
}
