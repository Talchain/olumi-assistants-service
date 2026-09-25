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

/**
 * The chip id the OpenAI Agent lane's `propose_new_option` sends with its typed add-option turn
 * (`intent: 'add_option'`), so the option is added through the product's own atomic transaction
 * (`dispatchAddOptionTransaction` → one held pending → one commit) — never through separate system
 * events that left it unlinked from the decision (Paul's manual test, 25 Sep; C52).
 */
export const AGENT_ADD_OPTION_CHIP_ID = 'agent-add-option';
