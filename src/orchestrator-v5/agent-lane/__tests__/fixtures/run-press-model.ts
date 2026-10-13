/** R1 fixture: the existing forced-tool request gets an AI-authored call with unknown timing. */
export function runPressToolResponse(body: Record<string, unknown>): Response | undefined {
  const choice = body.tool_choice as { type?: string; name?: string } | undefined;
  if (choice?.type !== 'function' || choice.name !== 'run_analysis') return undefined;
  return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'run_analysis',
    call_id: 'fixture_run_press', arguments: JSON.stringify({ reason: 'The user pressed Run.', effects_timing: null }) }] }), { status: 200 });
}
