/** REAL enrichRunAnalysisWithDecisionReview -> invokeDecisionReview -> production OpenAI SDK -> fetch.
 * No function/adapter doubles. Native handler input uses captured run1/run2 enrichment, plus labelled
 * synthetic execution/revision/constraint-verdict probes. Prompt storage is unconfigured by the
 * required env, so the production loader reads its checked-in default. Transport replies are offline.
 */
import { vi, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { fixture, array, object, captureDir, type Variant, type Obj, type Captured } from './provider-harness.js';

export const REVIEW_BRIEF = 'S8_REVIEW_POSITIVE: Our goal is £20,000 MRR within 12 months. Keep £49 price or raise price to £59. Paul assumes renewal churn stays at 3%; Maya disagrees. May we retain the assumption that monthly churn stays at 3%?';
export interface ReviewWitness { calls: Captured[]; sections: Record<string, unknown>; seed: ReturnType<typeof fixture> }
export async function reviewCapture(variant: Variant): Promise<ReviewWitness> {
  vi.resetModules();
  const { config } = await import('../../../config/index.js');
  config.llm.openaiApiKey = 'offline-context-contract';
  // Select the existing monolithic task model; no feature gate is changed.
  config.cee.models.decision_review = 'gpt-4.1';
  expect(config.cee.decisionReviewDecompose, 'this file is the monolithic/default contract').toBe(false);
  const seed = fixture(variant), s = seed.snapshot;
  if (variant === 'stale') {
    const { computeAnalysisAffectingGraphHash } = await import('../../../orchestrator-v5/context/graph-hash.js');
    const { GraphStateIngressSchema } = await import('../../../orchestrator-v5/boundary/request-extensions.js');
    const changedHash = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(s.graph));
    if (changedHash === null || changedHash === seed.revision) throw new Error('stale review fixture must have a genuinely changed graph');
    s.graph_hash = changedHash;
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
    if (String(url) !== 'https://api.openai.com/v1/chat/completions') throw new Error(`NETWORK FORBIDDEN: ${String(url)}`);
    if (typeof init?.body !== 'string') throw new Error('provider body is not a serialized string');
    const sentBody = init.body, body = JSON.parse(sentBody) as Obj;
    calls.push({ sentBody, body, sha256: createHash('sha256').update(sentBody).digest('hex'), payloads: [] });
    return new Response(JSON.stringify({ id: 'offline-review', model: 'gpt-4.1',
      choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200,
      headers: { 'content-type': 'application/json' } });
  }));
  try {
    const { enrichRunAnalysisWithDecisionReview } = await import('../../../orchestrator-v5/coaching/decision-review-enricher.js');
    await enrichRunAnalysisWithDecisionReview({ handlerFacts: [fact], scenarioId: seed.scenario_id,
      requestId: 's8-review-contract', brief: REVIEW_BRIEF, runGraph: s.graph, signal: new AbortController().signal });
    expect(calls, 'REAL review provider dispatch count').toHaveLength(variant === 'run1' ? 0 : 1);
    if (variant === 'run1') return { calls, sections: {}, seed };
    const call = calls[0]!;
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
    call.payloads = Object.values(sections);
    if (captureDir !== undefined) {
      const dir = `${captureDir}/provider/decision-review-monolithic/${variant}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/1.sentBody.json`, call.sentBody);
      writeFileSync(`${dir}/1.sha256`, `${call.sha256}\n`);
    }
    return { calls, sections, seed };
  } finally { vi.unstubAllGlobals(); }
}
