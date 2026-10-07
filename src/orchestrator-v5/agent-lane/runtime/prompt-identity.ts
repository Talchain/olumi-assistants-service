/**
 * ⭐ WHICH PROMPT A SERVED MODEL CALL SENT — an alias and a hash on every Agent ledger row.
 *
 * AIQ's identity map (`aiq-p2-20260927/PROMPT-HARNESS-IDENTITY-MAP.md` @30c0e79c, Part 2 §2; DL #70 5858315483
 * item 3), CODE-READ at CEE 339ed343: "No served model call carries a prompt identity. A `_provider_calls` entry
 * holds `site, provider, model, purpose, outcome, tokens`, with no prompt id, version or hash." The four prompts the
 * served Agent lane runs (`AGENT_INSTRUCTIONS`, the Run interpreter, `RESEARCH_INSTRUCTIONS`, `BUILD_INSTRUCTIONS`)
 * are in no registry, so the only identity a served prompt had was the CEE build SHA — and the COMPOSED text (the
 * interpreter's appended constraint, C5b's view line, a construction retry suffix) was not identified per call at all.
 *
 * So each Agent call now records, on its own ledger row (`adapters/llm/provider-policy.ts`, `GenerativeCall`):
 *   · `prompt_alias` — WHICH stage's prompt, from {@link AGENT_PROMPT_ALIASES} (the map's Part 3 names, verbatim);
 *   · `prompt_sha256` — lowercase hex sha256 of the FINAL `instructions` string that call actually sent, so two
 *     calls under one alias that sent different text (a withheld Run's view line, a retry suffix) read as different.
 *
 * ⛔ ADDITIVE, NO RENAME (the map's rule: "Nothing is renamed on the hot path. The map and aliases come first."). Code
 * symbols, PMS task ids, routes and prompt text are untouched; an alias is a string constant plus a ledger field.
 *
 * ⚠ WHAT v1 DOES NOT IDENTIFY, said here so an absent field is never read as "no prompt":
 *   · only the Agent route's OpenAI call sites set these fields (`agent-v1-turn.ts` callModel / callResearch /
 *     callStructured / callBriefReading — the last is C6-2's `agent.read_brief`). Every LEGACY site (`anthropic.client`, `decision_review`, the draft pipeline …) stays UNALIASED:
 *     its rows carry neither field. The map's `legacy.*` aliases are names only until a legacy site is wired;
 *   · the hash covers `instructions` ONLY — not the tool descriptions (`agent.tools` in the map), not `input`;
 *   · `agent.construct` covers `BUILD_INSTRUCTIONS` AND its retry / size / compaction suffixes under one alias; the
 *     sha is what tells them apart.
 */
import { createHash } from 'node:crypto';
import { GIT_COMMIT_SHA } from '../../../version.js';
import { getRuntimeEnvResolution } from '../../../config/env-resolver.js';

/** The served Agent lane's prompt aliases (map Part 3, stages 1–4). One list, so tests and the map share it. */
export const AGENT_PROMPT_ALIASES = ['agent.converse', 'agent.interpret', 'agent.research', 'agent.construct', 'agent.read_brief'] as const;
export type AgentPromptAlias = (typeof AGENT_PROMPT_ALIASES)[number];

/**
 * sha256 (lowercase hex) of the instructions a call sends. NEVER THROWS: this sits on the path to the provider, and
 * measuring a call must not turn it into a failed one.
 *   · a string is hashed as its UTF-8 bytes, exactly as JSON-encoding sends it;
 *   · absent (`undefined` / `null`) hashes `''` — the row is still recorded, and `''`'s well-known digest says "none";
 *   · anything else hashes its JSON (the request body's own field, as sent); an unserialisable value hashes `''`.
 */
export function promptSha256(instructions: unknown): string {
  let text = '';
  if (typeof instructions === 'string') text = instructions;
  else if (instructions !== undefined && instructions !== null) {
    try { text = JSON.stringify(instructions) ?? ''; } catch { text = ''; }
  }
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The two ledger fields for one call, ready to spread into `assertProviderAllowed`'s `detail`. */
export function agentPromptIdentity(alias: AgentPromptAlias, instructions: unknown): { readonly prompt_alias: AgentPromptAlias; readonly prompt_sha256: string } {
  return { prompt_alias: alias, prompt_sha256: promptSha256(instructions) };
}

/**
 * The conversation call's alias. The Run fast path's ONE interpreting call is the only `callModel` request that sets
 * `tool_choice: 'none'` (`agent-v1-turn.ts`, fast path 3) — the same test the transport uses to forward it.
 */
export function conversationPromptAlias(toolChoice: unknown, reasoningRole?: unknown): AgentPromptAlias {
  // P44 S1: a narrating call (`reasoning_role: 'narrate'`) sends `tool_choice: 'none'` but is still the converse prompt.
  if (reasoningRole === 'narrate') return 'agent.converse';
  return toolChoice === 'none' ? 'agent.interpret' : 'agent.converse';
}

/**
 * ⭐ THE WHOLE REQUEST IDENTITY OF ONE AGENT CALL (PTL row 4, #72 5871228357; DL ASSIGN 5871346171), read from the BODY
 * the call then JSON-encodes and sends — never from what the caller meant to send:
 *   · the alias and the instructions sha, as {@link agentPromptIdentity};
 *   · `tools_sha256` / `schema_sha256`: sha256 of the sent `tools` / `text.format.schema`, JSON-encoded, as MG's Baseline
 *     v1 manifest defines them (schema = sha256(JSON.stringify(strictForTheDrafter(buildCandidateSchema())))). Absent when not sent;
 *   · the sent `reasoning.effort` and `max_output_tokens`;
 *   · `cee_build` (the full commit) and the environment with its source (`getRuntimeEnvResolution`).
 * NEVER THROWS: it sits on the path to the provider.
 */
export function agentRequestIdentity(alias: AgentPromptAlias, body: Readonly<Record<string, unknown>>): Readonly<Record<string, string | number>> {
  const out: Record<string, string | number> = { ...agentPromptIdentity(alias, body['instructions']) };
  try {
    const text = body['text'] as { format?: { schema?: unknown } } | undefined;
    const reasoning = body['reasoning'] as { effort?: unknown } | undefined;
    if (body['tools'] !== undefined) out['tools_sha256'] = jsonSha256(body['tools']);
    if (text?.format?.schema !== undefined) out['schema_sha256'] = jsonSha256(text.format.schema);
    if (typeof reasoning?.effort === 'string') out['reasoning_effort'] = reasoning.effort;
    if (typeof body['max_output_tokens'] === 'number') out['max_output_tokens'] = body['max_output_tokens'];
    out['cee_build'] = GIT_COMMIT_SHA;
    const env = getRuntimeEnvResolution();
    out['environment'] = env.env;
    out['environment_source'] = env.source;
  } catch { /* measuring a call never fails it */ }
  return out;
}

/** sha256 of a value as JSON-encoding sends it; an unserialisable value hashes `''`. */
function jsonSha256(value: unknown): string {
  let text = '';
  try { text = JSON.stringify(value) ?? ''; } catch { text = ''; }
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
