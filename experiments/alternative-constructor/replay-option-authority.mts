/** Zero-provider replay through the real construction capability and Run intake reader.
 * The registration dispatch is captured in memory; real BFF persistence is separate.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildModelFromBrief, type CallStructuredModel } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';
import type { CandidateModel } from '../../src/orchestrator-v5/agent-lane/admit-model.js';
import type { InternalDispatch } from '../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { GraphV3 } from '../../src/schemas/cee-v3.js';
import { deriveIntakeOptionReconciliation } from '../../src/orchestrator/context/intake-option-reconciliation.js';
// @ts-ignore experiment scorer is deliberately independent of constructor code
import { scoreRecord } from './score.mjs';

const out = resolve(process.argv[2] ?? '.artifacts/alternative-constructor/m1-option-authority-independent-replay.jsonl');
const fixtures = JSON.parse(readFileSync(new URL('../../src/orchestrator-v5/agent-lane/__tests__/fixtures/m1-four-captured-candidates-20260929.json', import.meta.url), 'utf8'));
const original = fixtures.cases.find((r: { id: string }) => r.id === 'paul-mrr').candidates[0];
const brief = 'The options are raise Pro price to £59, or keep it at £49. We currently have £75k MRR and want MRR above £85k.';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const expectation = {
  id: 'quoted-option-replacement', text: brief, source_sha256: sha(brief),
  // GBP/month is held constant from the captured CandidateModel. These rows test
  // option/figure identity; they do not certify a period absent from this brief.
  facts: [
    { id: 'raise-price', entity: 'price', role: 'intervention', value: 59, unit: 'GBP/month', option: 'raise', quote: 'raise Pro price to £59' },
    { id: 'keep-price', entity: 'price', role: 'intervention', value: 49, unit: 'GBP/month', option: 'keep', quote: 'keep it at £49' },
  ].map((f) => ({ ...f, source_span: { start: brief.indexOf(f.quote), end: brief.indexOf(f.quote) + f.quote.length } })),
  options: [
    { id: 'raise', pattern: 'raise', quote: 'raise Pro price to £59' },
    { id: 'keep', pattern: 'keep', quote: 'keep it at £49' },
  ].map((o) => ({ ...o, source_span: { start: brief.indexOf(o.quote), end: brief.indexOf(o.quote) + o.quote.length } })),
};
const rows: unknown[] = [];
for (const contrast of ['borrowed_54', 'genuine_59'] as const) {
  const value = contrast === 'borrowed_54' ? 54 : 59;
  const raw = structuredClone(original);
  const setting = raw.options[0].interventions[0];
  const candidate = { ...raw, options: [
    { ...raw.options[0], label: `Raise to £${value}`, provenance: 'ai_proposed', brief_words: 'raise Pro price to £59', interventions: [{ ...setting, value, provenance: contrast === 'genuine_59' ? 'explicit' : 'ai_proposed' }] },
    { ...raw.options[1], label: 'Keep at £49', provenance: 'explicit', brief_words: 'keep it at £49', interventions: [{ ...setting, value: 49, provenance: 'explicit' }] },
  ] } as CandidateModel;
  for (const policy of ['current', 'm1'] as const) {
    let registered: unknown = null;
    let calls = 0;
    const dispatches: string[] = [];
    const call: CallStructuredModel = async () => { calls += 1; return { text: JSON.stringify(candidate) }; };
    const dispatch = (async (path: string, body: unknown) => {
      dispatches.push(path);
      if (path.endsWith('/graph/register')) {
        registered = structuredClone((body as { graph: unknown }).graph);
        return { status: 200, json: { model_version: { version_number: 1 } } };
      }
      if (path.endsWith('/graph')) return { status: 200, json: { graph: registered ?? { nodes: [], edges: [] } } };
      return { status: 200, json: { versions: [] } };
    }) as unknown as InternalDispatch;
    const result = await buildModelFromBrief('99999999-9999-4999-8999-999999999999', brief, dispatch, call, undefined, policy);
    assert.equal(result.ok, true);
    assert(registered !== null);
    const graph = GraphV3.parse(JSON.parse(JSON.stringify(registered)));
    const intake = deriveIntakeOptionReconciliation(brief, graph, graph);
    const score = scoreRecord({ brief: expectation.id, graph, proposals: result.constructor_proposals ?? [] }, [expectation]);
    const safeMutant = policy === 'm1' && contrast === 'borrowed_54';
    assert.equal(intake.state, safeMutant ? 'identity_unverified' : 'reconciled');
    assert.equal(intake.mayNameLeadingOption, !safeMutant);
    if (safeMutant) {
      assert(!graph.nodes.some((n) => n.kind === 'option' && n.label === 'Raise to £54'));
      assert(!graph.nodes.some((n) => n.kind === 'option' && n.source_quote === 'raise Pro price to £59'));
      assert(result.constructor_proposals?.some((p) => p.kind === 'option' && p.label === 'Raise to £54'));
      assert.equal(score.fidelity.user_options_retained, 1);
    }
    if (contrast === 'genuine_59') {
      assert.equal(score.fidelity.facts_retained, 2);
      if (policy === 'm1') assert.equal(score.fidelity.user_options_retained, 2);
    }
    if (contrast === 'borrowed_54' && policy === 'current') {
      assert(score.fidelity.failures.some((f: { kind: string }) => f.kind === 'unstated_canonical_option'));
      assert.equal(score.fidelity.user_options_retained, 1);
    }
    const row = {
      at: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      evidence_level: 'injected_construction_capability_registration_payload_and_real_intake_reader',
      contrast, policy, brief_text: brief, source_sha256: sha(brief), candidate_sha256: sha(JSON.stringify(candidate)),
      provider_attempts: 0, injected_candidate_calls: calls, dispatches, candidate, graph,
      graph_sha256: sha(JSON.stringify(graph)), result, intake,
      independent_option_score: { facts: score.facts, options: score.options, user_options_retained: score.fidelity.user_options_retained, option_failures: score.fidelity.failures.filter((f: { kind: string }) => /option/.test(f.kind)) },
    };
    rows.push(row);
    console.log(JSON.stringify({ contrast, policy, intake_state: intake.state, may_name_leader: intake.mayNameLeadingOption, options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({ label: n.label, source_quote: n.source_quote, proposed_by: n.proposed_by })), injected_calls: calls }));
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
