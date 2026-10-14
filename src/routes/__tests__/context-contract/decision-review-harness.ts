// Match the server's existing Fastify augmentation without installing any hook.
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
/** REAL enrichRunAnalysisWithDecisionReview -> invokeDecisionReview -> production OpenAI SDK -> fetch.
 * No function/adapter doubles. Native handler input uses captured run1/run2 enrichment, plus labelled
 * synthetic execution/revision/constraint-verdict probes. Prompt storage is unconfigured by the
 * required env, so the production loader reads its checked-in default. Transport replies are offline.
 */
import { vi, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { fixture, array, object, type Variant, type Obj, type Captured } from './provider-harness.js';

// Anthropic's SDK uses undici rather than global fetch. Intercept that transport too.
vi.mock('undici', async original => ({
  ...await original<typeof import('undici')>(),
  fetch: (input: string | URL | Request, init?: Parameters<typeof globalThis.fetch>[1]) => globalThis.fetch(input, init),
}));

export const REVIEW_BRIEF = 'S8_REVIEW_POSITIVE: Our goal is £20,000 MRR within 12 months. Keep £49 price or raise price to £59. Paul assumes renewal churn stays at 3%; Maya disagrees. May we retain the assumption that monthly churn stays at 3%?';
/** An ordinary producer critique with no leader or flip claim: it must survive when only flip data is unavailable. */
export const REVIEW_ORDINARY_PROSE = 'Check vendor reliability before relying on this estimate.';
export const REVIEW_PRODUCER_PROSE = 'SYNTHETIC_REVIEW_PRODUCER: Raise price to £59 wins with share 1; churn could flip at 4.2%.';
export interface ReviewWitness { calls: Captured[]; sections: Record<string, unknown>; seed: ReturnType<typeof fixture>; slices: Record<string, unknown>[] }
/**
 * `runIsOwnGraph`: ground the review on the graph the Run actually analysed (the unedited 'current' capture) and supply the
 * variant's graph as the CURRENT one: the production shape of "edited after the Run". Default false keeps every earlier row's
 * wiring (the variant's graph is both grounding and current).
 */
export async function reviewCapture(variant: Variant, decomposed = false, supplyCurrentGraph = true, runIsOwnGraph = false): Promise<ReviewWitness> {
  vi.resetModules();
  const { config } = await import('../../../config/index.js');
  config.llm.openaiApiKey = 'offline-context-contract';
  // Select the existing monolithic task model; no feature gate is changed.
  config.cee.models.decision_review = 'gpt-4.1';
  // The default configuration IS the monolith (served): pin it before this capture selects the path under test.
  if (!decomposed) expect(config.cee.decisionReviewDecompose, 'default config is the monolithic review').toBe(false);
  config.cee.decisionReviewDecompose = decomposed;
  config.llm.anthropicApiKey = 'offline-context-contract';
  const seed = fixture(variant), s = seed.snapshot;
  if (variant === 'stale') {
    const { computeAnalysisAffectingGraphHash } = await import('../../../orchestrator-v5/context/graph-hash.js');
    const { GraphStateIngressSchema } = await import('../../../orchestrator-v5/boundary/request-extensions.js');
    const changedHash = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(s.graph));
    if (changedHash === null || changedHash === seed.revision) throw new Error('stale review fixture must have a genuinely changed graph');
    s.graph_hash = changedHash;
  }
  // Labelled synthetic probes for producer prose and fragility; IDs come from the captured graph.
  if (['current', 'stale', 'leader-withheld', 'flip-unavailable'].includes(variant)) {
    s.analysis_result.enrichment.robustness = { ...object(s.analysis_result.enrichment.robustness), fragile_edges: [
      { edge_id: 'pro_price->monthly_pro_churn', from_id: 'pro_price', to_id: 'monthly_pro_churn', switch_probability: 0.25 },
    ] };
    s.analysis_result.enrichment.m1_coaching = { model_critiques: [
      { type: 'anchoring', severity: 'warning', message: REVIEW_PRODUCER_PROSE },
      ...(variant === 'flip-unavailable' ? [{ type: 'anchoring', severity: 'warning', message: REVIEW_ORDINARY_PROSE }] : []),
    ] };
  }
  if (variant === 'leader-withheld') {
    // Isolate the LEADER permission from flip availability: the producer computed a pair and names who would take over.
    s.analysis_result.enrichment.flip_thresholds = [{ factor_id: 'monthly_pro_churn', factor_label: 'Monthly Pro churn',
      current_value: 3, flip_value: 4.2, value_scale: 'display', unit: '%',
      alternative_winner_id: 'keep_49_price', alternative_winner_label: 'Keep £49 price' }];
    s.analysis_result.enrichment.flip_thresholds_status = 'computed';
  }
  const result: Obj = { scenario_id: seed.scenario_id, summary: s.analysis_result.summary,
    leading_option_id: s.analysis_result.leading_option_id,
    enrichment: s.analysis_result.enrichment,
    graph_hash_at_run: seed.revision, computed_at: seed.computed_at,
    run_id: seed.captured_execution_run_id,
    constraint_verdict: { constraint_verdict_state: variant === 'leader-withheld' ? 'unevaluated' : 'not_applicable',
      may_name_leading_option: variant !== 'leader-withheld' } };
  const { HandlerFactSchema } = await import('@talchain/schemas/orchestrator');
  const fact: HandlerFact = HandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false, result });
  const calls: Captured[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    if (![ 'https://api.openai.com/v1/chat/completions', 'https://api.anthropic.com/v1/messages' ].includes(String(url))) throw new Error(`NETWORK FORBIDDEN: ${String(url)}`);
    if (typeof init?.body !== 'string') throw new Error('provider body is not a serialized string');
    const sentBody = init.body, body = JSON.parse(sentBody) as Obj;
    calls.push({ sentBody, body, sha256: createHash('sha256').update(sentBody).digest('hex'), payloads: [] });
    if (String(url) === 'https://api.anthropic.com/v1/messages') {
      const reply = { narrative_summary: 'Raise price to £59 is an option to review.',
        story_headlines: Object.fromEntries(array(s.analysis_result.enrichment.option_comparison).map(object)
          .map(o => [String(o.option_id), 'Review this option'])), readiness_rationale: 'Review the evidence.',
        robustness_explanation: { summary: 'Review assumptions.', primary_risk: 'Evidence needs review.',
          stability_factors: [], fragility_factors: [] }, evidence_enhancements: {}, key_assumptions: [],
        bias_findings: [], decision_quality_prompts: [] };
      return new Response(JSON.stringify({ id: 'offline-slice', type: 'message', role: 'assistant',
        model: 'claude-haiku-4-5', content: [{ type: 'text', text: JSON.stringify(reply) }],
        stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ id: 'offline-review', model: 'gpt-4.1',
      choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200,
      headers: { 'content-type': 'application/json' } });
  }));
  try {
    const { enrichRunAnalysisWithDecisionReview } = await import('../../../orchestrator-v5/coaching/decision-review-enricher.js');
    await enrichRunAnalysisWithDecisionReview({ handlerFacts: [fact], scenarioId: seed.scenario_id,
      requestId: 's8-review-contract', brief: REVIEW_BRIEF, runGraph: runIsOwnGraph ? fixture('current').snapshot.graph : s.graph, ...(supplyCurrentGraph ? { currentGraph: s.graph } : {}), signal: new AbortController().signal });
    expect(calls, 'REAL review provider dispatch count').toHaveLength(variant === 'run1' ? 0 : decomposed ? 4 : 1);
    if (variant === 'run1') return { calls, sections: {}, seed, slices: [] };
    const slices: Record<string, unknown>[] = [];
    for (const call of calls) {
      const message = array(call.body.messages).map(object).find(m => m.role === 'user');
      if (typeof message?.content !== 'string') throw new Error('serialized review user message missing');
      const sections: Record<string, unknown> = {};
      for (const match of message.content.matchAll(/<([A-Z_]+)>\n([\s\S]*?)\n<\/\1>/g)) {
        const text = match[2]!.trim();
        const jsonEnd = text.lastIndexOf('}');
        try { sections[match[1]!] = JSON.parse(text); } catch {
          try { sections[match[1]!] = JSON.parse(jsonEnd < 0 ? text : text.slice(0, jsonEnd + 1)); } catch { sections[match[1]!] = text; }
        }
      }
      const context = sections.DECISION_CONTEXT;
      if (typeof context === 'string') for (const line of context.split('\n')) {
        const colon = line.indexOf(':');
        if (colon >= 0) try { sections[line.slice(0, colon)] = JSON.parse(line.slice(colon + 1)); } catch { /* unstructured note */ }
      }
      call.payloads = [sections];
      slices.push(sections);
    }
    return { calls, sections: slices[0]!, seed, slices };
  } finally { vi.unstubAllGlobals(); }
}
