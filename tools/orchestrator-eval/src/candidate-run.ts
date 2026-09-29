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
 *     -> scored by scoreCandidate (the floor-pack dimensions, including
 *        substance) + the extraction contract (a flagged raw_unparsed turn is
 *        a FAILED turn — see applyExtractionContract)
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

import { createHash } from 'node:crypto';
import { assembleAnalysis } from './assemble.js';
import { scoreCandidate } from './scorer.js';
import { enforceTurnCap, resolveLiveGate, type LiveGateInput, type LiveGateResult } from './live-gate.js';
import { resolvePmsPromptText, type CandidatePromptSpec } from './prompt-source.js';
import type { EvalTaskKey } from './tasks.js';
import type { EvalTaskAdapter, ExtractionMode, ScoredOutput } from './task-adapter.js';
import { loadFixtures } from './run.js';
import { finaliseScore, type DimensionResult, type OrchestratorEvalFixture, type ScoreResult } from './types.js';
import { resolveModelAssignment } from '../../../src/config/model-assignment.js';

/** sha256, first 16 hex chars — the same shape `Prompts/canonical/manifest.json` records. */
function sha16(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
}

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

/**
 * How the scored surface was obtained from the raw model output.
 *
 * Re-exported from `task-adapter.ts` (where it now lives, because it is a
 * task-agnostic pipeline concept) so every pre-existing importer of
 * `candidate-run.js` keeps working unchanged.
 */
export type { ExtractionMode } from './task-adapter.js';

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
  /**
   * SELF-WITNESS: sha256 (first 16 hex) of the prompt text this arm actually
   * SENT. Null for `mock:` arms, which send no prompt.
   *
   * Recorded because attribution-by-pointer is not attribution. The first
   * baseline stated "the served v14 prompt" on the strength of a manifest
   * pointer read days before the captures — and a pointer is exactly what trap
   * 12c is about: `stagingVersion` read 120 while turns were still being served
   * 119. For a direct-model run the prompt is supplied by this tool, so hashing
   * what was sent is a genuine per-run witness rather than a second pointer,
   * and a report can be tied to prompt BYTES instead of a version number.
   */
  readonly promptSha16: string | null;
  readonly results: readonly CandidateFixtureResult[];
  readonly passCount: number;
  /**
   * Turns that produced NO substance: the scored `substance_present`
   * dimension failed (empty/whitespace text, or fail-closed on raw_unparsed),
   * plus — fail-closed — every `model_error` turn (no score exists, so
   * nothing proves substance was present; a turn that produced nothing is an
   * EMPTY turn, not an unscored one — without this, an arm whose every call
   * failed would carry zero failed dimensions and rank as the cleanest
   * candidate in the run).
   */
  readonly substanceFailedTurnCount: number;
  /** Turns whose raw output did not parse as the v30.3 envelope (raw_unparsed). */
  readonly flaggedTurnCount: number;
  readonly failedDimensionCount: number;
}

export interface CandidateEvalReport {
  /** Which prompt task this run evaluated (`routing` unless --task said otherwise). */
  readonly task: EvalTaskKey;
  readonly live: boolean;
  readonly gateReason: string;
  /** Model id used for live production; null in offline/mock mode. */
  readonly model: string | null;
  readonly turnsUsed: number;
  readonly candidates: readonly CandidateReport[];
  /**
   * Labels best-first: passCount desc, substanceFailedTurnCount asc,
   * flaggedTurnCount asc, failedDimensionCount asc, label asc.
   *
   * substanceFailedTurnCount sorts immediately AFTER passCount: among arms
   * passing equally many turns, one that answered EMPTY (or errored) on more
   * turns can never out-rank one that answered with flawed substance — an
   * empty answer fails ONE dimension where a flawed answer may fail several,
   * so without this key failedDimensionCount would reward emptiness all over
   * again, one key lower than the defect the substance dimension killed. It
   * deliberately does NOT sort above passCount: substance failure already
   * forces the turn to fail (it is priced into passCount), and an arm that
   * actually passes turns must not lose to one that never does.
   *
   * flaggedTurnCount sorts BEFORE failedDimensionCount so a candidate flagged
   * raw_unparsed can never break a tie past an unflagged one — the direction
   * invariant: a flagged turn never ranks above an unflagged honest one.
   */
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
 * when the envelope does not parse. The flag is SCORED downstream
 * (applyExtractionContract): a raw_unparsed turn fails the
 * extraction_contract dimension and its substance is counted as empty.
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

/**
 * Score the extraction FLAG itself — a flagged turn is a FAILED turn, never
 * merely an annotated one.
 *
 * Why a scored dimension rather than a hard non-zero CLI exit on any flagged
 * turn (both satisfy the direction invariant): a hard exit throws away the
 * rest of the run's ranking signal the moment one arm misbehaves — live turns
 * already paid for — and a red that fires on every exploratory run trains
 * operators to ignore it (the broken-alarm class). A scored dimension keeps
 * the report complete AND makes the flag count against the candidate where
 * the ranking actually looks: the turn can never PASS, and `flaggedTurnCount`
 * is a ranking key ahead of failedDimensionCount, so a flagged arm can never
 * tie past an unflagged one. The invariant — a flagged turn never ranks above
 * an unflagged honest one — is structural, not advisory.
 *
 * Fail-closed substance: when the envelope did not parse there is no
 * extracted user-facing text, so the turn counts as EMPTY —
 * `substance_present` is forced to FAIL rather than letting raw non-JSON
 * prose stand in for extractable substance.
 */
export function applyExtractionContract(score: ScoreResult, extraction: ExtractionMode): ScoreResult {
  const extracted = extraction === 'json_text';
  const dimensions: DimensionResult[] = score.dimensions.map((d) =>
    !extracted && d.name === 'substance_present'
      ? {
          ...d,
          pass: false,
          status: 'fail' as const,
          detail: 'fail-closed: envelope did not parse, so no user-facing text was extractable — counts as empty',
        }
      : d,
  );
  dimensions.push({
    name: 'extraction_contract',
    pass: extracted,
    status: extracted ? 'pass' : 'fail',
    source: 'eval-assertion',
    detail: extracted
      ? 'v30.3 envelope parsed; `text` field scored'
      : 'raw output did not parse as the v30.3 envelope — a flagged turn is a failed turn',
  });
  // Re-finalised (not spread) so `measured` / `notApplicable` / `passed` are
  // recomputed over the amended dimension list. Spreading the old counts would
  // leave the denominator one short of the dimensions actually present.
  return finaliseScore(score.candidate, dimensions);
}

/**
 * The `routing` task adapter — the chassis's original, now-explicit behaviour.
 *
 * Every method here is the exact code the pipeline used to call inline, moved
 * behind the adapter seam with NO change of behaviour: the request builder is
 * `buildCandidateRequest`, the envelope is the v30.3 one, extraction is
 * `extractAssistantText`, and scoring is `scoreCandidate` + the extraction
 * contract. `pnpm eval:orchestrator:test` is the proof that the move is inert.
 */
export const ROUTING_ADAPTER: EvalTaskAdapter<OrchestratorEvalFixture> = {
  task: 'routing',
  fixtureId: (fixture) => fixture.id,
  loadFixtures: (dir) => loadFixtures(dir),
  buildRequest: (fixture, promptText) => buildCandidateRequest(fixture, promptText),
  mockRaw: (fixture, mockLabel) => {
    const recorded = fixture.candidates.find((c) => c.label === mockLabel);
    return recorded ? mockEnvelope(recorded.text) : null;
  },
  scoreRaw: (fixture, raw, candidateLabel): ScoredOutput => {
    const { text, extraction } = extractAssistantText(raw);
    const score = applyExtractionContract(
      scoreCandidate(fixture.analysis, {
        label: candidateLabel,
        note: 'SEAM-1 candidate',
        source: 'live',
        text,
      }),
      extraction,
    );
    return { extraction, score };
  },
};

/**
 * Resolve the adapter for a run, defaulting to `routing`.
 *
 * The generic parameter `F` defaults to `OrchestratorEvalFixture`, so the ONLY
 * instantiation that can reach the `??` right-hand side is the defaulted one —
 * `F` is then exactly `OrchestratorEvalFixture` and `ROUTING_ADAPTER` is
 * already the right type. TypeScript cannot express "this branch is only
 * reachable at the default instantiation", hence the localised assertion,
 * confined to this one function rather than smeared through the pipeline.
 *
 * A caller supplying a NON-default `F` must supply its adapter — the pipeline
 * has no way to invent one, and silently falling back to routing would score a
 * decision_review fixture with the routing prose dimensions and report a
 * number. That is exactly the kind of quiet mis-scoring this pack exists to
 * catch, so it is pinned by a named test rather than left to review.
 */
function resolveAdapter<F>(adapter: EvalTaskAdapter<F> | undefined): EvalTaskAdapter<F> {
  return adapter ?? (ROUTING_ADAPTER as EvalTaskAdapter<F>);
}

/** Produce the raw response for one (candidate, fixture) pair. */
async function produceRawResponse<F>(
  spec: CandidatePromptSpec,
  promptText: string | null,
  fixture: F,
  adapter: EvalTaskAdapter<F>,
  model: CandidateModel | null,
): Promise<CandidateModelResult> {
  if (spec.kind === 'mock') {
    const raw = adapter.mockRaw(fixture, spec.mockLabel ?? '');
    if (raw === null) {
      return {
        ok: false,
        text: null,
        error: `fixture ${adapter.fixtureId(fixture)} has no recorded candidate labelled "${spec.mockLabel}"`,
      };
    }
    return { ok: true, text: raw, error: null };
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
  const { system, user } = adapter.buildRequest(fixture, promptText);
  return model(system, user);
}

/** Fixture-level parallelism within one candidate spec. Bounded so a large
 * fixture set cannot burst-open unbounded live-model connections; specs stay
 * sequential so arms never contend with each other for the provider. */
const FIXTURE_CONCURRENCY = 4;

/**
 * Map `items` through `fn` with at most `limit` calls in flight, returning
 * results in ITEM ORDER (each result is written to its item's own slot, so
 * completion order can never reorder the output). A rejection from `fn`
 * propagates — same behaviour as the sequential `await` loop this replaces.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  );
  return out;
}

export interface RunCandidateEvalOptions<F = OrchestratorEvalFixture> {
  readonly specs: readonly CandidatePromptSpec[];
  readonly fixtures: readonly F[];
  /**
   * Task adapter — the ONLY task-specific part of the pipeline. Defaults to
   * `ROUTING_ADAPTER`, so every pre-existing call site is unchanged.
   */
  readonly adapter?: EvalTaskAdapter<F>;
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
export async function runCandidateEval<F = OrchestratorEvalFixture>(
  options: RunCandidateEvalOptions<F>,
): Promise<CandidateEvalReport> {
  const { specs, fixtures } = options;
  const adapter = resolveAdapter(options.adapter);
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
        // Resolve against THIS RUN'S task, not a hard-wired 'routing'.
        promptTexts.set(spec.label, await resolvePmsPromptText(spec.pmsVersion, adapter.task));
      }
    }
  }

  let turnsUsed = 0;
  const candidates: CandidateReport[] = [];
  for (const spec of specs) {
    // Fixtures run CONCURRENTLY within a spec (bounded — see
    // FIXTURE_CONCURRENCY); mapWithConcurrency assembles results in fixture
    // order regardless of completion order, so reports and ranking inputs are
    // byte-identical to the sequential loop this replaces.
    const results: CandidateFixtureResult[] = await mapWithConcurrency(
      fixtures,
      FIXTURE_CONCURRENCY,
      async (fixture): Promise<CandidateFixtureResult> => {
        turnsUsed += 1;
        const raw = await produceRawResponse(
          spec,
          promptTexts.get(spec.label) ?? null,
          fixture,
          adapter,
          model,
        );
        if (!raw.ok || raw.text === null) {
          return {
            fixtureId: adapter.fixtureId(fixture),
            extraction: 'model_error',
            score: null,
            pass: false,
            error: raw.error ?? 'model returned no text',
          };
        }
        const { extraction, score } = adapter.scoreRaw(fixture, raw.text, spec.label);
        return { fixtureId: adapter.fixtureId(fixture), extraction, score, pass: score.pass, error: null };
      },
    );
    const passCount = results.filter((r) => r.pass).length;
    // Fail-closed: a model_error turn (score === null) produced nothing, so
    // it counts as substance-failed — see CandidateReport for the why.
    const substanceFailedTurnCount = results.filter(
      (r) =>
        r.score === null ||
        r.score.dimensions.some((d) => d.name === 'substance_present' && !d.pass),
    ).length;
    const flaggedTurnCount = results.filter((r) => r.extraction === 'raw_unparsed').length;
    const failedDimensionCount = results.reduce(
      (n, r) => n + (r.score ? r.score.dimensions.filter((d) => !d.pass).length : 0),
      0,
    );
    const sentPrompt = promptTexts.get(spec.label) ?? null;
    candidates.push({
      label: spec.label,
      ref: spec.ref,
      kind: spec.kind,
      promptSha16: sentPrompt === null ? null : sha16(sentPrompt),
      results,
      passCount,
      substanceFailedTurnCount,
      flaggedTurnCount,
      failedDimensionCount,
    });
  }

  // Ranking keys, in order (see CandidateEvalReport.ranking for the why):
  // substanceFailedTurnCount sits directly after passCount so emptiness can
  // never win a tie via fewer failed dimensions; flaggedTurnCount sits ahead
  // of failedDimensionCount so a flagged arm can never break a tie past an
  // unflagged one. Every key is pinned by __tests__/candidate-ranking.test.ts
  // — deleting or reordering any of them turns a named test RED.
  const ranking = [...candidates]
    .sort(
      (a, b) =>
        b.passCount - a.passCount ||
        a.substanceFailedTurnCount - b.substanceFailedTurnCount ||
        a.flaggedTurnCount - b.flaggedTurnCount ||
        a.failedDimensionCount - b.failedDimensionCount ||
        a.label.localeCompare(b.label),
    )
    .map((c) => c.label);

  return {
    task: adapter.task,
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
  const assignment = resolveModelAssignment(modelId);
  if (assignment.provider === 'fixtures') {
    throw new Error('Live candidate evaluation cannot use the fixtures provider.');
  }
  const config = {
    id: `orchestrator-eval-candidate:${modelId}`,
    provider: assignment.provider,
    model: assignment.model,
  };
  const provider = providers.getProvider(config);
  return async (system, user) => {
    const result = await provider.chat(system, user, config);
    return { ok: result.ok, text: result.text, error: result.error };
  };
}
