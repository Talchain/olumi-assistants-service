import { ALL_MATERIAL_LINKS_USER_STATED_REASON, MIXED_MATERIAL_LINKS_USER_STATED_REASON, MIXED_MATERIAL_LINKS_USER_STATED_SHORT } from '../admission/analysis-admission.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
/** Read the leader identity THIS response actually publishes; admission's ceiling is not a Run result. */
export function authorshipReasonForRun<T>(response: T): T {
  const r = rec(response), ready = rec(r?.analysis_ready), admission = rec(ready?.analysis_admission);
  if (!Array.isArray(admission?.reasons)) return response;
  const claim = rec(rec(r?.analysis_state)?.leader_claim);
  const named = claim?.permitted === true && Array.isArray(r?.blocks) && r.blocks.some(b => {
    const block = rec(b);
    return block?.type === 'analysis_result' && typeof block.leading_option_id === 'string' && block.leading_option_id.trim().length > 0;
  });
  const message = named ? MIXED_MATERIAL_LINKS_USER_STATED_REASON.message : MIXED_MATERIAL_LINKS_USER_STATED_SHORT.message;
  let changed = false;
  const reasons = admission.reasons.map(reason => {
    const row = rec(reason);
    if (row?.field !== 'semantic_quality_sufficient' || row.code !== MIXED_MATERIAL_LINKS_USER_STATED_REASON.code
      || row.message === ALL_MATERIAL_LINKS_USER_STATED_REASON.message
      || ![MIXED_MATERIAL_LINKS_USER_STATED_REASON.message, MIXED_MATERIAL_LINKS_USER_STATED_SHORT.message].includes(row.message as string)
      || row.message === message) return reason;
    changed = true;
    return { ...row, message };
  });
  return changed ? { ...r, analysis_ready: { ...ready, analysis_admission: { ...admission, reasons } } } as T : response; // finaliser-exempt: only caller is response-finaliser.ts (finaliser sub-step); rewrites reason text inside an already-present analysis_ready, never sets it
}
