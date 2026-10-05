import { readOptionResultSources } from '../../../orchestrator/context/option-result-source.js';
import { optionIdOf } from '../../../orchestrator/context/placeholder-parts.js';
import { BRIEF_LEADER_KEYS, COMPARISON_DERIVED_KEYS } from '../../../orchestrator/context/constraint-feasibility.js';

export interface IdenticalToBaselineRecord {
  readonly option_id: string;
  readonly label: string;
  readonly baseline_option_id: string;
  readonly baseline_label: string;
  /** The baseline's cumulative share after this arm; absent shares stay absent. */
  readonly merged_win_probability: number | null;
}

type RecordValue = Record<string, unknown>;
const OUTCOME_FIELDS = ['p10', 'p50', 'p90', 'mean', 'std'] as const;
const DOWNSIDE_FIELDS = ['p05', 'cvar_10', 'expected_regret'] as const;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function equalNumber(a: unknown, b: unknown): boolean {
  return finite(a) && finite(b)
    && Math.abs(a - b) <= 1e-12 * Math.max(1e-300, Math.abs(a), Math.abs(b));
}

function sameOutcome(a: RecordValue, b: RecordValue): boolean {
  const ao = record(a.outcome), bo = record(b.outcome);
  const ad = record(a.downside), bd = record(b.downside);
  return ao !== null && bo !== null && ad !== null && bd !== null
    && finite(ao.n_valid_samples) && finite(bo.n_valid_samples)
    && ao.n_valid_samples === bo.n_valid_samples
    && OUTCOME_FIELDS.every((key) => equalNumber(ao[key], bo[key]))
    && DOWNSIDE_FIELDS.every((key) => equalNumber(ad[key], bd[key]));
}

/** Only the submitted, explicit baseline is authoritative; a held scaffold is irrelevant. */
export function detectIdenticalToBaseline(
  response: unknown, submittedOptions: readonly RecordValue[],
): IdenticalToBaselineRecord[] {
  const envelope = record(response);
  const baselines = submittedOptions.filter((o) => o.is_baseline === true);
  if (envelope === null || baselines.length !== 1) return [];
  const baseline = baselines[0]!;
  const baselineId = optionIdOf(baseline);
  if (baselineId === undefined) return [];
  if (submittedOptions.filter((o) => optionIdOf(o) === baselineId).length !== 1) return [];
  // Same shared source as run-analysis's readResultRecords, never a second result reader.
  const results = readOptionResultSources(envelope)[0] ?? [];
  const baselineEntries = results.filter((r) => optionIdOf(r) === baselineId);
  if (baselineEntries.length !== 1) return [];
  const baselineResult = baselineEntries[0]!;
  const labelOf = (o: RecordValue, r: RecordValue): string =>
    typeof o.label === 'string' ? o.label : typeof r.option_label === 'string' ? r.option_label : '';
  const baselineLabel = labelOf(baseline, baselineResult);
  let mergedShare: number | null = finite(baselineResult.win_probability) ? baselineResult.win_probability : null;
  const found: IdenticalToBaselineRecord[] = [];
  for (const option of submittedOptions) {
    const id = optionIdOf(option);
    if (option.is_baseline === true || id === undefined || id === baselineId) continue;
    // Ambiguous identities are retained, rather than assigning someone else's result.
    if (submittedOptions.filter((o) => optionIdOf(o) === id).length !== 1) continue;
    const entries = results.filter((r) => optionIdOf(r) === id);
    if (entries.length !== 1 || !sameOutcome(entries[0]!, baselineResult)) continue;
    const arm = entries[0]!;
    mergedShare = mergedShare !== null && finite(arm.win_probability) ? mergedShare + arm.win_probability : null;
    found.push({ option_id: id, label: labelOf(option, arm), baseline_option_id: baselineId,
      baseline_label: baselineLabel, merged_win_probability: mergedShare });
  }
  return found;
}

/**
 * Copy-on-write removal, using the same carrier paths / strip shape as constraint-feasibility.
 * Never call its blanket goal-figure withholder: this merge keeps the baseline's earned figures.
 */
export function mergeIdenticalToBaselineArms<E>(response: E, records: readonly IdenticalToBaselineRecord[]): E {
  const env = record(response);
  if (env === null) return response;
  if (records.length === 0) return { ...env } as E;
  const ids = new Set(records.map((r) => r.option_id));
  const names = new Set(records.flatMap((r) => [r.option_id, r.label]).filter(Boolean));
  const namesMergedArm = (value: unknown): boolean => {
    if (typeof value === 'string') return names.has(value);
    if (Array.isArray(value)) return value.some(namesMergedArm);
    const r = record(value);
    return r !== null && Object.entries(r).some(([key, v]) => names.has(key) || namesMergedArm(v));
  };
  const proseNamesMergedArm = (value: unknown): boolean => {
    if (typeof value === 'string') return [...names].some((name) => value.includes(name));
    if (Array.isArray(value)) return value.some(proseNamesMergedArm);
    const r = record(value);
    return r !== null && Object.values(r).some(proseNamesMergedArm);
  };
  const strip = (value: unknown, rank = false): unknown => {
    if (!Array.isArray(value)) return value;
    const kept = value.filter((v) => {
      const r = record(v);
      return r === null || !ids.has(optionIdOf(r) ?? '');
    }).map((v) => {
      const r = record(v);
      if (r === null) return v;
      const out = { ...r };
      for (const merged of records) {
        if (optionIdOf(r) !== merged.baseline_option_id) continue;
        const arm = value.map(record).find((a) => a !== null && optionIdOf(a) === merged.option_id);
        if (arm === undefined || arm === null) continue;
        if (finite(out.win_probability) && finite(arm.win_probability)) out.win_probability += arm.win_probability;
        else delete out.win_probability; // No invented share when this copy had no comparable numbers.
      }
      return out;
    });
    if (!rank) return kept;
    // Dense positions, stable for tied shares; no absent-share coercion to zero.
    const ordered = [...kept].sort((a, b) => {
      const av = record(a)?.win_probability, bv = record(b)?.win_probability;
      return finite(av) && finite(bv) ? bv - av : finite(av) ? -1 : finite(bv) ? 1 : 0;
    });
    return ordered.map((v, i) => record(v) === null ? v : { ...record(v), rank: i + 1 });
  };
  const out: RecordValue = { ...env };
  if ('option_comparison' in env) out.option_comparison = strip(env.option_comparison);
  if (Array.isArray(env.results)) out.results = strip(env.results);
  else {
    const nested = record(env.results);
    if (nested !== null) {
      const n = { ...nested };
      for (const key of ['option_comparison', 'options', 'option_results'] as const) if (key in n) n[key] = strip(n[key]);
      out.results = n;
    }
  }
  const brief = record(env.decision_brief);
  if (brief !== null) {
    const b = { ...brief };
    if ('options' in b) b.options = strip(b.options, true);
    for (const key of BRIEF_LEADER_KEYS) {
      if (namesMergedArm(b[key]) || proseNamesMergedArm(b[key])) delete b[key];
    }
    const summary = record(b.analysis_summary);
    if (summary !== null && (namesMergedArm(summary.leading_option) || namesMergedArm(summary.near_tie))) delete b.analysis_summary;
    out.decision_brief = b;
  }
  const stripAlternatives = (value: unknown): unknown => Array.isArray(value)
    ? value.filter((v) => !ids.has(String(record(v)?.alternative_winner_id ?? ''))
      && !ids.has(String(record(v)?.baseline_winner_id ?? ''))) : value;
  const robustness = record(env.robustness);
  if (robustness !== null) {
    const r = { ...robustness };
    if (namesMergedArm(r.near_tie)) delete r.near_tie;
    if (Object.entries(r).some(([key, v]) => key.startsWith('recommended_option_') && namesMergedArm(v))) {
      for (const key of Object.keys(r)) if (key.startsWith('recommended_option_')) delete r[key];
    }
    for (const key of ['fragile_edges', 'robust_edges', 'flip_thresholds'] as const) if (key in r) r[key] = stripAlternatives(r[key]);
    out.robustness = r;
  }
  if ('flip_thresholds' in env) out.flip_thresholds = stripAlternatives(env.flip_thresholds);
  for (const key of ['edge_e_values', 'factor_flip_values'] as const) {
    if (Array.isArray(env[key])) out[key] = env[key].filter((v) => !namesMergedArm(v));
  }
  for (const key of [...COMPARISON_DERIVED_KEYS.filter((k) => k !== 'flip_thresholds'), 'constraint_results'] as const) {
    if (Array.isArray(env[key])) out[key] = env[key].filter((v) => key === 'constraint_results'
      ? !ids.has(optionIdOf(record(v) ?? {}) ?? '') : !namesMergedArm(v));
    else if (namesMergedArm(env[key])) delete out[key];
  }
  if (Array.isArray(env.critiques)) out.critiques = env.critiques.map((v) => {
    const r = record(v);
    return r !== null && Array.isArray(r.affected_option_ids)
      ? { ...r, affected_option_ids: r.affected_option_ids.filter((id) => typeof id !== 'string' || !ids.has(id)) } : v;
  });
  for (const key of ['m1_coaching', 'decision_review', 'm1_review'] as const) {
    const carrier = record(env[key]);
    if (carrier === null) continue;
    const c = { ...carrier }, stories = record(c.story_headlines);
    if (stories !== null) c.story_headlines = Object.fromEntries(Object.entries(stories)
      .filter(([id, text]) => !ids.has(id) && !proseNamesMergedArm(text)));
    // Served review/coaching copies also name options in narrative_summary, prompts,
    // pre_mortem and scenario_contexts. They are computed with the old comparison too.
    for (const field of Object.keys(c)) {
      if (field === 'story_headlines') continue;
      const value = c[field];
      if (Array.isArray(value)) c[field] = value.filter((v) => !namesMergedArm(v) && !proseNamesMergedArm(v));
      else if (namesMergedArm(value) || proseNamesMergedArm(value)) delete c[field];
    }
    out[key] = c;
  }
  for (const key of ['sensitivity_reference_option_id', 'leading_option_id'] as const) if (ids.has(String(out[key] ?? ''))) delete out[key];
  // Other legacy comparison carriers found in the existing golden run-analysis fixture.
  if (Array.isArray(env.fact_objects)) out.fact_objects = env.fact_objects.filter((v) => !namesMergedArm(record(v)?.data));
  if (Array.isArray(env.review_cards)) out.review_cards = env.review_cards.filter((v) => {
    const r = record(v);
    return !namesMergedArm(v) && !proseNamesMergedArm(r?.body) && !proseNamesMergedArm(r?.title);
  });
  // Maps can be id-keyed (PLoT) or label-keyed (CEE). Rewrite any present map without creating one.
  const rewriteMaps = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteMaps);
    const r = record(value);
    if (r === null) return value;
    return Object.fromEntries(Object.entries(r).map(([key, v]) => {
      const map = key === 'win_probabilities' ? record(v) : null;
      if (map === null) return [key, rewriteMaps(v)];
      const mergedMap = { ...map };
      for (const merged of records) {
        for (const [armKey, baselineKey] of [[merged.option_id, merged.baseline_option_id], [merged.label, merged.baseline_label]] as const) {
          if (!armKey || armKey === baselineKey || !(armKey in mergedMap)) continue;
          const armShare = mergedMap[armKey], baselineShare = mergedMap[baselineKey];
          if (finite(armShare) && finite(baselineShare)) mergedMap[baselineKey] = baselineShare + armShare;
          else delete mergedMap[baselineKey];
          delete mergedMap[armKey];
        }
      }
      return [key, mergedMap];
    }));
  };
  const merged = rewriteMaps(out) as RecordValue;
  merged.inference_warnings = [...(Array.isArray(env.inference_warnings) ? env.inference_warnings : []), {
    code: 'OPTION_IDENTICAL_TO_BASELINE',
    message: 'Options with identical outcomes were merged into the submitted baseline.',
    option_ids: records.map((r) => r.option_id),
    baseline_option_id: records[0]!.baseline_option_id,
  }];
  return merged as E;
}
