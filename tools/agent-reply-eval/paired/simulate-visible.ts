/**
 * SIMULATE THE FINAL USER-VISIBLE REPLY for one model output, with the REAL server
 * post-processing of served CEE 57f903c — imported, never re-typed.
 *
 * Mirrors src/routes/agent-v1-turn.ts at 57f903c4652783a9de1a3778d6682a8e5f8414e1:
 *
 *   FP3 explicit Run (fast path 3), lines 1293–1312:
 *     answer = output.filter(type==='message').flatMap(content).filter(output_text).map(text).join('')
 *     text   = answer.trim() ? answer : interpretationUnavailableText(ran)      (fallback NOT mirrored: refused below)
 *     tool_calls   = [{ name:'run_analysis', ok: ran.ok===true, mutated:false, refusal? }]   (line 1311)
 *     tool_results = [ran]                                                                  (line 1312)
 *   Conversation turn (runAgentTurn, agent-loop.ts 137–146 / 258–268): text = textOf(final output)
 *   Both, lines 1351–1353: a hop-limit turn with empty text gets a fixed line (NOT mirrored: refused below)
 *   Both, lines 1392–1397: owed = current_state_unknown ? valueChangeDisclosures(facts)
 *                                                       : [...disclosuresFor(results), ...valueChangeDisclosures(facts)]
 *                          facts = collectTurnStateFacts(tool_results)                    (line 1375)
 *   Both, lines 1457–1459: narration = fastPath==='run' ? {text, status:null, stripped:[]}
 *                                                      : narrateWriteOutcome(text, tool_calls, tool_results)
 *   Both, lines 1465–1466: assistant_text = withoutProposalIds(withWriteOutcome(withDisclosures(narration.text, owed),
 *                              [narration.status, notAdoptedLine(tool_calls, tool_results)].filter(nonEmpty).join(' ') || null))
 *
 * The mirror is VALIDATED, not assumed: __tests__/score-paired.test.ts replays the captured
 * model output of every captured route turn through this function and requires the route's own
 * `assistant_text` byte for byte (3 live construction turns + 2 FP3 turns).
 */
import { narrateWriteOutcome, notAdoptedLine, withWriteOutcome } from '../../../src/orchestrator-v5/agent-lane/write-outcome.js';
import { disclosuresFor, valueChangeDisclosures, withDisclosures } from '../../../src/orchestrator-v5/agent-lane/disclosure.js';
import { collectTurnStateFacts } from '../../../src/orchestrator-v5/agent-lane/turn-state-facts.js';
import { withoutProposalIds } from '../../../src/orchestrator-v5/agent-lane/display-ids.js';
import type { ToolResult } from '../../../src/orchestrator-v5/agent-lane/runtime/agent-tools.js';

export const SERVED_HEAD = '57f903c4652783a9de1a3778d6682a8e5f8414e1';

export const ROUTE_LINES_MIRRORED = {
  fp3_answer_and_text: 'src/routes/agent-v1-turn.ts:1293-1307',
  fp3_tool_calls_and_results: 'src/routes/agent-v1-turn.ts:1311-1312',
  conversation_text: 'src/orchestrator-v5/agent-lane/runtime/agent-loop.ts:137-146,258-268',
  hop_limit_text: 'src/routes/agent-v1-turn.ts:1351-1353 (not exercised: every final hop answered)',
  state_facts: 'src/routes/agent-v1-turn.ts:1375',
  owed_disclosures: 'src/routes/agent-v1-turn.ts:1392-1397',
  narration: 'src/routes/agent-v1-turn.ts:1457-1459',
  compose_assistant_text: 'src/routes/agent-v1-turn.ts:1465-1466',
} as const;

export type TurnKind = 'fp3' | 'conversation';

export interface ToolCallRecord {
  readonly name: string;
  readonly ok: boolean;
  readonly mutated: boolean;
  readonly proposal_id?: string;
  readonly outcome?: string;
  readonly refusal?: string;
}

export interface TurnTools {
  readonly kind: TurnKind;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly toolResults: readonly ToolResult[];
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);

/** The text of one Responses-API output array: every output_text of every message, in order, joined with ''. */
export function textOfOutput(output: unknown): string {
  let t = '';
  for (const item of Array.isArray(output) ? output : []) {
    const i = rec(item);
    if (i === null || i.type !== 'message') continue;
    for (const c of Array.isArray(i.content) ? i.content : []) {
      const cc = rec(c);
      if (cc !== null && cc.type === 'output_text' && typeof cc.text === 'string') t += cc.text;
    }
  }
  return t;
}

export function functionCallsOf(output: unknown): { name: string; arguments: string }[] {
  return (Array.isArray(output) ? output : [])
    .map(rec)
    .filter((i): i is Rec => i !== null && i.type === 'function_call')
    .map((i) => ({ name: String(i.name ?? ''), arguments: String(i.arguments ?? '') }));
}

/**
 * The turn's tool calls and results, recovered from the REPLY-WRITING request's own input.
 * agent-loop.ts:322-326 writes each result as `function_call_output.output = JSON.stringify(result)`
 * and :312-319 records the call as {name, ok, mutated, proposal_id?, outcome?, refusal?}.
 */
export function conversationToolsFromInput(input: unknown): TurnTools {
  const items = (Array.isArray(input) ? input : []).map(rec).filter((i): i is Rec => i !== null);
  const calls = items.filter((i) => i.type === 'function_call');
  const outputs = new Map(items.filter((i) => i.type === 'function_call_output').map((i) => [String(i.call_id), String(i.output)]));
  const toolCalls: ToolCallRecord[] = [];
  const toolResults: ToolResult[] = [];
  for (const c of calls) {
    const out = outputs.get(String(c.call_id));
    if (out === undefined) throw new Error(`function_call ${String(c.name)} has no function_call_output in the input`);
    const r = JSON.parse(out) as ToolResult;
    toolCalls.push({
      name: String(c.name),
      ok: r.ok,
      mutated: r.mutated,
      ...(typeof r.proposal_id === 'string' ? { proposal_id: r.proposal_id } : {}),
      ...(typeof r.outcome === 'string' ? { outcome: r.outcome } : {}),
      ...(typeof r.refusal === 'string' ? { refusal: r.refusal } : {}),
    });
    toolResults.push(r);
  }
  return { kind: 'conversation', toolCalls, toolResults };
}

/**
 * FP3: the request's last item is the function_call_output of JSON.stringify({...ran, canonical_state})
 * (route :1264, :1266-1271). `ran` is that object without the canonical_state the route added beside it.
 */
export function fp3ToolsFromInput(input: unknown): TurnTools {
  const items = (Array.isArray(input) ? input : []).map(rec).filter((i): i is Rec => i !== null);
  const last = items[items.length - 1];
  const call = items[items.length - 2];
  if (last?.type !== 'function_call_output' || call?.type !== 'function_call' || call.name !== 'run_analysis') {
    throw new Error('FP3 input does not end with the run_analysis call/output pair');
  }
  const withState = JSON.parse(String(last.output)) as Rec;
  const { canonical_state: _dropped, ...ran } = withState;
  void _dropped;
  const r = ran as ToolResult;
  return {
    kind: 'fp3',
    toolCalls: [{ name: 'run_analysis', ok: r.ok === true, mutated: false, ...(typeof r.refusal === 'string' ? { refusal: r.refusal } : {}) }],
    toolResults: [r],
  };
}

export interface SimulatedReply {
  readonly visible: string;
  /** The model's share of `visible`: its (claim-stripped) words with proposal ids rewritten — what the scorer's split must recover. */
  readonly modelShare: string;
  /** Sentences narrateWriteOutcome removed from the model's text (→ `_diagnostic_trace.write_claims_removed`). */
  readonly stripped: readonly string[];
  readonly status: string | null;
  readonly notAdopted: string | null;
  readonly owed: readonly string[];
}

export function simulateVisible(rawText: string, turn: TurnTools): SimulatedReply {
  if (rawText.trim().length === 0) {
    // The route substitutes its own text here (FP3 interpretationUnavailableText / hop-limit line).
    // Not mirrored: that code lives in the route module, which cannot be imported without booting the service.
    throw new Error('empty model text: the route would substitute its own fallback text, which this simulator does not mirror');
  }
  const facts = collectTurnStateFacts(turn.toolResults);
  const owed = facts.current_state_unknown === true
    ? [...valueChangeDisclosures(facts)]
    : [...disclosuresFor(turn.toolResults), ...valueChangeDisclosures(facts)];
  const narration = turn.kind === 'fp3'
    ? { text: rawText, status: null as string | null, stripped: [] as string[] }
    : narrateWriteOutcome(rawText, turn.toolCalls, turn.toolResults);
  const notAdopted = notAdoptedLine(turn.toolCalls, turn.toolResults);
  const visible = withoutProposalIds(withWriteOutcome(withDisclosures(narration.text, owed),
    [narration.status, notAdopted].filter((x): x is string => x !== null && x !== '').join(' ') || null));
  return { visible, modelShare: withoutProposalIds(narration.text), stripped: [...narration.stripped], status: narration.status, notAdopted, owed };
}
