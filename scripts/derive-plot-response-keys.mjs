#!/usr/bin/env node
/**
 * Derive PLoT's `RunResponseV3` top-level key set from the producer's own
 * source, so CEE's `ENRICHMENT_PRODUCER_MANIFEST` can be checked against the
 * thing it mirrors instead of against someone's memory.
 *
 * WHY THIS IS A SCRIPT AND NOT A COMMENT. It started as a one-liner pasted into
 * the manifest's header. That is worse in two ways and one of them is funny: a
 * command in a comment cannot be run without un-escaping it by hand, and this
 * particular one contains the token that ends a block comment, so it silently
 * broke the file it was documenting. A derivation you cannot execute is a
 * derivation nobody will execute.
 *
 * USAGE
 *
 *   node scripts/derive-plot-response-keys.mjs <path-to-plot-lite-service-checkout>
 *
 * Prints the tip sha, the key count, and the sorted keys as a paste-ready TS
 * literal for `PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS`
 * (src/orchestrator-v5/context/enrichment-manifest.ts), plus the diff against
 * the manifest currently in this repo.
 *
 * SCOPE, precisely: it reads the `RunResponseV3` interface declaration — the
 * response TYPE — not the assembler. A key declared but never assigned would be
 * listed here; a key spread in without a declaration would not. PLoT's own
 * OpenAPI drift gate is what keeps those two in step on its side, and its
 * `islEnrichmentPassthrough` requires every forwarded key to be a declared
 * `runResponseV3` property. Stated so nobody reads this as "what PLoT sends".
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const plotRoot = process.argv[2];
if (!plotRoot) {
  console.error('usage: node scripts/derive-plot-response-keys.mjs <path-to-plot-checkout>');
  process.exit(2);
}

const enginePath = join(plotRoot, 'src/types/engine-v3.ts');
const source = readFileSync(enginePath, 'utf8');

const declIndex = source.indexOf('export interface RunResponseV3');
if (declIndex === -1) {
  console.error(`RunResponseV3 not found in ${enginePath} — has PLoT renamed it?`);
  process.exit(1);
}

// Walk to the matching close brace rather than regexing the whole interface:
// nested object literals in the declaration would break a naive match.
const open = source.indexOf('{', declIndex);
let depth = 0;
let close = -1;
for (let i = open; i < source.length; i += 1) {
  if (source[i] === '{') depth += 1;
  else if (source[i] === '}') {
    depth -= 1;
    if (depth === 0) {
      close = i;
      break;
    }
  }
}
if (close === -1) {
  console.error('unbalanced braces in the RunResponseV3 declaration');
  process.exit(1);
}

const body = source
  .slice(open + 1, close)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const keys = [];
let nesting = 0;
for (const line of body.split('\n')) {
  if (nesting === 0) {
    const match = line.trim().match(/^([A-Za-z_]\w*)\??\s*:/);
    if (match) keys.push(match[1]);
  }
  const opens = (line.match(/[{[(]/g) ?? []).length;
  const closes = (line.match(/[}\])]/g) ?? []).length;
  nesting += opens - closes;
}
keys.sort();

let tip = '(unknown)';
try {
  tip = execFileSync('git', ['-C', plotRoot, 'rev-parse', '--short=8', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch {
  // A tarball or export with no git dir is still worth deriving from.
}

console.log(`PLoT tip:      ${tip}`);
console.log(`RunResponseV3: ${keys.length} top-level keys\n`);
console.log(keys.map((k) => `  '${k}',`).join('\n'));

// Diff against this repo's manifest, both directions — the whole point.
const manifestSource = readFileSync(
  new URL('../src/orchestrator-v5/context/enrichment-manifest.ts', import.meta.url),
  'utf8',
);
const manifestStart = manifestSource.indexOf('export const ENRICHMENT_PRODUCER_MANIFEST');
const listStart = manifestSource.indexOf('[', manifestStart);
let listDepth = 0;
let listEnd = -1;
for (let i = listStart; i < manifestSource.length; i += 1) {
  if (manifestSource[i] === '[') listDepth += 1;
  else if (manifestSource[i] === ']') {
    listDepth -= 1;
    if (listDepth === 0) {
      listEnd = i;
      break;
    }
  }
}
const manifest = new Set(
  [...manifestSource.slice(listStart, listEnd).matchAll(/'([A-Za-z_]\w*)'/g)].map((m) => m[1]),
);
const CEE_INJECTED = new Set([
  'decision_review',
  'coaching_signal_id',
  'coaching_signal_turn_id',
  'coaching_signal_produced_at',
  '_diagnostics',
]);
const LEGACY_V1_ONLY = new Set(['results']);

const unmanifested = keys.filter((k) => !manifest.has(k));
const phantom = [...manifest].filter(
  (k) => !CEE_INJECTED.has(k) && !LEGACY_V1_ONLY.has(k) && !keys.includes(k),
);

console.log('\n--- vs ENRICHMENT_PRODUCER_MANIFEST in this checkout ---');
console.log(`  PLoT emits, CEE does not manifest : ${unmanifested.join(', ') || '(none)'}`);
console.log(`  CEE manifests, PLoT does not emit : ${phantom.join(', ') || '(none)'}`);
if (unmanifested.length > 0) {
  console.log(
    '\n  Each unmanifested key fires v5.enrichment.unknown_producer_key on every\n' +
      '  analysis body carrying it. Add the manifest row + a deriver or an explicit\n' +
      '  skip reason. Do NOT add it to the UI transport keep-list without a schemas\n' +
      '  contract and a withheld-claim ruling.',
  );
}
process.exitCode = unmanifested.length > 0 || phantom.length > 0 ? 1 : 0;
