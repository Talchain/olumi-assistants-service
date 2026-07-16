/**
 * orchestrator-eval — SEAM-1: candidate evaluation (the live-candidate seam,
 * wired).
 *
 * `judge-seam.ts` documented SEAM-1 as: produce the candidate response at run
 * time instead of reading `fixture.candidates[*].text`, then score the
 * produced text with the SAME deterministic scorer — the gate itself does not
 * change, only the source of the text. This module is that seam, made real:
 *
 *   prompt candidate (file | pms:<version> | mock:<label>)
 *     -> request shaped like tools/graph-evaluator adapters/orchestrator.ts
 *        (candidate prompt + <TURN_CONTEXT> + JSON-forcing user message)
 *     -> response produced by the live model (double-opted-in only) or by
 *        offline mock playback of a recorded fixture candidate
 *     -> user-facing `text` extracted from the v30.3 JSON envelope
 *     -> scored by scoreCandidate (the five floor-pack dimensions, unchanged)
 *     -> candidates RANKED on identical scenarios.
 *
 * SCOPE (deliberate, documented): the turn context here is the ASSEMBLED
 * analysis (production formatAnalysisForContext output) + the user message —
 * the same projection stage the floor pack grounds on. The full context-pack
 * -> system-prompt compose stays deferred (README "Deliberately deferred"),
 * and eligible-actions shaping is omitted because the eval fixtures carry
 * none. Rankings are therefore comparable BETWEEN candidates (same shaping
 * for both arms), not absolute predictions of staging behaviour.
 *
 * DETERMINISM: the scorer is fully deterministic. Live model output is not —
 * current Anthropic models reject sampling parameters (temperature etc.), so
 * there is no seed to pin. The report records model id + prompt refs so a run
 * is re-scorable and re-runnable; treat single-run live rankings as one
 * sample, not a proof.
 */

import { assembleAnalysis } from './assemble.js';
import { scoreCandidate } from './scorer.js';
import { enforceTurnCap, resolveLiveGate, type LiveGateInput, type LiveGateResult } from './live-gate.js';
import { resolvePmsPromptText, type CandidatePromptSpec } from './prompt-source.js';
import type { OrchestratorEvalFixture, ScoreResult } from './types.js';

/** The v30.3 JSON-forcing suffix (mirrors tools/graph-evaluator adapters/orchestrator.ts). */
const JSON_FORCING_SUFFIX = '\n\nRespond with valid JSON only.';

/** A model that produces one candidate response. Injected for testability. */
export type CandidateModel = (system: string, user: string) => Promise<CandidateModelResult>;

export interface CandidateModelResult {
  readonly ok: boolean;
  /** Raw model output text. Null on failure. */
  readonly text: string | null;
  /** Error description. Null on success. */
  readonly error: string | null;
}

/** How the scored prose was obtained from the raw model output. */
export type ExtractionMode =
  | 'json_text' // v30.3 envelope parsed; `text` field scored (the contract path)
  | 'raw_unparsed' // JSON parse failed; RAW output scored and flagged
  | 'model_error'; // the model call itself failed; nothing scored

export interface CandidateFixtureResult {
  readonly fixtureId: string;
  readonly extraction: ExtractionMode;
  /** Deterministic floor-pack score. Null only when extraction === 'model_error'. */
  readonly score: ScoreResult | null;
  /** Overall pass (false for model_error — a failed production is a failed turn). */
  readonly pass: boolean;
  readonly error: string | null;
}

export interface CandidateReport {
  readonly label: string;
  readonly ref: string;
  readonly kind: CandidatePromptSpec['kind'];
  readonly results: readonly CandidateFixtureResult[];
  readonly passCount: number;
  readonly failedDimensionCount: number;
}

export interface CandidateEvalReport {
  readonly live: boolean;
  readonly gateReason: string;
  /** Model id used for live production; null in offline/mock mode. */
  readonly model: string | null;
  readonly turnsUsed: number;
  readonly candidates: readonly CandidateReport[];
  /** Labels best-first: passCount desc, failedDimensionCount asc, label asc. */
  readonly ranking: readonly string[];
}

/**
 * Build the request for one fixture, shaped per SEAM-1's documented reuse of
 * the graph-evaluator orchestrator adapter (prompt + <TURN_CONTEXT> + JSON
 * forcing). The turn context carries the ASSEMBLED analysis — the exact
 * display-safe projection the runtime grounds the prompt on.
 */
export function buildCandidateRequest(
  fixture: OrchestratorEvalFixture,
  promptText: string,
): { system: string; user: string } {
  const turnContext = {
    user_message: fixture.user_message,
    analysis: assembleAnalysis(fixture.analysis),
  };
  const system = [
    promptText,
    '',
    '<TURN_CONTEXT>',
    JSON.stringify(turnContext, null, 2),
    '</TURN_CONTEXT>',
  ].join('\n');
  return { system, user: fixture.user_message + JSON_FORCING_SUFFIX };
}

/**
 * Extract the user-facing prose from a raw model output per the v30.3 JSON
 * contract (object with `text` / `insights` / `recommended_actions`; fences
 * tolerated). Falls back to scoring the RAW output — flagged, never silent —
 * when the envelope does not parse.
 */
export function extractAssistantText(raw: string): { text: string; extraction: ExtractionMode } {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).text === 'string'
    ) {
      return { text: (parsed as Record<string, unknown>).text as string, extraction: 'json_text' };
    }
  } catch {
    // fall through to raw
  }
  return { text: raw, extraction: 'raw_unparsed' };
}

/** Wrap a recorded candidate in the v30.3 envelope for mock playback. */
function mockEnvelope(text: string): string {
  return JSON.stringify({ text, insights: [], recommended_actions: [] });
}

/** Produce the raw response for one (candidate, fixture) pair. */
async function produceRawResponse(
  spec: CandidatePromptSpec,
  promptText: string | null,
  fixture: OrchestratorEvalFixture,
  model: CandidateModel | null,
): Promise<CandidateModelResult> {
  if (spec.kind === 'mock') {
    const recorded = fixture.candidates.find((c) => c.label === spec.mockLabel);
    if (!recorded) {
      return {
        ok: false,
        text: null,
        error: `fixture ${fixture.id} has no recorded candidate labelled "${spec.mockLabel}"`,
      };
    }
    return { ok: true, text: mockEnvelope(recorded.text), error: null };
  }

  // file / pms — live production required.
  if (model === null || promptText === null) {
    return {
      ok: false,
      text: null,
      error:
        `candidate "${spec.label}" (${spec.ref}) needs live production but live mode is off — ` +
        'this should have been refused before any turn was planned',
    };
  }
  const { system, user } = buildCandidateRequest(fixture, promptText);
  return model(system, user);
}

export interface RunCandidateEvalOptions {
  readonly specs: readonly CandidatePromptSpec[];
  readonly fixtures: readonly OrchestratorEvalFixture[];
  /** Gate inputs — usually { env: process.env, argv: process.argv }. */
  readonly gateInput: LiveGateInput;
  /** Optional --max-turns; may only LOWER the hard cap. */
  readonly maxTurns?: number;
  /** Model id for live production (required in live mode). */
  readonly modelId?: string;
  /**
   * Live-model factory — injected so tests can exercise the live path without
   * the real SDK. Defaults to the Anthropic/OpenAI factory (dynamic import;
   * never loaded in offline mode).
   */
  readonly createLiveModel?: (modelId: string) => Promise<CandidateModel>;
}

/**
 * The SEAM-1 pipeline. Fail-closed ordering, in this exact sequence:
 *   1. resolve the live gate (double opt-in) — refusal reasons are recorded;
 *   2. refuse file/pms candidates when the gate is off (zero network, loud);
 *   3. enforce the turn cap BEFORE any model call;
 *   4. resolve pms refs / construct the live model (live mode only);
 *   5. produce -> extract -> score -> rank.
 */
export async function runCandidateEval(options: RunCandidateEvalOptions): Promise<CandidateEvalReport> {
  const { specs, fixtures } = options;
  if (specs.length === 0) throw new Error('no --prompt candidates given');
  if (fixtures.length === 0) throw new Error('no fixtures to evaluate against');
  const labels = new Set(specs.map((s) => s.label));
  if (labels.size !== specs.length) throw new Error('candidate labels must be unique');

  const gate: LiveGateResult = resolveLiveGate(options.gateInput);

  const liveSpecs = specs.filter((s) => s.kind !== 'mock');
  if (!gate.live && liveSpecs.length > 0) {
    throw new Error(
      `candidate(s) ${liveSpecs.map((s) => `"${s.label}" (${s.ref})`).join(', ')} require LIVE model production, ` +
        `but live mode is off (${gate.reason}). ` +
        'The offline path only supports mock:<recorded-label> refs. No network call was made.',
    );
  }

  // Cost guard — before ANY call. Mock turns are free but still counted, so a
  // runaway fixture x candidate matrix is caught in both modes.
  const plannedTurns = specs.length * fixtures.length;
  enforceTurnCap(plannedTurns, options.maxTurns);

  // Live-only setup, strictly after the gate + cap checks.
  let model: CandidateModel | null = null;
  const promptTexts = new Map<string, string | null>();
  for (const spec of specs) promptTexts.set(spec.label, spec.promptText);

  if (gate.live && liveSpecs.length > 0) {
    if (!options.modelId) {
      throw new Error(
        'live mode needs an explicit --model (no default on purpose: the eval must run the model the ' +
          'orchestrator actually serves — check CEE_MODEL_ORCHESTRATOR on the target environment)',
      );
    }
    const factory = options.createLiveModel ?? createLiveCandidateModel;
    model = await factory(options.modelId);
    for (const spec of liveSpecs) {
      if (spec.kind === 'pms' && spec.pmsVersion !== null) {
        promptTexts.set(spec.label, await resolvePmsPromptText(spec.pmsVersion));
      }
    }
  }

  let turnsUsed = 0;
  const candidates: CandidateReport[] = [];
  for (const spec of specs) {
    const results: CandidateFixtureResult[] = [];
    for (const fixture of fixtures) {
      turnsUsed += 1;
      const raw = await produceRawResponse(spec, promptTexts.get(spec.label) ?? null, fixture, model);
      if (!raw.ok || raw.text === null) {
        results.push({
          fixtureId: fixture.id,
          extraction: 'model_error',
          score: null,
          pass: false,
          error: raw.error ?? 'model returned no text',
        });
        continue;
      }
      const { text, extraction } = extractAssistantText(raw.text);
      const score = scoreCandidate(fixture.analysis, {
        label: spec.label,
        note: `SEAM-1 ${spec.kind} candidate (${spec.ref})`,
        source: spec.kind === 'mock' ? 'recorded' : 'live',
        text,
      });
      results.push({ fixtureId: fixture.id, extraction, score, pass: score.pass, error: null });
    }
    const passCount = results.filter((r) => r.pass).length;
    const failedDimensionCount = results.reduce(
      (n, r) => n + (r.score ? r.score.dimensions.filter((d) => !d.pass).length : 0),
      0,
    );
    candidates.push({ label: spec.label, ref: spec.ref, kind: spec.kind, results, passCount, failedDimensionCount });
  }

  const ranking = [...candidates]
    .sort(
      (a, b) =>
        b.passCount - a.passCount ||
        a.failedDimensionCount - b.failedDimensionCount ||
        a.label.localeCompare(b.label),
    )
    .map((c) => c.label);

  return {
    live: gate.live,
    gateReason: gate.reason,
    model: gate.live && liveSpecs.length > 0 ? (options.modelId ?? null) : null,
    turnsUsed,
    candidates,
    ranking,
  };
}

/**
 * Default live-model factory. Reuses the graph-evaluator providers (per the
 * SEAM-1 note in judge-seam.ts) via DYNAMIC import so the SDKs are never
 * loaded on the offline path. Only ever constructed after the double opt-in
 * gate has passed.
 */
export async function createLiveCandidateModel(modelId: string): Promise<CandidateModel> {
  const providers = await import('../../graph-evaluator/src/providers/index.js');
  const config = {
    id: `orchestrator-eval-candidate:${modelId}`,
    provider: (/claude/i.test(modelId) ? 'anthropic' : 'openai') as 'anthropic' | 'openai',
    model: modelId,
  };
  const provider = providers.getProvider(config);
  return async (system, user) => {
    const result = await provider.chat(system, user, config);
    return { ok: result.ok, text: result.text, error: result.error };
  };
}
