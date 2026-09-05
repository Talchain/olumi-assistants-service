/**
 * What is RECORDED rather than decided.
 *
 * Two different reasons live here and they are kept apart:
 *
 *   TURNS 8 AND 9 — SCRIPT.md: "MEASUREMENT ONLY for now: no fix is in flight
 *   for either, and neither gates a wave. Recording them stops the estate
 *   rediscovering them." So they are sent, scanned by the universal criteria
 *   (C3 applies to every turn), and their OWN subject matter never fails the
 *   run.
 *
 *   SECTION B — ACCEPTANCE.md: "never decided on n=1 ... 4 of 12 measured draws
 *   flatten the goal layer entirely, so a single run cannot separate a
 *   regression from a draw. n >= 5 fresh runs on the unchanged corpus, through
 *   the wire harness, before any rollback decision." Every quantity here is
 *   therefore emitted as a SINGLE-DRAW OBSERVATION and labelled as one. A
 *   harness that printed "correction integrity: 100%" off one run would be
 *   manufacturing the exact number the fixture forbids.
 *
 * Nothing in this file can change an exit code.
 */

import type { Measurement, TurnCapture } from './types.js';
import { blockTypesPresent, collectUserVisibleStrings, excerpt } from './payload-scan.js';
import { carriesAnalysisResult, readAdmission, readGraphPatches } from './admission.js';

const SINGLE_DRAW =
  'SINGLE-DRAW OBSERVATION (n=1). ACCEPTANCE.md section B forbids reading this as a rate: ' +
  'n >= 5 fresh runs on the unchanged corpus before any rollback decision.';

const MEASUREMENT_ONLY =
  'MEASUREMENT ONLY per SCRIPT.md — no fix is in flight and this does not gate a wave. Recorded so ' +
  'the estate stops rediscovering it.';

/**
 * ACCEPTANCE.md section C — "what the model must materially represent".
 *
 * ⚠ TRANSCRIBED, NOT DERIVED: this is a copy of section C at fixture commit
 * `cd9384f6`. It is a MIRROR and it will drift if the fixture changes. It is
 * tolerable here, and ONLY here, because everything it feeds is a RECORDED
 * measurement that can never produce a verdict — a stale entry costs a
 * misleading count in a report a human reads, not a false PASS.
 */
export const MODEL_FIDELITY_QUANTITIES: readonly { id: string; needles: readonly string[] }[] =
  Object.freeze([
    { id: 'three options', needles: [] },
    { id: '£30k MRR within 18 months', needles: ['30', '18'] },
    { id: 'six-month minimum runway', needles: ['6', 'runway'] },
    { id: 'CAC under £500', needles: ['500', 'cac'] },
    { id: '£80k–120k hire cost', needles: ['80', '120'] },
    { id: '£20k tooling', needles: ['20', 'tool'] },
    { id: '£40k SDR', needles: ['40', 'sdr'] },
    { id: '£8k MRR', needles: ['8', 'mrr'] },
    { id: '120 customers', needles: ['120', 'customer'] },
    { id: '12% conversion', needles: ['12', 'conver'] },
    { id: '4% monthly churn', needles: ['4', 'churn'] },
    { id: '£200k runway', needles: ['200', 'runway'] },
    { id: '60% founder time on sales', needles: ['60', 'founder'] },
  ]);

/** The known-open defect ACCEPTANCE.md section C names, and the sentence it demands. */
export const KNOWN_OPEN_SENTENCE =
  'If this survives a wave, that wave is a safety improvement and the PoC is not shareable.';

function turnAt(turns: readonly TurnCapture[], i: number): TurnCapture | undefined {
  return turns.find((t) => t.index === i);
}

function reached(t: TurnCapture | undefined): t is TurnCapture {
  return t !== undefined && t.transportError === undefined && t.body !== undefined;
}

/** Why a turn produced nothing, for a measurement line. Never throws on absence. */
function whyAbsent(t: TurnCapture | undefined): string {
  if (t === undefined) return 'not sent';
  if (t.transportError !== undefined) return t.transportError;
  return `HTTP ${t.httpStatus} with no body`;
}

function graphNodes(turns: readonly TurnCapture[]): readonly Record<string, unknown>[] {
  for (const t of turns) {
    if (!reached(t)) continue;
    const dg = (t.body as Record<string, unknown>).draft_graph as Record<string, unknown> | undefined;
    const nodes = dg?.nodes;
    if (Array.isArray(nodes) && nodes.length > 0) {
      return nodes.filter((n): n is Record<string, unknown> => typeof n === 'object' && n !== null);
    }
  }
  return [];
}

function graphEdges(turns: readonly TurnCapture[]): readonly Record<string, unknown>[] {
  for (const t of turns) {
    if (!reached(t)) continue;
    const dg = (t.body as Record<string, unknown>).draft_graph as Record<string, unknown> | undefined;
    const edges = dg?.edges;
    if (Array.isArray(edges) && edges.length > 0) {
      return edges.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null);
    }
  }
  return [];
}

export function collectMeasurements(turns: readonly TurnCapture[]): readonly Measurement[] {
  const out: Measurement[] = [];

  // ---- turn 8: the flat goal layer ---------------------------------------
  const t8 = turnAt(turns, 8);
  const edges = graphEdges(turns);
  const strengths = edges
    .map((e) => e.strength ?? e.weight ?? e.value)
    .filter((v): v is number => typeof v === 'number');
  const atHalf = strengths.filter((s) => Math.abs(s - 0.5) < 1e-9 || Math.abs(s - 50) < 1e-9).length;
  // ⚠ WHEN THE READER FINDS NOTHING, PRINT THE KEYS IT DID SEE.
  // `draft_graph.edges` is `z.unknown()[]` at the boundary pin, so the member
  // carrying a strength is not derivable from the schema. The first live run
  // reported "no numeric edge strengths across 27 drafted edges" — true, and
  // useless: it says nothing about whether the reader is looking in the wrong
  // place. Printing the observed key set turns a dead end into the one thing a
  // reader needs to widen it, and keeps this a DERIVED observation rather than
  // a guess at a field name.
  const observedEdgeKeys = [...new Set(edges.flatMap((e) => Object.keys(e)))].sort();
  out.push({
    id: 'turn8.edge-strength-distribution',
    what: 'edge strengths in the drafted graph (the "all 50%" question turn 8 asks about)',
    value:
      strengths.length === 0
        ? `no numeric strength/weight/value member on any of ${edges.length} drafted edges. ` +
          `Members actually present: [${observedEdgeKeys.join(', ') || 'none — no drafted edges observed'}]`
        : `${atHalf}/${strengths.length} edges at 0.5 · distinct values: ${[...new Set(strengths)].sort((a, b) => a - b).join(', ')}` +
          ` · edge members present: [${observedEdgeKeys.join(', ')}]`,
    why_not_decided: MEASUREMENT_ONLY,
  });
  out.push({
    id: 'turn8.reply',
    what: 'what turn 8 replied when asked why the strengths are all 50%',
    value: reached(t8)
      ? excerpt(
          collectUserVisibleStrings(t8.body).find((s) => s.path === 'assistant_text')?.value ??
            '(no assistant_text)',
          400,
        )
      : `turn 8 did not return (${whyAbsent(t8)})`,
    why_not_decided: MEASUREMENT_ONLY,
  });

  // ---- turn 9: a named method on demand ----------------------------------
  const t9 = turnAt(turns, 9);
  out.push({
    id: 'turn9.premortem-shape',
    what: 'what came back when asked to run a pre-mortem',
    value: reached(t9)
      ? `blocks: [${blockTypesPresent(t9.body).join(', ')}] · ` +
        excerpt(
          collectUserVisibleStrings(t9.body).find((s) => s.path === 'assistant_text')?.value ??
            '(no assistant_text)',
          320,
        )
      : `turn 9 did not return (${whyAbsent(t9)})`,
    why_not_decided:
      `${MEASUREMENT_ONLY} Note: \`premortem\` is NOT a wire block type at the 0.50.0 boundary pin ` +
      '(it exists only in the orchestrator-internal union), so its absence from `blocks` is not by ' +
      'itself evidence the method did not run.',
  });

  // ---- section B: single-draw observations --------------------------------
  const nodes = graphNodes(turns);
  const haystack = JSON.stringify(nodes).toLowerCase();
  const represented = MODEL_FIDELITY_QUANTITIES.filter(
    (q) => q.needles.length > 0 && q.needles.every((n) => haystack.includes(n.toLowerCase())),
  );
  const optionNodes = nodes.filter((n) => {
    const kind = typeof n.type === 'string' ? n.type : typeof n.kind === 'string' ? n.kind : '';
    return kind.toLowerCase().includes('option');
  });
  out.push({
    id: 'sectionB.model-fidelity',
    what: 'ACCEPTANCE.md section C quantities detectable in the drafted graph',
    value:
      nodes.length === 0
        ? 'no drafted graph observed'
        : `${represented.length}/${MODEL_FIDELITY_QUANTITIES.filter((q) => q.needles.length > 0).length} ` +
          `quantities token-detectable · ${optionNodes.length} option-kind nodes · ${nodes.length} nodes total` +
          ` · present: ${represented.map((q) => q.id).join('; ') || 'none'}`,
    why_not_decided:
      `${SINGLE_DRAW} A token search over serialised nodes is a WEAK proxy for "materially ` +
      'represented" — it cannot tell a modelled £80k from the digits 80 appearing in a label. ' +
      'It is a floor for a human to read, never a fidelity score.',
  });

  const firstAnalysis = turns.find((t) => reached(t) && carriesAnalysisResult(t.body));
  out.push({
    id: 'sectionB.first-analysis-completion',
    what: 'did an analysis complete, and on which turn',
    value:
      firstAnalysis === undefined
        ? 'no turn carried a completed analysis result'
        : `first completed analysis on turn ${firstAnalysis.index}`,
    why_not_decided: SINGLE_DRAW,
  });

  const t5 = turnAt(turns, 5);
  const patches = reached(t5) ? readGraphPatches(t5.body) : [];
  out.push({
    id: 'sectionB.correction-integrity',
    what: 'turn 5 patch outcome',
    value:
      patches.length === 0
        ? 'no graph_patch block on turn 5'
        : patches
            .map((p) => `${p.operation ?? '?'} on ${p.target_id ?? '?'} → ${p.status ?? '?'}`)
            .join('; '),
    why_not_decided: SINGLE_DRAW,
  });

  const modes = turns
    .filter(reached)
    .map((t) => ({ index: t.index, read: readAdmission(t.body) }))
    .filter((x) => x.read.kind === 'present')
    .map((x) => `t${x.index}=${x.read.kind === 'present' ? x.read.permitted_analysis_mode : ''}`);
  out.push({
    id: 'sectionB.permitted-analysis-mode-trace',
    what: 'permitted_analysis_mode across the journey',
    value: modes.length === 0 ? 'no turn carried a readable admission' : modes.join(' · '),
    why_not_decided: SINGLE_DRAW,
  });

  // ---- the known-open defect section C names ------------------------------
  const hireOption = optionNodes.find((n) => {
    const label = (typeof n.label === 'string' ? n.label : '').toLowerCase();
    return label.includes('hire') || label.includes('sales team');
  });
  out.push({
    id: 'sectionC.known-open.hire-option-cost',
    what:
      'ACCEPTANCE.md records as KNOWN OPEN: the hire option\'s cost modelled as £0 while the baseline ' +
      'carried the full £80k, inverted against a brief that says the hire costs £80–120k',
    value:
      hireOption === undefined
        ? 'no option node whose label names hiring was observable in the drafted graph'
        : `hire-option node ${JSON.stringify(hireOption.id)} "${String(hireOption.label ?? '')}" — ` +
          `effects/values as drafted: ${excerpt(JSON.stringify(hireOption), 400)}`,
    why_not_decided:
      `${SINGLE_DRAW} The harness records the drafted shape; whether the cost is INVERTED is a ` +
      'model-fidelity judgement over option effect values, which section B explicitly does not ' +
      `decide on one draw. If a wave leaves this standing: "${KNOWN_OPEN_SENTENCE}"`,
  });

  return out;
}
