/**
 * EVENT branch census: P44's recorded-response construction harness, zero provider calls.
 * Source corpus matches #2842: valid 6 Oct lab 80 + two-risk arms 18 + mechanism arms 18.
 * Run identically in the immutable base snapshot and working tree. No database / network.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, chancesWithheldByAGuess, type CallStructuredModel } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const outputRoot = '/Users/paulslee/Documents/GitHub/output';
const oldLab = join(outputRoot, 'lab-runs/construct-20261006T1642Z');
const p44 = join(outputRoot, 'dl-0df0e1/inflight/accel/evidence');
const folders = [
  ...['baseline-terra-low', 'sol-6.1-low', 'astra-6-low', 'armB-v2', 'armC-v2', 'armC-v2-confirm'].map((name) => join(oldLab, name)),
  join(p44, 'p44-lab-two-risks-20261008'),
  join(p44, 'p44-lab-two-risks-20261008/arm2-floor-plus-line'),
  join(p44, 'p44-mq-task2-mechanism-arm-20261008'),
  join(p44, 'p44-mq-task2-mechanism-arm-20261008/rerun-2842'),
];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const probabilityFactor = (factor: Rec) => {
  if (!/(?:probability|likelihood|chance)\s*$/i.test(String(factor.label ?? ''))) return false;
  const level = factor.baseline_value ?? factor.observed_state?.value;
  return typeof level === 'number' && Number.isFinite(level)
    && (/^(?:%|percent|percentage|probability|0[–-]1)$/i.test(String(factor.unit ?? factor.observed_state?.unit ?? '')) || (level >= 0 && level <= 1));
};

describe.skipIf(!process.env.ER_REPLAY_OUT)('P44 event branch recorded-response census', () => {
  it('replays all 116 recorded drafts through construction without network or stores', async () => {
    expect(process.env.SUPABASE_URL ?? '').toBe('');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').toBe('');
    const out = process.env.ER_REPLAY_OUT;
    expect(out, 'ER_REPLAY_OUT must identify the local evidence destination').toBeTruthy();
    const sources = folders.flatMap((folder) => readdirSync(folder).filter((file) => /-d\d+\.json$/.test(file)).sort().map((file) => join(folder, file)));
    expect(sources).toHaveLength(116);
    const rows: Rec[] = [];
    for (const source of sources) {
      const content = readFileSync(source, 'utf8');
      const recording = JSON.parse(content) as Rec;
      const recordedCalls = recording.provider_calls as Rec[];
      const brief = String(recordedCalls[0]?.request?.input ?? '').split('\n\nConstruction notes:')[0]!;
      expect(sha(brief), `${source}: exact brief hash`).toBe(recording.brief_sha256);
      let used = 0;
      let graph: Rec | null = null;
      const dispatch: InternalDispatch = async (path, body) => {
        if (path.endsWith('/graph/register')) { graph = (body as Rec).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
        if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
        if (path.endsWith('/graph')) return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: graph ? 'replay-registered' : 'replay-empty' } };
        throw new Error(`unexpected replay dispatch ${path}`);
      };
      const drafter: CallStructuredModel = async () => {
        // A newly requested retry reuses the last recorded response, and is disclosed in the row.
        const call = recordedCalls[Math.min(used++, recordedCalls.length - 1)]!;
        return { text: String(call.output_text ?? ''), usage: call.usage,
          ...(typeof call.response_status === 'string' ? { status: call.response_status } : {}),
          ...(typeof call.incomplete_reason === 'string' ? { incomplete_reason: call.incomplete_reason } : {}) };
      };
      const candidates = recordedCalls.map((call) => { try { return JSON.parse(String(call.output_text ?? '')) as Rec; } catch { return null; } });
      const first = candidates[0];
      let result: Rec;
      try { result = await buildModelFromBrief(`00000000-0000-4000-8000-${sha(source).slice(0, 12)}`, brief, dispatch, drafter) as Rec; }
      catch (error) { result = { ok: false, replay_threw: String(error) }; }
      const admitted = graph as Rec | null;
      const nodes = (admitted?.nodes ?? []) as Rec[];
      const draftedFactors = (first?.factors ?? []).filter(probabilityFactor);
      const held = nodes.filter((node) => node.kind === 'risk' && node.event_risk?.occurrence?.basis === 'olumi');
      const stillFactors = nodes.filter((node) => node.kind === 'factor' && probabilityFactor(node));
      const converted = draftedFactors.filter((factor: Rec) => nodes.some((node) => node.kind === 'risk' && node.event_risk
        && String(node.label).toLowerCase().trim() === String(factor.label).replace(/\s+(?:probability|likelihood|chance)\s*$/i, '').toLowerCase().trim()));
      const dropped = admitted == null ? [] : draftedFactors.filter((factor: Rec) => !converted.includes(factor)
        && !stillFactors.some((node) => String(node.label).toLowerCase().trim() === String(factor.label).toLowerCase().trim()));
      const resultText = JSON.stringify(result);
      rows.push({
        source, source_sha256: sha(content), brief_sha256: sha(brief),
        recorded_calls: recordedCalls.length, replay_calls: used, repeated_last_response: Math.max(0, used - recordedCalls.length),
        drafted_occurrences: candidates.reduce((sum, candidate) => sum + (candidate?.risks ?? []).filter((risk: Rec) => risk.occurrence != null).length, 0),
        drafted_probability_factors: draftedFactors.map((factor: Rec) => ({ label: factor.label, value: factor.baseline_value, unit: factor.unit })),
        ok: result.ok === true, refusal: result.refusal ?? result.replay_threw ?? null,
        held_olumi_occurrences: held.map((node) => ({ id: node.id, label: node.label, event_risk: node.event_risk })),
        held_user_occurrences: nodes.filter((node) => node.kind === 'risk' && node.event_risk?.occurrence?.basis === 'user').map((node) => ({ id: node.id, label: node.label, event_risk: node.event_risk })),
        probability_factors_remaining: stillFactors.map((node) => ({ id: node.id, label: node.label })),
        probability_factors_converted: converted.map((factor: Rec) => factor.label),
        probability_factors_dropped: dropped.map((factor: Rec) => factor.label),
        probability_factor_disclosures: (result.not_represented ?? []).filter((line: unknown) => /probability|likelihood|chance/i.test(JSON.stringify(line))),
        withheld_chance: admitted == null ? null : chancesWithheldByAGuess(admitted as { nodes: unknown[]; edges: unknown[] }),
        result_has_probability_disclosure: /drafted.*(?:probability|likelihood|chance)|isn.t used|not used/.test(resultText),
        graph_sha256: admitted == null ? null : sha(JSON.stringify(admitted)),
        graph: admitted,
      });
    }
    const summary = {
      version: 1, at: new Date().toISOString(), tree_identity: process.env.ER_TREE_ID ?? 'working-tree',
      method: 'P44 recorded-response harness through buildModelFromBrief with fake registration; no LLM/network/database. New retries repeat the last recorded response and are counted.',
      sources: sources.length, admitted: rows.filter((row) => row.ok).length,
      recorded_drafted_occurrences: rows.reduce((sum, row) => sum + row.drafted_occurrences, 0),
      held_olumi_occurrences: rows.reduce((sum, row) => sum + row.held_olumi_occurrences.length, 0),
      held_user_occurrences: rows.reduce((sum, row) => sum + row.held_user_occurrences.length, 0),
      drafted_probability_factors: rows.reduce((sum, row) => sum + row.drafted_probability_factors.length, 0),
      probability_factors_remaining: rows.reduce((sum, row) => sum + row.probability_factors_remaining.length, 0),
      probability_factors_converted: rows.reduce((sum, row) => sum + row.probability_factors_converted.length, 0),
      probability_factors_dropped: rows.reduce((sum, row) => sum + row.probability_factors_dropped.length, 0),
      chance_withheld: rows.filter((row) => row.withheld_chance === true).length,
      chance_ready: rows.filter((row) => row.withheld_chance === false).length,
      chance_unavailable: rows.filter((row) => row.withheld_chance === null).length,
      repeated_last_response: rows.reduce((sum, row) => sum + row.repeated_last_response, 0),
    };
    mkdirSync(out!, { recursive: true });
    writeFileSync(join(out!, 'rows.json'), JSON.stringify(rows, null, 2));
    writeFileSync(join(out!, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`EVENT-BRANCH-REPLAY ${JSON.stringify(summary)}`);
    expect(rows).toHaveLength(116);
    expect(rows.some((row) => row.refusal && /unexpected replay dispatch/.test(row.refusal))).toBe(false);
  }, 120_000);
});
