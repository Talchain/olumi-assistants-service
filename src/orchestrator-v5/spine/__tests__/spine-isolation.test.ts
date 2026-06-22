/**
 * Tier 0 S1 — proof that the slice is INERT with respect to every forbidden
 * surface, and is fully unwired from production:
 *  - the spine library modules import none of the forbidden files;
 *  - they perform no telemetry / fs / persistence / Date / randomness;
 *  - the classifier is idempotent (no hidden state);
 *  - NO module outside the spine dir imports a spine module (no production wiring);
 *  - the committed sanitised fixture is leak-free.
 *
 * Together these prove no schema, wire, persistence, prompt/PMS or UI change is
 * needed for the proof slice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { classifyEnrichment } from '../claim-safety.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // …/spine/__tests__
const SPINE_DIR = join(HERE, '..'); // …/orchestrator-v5/spine
const SRC_DIR = join(SPINE_DIR, '..', '..'); // …/src
const LIB_FILES = ['claim-safety.ts', 'enrichment-scientific-view.ts', 'index.ts'];

const FIXTURE_BYTES = readFileSync(join(HERE, 'fixtures/enrichment.sanitised.json'), 'utf8');

/** Strip block and line comments so scans inspect CODE, not documentation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Extract module specifiers from import/export-from/bare-import statements only. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const fromRe = /(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/g;
  const bareRe = /\bimport\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) specs.push(m[1]);
  while ((m = bareRe.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

describe('spine library modules import no forbidden file', () => {
  const FORBIDDEN = [
    'route-v2',
    'turn-executor',
    '/context/',
    'response-finaliser',
    '/compose',
    'sanitise-enrichment',
    '@talchain/schemas',
    'orchestrator/types',
  ];

  it.each(LIB_FILES)('%s imports only within the spine slice', (file) => {
    const specs = importSpecifiers(stripComments(readFileSync(join(SPINE_DIR, file), 'utf8')));
    for (const spec of specs) {
      for (const bad of FORBIDDEN) {
        expect(spec.includes(bad), `${file} imports forbidden '${spec}'`).toBe(false);
      }
      // every import must resolve inside the spine slice (relative, no parent escape)
      expect(spec.startsWith('./'), `${file} imports non-local '${spec}'`).toBe(true);
    }
  });
});

describe('spine library modules have no side effects', () => {
  it.each(LIB_FILES)('%s contains no telemetry / fs / persistence / Date / randomness', (file) => {
    const src = stripComments(readFileSync(join(SPINE_DIR, file), 'utf8'));
    for (const token of ['emit(', 'TelemetryEvents', 'writeFileSync', 'readFileSync', "from 'fs'", 'node:fs', 'Date.now', 'new Date', 'Math.random', 'process.env']) {
      expect(src.includes(token), `${file} contains side-effect token '${token}'`).toBe(false);
    }
  });
});

describe('classifier is pure / idempotent (no persistence, no hidden state)', () => {
  it('classifying the same enrichment twice yields a deep-equal result', () => {
    const enrichment = JSON.parse(FIXTURE_BYTES) as Record<string, unknown>;
    expect(classifyEnrichment(enrichment)).toEqual(classifyEnrichment(enrichment));
  });
});

describe('no production import of spine modules', () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === SPINE_DIR) continue; // the spine dir itself may self-import
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        out.push(...walk(full));
      } else if (entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  it('no .ts under src/ outside the spine dir imports a spine module', () => {
    const offenders: string[] = [];
    const re = /(?:from|import)\s*\(?\s*['"]([^'"]*spine[^'"]*)['"]/g;
    for (const file of walk(SRC_DIR)) {
      const src = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        offenders.push(`${relative(SRC_DIR, file)} → ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('sanitised fixture leak guard', () => {
  it('contains no live request id, hash, node ids, or real labels', () => {
    const banned = [
      '6f9286d6',
      'ef1aeb36',
      'opt_hire_local',
      'opt_offshore',
      'opt_status_quo',
      'opt_tiered_pricing',
      'Hire Two Senior',
      'Offshore Partner',
      'Status Quo',
      'Tiered Pricing',
    ];
    for (const token of banned) {
      expect(FIXTURE_BYTES.includes(token), `leaked: ${token}`).toBe(false);
    }
  });

  it('contains no UUID other than the all-zero placeholder', () => {
    const uuids = FIXTURE_BYTES.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g) ?? [];
    for (const u of uuids) expect(u).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('contains no 16-hex hash other than zeroes', () => {
    const hashes = FIXTURE_BYTES.match(/"[0-9a-f]{16}"/g) ?? [];
    for (const h of hashes) expect(h).toBe('"0000000000000000"');
  });
});
