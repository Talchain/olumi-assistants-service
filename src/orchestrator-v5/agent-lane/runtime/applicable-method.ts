/**
 * ⭐ WHICH REASONING METHOD DOES THIS MODEL'S LATEST ANALYSIS CALL FOR — AND WHY?
 *
 * Release Control's coaching release test (#63 5792626729): "identify consequential
 * reasoning weakness → select appropriate science-grounded method → explain why it
 * applies", with DETERMINISTIC applicability gates. Measured before this module: the
 * Agent had NO access to the method layer (0 references across agent-lane), while the
 * conventional route already selects a method from the analysis through
 * `rankInterventions`.
 *
 * ⛔ THIS MODULE DECIDES NOTHING. It reads the scenario's newest persisted
 * `run_analysis` fact — the Agent's own `run_analysis` goes through the conventional
 * handler, which persists it (measured: `v5_handler_facts`, served scenario d99f3ca9)
 * — and hands it to the SAME gate the conventional route uses, with the SAME executor
 * availability. The method's title and reason are the gate's own copy. A DSK protocol's
 * published steps are attached ONLY where the gate's lens carries DSK provenance
 * (`LENS_DSK_PROVENANCE`) — a lens whose rules predate the bundle is never given a
 * protocol label it does not have.
 *
 * "No method" is a first-class answer (the gate's own "may recommend nothing"): the
 * Agent must not invent a technique the gate did not select.
 */
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { rankInterventions, LENS_DSK_PROVENANCE } from '../../compose/lens-selector.js';
import { liveLensExecutorAvailability } from '../../compose/phase3-blocks.js';
import { resolveDskProtocolProvenance } from '../../compose/dsk-protocol-record.js';
import { loadVerifiedDskBundle } from '../../compose/dsk-bundle-record.js';
import { literalProtocolSteps } from '../../coaching/typed-intent-directive.js';
import type { DSKProtocol } from '../../../dsk/types.js';
import type { ToolResult } from './agent-tools.js';

export type ReadNewestAnalysisFact = (scenarioId: string) => Promise<HandlerFact | null>;

function protocolRecord(protocolId: string): DSKProtocol | null {
  const bundle = loadVerifiedDskBundle();
  if (bundle === null) return null;
  const record = (bundle.objects ?? []).find(
    (o): o is DSKProtocol => o.type === 'protocol' && o.id === protocolId,
  ) ?? null;
  return record === null || record.deprecated === true ? null : record;
}

export async function applicableMethod(read: ReadNewestAnalysisFact | undefined, scenarioId: string): Promise<ToolResult> {
  if (read === undefined) return { ok: false, mutated: false, refusal: 'method_gate_unavailable' };
  const fact = await read(scenarioId);
  if (fact === null || (fact as { fact_type?: unknown }).fact_type !== 'run_analysis') {
    return {
      ok: true, mutated: false, method: null,
      why_none: 'No analysis has run on this model yet, so no method has been selected. A method is chosen from what the analysis shows.',
    };
  }
  const ranking = rankInterventions(fact as RunAnalysisHandlerFact, liveLensExecutorAvailability());
  const chosen = ranking.chosen;
  if (chosen === null) {
    return {
      ok: true, mutated: false, method: null,
      why_none: 'The latest analysis gives no signal that a structured method would change the picture right now. Do not propose one.',
      not_applicable: ranking.ineligible.map((i) => ({ method: i.lens, reason: i.reason })),
    };
  }
  const dsk = LENS_DSK_PROVENANCE[chosen.lens];
  const provenance = dsk === undefined ? null : resolveDskProtocolProvenance(dsk.protocolId);
  const protocol = dsk === undefined ? null : protocolRecord(dsk.protocolId);
  return {
    ok: true, mutated: false,
    method: {
      id: chosen.lens,
      title: chosen.title,
      why: chosen.body,
      ...(chosen.subjectRef !== undefined ? { subject_factor_id: chosen.subjectRef.id } : {}),
      science: provenance !== null && protocol !== null
        ? { ...provenance, steps: literalProtocolSteps(protocol) }
        : null,
    },
    also_eligible: ranking.candidates.filter((c) => c.lens !== chosen.lens).map((c) => c.lens),
  };
}
