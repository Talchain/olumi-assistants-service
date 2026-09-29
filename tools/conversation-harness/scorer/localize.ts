/**
 * Localization reporter v0 (conversation-harness).
 *
 * For each failing/advisory dim in scores.json, emits WHICH capture layers
 * existed for this run and the layer verdict where one is derivable from those
 * captures alone. The full decision tree is v1 scope — v0 is deliberately
 * honest about what it CANNOT localize: an uncaptured layer is UNMEASURABLE,
 * never green.
 *
 * Capture layers (v0):
 *   wire    — full response envelope per turn (always captured by runner.mjs)
 *   trace   — _diagnostic_trace when the server emitted it
 *   l0-db   — DB ground truth snapshots (only with --l0)
 *   display — UI rendering layer: NOT captured in v0 (no browser in this
 *             harness); anything that requires it is UNMEASURABLE here.
 *
 * Usage: RUN_DIR=runs/<arm> pnpm exec tsx tools/conversation-harness/scorer/localize.ts
 * Writes localization.json + localization.md into the run dir.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DimResult } from './dims.js';

const RUN = process.env.RUN_DIR;
if (!RUN) throw new Error('set RUN_DIR=<runs/arm dir>');

const scoresPath = join(RUN, 'scores.json');
if (!existsSync(scoresPath)) throw new Error(`no scores.json in ${RUN} — run score-run.ts first`);
const scores = JSON.parse(readFileSync(scoresPath, 'utf-8')) as { rows: any[]; dims: DimResult[] };

const layers = {
  wire: existsSync(join(RUN, 'turns')) || scores.rows.some((r) => r.http_ok),
  trace: existsSync(join(RUN, 'turns'))
    ? readdirSync(join(RUN, 'turns')).some((d) => existsSync(join(RUN, 'turns', d, 'trace.json')))
    : scores.rows.some((r) => r.exit_path != null),
  l0_db: existsSync(join(RUN, 'l0')) && readdirSync(join(RUN, 'l0')).length > 0,
  display: false, // v0 never captures the UI layer
  manifest: existsSync(join(RUN, 'manifest.json')),
};

interface Localization {
  dim: string;
  verdict: string;
  layer_verdicts: Record<string, string>;
  conclusion: string;
}

function localizeDim(d: DimResult): Localization {
  const lv: Record<string, string> = {};
  let conclusion = '';
  const details = (d.details ?? {}) as any;

  switch (true) {
    case d.dim.startsWith('D2-'): {
      // chips absent in wire -> the envelope never carried them: composition or
      // prompt. chips present in wire -> whatever went wrong is display-side,
      // which v0 does not capture.
      const failures: string[] = details.failures ?? [];
      if (failures.length > 0) {
        lv.wire = 'chips ABSENT from the failing envelope(s) -> fault is at or before composition';
        lv.display = 'not exercised — wire already lacks chips';
        conclusion = 'composition-or-prompt (CEE side); check prompt chip instructions + compose keep-list';
      } else {
        lv.wire = 'chips present on all qualifying envelopes';
        lv.display = layers.display ? '' : 'NOT CAPTURED in v0 — if users still miss chips, display layer is UNMEASURABLE here';
        conclusion = 'wire is clean; any user-visible failure localizes to display (v1 scope)';
      }
      break;
    }
    case d.dim.startsWith('D1-'): {
      lv.wire = 'repeated chip sets observed in the envelopes themselves';
      conclusion = 'CEE-side (composition/prompt) — the wire repeats before display is involved';
      break;
    }
    case d.dim.startsWith('D8-'): {
      const over: any[] = (details.perTurn ?? []).filter((t: any) => t.over);
      const withSubstages = over.filter((t: any) => t.slowestSubstages?.length);
      if (withSubstages.length > 0) {
        lv.trace = `slowest substages per over-budget turn: ${withSubstages
          .map((t: any) => `${t.turn}: ${t.slowestSubstages.map((s: any[]) => s[0]).join('>')}`)
          .join('; ')}`;
        conclusion = 'attribute to the named slowest substage (CEE-llm vs PLoT vs ISL hop)';
      } else {
        lv.trace = layers.trace
          ? 'trace present but carries no substage timings'
          : 'trace NOT captured — enable CEE_DIAGNOSTIC_TRACE_ENABLED on the arm';
        conclusion = 'below-turn-level attribution UNMEASURABLE without substage timings';
      }
      break;
    }
    case d.dim.startsWith('D9-') || d.dim.startsWith('D10-'): {
      if (d.verdict === 'unmeasurable' && details.reason) {
        // e.g. "journey has no concurrent_duplicate turn" — do not imply the
        // DB check ran when the dim itself says it could not.
        lv.l0_db = layers.l0_db ? 'captured' : 'NOT captured';
        conclusion = `unmeasurable: ${details.reason}`;
      } else if (!layers.l0_db) {
        lv.l0_db = 'NOT captured (run with --l0) — DB-layer verdict UNMEASURABLE';
        conclusion = 'cannot separate "CEE said it" from "DB did it" without L0';
      } else {
        lv.l0_db = 'captured — details carry the DB-layer measurement';
        lv.wire = 'captured — compare wire claims against the L0 diff';
        conclusion = d.dim.startsWith('D10-')
          ? 'double-commit check ran against DB ground truth (see dim details)'
          : 'friction measured at turn-boundary granularity against DB ground truth (see dim details)';
      }
      break;
    }
    case d.dim.startsWith('D11-'): {
      lv.wire = 'guard-pattern hit in the served assistant_text itself';
      conclusion =
        'CEE egress (prompt-or-composition): text with a production-guard hit reached the wire — check why the egress guard did not catch it in prod';
      break;
    }
    default: {
      lv.wire = layers.wire ? 'captured' : 'missing';
      conclusion = 'no v0 localization rule for this dim — layers listed for manual triage';
    }
  }
  return { dim: d.dim, verdict: d.verdict, layer_verdicts: lv, conclusion };
}

const interesting = scores.dims.filter((d) => d.verdict === 'fail' || d.verdict === 'advisory-fail' || d.verdict === 'unmeasurable');
const localizations = interesting.map(localizeDim);

const out = {
  generated_at: new Date().toISOString(),
  layers_captured: layers,
  note: 'v0: display layer is never captured; UNMEASURABLE is a first-class verdict, not a pass',
  localizations,
};
writeFileSync(join(RUN, 'localization.json'), JSON.stringify(out, null, 2));

const md = [
  `# Localization report v0 — ${RUN}`,
  '',
  `Layers captured: ${Object.entries(layers)
    .map(([k, v]) => `${k}=${v ? 'yes' : 'NO'}`)
    .join(' · ')}`,
  '',
  ...(localizations.length === 0
    ? ['No failing, advisory, or unmeasurable dims — nothing to localize.']
    : localizations.flatMap((l) => [
        `## ${l.dim} — ${l.verdict.toUpperCase()}`,
        ...Object.entries(l.layer_verdicts).map(([layer, v]) => `- **${layer}**: ${v}`),
        `- **conclusion**: ${l.conclusion}`,
        '',
      ])),
].join('\n');
writeFileSync(join(RUN, 'localization.md'), md);
console.log(md);
