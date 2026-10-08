/**
 * EVENT branch two-live-draw pilot adapted from P44's 8 Oct re-pinned construction harness.
 * Authorisation: BRIEF-build.md, correction (a); exactly two draws, <=4 provider calls. Fake dispatch, no store writes.
 *
// P44 8 Oct: re-pinned to CEE 23349562 (the route now sends strictForTheDrafter(schema)).
 * Runs the real `buildModelFromBrief` (prompt, schema, compiler, admission and the one repair retry exactly as at this
 * tree's HEAD) on ONE brief, N draws. The drafter call is built with the route's own `sentBody` shape — pinned below
 * against `src/routes/agent-v1-turn.ts`, so a change to the served builder fails this file — and the ARM changes only
 * `model` (and, where stated, `reasoning.effort`). Every provider request, raw response, usage, latency, refusal and
 * repair is kept. Registration is a fake dispatch: NOTHING is written to any store (SUPABASE_* must be unset).
 *
 * Differences from the served turn, recorded per call: no turn deadline (the served call must end ~100 s into the turn;
 * a call slower than CL_SERVED_DEADLINE_MS is flagged `over_served_deadline`), and no usage ledger.
 *
 * env: CL_BRIEF (file), CL_NAME, CL_OUT (dir), CL_DRAWS, CL_ARM (label), CL_MODEL ('' = baseline), CL_EFFORT
 * ('as-baseline' | 'omit' | low | medium | high), CL_LIVE=1, CL_CALL_CAP, CL_RUN_ID.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, strictForTheDrafter, type CallStructuredModel, type ConstructionTrace } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { budgetFor } from '../../src/orchestrator-v5/agent-lane/model-budgets.js';
import { GraphV3 } from '../../src/schemas/cee-v3.js';

const BRIEF_FILE = process.env.CL_BRIEF ?? '';
const NAME = process.env.CL_NAME ?? 'brief';
const OUT = process.env.CL_OUT ?? '/private/tmp/construct-lab';
const DRAWS = Number(process.env.CL_DRAWS ?? '2');
const ARM = process.env.CL_ARM ?? 'baseline';
const ARM_MODEL = process.env.CL_MODEL ?? '';
const ARM_EFFORT = process.env.CL_EFFORT ?? 'as-baseline';
const LIVE = process.env.CL_LIVE === '1';
const CAP = Number(process.env.CL_CALL_CAP ?? '4');
if (LIVE && (!Number.isSafeInteger(CAP) || CAP < 1 || CAP > 4)) throw new Error('EVENT pilot provider cap must be a safe integer from 1 to 4');
if (LIVE && DRAWS !== 2) throw new Error('The authorised EVENT pilot is exactly two draws');
const RUN_ID = process.env.CL_RUN_ID ?? 'unset';
const CALL_TIMEOUT_MS = Number(process.env.CL_CALL_TIMEOUT_MS ?? '300000');
const SERVED_DEADLINE_MS = Number(process.env.CL_SERVED_DEADLINE_MS ?? '100000');
const URL_RESPONSES = 'https://api.openai.com/v1/responses';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The served request builder, verbatim from `callStructured` (whitespace-insensitive). */
const PINNED_SENT_BODY = squash(`
    const sentBody: Record<string, unknown> = {
      model: reqBody.model,
      instructions: reqBody.instructions,
      input: reqBody.input,
      max_output_tokens: reqBody.max_output_tokens,
      ...(reqBody.reasoning_effort !== undefined
        ? { reasoning: { effort: reqBody.reasoning_effort } }
        : {}),
      text: {
        format: {
          type: 'json_schema',
          name: 'whole_candidate',
          strict: true,
          schema: strictForTheDrafter(reqBody.schema),
        },
      },
    };`);

type CallRecord = Record<string, unknown>;

describe.skipIf(!LIVE)(`construct lab: ${ARM} on ${NAME}`, () => {
  it('the served request builder is the one pinned here', () => {
    const route = squash(readFileSync(new URL('../../src/routes/agent-v1-turn.ts', import.meta.url), 'utf8'));
    expect(route.includes(PINNED_SENT_BODY), 'served callStructured sentBody changed: re-pin before running').toBe(true);
  });

  it('writes to no store', () => {
    expect(process.env.SUPABASE_URL ?? '', 'SUPABASE_URL must be unset').toBe('');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', 'SUPABASE_SERVICE_ROLE_KEY must be unset').toBe('');
  });

  it(`builds ${DRAWS}× from the brief`, async () => {
    expect(BRIEF_FILE, 'CL_BRIEF').not.toBe('');
    const brief = readFileSync(BRIEF_FILE, 'utf8').trim();
    const baseline = budgetFor('gpt-5.6-terra', 'whole');
    mkdirSync(OUT, { recursive: true });
    let spent = 0;
    const done: string[] = [];

    for (let d = 1; d <= DRAWS; d++) {
      const file = join(OUT, `${NAME}-d${d}.json`);
      if (existsSync(file)) { done.push(`d${d}:kept`); continue; }
      if (existsSync(join(OUT, 'ABORT-429'))) break;
      const calls: CallRecord[] = [];

      const drafter: CallStructuredModel = async (reqBody) => {
        const effort = ARM_EFFORT === 'as-baseline' ? reqBody.reasoning_effort : ARM_EFFORT === 'omit' ? undefined : ARM_EFFORT;
        const model = ARM_MODEL === '' ? reqBody.model : ARM_MODEL;
        const body = (m: string, e: string | undefined): Record<string, unknown> => ({
          model: m,
          instructions: reqBody.instructions,
          input: reqBody.input,
          max_output_tokens: reqBody.max_output_tokens,
          ...(e !== undefined ? { reasoning: { effort: e } } : {}),
          text: { format: { type: 'json_schema', name: 'whole_candidate', strict: true, schema: strictForTheDrafter(reqBody.schema) } },
        });
        const sentBody = body(model, effort);
        const rec: CallRecord = {
          at: new Date().toISOString(),
          // What the served route would send for this very call, and the arm-independent part of what was sent.
          served_request_sha256: sha(JSON.stringify(body(reqBody.model, reqBody.reasoning_effort))),
          frozen_bytes_sha256: sha(JSON.stringify({ ...body('<MODEL>', undefined), reasoning: '<REASONING>' })),
          sent_request_sha256: sha(JSON.stringify(sentBody)),
          instructions_sha256: sha(reqBody.instructions), input_sha256: sha(reqBody.input), schema_sha256: sha(JSON.stringify(reqBody.schema)),
          served_model: reqBody.model, served_effort: reqBody.reasoning_effort ?? null,
          sent_model: model, sent_effort: effort ?? null, max_output_tokens: reqBody.max_output_tokens,
          request: sentBody, attempts: [] as unknown[],
        };
        calls.push(rec);
        if (!LIVE) throw new Error('This harness only records the authorised live pilot');
        // One retry on a connection-level failure only (the route's `onceMoreOnTransportFailure`), never on a timeout.
        for (let attempt = 1; attempt <= 2; attempt++) {
          if (existsSync(join(OUT, 'ABORT-429'))) throw new Error('aborted: an earlier call hit 429');
          if (spent >= CAP) throw new Error(`call cap ${CAP} reached`);
          spent += 1;
          const t0 = Date.now();
          let status = 0; let raw = '';
          try {
            const r = await fetch(URL_RESPONSES, {
              method: 'POST',
              headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`, 'content-type': 'application/json' },
              body: JSON.stringify(sentBody),
              signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            });
            status = r.status; raw = await r.text();
          } catch (err) {
            const e = err as { name?: unknown; cause?: { code?: unknown } };
            const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT' || e?.cause?.code === 'UND_ERR_BODY_TIMEOUT';
            (rec.attempts as unknown[]).push({ attempt, latency_ms: Date.now() - t0, transport_error: String(err).slice(0, 300), timeout });
            if (timeout) { rec.harness_timeout = true; return { text: '', status: 'incomplete', incomplete_reason: 'construction_timeout' }; }
            if (attempt === 2) throw err;
            continue;
          }
          const latency = Date.now() - t0;
          (rec.attempts as unknown[]).push({ attempt, latency_ms: latency, http_status: status });
          rec.http_status = status; rec.latency_ms = latency; rec.raw_response = raw;
          rec.over_served_deadline = latency > SERVED_DEADLINE_MS;
          if (status === 429) { writeFileSync(join(OUT, 'ABORT-429'), new Date().toISOString()); throw new Error('openai_429'); }
          if (status !== 200) throw new Error(`openai_${status}: ${raw.slice(0, 300)}`);
          const j = JSON.parse(raw) as {
            model?: unknown; status?: unknown; usage?: Record<string, unknown>; incomplete_details?: { reason?: unknown } | null;
            output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
          };
          let text = ''; let refusal = '';
          for (const item of j.output ?? []) {
            if (item.type !== 'message') continue;
            for (const c of item.content ?? []) { if (c.type === 'output_text') text += c.text ?? ''; if (c.type === 'refusal') refusal += c.refusal ?? ''; }
          }
          const incompleteReason = typeof j.incomplete_details?.reason === 'string' ? j.incomplete_details.reason : undefined;
          rec.response_model = j.model ?? null; rec.response_status = j.status ?? null; rec.usage = j.usage ?? null;
          rec.incomplete_reason = incompleteReason ?? null; rec.output_text = text; if (refusal !== '') rec.provider_refusal = refusal;
          return { text, usage: j.usage, ...(typeof j.status === 'string' ? { status: j.status } : {}), ...(incompleteReason !== undefined ? { incomplete_reason: incompleteReason } : {}) };
        }
        throw new Error('unreachable');
      };

      let registered: Record<string, unknown> | null = null;
      const dispatched: string[] = [];
      const scenarioId = `00000000-0000-4000-8000-${sha(`${RUN_ID}:${ARM}:${NAME}:${d}`).slice(0, 12)}`;
      const dispatch: InternalDispatch = async (path, body) => {
        dispatched.push(path.replace(scenarioId, ':id'));
        if (path.endsWith('/graph/register')) { registered = body as Record<string, unknown>; return { status: 200, json: { model_version: { version_number: 1 } } }; }
        if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
        if (path.endsWith('/graph')) {
          const graph = registered === null ? { nodes: [], edges: [] } : (registered.graph as Record<string, unknown>);
          return { status: 200, json: { graph, graph_hash: registered === null ? 'lab-empty' : 'lab-registered' } };
        }
        return { status: 404, json: { message: 'construct lab: path not served' } };
      };

      const traces: ConstructionTrace[] = [];
      const t0 = Date.now();
      let result: Record<string, unknown>;
      try { result = await buildModelFromBrief(scenarioId, brief, dispatch, drafter, (t) => { traces.push(t); }) as unknown as Record<string, unknown>; }
      catch (err) { result = { ok: false, lab_threw: String(err).slice(0, 400) }; }
      const reg = registered as Record<string, unknown> | null;
      const graph = reg === null ? null : reg.graph;
      const parsed = graph === null ? null : GraphV3.safeParse(graph);
      writeFileSync(file, JSON.stringify({
        run_id: RUN_ID, arm: ARM, brief: NAME, brief_sha256: sha(brief), draw: d, live: LIVE,
        served_baseline: { model: baseline.model, effort: baseline.reasoning_effort ?? null, max_output_tokens: baseline.max_output_tokens },
        arm_model: ARM_MODEL === '' ? baseline.model : ARM_MODEL, arm_effort: ARM_EFFORT,
        build_ms: Date.now() - t0, result, construction_trace: traces, provider_calls: calls,
        dispatched, registered_graph: graph,
        graph_v3: parsed === null ? null : { valid: parsed.success, issues: parsed.success ? [] : parsed.error.issues.slice(0, 20) },
      }, null, 2));
      done.push(`d${d}:${result.ok === true ? 'ok' : `refused:${String(result.refusal ?? result.lab_threw ?? '?').slice(0, 60)}`}`);
      if (existsSync(join(OUT, 'ABORT-429'))) break;
    }
    // eslint-disable-next-line no-console
    console.log(`CONSTRUCT-LAB ${ARM} ${NAME} ${done.join(' ')} calls=${spent}`);
    expect(existsSync(join(OUT, 'ABORT-429')), 'aborted on 429').toBe(false);
    expect(done.length).toBe(DRAWS);
  }, 3_600_000);
});
