/** Local v1 carrier: copy this schema and inferred type together into the later DGAI PR. */
import { z } from 'zod';
import { validateAnalysisRunFactIdentity } from '../../../context/analysis-interpretation-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { extractAnalysedOptionIds } from '../../../context/option-identity.js';
import { methodTurnForReadback, planPickChipId, serverStoryParts, storyParts, type RunMethodTurn } from '../../method-turn/method-turn.js';
import { assembleGuidanceSignals } from '../../turn-context/guidance-signals.js';
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
  z.object({ kind: z.literal('risk'), ids: z.array(id).min(1), labels: z.array(text).min(1) }).strict(),
  z.object({ kind: z.literal('link'), ids: z.array(id).min(1), labels: z.array(text).min(2) }).strict(),
  z.object({ kind: z.literal('not_in_model'), label: z.literal(PREMORTEM_COPY.outside) }).strict(),
]);
const riskRequestSchema = z.object({
  chip_id: z.literal('agent-next-suggest-risks'),
  message: text,
  affected_node_id: id,
  direction,
  grounding_ids: z.array(id),
}).strict();
/**
 * v2 (P02, 7 Oct): every row carries its Mitigate line and who wrote it; a story about a risk ALREADY in the model
 * names it by id (`on_map`: Inspect, never Add); only a new risk carries `risk_request` (Add). A server-built row
 * (the story Olumi wrote when the draft's was refused) carries neither: it proposes no model text.
 */
export const PremortemWorksheetV1Schema = z.object({
  kind: z.literal('premortem'), version: z.literal(2), scenario_id: id, turn_id: id,
  run: runSchema, binding: bindingSchema,
  rows: z.array(z.object({
    row_id: id, option_id: id, option_label: text,
    // Required on every numbered story (the server owns 'Mitigate:'); the optional outside row may omit it.
    failure_way: text, early_warning: text, mitigation: text.optional(),
    grounding: groundingSchema, provenance: z.literal('olumi_hypothesis'),
    source: z.enum(['olumi_drafted', 'server_built']),
    risk_request: riskRequestSchema.optional(),
    on_map: z.object({ node_id: id, label: text }).strict().optional(),
  }).strict()).min(1).max(4),
  coverage: z.array(z.object({ option_id: id, option_label: text, status: z.enum(['stress_tested', 'not_stress_tested']) }).strict()),
  blindspot_question: text.refine(s => s.endsWith('?')),
}).strict().superRefine((w, ctx) => {
  const issue = () => ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid worksheet binding' });
  if (w.binding.scenario_id !== w.scenario_id || w.binding.graph_revision !== w.run.graph_hash_at_run) issue();
  if (new Set(w.rows.map(r => r.row_id)).size !== w.rows.length || new Set(w.coverage.map(c => c.option_id)).size !== w.coverage.length) issue();
  for (const r of w.rows) {
    const ids = r.grounding.kind === 'not_in_model' ? [] : r.grounding.ids;
    if (new Set(ids).size !== ids.length || (r.risk_request !== undefined && JSON.stringify(ids) !== JSON.stringify(r.risk_request.grounding_ids))) issue();
    if (r.risk_request !== undefined && (r.on_map !== undefined || r.source === 'server_built')) issue();
    if (r.mitigation === undefined && r.grounding.kind !== 'not_in_model') issue();
    if (!w.coverage.some(c => c.option_id === r.option_id && c.option_label === r.option_label && c.status === 'stress_tested')) issue();
  }
  for (const c of w.coverage) if ((c.status === 'stress_tested') !== w.rows.some(r => r.option_id === c.option_id)) issue();
});
export type PremortemWorksheetV1 = z.infer<typeof PremortemWorksheetV1Schema>;

// The model supplies rows only; all identities, coverage, provenance, labels and requests are server-bound.
const candidateSchema = z.object({
  option_id: id, story_index: z.number().int().min(1).max(3).nullable(),
  failure_way: text, early_warning: text, mitigation: text.optional(),
  grounding: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('factor'), ids: z.array(id).min(1).max(3) }).strict(),
    z.object({ kind: z.literal('risk'), ids: z.array(id).min(1).max(3) }).strict(),
    z.object({ kind: z.literal('link'), ids: z.array(id).min(1).max(3) }).strict(),
    z.object({ kind: z.literal('not_in_model') }).strict(),
  ]),
  risk: z.object({ label: text, affected_node_id: id, direction }).strict(),
}).strict();
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const records = (v: unknown): Rec[] => Array.isArray(v) ? v.map(rec).filter((x): x is Rec => x !== undefined) : [];
const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[‘’]/gu, "'").replace(/\s+/gu, ' ').trim();
const labelPattern = (label: string, flags = 'u') => {
  const escape = fold(label).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escape}(?![\\p{L}\\p{N}_])`, flags);
};
const contains = (s: string, label: string) => labelPattern(label).test(fold(s));

/** Ban Olumi-authored wording only; exact final-graph labels retain the user's words. */
export function authoredBanAfterMasking(field: string, nodeLabels: readonly string[]): boolean {
  const labels = [...new Set(nodeLabels.map(fold).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (labels.length === 0) return authoredBan.test(fold(field));
  // One pass (DL: 50 per-label passes took 24 ms at 20k chars); longest first inside the alternation.
  const alternation = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  const masked = fold(field).replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`, 'gu'), ' ');
  return authoredBan.test(masked);
}

/** Append to the existing directive; its prose grammar and checker remain unchanged. */
export function premortemProducerDirective(turn: RunMethodTurn, graph: unknown): string {
  const nodes = records(rec(graph)?.nodes);
  const options = nodes.filter(n => n.kind === 'option').map(n => ({ id: n.id, label: n.label }));
  return [
    'After the complete prose reply, on a new line append <premortem_rows>JSON array</premortem_rows>. This appendix is separate from the prose word cap.',
    'Each row: {option_id,story_index,failure_way,early_warning,mitigation?,grounding:{kind:"factor"|"link"|"risk",ids:[supplied ids]}|{kind:"not_in_model"},risk:{label,affected_node_id,direction:"positive"|"negative"}}.',
    'For grounded rows story_index is the numbered prose story (1-based). Copy failure_way exactly from that story before Watch for:, early_warning exactly after Watch for: and before Mitigate:, and mitigation exactly after Mitigate:.',
    'Each story must bind to one option. On a generic turn name that option in the story. Never guess an option from an ambiguous shared path.',
    'At most one outside candidate, separately imagined, with story_index:null and zero model ids. Never convert the Outside the model QUESTION into a failure way. Omit uncertain rows.',
    `Chosen option: ${turn.context.plan?.option_id ?? 'none; bind each story explicitly'}. Model options: ${JSON.stringify(options)}.`,
    // Limit grounding needs its own validation and is a follow-up.
    `Eligible grounding: ${JSON.stringify(turn.context.supplied_items.filter(i => i.kind === 'factor' || i.kind === 'link' || i.kind === 'risk').map(({ id, kind, labels }) => ({ id, kind, labels })))}.`,
    `Risk destinations (goal/outcome only): ${JSON.stringify(nodes.filter(n => n.kind === 'goal' || n.kind === 'outcome').map(n => ({ id: n.id, label: n.label })))}.`,
    'Risk label names one new risk, copied verbatim as a short phrase from failure_way. Direction says whether it raises or lowers the destination, as an Olumi hypothesis for the user to challenge. No invented ids.',
    'A story about a risk already in the model grounds on it: grounding {kind:"risk",ids:[that risk id]}, and risk.label is that risk\'s exact label. It is never proposed again as new.',
    'No most likely, best, winner, recommend, leads, ahead, beats, probability, likelihood, chance, odds or percentages in your authored words. Copy supplied node labels exactly, even when those labels contain these words or percentages.',
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

export type PremortemDropReason =
  | 'schema' | 'scoped_not_run' | 'decision_option_ineligible' | 'plan_mismatch' | 'destination' | 'risk_label'
  | 'outside_invalid' | 'story_missing' | 'story_parts_mismatch' | 'named_options'
  | 'dup_ids' | 'supplied_mismatch' | 'grounding_invalid' | 'final_label_drift'
  | 'duplicate_key' | 'risk_request_schema' | 'authored_ban';
export type PremortemExit =
  | 'not_passed' | 'no_turn' | 'no_initial' | 'no_turn_id' | 'candidates_invalid'
  | 'stamp_missing' | 'run_changed' | 'graph_changed' | 'no_blindspot'
  | 'worksheet_invalid' | 'exception';
export interface PremortemWorksheetDiagnostics {
  worksheet: PremortemWorksheetV1 | undefined;
  /** Coded boundary failures only; never reply or candidate prose. */
  exit?: PremortemExit;
  dropped: { story_index: number | null; option_id: string | null; reason: PremortemDropReason }[];
  stories: number;
  /** Validated rows before the all-or-nothing emission gate, including an optional outside row. */
  rows: number;
}

/** Total, fail-closed emission boundary. Never mint a Run stamp from the current graph alone. */
export function premortemWorksheetDiagnosticsFor(input: {
  scenarioId: string; turnId: string | undefined; turn: RunMethodTurn | null;
  passed: boolean; reply: string; candidates: unknown; initial: PremortemRead | undefined; final: PremortemRead;
}): PremortemWorksheetDiagnostics {
  const diagnostics: PremortemWorksheetDiagnostics = { worksheet: undefined, dropped: [], stories: 0, rows: 0 };
  const exit = (code: PremortemExit): PremortemWorksheetDiagnostics => { diagnostics.exit = code; return diagnostics; };
  try {
    // Markers may arrive bolded (served a2-2, 7 Oct: "   **Watch for:** …"); `(?:\*\*)?` around each marker, nothing else.
    const stories = [...input.reply.matchAll(/^[ \t]{0,8}[1-9]\.[ \t]{1,4}([\s\S]*?)(?=^[ \t]{0,8}[1-9]\.[ \t]|^[ \t]{0,8}(?:\*\*)?Outside the model:|$(?![\s\S]))/gmu)].map(m => m[1].trim());
    diagnostics.stories = stories.length;
    const { turn, initial, final, scenarioId } = input;
    if (!input.passed) return exit('not_passed');
    if (turn === null) return exit('no_turn');
    if (initial === undefined) return exit('no_initial');
    if (input.turnId === undefined) return exit('no_turn_id');
    if (!Array.isArray(input.candidates) || input.candidates.length > 4) return exit('candidates_invalid');
    const run = stamp(initial, scenarioId), finalRun = stamp(final, scenarioId);
    if (run === null || finalRun === null) return exit('stamp_missing');
    if (contentHash(run) !== contentHash(finalRun)) return exit('run_changed');
    if (contentHash(initial.graph) !== contentHash(final.graph)) return exit('graph_changed');
    const nodes = records(rec(final.graph)?.nodes), edges = records(rec(final.graph)?.edges);
    const nodeLabels = nodes.flatMap(n => typeof n.label === 'string' ? [n.label] : []);
    const uniqueNode = (nodeId: string, kind?: string): Rec | undefined => {
      const matches = nodes.filter(n => n.id === nodeId && (kind === undefined || n.kind === kind));
      if (matches.length !== 1 || typeof matches[0].label !== 'string') return undefined;
      if (nodes.filter(n => typeof n.label === 'string' && fold(n.label) === fold(String(matches[0].label))).length !== 1) return undefined;
      return matches[0];
    };
    // Whitespace runs bounded (DL 7 Oct): the unbounded `\s*` forms took 0.35–0.8 s on 20k newlines.
    const blindspot = /^[ \t]{0,8}(?:\*\*)?Outside the model:(?:\*\*)?[ \t]{0,8}(.+\?)[ \t]{0,8}$/mu.exec(input.reply)?.[1];
    if (!blindspot) return exit('no_blindspot');
    // A2-ELIG (DL 7 Oct, served B9 req 388cefba): a decision-level story is judged by the eligibility its producer ran
    // under, never by whether a SCOPED press for that option would run. A user-sized option has no scoped item, yet the
    // decision union supplies its own lever for stories ('Raise prices by 10%' sets 'Price rise from current price').
    const decision = turn.context.decision_level === true && turn.context.plan === null;
    // The ONE signal derivation the producer read: own options (status quo and Run exclusions out) and goal paths.
    // Neither signal reads the leader licence, so none is passed.
    const signals = decision ? assembleGuidanceSignals({
      request: 'method', offeredSpecific: [], graph: final.graph, analysisState: final.analysisState,
      analysisResult: final.analysisResult, optionParticipation: final.optionParticipation, leaderLicensed: false,
    }) : null;
    const runOptionIds = decision ? extractAnalysedOptionIds({
      fact_type: 'run_analysis', result: final.analysisResult,
    } as Parameters<typeof extractAnalysedOptionIds>[0]) : null;
    // Per-option path membership, as the scoped gate kept it: an item grounds a story only on that option's own path.
    const onOptionPath = (optionId: string, item: { id: string; kind: string }) =>
      signals?.['model.goal_path_links'].some(l => l.option_ids.includes(optionId)
        && (item.kind === 'link' ? l.link_id === item.id : l.link_id.split('->').includes(item.id))) === true;
    const rows: PremortemWorksheetV1['rows'] = [];
    const seen = new Set<string>();
    const representedStories = new Set<number>();
    const rowStory = new Map<string, number>();
    for (const raw of input.candidates) {
      // Even malformed candidates expose only validated ids and indices, never their prose.
      const metadata = rec(raw);
      const parsedId = id.safeParse(metadata?.option_id);
      const storyIndex = typeof metadata?.story_index === 'number' && Number.isInteger(metadata.story_index)
        && metadata.story_index >= 1 && metadata.story_index <= 3 ? metadata.story_index : null;
      // A model-written string survives only when it IS one of the model's option ids (#2740 Codex P2-1).
      const knownOption = parsedId.success && nodes.some(n => n.kind === 'option' && n.id === parsedId.data);
      const drop = (reason: PremortemDropReason) => diagnostics.dropped.push({
        story_index: storyIndex, option_id: knownOption ? parsedId.data : null, reason,
      });
      const parsed = candidateSchema.safeParse(raw);
      if (!parsed.success) { drop('schema'); continue; }
      const c = parsed.data;
      const option = uniqueNode(c.option_id, 'option');
      // Decision: an own option, unique by label, that this Run analysed. Otherwise the existing scoped selectors own
      // eligibility and per-option path membership. Either way, no second path authority.
      let eligible: RunMethodTurn['context']['supplied_items'];
      if (decision) {
        if (!option || !signals?.['model.non_sq_option_ids'].includes(c.option_id) || !runOptionIds?.includes(c.option_id)) { drop('decision_option_ineligible'); continue; }
        eligible = turn.context.supplied_items.filter(item => onOptionPath(c.option_id, item));
      } else {
        const scoped = methodTurnForReadback(planPickChipId(c.option_id), final);
        if (scoped?.kind !== 'run') { drop('scoped_not_run'); continue; }
        eligible = scoped.context.supplied_items;
      }
      if (!option || (turn.context.plan !== null && c.option_id !== turn.context.plan.option_id)) { drop('plan_mismatch'); continue; }
      // A story resting on a risk already in the model names that risk (A2-ELIG draw 2: its label equalled an existing
      // risk's and the whole worksheet was withheld). Any other existing label is still not a new risk.
      const sameLabel = nodes.filter(n => typeof n.label === 'string' && fold(n.label) === fold(c.risk.label));
      const existingRiskId = c.grounding.kind === 'risk' ? c.grounding.ids[0]
        : sameLabel.length === 1 && sameLabel[0].kind === 'risk' ? String(sameLabel[0].id) : undefined;
      const existingRisk = existingRiskId === undefined ? undefined : uniqueNode(existingRiskId, 'risk');
      if (existingRiskId !== undefined && !existingRisk) { drop('risk_label'); continue; }
      const destination = uniqueNode(c.risk.affected_node_id);
      if (!existingRisk) {
        if (!destination || (destination.kind !== 'goal' && destination.kind !== 'outcome')) { drop('destination'); continue; }
        if (!contains(c.failure_way, c.risk.label) || sameLabel.length > 0) { drop('risk_label'); continue; }
      }
      let grounding: PremortemWorksheetV1['rows'][number]['grounding'];
      let mitigation = c.mitigation;
      if (c.grounding.kind === 'not_in_model') {
        if (existingRisk) { drop('risk_label'); continue; } // an outside story is, by definition, not on the map
        if (c.story_index !== null || c.failure_way.includes('?') || fold(c.failure_way) === fold(blindspot)
          || rows.some(r => r.grounding.kind === 'not_in_model')) { drop('outside_invalid'); continue; }
        grounding = { kind: 'not_in_model', label: PREMORTEM_COPY.outside };
      } else {
        if (c.story_index === null) { drop('story_missing'); continue; }
        const story = stories[c.story_index - 1];
        const parts = story ? storyParts(story) : null;
        if (!parts || parts[0] !== c.failure_way || parts[1] !== c.early_warning || (c.mitigation !== undefined && parts[2] !== c.mitigation)) { drop(story ? 'story_parts_mismatch' : 'story_missing'); continue; }
        mitigation = parts[2];
        const namedOptions = nodes.filter(n => n.kind === 'option' && typeof n.label === 'string' && contains(story, n.label));
        if (namedOptions.some(n => n.id !== c.option_id) || (turn.context.plan === null && namedOptions.length !== 1)) { drop('named_options'); continue; }
        if (new Set(c.grounding.ids).size !== c.grounding.ids.length) { drop('dup_ids'); continue; }
        const supplied = c.grounding.ids.map(id => eligible.find(i => i.id === id && i.kind === c.grounding.kind));
        if (supplied.some(i => !i || !i.labels.every(l => contains(story, l))
          || !turn.context.supplied_items.some(initialItem => initialItem.id === i.id && initialItem.kind === i.kind && JSON.stringify(initialItem.labels) === JSON.stringify(i.labels)))) { drop('supplied_mismatch'); continue; }
        const valid = c.grounding.ids.every(id => c.grounding.kind === 'factor' || c.grounding.kind === 'risk'
          ? uniqueNode(id, c.grounding.kind) !== undefined
          : edges.filter(e => `${String(e.from)}->${String(e.to)}` === id).length === 1
            && id.split('->').every(end => uniqueNode(end) !== undefined));
        if (!valid) { drop('grounding_invalid'); continue; }
        // A labelled supplied item must still describe the final graph exactly.
        if (supplied.some(i => !i || (i.kind === 'factor' || i.kind === 'risk' ? uniqueNode(i.id)?.label !== i.labels[0]
          : i.id.split('->').some((end, index) => uniqueNode(end)?.label !== i.labels[index])))) { drop('final_label_drift'); continue; }
        grounding = { kind: c.grounding.kind, ids: c.grounding.ids, labels: [...new Set(supplied.flatMap(i => i?.labels ?? []))] };
        // An existing risk is named only when THIS story names it and it is on THIS option's own path (buddy r1 P1).
        if (existingRisk && (!contains(story, String(existingRisk.label))
          || !eligible.some(i => i.kind === 'risk' && i.id === existingRisk.id))) { drop('risk_label'); continue; }
      }
      const key = `${c.option_id}:${c.story_index ?? 'outside'}`;
      if (seen.has(key)) { drop('duplicate_key'); continue; }
      seen.add(key);
      const groundingIds = grounding.kind === 'not_in_model' ? [] : grounding.ids;
      const message = existingRisk || !destination ? undefined
        : `Prepare one risk called ${JSON.stringify(c.risk.label)}: ${c.failure_way} It would ${c.risk.direction === 'negative' ? 'lower' : 'raise'} ${JSON.stringify(destination.label)}. Early warning: ${c.early_warning} Olumi hypothesis — for you to challenge. Show the proposed change for approval.`;
      // Schemas own shape and length; only this boundary has every final node label.
      if ([c.failure_way, c.early_warning, mitigation, existingRisk ? undefined : c.risk.label, message]
        .some(field => field !== undefined && authoredBanAfterMasking(field, nodeLabels))) { drop('authored_ban'); continue; }
      const row: PremortemWorksheetV1['rows'][number] = {
        row_id: `pm_${contentHash({ scenarioId, run, key, candidate: c }).slice(0, 24)}`,
        option_id: c.option_id, option_label: String(option.label), failure_way: c.failure_way, early_warning: c.early_warning,
        ...(mitigation !== undefined ? { mitigation } : {}), grounding, provenance: provenance('olumi_hypothesis') as 'olumi_hypothesis', source: 'olumi_drafted',
        ...(existingRisk ? { on_map: { node_id: String(existingRisk.id), label: String(existingRisk.label) } }
          : { risk_request: { chip_id: 'agent-next-suggest-risks' as const, message: message!, affected_node_id: c.risk.affected_node_id, direction: c.risk.direction, grounding_ids: groundingIds } }),
      };
      if (row.risk_request !== undefined && !riskRequestSchema.safeParse(row.risk_request).success) { drop('risk_request_schema'); continue; }
      rows.push(row);
      if (c.story_index !== null) { representedStories.add(c.story_index); rowStory.set(row.row_id, c.story_index); }
    }
    // P02: settle replaced a refused story with the server's own story for one supplied item. It is recognised by its
    // exact parts, only among the stories no candidate holds, and its row is built from typed state alone (no model
    // text, so no Add). A candidate that described the replaced story is not on the wire, so its drop is not kept.
    const serverBuilt = new Map<number, RunMethodTurn['context']['supplied_items'][number]>();
    stories.forEach((story, index) => {
      if (representedStories.has(index + 1)) return;
      const parts = storyParts(story);
      const item = parts === null ? undefined : turn.context.supplied_items.find(i =>
        JSON.stringify(serverStoryParts(i, turn.context)) === JSON.stringify(parts));
      if (item !== undefined) serverBuilt.set(index + 1, item);
    });
    diagnostics.dropped = diagnostics.dropped.filter(d => d.story_index === null || !serverBuilt.has(d.story_index));
    for (const [storyIndex, item] of serverBuilt) {
      const parts = storyParts(stories[storyIndex - 1]);
      if (parts === null || item.kind === 'limit') continue;
      // One option, by id: the plan, else the lever's own option, else the one own option whose goal path holds it.
      const optionIds = turn.context.plan !== null ? [turn.context.plan.option_id]
        // A lever names its options by label; each own option's label is unique (uniqueNode), so the id is recovered exactly.
        : item.lever_option_labels !== undefined
          // Fail closed: one ambiguous label and the row binds to no option (buddy r1 P2).
          ? ((found) => found.every(f => f.length === 1) ? found.map(f => String(f[0].id)) : [])(item.lever_option_labels
            .map(label => nodes.filter(n => typeof n.label === 'string' && fold(n.label) === fold(label))))
          : (signals?.['model.non_sq_option_ids'] ?? []).filter(o => onOptionPath(o, item));
      const optionId = optionIds.length === 1 ? optionIds[0] : undefined;
      const option = optionId === undefined ? undefined : uniqueNode(optionId, 'option');
      if (optionId === undefined || !option) continue;
      if (decision && (!signals?.['model.non_sq_option_ids'].includes(optionId) || !runOptionIds?.includes(optionId) || !onOptionPath(optionId, item))) continue;
      const namedOptions = nodes.filter(n => n.kind === 'option' && typeof n.label === 'string' && contains(stories[storyIndex - 1], n.label));
      if (namedOptions.some(n => n.id !== optionId)) continue;
      const node = item.kind === 'link' ? undefined : uniqueNode(item.id, item.kind);
      const valid = item.kind === 'link'
        ? edges.filter(e => `${String(e.from)}->${String(e.to)}` === item.id).length === 1
          && item.id.split('->').every((end, index) => uniqueNode(end)?.label === item.labels[index])
        : node?.label === item.labels[0];
      if (!valid || parts.some(field => authoredBanAfterMasking(field, nodeLabels))) continue;
      const key = `${optionId}:${storyIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        row_id: `pm_${contentHash({ scenarioId, run, key, server_item: item.id }).slice(0, 24)}`,
        option_id: optionId, option_label: String(option.label), failure_way: parts[0], early_warning: parts[1], mitigation: parts[2],
        grounding: { kind: item.kind, ids: [item.id], labels: [...item.labels] },
        provenance: provenance('olumi_hypothesis') as 'olumi_hypothesis', source: 'server_built',
        ...(item.kind === 'risk' && node ? { on_map: { node_id: item.id, label: String(node.label) } } : {}),
      });
      representedStories.add(storyIndex);
      rowStory.set(rows[rows.length - 1].row_id, storyIndex);
    }
    // Rows in story order, the outside row last: the worksheet reads as the chat does.
    const order = (r: PremortemWorksheetV1['rows'][number]) => rowStory.get(r.row_id) ?? 99;
    rows.sort((a, b) => order(a) - order(b));
    diagnostics.rows = rows.length;
    // An optional outside row cannot stand in for a numbered story. Extra invalid candidates
    // do not withhold a worksheet when every story still has a validated row.
    for (let index = 1; index <= stories.length; index++) {
      if (!representedStories.has(index) && !diagnostics.dropped.some(d => d.story_index === index)) {
        diagnostics.dropped.push({ story_index: index, option_id: null, reason: 'story_missing' });
      }
    }
    if (stories.some((_, index) => !representedStories.has(index + 1))) return diagnostics;
    const envelope = {
      kind: 'premortem', version: 2, scenario_id: scenarioId, turn_id: input.turnId, run,
      binding: binding(scenarioId, run.graph_hash_at_run, [dependency('map_structure', 'whole_graph', final.graph), dependency('analysis', 'run', run)]),
      rows, coverage: nodes.filter(n => n.kind === 'option').map(n => ({ option_id: n.id, option_label: n.label, status: rows.some(r => r.option_id === n.id) ? 'stress_tested' : 'not_stress_tested' })),
      blindspot_question: blindspot,
    };
    const checked = PremortemWorksheetV1Schema.safeParse(envelope);
    diagnostics.worksheet = checked.success ? checked.data : undefined;
    if (!checked.success) return exit('worksheet_invalid');
    return diagnostics;
  } catch { return exit('exception'); }
}

/** Existing callers retain the worksheet-only API. */
export function premortemWorksheetFor(input: Parameters<typeof premortemWorksheetDiagnosticsFor>[0]): PremortemWorksheetV1 | undefined {
  return premortemWorksheetDiagnosticsFor(input).worksheet;
}
