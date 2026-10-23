/**
 * SPIKE S3: the per-run record helpers BOTH arms use (the spike driver and the control arm), so their outputs are like for
 * like: cost, tokens, basis labels, the code-counted chance, and the readable renderings.
 */
export const RATES = { in: 2.0, read: 0.1, write: 2.5, out: 10.0 }; // $ per M tokens, as qrunner.mjs:25; list prices UNVERIFIED

export const usdOf = (u) => {
  if (!u) return 0;
  const input = u.input_tokens ?? 0; const read = u.cached_input_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
  const write = u.raw?.input_tokens_details?.cache_write_tokens ?? 0; const out = u.output_tokens ?? 0;
  return (Math.max(0, input - read - write) * RATES.in + read * RATES.read + write * RATES.write + out * RATES.out) / 1e6;
};
export const tokensOf = (u) => ({ input: u?.input_tokens ?? 0, cached: u?.cached_input_tokens ?? u?.input_tokens_details?.cached_tokens ?? 0,
  output: u?.output_tokens ?? 0, reasoning: u?.output_tokens_details?.reasoning_tokens ?? u?.raw?.output_tokens_details?.reasoning_tokens ?? 0 });
export const sumTokens = (ts) => ts.reduce((a, t) => ({ input: a.input + t.input, cached: a.cached + t.cached, output: a.output + t.output, reasoning: a.reasoning + t.reasoning }),
  { input: 0, cached: 0, output: 0, reasoning: 0 });
/** A turn payload's provider rows, as the ledger names them. */
export const callsOf = (body) => (Array.isArray(body?._provider_calls) ? body._provider_calls : []).map((c) => ({ purpose: c.purpose ?? null, alias: c.prompt_alias ?? null,
  model: c.returned_model ?? c.model ?? null, effort: c.reasoning_effort ?? null, outcome: c.attempt?.outcome ?? c.outcome ?? null, ms: c.duration_ms ?? null,
  tokens: tokensOf(c.usage), usd: +usdOf(c.usage).toFixed(4) }));

/** The basis a chance's words end with: "on your figures", or conditional ("if …"). */
export const basisOf = (words) => (typeof words !== 'string' ? null : /on your figures\.?$/.test(words.trim()) ? 'on_your_figures' : / if /.test(words) ? 'conditional' : 'unlabelled');

/** The chances a canonical_analysis_view shows, per option, read the same way for both arms. */
export function chancesFromView(view, labels = new Map()) {
  return {
    cells: Array.isArray(view?.options) ? view.options.map((o) => ({ option_id: o.option_id, label: labels.get(o.option_id) ?? o.label ?? o.option_id, kind: o.cell?.kind ?? null,
      display: o.cell?.display ?? null, basis: o.cell?.kind === 'figure' ? basisOf(o.cell.face) : null, face: o.cell?.face ?? null, why: o.cell?.why ?? null })) : null,
    per_target: view?.goal_chance?.targets?.per_target?.map((t) => ({ goal_id: t.constraint_id, basis: basisOf(t.words), words: t.words, options: t.options })) ?? null,
    joint: view?.goal_chance?.targets?.joint ?? null, chance_words: view?.goal_chance?.chance_words ?? null, notes: view?.goal_chance?.notes ?? [],
    thresholds: view?.goal_chance?.thresholds ?? [],
  };
}
/** CODE-COUNTED, never judged: the run shows a chance when any option's cell in its final view is a figure. */
export const hasChance = (view) => Array.isArray(view?.options) && view.options.some((o) => o.cell?.kind === 'figure');

/** A plain reading of a canonical model (the spike arm). */
export function renderCanonical(m, compile) {
  const L = [`# ${m.question}`, '', `Period: ${m.period}.`, ''];
  const fig = (q) => (q.low !== null && q.high !== null ? `${q.value !== null ? `about ${q.value}, ` : ''}${q.low} to ${q.high}${q.range_kind ? ` (${q.range_kind})` : ''}` : q.value !== null ? String(q.value) : '—');
  const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
  L.push('## Quantities', '', '| id | label | unit | kind | status | figure | author | quote / question / basis |', '|---|---|---|---|---|---|---|---|');
  for (const q of m.quantities) L.push(`| ${q.id} | ${cell(q.label)} | ${q.unit} | ${q.kind} | ${q.status} | ${fig(q)} | ${q.author}${q.approval === 'approved' ? ' (approved)' : ''} | ${cell(q.quote ?? q.question ?? q.basis)} |`);
  L.push('', '## Relations', '');
  const part = (p) => (typeof p === 'string' ? p : p.sign !== undefined ? `${p.sign < 0 ? '−' : '+'}${p.id}` : p.power !== undefined ? `${p.id}${p.power < 0 ? '^−1' : ''}` : JSON.stringify(p));
  for (const r of m.relations) {
    const body = r.form === 'definition' ? `${r.op}(${r.parts.map(part).join(', ')})` : r.form === 'effect' ? `${r.base} + ${r.terms.map((t) => `${t.coefficient} × ${t.driver}`).join(' + ') || '0'}`
      : `stock: start ${r.start}, + ${r.inflows.join(' + ') || '0'}, − ${r.outflows.join(' − ') || '0'} per ${m.period}`;
    L.push(`- ${r.defines} = ${body} (${r.form}, ${r.author}${r.quote ? `: "${r.quote}"` : ''})`);
  }
  const win = (w) => (w === null || w === undefined ? 'no window' : `from ${w.origin_event ?? 'now'}${w.origin_offset ? ` (at ${w.origin_offset})` : ''}, start +${w.start}, over ${w.periods}`);
  const meas = (x, t) => `${x.quantity}${x.per ? ` per ${x.per}` : ''} ${x.cmp} ${x[t]} (${x.frame ?? 'limit'}${x.reference ? ` from ${x.reference.kind}${x.reference.option ? ` ${x.reference.option}` : ''}${x.reference.quantity ? ` ${x.reference.quantity}` : ''}` : ''}, ${x.aggregation}, ${win(x.window)})`;
  L.push('', '## Goals', '');
  for (const g of m.goals) L.push(`- ${g.label}: ${g.measure ? meas(g.measure, 'target') : `no measure yet: ${g.question}`} [${g.author}${g.quote ? `: "${g.quote}"` : ''}]`);
  L.push('', '## Limits', '');
  for (const l of m.limits) { const x = l.measure ?? (l.quantity ? l : null); L.push(`- ${l.label}: ${x ? meas(x, 'bound') : `no measure yet: ${l.question}`} [${l.author}${l.quote ? `: "${l.quote}"` : ''}]`); }
  if (m.preferences?.length) { L.push('', '## Preferences', ''); for (const p of m.preferences) L.push(`- ${p.quantity}: ${p.direction} [${p.author}${p.quote ? `: "${p.quote}"` : ''}]`); }
  L.push('', '## Options', '');
  for (const o of m.options) L.push(`- ${o.label} (${o.status}, ${o.author}): ${o.sets.length ? o.sets.map((s) => `${s.quantity} → ${s.to ?? (s.value ?? `${s.low} to ${s.high}`)} from period ${s.from_period}`).join('; ') : 'carry on as now'}`);
  if (m.risks.length) { L.push('', '## Risks', ''); for (const k of m.risks) L.push(`- ${k.label}: chance ${k.occurrence}, ${k.mode} ${k.severity} to ${k.effect_on} from period ${k.from_period} (${k.author})`); }
  for (const f of ['claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out']) if (m[f]?.length) {
    L.push('', `## ${f.replace('_', ' ')}`, '');
    for (const r of m[f]) L.push(`- ${r.text ?? r.position ?? ''}${r.why ? ` — why: ${r.why}` : ''}${r.holder ? ` — held by ${r.holder}` : ''} (${r.author})`);
  }
  if (compile) {
    L.push('', '## Compile', '', `compiles: ${compile.compiles}; executable: ${compile.executable}; joint: ${compile.joint?.status}; within limits: ${compile.within_limits?.status}`);
    for (const g of compile.per_goal ?? []) L.push(`- goal ${g.goal_id}: ${g.status}${g.reasons?.length ? ` — ${g.reasons.join(' ')}` : ''}`);
    for (const e of compile.errors ?? []) L.push(`- error ${e.code}: ${e.message}`);
  }
  return `${L.join('\n')}\n`;
}

/** A plain reading of today's living model (the control arm): every list, each item's figure, unit, source and words. */
export function renderLiving(lm, question = null) {
  const L = [`# ${question ?? 'Saved living model'}`, ''];
  const fig = (x) => (x == null ? '—' : x.low != null && x.high != null ? `${x.value != null ? `about ${x.value}, ` : ''}${x.low} to ${x.high}` : x.value != null ? String(x.value) : '—');
  const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
  for (const [k, v] of Object.entries(lm ?? {})) {
    if (!Array.isArray(v) || v.length === 0) continue;
    L.push(`## ${k}`, '');
    for (const x of v) {
      const name = x.label ?? x.text ?? x.id ?? '';
      const what = k === 'aims' && x.target ? ` — target ${x.target.comparator ?? ''} ${fig(x.target)} ${x.target.unit ?? ''}${x.target.by_when ? ` by ${x.target.by_when}` : ''}`
        : k === 'links' ? ` — ${x.from} → ${x.to}${x.effect ? `: ${x.effect.sign ?? ''}${fig(x.effect)} ${x.effect.unit ?? ''}` : ''}`
        : k === 'options' ? ` — ${(x.settings ?? []).map((s) => `${s.factor_id} = ${fig(s)}`).join('; ') || 'as now'}`
        : x.value !== undefined || x.low !== undefined ? ` — ${fig(x)} ${x.unit ?? ''}` : '';
      L.push(`- ${cell(name)}${what} [${x.source ?? x.author ?? '?'}${x.estimate_by ? `, estimate by ${x.estimate_by}` : ''}${x.quote ? `: "${cell(x.quote)}"` : ''}]`);
    }
    L.push('');
  }
  return `${L.join('\n')}\n`;
}
