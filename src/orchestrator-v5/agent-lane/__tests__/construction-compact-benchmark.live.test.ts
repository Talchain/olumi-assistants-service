/**
 * LIVE BENCHMARK — Paul's exact first turn, served contract vs compact contract.
 *
 * ⛔ SKIPPED UNLESS `RUN_LIVE_BENCH=1`. It spends real OpenAI calls and takes
 * ~2 minutes, so it must never run in CI or in a broad local sweep.
 *
 * It calls the provider twice with the SAME model, budget and schema shape and
 * differs only in the instruction block, then admits BOTH through the real
 * `admitCandidateModel` and measures the real `assessConstructionSize`. Counting
 * the candidate instead of the admitted graph would measure a different object
 * from the one that gets registered.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { assessConstructionSize } from '../construction-size-gate.js';
import { BUILD_INSTRUCTIONS, buildCandidateSchema } from '../runtime/build-model.js';
import { budgetFor } from '../model-budgets.js';

const BRIEF = 'Should I hire a Tech lead or two developers to increase velocity?';
const OUT = '/Users/paulslee/Documents/GitHub/output/compact-first-model-20260923/BENCHMARK.md';

/** The clause that was served before this lane, restored verbatim for the control arm. */
const SERVED_WIDEN_CLAUSE =
  'Then widen: add the options, factors, risks, outcomes and causal mechanisms that materially improve strategic reasoning, including alternatives beyond the user’s initial frame.';

/** The compact clause this lane installed, as it appears in BUILD_INSTRUCTIONS. */
const COMPACT_MARKER = 'KEEP THE FIRST MODEL DECISION-CRITICAL, NOT COMPREHENSIVE.';

function key(): string {
  for (const f of ['/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env']) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (line.startsWith('OPENAI_API_KEY=')) return line.slice(15).trim().replace(/^['"]|['"]$/g, '');
      }
    } catch { /* fall through */ }
  }
  throw new Error('OPENAI_API_KEY not found');
}

async function call(instructions: string, schema: Record<string, unknown>) {
  const budget = budgetFor('gpt-5.6-terra', 'whole');
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: budget.model,
      instructions,
      input: BRIEF,
      max_output_tokens: budget.max_output_tokens,
      reasoning: { effort: budget.reasoning_effort },
      text: { format: { type: 'json_schema', name: 'candidate', strict: true, schema } },
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  const ms = Date.now() - t0;
  const output = (json['output'] ?? []) as { type?: string; content?: { text?: string }[] }[];
  const text = output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text ?? '')
    .join('');
  return { text, ms, status: json['status'], usage: json['usage'] };
}

/**
 * ⭐ THE COLUMN THAT DECIDES WHETHER COMPACTING IS SAFE.
 *
 * Every candidate item marked `provenance: "explicit"` is something the USER
 * stated. If one of those does not survive into the admitted graph, compacting
 * cost the user their own material — which outranks the size target outright.
 * Measured by LABEL, because admission shortens labels and re-slugs ids, so an
 * id comparison would report false losses.
 */
function explicitMeaningLost(candidate: CandidateModel, admitted: { nodes: readonly { label?: string }[] }) {
  const c = candidate as unknown as Record<string, { label?: string; provenance?: string; metric?: string }[]>;
  const admittedLabels = new Set(
    admitted.nodes.map((n) => String(n.label ?? '').toLowerCase().replace(/\u2026$/, '').trim()),
  );
  const present = (label: string) => {
    const l = label.toLowerCase().trim();
    for (const a of admittedLabels) if (a.length > 0 && (l.startsWith(a) || a.startsWith(l))) return true;
    return false;
  };
  const lost: string[] = [];
  for (const key of ['options', 'factors', 'risks', 'outcomes']) {
    for (const item of c[key] ?? []) {
      if (item?.provenance !== 'explicit') continue;
      const label = String(item.label ?? '');
      if (label.length > 0 && !present(label)) lost.push(`${key}: ${label}`);
    }
  }
  return lost;
}

/**
 * ⭐⭐ FEWER NODES MUST NOT MEAN A DISCONNECTED GOAL.
 *
 * The served contract's wiring rules exist because 8 of 20 nodes were once
 * unreachable and the analysis refused outright. So a compact model is only
 * better if every OPTION still reaches the goal metric. Measured by forward
 * traversal over the admitted edges — the same question the engine asks.
 */
function goalReachability(admitted: {
  readonly nodes: readonly { id: string; kind?: string }[];
  readonly edges: readonly { from: string; to: string }[];
}) {
  const goal = admitted.nodes.find((n) => n.kind === 'goal');
  const options = admitted.nodes.filter((n) => n.kind === 'option');
  if (goal === undefined) return { goal: false, options_total: options.length, options_reaching: 0 };
  const out = new Map<string, string[]>();
  for (const e of admitted.edges) {
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }
  const reaches = (start: string): boolean => {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      if (cur === goal.id) return true;
      for (const nxt of out.get(cur) ?? []) if (!seen.has(nxt)) { seen.add(nxt); stack.push(nxt); }
    }
    return false;
  };
  return {
    goal: true,
    options_total: options.length,
    options_reaching: options.filter((o) => reaches(o.id)).length,
  };
}

function measure(text: string) {
  const candidate = JSON.parse(text) as CandidateModel;
  const admitted = admitCandidateModel(candidate, {});
  const size = assessConstructionSize(admitted);
  const c = candidate as unknown as Record<string, unknown[]>;
  const lost = explicitMeaningLost(candidate, admitted);
  const reach = goalReachability(admitted);
  return {
    lost,
    reach,
    size,
    options: size.by_kind['option'] ?? 0,
    unknowns: (c['unknowns'] ?? []).length,
    withheld: admitted.withheld.length,
    explicitNodes: size.brief_stated_nodes,
    candidateCounts: {
      options: (c['options'] ?? []).length,
      factors: (c['factors'] ?? []).length,
      risks: (c['risks'] ?? []).length,
      outcomes: (c['outcomes'] ?? []).length,
      links: (c['links'] ?? []).length,
    },
  };
}

const live = process.env['RUN_LIVE_BENCH'] === '1';

describe.skipIf(!live)('LIVE — served vs compact on Paul’s exact brief', () => {
  it('measures both arms and writes the table', async () => {
    // Control arm: swap the compact clause back to the clause that was served.
    const servedInstructions = BUILD_INSTRUCTIONS.replace(
      new RegExp(`${COMPACT_MARKER}[\\s\\S]*?refused before it reaches the canvas\\.`),
      SERVED_WIDEN_CLAUSE,
    );
    expect(servedInstructions).toContain('Then widen'); // the control really is the control
    expect(servedInstructions).not.toContain(COMPACT_MARKER);

    // Control uses the schema WITHOUT the array caps, so the arms differ in
    // exactly the two things this lane changed.
    const uncapped = JSON.parse(JSON.stringify(buildCandidateSchema())) as Record<string, unknown>;
    const props = (uncapped['properties'] ?? {}) as Record<string, Record<string, unknown>>;
    for (const k of ['options', 'factors', 'risks', 'outcomes', 'links']) delete props[k]?.['maxItems'];

    const a = await call(servedInstructions, uncapped);
    const b = await call(BUILD_INSTRUCTIONS, buildCandidateSchema());

    const rows: string[] = [
      '# Compact first model — live benchmark',
      '',
      `Brief: \`${BRIEF}\``,
      `Model: \`${budgetFor('gpt-5.6-terra', 'whole').model}\``,
      '',
      '| | served (control) | compact |',
      '|---|---|---|',
    ];
    const cells: [string, string, string][] = [];
    for (const [label, r] of [['served', a], ['compact', b]] as const) {
      if (r.text.length === 0) rows.push(`\n⚠ ${label} arm returned NO structured output (status ${String(r.status)}).`);
    }
    if (a.text.length > 0 && b.text.length > 0) {
      const ma = measure(a.text);
      const mb = measure(b.text);
      cells.push(['nodes', String(ma.size.nodes), String(mb.size.nodes)]);
      cells.push(['edges', String(ma.size.edges), String(mb.size.edges)]);
      cells.push(['options', String(ma.options), String(mb.options)]);
      cells.push(['within 12/20', String(ma.size.within), String(mb.size.within)]);
      cells.push(['added beyond brief', String(ma.size.sheddable_nodes), String(mb.size.sheddable_nodes)]);
      cells.push(['from the brief', String(ma.explicitNodes), String(mb.explicitNodes)]);
      cells.push(['unknowns', String(ma.unknowns), String(mb.unknowns)]);
      cells.push(['withheld links', String(ma.withheld), String(mb.withheld)]);
      cells.push(['latency ms', String(a.ms), String(b.ms)]);
      cells.push(['candidate factors', String(ma.candidateCounts.factors), String(mb.candidateCounts.factors)]);
      cells.push(['candidate risks', String(ma.candidateCounts.risks), String(mb.candidateCounts.risks)]);
      cells.push(['candidate links', String(ma.candidateCounts.links), String(mb.candidateCounts.links)]);
      // ⭐ The safety column. Anything here means compacting cost the user their
      // own stated material, which outranks the size target.
      cells.push([
        '**options reaching the goal**',
        `${ma.reach.options_reaching}/${ma.reach.options_total}`,
        `${mb.reach.options_reaching}/${mb.reach.options_total}`,
      ]);
      cells.push([
        '**explicit meaning lost**',
        ma.lost.length === 0 ? 'none' : `${ma.lost.length}: ${ma.lost.join('; ')}`,
        mb.lost.length === 0 ? 'none' : `${mb.lost.length}: ${mb.lost.join('; ')}`,
      ]);
      for (const [k, x, y] of cells) rows.push(`| ${k} | ${x} | ${y} |`);
      rows.push('', `served by_kind: \`${JSON.stringify(ma.size.by_kind)}\``);
      rows.push('', `compact by_kind: \`${JSON.stringify(mb.size.by_kind)}\``);
      rows.push('', `served detail: ${ma.size.detail || '(within budget)'}`);
      rows.push('', `compact detail: ${mb.size.detail || '(within budget)'}`);
    }
    writeFileSync(OUT, rows.join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(8);
  }, 600_000);
});
