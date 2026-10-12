/**
 * ⭐ ONE PROVENANCE AUTHORITY — THE SHRINK-ONLY RATCHET (Recovery Batch C; DL 12 Oct item 4 and AMEND).
 *
 * No production file other than `cee/provenance/provenance-of.ts` compares an authorship field (`source`,
 * `extractionType`, `magnitude`, `provenance_source`) with an authorship literal, or calls the stamp-only
 * `classifyValueSource`, EXCEPT the sites listed below — each with its category, reviewed by hand. A regression aid only:
 * `provenance-agreement.test.ts` is the proof that the readers agree.
 *
 * THE RULE (DL AMEND): every reader whose answer reaches what the person or the Agent is told, or a decision that licenses,
 * withholds, refuses or labels a result, is ROUTED (it asks the authority) — so ZERO entries here are "authorship,
 * deferred" with `feeds` other than 'neither'. The categories that remain:
 *   · writer           — constructs or rewrites a provenance record (the writer owns its own stamp);
 *   · writer-readback  — verifies a write landed with its own writer's exact stamp (identity of the write, not whose);
 *   · pipeline         — draft extraction / enrichment / figure adoption before the model is admitted;
 *   · different-field  — not value/setting/link authorship (a unit reading's `source`, a spread's `spread_source`, a
 *                        tool parameter's `source`, a goal threshold's `threshold_source`);
 *   · ladder-class     — compares the authority's own ladder answer (`user_stated` / `user_ratified`), not a stamp;
 *   · hard-limit       — `runtime/build-model.ts`, which this batch may never touch (listed for the DL to rule on).
 *   · role not expressible by provenanceOf — a role the authority has no answer for (it has no `cee_inference`-only
 *                        role; routing broadens it to every AI origin). Independent check delta on 48ac90fa.
 *   · draft-time       — asks WHEN a figure entered (in the draft, or after it), not WHOSE it is; the authority answers
 *                        whose (DL ruling (i), 12 Oct, Batch B × C merge).
 * Shrink-only: a count may only fall, and when it does the entry is lowered in the same change.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Category = 'writer' | 'writer-readback' | 'pipeline' | 'different-field' | 'ladder-class' | 'hard-limit' | 'draft-time' | 'role not expressible by provenanceOf' | 'authorship, deferred';
interface Entry {
  readonly categories: Partial<Record<Category, number>>;
  /** What the remaining reads feed. 'neither' = not what the person/Agent is told and no licence/withhold/refuse/label. */
  readonly feeds: 'neither' | 'told' | 'decision';
  readonly note: string;
}

const RATCHET: Readonly<Record<string, Entry>> = {
  'src/cee/context-integrity/not-modelled-manifest.ts': { categories: { 'writer-readback': 1, 'different-field': 1 }, feeds: 'neither',
    note: "835: the user-write receipt literal table (USER_WRITE_RECEIPT); 1557: a unit reading's source" },
  'src/cee/draft/records/completion.ts': { categories: { pipeline: 1 }, feeds: 'neither',
    note: "558: draft completion's overwrite exemption for a cee_hypothesis option magnitude (camelCase local, caught by the widened probe)" },
  'src/cee/extraction/intervention-extractor.ts': { categories: { pipeline: 1 }, feeds: 'neither', note: 'draft binding of a stated figure' },
  'src/cee/factor-extraction/enricher.ts': { categories: { pipeline: 2 }, feeds: 'neither', note: 'factor enricher before admission' },
  'src/cee/factor-extraction/index.ts': { categories: { pipeline: 3 }, feeds: 'neither', note: 'extraction-type telemetry counts' },
  'src/cee/magnitude/frame-defaulted-links.ts': { categories: { writer: 4, 'different-field': 1 }, feeds: 'neither',
    note: 'frame-default re-derivation writer (its own placeholder tag); 92: a unit reading' },
  'src/cee/magnitude/link-sizing.ts': { categories: { writer: 2 }, feeds: 'neither', note: 'sizedByApproval: the approval writer keeps the drawing carrier' },
  'src/cee/provenance/factor-value-provenance.ts': { categories: { pipeline: 1 }, feeds: 'neither', note: 'value tier: the inferred DEFAULT value, not whose' },
  'src/cee/provenance/money-invariant.ts': { categories: { pipeline: 1 }, feeds: 'neither', note: 'draft money invariant over brief-stamped figures' },
  'src/cee/transforms/analysis-ready.ts': { categories: { pipeline: 2 }, feeds: 'neither', note: 'binding a stated option magnitude into the run input' },
  'src/cee/transforms/schema-v2.ts': { categories: { writer: 1 }, feeds: 'neither',
    note: 'V2 writer (DL 12 Oct, BLOCKING 2): stamps source from the extraction type it now keeps (inferred → cee_inference)' },
  'src/cee/transforms/schema-v3.ts': { categories: { writer: 6 }, feeds: 'neither', note: 'V1→V3 writer: stamps source from extraction type; withdraws an unearned brief claim' },
  'src/cee/transforms/stated-option-figure-adoption.ts': { categories: { pipeline: 1 }, feeds: 'neither', note: 'draft adoption of a brief figure' },
  'src/cee/transforms/value-uncertainty-derivation.ts': { categories: { pipeline: 1 }, feeds: 'neither', note: "a range value's spread (value kind, not whose)" },
  'src/orchestrator-v5/admission/identity-evaluations.ts': { categories: { 'ladder-class': 1 }, feeds: 'neither', note: 'compares valueClassOf output' },
  'src/orchestrator-v5/agent-lane/accumulation-rate-spread.ts': { categories: { 'ladder-class': 1 }, feeds: 'neither', note: 'compares valueClassOf output' },
  'src/orchestrator-v5/agent-lane/admit-candidate.ts': { categories: { writer: 2 }, feeds: 'neither',
    note: "admission writer (288: the estimate basis door on its own sizing's olumi_estimate — camelCase local)" },
  'src/orchestrator-v5/agent-lane/admit-model.ts': { categories: { writer: 5 }, feeds: 'neither', note: 'admission writer: candidate link stamps (provenance_source) and value confidence' },
  'src/orchestrator-v5/agent-lane/approval-chips.ts': { categories: { 'different-field': 1 }, feeds: 'neither', note: 'a unit reading' },
  'src/orchestrator-v5/agent-lane/ceiling-stock.ts': { categories: { 'different-field': 1, 'writer-readback': 1 }, feeds: 'neither',
    note: "84: a goal threshold's threshold_source; 209: the identity confirm writer's user_confirmed on the net zero" },
  'src/orchestrator-v5/agent-lane/construction-size-gate.ts': { categories: { writer: 1 }, feeds: 'neither', note: 'construction sizing gate (admission)' },
  'src/orchestrator-v5/agent-lane/goal-current-level.ts': { categories: { 'different-field': 2, 'writer-readback': 2 }, feeds: 'neither',
    note: "709/1332: a unit reading; 897/1140: idempotency against the level writer's own USER_EDIT_SOURCE" },
  'src/orchestrator-v5/agent-lane/identity-proposal.ts': { categories: { 'writer-readback': 1 }, feeds: 'neither', note: "the identity confirm writer's user_confirmed" },
  'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts': { categories: { 'different-field': 1, 'writer-readback': 8 }, feeds: 'neither',
    note: '1726: a unit reading; the rest verify a committed write carries its own writer’s stamp' },
  'src/orchestrator-v5/agent-lane/runtime/build-model.ts': { categories: { 'hard-limit': 2, 'different-field': 1 }, feeds: 'decision',
    note: "HARD LIMIT (never touched by this batch): 1621/2375 read magnitude 'user_stated' (a narrower question than linkProvenanceOf: always its human); 2195 a unit reading" },
  'src/orchestrator-v5/agent-lane/runtime/draft-replacement.ts': { categories: { 'draft-time': 1 }, feeds: 'decision',
    note: "101 (DL ruling (i), 12 Oct): asks whether a size was set AFTER the draft; provenanceOf answers whose, and routing it would refuse lossless revised drafts (parity rows pin it: provenance-routing-parity.test.ts)" },
  'src/orchestrator-v5/agent-lane/runtime/widen-draft.ts': { categories: { 'writer-readback': 1 }, feeds: 'neither', note: 'verifies the widen writer’s own estimate stamp' },
  'src/orchestrator-v5/agent-lane/stated-by-user.ts': { categories: { writer: 1 }, feeds: 'neither', note: 'withdraws brief stamps the brief does not support' },
  'src/orchestrator-v5/goal-target/goal-chance-driver.ts': { categories: { 'different-field': 1 }, feeds: 'neither', note: "ISL spread_source" },
  'src/orchestrator-v5/goal-target/goal-horizon-detail.ts': { categories: { 'ladder-class': 1 }, feeds: 'neither', note: 'compares valueClassOf output' },
  'src/orchestrator-v5/routing/add-factor-transaction.ts': { categories: { 'writer-readback': 1, 'role not expressible by provenanceOf': 1 }, feeds: 'told',
    note: "stated-today shape of its own write; levelRangePointBasis's olumis (cee_inference, not user-material): provenanceOf has no cee_inference-only role and routing broadened it to every AI origin (recovery/bB/check-B-cee/CHECK-delta.md: raw 20, source 'inferred', brief range 10–30 became 'midpoint')" },
  'src/orchestrator-v5/routing/add-option-transaction.ts': { categories: { 'writer-readback': 2 }, feeds: 'neither',
    note: "stated-today shape of its own write: its stamp, and the door's own `explicit` attestation (DL 12 Oct)" },
  'src/orchestrator-v5/routing/tool-schema.ts': { categories: { 'different-field': 1 }, feeds: 'neither', note: "a tool parameter's source" },
  'src/orchestrator-v5/system-events/edge-strength-edit.ts': { categories: { writer: 1 }, feeds: 'neither', note: 'edge strength writer' },
  'src/orchestrator-v5/system-events/link-effect-edit.ts': { categories: { 'different-field': 1 }, feeds: 'neither', note: 'a unit reading' },
  'src/orchestrator-v5/system-events/option-intervention-edit.ts': { categories: { 'different-field': 1, 'writer-readback': 1 }, feeds: 'neither',
    note: '658: a unit reading; 1570: unchanged-range detection against its own writer’s stamp' },
  'src/orchestrator-v5/tools/handlers/run-input-residual.ts': { categories: { 'writer-readback': 3 }, feeds: 'neither', note: 'run-input integrity against the value writers’ own literals' },
  'src/orchestrator/canonicalise-value-ops.ts': { categories: { writer: 2 }, feeds: 'neither', note: 'value op canonicalisation (writer)' },
  'src/orchestrator/context/intake-option-reconciliation.ts': { categories: { pipeline: 1 }, feeds: 'neither', note: 'intake option quotes' },
  'src/orchestrator/context/placeholder-parts.ts': { categories: { 'different-field': 1 }, feeds: 'neither', note: 'a unit reading' },
};

const AUTHORITY = 'src/cee/provenance/provenance-of.ts';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LIT = ['brief_extraction', 'cee_inference', 'explicit', 'inferred', 'observed', 'range', 'cee_repair', 'user', 'user_override',
  'user_confirmed', 'user_edited', 'user_calibration', 'user_assumption', 'panel_elicited', 'user_specified', 'cee_hypothesis',
  'domain_knowledge', 'user_stated', 'olumi_estimate', 'olumi_placeholder', 'olumi_accepted', 'example_figure'].join('|');
const F = '(?:source|extractionType|magnitude|provenance_source)';
const PATTERNS = [
  new RegExp(`\\b${F}\\s*[!=]==?\\s*['"](?:${LIT})['"]`, 'g'),
  new RegExp(`['"](?:${LIT})['"]\\s*[!=]==?\\s*[\\w?.!\\]\\[]*\\b${F}\\b`, 'g'),
  /\bsource\??\.startsWith\(\s*['"]user/g,
  new RegExp(`\\b${F}\\s*[!=]==?\\s*[A-Z][A-Z0-9_]*_(?:SOURCE|MAGNITUDE)\\b`, 'g'),
  /\bclassifyValueSource\(/g,
  // A stamp held in a camelCase local (`rawSource`, `magnitudeSource`, `estimateMagnitude`): the compact edge display hid here.
  new RegExp(`\\b[a-z]\\w*(?:Source|Magnitude)\\s*[!=]==?\\s*['"](?:${LIT})['"]`, 'g'),
];
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const countIn = (text: string): number => PATTERNS.reduce((n, re) => n + (strip(text).match(re) ?? []).length, 0);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') yield* walk(p);
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) yield p;
  }
}

describe('ONE PROVENANCE AUTHORITY — no reader outside the authority interprets the strings (shrink-only)', () => {
  const found = new Map<string, number>();
  for (const p of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, p).split('\\').join('/');
    if (rel === AUTHORITY) continue;
    const n = countIn(readFileSync(p, 'utf8'));
    if (n > 0) found.set(rel, n);
  }

  it('the probe sees the strings (contrast control: the authority itself holds them)', () => {
    expect(countIn(readFileSync(join(ROOT, AUTHORITY), 'utf8'))).toBeGreaterThanOrEqual(10);
    expect(found.size).toBeGreaterThan(0);
  });

  it('every remaining site is listed, with its count exact (lower the entry when a site is routed)', () => {
    const counts = Object.fromEntries([...found].sort());
    const listed = Object.fromEntries(Object.entries(RATCHET).map(([f, e]) => [f, Object.values(e.categories).reduce((a, b) => a + (b ?? 0), 0)]).sort());
    expect(counts).toEqual(listed);
  });

  it('ZERO "authorship, deferred" entries feed what is told or a decision (DL AMEND)', () => {
    const offending = Object.entries(RATCHET).filter(([, e]) => (e.categories['authorship, deferred'] ?? 0) > 0 && e.feeds !== 'neither');
    expect(offending).toEqual([]);
  });

  it('only the hard-limit file may feed a decision, and only through its hard-limit reads', () => {
    const feeding = Object.entries(RATCHET).filter(([, e]) => e.feeds !== 'neither').map(([f]) => f);
    // DL ruling (i), 12 Oct: draft-replacement's ONE draft-time read (when, not whose) gates G1's refusal; named, not a pattern.
    // DL ruling on the delta check (12 Oct): add-factor-transaction's one cee_inference-only read feeds what the Agent is told (the point).
    expect(feeding).toEqual(['src/orchestrator-v5/agent-lane/runtime/build-model.ts', 'src/orchestrator-v5/agent-lane/runtime/draft-replacement.ts', 'src/orchestrator-v5/routing/add-factor-transaction.ts']);
  });
});
