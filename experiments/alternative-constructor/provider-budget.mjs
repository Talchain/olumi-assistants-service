/** One durable provider budget shared by all experimental arms, retries and model screens. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export function readAttempts(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.event === 'attempt_started');
}
export function acquireProviderQueue(ledger, metadata = {}) {
  const lock = `${ledger}.lock`;
  mkdirSync(dirname(ledger), { recursive: true });
  try { mkdirSync(lock); } catch { throw new Error(`Provider queue is already held at ${lock}; inspect the owner before removing a stale lock`); }
  writeFileSync(`${lock}/owner.json`, JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString(), ...metadata }));
  let released = false;
  return () => { if (!released) { rmSync(lock, { recursive: true }); released = true; } };
}
export function reserveAttempt(ledger, metadata = {}, limit = 60) {
  if (!existsSync(`${ledger}.lock`)) throw new Error('Provider attempts require the exclusive queue lock');
  if (!Number.isInteger(limit) || limit < 1 || limit > 60) throw new Error('Experiment attempt limit must be 1..60');
  const prior = readAttempts(ledger);
  if (prior.length >= limit) throw new Error(`Shared provider attempt ceiling reached (${prior.length}/${limit}); no network request sent`);
  const row = { event: 'attempt_started', attempt_id: randomUUID(), attempt_number: prior.length + 1, at: new Date().toISOString(), ...metadata };
  appendFileSync(ledger, `${JSON.stringify(row)}\n`);
  return row;
}
export function finishAttempt(ledger, attempt, result) {
  appendFileSync(ledger, `${JSON.stringify({ event: 'attempt_finished', attempt_id: attempt.attempt_id, at: new Date().toISOString(), ...result })}\n`);
}
