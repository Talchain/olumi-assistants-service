#!/usr/bin/env node
/**
 * OPERATOR ROW (DL 23 Oct, batch-1 score): the operator answers a reply's questions from a SYNTHETIC facts sheet by meaning,
 * and says "I don't know" only when the sheet truly lacks the fact. One live call (the operator's own model); exits 1 on a miss.
 * The sheet and the questions are synthetic (a bakery), never a test brief's or the sealed sheet's words.
 *
 *   node tools/model-program-spike/operator.row.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerAsks, answerQuestions, envKey, loadFacts } from './operator.mjs';

const sheet = [
  '=== FACTS bakery ===',
  '- When does the new oven arrive? :: It is due in the second week of March, about 10 weeks from now. [TRANSCRIPT]',
  '- What share of sales is wholesale? :: Wholesale is about 40% of our weekly sales. [TRANSCRIPT]',
  "- How many extra loaves would a second oven bake? :: Somewhere between 80 and 120 loaves a week, but that's a rough guess. [TRANSCRIPT]",
  "- What will the new rent be? :: I don't know the new rent yet. [UNKNOWN]",
  '',
].join('\n');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'operator-row-')), 'facts.md');
fs.writeFileSync(file, sheet);
const facts = loadFacts(file, 'bakery');

// Each question asked in other words than its line; the answer in another form (a delay, a share, how firm a range is).
const reply = [
  "I've built a first model. To work out the chances I need:",
  '1. How many weeks from now could the second oven start baking?',
  '2. What fraction of your sales goes to wholesale customers?',
  '3. Are 80 and 120 loaves a week firm limits, or a rough estimate?',
  '4. How much do you pay for flour each month?',
].join('\n');
const want = [1, 2, 3, null];

const out = await answerQuestions({ facts, replyText: reply, apiKey: envKey() });
// The same sheet through the structured asks: a line that answers in another form is said in its own words, never
// "I don't know"; only the question the sheet lacks is.
const asks = [
  { quantity_id: 'start', question: 'How many months from now could the second oven start baking?', unit: 'month', label: 'Months until the oven starts', feeds: ['g'] },
  { quantity_id: 'extra', question: 'Are 80 and 120 loaves a week firm limits, or a rough estimate?', unit: 'loaf/week', label: 'Extra loaves per oven', feeds: ['g'] },
  { quantity_id: 'flour', question: 'What do you pay for flour each month?', unit: 'GBP/month', label: 'Flour cost', feeds: ['g'] },
];
const fills = await answerAsks({ facts, asks, apiKey: envKey() });
const fillLines = fills.answers.map((a) => a.fact?.line ?? null);
const fillSaid = fills.answers.map((a) => a.said);
const got = out.questions.map((q) => q.fact?.line ?? null);
const statuses = out.questions.map((q) => q.status);
const okFills = fillLines[0] === 1 && fillLines[1] === 3 && fillLines[2] === null && fillSaid[0] !== "I don't know." && fillSaid[1] !== "I don't know." && fillSaid[2] === "I don't know.";
const ok = got.length === want.length && want.every((w, i) => got[i] === w) && statuses[3] === 'unknown' && statuses.slice(0, 3).every((s) => s === 'answered') && okFills;
console.log(JSON.stringify({ ok, want, got, statuses, message: out.message, fills: fills.answers.map((a) => ({ id: a.quantity_id, line: a.fact?.line ?? null, status: a.status, said: a.said, flags: a.flags })) }, null, 1));
process.exit(ok ? 0 : 1);
