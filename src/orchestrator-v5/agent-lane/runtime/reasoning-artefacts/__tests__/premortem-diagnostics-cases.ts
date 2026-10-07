import { readFileSync } from 'node:fs';
import { computeAnalysisAffectingGraphHash } from '../../../../context/graph-hash.js';
import { readStoredOptionParticipation } from '../../../../tools/handlers/option-participation.js';
import { readEvaluatedIdentityNodeIds } from '../../../admit-model.js';
import { methodTurnForReadback, planPickChipId, PREMORTEM_PRESS_ID } from '../../../method-turn/method-turn.js';
import type { premortemWorksheetDiagnosticsFor, PremortemDropReason, PremortemExit, PremortemRead } from '../premortem.js';
import { candidate, fixture, LINK, OPTION, outside, ONE_STORY_REPLY as REPLY } from './premortem-fixture.js';

type Input = Parameters<typeof premortemWorksheetDiagnosticsFor>[0];
type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
const STARTER = 'launch_starter_tier';
const STARTER_LINK = 'starter_tier_subscribers->monthly_recurring_revenue';
const starter = () => ({
  ...candidate(), option_id: STARTER, story_index: 2,
  failure_way: 'Launch starter tier: Starter-tier subscribers stalled and monthly recurring revenue fell.',
  early_warning: 'Starter sign-ups slowed.', mitigation: 'Test demand before expanding.',
  grounding: { kind: 'link', ids: [STARTER_LINK] },
  risk: { ...candidate().risk, label: 'Starter-tier subscribers stalled' },
});
const numbered = (row: ReturnType<typeof candidate>, index: number) =>
  `${index}. ${row.failure_way} Watch for: ${row.early_warning} Mitigate: ${row.mitigation}`;
const TWO_REPLY = `Imagine the decision went badly.\n${numbered({ ...candidate(), failure_way: `Raise prices: ${candidate().failure_way}` }, 1)}\n${numbered(starter(), 2)}\nOutside the model: what could blindside this work?`;

function input(mutate?: (graph: Graph) => void, generic = false): Input {
  const { read, turn } = fixture();
  if (mutate) {
    mutate(read.graph as Graph);
    read.graphHash = computeAnalysisAffectingGraphHash(read.graph as never)!;
    read.analysisResult = { ...read.analysisResult as object, computed_against_hash: read.graphHash };
  }
  if (generic) read.analysisState = { ...read.analysisState as object, leader_claim: { permitted: false, separation: 'near_tie' } };
  const current = generic ? methodTurnForReadback(PREMORTEM_PRESS_ID, read) : turn;
  // Graph mutation cases keep the original chosen turn's context unless explicitly generic.
  if (generic && current?.kind !== 'run') throw new Error('generic fixture must run');
  return {
    scenarioId: '7a1e2d3c-4b5a-4e6d-9c7b-8a9f0e1d2c01', turnId: 'turn-a2-diagnostics',
    turn: generic && current?.kind === 'run' ? current : turn, passed: true,
    reply: REPLY, candidates: [candidate()], initial: read, final: read,
  };
}

function twoStories(optionLabel = 'Raise prices', mentionedLabel = optionLabel): Input {
  const out = input(graph => {
    graph.nodes.find(n => n.id === OPTION)!.label = optionLabel;
    const edge = graph.edges.find(e => `${e.from}->${e.to}` === STARTER_LINK)!;
    edge.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
  }, true);
  out.reply = TWO_REPLY.replace('Raise prices:', `${mentionedLabel}:`);
  out.candidates = [{ ...candidate(), failure_way: `${mentionedLabel}: ${candidate().failure_way}` }, starter()];
  return out;
}

export interface DiagnosticsCase {
  name: string;
  make: () => Input;
  emitted: boolean;
  rows: number;
  reason?: PremortemDropReason;
  storyIndex?: number | null;
  stressTested?: string[];
  exit?: PremortemExit;
}
const singleDrop = (name: PremortemDropReason, change: (out: Input) => void, storyIndex: number | null = 1): DiagnosticsCase => ({
  name, emitted: false, rows: 0, reason: name, storyIndex,
  make: () => { const out = input(); change(out); return out; },
});

// Shared by Vitest and the tsx verification script: all cases exercise the real producer and selectors.
export const diagnosticsCases: DiagnosticsCase[] = [
  {
    name: 'two stories / story 1 parts mismatch (RED at base)', emitted: false, rows: 1,
    reason: 'story_parts_mismatch', storyIndex: 1,
    make: () => {
      const out = twoStories();
      const rows = out.candidates as ReturnType<typeof candidate>[];
      rows[0] = { ...rows[0], failure_way: `${rows[0].failure_way} An extra sentence.` };
      return out;
    },
  },
  { name: 'two valid stories / both named options stress_tested', make: twoStories, emitted: true, rows: 2, stressTested: [OPTION, STARTER] },
  { name: 'one story / valid optional outside', make: () => ({ ...input(), candidates: [candidate(), outside()] }), emitted: true, rows: 2, stressTested: [OPTION] },
  { name: 'two stories / invalid extra candidate', make: () => { const out = twoStories(); return { ...out, candidates: [...out.candidates as unknown[], { ...outside(), early_warning: '' }] }; }, emitted: true, rows: 2, reason: 'schema', storyIndex: null },
  singleDrop('schema', out => { out.candidates = [{ ...candidate(), early_warning: '' }]; }),
  singleDrop('scoped_not_run', out => { out.candidates = [{ ...candidate(), option_id: 'removed' }]; }),
  {
    name: 'plan_mismatch', emitted: false, rows: 0, reason: 'plan_mismatch', storyIndex: 1,
    make: () => {
      const out = twoStories();
      out.turn = fixture().turn;
      out.reply = numbered({ ...starter(), story_index: 1 }, 1) + '\nOutside the model: what could blindside this work?';
      out.candidates = [{ ...starter(), story_index: 1 }];
      return out;
    },
  },
  singleDrop('destination', out => { out.candidates = [{ ...candidate(), risk: { ...candidate().risk, affected_node_id: 'price_rise' } }]; }),
  singleDrop('risk_label', out => { out.candidates = [{ ...candidate(), risk: { ...candidate().risk, label: 'An unrelated risk' } }]; }),
  singleDrop('outside_invalid', out => { out.candidates = [{ ...outside(), story_index: 1 }]; }),
  singleDrop('story_missing', out => { out.candidates = []; }),
  singleDrop('story_parts_mismatch', out => { out.candidates = [{ ...candidate(), early_warning: 'A different warning.' }]; }),
  singleDrop('named_options', out => { out.turn = { ...out.turn!, context: { ...out.turn!.context, plan: null, decision_level: true } }; }),
  singleDrop('dup_ids', out => { out.candidates = [{ ...candidate(), grounding: { kind: 'link', ids: [LINK, LINK] } }]; }),
  singleDrop('supplied_mismatch', out => { out.turn = { ...out.turn!, context: { ...out.turn!.context, supplied_items: [] } }; }),
  {
    name: 'grounding_invalid', emitted: false, rows: 0, reason: 'grounding_invalid', storyIndex: 1,
    make: () => input(graph => { graph.edges.push(structuredClone(graph.edges.find(e => `${e.from}->${e.to}` === LINK)!)); }),
  },
  {
    name: 'final_label_drift', emitted: false, rows: 0, reason: 'final_label_drift', storyIndex: 1,
    make: () => {
      // Simulate a label moving after the scoped items were captured, before final validation.
      const out = input();
      const graph = out.final.graph as Graph;
      out.turn = { ...out.turn!, context: { ...out.turn!.context, supplied_items: out.turn!.context.supplied_items.map(item => item.id !== LINK ? item : {
        ...item,
        get labels() {
          graph.nodes.find(n => n.id === 'price_rise_mrr_uplift')!.label = 'Changed during validation';
          return item.labels;
        },
      }) } };
      return out;
    },
  },
  {
    name: 'duplicate_key', emitted: false, rows: 0, reason: 'duplicate_key', storyIndex: 1,
    make: () => {
      const out = input();
      const row = { ...candidate(), early_warning: 'x'.repeat(1500) };
      out.reply = numbered(row, 1) + '\nOutside the model: what could blindside this work?';
      // The first reserves the key but fails generated-request length; the second drops on that key.
      out.candidates = [row, structuredClone(row)];
      return out;
    },
  },
  singleDrop('risk_request_schema', out => {
    const row = { ...candidate(), early_warning: 'x'.repeat(1500) };
    out.reply = numbered(row, 1) + '\nOutside the model: what could blindside this work?';
    out.candidates = [row];
  }),
  { name: 'two stories / omitted story 1 candidate', make: () => ({ ...twoStories(), candidates: [starter()] }), emitted: false, rows: 1, reason: 'story_missing', storyIndex: 1 },
  { name: 'one story / outside omitted', make: () => input(), emitted: true, rows: 1, stressTested: [OPTION] },
  { name: 'one story / invalid optional outside', make: () => ({ ...input(), candidates: [candidate(), { ...outside(), story_index: null, failure_way: 'An external supplier stopped operating?' }] }), emitted: true, rows: 1, reason: 'outside_invalid', storyIndex: null },
];

function authoredWords(words: string, label = 'Raise prices 10%', field: 'failure_way' | 'early_warning' | 'mitigation' | 'risk.label' = 'failure_way'): Input {
  const out = twoStories(label);
  const rows = out.candidates as ReturnType<typeof candidate>[];
  if (field === 'risk.label') {
    rows[0].risk = { ...rows[0].risk, label: words };
    rows[0].failure_way += ` ${words}`;
  } else rows[0][field] += ` ${words}`;
  out.reply = `${numbered(rows[0], 1)}\n${numbered(rows[1], 2)}\nOutside the model: what could blindside this work?`;
  return out;
}

export const maskingCases: DiagnosticsCase[] = [
  { name: 'two stories / Raise prices 10% (RED at r1)', make: () => twoStories('Raise prices 10%'), emitted: true, rows: 2, stressTested: [OPTION, STARTER] },
  { name: 'two stories / Lead with price label', make: () => twoStories('Lead with price'), emitted: true, rows: 2, stressTested: [OPTION, STARTER] },
  { name: 'two stories / Best-of-breed CRM label, case folded', make: () => twoStories('Best-of-breed CRM', 'BEST-OF-BREED crm'), emitted: true, rows: 2, stressTested: [OPTION, STARTER] },
  ...['about 40% likely', 'the best option', 'it leads'].map(words => ({
    name: `two stories / authored ${words}`, make: () => authoredWords(words), emitted: false, rows: 1,
    reason: 'authored_ban' as const, storyIndex: 1,
  })),
  { name: 'two stories / Lead with price plus authored leads', make: () => authoredWords('it leads', 'Lead with price'), emitted: false, rows: 1, reason: 'authored_ban', storyIndex: 1 },
  { name: 'two stories / Raise prices 10% plus standalone 10%', make: () => authoredWords('10%'), emitted: false, rows: 1, reason: 'authored_ban', storyIndex: 1 },
  ...(['early_warning', 'mitigation', 'risk.label'] as const).map(field => ({
    name: `two stories / authored ban in ${field}`, make: () => authoredWords('the best option', 'Raise prices 10%', field), emitted: false, rows: 1,
    reason: 'authored_ban' as const, storyIndex: 1,
  })),
  {
    name: 'two stories / goal label in built risk request', emitted: true, rows: 2, stressTested: [OPTION, STARTER],
    make: () => {
      const out = twoStories();
      const graph = out.final.graph as Graph;
      graph.nodes.find(n => n.id === 'monthly_recurring_revenue')!.label = 'Best revenue';
      out.final.graphHash = computeAnalysisAffectingGraphHash(graph as never)!;
      out.final.analysisResult = { ...out.final.analysisResult as object, computed_against_hash: out.final.graphHash };
      const turn = methodTurnForReadback(PREMORTEM_PRESS_ID, out.final);
      if (turn?.kind !== 'run') throw new Error('renamed goal fixture must run');
      out.turn = turn;
      const rows = out.candidates as ReturnType<typeof candidate>[];
      for (const row of rows) row.failure_way = row.failure_way.replace('monthly recurring revenue', 'Best revenue');
      out.reply = `${numbered(rows[0], 1)}\n${numbered(rows[1], 2)}\nOutside the model: what could blindside this work?`;
      return out;
    },
  },
];

const CHURN_RISK = 'customers_lost_to_price_rise_churn';
const SERVED_PRICE_OPTION = 'raise_prices_10';

/** Inline reconstruction of the served T1b stories and selector inputs; no live evidence files at test time. */
export function riskStories(): Input {
  const graph: Graph = {
    nodes: [
      { id: 'monthly_recurring_revenue', kind: 'goal', label: 'monthly recurring revenue' },
      { id: SERVED_PRICE_OPTION, kind: 'option', label: 'Raise prices 10%', interventions: { price_rise: { value: 0.1, source: 'brief_extraction' } } },
      { id: STARTER, kind: 'option', label: 'Launch starter tier', interventions: { starter_subscribers: { value: 0.15, source: 'cee_hypothesis' } } },
      { id: 'keep_pricing_as_is', kind: 'option', label: 'Keep pricing as is', is_baseline: true },
      { id: 'price_rise', kind: 'factor', label: 'Price rise', observed_state: { value: 0, source: 'cee_inference' } },
      { id: 'starter_subscribers', kind: 'factor', label: 'Starter subscribers', observed_state: { value: 0, source: 'cee_inference', extractionType: 'inferred' } },
      { id: CHURN_RISK, kind: 'risk', label: 'Customers lost to price-rise churn' },
    ],
    edges: [
      { from: 'price_rise', to: 'monthly_recurring_revenue', strength: { mean: 0.7619047619047619, std: 0.38095238095238093 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated' } },
      { from: 'price_rise', to: CHURN_RISK, strength: { mean: 0.5, std: 0.25 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated' } },
      { from: CHURN_RISK, to: 'monthly_recurring_revenue', strength: { mean: -0.7619047619047619, std: 0.38095238095238093 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated' } },
      { from: 'starter_subscribers', to: 'monthly_recurring_revenue', strength: { mean: 0.3111111111111111, std: 0.15555555555555556 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated' } },
    ],
  };
  const graphHash = computeAnalysisAffectingGraphHash(graph as never)!;
  const read = {
    graph, graphHash,
    analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-07T06:34:37.724Z' }, leader_claim: { permitted: false, separation: 'near_tie', withheld_reason: 'options_do_not_separate' } },
    analysisResult: { type: 'analysis_result', computed_against_hash: graphHash, leading_option_id: null,
      enrichment: { option_comparison: graph.nodes.filter(n => n.kind === 'option').map(n => ({ option_id: n.id })) } },
    optionParticipation: [],
  };
  const turn = methodTurnForReadback(PREMORTEM_PRESS_ID, read);
  if (turn?.kind !== 'run') throw new Error('inline risk fixture must run');
  const first = {
    option_id: SERVED_PRICE_OPTION, story_index: 1,
    failure_way: 'It is a year later and this decision went badly because ‘Raise prices 10%’ increased ‘Price rise’, but customer losses erased the added revenue. ‘Customers lost to price-rise churn’ had outweighed the gain.',
    early_warning: 'Renewal cancellations citing price.',
    mitigation: 'Test the increase with a small renewal cohort before extending it.',
    grounding: { kind: 'risk', ids: [CHURN_RISK] },
    risk: { label: 'customer losses erased the added revenue', affected_node_id: 'monthly_recurring_revenue', direction: 'negative' },
  };
  const second = {
    option_id: STARTER, story_index: 2,
    failure_way: 'It is a year later and this decision went badly because ‘Launch starter tier’ attracted too few ‘Starter subscribers’ before the deadline. Subscriber growth arrived too slowly to support the revenue goal.',
    early_warning: 'Starter sign-ups falling behind the planned acquisition pace.',
    mitigation: 'Test paid demand before committing to a full launch.',
    grounding: { kind: 'factor', ids: ['starter_subscribers'] },
    risk: { label: 'Subscriber growth arrived too slowly', affected_node_id: 'monthly_recurring_revenue', direction: 'negative' },
  };
  return {
    scenarioId: '2e7cd627-09f8-4e1d-b81f-b4c79685efbc', turnId: 'turn-a2-risk', turn, passed: true,
    reply: `${numbered(first, 1)}\n${numbered(second, 2)}\nOutside the model: Could existing customers downgrade to the starter tier, reducing revenue from customers you already have?`,
    candidates: [first, second], initial: read, final: read,
  };
}

// DL (7 Oct, served a2-2 on staging 6a7354fc; Render PREMORTEM_WORKSHEET_WITHHELD story_parts_mismatch ×2): the model
// bolded and indented the markers ("   **Watch for:** …"), so both stories failed to parse and no row survived.
function boldMarkers(withOutside = false): Input {
  const out = twoStories();
  out.reply = out.reply
    .replace(/ Watch for: /gu, '\n   **Watch for:** ').replace(/ Mitigate: /gu, '\n   **Mitigate:** ')
    .replace(/^Outside the model:/mu, withOutside ? '**Outside the model:**' : 'Outside the model:');
  if (!out.reply.includes('**Watch for:**')) throw new Error('fixture: markers were not bolded');
  return out;
}
export const boldCases: DiagnosticsCase[] = [
  { name: 'two stories / bold, indented Watch for and Mitigate markers (served a2-2, RED at 6a7354fc)', make: () => boldMarkers(), emitted: true, rows: 2 },
  { name: 'two stories / bold markers including Outside the model', make: () => boldMarkers(true), emitted: true, rows: 2 },
];

export const riskCases: DiagnosticsCase[] = [
  { name: 'two stories / supplied risk (RED at r2)', make: riskStories, emitted: true, rows: 2, stressTested: [SERVED_PRICE_OPTION, STARTER] },
  {
    name: 'two stories / risk id is a factor node', emitted: false, rows: 1, reason: 'grounding_invalid', storyIndex: 1,
    make: () => {
      const out = riskStories();
      // Capture eligible risk items first, then change the final node kind while comparing the initial items.
      // A factor supplied as a factor already fails the earlier kind match; this reaches the node-kind guard.
      const graph = out.final.graph as Graph;
      out.turn = { ...out.turn!, context: { ...out.turn!.context, supplied_items: out.turn!.context.supplied_items.map(item => item.id !== CHURN_RISK ? item : {
        ...item, get labels() { graph.nodes.find(n => n.id === CHURN_RISK)!.kind = 'factor'; return item.labels; },
      }) } };
      return out;
    },
  },
  {
    name: 'two stories / unsupplied risk id', emitted: false, rows: 1, reason: 'supplied_mismatch', storyIndex: 1,
    make: () => {
      const out = riskStories();
      const graph = out.final.graph as Graph;
      graph.nodes.push({ id: 'off_path_risk', kind: 'risk', label: 'Off-path risk' });
      out.final.graphHash = computeAnalysisAffectingGraphHash(graph as never)!;
      out.final.analysisResult = { ...out.final.analysisResult as object, computed_against_hash: out.final.graphHash };
      const rows = out.candidates as ReturnType<typeof candidate>[];
      rows[0].grounding.ids = ['off_path_risk'];
      rows[0].failure_way += ' Off-path risk materialised.';
      out.reply = `${numbered(rows[0], 1)}\n${numbered(rows[1], 2)}\nOutside the model: what could blindside this work?`;
      return out;
    },
  },
  {
    name: 'two stories / risk final label drift', emitted: false, rows: 1, reason: 'final_label_drift', storyIndex: 1,
    make: () => {
      const out = riskStories();
      const graph = out.final.graph as Graph;
      out.turn = { ...out.turn!, context: { ...out.turn!.context, supplied_items: out.turn!.context.supplied_items.map(item => item.id !== CHURN_RISK ? item : {
        ...item, get labels() { graph.nodes.find(n => n.id === CHURN_RISK)!.label = 'Changed during validation'; return item.labels; },
      }) } };
      return out;
    },
  },
];
// ── A2-ELIG (DL 7 Oct): served B9, staging df15c8c1, req 388cefba, scenario 976078cc. The chat told two stories, the
// Reasoning tab showed nothing: Render PREMORTEM_WORKSHEET_WITHHELD stories:2 rows:1 dropped:[{1, scoped_not_run}].
// The decision-level turn supplied 'Raise prices by 10%' sets 'Price rise from current price' for stories, but the
// worksheet judged that story by a SCOPED press, which refuses an option whose path is user-sized only.
const B9 = JSON.parse(readFileSync(new URL('./fixtures/premortem-b9-served.json', import.meta.url), 'utf8')) as {
  scenario_id: string; turn_id: string; assistant_text: string; read: Record<string, unknown> & { graph: Graph; graph_hash: string };
};
const B9_PRICE = 'raise_prices_by_10';
const B9_SQ = 'keep_pricing_as_it_is';
/** The graph read projected exactly as `readBackState` projects it (same readers, same field names). */
export function b9Read(): PremortemRead {
  const r = structuredClone(B9.read);
  // S-DEF #2739 (d738949c) holds the validated definition Starter-tier MRR → MRR in the analysis-affecting hash, so the
  // captured df15c8c1 `graph_hash` no longer equals today's derivation of the SAME graph. A Run computed on today's code
  // carries today's hash on both the read and the result, so the served read is re-derived here, never re-captured.
  const graphHash = computeAnalysisAffectingGraphHash(r.graph as never)!;
  return {
    graph: r.graph, graphHash, analysisState: r.analysis_state,
    analysisResult: { ...(r.analysis_result as object), computed_against_hash: graphHash },
    analysisReady: r.analysis_ready, optionParticipation: readStoredOptionParticipation(r.analysis_option_participation),
    identityEvaluated: readEvaluatedIdentityNodeIds(r.analysis_identity_evaluated_node_ids),
  };
}
/**
 * The served appendix is stripped before the wire, so each candidate's metadata is reconstructed: every prose field is
 * copied from the verbatim reply, ids are the decision turn's supplied items, risk labels are phrases of the story.
 */
export const b9Candidates = () => [
  {
    option_id: B9_PRICE, story_index: 1,
    failure_way: 'It is a year later and this decision went badly because ‘Raise prices by 10%’ set ‘Price rise from current price’, but customer losses eroded the added revenue.',
    early_warning: 'Cancellation requests rose after customers received renewal notices.',
    mitigation: 'Test the change with a small renewal cohort before extending it.',
    grounding: { kind: 'factor', ids: ['price_rise_from_current_price'] },
    risk: { label: 'customer losses eroded the added revenue', affected_node_id: 'monthly_recurring_revenue', direction: 'negative' },
  },
  {
    option_id: STARTER, story_index: 2,
    failure_way: 'It is a year later and this decision went badly because ‘Launch starter tier’ set ‘Starter monthly price’, but ‘Starter subscribers’ grew too slowly to deliver the revenue needed within nine months.',
    early_warning: 'Paid starter sign-ups fell short of the launch plan.',
    mitigation: 'Test paid demand before committing to a full launch.',
    grounding: { kind: 'factor', ids: ['starter_monthly_price', 'starter_subscribers'] },
    risk: { label: 'grew too slowly to deliver the revenue needed', affected_node_id: 'monthly_recurring_revenue', direction: 'negative' },
  },
];
export function b9Served(): Input {
  const read = b9Read();
  // The served chip was the generic press (turn-004 req: chip agent-next-pre-mortem).
  const turn = methodTurnForReadback(PREMORTEM_PRESS_ID, read);
  if (turn?.kind !== 'run' || turn.context.decision_level !== true || turn.context.plan !== null) throw new Error('B9 must run at decision level');
  return { scenarioId: B9.scenario_id, turnId: B9.turn_id, turn, passed: true, reply: B9.assistant_text,
    candidates: b9Candidates(), initial: read, final: b9Read() };
}
/** Rewrites story 1 in the reply and its candidate together, so only the named change differs. */
const b9Story1 = (out: Input, from: string, to: string, change: Partial<ReturnType<typeof b9Candidates>[number]> = {}) => {
  const rows = out.candidates as ReturnType<typeof b9Candidates>;
  if (!out.reply.includes(rows[0].failure_way)) throw new Error('story 1 must be verbatim');
  const failure = rows[0].failure_way.replace(from, to);
  out.reply = out.reply.replace(rows[0].failure_way, failure);
  rows[0] = { ...rows[0], failure_way: failure, ...change };
};
const b9Drop = (name: string, change: (out: Input) => void, reason: PremortemDropReason): DiagnosticsCase => ({
  name: `two stories / B9 ${name}`, emitted: false, rows: 1, reason, storyIndex: 1,
  make: () => { const out = b9Served(); change(out); return out; },
});
export const eligibilityCases: DiagnosticsCase[] = [
  { name: 'two stories / B9 served near-tie: both stories carried (RED at df15c8c1)', make: b9Served, emitted: true, rows: 2, stressTested: [B9_PRICE, STARTER] },
  b9Drop('option the Run did not analyse', out => {
    const result = out.final.analysisResult as { enrichment: { option_comparison: Record<string, unknown>[] } };
    result.enrichment.option_comparison = result.enrichment.option_comparison.filter(o => o.option_id !== B9_PRICE);
  }, 'decision_option_ineligible'),
  b9Drop('status quo option', out => {
    b9Story1(out, '‘Raise prices by 10%’', '‘Keep pricing as it is’', { option_id: B9_SQ });
  }, 'decision_option_ineligible'),
  b9Drop('option the Run took out', out => {
    out.final.optionParticipation = readStoredOptionParticipation([{ option_id: B9_PRICE, state: 'excluded_olumi_proposed' }]);
    if (out.final.optionParticipation === undefined) throw new Error('participation fixture must parse');
  }, 'decision_option_ineligible'),
  b9Drop('option label not unique', out => {
    for (const read of [out.initial!, out.final]) {
      const graph = read.graph as Graph;
      graph.nodes.push({ id: 'duplicate_label', kind: 'factor', label: 'Raise prices by 10%' });
      read.graphHash = computeAnalysisAffectingGraphHash(graph as never)!;
      read.analysisResult = { ...read.analysisResult as object, computed_against_hash: read.graphHash };
    }
  }, 'decision_option_ineligible'),
  // Path membership the scoped gate used to give: 'Starter subscribers' is supplied, but only on 'Launch starter tier'.
  b9Drop('grounding on another option’s path', out => {
    b9Story1(out, '‘Price rise from current price’', '‘Starter subscribers’', { grounding: { kind: 'factor', ids: ['starter_subscribers'] } });
  }, 'supplied_mismatch'),
  b9Drop('grounding the decision turn never supplied', out => {
    b9Story1(out, '‘Price rise from current price’', '‘Customers lost from price rise’', { grounding: { kind: 'factor', ids: ['customers_lost_from_price_rise'] } });
  }, 'supplied_mismatch'),
];

/** The scoped gate is unchanged for an option-naming press: the user-sized option still refuses there. */
export function b9ScopedTurns() {
  const read = b9Read();
  return { price: methodTurnForReadback(planPickChipId(B9_PRICE), read), starter: methodTurnForReadback(planPickChipId(STARTER), read) };
}

const exitCase = (exit: PremortemExit, change: (out: Input) => void, rows = 0): DiagnosticsCase => ({
  name: `two stories / exit ${exit}`, emitted: false, rows, exit,
  make: () => { const out = b9Served(); change(out); return out; },
});
export const exitCases: DiagnosticsCase[] = [
  exitCase('not_passed', out => { out.passed = false; }),
  exitCase('no_turn', out => { out.turn = null; }),
  exitCase('no_initial', out => { out.initial = undefined; }),
  exitCase('no_turn_id', out => { out.turnId = undefined; }),
  exitCase('candidates_invalid', out => { out.candidates = undefined; }),
  exitCase('stamp_missing', out => { out.final = { ...out.final, analysisResult: undefined }; }),
  exitCase('run_changed', out => {
    out.final = { ...out.final, analysisState: { ...out.final.analysisState as object,
      run_state: { kind: 'complete_current', computed_at: '2026-10-07T09:30:00.000Z' } } };
  }),
  exitCase('graph_changed', out => {
    // Layout-only metadata: the analysis hash (so both Run stamps) holds while the whole-graph binding moves.
    const graph = structuredClone(out.final.graph) as Graph;
    graph.nodes[0].position = { x: 1, y: 2 };
    out.final = { ...out.final, graph };
  }),
  exitCase('no_blindspot', out => { out.reply = out.reply.split('Outside the model:')[0]; }),
  exitCase('exception', out => {
    out.initial = { ...out.initial, get graph(): unknown { throw new Error('private prose must never escape'); } };
  }),
  // Every row validates; only the envelope's turn id (max 160) refuses, so the code names the last gate.
  exitCase('worksheet_invalid', out => { out.turnId = 'x'.repeat(161); }, 2),
];
