/**
 * SPIKE S3 CONTROL ARM: TODAY's core drafter and route on the SAME SHA (a local CEE started from this worktree; no
 * `x-olumi-draft-arm` header), the same briefs, the same operator and the same facts sheet, writing the same record.
 *
 * Why a local server and not the in-memory harness: today's route reaches a chance only through a real Run (PLoT, then ISL)
 * and the scenario read that projects `canonical_analysis_view` from the stored Run; the in-memory harness has neither. The
 * local server uses the real stores (guest TEST rows on the shared staging Supabase, as served runs do) and staging PLoT.
 * The spike arm stays in memory: its saved shape has not passed the prod-reader check (plan step 1b).
 *
 * Per run: brief → (the operator answers the reply's questions; a card issued in response to those answers is approved,
 * once, as the person would) × ≤ 3 → one Run press unless the read already holds a current Run → the final read (its graph,
 * living_model and canonical_analysis_view). A press is part of applying the answer, never an answer turn of its own.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { answerQuestions } from './operator.mjs';
import { callsOf, chancesFromView, hasChance, renderLiving, sumTokens, tokensOf, usdOf } from './record.mjs';

const TIMEOUT_MS = 600_000;
const RATE_LIMIT_IN_BODY = /"(?:status|statusCode|status_code|http_status|upstream_status)"\s*:\s*429\b|rate_limit_error|"code"\s*:\s*"RATE_LIMIT(?:ED)?"|openai_429|insufficient_quota/i;

export async function runControl({ target, assistKey, apiKey, id, rep, brief, facts, out, stopFile, onSpend }) {
  const file = `${out}/${id}-r${rep}.json`;
  if (fs.existsSync(file)) return null;
  const sid = randomUUID();
  const t0 = Date.now();
  const turns = []; const qa = []; const operatorCalls = []; const reads = [];
  const stop = () => fs.existsSync(stopFile);
  const headers = { 'content-type': 'application/json', 'x-olumi-assist-key': assistKey };

  const post = async (payload, kind) => {
    if (stop()) throw new Error('STOP-429 present');
    const s = Date.now(); const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let status = null; let body = {}; let text = '';
    try {
      const res = await fetch(`${target}/agent/v1/core-turn`, { method: 'POST', headers, signal: ac.signal,
        body: JSON.stringify({ scenario_id: sid, turn_id: randomUUID(), turn_class: 'frame', ...payload }) });
      status = res.status; text = await res.text();
      try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
    } catch (e) { body = { transport_error: String(e) }; } finally { clearTimeout(timer); }
    if (status === 429 || RATE_LIMIT_IN_BODY.test(text)) fs.writeFileSync(stopFile, `429 at core-turn ${new Date().toISOString()}\n`);
    const calls = callsOf(body);
    const usd = calls.reduce((a, c) => a + c.usd, 0); onSpend(usd);
    turns.push({ kind, status, ms: Date.now() - s, calls, usd: +usd.toFixed(4), tool_calls: body._agent?.tool_calls ?? null, error: body.error ?? body.transport_error ?? null,
      durability: body.durability ?? null, receipts: body.receipts ?? [], cards: (body.cards ?? []).map((c) => ({ proposal_id: c.proposal_id ?? null, approve: c.approve_action?.message ?? null })),
      ran: body.analysis_result !== undefined, assistant_text: body.assistant_text ?? null });
    return body;
  };
  const read = async (why) => {
    const s = Date.now();
    try {
      const res = await fetch(`${target}/assist/v1/scenarios/${sid}/graph`, { method: 'POST', headers, body: JSON.stringify({ fresh: true }) });
      const body = await res.json().catch(() => ({}));
      reads.push({ why, status: res.status, ms: Date.now() - s, run_state: body.analysis_state?.run_state?.kind ?? null });
      return body;
    } catch (e) { reads.push({ why, status: 'THREW', error: String(e) }); return {}; }
  };

  let last = await post({ kind: 'message', stage: 'frame', message: brief, source: 'composer' }, 'draft');
  let shown = new Set((last.cards ?? []).map((c) => c.proposal_id));
  for (let k = 1; k <= 3; k += 1) {
    if (stop() || typeof last.assistant_text !== 'string') break;
    const op = await answerQuestions({ facts, replyText: last.assistant_text, apiKey });
    if (op.call) { operatorCalls.push({ turn: k, ...op.call, tokens: tokensOf(op.call.usage), usd: +usdOf(op.call.usage).toFixed(4) }); onSpend(usdOf(op.call.usage)); }
    for (const q of op.questions) qa.push({ turn: k, question: q.question, status: q.status, answer: q.answer, fact: q.fact, flags: q.flags });
    if (op.questions.length === 0) qa.push({ turn: k, question: null, status: 'no_question', answer: null, flags: op.flags });
    if (op.message === null) break;
    const displayed = (last.cards ?? []).filter((c) => typeof c.proposal_id === 'string').map((c) => (c.revision === undefined ? { proposal_id: c.proposal_id } : { proposal_id: c.proposal_id, revision: c.revision }));
    last = await post({ kind: 'message', stage: 'analyse', message: op.message, source: 'composer', ...(displayed.length ? { displayed_proposals: displayed } : {}) }, 'answer');
    // The cards issued in response to these answers: the person approves each once, with its own button words.
    for (const card of (last.cards ?? []).filter((c) => typeof c.proposal_id === 'string' && !shown.has(c.proposal_id) && c.approve_action?.id)) {
      if (stop()) break;
      const pressed = await post({ kind: 'message', stage: 'analyse', message: card.approve_action.message, source: 'chip', chip: { id: card.approve_action.id } }, 'approve');
      qa.push({ turn: k, press: card.proposal_id, status: pressed.error ? 'press_refused' : 'pressed', error: pressed.error?.code ?? null });
      if (typeof pressed.assistant_text === 'string' && pressed.assistant_text.trim() !== '') last = pressed;
    }
    shown = new Set([...shown, ...(last.cards ?? []).map((c) => c.proposal_id)]);
  }
  let final = await read('before_run');
  if (!stop() && final.graph && final.analysis_state?.run_state?.kind !== 'complete_current') {
    await post({ kind: 'message', stage: 'analyse', message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } }, 'run');
    final = await read('after_run');
  }
  const view = final.canonical_analysis_view ?? null;
  const lm = final.graph?.living_model ?? null;
  const labels = new Map((lm?.options ?? []).map((o) => [o.id, o.label]));
  const calls = turns.reduce((a, t) => a + t.calls.length, 0) + operatorCalls.length;
  const rec = { arm: 'control', id, rep, scenario_id: sid, at: new Date(t0).toISOString(), seconds: +((Date.now() - t0) / 1000).toFixed(1), facts_sheet: facts === null ? 'none' : `${facts.length} lines`,
    calls, usd: +(turns.reduce((a, t) => a + t.usd, 0) + operatorCalls.reduce((a, c) => a + c.usd, 0)).toFixed(4),
    tokens: sumTokens([...turns.flatMap((t) => t.calls.map((c) => c.tokens)), ...operatorCalls.map((c) => c.tokens)]),
    // The draft turn's FIRST construction attempt, and its outcome after the route's own repairs (its self-check loop).
    first_attempt: (() => { const b = (turns[0]?.tool_calls ?? []).filter((c) => c.name === 'build_model_from_brief'); return b.length ? { outcome: b[0].outcome, refusal: b[0].refusal ?? null } : { outcome: 'no_build_call' }; })(),
    post_repair: (() => { const b = (turns[0]?.tool_calls ?? []).filter((c) => c.name === 'build_model_from_brief'); return { build_calls: b.length, saved: b.some((c) => c.outcome === 'ok'), last: b.at(-1)?.outcome ?? null, last_refusal: b.at(-1)?.refusal ?? null }; })(),
    has_chance: hasChance(view), chances: chancesFromView(view, labels), run_state: final.analysis_state?.run_state ?? null,
    qa, operator_calls: operatorCalls, reads, turns, final_saved: final.graph != null, answer_turns: turns.filter((t) => t.kind === 'answer').length };
  fs.writeFileSync(file, JSON.stringify(rec, null, 1));
  if (final.graph) {
    fs.writeFileSync(`${out}/${id}-r${rep}.saved.json`, JSON.stringify({ living_model: lm, graph: final.graph }, null, 1));
    fs.writeFileSync(`${out}/${id}-r${rep}.readable.md`, renderLiving(lm, brief.slice(0, 120)));
  }
  fs.writeFileSync(`${out}/${id}-r${rep}.view.json`, JSON.stringify(view, null, 1));
  return rec;
}
