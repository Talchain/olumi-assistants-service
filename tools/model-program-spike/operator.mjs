#!/usr/bin/env node
/**
 * SPIKE S3 OPERATOR: answers the model's asks from a sealed FACTS SHEET, by meaning, the way the person would.
 *
 *   node operator.mjs <facts-file> <brief-id> [asks.json]      → prints the answers as JSON (one model call)
 *   import { loadFacts, answerAsks } from './operator.mjs'      → the acceptance driver's use
 *
 * The sheet is read BY PATH at run time (its author is a fresh agent; the builder never opens it). Its format, per brief:
 *   === FACTS <id> ===
 *   - <short question it answers> :: <answer> [TRANSCRIPT|FIXTURE|UNKNOWN]
 *
 * ONE cheap model call per answer turn matches every open ask to at most one fact line. It may never invent beyond the
 * sheet, and code enforces that, not the prompt alone:
 *   · no line, a line marked [UNKNOWN], or a brief with no sheet → "I don't know" (nothing is sent for that ask);
 *   · every figure it returns must be traceable to a number written in that line's answer, directly or by an exact
 *     conversion (×/÷ 100, 12, 52, 1000, 1,000,000); otherwise "I don't know", flagged `untraceable`;
 *   · the answer's words are the line's own answer text, verbatim: they become the person's quote.
 */
import fs from 'node:fs';

export const OPERATOR_MODEL = 'gpt-5.6-terra';
export const OPERATOR_EFFORT = 'low';
export const DONT_KNOW = "I don't know.";

const INSTRUCTIONS = [
  'You answer a reasoning tool\'s questions on behalf of a person, using ONLY their numbered facts sheet.',
  'For each question: pick the ONE fact line that answers that same question by meaning (the same thing being asked, not a related figure), however it is worded and in whatever form it gives the answer (a date or a delay, a share or a count, other units). A question about how firm a figure or range is (firm limits or a rough estimate?) is answered by the line that gives that figure. If no line does, fact_line is null.',
  'Then give the figure in the question\'s unit: value for a single figure; low and high for a range the line gives (value null unless the line also gives a most likely figure).',
  'Convert only when the unit demands it and the conversion is exact: per month to per year (×12), per week to per year (×52), a percentage to a fraction (÷100) when the unit is "1", "k" as thousands. When the line answers the question but states no figure that converts exactly into its unit (a date for "months from now", "a rough guess" for "firm or rough?"), keep its fact_line and leave value, low and high null: the person then answers in that line\'s own words.',
  'Never invent, estimate, average or combine figures. A line marked [UNKNOWN] answers nothing: fact_line null.',
].join('\n');

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answers'],
  properties: { answers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['quantity_id', 'fact_line', 'value', 'low', 'high'],
    properties: { quantity_id: { type: 'string' }, fact_line: { type: ['integer', 'null'] }, value: { type: ['number', 'null'] }, low: { type: ['number', 'null'] }, high: { type: ['number', 'null'] } } } } },
};

/** The brief's fact lines, numbered from 1; null when the sheet has no section for it. */
export function loadFacts(file, briefId) {
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `=== FACTS ${briefId} ===`);
  if (start < 0) return null;
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^===\s*FACTS\s/.test(l.trim())) break;
    const m = l.match(/^\s*-\s*(.*?)\s*::\s*(.*?)\s*\[(TRANSCRIPT|FIXTURE|UNKNOWN)\]\s*$/);
    if (m) out.push({ line: out.length + 1, question: m[1], answer: m[2], tag: m[3] });
  }
  return out;
}

/** Every number written in an answer ("£2,000", "3–4%", "2.5k"), with k/m read as written multipliers. */
function numbersIn(text) {
  const found = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?\b/gi)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const mult = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6 }[(m[2] ?? '').toLowerCase()] ?? 1;
    found.push(n, n * mult);
  }
  return found;
}
const FACTORS = [1, 100, 0.01, 12, 1 / 12, 52, 1 / 52, 1000, 0.001, 1e6, 1e-6];
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
export function traceable(v, text) {
  if (v === null || v === undefined) return true;
  return numbersIn(text).some((n) => FACTORS.some((f) => close(v, n * f)));
}

/**
 * Answer the open asks in ONE call. `fetchImpl` is the harness's fetch (its 429 stop applies); `apiKey` is never printed.
 * Returns each ask's answer, and the call's usage and time.
 */
export async function answerAsks({ facts, asks, apiKey, fetchImpl = fetch }) {
  const unknownAll = (flag) => ({ answers: asks.map((a) => ({ quantity_id: a.quantity_id, question: a.question, unit: a.unit, status: 'unknown', said: DONT_KNOW, flags: [flag] })), call: null });
  if (facts === null) return unknownAll('no_facts_sheet');
  if (asks.length === 0) return { answers: [], call: null };
  const input = [
    'FACTS:', ...facts.map((f) => `${f.line}. ${f.question} :: ${f.answer} [${f.tag}]`), '',
    'QUESTIONS:', ...asks.map((a) => `- quantity_id: ${a.quantity_id}; question: ${a.question}; unit: ${a.unit}; what it is: ${a.label}`),
  ].join('\n');
  const t0 = Date.now();
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPERATOR_MODEL, instructions: INSTRUCTIONS, input, reasoning: { effort: OPERATOR_EFFORT }, max_output_tokens: 4000, store: false,
      text: { format: { type: 'json_schema', name: 'operator_answers', strict: true, schema: SCHEMA } } }),
  });
  const ms = Date.now() - t0;
  const body = await res.json().catch(() => ({}));
  const call = { model: OPERATOR_MODEL, http: res.status, ms, usage: body.usage ?? null };
  if (!res.ok) return { ...unknownAll(`operator_http_${res.status}`), call };
  const text = (body.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
  let parsed = null;
  try { parsed = JSON.parse(text ?? 'null'); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.answers)) return { ...unknownAll('operator_unparsed'), call };
  const byId = new Map(parsed.answers.map((a) => [a.quantity_id, a]));
  const answers = asks.map((ask) => {
    const a = byId.get(ask.quantity_id);
    const base = { quantity_id: ask.quantity_id, question: ask.question, unit: ask.unit };
    if (!a || a.fact_line === null) return { ...base, status: 'unknown', said: DONT_KNOW, flags: a ? ['no_matching_fact'] : ['not_answered_by_operator'] };
    const fact = facts.find((f) => f.line === a.fact_line);
    if (!fact) return { ...base, status: 'unknown', said: DONT_KNOW, flags: ['fact_line_out_of_range'] };
    if (fact.tag === 'UNKNOWN') return { ...base, status: 'unknown', said: fact.answer, fact, flags: ['fact_unknown'] };
    const ranged = a.low !== null && a.high !== null;
    // DL 23 Oct (batch-1 score): a line that answers the question is the person's answer even when no exact figure in the
    // ask's unit can be read off it (a date for "months from now", "firm or rough?"): they say the line's own words, and the
    // tool reads them; "I don't know" is only for a question the sheet truly lacks.
    const inWords = (flag) => ({ ...base, status: 'answered_in_words', said: fact.answer, words: fact.answer, fact, flags: [flag], proposed: { value: a.value, low: a.low, high: a.high } });
    if (!ranged && a.value === null) return inWords('no_figure');
    const figures = ranged ? [a.low, a.high, a.value] : [a.value];
    if (!figures.every((v) => traceable(v, fact.answer))) return inWords('untraceable');
    return { ...base, status: 'answered', said: fact.answer, words: fact.answer, value: a.value, low: ranged ? a.low : null, high: ranged ? a.high : null, fact, flags: [] };
  });
  return { answers, call };
}

const Q_INSTRUCTIONS = [
  'A reasoning tool replied to a person. You answer its questions on behalf of the person, using ONLY their numbered facts sheet.',
  'List EVERY question the replies ask the person, in their own words, once each (a question printed twice is one). For each, pick the ONE fact line that answers that same question by meaning, or null.',
  'A line marked [UNKNOWN] still counts as the person\'s answer (they will say they do not know). Never invent or combine facts.',
].join('\n');
const Q_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: { questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'fact_line'],
    properties: { question: { type: 'string' }, fact_line: { type: ['integer', 'null'] } } } } },
};

/**
 * The operator reads EVERY reply since its last message (an answer's reply and the replies to its card presses: class 3, a
 * press reply with no question ended runs with the answer reply's questions unanswered) and answers each question from
 * the sheet in ONE call. Every answer is the matched line's own words (an [UNKNOWN] line's words say they don't know); a
 * question no line answers is "I don't know." The message is those answers, in order, as the person would type them.
 */
export async function answerQuestions({ facts, replyText, apiKey, fetchImpl = fetch }) {
  if (facts === null) return { questions: [], message: null, call: null, flags: ['no_facts_sheet'] };
  if (!replyText || !replyText.includes('?')) return { questions: [], message: null, call: null, flags: ['no_question_in_reply'] };
  const input = ['FACTS:', ...facts.map((f) => `${f.line}. ${f.question} :: ${f.answer} [${f.tag}]`), '', 'REPLY:', replyText].join('\n');
  const t0 = Date.now();
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPERATOR_MODEL, instructions: Q_INSTRUCTIONS, input, reasoning: { effort: OPERATOR_EFFORT }, max_output_tokens: 4000, store: false,
      text: { format: { type: 'json_schema', name: 'operator_questions', strict: true, schema: Q_SCHEMA } } }),
  });
  const body = await res.json().catch(() => ({}));
  const call = { model: OPERATOR_MODEL, http: res.status, ms: Date.now() - t0, usage: body.usage ?? null };
  if (!res.ok) return { questions: [], message: null, call, flags: [`operator_http_${res.status}`] };
  const text = (body.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
  let parsed = null;
  try { parsed = JSON.parse(text ?? 'null'); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.questions)) return { questions: [], message: null, call, flags: ['operator_unparsed'] };
  // Issue map class 3: a cap of 6 skipped the rest of a long first reply's questions (8–19 asked); every one is answered now.
  const questions = parsed.questions.map((q) => {
    const fact = q.fact_line === null ? null : facts.find((f) => f.line === q.fact_line) ?? null;
    const said = fact === null ? DONT_KNOW : fact.answer;
    return { question: q.question, status: fact === null ? 'unknown' : fact.tag === 'UNKNOWN' ? 'unknown' : 'answered', answer: said, fact, flags: fact === null && q.fact_line !== null ? ['fact_line_out_of_range'] : [] };
  });
  const answered = questions.filter((q) => q.status === 'answered');
  const end = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
  return { questions, message: answered.length === 0 ? null : questions.map((q) => end(q.answer)).join(' '), call, flags: [] };
}

/** The OpenAI key from the service's .env, never printed. */
export function envKey() {
  const env = fs.readFileSync('/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env', 'utf8');
  return (env.match(/^OPENAI_API_KEY=(.*)$/m)?.[1] ?? '').replace(/["'\s]/g, '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, briefId, asksFile] = process.argv.slice(2);
  if (!file || !briefId) { console.error('usage: operator.mjs <facts-file> <brief-id> [asks.json]'); process.exit(2); }
  const asks = asksFile ? JSON.parse(fs.readFileSync(asksFile, 'utf8')) : JSON.parse(fs.readFileSync(0, 'utf8'));
  const out = await answerAsks({ facts: loadFacts(file, briefId), asks, apiKey: envKey() });
  console.log(JSON.stringify(out, null, 1));
}
