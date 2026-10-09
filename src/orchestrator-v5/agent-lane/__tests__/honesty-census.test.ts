import fs from 'node:fs';
import zlib from 'node:zlib';
import { expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';
import { figureTheUserWrote, figureTheUserWroteFor, goalLevelTheUserWrote, writtenRangeFor } from '../stated-by-user.js';

type Row = { id: string; brief: string; drafter_texts: string[] };
type Range = { low: number; high: number; source?: string; text?: string; source_quote?: string };
type Node = {
  id: string; kind: string; label: string;
  observed_state?: { source?: string; raw_value?: number; value?: number; unit?: string };
  unit?: string; goal_threshold_raw?: number; goal_threshold_unit?: string; goal_threshold_frame?: string;
  threshold_source?: string;
  nonlinear_identity?: { operation: string; factor_ids: string[] };
};
type Edge = {
  id?: string; from: string; to: string;
  provenance?: {
    source?: string; magnitude?: string;
    natural_effect?: { amount: number; amount_unit: string; stated_range?: Range };
    range?: Range;
  };
  range?: Range;
};
type Graph = { nodes: Node[]; edges: Edge[] };
type Served = { graph: Graph; candidate: CandidateModel; result: Record<string, unknown> };
type LabelledInstance = {
  instance: number; class: 'H3' | 'H4' | 'H5'; row_id: string; entity_id: string;
  figure: number; unit: string; label_should_credit_user: boolean | 'derived';
};
const classes = ['H1', 'H2', 'H3', 'H4', 'H5'] as const;
type Class = typeof classes[number];
type Role = 'current' | 'target' | 'range';
type Instance = { row_id: string; entity_id: string; field: string; figure: number | string; unit?: string; sentence: string; role?: Role };
type Census = Record<Class, Instance[]>;
const empty = (): Census => ({ H1: [], H2: [], H3: [], H4: [], H5: [] });
const eligible = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) !== 0 && Math.abs(value) !== 1;

// The scope-material-identity replay harness: every dispatch is in memory and
// every drafting response is a stored fixture. No provider or widening callback.
async function replay(row: Row): Promise<Served> {
  let graph: Graph | undefined;
  let i = 0;
  let candidate: CandidateModel | undefined;
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) {
      graph = (body as { graph: Graph }).graph;
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async () => {
    const text = row.drafter_texts[Math.min(i++, row.drafter_texts.length - 1)]!;
    candidate = JSON.parse(text) as CandidateModel;
    return { text, status: 'completed' };
  };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-000000000077', row.brief, dispatch as never, drafter as never) as Record<string, unknown>;
  // Replay validity is infrastructure, not a zero-violations baseline assertion.
  expect(result.ok, row.id + JSON.stringify(result)).toBe(true);
  expect(graph, row.id).toBeDefined();
  return { graph: graph!, candidate: candidate!, result };
}

function stringsIn(value: unknown, path = 'result'): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringsIn(v, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => stringsIn(v, `${path}.${k}`));
  return [];
}

// AUDIT ONLY: unscoped digit presence, with no entity, unit or provenance
// attestation. This contrast never participates in census credit rules.
function naiveBriefSentence(figure: number | string, brief: string): string {
  if (typeof figure !== 'number') return '';
  const sentences = new Intl.Segmenter('en', { granularity: 'sentence' }).segment(brief);
  for (const { segment } of sentences) {
    const digits = /(?<![\d.,])(?:\d{1,3}(?:[, \u00a0\u202f]\d{3})+|\d+)(?:\.\d+)?(?:[ \t]*[km]\b)?/giu;
    for (const match of segment.matchAll(digits)) {
      const token = match[0].replace(/[, \u00a0\u202f\t]/gu, '');
      const suffix = token.slice(-1).toLowerCase();
      const scale = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1;
      const value = Number(scale === 1 ? token : token.slice(0, -1)) * scale;
      if (value === Math.abs(figure)) return segment.trim();
    }
  }
  return '';
}

function auditInstance(h: 'H3' | 'H4' | 'H5', instance: Instance, row: Row, graph: Graph) {
  const node = graph.nodes.find(n => n.id === instance.entity_id);
  const edge = graph.edges.find(e => (e.id ?? `${e.from}->${e.to}`) === instance.entity_id);
  const label = (id: string) => graph.nodes.find(n => n.id === id)?.label ?? id;
  const stamp = JSON.parse(instance.sentence) as { source?: string; threshold_source?: string; magnitude?: string };
  const claimed_source = h === 'H3'
    ? stamp.threshold_source ?? stamp.source ?? edge?.provenance?.source ?? ''
    : stamp.magnitude ?? '';
  const brief_sentence = naiveBriefSentence(instance.figure, row.brief);
  return {
    class: h, row_id: instance.row_id, entity_id: instance.entity_id,
    ...(instance.role === undefined ? {} : { role: instance.role }),
    entity_label: node?.label ?? (edge === undefined ? instance.entity_id : `${label(edge.from)} -> ${label(edge.to)}`),
    figure: instance.figure, unit: instance.unit ?? '', claimed_source,
    naive_in_brief: brief_sentence !== '', brief_sentence,
  };
}

function census(row: Row, served: Served): Census {
  const out = empty();
  const { graph, candidate, result } = served;
  const quantities = graph.nodes.filter(n => !['option', 'decision'].includes(n.kind));
  const scope = (targets: string[]) => ({ target: targets, others: quantities.map(n => n.label).filter(l => !targets.includes(l)) });
  const wrote = (value: number, unit: unknown, targets: string[]) => figureTheUserWroteFor(value, unit, row.brief, scope(targets));
  const add = (h: Class, entity_id: string, field: string, figure: number | string, sentence: string, unit?: string, role?: Role) => {
    out[h].push({ row_id: row.id, entity_id, field, figure, ...(unit === undefined ? {} : { unit }), sentence, ...(role === undefined ? {} : { role }) });
  };
  // The same served sentence mirrored into two result fields is one claim.
  const seenSentences = new Set<string>();
  for (const { path, text } of stringsIn(result)) {
    if (seenSentences.has(text)) continue;
    seenSentences.add(text);
    if (text.includes('a figure I proposed')) {
      // Locate the quoted entity names, NOT a second numeric parser. The
      // original intervention supplies the figure; the authority checks both texts.
      const quoted = /"([^"]+)" had "([^"]+)" at ([\s\S]*?), a figure I proposed/u.exec(text);
      if (quoted !== null) {
        const [, option, factor, figureWords] = quoted;
        const entity = graph.nodes.find(n => n.label === factor);
        const interventions = candidate.options.find(o => o.label === option)?.interventions ?? [];
        for (const iv of interventions.filter(iv => iv.factor_label === factor)) {
          const unit = iv.unit ?? entity?.observed_state?.unit ?? entity?.unit;
          if (eligible(iv.value) && figureTheUserWrote(iv.value, unit, figureWords)
            && wrote(iv.value, unit, [factor!, option!])) {
            add('H1', entity?.id ?? factor!, path, iv.value, text, unit);
          }
        }
      }
    }
    if (text.includes('deadline your brief sets')) {
      const deadline = /Which date does "([^"]+)" mean\?/u.exec(text)?.[1];
      // This class explicitly asks for VERBATIM wording, not numeric attestation.
      if (deadline !== undefined && !row.brief.includes(deadline)) {
        add('H2', graph.nodes.find(n => n.kind === 'goal')?.id ?? 'goal', path, deadline, text);
      }
    }
  }
  for (const n of graph.nodes) {
    const os = n.observed_state;
    const raw = typeof os?.raw_value === 'number' ? os.raw_value : os?.value;
    if (os?.source === 'brief_extraction' && eligible(raw)) {
      const unit = os.unit ?? n.unit;
      const written = n.kind === 'goal'
        ? goalLevelTheUserWrote({ goal: { metric: n.label }, factors: quantities.filter(q => q.id !== n.id) }, row.brief)(raw, unit)
        : figureTheUserWroteFor(raw, unit, row.brief, { ...scope([n.label]), currentLevel: true });
      if (!written) add('H3', n.id, 'observed_state', raw, JSON.stringify(os), unit, 'current');
    }
    if (n.threshold_source === 'brief_extraction' && eligible(n.goal_threshold_raw)) {
      const value = n.goal_threshold_frame === 'change_rel' ? Math.abs(n.goal_threshold_raw * 100)
        : n.goal_threshold_frame === 'change_abs' ? Math.abs(n.goal_threshold_raw) : n.goal_threshold_raw;
      const unit = n.goal_threshold_frame === 'change_rel' ? '%' : n.goal_threshold_unit;
      // Match holdStatedGoalAttributes: level targets use the figure reader;
      // change targets use its quantity-scoped reader, never today's-level reader.
      const isChange = n.goal_threshold_frame === 'change_rel' || n.goal_threshold_frame === 'change_abs';
      const figure = Math.round(value * 1e9) / 1e9;
      const written = isChange ? wrote(figure, unit, [n.label]) : figureTheUserWrote(figure, unit, row.brief);
      if (eligible(value) && !written) {
        add('H3', n.id, 'threshold_source', value, JSON.stringify({ threshold_source: n.threshold_source, goal_threshold_raw: n.goal_threshold_raw, goal_threshold_frame: n.goal_threshold_frame }), unit, 'target');
      }
    }
  }
  for (const e of graph.edges) {
    const source = graph.nodes.find(n => n.id === e.from);
    const target = graph.nodes.find(n => n.id === e.to);
    const id = e.id ?? `${e.from}->${e.to}`;
    const labels = [source?.label ?? e.from, target?.label ?? e.to];
    const effect = e.provenance?.natural_effect;
    if (effect !== undefined && eligible(effect.amount)) {
      const value = Math.abs(effect.amount);
      let written = wrote(value, effect.amount_unit, labels);
      // A product partial carries the OTHER operand's stated level in that
      // operand's own units (e.g. 400 customers or 150 subscribers). Never
      // multiply operands to infer that the user wrote a composed total.
      const identity = target?.nonlinear_identity;
      const operandLabels = new Set<string>();
      if (identity?.operation === 'product' && identity.factor_ids.includes(e.from)) {
        for (const id of identity.factor_ids.filter(id => id !== e.from)) {
          const operand = graph.nodes.find(n => n.id === id);
          if (operand !== undefined) operandLabels.add(operand.label);
        }
      }
      // Admission can withhold the identity carrier while retaining its sized
      // edges. Bind those partials using the original typed identity, but only
      // when BOTH link endpoints and the other operand survive on the graph.
      for (const drafted of candidate.identities ?? []) {
        if (drafted.operation === 'product' && drafted.outcome === target?.label && drafted.factors.includes(source?.label ?? '')) {
          for (const label of drafted.factors.filter(label => label !== source?.label)) operandLabels.add(label);
        }
      }
      written ||= [...operandLabels].some(label => {
        const operand = graph.nodes.find(n => n.label === label);
        if (operand === undefined) return false;
        // An option feeding this operand supplies its entity context too:
        // "starter tier ... 150 new subscribers" names Launch starter tier.
        // Use registered node/link labels, never invented aliases or keywords.
        const options = graph.edges.filter(link => link.to === operand.id)
          .flatMap(link => graph.nodes.filter(n => n.id === link.from && n.kind === 'option').map(n => n.label));
        return wrote(value, operand.observed_state?.unit ?? operand.unit, [...labels, operand.label, ...options]);
      });
      const magnitude = e.provenance?.magnitude;
      if ((magnitude === 'olumi_estimate' || magnitude === 'olumi_placeholder') && written) {
        add('H4', id, 'provenance.magnitude', value, JSON.stringify(e.provenance), effect.amount_unit);
      }
      if (magnitude === 'user_stated' && !written) {
        add('H5', id, 'provenance.magnitude', value, JSON.stringify(e.provenance), effect.amount_unit);
      }
    }
    const ranges = [
      ['range', e.range], ['provenance.range', e.provenance?.range],
      ['provenance.natural_effect.stated_range', effect?.stated_range],
    ] as const;
    for (const [field, range] of ranges) {
      if (range === undefined || (range.source ?? e.provenance?.source) !== 'brief_extraction') continue;
      const unit = effect?.amount_unit;
      const receipt = effect === undefined ? null : writtenRangeFor(Math.abs(effect.amount), unit, row.brief, {
        source: labels[0]!, sourceUnit: source?.observed_state?.unit ?? source?.unit,
        others: scope(labels).others,
      });
      for (const end of ['low', 'high'] as const) {
        const value = range[end];
        // writtenRangeFor covers an endpoint-bound range. Centre ranges also
        // occur here; their endpoint-presence check uses the same scoped reader.
        if (eligible(value) && !(receipt?.[end] === value || wrote(value, unit, labels))) {
          add('H3', id, `${field}.${end}`, value, JSON.stringify(range), unit, 'range');
        }
      }
    }
  }
  return out;
}

it('S7 honesty census: stored construction replays and planted H3 controls', async () => {
  const corpus: Row[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/s7-construction-census/corpus.json.gz', import.meta.url))).toString('utf8'));
  const r2: Row[] = JSON.parse(fs.readFileSync(new URL('./fixtures/s7-a2-r2.json', import.meta.url), 'utf8'));
  const redraw: Row[] = JSON.parse(fs.readFileSync(new URL('./fixtures/s7-2bb-redraw.json', import.meta.url), 'utf8'));
  const unseen: Row[] = process.env.S7_UNSEEN_ROWS ? JSON.parse(fs.readFileSync(process.env.S7_UNSEEN_ROWS, 'utf8')) : [];
  const rows = [...corpus, ...r2, ...redraw, ...unseen];
  const totals = empty();
  const labels: LabelledInstance[] = process.env.S7_HONESTY_LABELS
    ? JSON.parse(fs.readFileSync(process.env.S7_HONESTY_LABELS, 'utf8')) : [];
  // Re-score newly gained authority credit against the saved pre-fix probes,
  // as in the original P02 triple; pre-existing credit is not a gain.
  const baseline = new Map<number, boolean>(process.env.S7_HONESTY_BASELINE
    ? fs.readFileSync(process.env.S7_HONESTY_BASELINE, 'utf8').split('\n')
      .filter(line => line.startsWith('S7DIRECT ')).map(line => {
        const probe = JSON.parse(line.slice('S7DIRECT '.length)) as { instance: number; wrote: boolean };
        return [probe.instance, probe.wrote] as const;
      }) : []);
  const rescored: { instance: number; expected: boolean | 'derived'; credited: boolean }[] = [];
  let replayCount = 0;
  let controlBase: { row: Row; served: Served } | undefined;
  for (const row of rows) {
    const served = await replay(row);
    replayCount++;
    const found = census(row, served);
    for (const h of classes) totals[h].push(...found[h]);
    for (const labelled of labels.filter(l => l.row_id === row.id)) {
      expect(baseline.has(labelled.instance), `P02 baseline #${labelled.instance}`).toBe(true);
      const quantities = served.graph.nodes.filter(n => !['option', 'decision'].includes(n.kind));
      const node = served.graph.nodes.find(n => n.id === labelled.entity_id);
      const edge = served.graph.edges.find(e => (e.id ?? `${e.from}->${e.to}`) === labelled.entity_id);
      expect(node ?? edge, `P02 #${labelled.instance}`).toBeDefined();
      const target = node ? [node.label] : [edge!.from, edge!.to].map(id => served.graph.nodes.find(n => n.id === id)?.label ?? id);
      const others = quantities.map(n => n.label).filter(l => !target.includes(l));
      // P02 labels adjudicate H3 current-level credit (#25 is explicitly NOT
      // current), independently of a served goal's separate target stamp.
      const wrote = labelled.class === 'H3' && node?.kind === 'goal'
        ? goalLevelTheUserWrote({ goal: { metric: node.label }, factors: quantities.filter(q => q.id !== node.id) }, row.brief)(labelled.figure, labelled.unit)
        : figureTheUserWroteFor(labelled.figure, labelled.unit, row.brief, {
          target, others, ...(labelled.class === 'H3' ? { currentLevel: true as const } : {}),
        });
      rescored.push({ instance: labelled.instance, expected: labelled.label_should_credit_user, credited: baseline.get(labelled.instance) === false && wrote });
    }
    if (process.env.S7_HONESTY_AUDIT === '1') {
      for (const h of ['H3', 'H4', 'H5'] as const) {
        // Bypass reporters that suppress console logs for passing tests.
        for (const instance of found[h]) process.stdout.write(`S7AUDIT ${JSON.stringify(auditInstance(h, instance, row, served.graph))}\n`);
      }
    }
    if (row.id === 'R2/B2-A') controlBase = { row, served };
  }
  expect(replayCount).toBe(132 + unseen.length);
  expect(rescored).toHaveLength(labels.length);
  const p02 = {
    labelled_count: rescored.length,
    credited_true: rescored.filter(r => r.expected === true && r.credited).length,
    credited_false: rescored.filter(r => r.expected === false && r.credited).length,
    still_missed: rescored.filter(r => r.expected === true && !r.credited).length,
    false_credit_ids: rescored.filter(r => r.expected === false && r.credited).map(r => r.instance),
    still_missed_ids: rescored.filter(r => r.expected === true && !r.credited).map(r => r.instance),
  };
  expect(p02.credited_false).toBe(0);

  // Plant on COPIES of the served row/graph, after admission: planting on the
  // drafter would test the production withdrawal instead of this detector.
  const { row, served } = controlBase!;
  const factor = served.graph.nodes.find(n => n.kind === 'factor' && n.label === 'Support cost per starter subscriber')!;
  const control = (id: string, value: number) => {
    const plantedRow = { ...structuredClone(row), id };
    const planted = structuredClone(served);
    const node = planted.graph.nodes.find(n => n.id === factor.id)!;
    node.observed_state = { ...node.observed_state, source: 'brief_extraction', raw_value: value, value };
    return census(plantedRow, planted).H3.filter(i => i.entity_id === factor.id && i.field === 'observed_state');
  };
  const absent = 987654321;
  expect(figureTheUserWrote(absent, factor.observed_state?.unit, row.brief)).toBe(false);
  const falseUser = control('control/R2/B2-A/unstated', absent);
  const written = control('control/R2/B2-A/written', 6);
  expect(falseUser).toHaveLength(1);
  expect(written).toHaveLength(0);

  const targetRow = { ...structuredClone(row), id: 'control/R2/B2-A/unstated-target' };
  const targetServed = structuredClone(served);
  const goal = targetServed.graph.nodes.find(n => n.kind === 'goal')!;
  goal.threshold_source = 'brief_extraction';
  goal.goal_threshold_raw = absent;
  goal.goal_threshold_frame = 'level';
  expect(figureTheUserWrote(absent, goal.goal_threshold_unit, row.brief)).toBe(false);
  const falseTarget = census(targetRow, targetServed).H3.filter(i => i.entity_id === goal.id && i.role === 'target');
  expect(falseTarget).toHaveLength(1);

  // Positive target contrast: the actual target must survive the target reader.
  const writtenTargetRow = { ...structuredClone(row), id: 'control/R2/B2-A/written-target' };
  const writtenTarget = census(writtenTargetRow, served).H3.filter(i => i.role === 'target');
  expect(served.graph.nodes.find(n => n.kind === 'goal')?.threshold_source).toBe('brief_extraction');
  expect(writtenTarget).toHaveLength(0);
  const summary = {
    replay_count: replayCount, unseen_count: unseen.length,
    counts: Object.fromEntries(classes.map(h => [h, totals[h].length])),
    h3_by_role: Object.fromEntries((['current', 'target', 'range'] as const).map(role => [role, totals.H3.filter(i => i.role === role).length])),
    ...(labels.length === 0 ? {} : { p02_rescore: p02 }),
    row_ids: Object.fromEntries(classes.map(h => [h, [...new Set(totals[h].map(i => i.row_id))]])),
    examples: Object.fromEntries(classes.map(h => [h, totals[h].slice(0, 3)])),
    controls: {
      false_user: { h3_count: falseUser.length, instances: falseUser },
      written: { row_id: 'control/R2/B2-A/written', entity_id: factor.id, figure: 6, h3_count: written.length },
      false_target: { h3_count: falseTarget.length, instances: falseTarget },
      written_target: { row_id: writtenTargetRow.id, h3_count: writtenTarget.length },
    },
    b2_d2_h4: totals.H4.filter(i => i.row_id === '2bb/B2-d2'),
    precision_limits: [
      'Absolute amounts 0 and 1 are excluded from every numeric class, including range endpoints; common numbers such as 12 can still match by accident.',
      'Scoped presence is the existing reader verdict, not semantic attestation: shared labels, unnamed clauses, synonyms, clause boundaries and unit recognition can over-credit or under-credit.',
      'Product partials also check the other operand label/unit and its linked option labels, using served or original typed identities with surviving graph endpoints; no composed total is inferred. Centre-range endpoints use scoped presence, not a new range parser.',
      'H1 binds the original candidate intervention and quoted option/factor names; identical result strings count once. Stamp examples quote the served field JSON because no prose sentence is required.',
    ],
  };
  process.stdout.write(`S7 HONESTY CENSUS ${JSON.stringify(summary)}\n`);
  // Census only: no baseline, no assertion on any production H-class count.
}, 120_000);
