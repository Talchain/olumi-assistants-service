/**
 * Builds shapes/MANIFEST.json from the append-only capture tree. No network. Writes once (`wx`).
 *   npx tsx tools/agent-reply-eval/paired/capture/build-manifest.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SHAPES = join(ROOT, 'Docs/evals/agent-reply/paired/57f903c/shapes');
const rel = (p: string): string => p.slice(ROOT.length + 1);
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const read = (p: string): any => JSON.parse(readFileSync(p, 'utf8'));
const isDir = (p: string): boolean => statSync(p).isDirectory();

const runs = readdirSync(join(SHAPES, '_runs')).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: rel(join(SHAPES, '_runs', f)), ...read(join(SHAPES, '_runs', f)) }));
const tokenFiles = readdirSync(SHAPES).filter((f) => f.startsWith('_token-counts-')).sort();
const tokenCounts = tokenFiles.flatMap((f) => (read(join(SHAPES, f)).results as any[]).map((r) => ({ ...r, file: rel(join(SHAPES, f)) })));

const cases: any[] = [];
for (const c of readdirSync(SHAPES).filter((d) => !d.startsWith('_') && isDir(join(SHAPES, d))).sort()) {
  for (const t of readdirSync(join(SHAPES, c)).filter((d) => isDir(join(SHAPES, c, d))).sort()) {
    const dir = join(SHAPES, c, t);
    const files = readdirSync(dir).sort();
    const requests = files.filter((f) => /^call-\d+\.request\.json$/.test(f)).map((f) => {
      const n = f.slice(5, 7);
      const meta = existsSync(join(dir, `call-${n}.meta.json`)) ? read(join(dir, `call-${n}.meta.json`)) : null;
      const respFile = files.find((x) => x.startsWith(`call-${n}.response.`));
      return {
        call: n,
        request: rel(join(dir, f)), request_sha256: sha(join(dir, f)),
        response: respFile ? rel(join(dir, respFile)) : null, response_sha256: respFile ? sha(join(dir, respFile)) : null,
        meta: meta ? rel(join(dir, `call-${n}.meta.json`)) : null,
        purpose: meta?.purpose ?? null, hop: meta?.hop ?? null, during_hop: meta?.during_hop ?? null,
        final_reply_hop: meta?.final_reply_hop ?? null, paid: meta?.paid ?? null, intercepted: meta?.intercepted ?? null,
        guard: meta?.guard ?? null, wall_ms: meta?.wall_ms ?? null,
        usage: meta?.usage ? { input_tokens: meta.usage.input_tokens, cached_tokens: meta.usage.cached_tokens, output_tokens: meta.usage.output_tokens, reasoning_tokens: meta.usage.reasoning_tokens } : null,
        settings: meta?.settings ? { model: meta.model, max_output_tokens: meta.settings.max_output_tokens, tool_choice: meta.settings.tool_choice, reasoning: meta.settings.reasoning, text_format: meta.settings.text_format, tools_count: meta.settings.tools_count, instructions_sha256: meta.settings.instructions_sha256 } : null,
      };
    });
    if (t.startsWith('token-count-')) {
      cases.push({ case: c, turn: t, purpose: 'token-count (input_tokens endpoint; no generation)', requests });
      continue;
    }
    const summaryPath = join(dir, 'turn-summary.json');
    const s = existsSync(summaryPath) ? read(summaryPath) : null;
    const checks = s?.checks ?? {};
    const failed = Object.entries(checks).filter(([, v]: [string, any]) => v && typeof v === 'object' && v.pass === false).map(([k]) => k);
    const passed = Object.entries(checks).filter(([, v]: [string, any]) => v && typeof v === 'object' && v.pass === true).map(([k]) => k);
    const reply = requests.find((r) => rel(join(ROOT, s?.reply_writing_request ?? '')) === r.request) ?? null;
    const tc = tokenCounts.find((x) => x.caseId === c && x.turn === t);
    cases.push({
      case: c,
      turn: t,
      purpose: s?.purpose ?? null,
      route_request: existsSync(join(dir, 'route-request.json')) ? rel(join(dir, 'route-request.json')) : null,
      route_response: existsSync(join(dir, 'route-response.json')) ? rel(join(dir, 'route-response.json')) : null,
      internal_dispatch: existsSync(join(dir, 'internal-dispatch.json')) ? rel(join(dir, 'internal-dispatch.json')) : null,
      turn_summary: s ? rel(summaryPath) : null,
      reply_writing_request: s?.reply_writing_request ?? null,
      reply_writing_call: reply?.call ?? null,
      reply_writing_note: s?.reply_writing_note ?? (s?.purpose === 'live-construction' ? 'the last conversation call with no function_call in its output; its output text is the model part of assistant_text (server post-processing appends Olumi’s own status/disclosures)' : s?.purpose === 'fp3-explicit-run' ? 'fast path 3 makes exactly ONE call; it writes the reply' : null),
      paid_calls: requests.filter((r) => r.paid === true).length,
      intercepted_calls: requests.filter((r) => r.intercepted === true).length,
      tools_called: s?.tools_called ?? null,
      served_tools_called: s?.served_tools_called ?? null,
      tool_sequence_resembles_served: s?.tool_sequence_resembles_served ?? null,
      first_hop_input_tokens: s?.first_hop_input_tokens ?? null,
      token_count: tc ? { counted_input_tokens: tc.counted_input_tokens, served_input_tokens: tc.served_input_tokens, delta_vs_served: tc.served_input_tokens == null || tc.counted_input_tokens == null ? null : tc.counted_input_tokens - tc.served_input_tokens, file: tc.file } : null,
      checks_passed: passed,
      checks_failed: failed,
      fidelity: s?.fidelity ?? null,
      requests,
    });
  }
}

const constructionParity = cases.filter((c) => c.purpose === 'live-construction').map((c) => {
  const s = read(join(ROOT, c.turn_summary));
  const servedConstruction = (s.served_provider_calls ?? []).find((p: any) => p.purpose === 'construction');
  const captured = c.requests.find((r: any) => r.purpose === 'construction');
  return {
    case: c.case,
    first_hop_input_tokens: s.first_hop_input_tokens,
    construction_call_input_tokens: { captured: captured?.usage?.input_tokens ?? null, served: servedConstruction?.input_tokens ?? null, equal: servedConstruction ? captured?.usage?.input_tokens === servedConstruction.input_tokens : null },
    tools_called: c.tools_called, served_tools_called: c.served_tools_called,
  };
});
const fidelitySummary = {
  fp3_exact_checks_failed: cases.filter((c) => c.purpose === 'fp3-explicit-run').map((c) => ({ case: c.case, failed: c.checks_failed })),
  fp3_and_card_history_token_gap: cases.filter((c) => c.token_count != null).map((c) => ({ case: c.case, counted_input_tokens: c.token_count.counted_input_tokens, served_input_tokens: c.token_count.served_input_tokens, delta: c.token_count.delta_vs_served, pct: c.token_count.served_input_tokens ? Math.round((1000 * c.token_count.delta_vs_served) / c.token_count.served_input_tokens) / 10 : null })),
  fp3_history_gap_reason: 'the served FP3 call carried the construction turn’s in-process items (reasoning items, three or four tool call/output pairs, the pre-post-processing final message); the capture seeds the two durable turns’ text instead, exactly as the route does after a restart. Instructions, tools, tool_choice, the run pair and canonical_state are exact.',
  construction_parity: constructionParity,
};

const manifest = {
  schema: 'agent-reply-paired-shapes-manifest.v1',
  generated_at: new Date().toISOString(),
  head: '57f903c4652783a9de1a3778d6682a8e5f8414e1',
  branch: 'aiq/agent-reply-paired',
  harness: {
    test: 'tools/agent-reply-eval/paired/capture-shapes.test.ts',
    config: 'tools/agent-reply-eval/paired/vitest.config.ts',
    helpers: ['tools/agent-reply-eval/paired/capture/network-guard.ts', 'tools/agent-reply-eval/paired/capture/product-double.ts', 'tools/agent-reply-eval/paired/capture/served.ts', 'tools/agent-reply-eval/paired/capture/source-instructions.ts', 'tools/agent-reply-eval/paired/capture/build-manifest.ts'],
    phases: {
      intercept: 'npx vitest run tools/agent-reply-eval/paired/capture-shapes.test.ts --config tools/agent-reply-eval/paired/vitest.config.ts  (no key in env; FP3 + discussion card; zero network calls)',
      live: 'OPENAI_API_KEY=<from olumi-assistants-service/.env, never printed> RUN_LIVE_CAPTURE=1 <same command>  (construction turns + token counts)',
    },
    route_under_test: 'src/routes/agent-v1-turn.ts agentV1TurnRoute (REAL, in-process, AGENT_LANE_ENABLED=true, AGENT_LANE_PREVIEW=false), under its own runWithProviderPolicy(OPENAI_ONLY)',
    doubles: 'session store (ensureScenarioExists → guest; readRecent → durable rows), resolveUserIdentity → {mode:"off"}, internal routes answered by capture/product-double.ts',
    served_captures: '~/olumi-ai-quality-20260924/captures/57f903c-{hiring,pricing}/ (read-only; sha256 of each file used is in the FP3 turn-summary served_reference.files)',
  },
  guard: runs,
  fidelity_summary: fidelitySummary,
  totals: {
    paid_generation_calls: runs.reduce((a, r) => a + (r.guard?.generation_calls ?? 0), 0),
    token_count_calls: runs.reduce((a, r) => a + (r.guard?.token_count_calls ?? 0), 0),
    intercepted_calls: cases.reduce((a, c) => a + (c.intercepted_calls ?? 0), 0),
    blocked_non_openai_attempts: runs.reduce((a, r) => a + (r.guard?.blocked?.length ?? 0), 0),
  },
  cases,
};
writeFileSync(join(SHAPES, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(`wrote ${rel(join(SHAPES, 'MANIFEST.json'))}: ${cases.length} entries; totals ${JSON.stringify(manifest.totals)}`);
