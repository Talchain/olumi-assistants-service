#!/usr/bin/env node
/**
 * make-candidate-store — derive a CANDIDATE arm prompt store from an already-built
 * BASELINE store by swapping ONE PMS task's served content for a candidate file.
 *
 * This is the A/B swap primitive (ROADMAP 1.70 v1). It reuses the hermetic-arm
 * substrate: build-stores.py builds the baseline (staging mirror), this script
 * derives the candidate as a PURE JSON patch, and pms-file-shim.mjs boots each
 * store into a local CEE with ZERO PMS writes. Deriving the candidate by patch
 * (rather than re-running build-stores.py with a swap) guarantees the candidate
 * is BYTE-IDENTICAL to the baseline everywhere except the one swapped task — the
 * only fair basis for an A/B. It also needs NO Supabase creds and is
 * deterministic (no second staging fetch that could drift mid-experiment).
 *
 * The task is matched by store key OR by the entry's taskId, so both prompt-id
 * names (e.g. "orchestrator_default") and task names (e.g. "decision_review",
 * "clarify_brief") resolve. The candidate content is stored as the SERVED
 * version (activeVersion == stagingVersion), so the file store serves it.
 *
 * Prints the swapped task, the baseline vs candidate served content hash, and
 * the expected ON-WIRE prompt_hash (sha256[:16] of normalized content — same
 * normalization build-stores.py prints) so the operator can confirm identity
 * against the run manifest's sent_hash. NEVER prints prompt CONTENT.
 *
 * Usage:
 *   node make-candidate-store.mjs \
 *     --baseline stores/staging-mirror.json \
 *     --task decision_review \
 *     --candidate candidates/decision_review.v43.txt \
 *     [--out stores/cand-decision_review.json] [--version <N>]
 *
 * Module: import { patchStore, expectedSentHash } from './make-candidate-store.mjs'
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

/** Normalize prompt content the way the served prompt is hashed on the wire:
 * CRLF->LF, strip per-line trailing whitespace, trim the whole string. Mirrors
 * build-stores.py's "expected sent prompt_hash" normalization so the printed
 * hash lines up with the run manifest's sent_hash. */
export function normalizeContent(content) {
  const t = String(content).replace(/\r\n/g, '\n');
  return t
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

export function expectedSentHash(content) {
  return createHash('sha256').update(normalizeContent(content)).digest('hex').slice(0, 16);
}

/** sha256[:16] of the RAW served content (store-level identity, not wire-normalized). */
function rawContentHash(content) {
  return createHash('sha256').update(String(content)).digest('hex').slice(0, 16);
}

/** Find the store-prompt entry whose key === task OR whose .taskId === task. */
export function findEntryKey(store, task) {
  const prompts = store?.prompts ?? {};
  if (Object.prototype.hasOwnProperty.call(prompts, task)) return task;
  const byTaskId = Object.keys(prompts).find((k) => prompts[k]?.taskId === task);
  if (byTaskId) return byTaskId;
  return null;
}

/**
 * Pure patch: return a NEW store object with `task`'s served version content
 * replaced by `content`. Everything else (all other prompts, all other version
 * rows) is left structurally identical. Throws if the task is not found or the
 * entry has no served version to replace.
 *
 * @param {object} store    parsed baseline store JSON
 * @param {string} task     store key or taskId to swap
 * @param {string} content  candidate prompt content
 * @param {number|null} version  optional override for the served version number
 * @returns {{ store: object, key: string, servedVersion: number,
 *            baselineContent: string }}
 */
export function patchStore(store, task, content, version = null) {
  const key = findEntryKey(store, task);
  if (!key) {
    const available = Object.keys(store?.prompts ?? {}).join(', ');
    throw new Error(`task "${task}" not found in store (available: ${available})`);
  }
  // Deep clone so the caller's baseline is never mutated (fair-A/B invariant).
  const next = JSON.parse(JSON.stringify(store));
  const entry = next.prompts[key];
  const served = entry.stagingVersion ?? entry.activeVersion;
  if (served == null) throw new Error(`entry "${key}" has no served version (activeVersion/stagingVersion)`);
  const baselineRow = (entry.versions ?? []).find((v) => v.version === served);
  const baselineContent = baselineRow?.content ?? '';
  const outVersion = version == null ? served : version;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  // Replace the SERVED row only; the file store serves activeVersion/stagingVersion.
  entry.versions = [
    {
      version: outVersion,
      content,
      createdBy: 'prompt-eval-candidate',
      createdAt: now,
      changeNote: 'A/B candidate (local file store, never uploaded to PMS)',
    },
  ];
  entry.activeVersion = outVersion;
  entry.stagingVersion = outVersion;
  entry.updatedAt = now;
  next.lastModified = now;
  return { store: next, key, servedVersion: outVersion, baselineContent };
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
    }
  }
  const HERE = dirname(fileURLToPath(import.meta.url));
  const baseline = args.baseline ?? join(HERE, '..', 'stores', 'staging-mirror.json');
  if (!args.task || !args.candidate) {
    console.error(
      'usage: node make-candidate-store.mjs --baseline <store.json> --task <id|taskId> ' +
        '--candidate <content-file> [--out <store.json>] [--version <N>]',
    );
    process.exit(1);
  }
  const store = JSON.parse(readFileSync(resolve(baseline), 'utf-8'));
  const content = readFileSync(resolve(args.candidate), 'utf-8');
  const version = args.version != null && args.version !== true ? Number(args.version) : null;
  const { store: patched, key, servedVersion, baselineContent } = patchStore(store, args.task, content, version);

  const out = resolve(args.out ?? join(HERE, '..', 'stores', `cand-${key}.json`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(patched, null, 1));

  const baselineHash = rawContentHash(baselineContent);
  const candidateHash = rawContentHash(content);
  console.log(`candidate store written -> ${out}`);
  console.log(`swapped task: ${key} (served version v${servedVersion})`);
  console.log(`baseline served content sha16:  ${baselineHash} (${baselineContent.length} chars)`);
  console.log(`candidate served content sha16: ${candidateHash} (${content.length} chars)`);
  if (baselineHash === candidateHash) {
    console.log('WARNING: candidate content is IDENTICAL to baseline — the A/B would measure only noise.');
  }
  console.log(`expected on-wire prompt_hash (candidate): ${expectedSentHash(content)}`);
  console.log('  ^ confirm this against the candidate run manifest.json cee.prompts[<task>].sent_hash');
}
