/** Replays saved records only. No constructor, provider, registration or science calls. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { manifest, rubricVersion, scoreRecord } from './score.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = ['b-source-first-e031d96-four-final-replay.jsonl', 'b-current-best-f95ea20-four-replay.jsonl', 'b-current-best-f7c8c86-four-replay.jsonl'];
const arms = files.map((file) => {
  const bytes = readFileSync(new URL(`./fixtures/${file}`, import.meta.url));
  const records = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  if (records.length !== manifest.briefs.length || new Set(records.map((record) => record.brief)).size !== manifest.briefs.length) {
    throw new Error(`Expected exactly the frozen four cases: ${file}`);
  }
  const cases = records.map((record) => {
    const scored = scoreRecord(record);
    const initial = scored.recovery.initial_response_score;
    return {
      brief: scored.brief,
      evidence_level: scored.evidence_level,
      fidelity: Object.fromEntries(Object.entries(scored.fidelity).filter(([key]) => ['facts_retained', 'facts_total', 'source_bound', 'user_options_retained', 'user_options_total', 'user_options_source_bound'].includes(key))),
      dimensions: Object.fromEntries(Object.entries(initial.dimensions).map(([key, part]) => [key, { passed: part.passed, total: part.total, failed_checks: part.checks.filter((check) => !check.passed).map((check) => check.id) }])),
      score: initial.total,
      correct_initial_response: initial.correct_initial_response,
      withholding_status: initial.withholding_status,
      questions: { count: initial.question_count, redundant: initial.redundant_questions },
      unsupported_claims: { pro_scope: initial.unsupported_scope_assumption, numeric: initial.unsupported_numeric_claim, sized_causal_edges: initial.unsupported_sized_causal_edges },
      fidelity_findings_by_kind: scored.fidelity.failures.reduce((counts, failure) => ({ ...counts, [failure.kind]: (counts[failure.kind] ?? 0) + 1 }), {}),
      continuation_verified: scored.recovery.continuation_verified,
    };
  });
  const dimensions = Object.fromEntries(Object.keys(cases[0].dimensions).map((key) => [key, {
    passed: cases.reduce((sum, row) => sum + row.dimensions[key].passed, 0),
    total: cases.reduce((sum, row) => sum + row.dimensions[key].total, 0),
  }]));
  return {
    arm: records[0].arm,
    capture_label: file.startsWith('b-source-first') ? 'frozen B meaning'
      : file.includes('f95ea20') ? 'captured control at that time' : 'newer saved diagnostic control; injected candidate only',
    saved_source_heads: [...new Set(records.map((record) => record.source_head))],
    fixture: { file: `fixtures/${file}`, sha256: sha256(bytes) },
    aggregate: { dimensions, score: { passed: cases.reduce((sum, row) => sum + row.score.passed, 0), possible: cases.reduce((sum, row) => sum + row.score.possible, 0) }, correct_initial_responses: cases.filter((row) => row.correct_initial_response).length, cases: cases.length },
    cases,
  };
});

console.log(JSON.stringify({
  version: rubricVersion,
  basis: 'saved_initial_outputs_only',
  manifest_sha256: sha256(readFileSync(new URL('./four-cases.json', import.meta.url))),
  scorer_sha256: sha256(readFileSync(new URL('./score.mjs', import.meta.url))),
  evaluation_provider_attempts: 0,
  recovery_continuation_exercised: false,
  limits: [
    'Frozen four saved captures only; these are not current deployed outputs or fresh provider runs.',
    'Scores use separate fidelity, truthful withholding and minimal clarification denominators; an honest abstention can still lose fidelity or clarification points.',
    'Rubric v2 adds one source/semantic-integrity check per case: fidelity 30, truthful withholding 8 and minimal clarification 8 for every four-case arm; v1 used 26/8/8.',
    'Questions are judged with bounded case-specific patterns and contrasting controls, not a general natural-language judge.',
    'None of these four briefs states a numeric causal effect; action and identity carrier edges are excluded from effect scoring.',
    'Identity carrier exemption requires independently verified target, resolved scope, exact source and compatible operand/target units; none of these four initial briefs qualifies.',
    'The newer f7c8c86 control is saved injected-candidate evidence, previously compared with same-base 950177 flag-off; this report makes no fresh-provider, serving or architectural verdict.',
    'Sealed recovery answers are never consumed as constructor replies; no continuation, analysis readiness, registration, persistence or browser claim is made.',
  ],
  arms,
}, null, 2));
