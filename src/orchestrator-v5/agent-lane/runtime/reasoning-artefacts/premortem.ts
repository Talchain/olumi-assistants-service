/** Local v1 carrier: copy this schema and inferred type together into the later DGAI PR. */
import { z } from 'zod';
import { validateAnalysisRunFactIdentity } from '../../../context/analysis-interpretation-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { methodTurnForReadback, planPickChipId, type RunMethodTurn } from '../../method-turn/method-turn.js';
import { binding, contentHash, dependency, provenance } from './common.js';

export const PREMORTEM_COPY = {
  title: 'Imagine it failed: plausible ways',
  warning: 'Early warning',
  outside: 'not in the model yet',
  provenance: 'Olumi hypothesis — for you to challenge',
} as const;
const text = z.string().min(1).max(1600).refine(s => s.trim().length > 0);
const id = z.string().min(1).max(160);
const direction = z.enum(['positive', 'negative']);
const authoredBan = /%|\b(?:most likely|likely|likelihood|chance|probability|probable|odds|best|winners?|winning|recommend\w*|leads?|ahead|beats?)\b/iu;
const safeText = text.refine(s => !authoredBan.test(s), 'unlicensed wording');
const runSchema = z.object({
  graph_hash_at_run: z.string().regex(/^[0-9a-f]{16}$/u),
  computed_at: z.string().refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s),
  run_id: id.optional(),
}).strict();
const dependencySchema = z.object({
  kind: z.enum(['option', 'criterion', 'preference', 'utility', 'constraint', 'analysis', 'source', 'claim', 'fact_verdict', 'model_element', 'map_structure', 'protocol']),
  id,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict();
const bindingSchema = z.object({ scenario_id: id, graph_revision: id, dependencies: z.array(dependencySchema).min(2) }).strict();
const groundingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('factor'), ids: z.array(id).min(1), labels: z.array(text).min(1) }).strict(),
  z.object({ kind: z.literal('link'), ids: z.array(id).min(1), labels: z.array(text).min(2) }).strict(),
  z.object({ kind: z.literal('not_in_model'), label: z.literal(PREMORTEM_COPY.outside) }).strict(),
]);
const riskRequestSchema = z.object({
  chip_id: z.literal('agent-next-suggest-risks'),
  message: safeText,
  affected_node_id: id,
  direction,
  grounding_ids: z.array(id),
}).strict();
export const PremortemWorksheetV1Schema = z.object({
  kind: z.literal('premortem'), version: z.literal(1), scenario_id: id, turn_id: id,
  run: runSchema, binding: bindingSchema,
  rows: z.array(z.object({
    row_id: id, option_id: id, option_label: text,
    failure_way: safeText, early_warning: safeText, mitigation: safeText.optional(),
    grounding: groundingSchema, provenance: z.literal('olumi_hypothesis'), risk_request: riskRequestSchema,
  }).strict()).min(1).max(4),
  coverage: z.array(z.object({ option_id: id, option_label: text, status: z.enum(['stress_tested', 'not_stress_tested']) }).strict()),
  blindspot_question: text.refine(s => s.endsWith('?')),
}).strict().superRefine((w, ctx) => {
  const issue = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid worksheet binding' });
  if (w.binding.scenario_id !== w.scenario_id || w.binding.graph_revision !== w.run.graph_hash_at_run) issue();
  if (new Set(w.rows.map(r => r.row_id)).size !== w.rows.length || new Set(w.coverage.map(c => c.option_id)).size !== w.coverage.length) issue();
  for (const r of w.rows) {
    const ids = r.grounding.kind === 'not_in_model' ? [] : r.grounding.ids;
    if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(r.risk_request.grounding_ids)) issue();
    if (!w.coverage.some(c => c.option_id === r.option_id && c.option_label === r.option_label && c.status === 'stress_tested')) issue();
  }
  for (const c of w.coverage) if ((c.status === 'stress_tested') !== w.rows.some(r => r.option_id === c.option_id)) issue();
});
export type PremortemWorksheetV1 = z.infer<typeof PremortemWorksheetV1Schema>;

// The model supplies rows only; all identities, coverage, provenance, labels and requests are server-bound.
const candidateSchema = z.object({
  option_id: id, story_index: z.number().int().min(1).max(3).nullable(),
  failure_way: safeText, early_warning: safeText, mitigation: safeText.optional(),
  grounding: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('factor'), ids: z.array(id).min(1).max(3) }).strict(),
    z.object({ kind: z.literal('link'), ids: z.array(id).min(1).max(3) }).strict(),
    z.object({ kind: z.literal('not_in_model') }).strict(),
  ]),
  risk: z.object({ label: safeText, affected_node_id: id, direction }).strict(),
}).strict();
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const records = (v: unknown): Rec[] => Array.isArray(v) ? v.map(rec).filter((x): x is Rec => x !== undefined) : [];
const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[‘’]/gu, "'").replace(/\s+/gu, ' ').trim();
const contains = (s: string, label: string) => {
  const escape = fold(label).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escape}(?![\\p{L}\\p{N}_])`, 'u').test(fold(s));
};

/** Append to the existing directive; its prose grammar and checker remain unchanged. */
export function premortemProducerDirective(turn: RunMethodTurn, graph: unknown): string {
  const nodes = records(rec(graph)?.nodes);
  const options = nodes.filter(n => n.kind === 'option').map(n => ({ id: n.id, label: n.label }));
  return [
    'After the complete prose reply, on a new line append <premortem_rows>JSON array</premortem_rows>. This appendix is separate from the prose word cap.',
    'Each row: {option_id,story_index,failure_way,early_warning,mitigation?,grounding:{kind:"factor"|"link",ids:[supplied ids]}|{kind:"not_in_model"},risk:{label,affected_node_id,direction:"positive"|"negative"}}.',
    'For grounded rows story_index is the numbered prose story (1-based). Copy failure_way exactly from that story before Watch for:, early_warning exactly after Watch for: and before Mitigate:, and mitigation exactly after Mitigate:.',
    'Each story must bind to one option. On a generic turn name that option in the story. Never guess an option from an ambiguous shared path.',
    'At most one outside candidate, separately imagined, with story_index:null and zero model ids. Never convert the Outside the model QUESTION into a failure way. Omit uncertain rows.',
    `Chosen option: ${turn.context.plan?.option_id ?? 'none; bind each story explicitly'}. Model options: ${JSON.stringify(options)}.`,
    `Eligible grounding: ${JSON.stringify(turn.context.supplied_items.filter(i => i.kind === 'factor' || i.kind === 'link').map(({ id, kind, labels }) => ({ id, kind, labels })))}.`,
    `Risk destinations (goal/outcome only): ${JSON.stringify(nodes.filter(n => n.kind === 'goal' || n.kind === 'outcome').map(n => ({ id: n.id, label: n.label })))}.`,
    'Risk label names one new risk, copied verbatim as a short phrase from failure_way. Direction says whether it raises or lowers the destination, as an Olumi hypothesis for the user to challenge. No invented ids.',
    'No most likely, best, winner, recommend, leads, ahead, beats, probability, likelihood, chance, odds or percentages anywhere in rows.',
  ].join('\n');
}

/** A malformed appendix costs only the worksheet; old prose-only replies pass through byte-for-byte. */
export function readPremortemProduction(draft: string): { reply: string; candidates: unknown } {
  const start = draft.search(/^<premortem_rows>/mu);
  if (start < 0) return { reply: draft, candidates: undefined };
  const reply = draft.slice(0, start).replace(/\r?\n$/u, '');
  const appendix = draft.slice(start);
  const matched = /^<premortem_rows>([\s\S]*)<\/premortem_rows>\s*$/u.exec(appendix);
  try { return { reply, candidates: matched ? JSON.parse(matched[1]) as unknown : undefined }; }
  catch { return { reply, candidates: undefined }; }
}

export interface PremortemRead { graph?: unknown; graphHash?: string; analysisState?: unknown; analysisResult?: unknown; optionParticipation?: unknown; analysisReady?: unknown; identityEvaluated?: ReadonlySet<string> }
function stamp(read: PremortemRead, scenarioId: string): PremortemWorksheetV1['run'] | null {
  const state = rec(rec(read.analysisState)?.run_state);
  const result = rec(read.analysisResult);
  if (state?.kind !== 'complete_current' || result?.type !== 'analysis_result' || read.graph == null) return null;
  const checked = validateAnalysisRunFactIdentity({ scenario_id: scenarioId, graph_hash_at_run: result.computed_against_hash, computed_at: state.computed_at });
  if (checked.status !== 'confirmed' || read.graphHash !== checked.identity.graph_hash_at_run) return null;
  if (computeAnalysisAffectingGraphHash(read.graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]) !== read.graphHash) return null;
  return { graph_hash_at_run: checked.identity.graph_hash_at_run, computed_at: checked.identity.computed_at,
    ...(typeof result.run_id === 'string' ? { run_id: result.run_id } : {}) };
}

/** Total, fail-closed emission boundary. Never mint a Run stamp from the current graph alone. */
export function premortemWorksheetFor(input: {
  scenarioId: string; turnId: string | undefined; turn: RunMethodTurn | null;
  passed: boolean; reply: string; candidates: unknown; initial: PremortemRead | undefined; final: PremortemRead;
}): PremortemWorksheetV1 | undefined {
  try {
    const { turn, initial, final, scenarioId } = input;
    if (!input.passed || turn === null || initial === undefined || input.turnId === undefined || !Array.isArray(input.candidates) || input.candidates.length > 4) return undefined;
    const run = stamp(initial, scenarioId), finalRun = stamp(final, scenarioId);
    if (run === null || finalRun === null || contentHash(run) !== contentHash(finalRun) || contentHash(initial.graph) !== contentHash(final.graph)) return undefined;
    const nodes = records(rec(final.graph)?.nodes), edges = records(rec(final.graph)?.edges);
    const uniqueNode = (nodeId: string, kind?: string): Rec | undefined => {
      const matches = nodes.filter(n => n.id === nodeId && (kind === undefined || n.kind === kind));
      if (matches.length !== 1 || typeof matches[0].label !== 'string') return undefined;
      if (nodes.filter(n => typeof n.label === 'string' && fold(n.label) === fold(String(matches[0].label))).length !== 1) return undefined;
      return matches[0];
    };
    const stories = [...input.reply.matchAll(/^\s*[1-9]\.\s+([\s\S]*?)(?=^\s*[1-9]\.\s|^\s*Outside the model:|$(?![\s\S]))/gmu)].map(m => m[1].trim());
    const blindspot = /^\s*Outside the model:\s*(.+\?)\s*$/mu.exec(input.reply)?.[1];
    if (!blindspot) return undefined;
    const rows: PremortemWorksheetV1['rows'] = [];
    const seen = new Set<string>();
    for (const raw of input.candidates) {
      const parsed = candidateSchema.safeParse(raw);
      if (!parsed.success) continue;
      const c = parsed.data;
      const option = uniqueNode(c.option_id, 'option');
      const scoped = methodTurnForReadback(planPickChipId(c.option_id), final);
      // The existing selectors own eligibility and per-option path membership. No second path authority.
      if (scoped?.kind !== 'run') continue;
      if (!option || (turn.context.plan !== null && c.option_id !== turn.context.plan.option_id)) continue;
      const destination = uniqueNode(c.risk.affected_node_id);
      if (!destination || (destination.kind !== 'goal' && destination.kind !== 'outcome')) continue;
      if (!contains(c.failure_way, c.risk.label) || nodes.some(n => typeof n.label === 'string' && fold(n.label) === fold(c.risk.label))) continue;
      let grounding: PremortemWorksheetV1['rows'][number]['grounding'];
      if (c.grounding.kind === 'not_in_model') {
        if (c.story_index !== null || c.failure_way.includes('?') || fold(c.failure_way) === fold(blindspot)
          || rows.some(r => r.grounding.kind === 'not_in_model')) continue;
        grounding = { kind: 'not_in_model', label: PREMORTEM_COPY.outside };
      } else {
        if (c.story_index === null) continue;
        const story = stories[c.story_index - 1];
        const parts = story && /^([\s\S]+?)\s*Watch for:\s*([\s\S]+?)\s*Mitigate:\s*([\s\S]+)$/u.exec(story);
        if (!parts || parts[1].trim() !== c.failure_way || parts[2].trim() !== c.early_warning || (c.mitigation !== undefined && parts[3].trim() !== c.mitigation)) continue;
        const namedOptions = nodes.filter(n => n.kind === 'option' && typeof n.label === 'string' && contains(story, n.label));
        if (namedOptions.some(n => n.id !== c.option_id) || (turn.context.plan === null && namedOptions.length !== 1)) continue;
        if (new Set(c.grounding.ids).size !== c.grounding.ids.length) continue;
        const supplied = c.grounding.ids.map(id => scoped.context.supplied_items.find(i => i.id === id && i.kind === c.grounding.kind));
        if (supplied.some(i => !i || !i.labels.every(l => contains(story, l))
          || !turn.context.supplied_items.some(initialItem => initialItem.id === i.id && initialItem.kind === i.kind && JSON.stringify(initialItem.labels) === JSON.stringify(i.labels)))) continue;
        const valid = c.grounding.ids.every(id => c.grounding.kind === 'factor'
          ? uniqueNode(id, 'factor') !== undefined
          : edges.filter(e => `${String(e.from)}->${String(e.to)}` === id).length === 1
            && id.split('->').every(end => uniqueNode(end) !== undefined));
        if (!valid) continue;
        // A labelled supplied item must still describe the final graph exactly.
        if (supplied.some(i => !i || (i.kind === 'factor' ? uniqueNode(i.id)?.label !== i.labels[0]
          : i.id.split('->').some((end, index) => uniqueNode(end)?.label !== i.labels[index])))) continue;
        grounding = { kind: c.grounding.kind, ids: c.grounding.ids, labels: [...new Set(supplied.flatMap(i => i?.labels ?? []))] };
      }
      const key = `${c.option_id}:${c.story_index ?? 'outside'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const groundingIds = grounding.kind === 'not_in_model' ? [] : grounding.ids;
      const message = `Prepare one risk called ${JSON.stringify(c.risk.label)}: ${c.failure_way} It would ${c.risk.direction === 'negative' ? 'lower' : 'raise'} ${JSON.stringify(destination.label)}. Early warning: ${c.early_warning} Olumi hypothesis — for you to challenge. Show the proposed change for approval.`;
      const row: PremortemWorksheetV1['rows'][number] = {
        row_id: `pm_${contentHash({ scenarioId, run, key, candidate: c }).slice(0, 24)}`,
        option_id: c.option_id, option_label: String(option.label), failure_way: c.failure_way, early_warning: c.early_warning,
        ...(c.mitigation !== undefined ? { mitigation: c.mitigation } : {}), grounding,
        provenance: provenance('olumi_hypothesis') as 'olumi_hypothesis',
        risk_request: { chip_id: 'agent-next-suggest-risks', message, affected_node_id: c.risk.affected_node_id, direction: c.risk.direction, grounding_ids: groundingIds },
      };
      // Per-row checks drop only the offending row, including generated request wording.
      if (riskRequestSchema.safeParse(row.risk_request).success) rows.push(row);
    }
    const envelope = {
      kind: 'premortem', version: 1, scenario_id: scenarioId, turn_id: input.turnId, run,
      binding: binding(scenarioId, run.graph_hash_at_run, [dependency('map_structure', 'whole_graph', final.graph), dependency('analysis', 'run', run)]),
      rows, coverage: nodes.filter(n => n.kind === 'option').map(n => ({ option_id: n.id, option_label: n.label, status: rows.some(r => r.option_id === n.id) ? 'stress_tested' : 'not_stress_tested' })),
      blindspot_question: blindspot,
    };
    const checked = PremortemWorksheetV1Schema.safeParse(envelope);
    return checked.success ? checked.data : undefined;
  } catch { return undefined; }
}
