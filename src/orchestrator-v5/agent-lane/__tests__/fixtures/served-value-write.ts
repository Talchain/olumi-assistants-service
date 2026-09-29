/**
 * The served `/orchestrate/v2/turn` body for a COMMITTED `factor_value_edit` — the
 * part the agent lane reads.
 *
 * ⛔ A BARE `{ assistant_text: 'Updated.' }` IS NOT THE WIRE, and fakes that answered
 * with it could not tell a committed write from a refused one: a refused
 * `factor_value_edit` ALSO answers HTTP 200 (the refusal is committed as a turn with
 * no graph — `system-events/dispatch.ts` `dispatchFactorValueEdit`), with
 * `blocks: []`. What a committed write carries that a refusal does not is the
 * per-operation `graph_patch` block built from its own handler fact
 * (`compose.ts`, pinned at the route by
 * `tests/integration/orchestrator/route-v2-factor-value-edit.test.ts`:
 * `status: 'applied'`, `operation: 'set_factor_value'`, `target_id`).
 */
export function committedValueWrite(targetId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assistant_text: 'Updated.',
    blocks: [{ type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: targetId }],
    ...extra,
  };
}
