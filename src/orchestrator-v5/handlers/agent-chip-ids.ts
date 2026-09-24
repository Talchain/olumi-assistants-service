/**
 * The chip id the OpenAI Agent lane's `run_analysis` tool sends
 * (`agent-lane/runtime/agent-capabilities.ts`), read by `chip-click-dispatch.ts`.
 *
 * ⛔ ON THE OPENAI ROUTE THE LEGACY decision_review IS NOT CALLED (#63 5793252993:
 * "a hidden Anthropic call is not" allowed; measured on served c4a6cce, 5793628948:
 * ~14 s of every Agent analysis turn, review cards with no provider attribution).
 * The canonical analysis still runs; the Agent explains it. Request-scoped by this
 * id, so Conventional's global V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW is untouched.
 *
 * Its own module so neither side imports the other's dependency tree.
 */
export const AGENT_RUN_ANALYSIS_CHIP_ID = 'agent-run-analysis';
