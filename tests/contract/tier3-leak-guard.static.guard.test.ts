/**
 * Tier-3 leak guard — Part A static source-tree scan (Brief 5 §5a).
 *
 * Walks the V5 user-facing string-PRODUCER directories (compose /
 * coaching / routing / tools-handlers) and asserts the four RATIFIED
 * Tier-3 deny keys (`claim-safety-cage.ts`) appear ONLY in the
 * allow-listed files — each a classified transport / structured-read /
 * cage site. A new producer file that starts referencing a Tier-3 key
 * fails this gate and forces a claim-safety review, exactly like the
 * `context-summary-diagnostic-only.guard.test.ts` mechanic this
 * re-uses.
 *
 * Producer-scoped, not whole-tree (Brief 5 §5a): unlike the diagnostic
 * tokens, several Tier-3 wire keys legitimately appear in transport and
 * structured-read code — the scan therefore covers the directories that
 * BUILD user-facing strings, with a per-file classification, plus a
 * stale-allow-list check so dead entries cannot rot in place.
 *
 * Auto-enrols in the required CI gate ("Lint, TypeCheck, Unit Tests") by
 * living under tests/contract/ — no workflow surgery (Brief 5 §14).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { stripCommentsFile } from '../../scripts/ci/strip-source-comments.mjs';
import { TIER3_LEAK_BLOCK_FIELDS } from '../../src/orchestrator-v5/compose/claim-safety-cage.js';

const V5_ROOT = fileURLToPath(new URL('../../src/orchestrator-v5', import.meta.url));

/** The user-facing string-producer directories, relative to src/orchestrator-v5. */
const PRODUCER_DIRS = ['compose', 'coaching', 'routing', 'tools/handlers'] as const;

/**
 * Root-level orchestrator-v5 files are ALSO scanned (non-recursive):
 * compose.ts and response-finaliser.ts are the transport keep-list and
 * the wire backstop — the two seams a new Tier-3 reference would most
 * plausibly land in unnoticed (adversarial-review widening).
 */
const SCAN_ROOT_FILES = true;

/**
 * Files allowed to reference a ratified Tier-3 key in CODE, relative to
 * src/orchestrator-v5, each with its classification:
 *   cage        — the claim-safety cage itself / the suppression site
 *   transport   — structured normaliser / adapter; no prose passthrough
 *   structured  — reads the field as a STRUCTURED signal (never quotes
 *                 its values into prose; sanctioned pre-Brief-5 surface,
 *                 escalation of its claim posture is Brief 4 §9's lane)
 *
 * The scan matches the COMMENT-STRIPPED view of each file
 * (scripts/ci/strip-source-comments.mjs, the shared literal-aware
 * tokeniser), so a comment naming a Tier-3 key — documentation, not
 * consumption — never trips the guard and never needs an entry here. The
 * former 'doc' classification is retired for exactly that reason, and
 * files whose mentions were comment-only (coaching/types.ts,
 * coaching/pick-flip-summary.ts, tools/handlers/explanation-fallback.ts,
 * response-finaliser.ts — its deny-list lives in claim-safety-cage
 * imports, not key literals) have left the list; the stale-entry check
 * below forces that pruning to stay honest.
 */
const ALLOWLIST = new Map<string, 'cage' | 'transport' | 'structured'>([
  ['compose/claim-safety-cage.ts', 'cage'],
  ['compose/sanitise-enrichment.ts', 'cage'],
  // flip-proposal + phase3-blocks DO feed user-facing surfaces (the P0.2
  // "Test X at N" proposal chip; flip_threshold/bias review cards behind
  // the decision-review autofire flag). They are PRE-EXISTING, reviewed
  // surfaces that read Tier-3 fields as structured data — their claim
  // posture is the Brief 4 §9 escalation lane, not this guard's, which
  // only prevents NEW unreviewed sites.
  ['compose/flip-proposal.ts', 'structured'],
  ['compose/phase3-blocks.ts', 'structured'],
  ['coaching/decision-review-enricher.ts', 'transport'],
  // ROADMAP 2.989 (wave-1 Lane A) — the fragile-edge selector JOINS
  // `robustness.fragile_edges` against `edge_e_values` on (from_id,to_id) and
  // gates on that row's 10-seed stability band. Classified `structured` for the
  // reason the classification exists: every quantity it reads from the Tier-3
  // field (`e_value`, `current_mean`, `flip_mean`, `flip_direction`, the band)
  // is used ONLY as a gate and NONE of them is carried on its return type, so
  // no caller can surface one. Its offer copy is number-free by ruling — see
  // `lens-selector.ts::BODY_BY_RATIONALE.FRAGILE_EDGE_RESOLVABLE`.
  ['coaching/select-fragile-edge.ts', 'structured'],
  ['routing/post-analysis-advice-gate.ts', 'structured'],
  // Root-level seams (non-recursive root scan):
  ['compose.ts', 'transport'],
]);

const TIER3_PATTERN = new RegExp(TIER3_LEAK_BLOCK_FIELDS.join('|'));

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__') continue;
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function producerFiles(): Array<{ rel: string; source: string }> {
  const files: Array<{ rel: string; source: string }> = [];
  for (const dir of PRODUCER_DIRS) {
    for (const abs of walkTsFiles(join(V5_ROOT, dir))) {
      files.push({
        rel: relative(V5_ROOT, abs).split('\\').join('/'),
        source: stripCommentsFile(abs),
      });
    }
  }
  if (SCAN_ROOT_FILES) {
    for (const entry of readdirSync(V5_ROOT)) {
      const full = join(V5_ROOT, entry);
      if (!statSync(full).isFile()) continue;
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts') || entry.endsWith('.test.ts')) continue;
      files.push({ rel: entry, source: stripCommentsFile(full) });
    }
  }
  return files;
}

describe('Tier-3 leak guard — static producer scan (Brief 5 Part A)', () => {
  const files = producerFiles();

  it('scans a real producer population (non-vacuous)', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('ratified Tier-3 keys appear only in allow-listed, classified files', () => {
    for (const { rel, source } of files) {
      if (!TIER3_PATTERN.test(source)) continue;
      expect(
        ALLOWLIST.has(rel),
        `${rel}: references a ratified Tier-3 deny key (${TIER3_LEAK_BLOCK_FIELDS.join(', ')}) but is not an ` +
          `allow-listed transport/structured/cage site. A user-facing string producer must not consume Tier-3 ` +
          `fields — consult isClaimUsable (claim-safety-cage.ts) and take the addition through claim-safety ` +
          `review (Brief 4 §9) before allow-listing it here with a classification.`,
      ).toBe(true);
    }
  });

  it('the allow-list is not stale — every entry still exists and still mentions a Tier-3 key', () => {
    const byRel = new Map(files.map((f) => [f.rel, f.source]));
    for (const [rel] of ALLOWLIST) {
      const source = byRel.get(rel);
      expect(source, `${rel}: allow-listed but no longer exists in the producer scan scope — remove the entry`).toBeDefined();
      expect(
        TIER3_PATTERN.test(source!),
        `${rel}: allow-listed but no longer mentions any Tier-3 key — remove the stale entry`,
      ).toBe(true);
    }
  });
});
