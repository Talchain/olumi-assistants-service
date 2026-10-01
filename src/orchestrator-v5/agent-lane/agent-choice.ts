/**
 * ⭐ A REFUSAL THE USER SETTLES BY CHOOSING (Paul's order #4, 1 Oct: "never a 'type the exact words' ask"; interface MG
 * 5933547779, agreed AI HARNESS 5934163980; lease 5938604755). The HOST side only:
 *
 *   1. tool → host: a refusal (`ok: false`, nothing written) carrying `choices: [{ label, field, value }]` (≤ 3), built
 *      by the TOOL from its own typed candidates (MG). The host interprets no words.
 *   2. host → chip: `agent-choice:<tool>:<field>:<value>`, labelled with the choice's own label. All or none: one entry
 *      the host cannot carry offers no chip at all, and the refusal's own text stands.
 *   3. chip → tool: the press's chip id ONLY is parsed (`chosenOf`) into `ctx.chosen = { tool, field, value }`, and that
 *      tool is the turn's first call. The tool accepts `chosen.value` for `field` only when `chosen.tool` is itself and
 *      the value is one it would offer NOW, re-derived from the graph; anything else refuses again (MG).
 *
 * No process memory: the id carries the whole reading and the tool re-derives its validity, so a restart, a replay or a
 * forged id can never record anything the tool would not offer on the current graph. Pure.
 */
import { AGENT_TOOLS } from './runtime/agent-tools.js';

export const AGENT_CHOICE_PREFIX = 'agent-choice:';
/** At most this many choices: more is no longer a choice the user can scan (MG 5933547779 §1). */
export const AGENT_CHOICE_MAX = 3;

/** The reading a pressed choice carries: bound from the chip id by the route, never from model output or free text. */
export interface ChosenReading {
  readonly tool: string;
  readonly field: string;
  readonly value: string;
}

export interface AgentChoiceChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
}

const TOOL_NAMES: ReadonlySet<string> = new Set(AGENT_TOOLS.map((t) => t.name));
/** A typed field name the tool owns (`direction`, `entity`, `comparator`). */
const FIELD = /^[a-z][a-z0-9_]{0,63}$/u;
/** A typed value: an enum literal (`negative`, `at_least`) or a canonical node id (`^[a-z0-9_:-]+$`). */
const VALUE = /^[a-z0-9_:-]{1,128}$/u;
const LABEL_MAX = 120;

type Rec = Record<string, unknown>;
const recordOf = (x: unknown): Rec | undefined => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : undefined);

/** The chips for ONE tool result: its choices when it is a refusal that carries them whole, else none. */
export function agentChoiceChipsOf(tool: string, result: unknown): AgentChoiceChip[] {
  const r = recordOf(result);
  if (!TOOL_NAMES.has(tool) || r === undefined || r.ok !== false || r.mutated === true) return [];
  const choices = r.choices;
  if (!Array.isArray(choices) || choices.length === 0 || choices.length > AGENT_CHOICE_MAX) return [];
  const chips: AgentChoiceChip[] = [];
  for (const raw of choices) {
    const c = recordOf(raw);
    const label = typeof c?.label === 'string' ? c.label.trim() : '';
    if (c === undefined || label === '' || label.length > LABEL_MAX
      || typeof c.field !== 'string' || !FIELD.test(c.field) || typeof c.value !== 'string' || !VALUE.test(c.value)) return [];
    const id = `${AGENT_CHOICE_PREFIX}${tool}:${c.field}:${c.value}`;
    if (chips.some((x) => x.id === id || x.label === label)) return [];
    chips.push({ id, label, message: label });
  }
  return chips;
}

/** Every choice chip this turn's tool results offer, in call order (`tool_calls[i]` made `tool_results[i]`). */
export function agentChoiceChipsFrom(
  toolCalls: readonly { readonly name: string }[],
  toolResults: readonly unknown[],
): AgentChoiceChip[] {
  return toolCalls.flatMap((call, i) => agentChoiceChipsOf(call.name, toolResults[i]));
}

export const isAgentChoiceChipId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(AGENT_CHOICE_PREFIX);

/** The reading a pressed choice chip carries, parsed from its id alone; undefined for any other request. */
export function chosenOf(body: Record<string, unknown>): ChosenReading | undefined {
  if (body['kind'] !== undefined && body['kind'] !== 'message') return undefined;
  const id = recordOf(body['chip'])?.id;
  if (typeof id !== 'string' || !id.startsWith(AGENT_CHOICE_PREFIX)) return undefined;
  const rest = id.slice(AGENT_CHOICE_PREFIX.length);
  // `<tool>:<field>:<value>`: the tool and field hold no colon; a canonical node id value may.
  const a = rest.indexOf(':');
  const b = a < 0 ? -1 : rest.indexOf(':', a + 1);
  if (a <= 0 || b <= a + 1) return undefined;
  const tool = rest.slice(0, a);
  const field = rest.slice(a + 1, b);
  const value = rest.slice(b + 1);
  return TOOL_NAMES.has(tool) && FIELD.test(field) && VALUE.test(value) ? { tool, field, value } : undefined;
}
