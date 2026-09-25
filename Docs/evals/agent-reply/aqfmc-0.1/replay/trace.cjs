// AQ-FMC-0.1 §3 — outcomes/risks trace on the SAME H captures (N = absence control).
// Stages: represented (brief → constructor raw → tool result the Agent read → canonical readback)
//         · visible (NOT_TESTED: no browser can launch in this runtime; JSON is not visibility)
//         · used/excluded (the first analysis: ran, or its exact reason) · explained (the raw reply).
// Concept → node matching is by label/id pattern, disclosed as such; every hit carries its JSON pointer.
// Returns the FIRST adjacent mismatch per concept (the earliest stage where it is present then absent),
// or NOT_ESTABLISHED. Every absence is reported beside a present control from the same artefact.
'use strict';
const fs = require('fs'), path = require('path');
const CAP = path.resolve(__dirname, '..', 'captures', 'R');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const CONCEPTS = {
  H: { 'faster delivery': /deliver|velocity|throughput|speed|lead.?time|cycle.?time/i, 'less rework': /rework|defect|bug|quality/i, 'onboarding / diverted capacity': /onboard|mentor|coach|ramp|divert|distract/i },
  N: { 'less time finding documents (goal)': /retriev|find|search|time.?spent|lookup/i, 'customer churn (MUST BE ABSENT)': /churn|cancel|subscri/i, 'new-hire onboarding (MUST BE ABSENT)': /onboard|new.?hire|ramp/i },
};
function hits(v, re, ptr = '', out = []) { // every string leaf (label/id/description) matching re, with its pointer
  if (typeof v === 'string') { if (re.test(v)) out.push({ ptr, text: v.length > 140 ? v.slice(0, 140) + '…' : v }); }
  else if (Array.isArray(v)) v.forEach((x, i) => hits(x, re, `${ptr}/${i}`, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) hits(v[k], re, `${ptr}/${k}`, out);
  return out;
}
const nodeHits = (graph, re) => (graph?.nodes ?? []).map((n, i) => ({ n, i })).filter(({ n }) => re.test(String(n.label ?? '')) || re.test(String(n.id ?? '')))
  .map(({ n, i }) => ({ ptr: `/nodes/${i}`, id: n.id, kind: n.kind ?? n.type, label: n.label, provenance: n.provenance ?? n.data?.provenance ?? n.source ?? null, value: n.data?.value ?? n.value ?? null }));
const CATS = ['goal', 'options', 'factors', 'risks', 'outcomes', 'constraints', 'unknowns'];
const consEntities = (c) => CATS.flatMap((k) => (Array.isArray(c?.[k]) ? c[k].map((e, i) => ({ e, ptr: `/${k}/${i}`, cat: k })) : c?.[k] && typeof c[k] === 'object' ? [{ e: c[k], ptr: `/${k}`, cat: k }] : []));
const consHits = (c, re) => consEntities(c).filter(({ e }) => re.test(String(e.label ?? e.name ?? e.text ?? e.description ?? e.id ?? '')))
  .map(({ e, ptr, cat }) => ({ ptr, cat, id: e.id ?? null, label: e.label ?? e.name ?? e.text ?? null, provenance: e.provenance ?? e.source ?? null }));
const textOf = (resp) => (resp.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');

function traceState(state, brief) {
  const dir = path.join(CAP, state); if (!fs.existsSync(path.join(dir, 'route.response.json'))) return { state, status: 'NOT_CAPTURED' };
  const route = readJson(path.join(dir, 'route.response.json')); const body = route.assistant_text !== undefined ? route : route.body ?? route.json ?? route;
  const calls = fs.readdirSync(path.join(dir, 'llm-calls')).filter((f) => f.endsWith('.meta.json')).sort().map((f) => ({ meta: readJson(path.join(dir, 'llm-calls', f)), base: f.replace('.meta.json', '') }));
  const cons = calls.filter((c) => /^construction/.test(c.meta.purpose));
  const consFinal = cons.at(-1); let consRaw = null, consParsed = null;
  if (consFinal) { consRaw = textOf(readJson(path.join(dir, 'llm-calls', consFinal.base + '.response.json'))); try { consParsed = JSON.parse(consRaw); } catch { consParsed = null; } }
  const fh = readJson(path.join(dir, 'final-hop.json')); const fhReq = fh.request_path ? readJson(fh.request_path) : null; const fhResp = fh.response_path ? readJson(fh.response_path) : null;
  const toolOut = (fhReq?.input ?? []).filter((i) => i.type === 'function_call_output').map((i) => { try { return JSON.parse(i.output); } catch { return i.output; } });
  const reply = fhResp ? textOf(fhResp) : '';
  const graph = body.draft_graph ?? null; const fa = body._diagnostic_trace?.first_analysis ?? null;
  const concepts = {};
  for (const [name, re] of Object.entries(CONCEPTS[brief])) {
    const st = {
      brief: hits(readJson(path.join(dir, 'route.request.json')).message ?? readJson(path.join(dir, 'route.request.json')).body?.message ?? '', re).length > 0,
      constructor_raw: consParsed ? consHits(consParsed, re) : hits(consRaw ?? '', re),
      agent_tool_result: toolOut.flatMap((t, i) => hits(t, re, `/tool_outputs/${i}`)).slice(0, 6),
      canonical_readback: nodeHits(graph, re),
      explained_in_raw_reply: hits(reply, re).length > 0,
    };
    const present = [st.brief, st.constructor_raw.length > 0, st.agent_tool_result.length > 0, st.canonical_readback.length > 0, st.explained_in_raw_reply];
    const names = ['brief', 'constructor_raw', 'agent_tool_result', 'canonical_readback', 'explained_in_raw_reply'];
    let mismatch = 'NOT_ESTABLISHED';
    for (let i = 1; i < present.length; i += 1) if (present[i - 1] && !present[i]) { mismatch = `${names[i - 1]} → ${names[i]}`; break; }
    concepts[name] = { stages: st, first_adjacent_mismatch: mismatch };
  }
  return {
    state, status: 'TRACED', constructor_calls: cons.map((c) => `${c.base}:${c.meta.purpose}`), constructor_parsed: consParsed !== null,
    constructor_build: body._agent?.tool_calls?.find?.((c) => c.name === 'build_model_from_brief') ?? null,
    node_count: { constructor_raw_entities: consParsed ? Object.fromEntries(CATS.map((k) => [k, Array.isArray(consParsed[k]) ? consParsed[k].length : consParsed[k] ? 1 : 0])) : null, constructor_raw_links: consParsed?.links?.length ?? null, canonical_readback: graph?.nodes?.length ?? null },
    present_control_nodes: (graph?.nodes ?? []).slice(0, 3).map((n) => `${n.kind ?? n.type}:${n.label}`),
    visible: 'NOT_TESTED — no browser can launch from this runtime; debug JSON is not visibility',
    used_or_excluded: fa === null ? 'NO_FIRST_ANALYSIS_ON_THIS_TURN' : fa.ran ? `RAN (run_turn_id ${fa.run_turn_id}) — consumption not traced: the double cannot answer a run` : `NOT RUN: ${fa.reason}`,
    concepts,
  };
}
const out = { H: traceState('D1', 'H'), H_followup: traceState('D2', 'H'), N: traceState('D8', 'N') };
fs.writeFileSync(path.join(__dirname, '..', 'replays', 'TRACE.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, (k, v) => (Array.isArray(v) && v.length > 3 ? [...v.slice(0, 3), `…+${v.length - 3}`] : v), 1).slice(0, 6000));
