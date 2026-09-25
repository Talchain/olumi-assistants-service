/**
 * AQ-FMC-0.1 — the COMPLETE PRODUCT RESPONSE for one reply-writing model output, composed with the
 * route's own post-processing at c933aabf (imported, never re-typed). Mirrors agent-v1-turn.ts:
 *   :1447 text = model text of the final hop (hop-limit fallback NOT mirrored: refused below)
 *   :1471 stateFacts = collectTurnStateFacts(result.tool_results)
 *   :1494 firstAnalysisSaid = firstAnalysisSentence(firstAnalysis.outcome)
 *   :1495 owed = current_state_unknown ? valueChangeDisclosures(facts)
 *                : [...disclosuresFor(results), ...valueChangeDisclosures(facts), firstAnalysisSaid?]
 *   :1617 narration = fastPath==='run' ? {text} : narrateWriteOutcome(text, tool_calls, tool_results)
 *   :1627 assistant_text = withoutProposalIds(withWriteOutcome(withDisclosures(narration.text, owed),
 *                            [narration.status, notAdoptedLine(...)].filter(nonEmpty).join(' ') || null))
 *   :1675 enforceLeadingOptionClaimsAtWire(wireBody, {...}) on an analysis-bearing turn
 * Everything else in the wire body (blocks, suggested_actions, analysis_state, …) is fixed by tool
 * results that precede the final hop, so it is taken from the captured R route response unchanged.
 *
 * VALIDATED, NOT ASSUMED: `validate` recomposes the captured R raw model text and requires the captured
 * route `assistant_text` byte for byte before any arm is composed. 57f903c's old parity claim is not inherited.
 *
 * Inputs recovered from the capture, each named: tool calls/results from the final-hop request's own
 * input (function_call + function_call_output pairs, agent-loop's JSON.stringify(result)); the first-
 * analysis sentence from `_diagnostic_trace.first_analysis` (+ its paragraph in the captured text for
 * not_admissible/refused, whose nextStep the trace does not carry); the gate's graph = `draft_graph`.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { narrateWriteOutcome, notAdoptedLine, withWriteOutcome } from '../../src/orchestrator-v5/agent-lane/write-outcome.js';
import { disclosuresFor, valueChangeDisclosures, withDisclosures } from '../../src/orchestrator-v5/agent-lane/disclosure.js';
import { collectTurnStateFacts } from '../../src/orchestrator-v5/agent-lane/turn-state-facts.js';
import { withoutProposalIds } from '../../src/orchestrator-v5/agent-lane/display-ids.js';
import { firstAnalysisSentence } from '../../src/orchestrator-v5/agent-lane/first-analysis.js';
import { enforceLeadingOptionClaimsAtWire } from '../../src/orchestrator-v5/compose/leading-option-wire-enforcement.js';

type Rec = Record<string, any>;
const AQ = '~/olumi-ai-quality-20260924/aqfmc';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const readJson = (p: string): any => JSON.parse(readFileSync(p, 'utf8'));
const unwrapBody = (j: Rec): Rec => (j && typeof j.body === 'object' && j.body !== null && 'input' in j.body ? j.body : j);
const unwrapResp = (j: Rec): Rec => (j && Array.isArray(j.output) ? j : j?.body && Array.isArray(j.body.output) ? j.body : j?.response && Array.isArray(j.response.output) ? j.response : j?.json && Array.isArray(j.json.output) ? j.json : j);
const unwrapRoute = (j: Rec): Rec => (j && typeof j.assistant_text === 'string' ? j : j?.body && typeof j.body.assistant_text === 'string' ? j.body : j?.json && typeof j.json.assistant_text === 'string' ? j.json : j);

export function textOfOutput(output: unknown): string {
  let t = '';
  for (const i of Array.isArray(output) ? output : []) {
    if (i?.type !== 'message') continue;
    for (const c of Array.isArray(i.content) ? i.content : []) if (c?.type === 'output_text' && typeof c.text === 'string') t += c.text;
  }
  return t;
}

export function toolsFromInput(input: unknown): { toolCalls: Rec[]; toolResults: Rec[] } {
  const all = (Array.isArray(input) ? input : []).filter((i) => i && typeof i === 'object') as Rec[];
  // THIS turn's calls only: at c933aabf the history carries earlier turns' function calls, and the
  // route's result.tool_calls hold only the calls made after the user's latest message.
  const lastUser = all.map((i) => i.role === 'user' && (i.type === undefined || i.type === 'message')).lastIndexOf(true);
  const items = all.slice(lastUser + 1);
  const outputs = new Map(items.filter((i) => i.type === 'function_call_output').map((i) => [String(i.call_id), String(i.output)]));
  const toolCalls: Rec[] = [], toolResults: Rec[] = [];
  for (const c of items.filter((i) => i.type === 'function_call')) {
    const out = outputs.get(String(c.call_id));
    if (out === undefined) throw new Error(`function_call ${String(c.name)} has no output in the input`);
    const r = JSON.parse(out) as Rec;
    toolCalls.push({ name: String(c.name), ok: r.ok, mutated: r.mutated,
      ...(typeof r.proposal_id === 'string' ? { proposal_id: r.proposal_id } : {}),
      ...(typeof r.outcome === 'string' ? { outcome: r.outcome } : {}),
      ...(typeof r.refusal === 'string' ? { refusal: r.refusal } : {}) });
    toolResults.push(r);
  }
  return { toolCalls, toolResults };
}

export interface Ctx { toolCalls: Rec[]; toolResults: Rec[]; firstAnalysisSaid: string | null; route: Rec; analysisBearing: boolean; source: Rec }

export function ctxFor(stateDir: string): Ctx {
  const fh = readJson(join(stateDir, 'final-hop.json'));
  const idx = fh.index ?? fh.final_hop_index ?? fh.call_index;
  const reqPath = fh.request_path ?? fh.path ?? join(stateDir, 'llm-calls', `${String(idx).padStart(2, '0')}.request.json`);
  const req = unwrapBody(readJson(reqPath.startsWith('/') ? reqPath : join(stateDir, reqPath)));
  const route = unwrapRoute(readJson(join(stateDir, 'route.response.json')));
  const { toolCalls, toolResults } = toolsFromInput(req.input);
  const trace = route._diagnostic_trace ?? {};
  const fa = trace.first_analysis as Rec | undefined;
  let firstAnalysisSaid: string | null = null;
  if (fa !== undefined && fa.ran !== true) {
    if (fa.reason === 'not_admissible' || fa.reason === 'refused') {
      const para = String(route.assistant_text).split('\n\n').find((p) => p.startsWith('The first analysis could not run yet'));
      if (para === undefined) throw new Error('first analysis not admissible but its sentence is not in the captured text');
      firstAnalysisSaid = para;
    } else firstAnalysisSaid = firstAnalysisSentence({ ran: false, reason: fa.reason } as never);
  }
  const tools: string[] = Array.isArray(trace.tools_called) ? trace.tools_called : [];
  const analysisBearing = (route.analysis_result !== undefined && route.analysis_result !== null) || fa !== undefined || tools.includes('run_analysis');
  return { toolCalls, toolResults, firstAnalysisSaid, route, analysisBearing,
    source: { final_hop_request: reqPath, final_hop_index: idx, first_analysis: fa ?? null, tools_called: tools, fast_path: trace.fast_path ?? null } };
}

export function composeFull(raw: string, ctx: Ctx): { visible: string; body: Rec; gateChanged: boolean; stripped: string[]; status: string | null; notAdopted: string | null; owed: string[] } {
  if (raw.trim().length === 0) throw new Error('empty model text: the route substitutes its own fallback, not mirrored');
  if (ctx.source.fast_path === 'run') throw new Error('FP3 turns are not in this experiment');
  const facts = collectTurnStateFacts(ctx.toolResults);
  const owed = (facts as Rec).current_state_unknown === true
    ? [...valueChangeDisclosures(facts as never)]
    : [...disclosuresFor(ctx.toolResults as never), ...valueChangeDisclosures(facts as never), ...(ctx.firstAnalysisSaid !== null ? [ctx.firstAnalysisSaid] : [])];
  const narration = narrateWriteOutcome(raw, ctx.toolCalls as never, ctx.toolResults as never);
  const notAdopted = notAdoptedLine(ctx.toolCalls as never, ctx.toolResults as never);
  const visible = withoutProposalIds(withWriteOutcome(withDisclosures(narration.text, owed),
    [narration.status, notAdopted].filter((x): x is string => x !== null && x !== '').join(' ') || null));
  let body: Rec = { ...ctx.route, assistant_text: visible };
  let gateChanged = false;
  if (ctx.analysisBearing) {
    const claim = ctx.route.analysis_state?.leader_claim as Rec | undefined;
    const enforced = enforceLeadingOptionClaimsAtWire(body as never, {
      requestId: 'aqfmc-sim', exitPath: 'agent_lane_v1',
      mayNameLeadingOption: claim?.permitted === true,
      separationEstablished: claim?.separation === 'separated',
      ...(typeof claim?.withheld_reason === 'string' ? { leaderClaimWithheldReason: claim.withheld_reason } : {}),
      graph: ctx.route.draft_graph ?? null,
      analysisReady: ctx.route.analysis_ready,
    } as never) as Rec;
    if (enforced.changed) { gateChanged = true; body = enforced.response as Rec; }
  }
  return { visible: String(body.assistant_text), body, gateChanged, stripped: [...narration.stripped], status: narration.status, notAdopted, owed };
}

function main(): void {
  const mode = process.argv[2] ?? 'validate';
  const rRoot = join(AQ, 'captures', 'R');
  const states = existsSync(rRoot) ? readdirSync(rRoot).filter((s) => existsSync(join(rRoot, s, 'final-hop.json'))).sort() : [];
  const report: Rec = { head: 'c933aabfaffb4cac5572b7962d9e3a3658996de0', validation: {}, composed: [] };
  const ctxs: Record<string, Ctx> = {};
  for (const s of states) {
    const dir = join(rRoot, s);
    try {
      const ctx = ctxFor(dir); ctxs[s] = ctx;
      const fhResp = (() => { const fh = readJson(join(dir, 'final-hop.json')); const idx = fh.index ?? fh.final_hop_index ?? fh.call_index; const p = fh.response_path ?? join(dir, 'llm-calls', `${String(idx).padStart(2, '0')}.response.json`); return unwrapResp(readJson(p.startsWith('/') ? p : join(dir, p))); })();
      const raw = textOfOutput(fhResp.output);
      const sim = composeFull(raw, ctx);
      const actual = String(ctx.route.assistant_text);
      report.validation[s] = { byte_equal: sim.visible === actual, sim_sha: sha(sim.visible), actual_sha: sha(actual), server_copy_nonempty: sim.visible !== raw, owed: sim.owed, status: sim.status, not_adopted: sim.notAdopted, stripped: sim.stripped, gate_changed: sim.gateChanged, analysis_bearing: ctx.analysisBearing, source: ctx.source,
        ...(sim.visible === actual ? {} : { first_diff_at: [...sim.visible].findIndex((ch, i) => ch !== actual[i]), sim_tail: sim.visible.slice(-300), actual_tail: actual.slice(-300) }) };
    } catch (e) { report.validation[s] = { error: String((e as Error).message) }; }
  }
  if (mode === 'compose') {
    const rep = join(AQ, 'replays'); const out = join(rep, 'full'); mkdirSync(out, { recursive: true });
    for (const f of readdirSync(rep).filter((x) => /\.rep\d+\.json$/.test(x)).sort()) {
      const r = readJson(join(rep, f)); const v = report.validation[r.state];
      if (!v?.byte_equal) { report.composed.push({ id: r.id, status: 'NOT_COMPOSED', reason: 'R composition not validated for this state' }); continue; }
      if (r.outcome?.type !== 'text') { report.composed.push({ id: r.id, status: 'NOT_A_COMPLETED_REPLY', outcome: r.outcome?.type }); continue; }
      const sim = composeFull(r.outcome.text, ctxs[r.state]!);
      writeFileSync(join(out, f), JSON.stringify({ id: r.id, state: r.state, arm: r.arm, rep: r.rep, raw: r.outcome.text, visible: sim.visible, gate_changed: sim.gateChanged, stripped: sim.stripped, owed: sim.owed, status: sim.status, not_adopted: sim.notAdopted, suggested_actions: sim.body.suggested_actions ?? [], blocks: sim.body.blocks ?? [] }, null, 1));
      report.composed.push({ id: r.id, status: 'COMPOSED', gate_changed: sim.gateChanged, stripped: sim.stripped.length });
    }
  }
  mkdirSync(join(AQ, 'replays'), { recursive: true });
  writeFileSync(join(AQ, 'replays', mode === 'compose' ? 'COMPOSE.json' : 'VALIDATION.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.validation).map(([s, v]: [string, any]) => [s, v.error ?? { byte_equal: v.byte_equal, server_copy_nonempty: v.server_copy_nonempty, owed: v.owed?.length, gate_changed: v.gate_changed, first_diff_at: v.first_diff_at }])), null, 1));
  if (mode === 'compose') console.log(JSON.stringify(report.composed.map((c: Rec) => `${c.id} ${c.status}${c.gate_changed ? ' GATE' : ''}`)));
}
main();
